'use client';

import clsx from 'clsx';

/**
 * Star rating, read-only or interactive.
 *
 * Interactive mode is a radio group rather than a row of buttons, so it is
 * reachable with the arrow keys and announces itself as a single control with
 * one chosen value.
 */
export function Stars({
  value,
  size = 16,
  onChange,
  name = 'rating',
}: {
  value: number;
  size?: number;
  onChange?: (rating: number) => void;
  name?: string;
}) {
  if (!onChange) {
    return (
      <span
        className="inline-flex gap-0.5"
        role="img"
        aria-label={value > 0 ? `${value.toFixed(1)} out of 5` : 'Not yet rated'}
      >
        {[1, 2, 3, 4, 5].map((index) => (
          <Star key={index} fill={fillFor(value, index)} size={size} />
        ))}
      </span>
    );
  }

  return (
    <span role="radiogroup" aria-label="Your rating" className="inline-flex gap-0.5">
      {[1, 2, 3, 4, 5].map((index) => (
        <label
          key={index}
          className="cursor-pointer"
          title={`${index} star${index === 1 ? '' : 's'}`}
        >
          <input
            type="radio"
            name={name}
            value={index}
            checked={Math.round(value) === index}
            onChange={() => onChange(index)}
            className="sr-only peer"
          />
          <span className="block rounded peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent-500">
            <Star fill={index <= Math.round(value) ? 1 : 0} size={size} interactive />
          </span>
        </label>
      ))}
    </span>
  );
}

/** 0, 1, or the fraction for the one star a non-integer average lands inside. */
function fillFor(value: number, index: number): number {
  if (value >= index) return 1;
  if (value <= index - 1) return 0;
  return value - (index - 1);
}

function Star({
  fill,
  size,
  interactive,
}: {
  fill: number;
  size: number;
  interactive?: boolean;
}) {
  // A per-star gradient id would collide across instances, so partial fills use
  // a clip rectangle over a second, overlaid star instead.
  return (
    <span
      className={clsx('relative inline-block align-middle', interactive && 'hover:scale-110 transition-transform')}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Glyph size={size} className="text-ink-300" />
      {fill > 0 && (
        <span
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${fill * 100}%` }}
        >
          <Glyph size={size} className="text-accent-500" />
        </span>
      )}
    </span>
  );
}

function Glyph({ size, className }: { size: number; className: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      className={clsx('absolute inset-0', className)}
    >
      <path d="M10 1.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L10 14.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z" />
    </svg>
  );
}
