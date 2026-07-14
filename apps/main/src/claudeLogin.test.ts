import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  CLAUDE_LOGIN_COMMAND,
  buildTerminalSpawnSpec,
  credentialsPath,
  credsChanged,
  parseKeychainMdat,
  parseSpawnedPid,
  parseTerminalWindowId,
} from './claudeLogin';

describe('credentialsPath', () => {
  it('resolves ~/.claude/.credentials.json under the given home', () => {
    expect(credentialsPath('/home/nish')).toBe(path.join('/home/nish', '.claude', '.credentials.json'));
    expect(credentialsPath('C:\\Users\\nish5')).toBe(path.join('C:\\Users\\nish5', '.claude', '.credentials.json'));
  });
});

describe('buildTerminalSpawnSpec', () => {
  it('win32: powershell Start-Process cmd /k with the login command, helper window hidden', () => {
    const spec = buildTerminalSpawnSpec('win32', CLAUDE_LOGIN_COMMAND);
    expect(spec.file).toBe('powershell.exe');
    expect(spec.args[0]).toBe('-NoProfile');
    expect(spec.args[1]).toBe('-Command');
    expect(spec.args[2]).toContain('Start-Process cmd');
    expect(spec.args[2]).toContain(`'/k','${CLAUDE_LOGIN_COMMAND}'`);
    expect(spec.args[2]).toContain('-PassThru');
    expect(spec.windowsHide).toBe(true);
  });

  it('darwin: osascript drives Terminal.app with do script + activate', () => {
    const spec = buildTerminalSpawnSpec('darwin', CLAUDE_LOGIN_COMMAND);
    expect(spec.file).toBe('osascript');
    expect(spec.args).toContain(`tell application "Terminal" to do script "${CLAUDE_LOGIN_COMMAND}"`);
    expect(spec.args).toContain('tell application "Terminal" to activate');
    expect(spec.windowsHide).toBe(false);
  });
});

describe('parseSpawnedPid', () => {
  it('parses the Start-Process PID with surrounding whitespace', () => {
    expect(parseSpawnedPid('28824\r\n')).toBe(28824);
    expect(parseSpawnedPid('  1234  ')).toBe(1234);
  });

  it('rejects garbage, empty, and non-positive output', () => {
    expect(parseSpawnedPid('')).toBeNull();
    expect(parseSpawnedPid('not a pid')).toBeNull();
    expect(parseSpawnedPid('-5')).toBeNull();
    expect(parseSpawnedPid('0')).toBeNull();
  });
});

describe('parseTerminalWindowId', () => {
  it('extracts the window id from an osascript do-script result', () => {
    expect(parseTerminalWindowId('tab 1 of window id 2685 of application "Terminal"\n')).toBe(2685);
  });

  it('returns null when no window id is present', () => {
    expect(parseTerminalWindowId('')).toBeNull();
    expect(parseTerminalWindowId('execution error: something (-1743)')).toBeNull();
  });
});

describe('parseKeychainMdat', () => {
  const securityOutput = [
    'keychain: "/Users/nish/Library/Keychains/login.keychain-db"',
    'version: 512',
    'class: "genp"',
    'attributes:',
    '    0x00000007 <blob>="Claude Code-credentials"',
    '    "acct"<blob>="nish"',
    '    "cdat"<timedate>=0x32303236303530313132303030305A00  "20260501120000Z\\000"',
    '    "mdat"<timedate>=0x32303236303731313230303030305A00  "20260711200000Z\\000"',
    '    "svce"<blob>="Claude Code-credentials"',
  ].join('\n');

  it('extracts the modified-date attribute', () => {
    expect(parseKeychainMdat(securityOutput)).toBe('20260711200000Z\\000');
  });

  it('returns null when the attribute is absent', () => {
    expect(parseKeychainMdat('')).toBeNull();
    expect(parseKeychainMdat('security: SecKeychainSearchCopyNext: The specified item could not be found.')).toBeNull();
  });
});

describe('credsChanged', () => {
  const snap = (fileMtimeMs: number | null, keychainMdat: string | null) => ({ fileMtimeMs, keychainMdat });

  it('detects the credentials file being created', () => {
    expect(credsChanged(snap(null, null), snap(1000, null))).toBe(true);
  });

  it('detects a credentials-file mtime bump', () => {
    expect(credsChanged(snap(1000, null), snap(2000, null))).toBe(true);
  });

  it('ignores an unchanged or older file mtime', () => {
    expect(credsChanged(snap(1000, null), snap(1000, null))).toBe(false);
    expect(credsChanged(snap(2000, null), snap(1000, null))).toBe(false);
    expect(credsChanged(snap(null, null), snap(null, null))).toBe(false);
  });

  it('macOS: detects a keychain item appearing or its mdat changing', () => {
    expect(credsChanged(snap(null, null), snap(null, 'A'))).toBe(true);
    expect(credsChanged(snap(null, 'A'), snap(null, 'B'))).toBe(true);
  });

  it('macOS: ignores an unchanged keychain mdat or a vanished item', () => {
    expect(credsChanged(snap(null, 'A'), snap(null, 'A'))).toBe(false);
    expect(credsChanged(snap(null, 'A'), snap(null, null))).toBe(false);
  });
});
