import type { FastifyPluginAsync } from 'fastify';
import type { SoundData, AudioDevice, AudioSession } from '@dash/shared';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { SimpleCache } from '../cache/SimpleCache';
import { HttpError } from '../lib/http';

const execFileAsync = promisify(execFile);
const cache = new SimpleCache<SoundData>();
const TTL_MS = 5_000;

// execFile (no shell) so arguments are passed verbatim — request-supplied
// values like device names can never be interpreted as shell syntax.
async function run(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, { encoding: 'utf8' });
  return stdout.trim();
}

// The WASAPI Add-Type payload base64-encoded blows past Windows' 8191-char
// command-line limit when passed via -EncodedCommand, so the session
// enumeration script silently failed and the mixer rendered empty.
// Write the script to a UTF-16 LE temp file and invoke it with -File instead —
// matches what -EncodedCommand decodes internally, so PowerShell 5.1 parses it
// identically. -ExecutionPolicy Bypass is needed because -File does not
// auto-bypass execution policy the way -EncodedCommand does.
async function psRun(script: string): Promise<string> {
  const tmp = join(
    tmpdir(),
    `dash-ps-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`,
  );
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(script, 'utf16le')]);
  await writeFile(tmp, buf);
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout.trim();
  } finally {
    void unlink(tmp).catch(() => {});
  }
}

// ── macOS ────────────────────────────────────────────────────────────────

async function macGetData(): Promise<SoundData> {
  const [volStr, mutedStr] = await Promise.all([
    run('osascript', ['-e', 'output volume of (get volume settings)']),
    run('osascript', ['-e', 'output muted of (get volume settings)']),
  ]);
  const volumePercent = Number(volStr);
  const muted = mutedStr === 'true';

  let activeDeviceName = 'Default Output';
  let devices: AudioDevice[] = [{ id: 'default', name: 'Default Output', isDefault: true }];

  try {
    const [current, all] = await Promise.all([
      run('SwitchAudioSource', ['-c']),
      run('SwitchAudioSource', ['-a', '-t', 'output']),
    ]);
    activeDeviceName = current;
    devices = all
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => ({ id: name, name, isDefault: name === current }));
  } catch {
    // SwitchAudioSource not installed — brew install switchaudio-osx
  }

  return { volumePercent, muted, activeDeviceName, devices, sessions: [] };
}

async function macSetVolume(vol: number): Promise<void> {
  await run('osascript', ['-e', `set volume output volume ${Math.round(vol)}`]);
}

async function macSetMute(muted: boolean): Promise<void> {
  await run('osascript', ['-e', `set volume ${muted ? 'with' : 'without'} output muted`]);
}

async function macSwitchDevice(id: string): Promise<void> {
  await run('SwitchAudioSource', ['-s', id]);
}

// ── Windows — WASAPI COM via Add-Typed C# helpers ─────────────────────────
//
// PowerShell can't QueryInterface on dynamically-Add-Typed COM interfaces —
// `-as [IFoo]` returns null, `[IFoo]$x` cast fails, and dispatch on a
// System.__ComObject fails for IUnknown-only interfaces (no IDispatch).
// All COM walking is therefore done inside C# static methods, where the casts
// trigger QI at compile time. PowerShell only ever sees the final string[].
//
// Encoding: the C# source is base64-encoded so it survives a UTF-16 LE .ps1
// file with no here-string quoting fragility. Add-Type is invoked once per
// PowerShell process (each psRun spawns a fresh one).

const WASAPI_CS = [
  'using System;',
  'using System.Collections.Generic;',
  'using System.Diagnostics;',
  'using System.Runtime.InteropServices;',
  '',
  '[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'public interface IAudioEndpointVolume {',
  '    [PreserveSig] int RegisterControlChangeNotify(IntPtr n);',
  '    [PreserveSig] int UnregisterControlChangeNotify(IntPtr n);',
  '    [PreserveSig] int GetChannelCount(out uint c);',
  '    [PreserveSig] int SetMasterVolumeLevel(float l, ref Guid g);',
  '    [PreserveSig] int SetMasterVolumeLevelScalar(float l, ref Guid g);',
  '    [PreserveSig] int GetMasterVolumeLevel(out float l);',
  '    [PreserveSig] int GetMasterVolumeLevelScalar(out float l);',
  '    [PreserveSig] int SetChannelVolumeLevel(uint n, float l, ref Guid g);',
  '    [PreserveSig] int SetChannelVolumeLevelScalar(uint n, float l, ref Guid g);',
  '    [PreserveSig] int GetChannelVolumeLevel(uint n, out float l);',
  '    [PreserveSig] int GetChannelVolumeLevelScalar(uint n, out float l);',
  '    int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);',
  '    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);',
  '    [PreserveSig] int GetVolumeStepInfo(out uint s, out uint c);',
  '    [PreserveSig] int VolumeStepUp(ref Guid g);',
  '    [PreserveSig] int VolumeStepDown(ref Guid g);',
  '    [PreserveSig] int QueryHardwareSupport(out uint m);',
  '    [PreserveSig] int GetVolumeRange(out float mn, out float mx, out float inc);',
  '}',
  '',
  '[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'public interface ISimpleAudioVolume {',
  '    [PreserveSig] int SetMasterVolume(float fLevel, ref Guid eventContext);',
  '    [PreserveSig] int GetMasterVolume(out float pfLevel);',
  '    int SetMute([MarshalAs(UnmanagedType.Bool)] bool bMute, ref Guid eventContext);',
  '    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool pbMute);',
  '}',
  '',
  '[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'public interface IAudioSessionControl2 {',
  '    [PreserveSig] int GetState(out int state);',
  '    int GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);',
  '    int SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name, ref Guid g);',
  '    int GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);',
  '    int SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path, ref Guid g);',
  '    [PreserveSig] int GetGroupingParam(out Guid g);',
  '    [PreserveSig] int SetGroupingParam(ref Guid g, ref Guid evt);',
  '    [PreserveSig] int RegisterAudioSessionNotification(IntPtr client);',
  '    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr client);',
  '    int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);',
  '    int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);',
  '    [PreserveSig] int GetProcessId(out uint pid);',
  '    [PreserveSig] int IsSystemSoundsSession();',
  '    int SetDuckingPreference([MarshalAs(UnmanagedType.Bool)] bool optOut);',
  '}',
  '',
  '[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'public interface IAudioSessionEnumerator {',
  '    [PreserveSig] int GetCount(out int count);',
  '    int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object session);',
  '}',
  '',
  '[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'public interface IAudioSessionManager2 {',
  '    [PreserveSig] int GetAudioSessionControl(ref Guid sessionId, uint streamFlags, out IntPtr session);',
  '    int GetSimpleAudioVolume(ref Guid sessionId, uint streamFlags, [MarshalAs(UnmanagedType.IUnknown)] out object volume);',
  '    int GetSessionEnumerator([MarshalAs(UnmanagedType.IUnknown)] out object sessionEnum);',
  '    [PreserveSig] int RegisterSessionNotification(IntPtr client);',
  '    [PreserveSig] int UnregisterSessionNotification(IntPtr client);',
  '    int RegisterDuckNotification([MarshalAs(UnmanagedType.LPWStr)] string sessionId, IntPtr client);',
  '    [PreserveSig] int UnregisterDuckNotification(IntPtr client);',
  '}',
  '',
  '[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'public interface IMMDevice {',
  '    int Activate(ref Guid iid, uint ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);',
  '    [PreserveSig] int OpenPropertyStore(uint a, out IntPtr pp);',
  '    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);',
  '    [PreserveSig] int GetState(out uint s);',
  '}',
  '',
  '[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
  'public interface IMMDeviceEnumerator {',
  '    [PreserveSig] int EnumAudioEndpoints(int f, uint s, out IntPtr pp);',
  '    int GetDefaultAudioEndpoint(int f, int r, [MarshalAs(UnmanagedType.IUnknown)] out object pp);',
  '    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, [MarshalAs(UnmanagedType.IUnknown)] out object pp);',
  '    [PreserveSig] int RegisterEndpointNotificationCallback(IntPtr p);',
  '    [PreserveSig] int UnregisterEndpointNotificationCallback(IntPtr p);',
  '}',
  '',
  '[Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"), ComImport]',
  'public class MMDeviceEnumeratorComObj {}',
  '',
  'public static class W {',
  '    static readonly Guid IID_AEV = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");',
  '    static readonly Guid IID_SessMgr = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");',
  '',
  '    static IMMDevice DefaultDevice() {',
  '        var e = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObj();',
  '        object o; e.GetDefaultAudioEndpoint(0, 1, out o);',
  '        return (IMMDevice)o;',
  '    }',
  '    static IAudioEndpointVolume AEV() {',
  '        Guid iid = IID_AEV; object o;',
  '        DefaultDevice().Activate(ref iid, 23, IntPtr.Zero, out o);',
  '        return (IAudioEndpointVolume)o;',
  '    }',
  '    static IAudioSessionManager2 SessMgr() {',
  '        Guid iid = IID_SessMgr; object o;',
  '        DefaultDevice().Activate(ref iid, 23, IntPtr.Zero, out o);',
  '        return (IAudioSessionManager2)o;',
  '    }',
  '',
  '    public static string GetMaster() {',
  '        var v = AEV();',
  '        float l; v.GetMasterVolumeLevelScalar(out l);',
  '        bool m; v.GetMute(out m);',
  '        return ((int)Math.Round(l * 100)) + "|" + (m ? "True" : "False");',
  '    }',
  '    public static void SetMasterVolume(float scalar) {',
  '        Guid g = Guid.Empty;',
  '        AEV().SetMasterVolumeLevelScalar(scalar, ref g);',
  '    }',
  '    public static void SetMasterMute(bool muted) {',
  '        Guid g = Guid.Empty;',
  '        AEV().SetMute(muted, ref g);',
  '    }',
  '',
  '    public static string[] GetSessions() {',
  '        var procs = new Dictionary<int, string>();',
  '        foreach (var p in Process.GetProcesses()) {',
  '            try { procs[p.Id] = p.ProcessName; } catch {}',
  '        }',
  '        var mgr = SessMgr();',
  '        object seo; mgr.GetSessionEnumerator(out seo);',
  '        var se = (IAudioSessionEnumerator)seo;',
  '        int count; se.GetCount(out count);',
  '        var seen = new HashSet<int>();',
  '        var lines = new List<string>();',
  '        for (int i = 0; i < count; i++) {',
  '            try {',
  '                object so; se.GetSession(i, out so);',
  '                var ctrl = (IAudioSessionControl2)so;',
  '                int state; ctrl.GetState(out state);',
  '                if (state == 2) continue;',
  '                uint pid; ctrl.GetProcessId(out pid);',
  '                if (!seen.Add((int)pid)) continue;',
  '                bool isSys = ctrl.IsSystemSoundsSession() == 0;',
  '                string dn; ctrl.GetDisplayName(out dn);',
  '                string name;',
  '                if (isSys || pid == 0) name = "System Sounds";',
  '                else if (!string.IsNullOrEmpty(dn) && !dn.StartsWith("@")) name = dn;',
  '                else if (procs.ContainsKey((int)pid)) name = procs[(int)pid];',
  '                else name = "Unknown (" + pid + ")";',
  '                ISimpleAudioVolume sav = so as ISimpleAudioVolume;',
  '                if (sav == null) {',
  '                    Guid gp; ctrl.GetGroupingParam(out gp);',
  '                    object svo; mgr.GetSimpleAudioVolume(ref gp, 0, out svo);',
  '                    sav = svo as ISimpleAudioVolume;',
  '                }',
  '                float l = 1f; bool m = false;',
  '                if (sav != null) { sav.GetMasterVolume(out l); sav.GetMute(out m); }',
  '                lines.Add(pid + "|" + name + "|" + ((int)Math.Round(l * 100)) + "|" + (m ? "True" : "False"));',
  '            } catch {}',
  '        }',
  '        return lines.ToArray();',
  '    }',
  '',
  '    public static void SetSessionVolume(uint targetPid, float scalar) {',
  '        var mgr = SessMgr();',
  '        object seo; mgr.GetSessionEnumerator(out seo);',
  '        var se = (IAudioSessionEnumerator)seo;',
  '        int count; se.GetCount(out count);',
  '        Guid g = Guid.Empty;',
  '        for (int i = 0; i < count; i++) {',
  '            try {',
  '                object so; se.GetSession(i, out so);',
  '                var ctrl = (IAudioSessionControl2)so;',
  '                uint pid; ctrl.GetProcessId(out pid);',
  '                if (pid != targetPid) continue;',
  '                ISimpleAudioVolume sav = so as ISimpleAudioVolume;',
  '                if (sav == null) {',
  '                    Guid gp; ctrl.GetGroupingParam(out gp);',
  '                    object svo; mgr.GetSimpleAudioVolume(ref gp, 0, out svo);',
  '                    sav = svo as ISimpleAudioVolume;',
  '                }',
  '                if (sav != null) sav.SetMasterVolume(scalar, ref g);',
  '            } catch {}',
  '        }',
  '    }',
  '}',
].join('\n');

const WASAPI_CS_B64 = Buffer.from(WASAPI_CS, 'utf8').toString('base64');

const WASAPI = `
$_cs = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${WASAPI_CS_B64}'))
Add-Type -ErrorAction Stop -TypeDefinition $_cs
Remove-Variable _cs
`;

// ── Windows — device / master volume ─────────────────────────────────────

type WinDeviceData = Omit<SoundData, 'sessions'>;

async function winGetDeviceData(): Promise<WinDeviceData> {
  // Prefer AudioDeviceCmdlets (Install-Module AudioDeviceCmdlets)
  try {
    const out = await psRun(`
      $vol  = Get-AudioDevice -PlaybackVolume
      $mute = Get-AudioDevice -PlaybackMute
      $def  = (Get-AudioDevice -Playback).Name
      $list = (Get-AudioDevice -List | Where-Object { $_.Type -eq 'Playback' } | ForEach-Object { $_.Name }) -join ','
      "$vol|$mute|$def|$list"
    `);
    const [volStr, muteStr, defName, listStr] = out.split('|');
    // Get-AudioDevice -PlaybackVolume returns "42%" (string with trailing %)
    const volumePercent = Math.round(Number(volStr.replace('%', '').trim()));
    if (!Number.isFinite(volumePercent)) throw new Error('AudioDeviceCmdlets returned non-numeric volume');
    const muted = muteStr.trim() === 'True';
    const activeDeviceName = defName.trim();
    const names = listStr ? listStr.split(',').map((s) => s.trim()).filter(Boolean) : [activeDeviceName];
    const devices: AudioDevice[] = names.map((name) => ({ id: name, name, isDefault: name === activeDeviceName }));
    return { volumePercent, muted, activeDeviceName, devices };
  } catch {
    // WASAPI fallback — volume+mute only, no device list
    const out = await psRun(`${WASAPI}\n[W]::GetMaster()`);
    const [volStr, muteStr] = out.split('|');
    const volumePercent = Math.min(100, Math.max(0, Math.round(Number(volStr.trim())) || 0));
    return {
      volumePercent,
      muted: muteStr.trim() === 'True',
      activeDeviceName: 'Default Device',
      devices: [{ id: 'default', name: 'Default Device', isDefault: true }],
    };
  }
}

// ── Windows — per-app session mixer ──────────────────────────────────────

async function winGetSessions(): Promise<AudioSession[]> {
  const out = await psRun(`${WASAPI}\n[W]::GetSessions() -join "\`n"`);
  if (!out) return [];
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [pidStr, name, volStr, mutedStr] = line.split('|');
      return {
        pid: Number(pidStr),
        name: name.trim(),
        volumePercent: Number(volStr),
        muted: mutedStr.trim() === 'True',
      };
    });
}

async function winSetSessionVolume(pid: number, vol: number): Promise<void> {
  const scalar = (vol / 100).toFixed(6);
  await psRun(`${WASAPI}\n[W]::SetSessionVolume([uint32]${pid}, [float]${scalar})`);
}

async function winGetData(): Promise<SoundData> {
  // Run device query and session enumeration in parallel
  const [deviceData, sessions] = await Promise.all([
    winGetDeviceData(),
    winGetSessions().catch((): AudioSession[] => []),
  ]);
  return { ...deviceData, sessions };
}

async function winSetVolume(vol: number): Promise<void> {
  try {
    await psRun(`Set-AudioDevice -PlaybackVolume ${Math.round(vol)}`);
  } catch {
    const scalar = (vol / 100).toFixed(6);
    await psRun(`${WASAPI}\n[W]::SetMasterVolume([float]${scalar})`);
  }
}

async function winSetMute(muted: boolean): Promise<void> {
  try {
    await psRun(`Set-AudioDevice -PlaybackMute ${muted ? '$true' : '$false'}`);
  } catch {
    await psRun(`${WASAPI}\n[W]::SetMasterMute([bool]${muted ? '$true' : '$false'})`);
  }
}

async function winSwitchDevice(id: string): Promise<void> {
  // ''-doubling is the complete escape inside PowerShell single quotes, and the
  // script reaches PowerShell via a temp .ps1 (-File) — never through cmd.exe —
  // so this interpolation is injection-safe. Don't "simplify" to double quotes.
  const safe = id.replace(/'/g, "''");
  await psRun(
    `Get-AudioDevice -List | Where-Object { $_.Name -eq '${safe}' -and $_.Type -eq 'Playback' } | Set-AudioDevice`,
  );
}

// ── Dispatch ─────────────────────────────────────────────────────────────

async function getData(): Promise<SoundData> {
  switch (process.platform) {
    case 'darwin': return macGetData();
    case 'win32':  return winGetData();
    default: throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

async function setVolume(vol: number): Promise<void> {
  switch (process.platform) {
    case 'darwin': return macSetVolume(vol);
    case 'win32':  return winSetVolume(vol);
  }
}

async function setMute(muted: boolean): Promise<void> {
  switch (process.platform) {
    case 'darwin': return macSetMute(muted);
    case 'win32':  return winSetMute(muted);
  }
}

async function switchDevice(id: string): Promise<void> {
  switch (process.platform) {
    case 'darwin': return macSwitchDevice(id);
    case 'win32':  return winSwitchDevice(id);
  }
}

// ── Routes ───────────────────────────────────────────────────────────────

export const soundRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Reply: SoundData | { error: string } }>('/', async (_req, reply) => {
    const cached = cache.get();
    if (cached) return reply.send(cached);
    const data = await getData();
    cache.set(data, TTL_MS);
    return reply.send(data);
  });

  // Runtime body schemas — the Fastify generics above are compile-time only, so
  // without these a hand-crafted JSON body (e.g. a string pid) reaches the
  // PowerShell/osascript layer unchecked.
  const volumeBody = {
    type: 'object',
    required: ['volumePercent'],
    properties: { volumePercent: { type: 'number', minimum: 0, maximum: 100 } },
  } as const;

  fastify.post<{ Body: { volumePercent: number }; Reply: { ok: boolean } | { error: string } }>(
    '/volume',
    { schema: { body: volumeBody } },
    async (req, reply) => {
      await setVolume(req.body.volumePercent);
      cache.clear();
      return reply.send({ ok: true });
    },
  );

  fastify.post<{ Body: { muted: boolean }; Reply: { ok: boolean } | { error: string } }>(
    '/mute',
    {
      schema: {
        body: {
          type: 'object',
          required: ['muted'],
          properties: { muted: { type: 'boolean' } },
        },
      },
    },
    async (req, reply) => {
      await setMute(req.body.muted);
      cache.clear();
      return reply.send({ ok: true });
    },
  );

  fastify.post<{ Body: { deviceId: string }; Reply: { ok: boolean } | { error: string } }>(
    '/device',
    {
      schema: {
        body: {
          type: 'object',
          required: ['deviceId'],
          properties: { deviceId: { type: 'string', minLength: 1, maxLength: 256 } },
        },
      },
    },
    async (req, reply) => {
      await switchDevice(req.body.deviceId);
      cache.clear();
      return reply.send({ ok: true });
    },
  );

  // Per-app session volume (Windows only — no-op response on macOS)
  fastify.post<{
    Body: { pid: number; volumePercent: number };
    Reply: { ok: boolean } | { error: string };
  }>(
    '/sessions/volume',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pid', 'volumePercent'],
          properties: {
            pid: { type: 'integer', minimum: 0, maximum: 0xffffffff },
            volumePercent: { type: 'number', minimum: 0, maximum: 100 },
          },
        },
      },
    },
    async (req, reply) => {
      const { pid, volumePercent } = req.body;
      // Belt-and-braces: pid is interpolated into a PowerShell script, so re-check
      // it's a plain integer even though the schema already enforces it.
      if (!Number.isInteger(pid) || pid < 0 || pid > 0xffffffff) {
        throw new HttpError(400, 'pid must be a non-negative integer');
      }
      if (process.platform !== 'win32') return reply.send({ ok: true });
      await winSetSessionVolume(pid, volumePercent);
      cache.clear();
      return reply.send({ ok: true });
    },
  );
};
