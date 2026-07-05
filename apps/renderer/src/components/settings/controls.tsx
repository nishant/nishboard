import { cn } from '../../lib/utils';

// Shared Settings row controls, extracted from SettingsModal so panels in
// other files (Alerts tab, weather notify row) can reuse them.

export function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5',
          checked ? 'bg-th-accent' : 'bg-th-overlay',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
      <div className="flex flex-col">
        <span className="text-th-hi text-[11px]">{label}</span>
        {description && (
          <span className="text-th-ghost text-[10px] leading-relaxed">{description}</span>
        )}
      </div>
    </div>
  );
}

export function SegmentedRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-th-3 text-[11px] w-28 shrink-0">{label}</span>
      <div className="flex rounded-lg bg-th-elevated p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'px-2.5 py-1 rounded text-[10px] transition-colors',
              value === o.value ? 'bg-th-overlay text-th-hi' : 'text-th-ghost hover:text-th-2',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
