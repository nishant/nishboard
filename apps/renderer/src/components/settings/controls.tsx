import { cn, Segmented } from '@nish/ui';


// Shared Settings row controls, extracted from SettingsModal so panels in
// other files (Alerts tab, weather notify row) can reuse them.

/** On/off switch. Off: a light knob on a neutral track in every theme (a dark
 *  knob read as "on" in light themes). On: accent track, knob slid right. */
export function Switch({
  checked,
  onChange,
  size = 'md',
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative rounded-full transition-colors shrink-0',
        sm ? 'w-7 h-4' : 'w-9 h-5',
        checked ? 'bg-th-accent' : 'bg-th-line-strong',
        className,
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 rounded-full transition-transform shadow-card',
          sm ? 'w-3 h-3' : 'w-4 h-4',
          checked && (sm ? 'translate-x-3' : 'translate-x-4'),
          checked ? 'bg-th-on-accent' : 'bg-th-surface ring-1 ring-th-line-strong',
        )}
      />
    </button>
  );
}

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
      <Switch checked={checked} onChange={onChange} className="mt-0.5" />
      <div className="flex flex-col">
        <span className="text-th-hi text-[11px]">{label}</span>
        {description && (
          <span className="text-th-hi3 text-[10px] leading-relaxed">{description}</span>
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
      <span className="text-th-hi3 text-[11px] w-28 shrink-0">{label}</span>
      <Segmented<T> label={label} value={value} options={options} onChange={onChange} />
    </div>
  );
}
