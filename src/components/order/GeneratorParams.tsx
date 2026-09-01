'use client';

import {
  ColorInput,
  Field,
  NumberInput,
  Select,
  StringListInput,
  TextInput,
  Toggle,
} from '@/components/ui/controls';
import { coerceParams, isFieldVisible, type Generator, type ParamField } from '@/lib/parametric';

/**
 * Renders a generator's parameter form from its field descriptors.
 *
 * Generators declare their parameters rather than shipping bespoke UI, so
 * adding a new one (a moon-phase page, a lab notebook) needs no work here.
 */
export function GeneratorParams({
  generator,
  params,
  onChange,
}: {
  generator: Generator;
  params: Record<string, unknown>;
  onChange: (params: Record<string, unknown>) => void;
}) {
  const values = coerceParams(generator, params);

  const set = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  const visible = generator.fields.filter((field) => isFieldVisible(field, values));

  return (
    <div className="grid gap-2.5 sm:grid-cols-2">
      {visible.map((field) => (
        <div
          key={field.key}
          className={field.type === 'stringlist' || field.type === 'boolean' ? 'sm:col-span-2' : undefined}
        >
          <ParamControl field={field} value={values[field.key]} onChange={(v) => set(field.key, v)} />
        </div>
      ))}
    </div>
  );
}

function ParamControl({
  field,
  value,
  onChange,
}: {
  field: ParamField;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  switch (field.type) {
    case 'boolean':
      return (
        <Toggle
          checked={Boolean(value)}
          onChange={onChange}
          label={field.label}
          hint={field.help}
        />
      );

    case 'number':
      return (
        <Field label={field.label} hint={field.help}>
          <NumberInput
            value={typeof value === 'number' ? value : 0}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            onChange={onChange}
          />
        </Field>
      );

    case 'select':
      return (
        <Field label={field.label} hint={field.help}>
          <Select
            value={String(value)}
            onChange={(event) => {
              // Option values may be numbers (months, week start); restore the
              // original type so downstream comparisons still work.
              const match = field.options?.find((o) => String(o.value) === event.target.value);
              onChange(match ? match.value : event.target.value);
            }}
          >
            {field.options?.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </Select>
        </Field>
      );

    case 'color':
      return (
        <Field label={field.label} hint={field.help}>
          <ColorInput value={typeof value === 'string' ? value : '#000000'} onChange={onChange} />
        </Field>
      );

    case 'stringlist':
      return (
        <Field label={field.label} hint={field.help}>
          <StringListInput
            value={Array.isArray(value) ? (value as string[]) : []}
            onChange={onChange}
          />
        </Field>
      );

    case 'text':
    default:
      return (
        <Field label={field.label} hint={field.help}>
          <TextInput
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(event.target.value)}
          />
        </Field>
      );
  }
}
