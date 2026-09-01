import { NextResponse } from 'next/server';

export const ok = <T>(data: T, init?: ResponseInit): NextResponse =>
  NextResponse.json(data, init);

export const fail = (message: string, status = 400): NextResponse =>
  NextResponse.json({ error: message }, { status });

export const notFound = (what = 'Resource'): NextResponse =>
  fail(`${what} not found`, 404);

/** Parses a JSON body, returning null rather than throwing on malformed input. */
export async function readJson<T = unknown>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
