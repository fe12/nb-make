/**
 * Environment loading for the CLI scripts.
 *
 * Next loads `.env.local` itself, but `tsx scripts/*.ts` runs outside Next, so
 * the database scripts have to do it themselves.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

let loaded = false;

export function loadEnv(): void {
  if (loaded) return;
  loaded = true;

  // Same precedence Next uses: `.env.local` wins over `.env`.
  for (const file of ['.env.local', '.env']) {
    const path = resolve(process.cwd(), file);
    if (existsSync(path)) config({ path, quiet: true });
  }
}

export interface DbConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: { rejectUnauthorized: boolean };
}

/**
 * Splits SUPABASE_DB_URL into discrete connection fields.
 *
 * Deliberately not `new URL()`. Supabase generates database passwords
 * containing `/`, `?` and `#`, which are structural characters in a URL, so a
 * pasted connection string usually fails to parse -- and when it does parse,
 * the password can be silently truncated at the first `?`. Splitting on the
 * *last* `@` and the first `:` after it avoids the ambiguity, and passing the
 * parts separately means pg never has to decode anything.
 */
export function parseDbUrl(raw: string): DbConnection {
  const withoutScheme = raw.replace(/^postgres(ql)?:\/\//, '');
  const at = withoutScheme.lastIndexOf('@');
  if (at === -1) throw new Error('SUPABASE_DB_URL has no "user:password@host" section.');

  const credentials = withoutScheme.slice(0, at);
  const hostPart = withoutScheme.slice(at + 1);

  const colon = credentials.indexOf(':');
  const user = colon === -1 ? credentials : credentials.slice(0, colon);
  const password = colon === -1 ? '' : credentials.slice(colon + 1);

  // Trailing `?sslmode=...` belongs to the connection, not the database name.
  const [hostPort, pathAndQuery = ''] = splitOnce(hostPart, '/');
  const [hostname, port = '5432'] = splitOnce(hostPort, ':');
  const [database] = splitOnce(pathAndQuery, '?');

  return {
    host: hostname,
    port: Number(port) || 5432,
    user: decodeURIComponent(user),
    // Only decode when it actually looks percent-encoded; a literal `%` in a
    // password would otherwise throw or be mangled.
    password: /%[0-9a-fA-F]{2}/.test(password) ? safeDecode(password) : password,
    database: database || 'postgres',
    // Supabase presents a chain Node has no root for. The connection is still
    // encrypted; only the chain check is relaxed.
    ssl: { rejectUnauthorized: false },
  };
}

const splitOnce = (value: string, separator: string): [string, string?] => {
  const index = value.indexOf(separator);
  return index === -1 ? [value] : [value.slice(0, index), value.slice(index + 1)];
};

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set.\n\n` +
        `Copy .env.example to .env.local and fill it in from your Supabase project\n` +
        `(Project Settings -> Data API, API Keys, and Database).`
    );
  }
  return value;
}
