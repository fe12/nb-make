/**
 * The only things the server still does.
 *
 * Notebooks and images live in the browser (see `storage.ts`); the server is a
 * stateless renderer for the two things a browser cannot do — MathJax and a
 * real TeX engine.
 */
import type { MathBlob } from '../latex/types';

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => null);
    throw new Error(detail ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export const api = {
  renderMath: (requests: Array<{ key: string; tex: string; display: boolean }>) =>
    request<{ blobs: Record<string, MathBlob>; errors: Record<string, string> }>('/api/latex', {
      method: 'POST',
      body: JSON.stringify({ requests }),
    }),

  /** Compiles a complete .tex document and returns its native PDF bytes. */
  async compileLatexDocument(source: string): Promise<Uint8Array> {
    const response = await fetch('/api/latex/document', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    if (!response.ok) {
      const detail = await response
        .json()
        .then((body: { error?: string }) => body.error)
        .catch(() => null);
      throw new Error(detail ?? `LaTeX compilation failed (${response.status})`);
    }
    return new Uint8Array(await response.arrayBuffer());
  },
};
