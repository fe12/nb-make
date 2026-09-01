'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_PALETTE, type NotebookPalette } from '../palette';

/**
 * Makes the open notebook's palette reachable from any colour control.
 *
 * It defaults rather than throwing when no notebook is open, so shared controls
 * stay usable on the dashboard and in modals outside the editor.
 */
const Context = createContext<NotebookPalette>(DEFAULT_PALETTE);

export const usePalette = (): NotebookPalette => useContext(Context);

export function PaletteProvider({
  palette,
  children,
}: {
  palette: NotebookPalette;
  children: ReactNode;
}) {
  return <Context.Provider value={palette}>{children}</Context.Provider>;
}
