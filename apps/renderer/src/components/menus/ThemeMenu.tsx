import { useState, useEffect, useRef } from 'react';
import { Palette, ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore';
import type { CustomColors, SavedCustomTheme } from '../../store/themeStore';
import { CUSTOM_THEME, THEMES, THEME_PRESETS } from '../../themes';
import { parseHex } from '../../lib/colorUtils';
import {
  MenuPopover, MenuTrigger,
  SubmenuHeader, SaveAsForm, SavedItemRow, deleteBody,
} from './primitives';
import { ConfirmDialog, IconButton, ThemeToggle, cn, Label } from '@nish/ui';
import { Input, menuRowClass } from '../nishGaps';

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
      <span className="text-th-hi3 text-3xs w-[58px] shrink-0 leading-none">{label}</span>

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
      <Input
        size="xs"
        type="text"
        value={text}
        invalid={error}
        onChange={(e) => { setText(e.target.value); setError(false); }}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
        placeholder="#rrggbb"
        aria-label={`${label} color`}
        spellCheck={false}
        className="flex-1 h-6 text-3xs font-mono"
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
        <IconButton label="Back" size="xs" onClick={onBack} className="size-5 -ml-0.5">
          <ArrowLeft size={12} />
        </IconButton>
        <span className="text-th-hi text-2xs font-semibold">
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

      <p className="text-th-hi3 text-3xs leading-tight -mt-1">
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
  const triggerRef = useRef<HTMLButtonElement>(null);

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
    <div className="app-region-no-drag">
      <MenuTrigger
        ref={triggerRef}
        compact={compact}
        open={open}
        name="Themes"
        icon={(size) => <Palette size={size} />}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={handleToggle}
        extra={
          <span
            aria-hidden="true"
            className={compact
              ? 'absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-th-bg'
              : 'h-2 w-2 rounded-full shrink-0 ring-1 ring-th-line'}
            style={{ background: activeSwatch }}
          />
        }
      />

      <MenuPopover
        open={open}
        onOpenChange={(next) => { if (!next) handleClose(); }}
        anchor={triggerRef}
        label="Themes"
        className={cn('min-w-[220px] max-h-[calc(100vh-48px)] overflow-y-auto', panel !== 'list' && 'min-w-[248px]')}
      >
        {/* ── Mode switch + preset list ── */}
        {panel === 'list' && (
          <>
            <div className="px-2 pt-1 pb-2">
              <ThemeToggle labels block />
            </div>
            <Label className="block px-3 pt-1 pb-0.5 text-3xs">Presets</Label>
            {[...THEME_PRESETS, CUSTOM_THEME].map((t) => {
              const swatch = t.id === 'custom' ? customColors.primary : t.swatch;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-current={theme === t.id || undefined}
                  onClick={() => {
                    if (t.id === 'custom') {
                      setTheme('custom');
                      setPanel('custom-list');
                    } else {
                      setTheme(t.id);
                      handleClose();
                    }
                  }}
                  className={cn(menuRowClass(theme === t.id), 'gap-2.5')}
                >
                  <span
                    className="h-3 w-3 rounded-full shrink-0 ring-1 ring-th-line-strong"
                    style={{ background: swatch }}
                  />
                  {t.name}
                  {t.id === 'custom' && (
                    <ChevronRight size={10} className="ml-auto text-th-hi3" />
                  )}
                </button>
              );
            })}
          </>
        )}

        {/* ── Custom themes submenu ── */}
        {panel === 'custom-list' && (
          <>
            <SubmenuHeader label="Custom Themes" onBack={() => setPanel('list')} />

            {/* Create new — always first */}
            <button
              type="button"
              onClick={() => setPanel('editor')}
              className={cn(menuRowClass(), 'mt-0.5')}
            >
              <Plus size={11} className="shrink-0" />
              Create new
            </button>

            {/* Divider + saved themes */}
            {savedCustomThemes.length > 0 && (
              <>
                <div role="separator" className="h-px bg-th-line mx-3 my-1" />
                {savedCustomThemes.map((t) => (
                  <SavedItemRow
                    key={t.id}
                    name={t.name}
                    active={activeCustomId === t.id && theme === 'custom'}
                    icon={
                      <span
                        className="h-3 w-3 rounded-full shrink-0 ring-1 ring-th-line-strong"
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
      </MenuPopover>

      {/* Delete confirmation modal — rendered over everything */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete theme?"
          body={deleteBody(deleteTarget.name)}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
