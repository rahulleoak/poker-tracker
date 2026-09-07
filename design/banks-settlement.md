# Banks settlement — check-offs + cross-session ledger

## Purpose

Two additions to the settlement surface:

1. **Check-offs on the session Settlement panel** (`SessionPage.jsx`) — a
   persistent "paid / received" toggle per settlement row so the banker can track
   who has actually settled.
2. **`/settlement` + `/settlement/{country}`** — a cross-session ledger: for a
   country, sum every player's net against the bank across *all* sessions, minus
   what's already been checked off, and show who still owes what. If a player
   skipped payment across two or more sessions, the banker sees one total and can
   clear it in one action.

## Current state

The Settlement panel is 100% derived. `computeBankSettlement(entries, config)`
(`src/utils/bankSettlement.js`) runs on every render; nothing about it is stored.
`admin_sessions.settlement` holds only `{ countryByKey, bankByCountry, chipsPerCad,
cadToUsd }`. A check-off is the first piece of *mutable settlement state* in the
app, and the aggregate page is the first thing that needs to query *across*
`admin_sessions` rows — which the admin-session design explicitly keeps the
per-row jsonb blobs out of.

## The units that get settled

`computeBankSettlement` already emits exactly the units a banker settles:

```
per country (CA, US):
  playerTransfers[]   one per non-bank player: "X pays $N to Bank" | "Bank pays $N to X"
  country net         rollup of the above — NOT independently checkable
bankTransfers[]        "Bank A -> Bank B $N"  (the "Between banks" section)
```

Mapping the panel rows to checkable units:

| Panel row | Unit | Checkbox |
| --- | --- | --- |
| `Akarsh pays $52.08 CAD to Adam` | `playerTransfer` (CA, party=Akarsh, →bank) | yes — one mark |
| `Miguel pays $36.20 CAD to Adam` | `playerTransfer` (CA, party=Miguel, →bank) | yes — one mark |
| `Adam BANK · country net +$80.64` | derived rollup | no — read-only; show green when all member rows checked |
| `Rahul pays $40.78 USD to Kush` | `playerTransfer` (US, party=Rahul, →bank) | yes — one mark |
| `Kush BANK · country net −$58.33` | derived rollup | no |
| `Kush → Adam $80.64 CAD` | `bankTransfer` | yes — one mark |

"Settle a player entirely" on the aggregate page = write N of these marks in one
action, one per outstanding session.

### Prerequisite — stable leg identity

`playerTransfers` currently have no id; `bankTransfers` are keyed by array index.
Add a stable `legId` / `partyKey` to each transfer in `computeBankSettlement` so a
mark references a *leg*, not a position:

- `partyKey` = the master `playerId` when the entry resolved to a profile
  (Stage 2 of the admin-session work populates `entries[].playerId`), falling
  back to `keyOfEntry(entry)` only for unlinked seats.
- This is what makes cross-session aggregation possible — `keyOfEntry` varies per
  session (different nicknames); `playerId` does not.

Pure refactor, behaviour-locked by `tests/utils/bankSettlement.test.js`.

## Data model

### Option A — jsonb on the session row (minimal)

```jsonc
// admin_sessions.settlement.marks
[ { "scope": "player", "partyKey": "<playerId|nickkey>", "bankKey": "<playerId>",
    "settledAt": "2026-09-06T...", "settledBy": "adamzartin@gmail.com", "undoneAt": null },
  { "scope": "bank",   "partyKey": "<debtorBankId>", "bankKey": "<creditorBankId>",
    "settledAt": "...", "settledBy": "...", "undoneAt": null } ]
```

- **Pro:** no new table, atomic with the session, matches the "blobs on the row"
  stance.
- **Con:** `/settlement/{country}` must fetch every session's heavy jsonb to
  aggregate — exactly what the admin-session design forbids for cross-session
  reads. Tolerable at league scale, ugly later.

### Option B — dedicated tables (recommended)

Write a denormalised **leg** row per transfer at session-save time (regenerated
alongside `chart_data` / `entries`, same "both or neither" rule), and keep
**marks** separate:

The natural grain is `(session_id, leg_id)` — `leg_id` is `computeBankSettlement`'s
own `player:<key>` / `bank:<from>><to>`, unique within a session and the exact key
`settlement_marks` points at. (An earlier sketch keyed on
`(session_id, scope, party_key)`; that breaks for `bank` scope, where `party_key`
is one endpoint of a pair and isn't unique.)

```sql
-- as shipped in supabase_schema.sql §9
create table admin_session_legs (
  session_id      text not null references admin_sessions(id) on delete cascade,
  leg_id          text not null,             -- 'player:<key>' | 'bank:<from>><to>'
  scope           text not null,             -- 'player' | 'bank'
  country         text,                      -- player: the bank's country; bank: the debtor country
  counter_country text,                      -- bank scope only: the creditor country
  party_key       text not null,             -- master playerId (else keyOfEntry fallback)
  party_name      text,                      -- display fallback (names resolve live otherwise)
  bank_key        text,                      -- the banker's playerId / key at save time
  bank_name       text,
  direction       text not null,             -- 'to_bank' | 'from_bank' | 'bank'
  amount_cad      numeric not null,
  amount_local    numeric not null,          -- converted at THIS session's fx
  currency        text not null,
  session_date    date,
  primary key (session_id, leg_id)
);

create table settlement_marks (
  id               uuid primary key default gen_random_uuid(),
  session_id       text not null references admin_sessions(id) on delete cascade,
  leg_id           text not null,
  scope            text not null,            -- 'player' | 'bank'
  country          text,
  party_key        text not null,
  party_name       text,
  counterparty_key text,
  counterparty_name text,
  direction        text,
  amount_cad       numeric,                  -- snapshot at settle time
  amount_local     numeric,
  currency         text,
  session_date     date,
  settled_by       text,                     -- best effort, anon
  settled_at       timestamptz not null default now(),
  undone_at        timestamptz               -- soft-delete → drives Undo + audit trail
);

create unique index settlement_marks_active_uq
  on settlement_marks (session_id, leg_id)
  where undone_at is null;
```

Legs are derived data: `sessionApi.create` regenerates a session's legs wholesale
after each (re)save (`delete where session_id = $1` + `insert`), and
`sessionApi.ensureLegs()` backfills any session missing them on first
`/settlement` load. No `admin_sessions.countries[]` column was needed — the
`/settlement` index just runs `buildCountrySettlement` per country over the one
`admin_session_legs` fetch.

`/settlement/{country}` is one indexed query:

```sql
select l.*
from admin_session_legs l
left join settlement_marks m
  on (m.session_id, m.leg_id) = (l.session_id, l.leg_id)
  and m.undone_at is null
where l.country = $1
  and l.scope = 'player'
  and m.id is null                          -- outstanding only
order by l.party_key, l.session_date;
```

No blob reads, no per-session `computeBankSettlement` recompute.

### RLS

Not gated, same as the rest of the app — anon read + write, unguessable ids only.
The `settlement_marks_active_uq` partial index makes a double-settle from two
bankers a no-op rather than a duplicate (there is no auth and no locking).

**Recommendation:** build Option B's schema now even if the UI ships in stages.
Migrating marks off jsonb later while preserving audit history is the painful
path.

## `/settlement/{country}` aggregation

Country code comes from the URL, lowercased `COUNTRIES[].code` (`/settlement/ca`,
`/settlement/us`); unknown → "Unknown country".

```
legs   = player-legs for this country, minus active marks
group legs by party_key (master player), then by bank_key:
  owes_bank   = Σ amount where direction = to_bank
  bank_owes   = Σ amount where direction = from_bank
  outstanding = bank_owes − owes_bank
  contributing = [ { session_date, amount, direction, settled? }, ... ]
render one card per party_key with |outstanding| ≥ 0.005
```

- **Group by `bank_key`, not just country.** If a past session used a different
  banker, show separate sub-sections — don't silently merge two people's books.
  `admin_bank_defaults` gives the *current* standing banker for the header label.
- **FX:** the CAD total is a clean Σ of per-session CAD amounts. The local (USD)
  total for a US player must be Σ of each session's USD amount, each converted at
  *that session's* `cadToUsd` — **not** `(Σ CAD) × today's rate`, or the figure
  won't match the cash that changes hands. Show "sum of session amounts" as the
  real number; "at today's rate" only as a greyed secondary.
- `/settlement` (no country) = the same, sectioned per country + the bank↔bank
  block, each country linking to its focused page.

### UI sketch

```
Settlement · 🇨🇦 Canada                    bank: Adam · settles in CAD
Outstanding · 3 players · collect $124.48 · pay $16.82

┌───────────────────────────────────────────────────────────────┐
│ ☐  Akarsh          owes Adam  $88.28 CAD    2 sessions         │
│       ▸ Sep 6  ☐ $52.08      Aug 30  ☐ $36.20                  │
├───────────────────────────────────────────────────────────────┤
│ ☐  Miguel          owes Adam  $36.20 CAD    1 session          │
├───────────────────────────────────────────────────────────────┤
│ ☐  Priya           Adam owes  $16.82 CAD    1 session          │
└───────────────────────────────────────────────────────────────┘

Between banks (Canada ↔ others)
☐  Kush → Adam  $80.64 CAD   (Sep 6)

─ Recently settled ────────────────────────────────────────────
Rahul · $40.78 USD · 12m ago · adamzartin                [Undo]
```

- Top-level ☐ on a player = bulk: writes every outstanding session mark in one
  transaction, returns their ids (feeds the undo toast).
- Per-session ☐ = single mark.
- On the SessionPage panel: checkbox on the left of each member row and each
  "Between banks" row; when checked, dim/strike the row and replace the amount
  with "settled 2h ago" + a small inline Undo.

## Undo

Soft-delete (`undone_at`) + two layers:

1. **Ephemeral toast** after any settle action, holding the mark ids just
   created: `Settled Akarsh · 2 sessions · $88.28  [Undo]`, ~8s. Undo →
   `update settlement_marks set undone_at = now() where id in (...)`.
2. **Persistent "Recently settled" list** on the page (last 24h), each row with
   its own Undo — covers mistakes noticed after the toast is gone, the realistic
   case.

Soft-delete makes undo reversible (redo) and gives a full audit trail.

## Edge cases

- **Partial payments.** v1 is binary (checkbox). `settlement_marks.amount_cad` is
  already per-mark, so "paid $30 of $88" later is a mark with `amount <
  leg.amount` (or multiple marks) — no schema change.
- **Re-upload / Overwrite of a session.** A (re)save redefines the session's
  ledger + settlement config, so `sessionApi.create` **hard-deletes every
  `settlement_marks` row for that `session_id`** — settled or not, no audit
  trail kept. Marks are session-scoped state, not a league-wide fact (unlike
  `player_links`). The banker re-checks off from a clean slate against the new
  numbers. No amount-drift reconciliation needed because no marks survive.
- **Session deleted.** `on delete cascade` drops legs + marks. Extend the
  admin-session delete copy: "…chart, ledger, settlement **and its check-offs**
  are removed."
- **Player is the bank in one session, a player in another.** Keyed by
  `playerId`: bank-role legs are `scope: 'bank'`, player-role legs `scope:
  'player'`. The aggregate card shows only the player-role outstanding.
- **Country with no bank assigned.** Members fall through to the inter-country
  individual pool (existing behaviour). Show them under a "No bank — individual"
  group; pairwise check-offs still work.
- **Unlinked seats (`playerId` null).** `keyOfEntry` can collide across sessions
  ("guest"). Separate "linked profile" rows from "raw nickname" rows visually;
  disable bulk-settle on unlinked.
- **Unbalanced session** (`balanced === false`). Player legs still valid;
  bank↔bank may not net. Warn, still allow player-leg marks.
- **Broke-even players.** Already filtered by `Math.abs(netLocal) >= 0.005`.

## Status — implemented

> Shipped as Stages 0–3 in one pass, **Option B (legs table) included**.
> `npm test` 94/94, `npm run build` clean. The main app (`App.jsx` and
> everything it renders with props) is untouched except two additive `<Route>`s.
>
> **`admin_session_legs` — the denormalised legs table.** `legsFromSession(row)`
> (`src/utils/settlementLedger.js`) flattens `computeBankSettlement` output to
> leg rows; `sessionApi.create` regenerates a session's legs wholesale after
> every (re)save (delete-by-`session_id` + insert). `buildCountrySettlement`
> now takes `{ legs, marks }` — one indexed read, no per-session
> `computeBankSettlement` on the client. `sessionApi.ensureLegs()` self-heals:
> on `/settlement` load it backfills legs for any session that has none yet
> (rows saved before the table existed, or a failed prior write).
>
> New:
> - `admin_session_legs` + `settlement_marks` tables + indexes + RLS — appended
>   to `supabase_schema.sql`. **Run it against Supabase before using the pages.**
> - `src/utils/settlementLedger.js` (`legsFromSession` + `buildCountrySettlement`)
>   (+ `tests/utils/settlementLedger.test.js`).
> - `src/components/SettlementPage.jsx` — `/settlement` index + `/settlement/:country`
>   detail, bulk "settle player" + per-session check-offs, "Recently settled"
>   list, ephemeral undo banner (9s) with a persistent per-row Undo.
> - `sessionApi`: `listLegs`, `ensureLegs`, `listMarks({sessionId?})`,
>   `addMarks(rows)`, `undoMarks(ids)` (soft-delete via `undone_at`).
>
> Modified:
> - `bankSettlement.js` — Stage 0: `playerTransfers` gain `scope` / `legId`
>   (`player:<key>`) / `partyKey` / `partyName` / `bankKey` / `direction`;
>   `bankTransfers` gain `scope` / `legId` (`bank:<from>><to>`). Existing fields
>   unchanged; behaviour-locked by `bankSettlement.test.js`.
> - `SessionPage.jsx` — checkbox on each non-bank member row and each "Between
>   banks" row; toggling writes / soft-deletes a mark; settled rows dim + strike;
>   header links to `/settlement`.
> - `AdminPage.jsx` — "Settlement ledger" card linking to `/settlement`; delete
>   confirm copy mentions check-offs.
> - `App.jsx` — `/settlement` + `/settlement/:country` routes.
>
> Re-upload / Overwrite: `sessionApi.create` hard-deletes all `settlement_marks`
> for that `session_id` after the upsert (settled or not) — the session's
> settlement state starts fresh against the new numbers.
>
> Not done (deferred, as in the plan): partial-amount payments (binary only;
> `amount_cad` is already per-mark so it's a non-breaking add later).

## Staging

| Stage | Scope |
| --- | --- |
| **0** | Add `legId` / `partyKey` to `computeBankSettlement` transfers. Pure refactor, unit-tested against `bankSettlement.test.js`. |
| **1** | `admin_session_legs` + `settlement_marks` tables + `admin_sessions.countries[]`; write legs on session save; `sessionApi` gains `listLegs(country)`, `mark()`, `unmark()`. |
| **2** | Checkboxes in the SessionPage Settlement panel (toggle → `mark` / `unmark`), inline "settled Xm ago" + ephemeral undo. |
| **3** | `/settlement` + `/settlement/{country}` routes: aggregate cards, per-player bulk settle, "Recently settled" list, undo banner. |

Stages 2 and 3 read the same store, so they are independent once Stage 1 lands.

## Impact on the existing app

- `src/utils/bankSettlement.js` — add stable `legId` / `partyKey` to transfers
  (Stage 0). Behaviour-locked by existing tests.
- `src/components/SessionPage.jsx` — settlement panel gains checkboxes (Stage 2).
  Admin route only; no other caller.
- `src/utils/sessionApi.js` — new `listLegs` / `mark` / `unmark`; leg write on
  `create`.
- `src/App.jsx` — two new routes (`/settlement`, `/settlement/:country`). Additive.
- New: `admin_session_legs`, `settlement_marks` tables + `admin_sessions.countries`
  column — append to `supabase_schema.sql`, run against Supabase before use.
</content>
</invoke>
