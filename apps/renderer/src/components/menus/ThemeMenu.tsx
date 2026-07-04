import { useState, useEffect } from 'react';
import { Palette, ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore';
import type { CustomColors, SavedCustomTheme } from '../../store/themeStore';
import { THEMES } from '../../themes';
import { parseHex } from '../../lib/colorUtils';
import { cn } from '../../lib/utils';
import {
  Backdrop, menuBtn, menuPanel, noDragStyle,
  SubmenuHeader, SaveAsForm, SavedItemRow, ConfirmDeleteDialog,
} from './primitives';

// ── ColorPicker ───────────────────────────────────────────────────────────────

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;   // '#rrggbb'
  onChange: (hex: string) => void;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState(false);

  // Sync text field when value changes externally (e.g. native color picker)
  useEffect(() => { setText(value); }, [value]);

  function commit(raw: string) {
    const parsed = parseHex(raw);
    if (parsed) {
      setError(false);
      setText(parsed);
      onChange(parsed);
    } else {
      setError(true);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-th-3 text-[10px] w-[58px] shrink-0 leading-none">{label}</span>

      {/* Native color picker visually replaced by a styled swatch */}
      <label
        className="h-5 w-5 rounded shrink-0 cursor-pointer ring-1 ring-th-line overflow-hidden relative"
        style={{ background: value }}
        title="Pick a colour"
      >
        <input
          type="color"
          value={value}
          onChange={(e) => {
            const hex = e.target.value;
            onChange(hex);
            setText(hex);
            setError(false);
          }}
          className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
        />
      </label>

      {/* Hex / rgb text input */}
      <input
        type="text"
        value={text}
        onChange={(e) => { setText(e.target.value); setError(false); }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
        placeholder="#rrggbb"
        spellCheck={false}
        className={cn(
          'flex-1 bg-th-elevated border rounded px-2 py-0.5 text-[10px] font-mono text-th-hi',
          'placeholder:text-th-ghost focus:outline-none transition-colors',
          error ? 'border-red-400' : 'border-th-line focus:border-th-3',
        )}
      />
    </div>
  );
}

// ── Custom color editor ───────────────────────────────────────────────────────

function CustomEditor({
  colors,
  onChange,
  onBack,
  onSave,
  editTarget,
  onUpdate,
}: {
  colors: CustomColors;
  onChange: (c: CustomColors) => void;
  onBack: () => void;
  onSave: (name: string) => void;
  editTarget?: SavedCustomTheme;
  onUpdate: () => void;
}) {
  return (
    <div className="px-3 py-2 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={onBack}
          className="text-th-ghost hover:text-th-hi transition-colors p-0.5 -ml-0.5"
        >
          <ArrowLeft size={12} />
        </button>
        <span className="text-th-hi text-[11px] font-semibold">
          {editTarget ? `Edit "${editTarget.name}"` : 'Custom Theme'}
        </span>
      </div>

      {/* Color pickers */}
      <div className="flex flex-col gap-2.5">
        <ColorPicker
          label="Background"
          value={colors.primary}
          onChange={(v) => onChange({ ...colors, primary: v })}
        />
        <ColorPicker
          label="Cards"
          value={colors.secondary}
          onChange={(v) => onChange({ ...colors, secondary: v })}
        />
        <ColorPicker
          label="Borders"
          value={colors.tertiary}
          onChange={(v) => onChange({ ...colors, tertiary: v })}
        />
        <ColorPicker
          label="Text"
          value={colors.text}
          onChange={(v) => onChange({ ...colors, text: v })}
        />
      </div>

      <SaveAsForm
        isEdit={!!editTarget}
        placeholder="Theme name…"
        onSave={onSave}
        onUpdate={onUpdate}
      />

      <p className="text-th-ghost text-[9px] leading-tight -mt-1">
        Semantic colors (stocks, hardware) are preserved.
      </p>
    </div>
  );
}

// ── Theme menu ────────────────────────────────────────────────────────────────

type ThemePanel = 'list' | 'custom-list' | 'editor';

export function ThemeMenu({ compact }: { compact: boolean }) {
  const {
    theme, customColors, savedCustomThemes, activeCustomId,
    setTheme, setCustomColors, saveCustomTheme, deleteCustomTheme, applyCustomTheme, updateCustomTheme,
  } = useThemeStore();

  const [open, setOpen]                 = useState(false);
  const [panel, setPanel]               = useState<ThemePanel>('list');
  const [deleteTarget, setDeleteTarget] = useState<SavedCustomTheme | null>(null);
  const [editTarget, setEditTarget]     = useState<SavedCustomTheme | null>(null);

  // Swatch for the button: use primary color when custom is active
  const activeSwatch =
    theme === 'custom'
      ? customColors.primary
      : (THEMES.find((t) => t.id === theme) ?? THEMES[0]).swatch;

  function handleClose() {
    setOpen(false);
    setPanel('list');
    setEditTarget(null);
  }

  function handleToggle() {
    if (open) {
      handleClose();
    } else {
      setOpen(true);
      // If custom is active, open straight to the saved-themes list
      setPanel(theme === 'custom' ? 'custom-list' : 'list');
    }
  }

  function handleConfirmDelete() {
    if (!deleteTarget) return;
    deleteCustomTheme(deleteTarget.id);
    setDeleteTarget(null);
  }

  function handleSaveTheme(name: string) {
    saveCustomTheme(name);
    setPanel('custom-list');
  }

  return (
    <div className="relative" style={noDragStyle}>
      <button onClick={handleToggle} className={cn(menuBtn(open, compact), compact && 'relative')} title="Themes">
        <Palette size={compact ? 13 : 11} />
        {!compact && 'Themes'}
        <span
          className={compact
            ? 'absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-th-bar'
            : 'h-2 w-2 rounded-full shrink-0 ring-1 ring-th-line'}
          style={{ background: activeSwatch }}
        />
      </button>

      {open && (
        <>
          <Backdrop onClose={handleClose} />

          <div
            className={cn(menuPanel, panel !== 'list' && 'min-w-[248px]')}
            style={noDragStyle}
          >
            {/* ── Main theme list ── */}
            {panel === 'list' && THEMES.map((t) => {
              const swatch = t.id === 'custom' ? customColors.primary : t.swatch;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    if (t.id === 'custom') {
                      setTheme('custom');
                      setPanel('custom-list');
                    } else {
                      setTheme(t.id);
                      handleClose();
                    }
                  }}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-1.5 text-[11px] transition-colors',
                    theme === t.id
                      ? 'text-th-hi bg-th-elevated'
                      : 'text-th-2 hover:text-th-hi hover:bg-th-elevated/60',
                  )}
                >
                  <span
                    className="h-3 w-3 rounded-full shrink-0 ring-1 ring-white/10"
                    style={{ background: swatch }}
                  />
                  {t.name}
                  {t.id === 'custom' && (
                    <ChevronRight size={10} className="ml-auto text-th-ghost" />
                  )}
                </button>
              );
            })}

            {/* ── Custom themes submenu ── */}
            {panel === 'custom-list' && (
              <>
                <SubmenuHeader label="Custom Themes" onBack={() => setPanel('list')} />

                {/* Create new — always first */}
                <button
                  onClick={() => setPanel('editor')}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-th-2 hover:text-th-hi hover:bg-th-elevated/60 transition-colors mt-0.5"
                >
                  <Plus size={11} className="shrink-0" />
                  Create new
                </button>

                {/* Divider + saved themes */}
                {savedCustomThemes.length > 0 && (
                  <>
                    <div className="h-px bg-th-line mx-3 my-1" />
                    {savedCustomThemes.map((t) => (
                      <SavedItemRow
                        key={t.id}
                        name={t.name}
                        active={activeCustomId === t.id && theme === 'custom'}
                        icon={
                          <span
                            className="h-3 w-3 rounded-full shrink-0 ring-1 ring-white/10"
                            style={{ background: t.colors.primary }}
                          />
                        }
                        onApply={() => { applyCustomTheme(t.id); setEditTarget(t); setPanel('editor'); }}
                        onDelete={() => setDeleteTarget(t)}
                      />
                    ))}
                  </>
                )}
              </>
            )}

            {/* ── Color editor ── */}
            {panel === 'editor' && (
              <CustomEditor
                colors={customColors}
                onChange={(colors) => {
                  setCustomColors(colors);
                  setTheme('custom');
                }}
                onBack={() => { setPanel('custom-list'); setEditTarget(null); }}
                onSave={handleSaveTheme}
                editTarget={editTarget ?? undefined}
                onUpdate={() => {
                  updateCustomTheme(editTarget!.id);
                  setEditTarget(null);
                  setPanel('custom-list');
                }}
              />
            )}
          </div>

          {/* Delete confirmation modal — rendered over everything */}
          {deleteTarget && (
            <ConfirmDeleteDialog
              kind="theme"
              name={deleteTarget.name}
              onConfirm={handleConfirmDelete}
              onCancel={() => setDeleteTarget(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
