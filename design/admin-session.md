# Admin session persistence

## Purpose

Make `/admin/session/:id` survive a refresh, a direct visit, and a shared link.

Today the `/admin` flow parses a PokerNow CSV entirely client-side and hands the
result to the session view through an in-memory, single-shot stash
(`src/utils/sessionHandoff.js`). It lives for exactly one client-side navigation:

```
/admin  ──stashSessionPreview({id, csvText, game, groups, settlement})──▶  module-level `let stashed`
                                                                                  │  peekSessionPreview(id)  (one read)
/admin/session/:id  ◀─────────────────────────────────────────────────────────────┘  then clearSessionPreview()
```

A refresh or a link someone else opens has no stash, so `SessionPage` falls back
to a dead `localStorage` key and renders "No hand log data found".

This doc specifies the DB-backed replacement.

## Design stance

- **Non-invasive.** The existing app — dashboard, `GameEditor`, `PlayerManager`,
  the `sessions` / `ledger` tables and their flows — must behave **identically**
  after this lands. All new behaviour is confined to the admin surface (`/admin`,
  `/admin/session/:id`) and new modules. Any place this design has to modify
  shared code is a *fork point*: refactor-only (no behaviour change) and called
  out individually when implementation starts — see "Impact on the existing app".
- **No API server.** The app talks to Supabase directly from the browser with the
  anon key (`src/utils/supabase.js`), same as `App.jsx` / `GameEditor.jsx`. The
  "API" here is a thin `src/utils/sessionApi.js` wrapping `supabase.from(...)`.
- **Separate namespace.** The admin flow is deliberately kept out of the real
  `sessions` / `ledger` tables ("admin csv upload does not touch db"). It gets its
  own `admin_sessions` table, keyed on the PokerNow game id.
- **Session id is the PokerNow game id, editable at upload.** The review dialog
  shows a **Session ID** field pre-filled with `extractPokerNowGameId(...)`; when
  that returns null it's pre-filled with a generated fallback
  (`crypto.randomUUID()` or a short slug) instead. The user can override it before
  confirming. Whatever is in that field becomes `admin_sessions.id` and the
  `/admin/session/:id` route.
- **Render-ready blobs on the row are the read source.** `chart_data` + `entries`
  are stored so a normal page load never re-parses a CSV. Raw-CSV retention (for
  re-deriving after a parser change or a re-link) is scaffolded but **not
  implemented yet** — see "Raw CSV (deferred)".
- **In-memory stash stays** as a write-through fast path: the `/admin` → session
  navigation reads the stash and skips the round trip; every other entry point
  fetches from the DB.

## Recommended schema

### Table: `admin_sessions`

```sql
create table admin_sessions (
  id             text primary key,          -- PokerNow game id (e.g. 'pglGBfawbO4QKqxPMARshArfY'),
                                             -- or a generated fallback when the export has none;
                                             -- editable in the upload dialog before confirm
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     text,                       -- adamzartin@gmail.com; nullable, not enforced yet

  -- session meta (the fields SessionPage reads off the `game` object today)
  date           date,                       -- session start date, 'YYYY-MM-DD'
  currency       text    not null default 'USD',
  chip_value     numeric not null default 1,
  poker_now_url  text,

  -- denormalised summary for the /admin list view — set at write time so the
  -- list query never has to read chart_data / entries
  player_count   int not null default 0,
  hand_count     int not null default 0,

  -- render-ready cumulative-net series (the bare-minimum chart shape).
  -- `players[]` carries a STABLE identity, not a name: `playerId` when the seat
  -- resolved to a master profile, else `null` + the raw nickname as fallback.
  -- Display names are resolved LIVE at render from the app's `players` list, so a
  -- profile rename shows through on old sessions (see "Identity linking").
  --   { "players":    [ {"playerId":"<uuid>", "nickname":"RahulL"}, {"playerId":null, "nickname":"guest3"}, ... ],
  --     "hands":      [1, 2, ... , 412],       -- x-axis tick + tooltip labels; nullable entries ok
  --     "timestamps": ["2026-09-06T01:12:03", ..., "latest"],  -- kept so the CSV download stays whole
  --     "nets":       [[0,0,0,0,0], [-120,340,-50,-200,null], ...] }  -- row per hand boundary, col per player
  chart_data     jsonb not null,

  -- final per-player ledger (Latest Ledger table + Settlement input). Carries the
  -- resolved `playerId` (or null) + raw `name`; the display name is resolved live,
  -- same as chart_data — no `displayName` is frozen here.
  --   [{ "name":"RahulL", "pokerNowId":"abc", "externalId":"abc", "playerId":"<uuid|null>",
  --      "buyIn":2000, "buyOut":0, "stack":800, "currency":"USD", "isBank":false }, ...]
  entries        jsonb not null,

  -- review-dialog config
  groups         jsonb not null default '[]'::jsonb,   -- identity-link groups (list of token lists) — the
                                                       -- user's decision + audit trail; also the fallback
                                                       -- when a group binds to no master profile
  profiles       jsonb not null default '[]'::jsonb,   -- resolved roster: [{ playerId, tokens:[...] }]
  settlement     jsonb not null default '{}'::jsonb,   -- { countryByKey, bankByCountry, chipsPerCad, cadToUsd }

  -- provenance / regeneration — SCAFFOLD ONLY, not written or read yet
  raw_csv_path   text,                       -- reserved: Storage path to the gzipped source CSV
  parser_version int  not null default 1     -- reserved: bump when parse/reconcile logic changes
);

create index admin_sessions_date_idx on admin_sessions (date desc);
```

`updated_at` maintenance: a `before update` trigger, or set it explicitly from
`sessionApi`.

### Raw CSV (deferred)

Not implemented in the first cut. `chart_data` + `entries` are enough to render
the page; the CSV is only needed to *re-derive* those after a parser change or a
re-link, which isn't a v1 concern.

Keep the scaffolding so it's a drop-in later:

- `raw_csv_path` column stays on the table, nullable, unwritten.
- `sessionApi` exposes no-op stubs (`uploadRawCsv`, `downloadRawCsv`) with a
  `// TODO: not wired up` marker.
- **When enabled:** a private Storage bucket `admin-session-csv`, one gzipped
  object per session at `<id>.csv.gz`, uploaded with
  `cacheControl: 'public, max-age=31536000, immutable'` (a session's CSV never
  changes). `raw_csv_path` then points at the object and becomes the regenerable
  source of truth.

### Why blobs and not child tables

`chart_data` for a long session is ~10-15 KB (≈2-3 KB gzipped) — far under the
1 GB `jsonb` limit, TOASTed transparently, one row read. `entries` is one small
array. Nothing on this page queries *across* sessions or *inside* a timeline, so
rows would be cost with no benefit. If cross-session analytics on the admin
namespace ever matters, promote `entries` to an `admin_session_entries` table
then.

### RLS

**Not gated for now.** `admin_sessions` (and the `players` / `player_links`
writes the admin confirm adds) stay open under the anon key, same as the rest of
the app. Anonymous read + write, unguessable ids as the only barrier. Revisit if
the app ever gets real auth.

## How the schema maps to the page

Worked against `http://localhost:5174/admin/session/pglGBfawbO4QKqxPMARshArfY`.

```
URL  /admin/session/pglGBfawbO4QKqxPMARshArfY
                     └────────────┬───────────┘
                                  └─▶ admin_sessions.id   (primary key lookup)
```

| Page region (`SessionPage.jsx`) | Source column | Detail |
| --- | --- | --- |
| Header — `<h1>` session id | URL param | shown verbatim; equals `admin_sessions.id` |
| Header subtitle — "Started Sep 6, 2026" | `date` | formatted client-side |
| Header subtitle — "412 hands" | `chart_data.nets.length - 1` | `handCount` |
| Header subtitle — "5 players" | `chart_data.players.length` | |
| **Cumulative Net** chart | `chart_data` + `players` list | `players[j]` → line order + color slot; legend label = `nameOf(players[j].playerId) ?? players[j].nickname` resolved live; `nets[i]` → snapshot `i` (evenly spaced on x); `nets[i][j]` → player `j` net, `null` = not seated yet; `hands[i]` → x tick text + tooltip "Hand #N" |
| "Download cumulative net" button | `chart_data` (+ live names) | CSV built client-side; no egress |
| **Latest Ledger** table | `entries` + `players` list | row = `{ nameOf(playerId) ?? name, net }`, `net = buyOut + stack - buyIn`; sorted desc; last column of `chart_data.nets` must reconcile to these |
| **Settlement** panel | `entries` + `settlement` | `computeBankSettlement({ entries, countryByKey, bankByCountry, chipsPerCad, cadToUsd })`; panel hidden when `entries` empty or no countries resolve |
| `poker_now_url` | `poker_now_url` | not rendered on this page today; part of the `game` object for parity |

`nameOf(playerId)` = look up `players.find(p => p.id === playerId)?.display_name`
in the `players` list. A deleted profile → falls back to the stored raw
`nickname` / `name`.

### Live name resolution — `usePlayers()`

`SessionPage` is a routed island that doesn't get `App`'s props, so it reaches
the `players` list through a shared hook:

```
usePlayers()  →  { players, loading, error }
  - one fetch: supabase.from('players').select('id, display_name')
  - module-level cache (or a context provider): App, GameEditor, PlayerManager
    and SessionPage all consume the same result, no prop drilling, no routing
    refactor
  - SessionPage needs `players` only — NOT `player_links` (link resolution
    already ran at write time to produce `entries[].playerId`)
```

Pair this with rule 1 in "Identity linking" (extract `resolveIdentity` from the
`App` / `GameEditor` copies) so there's one identity module: `usePlayers()` +
`resolveIdentity()`.

This is the Stage 2 end state (see "Impact on the existing app"). In Stage 1,
`SessionPage` does its own local `players` fetch so nothing shared is touched;
Stage 2 collapses that into the hook.

Reconstruction adapter (client): `chart_data` → the
`{ players: Map, snapshots: [{ handNumber, nets: { id: { nickname, net } } }] }`
shape `CumulativeNetChart` expects. ~15 lines, or refactor the component to take
the minimal shape directly.

## Session list (`/admin`)

`/admin` today is just the upload card. Add a list of every stored session below
it; clicking a row navigates to `/admin/session/{id}`.

### Query

```
sessionApi.list()
  └─ supabase.from('admin_sessions')
       .select('id, date, currency, poker_now_url, player_count, hand_count, created_at, updated_at')
       .order('date', { ascending: false })
```

Explicit column list — **never `select('*')` here**, so the multi-KB `chart_data`
/ `entries` / `groups` blobs stay on the server. `player_count` / `hand_count`
are the denormalised columns set at write time, so the list costs one light
query regardless of how many hands each session has.

### UI

```
┌ Upload PokerNow CSV ─────────────────────────┐
│  [ drop / choose a file ]                     │
└──────────────────────────────────────────────┘

  Sessions · 12                          (state: loading | error+retry | empty)
┌──────────────────────────────────────────────┐
│ Sep 6, 2026    5 players   412 hands    ↗ PN │ → /admin/session/pglGBfawbO4QK…
│ Aug 30, 2026   6 players   287 hands         │ → /admin/session/…
│ Aug 23, 2026   4 players   — hands      🗑    │ → /admin/session/…
│ …                                            │
└──────────────────────────────────────────────┘
```

- Row content: `date` (formatted), `player_count`, `hand_count`, optional
  external link to `poker_now_url`, `updated_at` as a secondary "edited" hint
  when it differs from `created_at`.
- Whole row is the navigation target (`<Link to={/admin/session/${id}}>`);
  the PokerNow link and delete control `stopPropagation`.
- States: `loading` skeleton, `error` + retry, `empty` ("No sessions yet —
  upload a CSV above").
- Sort: `date` desc. Client-side text filter by player name can come later
  (add `profiles` to the select and resolve names via the `players` list, or add
  a dedicated search column).

### Delete (optional, this is the "cleanup" affordance)

```
sessionApi.remove(id)
  └─ supabase.from('admin_sessions').delete().eq('id', id)
     // + storage .remove([`${id}.csv.gz`]) once raw CSV is wired up
```

Confirm dialog first ("Delete this session? The chart, ledger and settlement are
removed. Player profiles and links are kept."). `player_links` / `players` are
**not** touched — league-wide facts, same rule as re-upload.

### Ties to the rest of the doc

- The collision guard's **"Open existing"** branch lands the user here (or on the
  detail page directly).
- After `sessionApi.create` succeeds, invalidate/refetch the list so a just-
  uploaded session appears without a manual reload.

## Read path

```
GET /admin/session/pglGBfawbO4QKqxPMARshArfY
   │
   ├─ peekSessionPreview(id)  ──hit──▶  render from stash        (just came from /admin)
   │                                    then clearSessionPreview()
   └─ miss
        │  state = loading
        ▼
     sessionApi.get(id)
        └─ supabase.from('admin_sessions').select('*').eq('id', id).maybeSingle()
             │
             ├─ row  ──▶  adapt chart_data → parsed; resolve names from the
             │            `players` list; render chart + ledger + settlement
             ├─ null ──▶  "Session not found"
             └─ error ─▶  "Couldn't load session" + retry
```

- New `SessionPage` states vs. today: `loading`, `not-found`, `error` — currently
  a stash miss silently renders the empty state.
- `SessionPage` now needs the `players` list for live name resolution, via a
  shared **`usePlayers()`** hook (see "Live name resolution" below). While it's
  still loading, render raw `nickname` / `name` and swap in resolved names when it
  arrives.

## Write path (`/admin` confirm)

```
handleConfirmReview({ sessionId, groups, groupProfiles, countryByKey, bankByCountry, chipsPerCad, cadToUsd })
   │   sessionId = the (possibly edited) value from the dialog's Session ID field
   │
   ├─ for each group: linkIdentity(playerId, tokens)      persist identities  (see below)
   │      └─▶ players / player_links upserts → resolved `profiles[] = [{ playerId, tokens }]`
   │
   ├─ applyPlayerGroups + createGameFromCSVEntries        (unchanged)
   ├─ parseCumulativeNet → groupCumulativeNet → reconcileCumulativeNet
   │      └─▶ serialize to chart_data; players[] = { playerId | null, nickname }  (NO names frozen)
   │
   ├─ stashSessionPreview({...})                          fast path for the next nav
   │
   └─ sessionApi.create({
   │      id: sessionId, date: game.date, currency, chip_value, poker_now_url,
   │      chart_data, entries (name + playerId, no displayName), groups, profiles,
   │      settlement,
   │      player_count: chart_data.players.length,
   │      hand_count: chart_data.nets.length - 1
   │    })
   │      └─ upsert admin_sessions row (on conflict id → re-upload replaces)
   │      // raw-CSV upload deferred — see "Raw CSV (deferred)"
   │
   ├─ ok       ──▶  navigate(`/admin/session/${sessionId}`)
   └─ failed   ──▶  stay on review, error banner (stash still lets the user proceed)
```

Upsert on `id` means re-uploading (or reusing a `Session ID`) overwrites rather
than duplicating. Identity writes run *before* the session insert but must not
block it — a failed `player_links` write is logged and skipped, not fatal.

## Re-upload / collision

`extractPokerNowGameId(file.name, text)` is deterministic: the game id comes from
the filename (`poker_now_log_<id>.csv`, `ledger_<id>.csv`) or an embedded game
URL, and a browser ` (1)` dedupe suffix is stripped. So the same export — even
downloaded twice — resolves to the same `admin_sessions.id`.

### Behaviour today

Nothing is persisted, so re-upload silently overwrites the in-memory stash and
navigates to the same URL. No prompt, no cleanup, idempotent by accident.

### Behaviour with this design (without a guard)

`sessionApi.create` upserts the row on the stable PK — in-place replace, no
duplicate. But a blind overwrite destroys work in two real cases:

- the existing row carried **manual linking / country / bank config** the user
  would have to redo
- the game was **continued and re-exported with more hands** — overwrite is
  desired here, but the user should know that's what's happening

### Session ID field

The review dialog always shows an editable **Session ID**:

- `extractPokerNowGameId(file.name, text)` → pre-fill with that.
- null → pre-fill with a generated fallback (`crypto.randomUUID()` or short slug)
  and show a hint: "couldn't read a PokerNow game id — using a generated one".

### Guard

Two checks against `sessionApi.exists(id)`:

1. **On the extracted id, before opening the dialog** — so an obvious re-upload
   is caught early and the dialog can be pre-filled from the existing row.
2. **On the final `sessionId` at confirm** — the field is editable, so the value
   that actually gets written may differ from what step 1 checked.

```
if await sessionApi.exists(id):
    ┌─ "A session with this ID already exists
    │   (uploaded {created_at} · {player_count} players · {hand_count} hands).
    │   Saving replaces its chart, ledger and settlement."
    │
    │   [ Overwrite ]      → pre-fill the review dialog from the existing row's
    │                         groups / profiles / settlement (merge, not reset),
    │                         then upsert as normal
    │   [ Open existing ]  → navigate(`/admin/session/${id}`), discard the upload
    │   [ Cancel ]         → back to idle / edit the Session ID
    └─
```

### Cleanup notes

- Row overwrite is in place (stable PK) — no stragglers.
- `player_links` rows written by a prior upload are **not** removed on re-upload —
  a link is a league-wide fact, not session-scoped. Intentional.
- A generated-fallback id is **not** stable across re-uploads: re-uploading the
  same id-less export produces a new random id and a new session unless the user
  types the previous id back into the field. Acceptable — id-less exports are the
  exception.

## Identity linking

The app already has a master identity graph the `/admin` flow currently ignores:

| | Master graph (DB) | Admin dialog (today) |
| --- | --- | --- |
| Data | `players` (`id`, `display_name`), `player_links` (`player_id`, `platform` `'pokernow'`\|`'alias'`, `external_id`) | `groups: [[token, …], …]` — lowercased pokerNowId / externalId / name lists, **this upload only** |
| Resolve | `getPlayerDisplayName(name, extId)` / `getLinkedPlayerInfo(entry)`: extId match → name-as-alias match → direct `display_name` match | first group member's raw nickname is the label |
| Edited in | `PlayerManager` tab + `GameEditor` in-place popover | `AdminPlayerLinkDialog` drag-and-drop |
| Persisted | yes | no — dies with the stash |

Wire the two together in two phases.

### Phase 1 — resolve *into* the review dialog (read)

Before rendering `AdminPlayerLinkDialog`, run every parsed entry through the
shared resolver → `{ entry, playerId | null, displayName | null }`, and pre-seed
the dialog:

- entries resolving to the **same `player_id`** start already grouped, labelled
  with the master `display_name`
- entries resolving to a profile but ungrouped are tagged `{ playerId, displayName }`
- unresolved entries behave exactly as today (drag to link, or leave separate)

Profile resolution runs **before** the dialog's existing "Auto-group"
(name-similarity) toggle, which then only operates on the still-unresolved pool.
No writes here — the user is reviewing auto-resolved identities, and repeat
league uploads "just work" without re-dragging. The `displayName` shown in the
dialog is for the reviewer's benefit only; it is not persisted (see rule 5).

### Phase 2 — persist *from* "Create Session" (write)

Each group gains an optional master-profile binding (same UI as the `GameEditor`
popover: pick existing profile / create new). On confirm, per group:

```
ensure players row  (existing playerId, or insert { display_name: primary label })
for each token that is a real pokernow id or seat name:
  if no player_links row for (player_id, external_id):
    insert { player_id, platform: token === extId ? 'pokernow' : 'alias', external_id: token }
```

Same write shape as `GameEditor`'s `handleLinkToExistingPlayer` /
`handleCreateAndLinkPlayer` — factor those + `PlayerManager`'s into one
`linkIdentity(playerId, tokens)` util and call it from all three.

### Prerequisites / rules

1. **Dedupe the resolver first.** `getPlayerDisplayName` / `getLinkedPlayerInfo`
   are copy-pasted in `App.jsx` and `GameEditor.jsx` with divergent shapes.
   Extract one `resolveIdentity(entry, { players, playerLinks })` before adding a
   third caller.
2. **`external_id` is overloaded** (pokernow id *and* alias, split by `platform`).
   Match case-insensitively; admin `groups` tokens are already lowercased.
3. **Only auto-persist `platform: 'pokernow'` links.** A bare-name alias
   (`keyOfEntry` already prefers the pokernow id because two people can share a
   nickname) stays session-local — in `groups`, not written to `player_links` —
   unless the user explicitly confirms it. A wrong alias link mis-attributes
   every future session.
4. **Idempotent writes.** Add `unique (player_id, lower(external_id))` on
   `player_links` and upsert; a failed link write is logged, not fatal to the
   session insert.
5. **Live names.** Nothing freezes a display name. `entries[]` and
   `chart_data.players[]` store `playerId` (+ the raw `nickname`/`name` as
   fallback); `SessionPage` resolves the label from the app's `players` list at
   render, so a profile rename shows through on every old session and a deleted
   profile degrades to the raw nickname.

## Regeneration / staleness

Names are live, so a rename or a new `player_links` entry needs **no**
regeneration — the next page load resolves it. What still can't change without
re-deriving from the CSV:

- **Player grouping** (`groups`) — the merge is baked into `chart_data.nets` and
  `entries` sums. Changing a link after the fact means re-parsing the CSV.
- **Parser / reconcile logic** — improved heuristics don't retroactively apply.

Both are out of scope for v1: there's no stored CSV to re-derive from yet (see
"Raw CSV (deferred)"). `parser_version` is written as a constant so that when the
CSV *is* retained, stale rows are detectable. `chart_data` and `entries` are
always computed together (reconciliation ties the final chart point to the
ledger) — regenerate both or neither.

Practical fix until then: re-upload the CSV with the corrected links in the
review dialog; the collision guard's **Overwrite** replaces the row.

## Impact on the existing app

Rule: the main app must be byte-for-byte behaviourally unchanged. Ship in two
stages so that's verifiable.

### Additive — zero risk, no shared code touched

| Item | Kind |
| --- | --- |
| `admin_sessions` table + `admin_sessions_date_idx` | new |
| `src/utils/sessionApi.js` | new file |
| Session list + **Session ID** field + collision dialog | new UI, admin routes only |
| `raw_csv_path` / `parser_version` columns + `sessionApi` stubs | new, unwritten scaffold |

### Fork points — modify existing code; each is noted in its PR when implementation starts

| File | Change | Why it's safe |
| --- | --- | --- |
| `SessionPage.jsx` | rewrite read path (DB fetch + `loading`/`not-found`/`error` states) | routed component used by **no other page**; the admin surface is its only caller |
| `AdminPage.jsx` | `handleConfirmReview` → async + collision guard + session list | admin route only; main app never mounts it |
| `AdminPlayerLinkDialog.jsx` | add Session ID field + optional profile binding | admin route only |
| `sessionHandoff.js` | keep as-is, demoted to write-through fast path | no signature change; existing callers unaffected |
| `App.jsx` | extract inline `fetchPlayersAndLinks` state → `usePlayers()` hook; `App` consumes the hook | **pure refactor** — same data, same render output; existing `players`/`playerLinks` props to `GameEditor`/`PlayerManager` keep their shape |
| `App.jsx` + `GameEditor.jsx` | extract `getPlayerDisplayName` / `getLinkedPlayerInfo` → one `resolveIdentity()` | **pure refactor** — behaviour-locked by the existing screens' tests |
| `GameEditor.jsx` + `PlayerManager.jsx` | link-insert logic → shared `linkIdentity(playerId, tokens)` | **pure refactor** |
| `player_links` (DB) | add `unique (player_id, lower(external_id))`, inserts → upsert | **behaviour change on the write path** — needs a de-dupe migration first; a previously-silent duplicate insert becomes a no-op. Review separately. |

### Staging

1. **Stage 1 — additive.** `admin_sessions`, `sessionApi`, `SessionPage` DB read,
   session list, collision guard. **No fork points.** For live names in this
   stage `SessionPage` does a self-contained local `players` fetch; the main app
   is not touched. Shippable on its own — admin sessions start persisting.
2. **Stage 2 — identity.** `usePlayers()` / `resolveIdentity()` / `linkIdentity()`
   extractions (collapsing Stage 1's local fetch into the shared hook) and the
   `player_links` constraint + migration. Every file here is a fork point: each
   PR states the fork, ships as a no-behaviour-change refactor verified against
   the existing app's tests, *then* wires the admin flow onto it.

The step-by-step, test-gated breakdown is below.

## Implementation plan

Each step ships and is verified on its own. **Do not start step N+1 until** step
N's acceptance checks pass **and** the main-app smoke is clean:

> Dashboard renders · a `sessions` game opens in `GameEditor` · `PlayerManager`
> lists profiles · the `GameEditor` link-player popover still links / creates /
> unlinks.

Pure-logic steps get a `tests/**/*.test.js` unit test (`npm test`). UI steps get
the acceptance check inline. Refactor steps (9–12) must show a diff with **no
behaviour change**, pass `npm test`, and pass the smoke before anything new is
wired to them.

> **Status:** Stages 1 + 2 implemented. `npm test` 83/83, `npm run build` clean.
> `App.jsx` and everything it renders with props (`GameEditor`, `PlayerManager`,
> `Dashboard`, `csvParser`, `sessionMapper`, …) are **untouched**.
>
> New files: `src/utils/sessionApi.js`, `src/utils/chartData.js`,
> `src/utils/adminIdentity.js`, `src/hooks/useIdentityGraph.js` + tests.
> `admin_sessions` section appended to `supabase_schema.sql` (**run it against
> Supabase before using the flow**). Modified (admin-only): `AdminPage.jsx`,
> `SessionPage.jsx`, `AdminPlayerLinkDialog.jsx`; `isLedgerCsv` exported from
> `parseSessionLedger.js`.
>
> **Stage 2 was forked, not refactored** (per request — no App.jsx changes):
> - `resolveIdentity` → `adminIdentity.resolveEntryIdentity` — a standalone copy
>   of App.jsx's `getPlayerDisplayName` precedence (id → alias → display_name).
>   App.jsx's own copy is left as-is.
> - `usePlayers()` → `useIdentityGraph()` — a new hook fetching `players` +
>   `player_links` with a module-level cache shared by `/admin` and
>   `/admin/session`. App.jsx's inline `fetchPlayersAndLinks` is untouched.
> - `linkIdentity()` → `adminIdentity.ensureProfile` + `linkTokens` — same
>   `players` / `player_links` insert shape as GameEditor, but **idempotent in
>   JS** (check-then-insert). **No `player_links` unique constraint / migration**
>   — that would have changed GameEditor's + PlayerManager's write behaviour.
> - Phase 1 (resolve into dialog) + Phase 2 (bind/create profile per unit on
>   confirm) live entirely in `AdminPage.jsx` + `AdminPlayerLinkDialog.jsx`.
>   `admin_sessions.entries[].playerId`, `.profiles[]`, and
>   `chart_data.players[].playerId` are now populated; `SessionPage` resolves
>   names live via `useIdentityGraph` (ledger, chart legend/tooltip, settlement).
>
> Deviations / additions to the spec above:
> - **Standing bankers.** A player set as the standing bank for a country is
>   auto-placed in that country and made its bank on every upload, even when
>   playing. Source of truth is the `admin_bank_defaults` table (country →
>   `player_id`), edited from a "Standing banks" card on `/admin`
>   (`sessionApi.listBankDefaults` / `setBankDefault`); matched to a seat by its
>   resolved profile id. `src/utils/adminBankDefaults.js` is a name-based
>   fallback for seats that don't resolve. The reviewer can override; an explicit
>   pick (including "No bank") sticks.
> - **Session aliases.** `parseSessionLedger` now returns `aliases[]` (every
>   nickname a seat used); `admin_sessions.entries[].aliases` carries the merged
>   set per player. The Latest Ledger shows `DB Name (alias, alias…)` — the
>   parenthetical is capped ~20 visible chars (whole names, then `…`) and the
>   row's `title` tooltip lists them all.
>
> Absent-banker handling: **if the standing banker didn't play**, a
>   zero-balance `bank:<playerId>` participant is injected so settlement still
>   routes through them — it's labelled "didn't play · bank" in the dialog,
>   hidden from the Latest Ledger, and never written to `player_links`.
> - `chart_data` also stores a `timestamps[]` array (a few KB) so the "Download
>   cumulative net" CSV keeps its timestamp column.
> - **The upload expects the ledger CSV + (optionally) the hand log.** The
>   **ledger CSV is the source of truth** for `entries` (Latest Ledger table +
>   Settlement) and is required — uploaded, or fetched from PokerNow by game id
>   (`fetchPokerNowLedger`, best-effort, `.club` then `.com`). The **hand log is
>   optional** and only builds `chart_data` (the cumulative-net curve); without
>   it the session still saves, just with no chart. `parseSessionLedger`'s
>   hand-log *reconstruction* path (buy-ins inferred from the event stream, then
>   a residual eased to zero) is no longer used by `/admin` — it never matched
>   PokerNow's real `ledger_*.csv`. The upload card is a single drag-and-drop
>   zone (also click-to-browse, multi-select) that auto-sorts each CSV into the
>   ledger / hand-log slot by content, then a Continue button; `SessionPage`
>   renders the ledger independently of the chart.

### Stage 1 — additive (no fork points)

**1 · DB + `sessionApi` scaffold**
- Build: `admin_sessions` table + `admin_sessions_date_idx`. `src/utils/sessionApi.js`
  — `create` / `get` / `list` / `exists` / `remove`; `uploadRawCsv` /
  `downloadRawCsv` as `// TODO` no-ops.
- Touches: new table, new file — nothing imports it yet.
- Check: scratch script / Supabase console — round-trip a row through every
  method.
- Existing app: unaffected.

**2 · `chart_data` serializer + adapter**
- Build: `toChartData(parsed)` → `{ players:[{playerId:null,nickname}], hands, nets }`;
  `fromChartData(chartData)` → the `{ players:Map, snapshots }` shape
  `CumulativeNetChart` consumes. New util `src/utils/chartData.js`.
- Touches: new util.
- Check: unit test — `fromChartData(toChartData(p))` yields an identical chart
  model for a real fixture (deep-equal the derived series); blob ~10–15 KB for a
  long session.
- Existing app: unaffected.

**3 · Persist on confirm**
- Build: `handleConfirmReview` → async; assemble the row (`chart_data` via step 2,
  `entries` with `playerId: null`, `groups`, `settlement`, `player_count`,
  `hand_count`); `await sessionApi.create(...)`; keep stash + navigate; error →
  stay on review with a banner.
- Touches: `AdminPage.jsx` (admin route only).
- Check: upload → confirm → row present with expected shape; stash fast-path
  still renders the session page exactly as today; network down → banner, no
  navigation.
- Existing app: unaffected.

**4 · Read from DB in `SessionPage`**
- Build: stash-miss → `loading` → `sessionApi.get(id)` → `fromChartData` → render;
  `null` → "Session not found"; error → retry. Names = raw nickname. Live-names
  data via a **local `players` fetch inside `SessionPage`** (temporary; replaced
  in step 10).
- Touches: `SessionPage.jsx` (admin route, no other callers).
- Check: upload + confirm, then **hard refresh** the URL → identical view, served
  from DB (network tab); bad id → not-found; offline → error + working retry.
- Existing app: unaffected.

**5 · Session list on `/admin`**
- Build: `sessionApi.list()`; list under the upload card; row = `<Link>` to
  `/admin/session/:id`; `loading` / `empty` / `error`.
- Touches: `AdminPage.jsx`.
- Check: 3 uploads → all shown, newest first, counts right; row click navigates;
  a fresh confirm refetches into the list without reload.
- Existing app: unaffected.

**6 · Session ID field**
- Build: editable field in `AdminPlayerLinkDialog`, prefilled from
  `extractPokerNowGameId` else a generated fallback + hint; `handleConfirmReview`
  writes and routes by that value.
- Touches: `AdminPlayerLinkDialog.jsx`, `AdminPage.jsx`.
- Check: file with id → prefilled; id-less content → fallback + hint; edit field
  → row PK and URL use the edited value.
- Existing app: unaffected.

**7 · Collision guard**
- Build: `sessionApi.exists`; check on the extracted id before the dialog and on
  the final id at confirm; 3-way dialog (Overwrite / Open existing / Cancel);
  Overwrite pre-fills the dialog from the existing row's `groups` / `profiles` /
  `settlement`.
- Touches: `AdminPage.jsx`, `AdminPlayerLinkDialog.jsx`.
- Check: re-upload same file → dialog; Overwrite → one row, counts refreshed;
  Open existing → navigates; Cancel → back to review; edit ID to a free value →
  no prompt.
- Existing app: unaffected.

**8 · Delete**
- Build: `sessionApi.remove` + delete control and confirm in the list.
- Touches: `AdminPage.jsx`.
- Check: delete → row gone, list updates, URL now not-found; `players` /
  `player_links` counts unchanged.
- Existing app: unaffected.

*Stage 1 exit: admin sessions persist, list, overwrite and delete — the main app
has had zero code changes.*

### Stage 2 — identity (fork points)

**9 · Extract `resolveIdentity()`**  *(fork: `App.jsx`, `GameEditor.jsx`)*
- Build: move `getPlayerDisplayName` / `getLinkedPlayerInfo` into
  `src/utils/identity.js`; both call sites use it.
- Check: `npm test` green; smoke clean; diff is extraction-only.

**10 · Extract `usePlayers()`**  *(fork: `App.jsx`, `SessionPage.jsx`)*
- Build: hook wrapping the `players` fetch + a module cache. `App.jsx` uses it for
  the players half of `fetchPlayersAndLinks`; `SessionPage` swaps its step-4 local
  fetch onto it.
- Check: one `players` request in the network tab; dashboard / `PlayerManager`
  names unchanged; `SessionPage` still renders.

**11 · Extract `linkIdentity(playerId, tokens)`**  *(fork: `GameEditor.jsx`, `PlayerManager.jsx`)*
- Build: factor `handleLinkToExistingPlayer` / `handleCreateAndLinkPlayer` +
  `PlayerManager`'s insert into one util.
- Check: link / create+link / unlink in both screens behave exactly as before.

**12 · `player_links` unique constraint + upsert**  *(fork: DB + `linkIdentity`; behaviour change — review separately)*
- Build: de-dupe migration over existing rows; `unique (player_id, lower(external_id))`;
  `linkIdentity` → upsert.
- Check: migration idempotent; duplicate link attempt is a silent no-op;
  existing link flows still work; `player_links` count after re-running a known
  link is unchanged.

**13 · Phase 1 — resolve into the review dialog**  *(touches: `AdminPage.jsx`, `AdminPlayerLinkDialog.jsx`)*
- Build: pre-seed the dialog from `resolveIdentity` (same `player_id` →
  pre-grouped + master label; others tagged); runs before Auto-group.
- Check: upload a CSV whose seats match existing links → those open
  pre-grouped/labelled; unmatched seats behave as today; Auto-group only works
  the rest.

**14 · Phase 2 — persist identities on confirm**  *(touches: `AdminPage.jsx`)*
- Build: per group → `linkIdentity`; write `entries[].playerId`, `profiles[]`,
  `chart_data.players[].playerId`.
- Check: confirm with a newly-bound profile → `players` + `player_links` rows
  created idempotently; row carries `playerId`s; a later re-upload auto-resolves
  with no dragging.

**15 · Live name resolution in `SessionPage`**  *(touches: `SessionPage.jsx`)*
- Build: render `nameOf(playerId) ?? nickname` via `usePlayers()` in the chart
  legend, tooltip and ledger.
- Check: rename a profile in `PlayerManager` → reload an old admin session →
  legend + ledger show the new name; delete the profile → falls back to the raw
  nickname.

### Out of scope for this plan

Raw-CSV storage and `parser_version`-driven regeneration (see "Raw CSV
(deferred)"). Columns and `sessionApi` stubs stay; nothing is wired.

## Resolved decisions

1. **Namespace & id** — separate `admin_sessions` table, keyed on the PokerNow
   game id. When the export has no id, pre-fill a generated fallback. The id is an
   **editable field in the upload dialog** either way. Not promoted into the main
   `sessions` / `ledger` tables.
2. **Auth / RLS** — **not gated.** `admin_sessions` + the `players` /
   `player_links` writes stay open under the anon key, unguessable ids only.
   Revisit if the app gets real auth.
3. **Raw CSV** — **deferred.** Render from `chart_data` + `entries`. Keep the
   `raw_csv_path` column, `parser_version`, and `sessionApi` stubs as scaffold;
   wire up Storage later.
4. **Names** — **live.** Store `playerId` + raw nickname; resolve display names
   from the app's `players` list at render. Renames propagate to old sessions;
   deleted profiles fall back to the raw nickname.
5. **`players` in `SessionPage`** — shared **`usePlayers()`** hook (one fetch,
   module-level cache / context, consumed everywhere). No App-context wiring, no
   per-page duplicate fetch. Bundled with the `resolveIdentity` extraction into
   one identity module.

### Still open

- Whether the `/admin` list needs player-name search before the league outgrows
  a single scroll.
