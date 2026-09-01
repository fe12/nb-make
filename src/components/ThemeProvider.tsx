'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { readSettings, writeSettings } from '@/lib/client/storage';
import { DEFAULT_THEME_ID, THEMES, getTheme, type Theme } from '@/lib/themes';

interface ThemeStore {
  theme: Theme;
  setThemeId: (id: string) => void;
  themes: Theme[];
}

const Context = createContext<ThemeStore | null>(null);

export function useTheme(): ThemeStore {
  const store = useContext(Context);
  if (!store) throw new Error('useTheme must be used inside <ThemeProvider>');
  return store;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The server has no access to the stored preference, so the first paint is
  // always the default; the effect below swaps it in before anything is read.
  const [themeId, setThemeIdState] = useState(DEFAULT_THEME_ID);

  useEffect(() => {
    setThemeIdState(readSettings().themeId);
  }, []);

  useEffect(() => {
    const theme = getTheme(themeId);
    const root = document.documentElement;
    for (const [name, value] of Object.entries(theme.vars)) {
      root.style.setProperty(name, value);
    }
    root.dataset.theme = theme.id;
    root.style.colorScheme = theme.dark ? 'dark' : 'light';
  }, [themeId]);

  const setThemeId = useCallback((id: string) => {
    setThemeIdState(id);
    writeSettings({ ...readSettings(), themeId: id });
  }, []);

  const value = useMemo<ThemeStore>(
    () => ({ theme: getTheme(themeId), setThemeId, themes: THEMES }),
    [themeId, setThemeId]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}
