/**
 * Registry of parametric page generators.
 *
 * A generator turns a small parameter object into however many finished pages
 * it implies — one month or a whole year, one week or fifty-two. Expansion
 * happens at compile time, so the notebook's running order stays a short,
 * editable list instead of hundreds of duplicated entries.
 */
import { themeRef } from '../palette';
import type { Margins, Rect, Size } from '../units';
import type { Op } from '../render/ops';

export type ParamFieldType =
  | 'number'
  | 'text'
  | 'select'
  | 'boolean'
  | 'color'
  | 'stringlist';

export interface ParamOption {
  value: string | number;
  label: string;
}

export interface ParamField {
  key: string;
  label: string;
  type: ParamFieldType;
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  options?: ParamOption[];
  help?: string;
  /** Only shown when another field currently holds one of these values. */
  when?: { key: string; equals: Array<string | number | boolean> };
}

export interface GeneratorContext {
  /** Full trim size of the target page. */
  size: Size;
  /** Drawable area after margins. */
  content: Rect;
  margins: Margins;
}

export interface GeneratedPage {
  label: string;
  ops: Op[];
  /** Set when a generated page should suppress the inherited background. */
  suppressPattern?: boolean;
}

export type SequenceUnit = 'day' | 'week' | 'month' | 'year';

/**
 * Makes a generator *steppable* inside a repeating section.
 *
 * A section like `12 × [monthly calendar, to-do ×2, dot grid ×2]` should walk
 * the calendar forward one month per repeat rather than printing January twelve
 * times. Only the generator knows what "one step" means for its own parameters,
 * so each dated generator supplies that here instead of the compiler
 * special-casing calendars.
 */
export interface GeneratorSequence {
  unit: SequenceUnit;
  /**
   * Parameters for repetition `step`, narrowed to a single unit — a generator
   * that would otherwise emit a whole year must emit exactly one page, or the
   * section would multiply instead of advance.
   */
  advance(params: Record<string, unknown>, step: number): Record<string, unknown>;
  /** Short label for one step, e.g. "March 2026". Used by the editor preview. */
  labelFor(params: Record<string, unknown>, step: number): string;
}

export interface Generator {
  id: string;
  name: string;
  description: string;
  category: 'Calendar' | 'Planning' | 'Notes' | 'Tracking' | 'Creative';
  fields: ParamField[];
  generate(params: Record<string, unknown>, ctx: GeneratorContext): GeneratedPage[];
  /** Present when the generator can advance through a repeating section. */
  sequence?: GeneratorSequence;
}

/* --------------------------------------------------------------- accessors */

/**
 * Parameters for one repetition of a sequenced generator, or the parameters
 * unchanged when the generator cannot be stepped.
 */
export function paramsForStep(
  generator: Generator,
  params: Record<string, unknown>,
  step: number | null
): Record<string, unknown> {
  if (step === null || !generator.sequence) return params;
  // Step 0 still goes through `advance`, because that is what narrows a
  // whole-year generator down to the single page a repetition should produce.
  return generator.sequence.advance(coerceParams(generator, params), step);
}

export const SEQUENCE_UNIT_LABEL: Record<SequenceUnit, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
  year: 'year',
};

export function defaultParams(generator: Generator): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of generator.fields) out[field.key] = field.default;
  return out;
}

/**
 * Coerces stored parameters against the generator's field list, filling in
 * defaults. Parameters come from JSON on disk that a previous app version may
 * have written, so nothing here may assume a value is present or well typed.
 */
export function coerceParams(
  generator: Generator,
  raw: Record<string, unknown> = {}
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of generator.fields) {
    out[field.key] = coerceField(field, raw[field.key]);
  }
  return out;
}

function coerceField(field: ParamField, value: unknown): unknown {
  switch (field.type) {
    case 'number': {
      const n = typeof value === 'string' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return field.default;
      const min = field.min ?? -Infinity;
      const max = field.max ?? Infinity;
      return Math.min(max, Math.max(min, n));
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : field.default;
    case 'select': {
      const allowed = field.options?.map((o) => o.value) ?? [];
      return allowed.includes(value as string | number) ? value : field.default;
    }
    case 'stringlist':
      return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : field.default;
    case 'color':
    case 'text':
      return typeof value === 'string' ? value : field.default;
  }
}

/** Whether a conditional field should be shown for the current parameters. */
export function isFieldVisible(field: ParamField, params: Record<string, unknown>): boolean {
  if (!field.when) return true;
  return field.when.equals.includes(params[field.when.key] as string | number | boolean);
}

/* ------------------------------------------------------------ typed getters */

export const num = (p: Record<string, unknown>, key: string, fallback = 0): number =>
  typeof p[key] === 'number' && Number.isFinite(p[key]) ? (p[key] as number) : fallback;

export const str = (p: Record<string, unknown>, key: string, fallback = ''): string =>
  typeof p[key] === 'string' ? (p[key] as string) : fallback;

export const bool = (p: Record<string, unknown>, key: string, fallback = false): boolean =>
  typeof p[key] === 'boolean' ? (p[key] as boolean) : fallback;

export const list = (p: Record<string, unknown>, key: string, fallback: string[] = []): string[] =>
  Array.isArray(p[key]) ? (p[key] as string[]).filter((v) => typeof v === 'string') : fallback;

/* ------------------------------------------------------- shared field sets */

// Defaulting to palette roles is what makes a generated page follow the
// notebook's colours out of the box; a per-entry override is still just a
// literal colour.
export const accentField: ParamField = {
  key: 'accentColor',
  label: 'Accent colour',
  type: 'color',
  default: themeRef('accent'),
};

export const ruleField: ParamField = {
  key: 'ruleColor',
  label: 'Rule colour',
  type: 'color',
  default: themeRef('secondary'),
};

export const fontField: ParamField = {
  key: 'fontFamily',
  label: 'Typeface',
  type: 'select',
  default: 'helvetica',
  options: [
    { value: 'helvetica', label: 'Sans (Helvetica)' },
    { value: 'times', label: 'Serif (Times)' },
    { value: 'courier', label: 'Mono (Courier)' },
  ],
};

export const weekStartField: ParamField = {
  key: 'weekStart',
  label: 'Week starts on',
  type: 'select',
  default: 1,
  options: [
    { value: 1, label: 'Monday' },
    { value: 0, label: 'Sunday' },
    { value: 6, label: 'Saturday' },
  ],
};

export const commonStyleFields: ParamField[] = [accentField, ruleField, fontField];
