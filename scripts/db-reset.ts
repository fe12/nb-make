/**
 * Drops everything this app created, so the schema can be applied from clean.
 *
 *   npm run db:reset -- --yes
 *
 * Destructive: every notebook, rating and profile row goes. Auth accounts are
 * left alone (delete those from the Supabase dashboard) because dropping
 * profiles cascades from auth.users, not the other way round.
 */
import { Client } from 'pg';
import { loadEnv, parseDbUrl, requireEnv } from './env';

const DROP = `
drop trigger if exists on_auth_user_created on auth.users;
drop table if exists public.notebook_reports cascade;
drop table if exists public.notebook_ratings cascade;
drop table if exists public.notebook_saves   cascade;
drop table if exists public.notebook_likes   cascade;
drop table if exists public.notebooks        cascade;
drop view  if exists public.public_profiles;
drop table if exists public.profiles         cascade;
drop function if exists public.handle_new_user()            cascade;
drop function if exists public.guard_profile_privileges()   cascade;
drop function if exists public.is_admin()                   cascade;
drop function if exists public.is_banned()                  cascade;
drop function if exists public.sync_like_count()            cascade;
drop function if exists public.sync_save_count()            cascade;
drop function if exists public.sync_rating_totals()         cascade;
drop function if exists public.touch_notebook()             cascade;
drop function if exists public.increment_notebook_view(text) cascade;
drop function if exists public.admin_overview()             cascade;
`;

async function main() {
  loadEnv();

  if (!process.argv.includes('--yes')) {
    console.error(
      'This drops every notebook, rating and profile in the database.\n' +
        'Re-run with:  npm run db:reset -- --yes'
    );
    process.exit(1);
  }

  const client = new Client(parseDbUrl(requireEnv('SUPABASE_DB_URL')));
  await client.connect();
  try {
    await client.query(DROP);
    console.log('Dropped. Run `npm run db:push` to recreate the schema.');
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\nReset failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
