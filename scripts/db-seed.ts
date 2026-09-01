/**
 * Seeds a test user, an admin, sample published notebooks and some engagement.
 *
 *   npm run db:seed
 *
 * Idempotent: re-running reuses the existing accounts (resetting their
 * passwords) and overwrites the sample notebooks rather than piling up
 * duplicates.
 *
 * Works over the direct Postgres connection rather than the Admin API, so it
 * needs only SUPABASE_DB_URL -- the same variable `db:push` already requires.
 * Creating an account means writing `auth.users` and a matching
 * `auth.identities` row by hand, which is why the column handling below is
 * fussier than a normal insert.
 */
import { Client } from 'pg';
import { compileNotebook } from '../src/lib/compile/notebook';
import { createNotebook } from '../src/lib/defaults';
import { newId } from '../src/lib/ids';
import { PALETTE_PRESETS } from '../src/lib/palette';
import { pageSizeLabel } from '../src/lib/sync/types';
import type { ContentItem, Notebook } from '../src/lib/types/notebook';
import { defaultPageSize } from '../src/lib/units';
import { loadEnv, parseDbUrl, requireEnv } from './env';

interface SeedAccount {
  email: string;
  password: string;
  displayName: string;
  role: 'user' | 'admin';
}

async function main() {
  loadEnv();
  const client = new Client(parseDbUrl(requireEnv('SUPABASE_DB_URL')));
  await client.connect();

  try {
    await client.query('begin');

    // pgcrypto lives in `extensions` on hosted Supabase but in `public` on some
    // self-hosted setups, and crypt()/gen_salt() have to be schema-qualified
    // because this script does not control the connection's search_path.
    const { rows } = await client.query<{ nspname: string }>(
      `select n.nspname from pg_extension e
         join pg_namespace n on n.oid = e.extnamespace
        where e.extname = 'pgcrypto'`
    );
    const crypto = rows[0]?.nspname;
    if (!crypto) throw new Error('pgcrypto is not installed. Run `npm run db:push` first.');

    const accounts: SeedAccount[] = [
      {
        email: process.env.SEED_ADMIN_EMAIL ?? 'admin@nb-make.test',
        password: process.env.SEED_ADMIN_PASSWORD ?? 'nbmake-admin-2026',
        displayName: 'nb-make admin',
        role: 'admin',
      },
      {
        email: process.env.SEED_USER_EMAIL ?? 'user@nb-make.test',
        password: process.env.SEED_USER_PASSWORD ?? 'nbmake-user-2026',
        displayName: 'Test user',
        role: 'user',
      },
    ];

    console.log('Accounts');
    const ids: Record<string, string> = {};
    for (const account of accounts) {
      ids[account.role] = await upsertAccount(client, crypto, account);
    }

    console.log('\nNotebooks');
    for (const sample of samples()) {
      await publish(client, sample.notebook, ids[sample.owner]);
    }

    console.log('\nEngagement');
    await seedEngagement(client, ids.admin, ids.user);

    await client.query('commit');

    console.log('\nDone. Sign in with:');
    for (const account of accounts) {
      console.log(`  ${account.role.padEnd(5)} ${account.email}  /  ${account.password}`);
    }
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}

/* ------------------------------------------------------------- accounts */

async function upsertAccount(
  client: Client,
  crypto: string,
  account: SeedAccount
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    'select id from auth.users where lower(email) = lower($1)',
    [account.email]
  );

  if (existing.rows.length > 0) {
    const id = existing.rows[0].id;
    // Reset the password so the credentials printed at the end always work,
    // even if an earlier run used different ones.
    await client.query(
      `update auth.users
          set encrypted_password = ${crypto}.crypt($2, ${crypto}.gen_salt('bf')),
              email_confirmed_at = coalesce(email_confirmed_at, now()),
              updated_at = now()
        where id = $1`,
      [id, account.password]
    );
    await ensureProfile(client, id, account);
    console.log(`  reused  ${account.email}`);
    return id;
  }

  const inserted = await client.query<{ id: string }>(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at,
       raw_app_meta_data, raw_user_meta_data,
       is_sso_user, is_anonymous,
       -- GoTrue reads these into non-nullable Go strings, so NULL here causes
       -- "converting NULL to string is unsupported" on the first sign-in.
       confirmation_token, recovery_token, email_change_token_new,
       email_change, email_change_token_current, reauthentication_token,
       phone_change, phone_change_token
     ) values (
       '00000000-0000-0000-0000-000000000000',
       gen_random_uuid(), 'authenticated', 'authenticated', $1,
       ${crypto}.crypt($2, ${crypto}.gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', $3::text),
       false, false,
       '', '', '', '', '', '', '', ''
     )
     returning id`,
    [account.email, account.password, account.displayName]
  );
  const id = inserted.rows[0].id;

  // Without a matching identity row, password sign-in finds no provider and
  // fails even though the user exists.
  await client.query(
    `insert into auth.identities (
       id, user_id, provider_id, provider, identity_data,
       last_sign_in_at, created_at, updated_at
     ) values (
       -- $1 is bound as text and cast where a uuid is wanted. Using it as both
       -- uuid and text directly makes the planner deduce two types for one
       -- parameter, which it refuses to do.
       gen_random_uuid(), $1::uuid, $1, 'email',
       jsonb_build_object('sub', $1, 'email', $2::text, 'email_verified', true),
       now(), now(), now()
     )
     on conflict do nothing`,
    [id, account.email]
  );

  await ensureProfile(client, id, account);
  console.log(`  created ${account.email}`);
  return id;
}

/**
 * The on_auth_user_created trigger normally writes this row. Doing it again is
 * harmless and covers accounts that predate the trigger.
 *
 * Setting `role` works here only because guard_profile_privileges exempts the
 * `postgres` role -- through the API this column is not writable.
 */
async function ensureProfile(client: Client, id: string, account: SeedAccount) {
  await client.query(
    `insert into public.profiles (id, email, display_name, role)
     values ($1, $2, $3, $4)
     on conflict (id) do update
       set display_name = excluded.display_name,
           role = excluded.role,
           banned_at = null`,
    [id, account.email, account.displayName, account.role]
  );
}

/* ------------------------------------------------------------ notebooks */

async function publish(client: Client, notebook: Notebook, ownerId: string) {
  const compiled = compileNotebook(notebook, { assets: {}, math: {} });
  const doc: Notebook = {
    ...notebook,
    stats: {
      pageCount: compiled.totalPages,
      sheetCount: 0,
      computedAt: new Date().toISOString(),
    },
  };

  await client.query(
    `insert into public.notebooks (
       id, owner_id, name, description, doc, revision,
       page_count, template_count, page_size_label,
       is_published, published_at, created_at, updated_at
     ) values ($1,$2,$3,$4,$5::jsonb,1,$6,$7,$8,true,$9,$9,$10)
     on conflict (id) do update
       set owner_id = excluded.owner_id,
           name = excluded.name,
           description = excluded.description,
           doc = excluded.doc,
           page_count = excluded.page_count,
           template_count = excluded.template_count,
           page_size_label = excluded.page_size_label,
           is_published = true,
           deleted_at = null`,
    [
      doc.id,
      ownerId,
      doc.name,
      doc.description,
      JSON.stringify(doc),
      compiled.totalPages,
      doc.templates.length,
      pageSizeLabel(doc),
      doc.createdAt,
      doc.updatedAt,
    ]
  );

  console.log(`  ${doc.name} — ${compiled.totalPages} pages, ${pageSizeLabel(doc)}`);
}

/**
 * A little activity, so the community filters have something to sort by and an
 * empty-looking page does not read as a bug.
 */
async function seedEngagement(client: Client, adminId: string, userId: string) {
  const engagement: Array<{
    notebook: string;
    by: string;
    rating?: number;
    review?: string;
    save?: boolean;
  }> = [
    { notebook: 'nb_seed_bulletjrnl', by: userId, rating: 5, review: 'Printed a whole year of this — the imposition just worked.', save: true },
    { notebook: 'nb_seed_studyplan', by: adminId, rating: 4, review: 'Good bones. I would widen the margin for binding.', save: true },
    { notebook: 'nb_seed_sketchbook', by: adminId, rating: 5, review: 'Perfect for a pocket signature.' },
  ];

  for (const item of engagement) {
    await client.query(
      `insert into public.notebook_likes (notebook_id, user_id) values ($1,$2)
       on conflict do nothing`,
      [item.notebook, item.by]
    );
    if (item.rating) {
      await client.query(
        `insert into public.notebook_ratings (notebook_id, user_id, rating, review)
         values ($1,$2,$3,$4)
         on conflict (notebook_id, user_id) do update
           set rating = excluded.rating, review = excluded.review, updated_at = now()`,
        [item.notebook, item.by, item.rating, item.review ?? '']
      );
    }
    if (item.save) {
      await client.query(
        `insert into public.notebook_saves (notebook_id, user_id) values ($1,$2)
         on conflict do nothing`,
        [item.notebook, item.by]
      );
    }
  }

  // Views are the "trending" sort key, so give them a spread.
  await client.query(
    `update public.notebooks set view_count = v.count
       from (values ('nb_seed_bulletjrnl', 128), ('nb_seed_studyplan', 74), ('nb_seed_sketchbook', 31))
         as v(id, count)
      where notebooks.id = v.id`
  );

  const { rows } = await client.query<{ name: string; like_count: number; rating_avg: string }>(
    `select name, like_count, rating_avg from public.notebooks order by name`
  );
  for (const row of rows) {
    console.log(`  ${row.name}: ${row.like_count} like(s), rating ${row.rating_avg}`);
  }
}

/**
 * Fixed ids so re-seeding overwrites the samples instead of adding more.
 * Everything else is built through the same `createNotebook` the app uses, so
 * the seed cannot drift from a real notebook's shape.
 */
function samples(): Array<{ notebook: Notebook; owner: 'admin' | 'user' }> {
  const dated = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  const bulletJournal = createNotebook({
    name: 'Bullet journal starter',
    description:
      'A year of monthly calendars with dot-grid spreads between them. A5, imposed two-up on A4.',
    pageSize: defaultPageSize('A5', 'portrait'),
    presetIds: ['dots-5', 'ruled-7'],
    palette: PALETTE_PRESETS[0].palette,
  });
  bulletJournal.id = 'nb_seed_bulletjrnl';
  bulletJournal.createdAt = dated(30);
  bulletJournal.updatedAt = dated(3);
  bulletJournal.content = [
    {
      kind: 'group',
      id: newId('item'),
      label: 'The year',
      repeat: 12,
      advanceDates: true,
      items: [
        {
          kind: 'parametric',
          id: newId('item'),
          generatorId: 'calendar-month',
          // `scope: single` is what makes each repetition one page, which the
          // generator's own advance() then steps forward a month at a time.
          params: { year: new Date().getFullYear(), scope: 'single', startMonth: 1 },
          baseTemplateId: null,
          label: '',
        },
        {
          kind: 'template',
          id: newId('item'),
          templateId: bulletJournal.templates[0].id,
          count: 4,
          label: '',
        },
      ],
    },
  ] satisfies ContentItem[];

  const studyPlanner = createNotebook({
    name: 'Study planner',
    description:
      'Titled note pages backed with dot grid, for lectures and revision. Built for A5.',
    pageSize: defaultPageSize('A5', 'portrait'),
    presetIds: ['titled-notes', 'dots-5'],
    palette: PALETTE_PRESETS[3].palette,
  });
  studyPlanner.id = 'nb_seed_studyplan';
  studyPlanner.createdAt = dated(18);
  studyPlanner.updatedAt = dated(1);

  const sketchbook = createNotebook({
    name: 'Pocket sketchbook',
    description: 'Blank A6 signatures, imposed four-up for saddle stitching.',
    pageSize: defaultPageSize('A6', 'portrait'),
    presetIds: ['blank'],
    palette: PALETTE_PRESETS[7].palette,
  });
  sketchbook.id = 'nb_seed_sketchbook';
  sketchbook.createdAt = dated(9);
  sketchbook.updatedAt = dated(9);

  return [
    { notebook: bulletJournal, owner: 'admin' },
    { notebook: studyPlanner, owner: 'user' },
    { notebook: sketchbook, owner: 'user' },
  ];
}

main().catch((error: unknown) => {
  console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
