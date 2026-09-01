'use client';

import { Field, NumberInput, Segmented, Select } from '@/components/ui/controls';
import {
  PAGE_SIZE_NAMES,
  PAPER_SIZES,
  resolvePageSize,
  type PageSizeSpec,
  type PaperName,
} from '@/lib/units';

export function PageSizePicker({
  value,
  onChange,
  label = 'Page size',
  disabled,
}: {
  value: PageSizeSpec;
  onChange: (value: PageSizeSpec) => void;
  label?: string;
  disabled?: boolean;
}) {
  const resolved = resolvePageSize(value);

  return (
    <div className="space-y-2">
      <Field label={label}>
        <Select
          value={value.name}
          disabled={disabled}
          onChange={(event) => {
            const name = event.target.value as PageSizeSpec['name'];
            // Seed custom dimensions from whatever was showing, so switching to
            // Custom never snaps the page to an unrelated size.
            const base = name === 'Custom' ? resolved : PAPER_SIZES[name as PaperName];
            onChange({ ...value, name, width: base.w, height: base.h });
          }}
        >
          {PAGE_SIZE_NAMES.map((name) => (
            <option key={name} value={name}>
              {name === 'Custom'
                ? 'Custom…'
                : `${name} — ${PAPER_SIZES[name as PaperName].w} × ${PAPER_SIZES[name as PaperName].h} mm`}
            </option>
          ))}
        </Select>
      </Field>

      <Segmented
        value={value.orientation}
        onChange={(orientation) => onChange({ ...value, orientation })}
        options={[
          { value: 'portrait', label: 'Portrait' },
          { value: 'landscape', label: 'Landscape' },
        ]}
      />

      {value.name === 'Custom' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width">
            <NumberInput
              value={value.width}
              min={10}
              max={2000}
              step={1}
              suffix="mm"
              onChange={(width) => onChange({ ...value, width })}
            />
          </Field>
          <Field label="Height">
            <NumberInput
              value={value.height}
              min={10}
              max={2000}
              step={1}
              suffix="mm"
              onChange={(height) => onChange({ ...value, height })}
            />
          </Field>
        </div>
      )}

      <p className="text-[10.5px] text-ink-400">
        Renders at {round(resolved.w)} × {round(resolved.h)} mm
      </p>
    </div>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;
