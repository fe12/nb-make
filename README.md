# nb-make

Design notebook pages, arrange them into a notebook, impose them onto printable
sheets, and export a print-ready PDF — then publish it for other people to rate,
save and copy.

```bash
npm install
npm run dev      # http://localhost:3000
```

It runs with **no configuration at all**. Without a Supabase project the app is
exactly what it always was: notebooks in `localStorage`, images in IndexedDB,
PDFs generated in the tab, nothing uploaded. Accounts and the community are
additive, so an auth outage degrades to "no sync", not "no app".

## Adding the platform

```bash
cp .env.example .env.local     # then fill in from your Supabase project
npm run db:push                # apply supabase/schema.sql
npm run db:seed                # test user + admin + sample notebooks
```

Only `NEXT_PUBLIC_SUPABASE_URL`, the public key and `SUPABASE_DB_URL` are
needed. Supabase renamed the public key — new projects issue a *publishable*
key (`sb_publishable_…`), older ones an *anon* key; set whichever yours shows
and the app takes either. The service-role key is optional and unused by the
seed.

`db:seed` prints the credentials it creates and is idempotent — re-running
resets the passwords and overwrites the samples rather than duplicating them.
`npm run db:reset -- --yes` drops everything so the schema can be reapplied
from clean.

The database password Supabase generates often contains `/`, `?` or `#`, which
are structural characters in a URL. Paste the connection string exactly as
shown: the scripts parse it without a URL parser, so no escaping is needed.

---

## What an account adds

- **Sync.** Every notebook is mirrored to your account. Local storage stays the
  primary, synchronous write — the editor never waits on the network.
- **Community.** Publish a notebook and it appears at `/community`, browsable
  signed out, sortable by rating, likes, saves, views or recency.
- **Ratings, likes and saves.** A save is a pointer to the author's current
  version; copying it to your library gives you an independent one.
- **Admin.** A `role: admin` profile gets platform metrics, a user list with
  roles and bans, moderation for published work, and a report queue.

## The flow

1. **Design pages** — build page designs from a ruling (dot grid, ruled,
   isometric, music staves, …) plus optional blocks (text, LaTeX, images,
   tables, checklists, nested pattern areas). Drag blocks directly on the page.
2. **Build notebook** — put designs in order, set repeat counts, and drop in
   parametric generators that expand into many pages at once (a year of
   calendars, a month of habit trackers).
3. **Print layout** — impose the pages onto sheets. Pick a grid, a saddle-stitch
   booklet, or cut-and-stack; or drag the slots around by hand and set each
   one's orientation.
4. **Export** — generate the PDF, in the browser.

Pick a colour theme from the header — seven are included, two of them dark. The
choice is remembered per browser.

## Two ideas hold the whole thing together

**One drawing IR, two backends.** Every page — ruling, preset, LaTeX block,
calendar — compiles to a list of drawing ops (`src/lib/render/ops.ts`) in
millimetres with a top-left origin. The SVG backend (`render/svg.tsx`) draws the
on-screen preview; the PDF backend (`render/pdf.ts`) draws the export. They
consume the same ops and measure text with the same AFM tables pdf-lib uses, so
the preview is not an approximation of the output — it is the output.

**Pages are stored proportionally, not absolutely.** Block rectangles are
fractions of the page's content box, so retargeting a notebook from A5 to A6 is
just a matter of compiling against a different size. Only the type scale needs a
policy, and that is an explicit per-design setting.

Because the render pipeline is isomorphic, the PDF is built in the tab you are
looking at — including for a notebook you copied from someone else. The server
renders LaTeX, brokers sync writes so the unload beacon can authenticate, and
otherwise stays out of the way.

## Layout

```
src/
  app/                     routes: dashboard, the 4 editor steps, API handlers
  components/
    designer/              step 1 — page designs, pattern editor, block canvas
    order/                 step 2 — running order, generator parameter forms
    print/                 step 3 — sheet canvas with draggable slots
    export/                step 4 — export panel
    ui/controls.tsx        shared form primitives
  lib/
    themes.ts              colour themes, as `--nb-*` custom properties
    units.ts               millimetres, paper sizes, page-size resolution
    render/
      ops.ts               the drawing IR + affine transforms
      patterns.ts          16 rulings, each emitting ops clipped to its area
      geometry.ts          line clipping, tick sequences, parallel families
      fonts.ts             standard-14 metrics, shared by preview and export
      text.ts              text anchoring shared by both backends
      svg.tsx              backend 1: on-screen preview
      pdf.ts               backend 2: PDF, with same-style path batching
    latex/
      parse.ts             the supported LaTeX subset -> paragraphs and runs
      mathjax.server.ts    server-only: formula -> vector blob in em units
      layout.ts            line breaking and the three page-fit strategies
    parametric/            page generators (calendars, planners, trackers)
    presets/               built-in page designs, copied into notebooks
    compile/               template -> ops, notebook -> pages
    imposition/            slot generation, page ordering, printer's marks
    export/pdf.ts          two-pass PDF assembly
    client/storage.ts      localStorage + IndexedDB, import/export bundles
    client/export.ts       builds the PDF in the browser
    client/store.tsx       editor state, autosave, undo, math cache
    client/sync.ts         revision-guarded push/pull/merge + unload beacon
    client/sync-context.tsx  drives sync from the storage change feed
    client/auth.tsx        session and profile
    client/community.ts    publish, rate, like, save, clone
    client/admin.ts        metrics, users, moderation
    supabase/              browser, server and service-role clients
  proxy.ts                 session refresh + route guards (was middleware.ts)
supabase/schema.sql        tables, RLS policies, triggers and RPCs
scripts/                   verification and database scripts (see below)
```

## Security model

Authorisation is row-level security in Postgres, not application code. The
browser holds only the publishable key, and every admin screen works because
`is_admin()` widens the policies — the same calls from a normal account return
nothing. Three things are worth knowing because they are easy to get wrong:

- **Roles are guarded by a trigger, not a policy.** RLS cannot compare the old
  and new row, so an update policy that lets you edit your own profile would
  let you set `role: admin`. `guard_profile_privileges` resets the column
  unless the caller is already an admin or the service role. It is deliberately
  *not* `security definer`: inside a definer function `current_user` is the
  function's owner, which would exempt every caller.
- **Sync checks ownership itself.** The notebook update policy intentionally
  allows admins to edit any row so they can moderate. `push_notebook` therefore
  re-checks ownership, so an admin's sync can never overwrite someone else's
  notebook.
- **Saves are private; likes are public.** Saves are a personal bookmark list
  and are readable only by their owner.

## Things worth knowing

**Repeated pages cost almost nothing.** Export runs in two passes: each
*distinct* page is drawn once into an intermediate document, then embedded as a
form XObject and referenced by every sheet that uses it. A 200-page dot-grid
notebook contains one page of artwork and exports to about 100 KB.

**Rulings are batched.** A 5 mm dot grid on A4 is roughly 2,500 circles.
Consecutive ops sharing a style are merged into a single path operation, so a
dot-grid page is a handful of PDF operators rather than thousands.

**Imposition is pure and shared.** `generateSlots`, `planSheets` and
`placeInSlot` have no UI dependencies, and the sheet editor and the exporter
both call them — including for crop and fold marks. What the editor draws is
what gets printed, by construction.

**Sync is local-first, and never silently overwrites.** The local write is
synchronous and primary; a debounced push follows a couple of seconds later, a
proper flush when the tab is hidden, and a `navigator.sendBeacon` on `pagehide`
— the only thing a browser reliably delivers once a page is being torn down.
Beacon cannot set headers, which is why writes go to `/api/sync/notebooks` and
authenticate with the session cookie rather than talking to Supabase directly;
the normal push shares that path so the two cannot drift.

Each notebook carries a `revision`. The server refuses any push whose revision
is not strictly greater than the one it holds, and hands its own copy back. A
tie means another device already claimed that revision, so accepting it would
discard their work. When that happens the client keeps *both*: the server's
version stays under the shared id and this device's is preserved beside it. The
same rule governs the merge at sign-in — the only case that duplicates is a
genuine two-sided divergence, which is the one resolution that cannot lose
anything.

**Slots are the source of truth.** Layout modes *generate* slots; dragging one
switches the imposition to `manual` so a hand-tuned arrangement is never
regenerated behind your back. Reverse sides are derived by mirroring the front,
so they are shown read-only.

**Repeating sections can walk a calendar forward.** A section like
`12 × [monthly calendar, to-do ×2, dot grid ×2]` with *Advance dates each repeat*
turned on produces January, February, … December rather than the same month
twelve times — and the other entries repeat unchanged around it. The starting
point is just the generator's own year/month parameters. Only the generator knows
what "one step" means for its parameters, so each dated generator supplies an
`advance` function instead of the compiler special-casing calendars. Monthly and
yearly calendars, weekly and daily planners, meal planners and habit trackers all
step; anything undated simply repeats.

**Fonts are not embedded.** Exports use the PDF standard-14 faces (Helvetica,
Times, Courier), which every conforming reader provides. That keeps files small
and avoids font licensing, at the cost of exact glyph shapes being up to the
reader. Some lightweight PDF *thumbnailers* do not ship substitutes and will
show such text as blank — real viewers and printers render it correctly.

**Print at 100%.** Any "fit to page" or "shrink oversized pages" setting will
change the ruling spacing, which defeats the point of a 5 mm grid.

## LaTeX support, honestly

There is no TeX distribution here — that would be at odds with the app being a
self-contained local tool. Instead MathJax renders the *maths* to vectors, and a
small parser handles a prose subset around it:

- `$…$`, `$$…$$`, `\(…\)`, `\[…\]` — full MathJax maths, all packages
- `\section` / `\subsection` / `\subsubsection` / `\title`
- `itemize`, `enumerate`, `center`, `flushleft`, `flushright`
- `\textbf`, `\textit`, `\emph`, `\texttt`, `\large`, `\small`, …
- `\\` breaks, `%` comments, escaped specials, `---`/`--` dashes
- a full `\documentclass…\begin{document}` file is accepted; the preamble is
  ignored

Anything else is rendered as literal text and reported as a warning rather than
silently dropped. Unsupported constructs will not fail an export.

For a complete `.tex` document, the LaTeX block inspector also offers
**Compile full document to PDF**. It runs the local TeX installation through
`latexmk` (or two `pdflatex` passes when MiKTeX has no Perl runtime), then
downloads the native PDF. This is the path for tables, custom packages, macros,
and document-level page settings; those constructs cannot be represented in the
editable notebook canvas. The compiler disables shell escape and uses a fresh
temporary directory, but it should only be exposed to trusted users or isolated
in a container when deploying the app as a shared service.

A LaTeX block written for one page size adapts to another by one of three
strategies, chosen per block:

- **reflow** — keep the type size, re-wrap to the new width
- **scale** — scale the type by the width ratio, so line breaks are identical
  and the result is a photographic reduction
- **both** — scale, then shrink further if it still overflows vertically

## What's built in

**Rulings (16):** blank, ruled (with margin and header rules), dot grid, square
grid, graph, isometric, hexagonal, triangular, polar, logarithmic, music staves,
guitar tablature, handwriting guides (with slant guides), Seyes, genkō yōshi,
dotted thirds.

**Block types (9):** text, LaTeX, image, shape, nested pattern area, table,
labelled fields, checklist, page number.

**Parametric generators (15):** title page, year overview, monthly calendar,
weekly planner (boxes / agenda / hourly), daily planner, meal planner, kanban
board, project timeline, Cornell notes, index/contents, storyboard, habit
tracker, budget ledger, workout log, reading log.

Generators declare their parameters as data, so the form in the editor is
rendered from the field list — adding a generator needs no UI work.

## Verification

The favicon is generated from `public/fav.png`; the remaining icons and the
header logo still come from `src/img/fav.png`. Replace either and re-run:

- `npm run icons:favicon` — the browser tab icon and a real `favicon.ico`, so
  browsers stop asking for one that isn't there
- `npm run icons` — every size, including the apple-touch icon, the manifest
  icons and the header mark

```bash
npm run typecheck
npm run check:imposition   # asserts booklet/grid/cut-stack order and placement
npm run check:pipeline     # renders every preset and generator, writes tmp/*.pdf
npm run check:latex        # parser + MathJax bridge
npm run check              # all of the above

npm run db:push            # apply supabase/schema.sql (idempotent)
npm run db:seed            # test user, admin, sample published notebooks
npm run db:reset -- --yes  # drop everything this app created
```

`check:pipeline` writes real PDFs to `tmp/` so output can be inspected by eye.
`check:imposition` pins the saddle-stitch order (an 8-page booklet must impose
as 8|1, 2|7, 6|3, 4|5) and checks that every page is placed exactly once in
every mode.

## Limitations

- Images must be PNG or JPEG — the two formats a PDF can carry without
  re-encoding.
- Booklet imposition is two-up, which is what folding a sheet in half gives you.
  Other counts use the grid or cut-and-stack orders.
- Text is set in the standard-14 faces; there is no custom font embedding.
- The page-count shown on the dashboard is cached when a notebook is saved, so
  it can lag if a notebook's JSON is edited by hand.
- Browser storage is per-browser and per-profile, and clearing site data will
  remove any notebook that has not been synced to an account.
- Signing out leaves notebooks in the browser deliberately — they are your
  work. On a shared browser the next account will see them, cannot upload them
  (the server refuses), and is told so on the settings page.
- Deleting an account outright needs the Auth admin API, so that is done from
  the Supabase dashboard; the admin panel bans instead, which blocks
  publishing, rating and syncing while leaving the account's data intact.
- `localStorage` holds a few megabytes. Notebooks are small, but a very large
  one will report a quota error on save — export and split it if that happens.
- `npm run build` prints two "dynamic filesystem access" warnings. They are
  expected: the app reads a data directory chosen at runtime, so the bundler
  cannot enumerate the files ahead of time.
