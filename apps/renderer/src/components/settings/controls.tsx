import { Segmented } from '@nish/ui';

// Settings row layout shared by SettingsModal panels: a row label beside the
// shared Segmented. (On/off rows use @nish/ui's Switch with label/description
// directly; the local Switch and ToggleRow are gone.)

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
      <span className="text-th-hi3 text-[11px] w-28 shrink-0" aria-hidden="true">{label}</span>
      <Segmented<T> label={label} value={value} options={options} onChange={onChange} />
    </div>
  );
}
