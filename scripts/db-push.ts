/**
 * Applies supabase/schema.sql to the database in SUPABASE_DB_URL.
 *
 * Uses a direct Postgres connection rather than the Supabase CLI so that
 * setting the project up needs nothing beyond `npm install` -- no CLI to
 * install, no project to link, no Docker.
 *
 *   npm run db:push
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { loadEnv, parseDbUrl, requireEnv } from './env';

async function main() {
  loadEnv();
  const connection = parseDbUrl(requireEnv('SUPABASE_DB_URL'));
  const file = resolve(process.cwd(), 'supabase/schema.sql');
  const sql = readFileSync(file, 'utf8');

  const client = new Client(connection);

  console.log(`Connecting to ${connection.host}:${connection.port}/${connection.database}`);
  await client.connect();

  try {
    // Sent as one simple-query batch, which runs inside a single implicit
    // transaction: a syntax error halfway through rolls the whole thing back
    // rather than leaving a half-migrated schema.
    const result = await client.query(sql);
    console.log(`Applied supabase/schema.sql (${sql.split('\n').length} lines).`);
    if (Array.isArray(result)) console.log(`${result.length} statements executed.`);
  } finally {
    await client.end();
  }

  console.log('\nSchema is up to date. Next: npm run db:seed');
}

main().catch((error: unknown) => {
  console.error(`\nSchema push failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
