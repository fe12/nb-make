'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/components/ThemeProvider';

export function ThemePicker() {
  const { theme, setThemeId, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

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

  return (
    <div className="relative" ref={container}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Theme: ${theme.name}`}
        className="sketch-pill sketch-border flex items-center gap-1.5 border-ink-300 bg-paper px-2.5 py-1 text-[11.5px] text-ink-600 transition-colors hover:border-ink-400 hover:text-ink-900"
      >
        <Swatches colors={theme.swatch} />
        <span className="hidden sm:inline">{theme.name}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="sketch-box sketch-border absolute right-0 z-50 mt-2 w-52 border-ink-300 bg-paper p-1.5 shadow-[3px_4px_0_rgba(0,0,0,0.10)]"
        >
          <p className="px-2 pb-1.5 pt-1 font-display text-[13px] text-ink-500">Pick a theme</p>
          <ul className="space-y-0.5">
            {themes.map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.id === theme.id}
                  onClick={() => {
                    setThemeId(option.id);
                    setOpen(false);
                  }}
                  className={clsx(
                    'sketch-box flex w-full items-center gap-2 px-2 py-1.5 text-left text-[12px] transition-colors',
                    option.id === theme.id
                      ? 'bg-accent-50 font-medium text-accent-700'
                      : 'text-ink-700 hover:bg-ink-100'
                  )}
                >
                  <Swatches colors={option.swatch} />
                  <span className="flex-1 truncate">{option.name}</span>
                  {option.dark && <span className="text-[9.5px] text-ink-400">dark</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Swatches({ colors }: { colors: [string, string] }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
      {colors.map((color, i) => (
        <span
          key={i}
          className="h-3 w-3 rounded-full border border-ink-300/70"
          style={{ background: color }}
        />
      ))}
    </span>
  );
}
