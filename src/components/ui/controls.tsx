'use client';

import clsx from 'clsx';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { usePalette } from '@/lib/client/palette-context';
import {
  PALETTE_ROLES,
  ROLE_HINTS,
  ROLE_LABELS,
  isThemeRef,
  resolveColor,
  roleOf,
  themeRef,
} from '@/lib/palette';

/* ----------------------------------------------------------------- Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'sketch-border border-ink-800 bg-accent-600 text-accent-ink shadow-[2px_2px_0_var(--nb-ink-800)] ' +
    'hover:-translate-y-px hover:shadow-[3px_3px_0_var(--nb-ink-800)] active:translate-y-0 ' +
    'disabled:border-ink-300 disabled:bg-ink-300 disabled:text-ink-100 disabled:shadow-none',
  secondary:
    'sketch-border border-ink-400 bg-paper text-ink-800 ' +
    'shadow-[2px_2px_0_color-mix(in_srgb,var(--nb-ink-400)_50%,transparent)] ' +
    'hover:-translate-y-px hover:border-ink-600 active:translate-y-0 active:shadow-none ' +
    'disabled:border-ink-200 disabled:text-ink-400 disabled:shadow-none',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-900 disabled:text-ink-300',
  danger:
    'sketch-border border-danger-600 bg-danger-500 text-white shadow-[2px_2px_0_var(--nb-danger-600)] ' +
    'hover:-translate-y-px active:translate-y-0 active:shadow-none ' +
    'disabled:border-ink-300 disabled:bg-ink-300 disabled:shadow-none',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type="button"
      className={clsx(
        'sketch-pill inline-flex items-center justify-center gap-1.5 font-medium transition-all',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'disabled:cursor-not-allowed disabled:transform-none',
        size === 'sm' ? 'h-7 px-3 text-xs' : 'h-9 px-4 text-[13px]',
        BUTTON_VARIANTS[variant],
        className
      )}
      {...props}
    />
  );
}

/* ------------------------------------------------------------ layout bits */

export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('sketch-card', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b-2 border-dashed border-ink-200 px-3.5 py-2.5">
          <div className="min-w-0">
            {title && (
              <h2 className="truncate font-display text-[17px] leading-tight text-ink-900">
                {title}
              </h2>
            )}
            {description && (
              <p className="mt-0.5 text-[11px] leading-snug text-ink-500">{description}</p>
            )}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={clsx('p-3.5', bodyClassName)}>{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  inline,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  inline?: boolean;
  className?: string;
}) {
  return (
    <label
      className={clsx(
        'block',
        inline ? 'flex items-center justify-between gap-3' : 'space-y-1',
        className
      )}
    >
      <span className="block text-[11.5px] font-semibold text-ink-600">{label}</span>
      <div className={inline ? 'shrink-0' : undefined}>{children}</div>
      {hint && !inline && <span className="block text-[10.5px] text-ink-400">{hint}</span>}
    </label>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 font-display text-[14px] tracking-wide text-ink-500">
      {children}
    </div>
  );
}

const INPUT_CLASS =
  'sketch-box sketch-border w-full border-ink-300 bg-paper px-2.5 py-1.5 text-[13px] text-ink-900 ' +
  'placeholder:text-ink-400 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/25 ' +
  'disabled:bg-ink-100 disabled:text-ink-400';

export function TextInput({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className={clsx(INPUT_CLASS, className)} {...props} />;
}

export function TextArea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(INPUT_CLASS, 'resize-y', className)} {...props} />;
}

export function Select({
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={clsx(INPUT_CLASS, 'cursor-pointer pr-7', className)} {...props}>
      {children}
    </select>
  );
}

/* ------------------------------------------------------------ NumberInput */

/**
 * Number field that keeps the user's raw keystrokes while they type.
 *
 * Committing on every keypress makes it impossible to type "0.5" (the leading
 * "0." parses to 0 and gets written back), so the text is held locally and only
 * parsed on change, with the canonical value restored on blur.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  className,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(formatNumber(value));
  }, [value]);

  const commit = (raw: string) => {
    const parsed = Number(raw);
    if (raw.trim() === '' || !Number.isFinite(parsed)) return;
    let next = parsed;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onChange(next);
  };

  return (
    <div className={clsx('relative', className)}>
      <input
        type="number"
        inputMode="decimal"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          commit(event.target.value);
        }}
        onBlur={() => {
          focused.current = false;
          setDraft(formatNumber(value));
        }}
        className={clsx(INPUT_CLASS, suffix && 'pr-8')}
      />
      {suffix && (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] text-ink-400">
          {suffix}
        </span>
      )}
    </div>
  );
}

const formatNumber = (n: number): string => String(Math.round(n * 1000) / 1000);

/* ----------------------------------------------------------------- Slider */

export function Slider({
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-ink-200"
      />
      <div className="w-16 shrink-0">
        <NumberInput value={value} onChange={onChange} min={min} max={max} step={step} suffix={suffix} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ ColorInput */

/**
 * A colour control that offers the notebook's palette first and a custom colour
 * second.
 *
 * Choosing a palette colour stores a *reference* (`theme:accent`) rather than
 * the hex it currently resolves to — that is what lets re-theming a notebook
 * repaint every page that used it. Choosing a custom colour stores the literal
 * and opts that one spot out of the palette.
 */
export function ColorInput({
  value,
  onChange,
  allowNone,
  onClear,
  plain,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Adds a "no colour" choice, for optional fills. */
  allowNone?: boolean;
  onClear?: () => void;
  /**
   * Literal colours only. Used when editing the palette itself, where offering
   * palette roles as choices would just be circular.
   */
  plain?: boolean;
}) {
  const palette = usePalette();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const role = plain ? null : roleOf(value);
  const resolved = resolveColor(value, palette);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (plain) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-9 shrink-0 rounded"
          aria-label="Colour"
        />
        <TextInput
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="font-mono text-[11px]"
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="sketch-box sketch-border flex w-full items-center gap-2 border-ink-300 bg-paper px-2 py-1 text-left transition-colors hover:border-ink-400"
      >
        <span
          className="h-5 w-5 shrink-0 rounded border border-ink-400"
          style={{ background: resolved }}
        />
        <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-700">
          {role ? ROLE_LABELS[role] : resolved}
        </span>
        {role && (
          <span className="shrink-0 rounded bg-accent-50 px-1 py-0.5 text-[8.5px] font-semibold uppercase tracking-wide text-accent-700">
            theme
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          className="sketch-box sketch-border absolute left-0 z-50 mt-1.5 w-60 border-ink-400 bg-paper p-2.5 shadow-[4px_5px_0_color-mix(in_srgb,var(--nb-ink-500)_30%,transparent)]"
        >
          <p className="mb-1.5 font-display text-[14px] text-ink-600">Notebook colours</p>
          <div className="mb-3 grid grid-cols-4 gap-1.5">
            {PALETTE_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                title={`${ROLE_LABELS[r]} — ${ROLE_HINTS[r]}`}
                onClick={() => {
                  onChange(themeRef(r));
                  setOpen(false);
                }}
                className={clsx(
                  'flex flex-col items-center gap-1 rounded p-1 transition-colors',
                  role === r ? 'bg-accent-50 ring-1 ring-accent-500' : 'hover:bg-ink-100'
                )}
              >
                <span
                  className="h-7 w-full rounded border border-ink-400"
                  style={{ background: palette[r] }}
                />
                <span className="text-[8.5px] leading-tight text-ink-500">{ROLE_LABELS[r]}</span>
              </button>
            ))}
          </div>

          <p className="mb-1.5 font-display text-[14px] text-ink-600">Custom colour</p>
          <div className="flex items-center gap-1.5">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(resolved) ? resolved : '#000000'}
              onChange={(event) => onChange(event.target.value)}
              className="h-8 w-10 shrink-0 rounded"
              aria-label="Custom colour"
            />
            <TextInput
              value={isThemeRef(value) ? resolved : value}
              onChange={(event) => onChange(event.target.value)}
              className="h-8 font-mono text-[11px]"
              spellCheck={false}
            />
          </div>

          {allowNone && onClear && (
            <button
              type="button"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
              className="mt-2 w-full rounded px-2 py-1 text-[11.5px] text-ink-500 hover:bg-ink-100 hover:text-ink-800"
            >
              No colour
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Toggle */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={clsx(
        'flex cursor-pointer items-start gap-2.5 select-none',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-4 w-7 shrink-0 rounded-full border border-ink-400 transition-colors',
          checked ? 'bg-accent-600' : 'bg-ink-200'
        )}
      >
        {/*
          Pinned with an explicit `left` rather than a translate: an absolutely
          positioned element with `left: auto` falls back to its static
          position, and a <button> centres its content — which pushed the knob
          to the right of the track in both states.
        */}
        <span
          className={clsx(
            'absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border border-ink-400/40',
            'bg-white shadow-sm transition-[left] duration-150',
            checked ? 'left-[12px]' : 'left-0.5'
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-[12px] leading-tight text-ink-800">{label}</span>
        {hint && <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-400">{hint}</span>}
      </span>
    </label>
  );
}

/* ---------------------------------------------------------- SegmentedControl */

export function Segmented<T extends string | number>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'sketch-pill sketch-border inline-flex w-full border-ink-300 bg-ink-100 p-0.5',
        className
      )}
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          title={option.title}
          onClick={() => onChange(option.value)}
          className={clsx(
            'sketch-pill flex-1 truncate px-2 py-1 text-[11.5px] font-medium transition-colors',
            option.value === value
              ? 'bg-paper text-ink-900 shadow-[1px_1px_0_color-mix(in_srgb,var(--nb-ink-400)_45%,transparent)]'
              : 'text-ink-500 hover:text-ink-800'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- StringListInput */

/** Edits a list of short strings — habit names, kanban columns, and so on. */
export function StringListInput({
  value,
  onChange,
  placeholder = 'Add an item',
  max = 40,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  max?: number;
}) {
  const [draft, setDraft] = useState('');

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed || value.length >= max) return;
    onChange([...value, trimmed]);
    setDraft('');
  };

  return (
    <div className="space-y-1.5">
      {value.length > 0 && (
        <ul className="space-y-1">
          {value.map((item, index) => (
            <li key={`${item}-${index}`} className="flex items-center gap-1">
              <TextInput
                value={item}
                onChange={(event) => {
                  const next = [...value];
                  next[index] = event.target.value;
                  onChange(next);
                }}
                className="h-7 py-0.5 text-[12px]"
              />
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
                className="shrink-0 px-1.5"
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1">
        <TextInput
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          className="h-7 py-0.5 text-[12px]"
        />
        <Button size="sm" onClick={add} disabled={!draft.trim()} className="shrink-0">
          Add
        </Button>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- Modal */

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div
        className="fixed inset-0 bg-ink-900/25 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={clsx(
          'sketch-box sketch-border relative z-10 w-full border-ink-400 bg-paper',
          'shadow-[5px_6px_0_color-mix(in_srgb,var(--nb-ink-500)_35%,transparent)]',
          width
        )}
      >
        <header className="border-b-2 border-dashed border-ink-200 px-5 py-3.5">
          <h2 id={titleId} className="font-display text-[21px] leading-tight text-ink-900">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t-2 border-dashed border-ink-200 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- feedback */

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="sketch-box border-2 border-dashed border-ink-300 bg-ink-50/60 px-6 py-10 text-center">
      <p className="font-display text-[19px] text-ink-700">{title}</p>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-500">{description}</p>
      )}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Notice({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warn' | 'error';
  children: ReactNode;
}) {
  return (
    <div
      className={clsx(
        'sketch-box border-[1.5px] px-3 py-2 text-[11.5px] leading-relaxed',
        tone === 'info' && 'border-accent-100 bg-accent-50 text-accent-700',
        tone === 'warn' && 'border-amber-200 bg-amber-50 text-amber-800',
        tone === 'error' && 'border-danger-100 bg-danger-100/60 text-danger-600'
      )}
    >
      {children}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={clsx(
        'inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent',
        className
      )}
      aria-hidden
    />
  );
}
