import { compileLatexDocument, LatexCompileError } from '@/lib/latex/document.server';
import { fail, readJson } from '@/lib/server/http';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

interface Body {
  source?: unknown;
}

/** Compiles a complete .tex document and returns its native PDF. */
export async function POST(request: Request) {
  const body = await readJson<Body>(request);
  if (!body || typeof body.source !== 'string') return fail('Expected a LaTeX source string.');

  try {
    const bytes = await compileLatexDocument(body.source);
    return new Response(bytes as BodyInit, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(bytes.length),
        'Content-Disposition': 'attachment; filename="latex-document.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LaTeX compilation failed.';
    return fail(message, error instanceof LatexCompileError ? 422 : 500);
  }
}
