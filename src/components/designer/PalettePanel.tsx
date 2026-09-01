'use client';

import clsx from 'clsx';
import { ColorInput, Field, Panel } from '@/components/ui/controls';
import { useNotebook } from '@/lib/client/store';
import {
  PALETTE_PRESETS,
  PALETTE_ROLES,
  ROLE_HINTS,
  ROLE_LABELS,
  type NotebookPalette,
} from '@/lib/palette';

/**
 * Edits the palette the whole notebook is drawn with.
 *
 * Anything that references a role — rulings, blocks, generated pages — repaints
 * the moment a swatch changes here, because references are only resolved when a
 * page is compiled.
 */
export function PalettePanel() {
  const { notebook, update } = useNotebook();
  const palette = notebook.palette;

  const setPalette = (next: NotebookPalette) =>
    update((draft) => ({ ...draft, palette: next }));

  const activePreset = PALETTE_PRESETS.find((preset) =>
    PALETTE_ROLES.every((role) => preset.palette[role] === palette[role])
  );

  return (
    <Panel
      title="Notebook colours"
      description="Used by every page, including the generated ones."
    >
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PALETTE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.name}
              onClick={() => setPalette(preset.palette)}
              className={clsx(
                'sketch-pill flex items-center gap-1 border-[1.5px] px-1.5 py-1 transition-colors',
                activePreset?.id === preset.id
                  ? 'border-accent-500 bg-accent-50'
                  : 'border-ink-200 bg-paper hover:border-ink-400'
              )}
            >
              <span className="flex" aria-hidden>
                {PALETTE_ROLES.map((role) => (
                  <span
                    key={role}
                    className="h-3.5 w-2 first:rounded-l-sm last:rounded-r-sm"
                    style={{ background: preset.palette[role] }}
                  />
                ))}
              </span>
              <span className="text-[10.5px] text-ink-600">{preset.name}</span>
            </button>
          ))}
        </div>

        <div className="space-y-2 border-t-2 border-dashed border-ink-200 pt-3">
          {PALETTE_ROLES.map((role) => (
            <Field key={role} label={ROLE_LABELS[role]} hint={ROLE_HINTS[role]}>
              <ColorInput
                plain
                value={palette[role]}
                onChange={(value) => setPalette({ ...palette, [role]: value })}
              />
            </Field>
          ))}
        </div>

        <p className="text-[10.5px] leading-relaxed text-ink-400">
          Any colour control elsewhere can point at one of these roles instead of a fixed colour —
          those follow the palette. Pick a custom colour to opt a single spot out.
        </p>
      </div>
    </Panel>
  );
}
