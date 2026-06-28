import { useState, useEffect } from 'react';
import { X, Eye, EyeOff, Check, Loader2 } from 'lucide-react';
import { CREDENTIAL_DEFS, CREDENTIAL_KEYS } from '@dash/shared';
import type { CredentialKey } from '@dash/shared';
import { cn } from '../lib/utils';

// Group defs by service
const SERVICES = Array.from(new Set(CREDENTIAL_DEFS.map((d) => d.service)));

// ── Single credential row ─────────────────────────────────────────────────────

function CredentialRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="text-th-3 text-[11px] w-28 shrink-0">{label}</span>
        <div className="flex-1 flex items-center gap-1.5">
          <input
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="—"
            spellCheck={false}
            className="flex-1 bg-th-elevated border border-th-line rounded-lg px-3 py-1.5 text-th-hi text-[11px] font-mono placeholder:text-th-ghost focus:outline-none focus:border-th-3 transition-colors"
          />
          <button
            onClick={() => setVisible((v) => !v)}
            className="text-th-ghost hover:text-th-2 transition-colors shrink-0 p-1"
            tabIndex={-1}
            title={visible ? 'Hide' : 'Show'}
          >
            {visible ? <EyeOff size={13} /> : <Eye size={13} />}
          </button>
        </div>
      </div>
      {hint && (
        <p className="text-th-ghost text-[10px] leading-relaxed pl-[calc(7rem+0.75rem)]">{hint}</p>
      )}
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [values, setValues] = useState<Partial<Record<CredentialKey, string>>>(
    () => Object.fromEntries(CREDENTIAL_KEYS.map((k) => [k, ''])) as Record<CredentialKey, string>,
  );
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [loading, setLoading] = useState(true);

  // Load existing credentials on mount
  useEffect(() => {
    window.electron.credentials.getAll().then((stored) => {
      setValues((prev) => ({ ...prev, ...stored }));
      setLoading(false);
    });
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleSave() {
    setSaveState('saving');
    try {
      await window.electron.credentials.saveAll(values);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 2000);
    } catch {
      setSaveState('error');
      setTimeout(() => setSaveState('idle'), 3000);
    }
  }

  function setValue(key: CredentialKey, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
    if (saveState !== 'idle') setSaveState('idle');
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60">
      <div className="bg-th-surface border border-th-line rounded-2xl shadow-2xl w-[480px] max-h-[80vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-th-line shrink-0">
          <span className="text-th-hi font-semibold text-sm">Settings</span>
          <button
            onClick={onClose}
            className="text-th-ghost hover:text-th-hi transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={18} className="text-th-ghost animate-spin" />
            </div>
          ) : (
            SERVICES.map((service) => {
              const defs = CREDENTIAL_DEFS.filter((d) => d.service === service);
              return (
                <div key={service} className="flex flex-col gap-3">
                  <span className="text-th-2 text-xs font-semibold uppercase tracking-wider">
                    {service}
                  </span>
                  {defs.map((def) => (
                    <CredentialRow
                      key={def.key}
                      label={def.label}
                      hint={def.hint}
                      value={values[def.key] ?? ''}
                      onChange={(v) => setValue(def.key, v)}
                    />
                  ))}
                </div>
              );
            })
          )}

          {/* Info note */}
          <p className="text-th-ghost text-[10px] leading-relaxed border-t border-th-line pt-4">
            Spotify uses sign-in — no key needed. Weather, Hardware, and Sound require no API keys.
            <br />
            Keys are encrypted with your OS keychain and never leave this device.
          </p>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-th-line shrink-0 flex items-center justify-between">
          {saveState === 'error' && (
            <span className="text-red-400 text-[11px]">Failed to save — check console</span>
          )}
          {saveState !== 'error' && <span />}

          <button
            onClick={handleSave}
            disabled={saveState === 'saving' || loading}
            className={cn(
              'flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[11px] font-medium transition-colors',
              saveState === 'saved'
                ? 'bg-emerald-500/20 text-emerald-400 cursor-default'
                : 'bg-th-overlay hover:bg-th-overlay/70 text-th-hi disabled:opacity-40 disabled:cursor-not-allowed',
            )}
          >
            {saveState === 'saving' && <Loader2 size={12} className="animate-spin" />}
            {saveState === 'saved'  && <Check size={12} />}
            {saveState === 'saving' ? 'Saving…'
              : saveState === 'saved' ? 'Saved'
              : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
