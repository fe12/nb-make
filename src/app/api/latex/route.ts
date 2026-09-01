import { renderMathBatch } from '@/lib/latex/mathjax.server';
import { parseLatex } from '@/lib/latex/parse';
import { fail, ok, readJson } from '@/lib/server/http';

export const dynamic = 'force-dynamic';

interface Body {
  /** Explicit formula requests, when the caller has already parsed. */
  requests?: Array<{ key: string; tex: string; display: boolean }>;
  /** Raw LaTeX to parse server-side; convenient for the block editor. */
  source?: string;
}

/**
 * Renders formulas to vector blobs.
 *
 * MathJax is the one part of the pipeline that cannot run in the browser
 * bundle, so the client parses LaTeX locally, discovers which formulas it is
 * missing, and asks for just those. Everything else — wrapping, alignment,
 * page layout — stays client-side and instant.
 */
export async function POST(request: Request) {
  const body = await readJson<Body>(request);
  if (!body) return fail('Expected a JSON body');

  let requests = body.requests ?? [];

  if (body.source !== undefined) {
    const doc = parseLatex(body.source);
    requests = [
      ...requests,
      ...doc.mathKeys.map((key) => ({ key, ...doc.formulas[key] })),
    ];
  }

  if (requests.length === 0) return ok({ blobs: {}, errors: {} });
  if (requests.length > 500) return fail('Too many formulas in one request');

  const safe = requests
    .filter((r) => typeof r?.key === 'string' && typeof r?.tex === 'string')
    .map((r) => ({ key: r.key, tex: r.tex.slice(0, 20000), display: Boolean(r.display) }));

  return ok(renderMathBatch(safe));
}
