# Project Agent Memory & Design Guide

This file is the project's committed home for project-intrinsic agent knowledge: build, test, architecture, UI thematics, state management, and sharp edges.

---

## 🎨 Design System & Thematics: Cybernetic Poker HUD (Broadcast Dark Mode)

All UI components and new features must strictly follow the **Cybernetic Broadcast Poker HUD** aesthetic. Avoid generic enterprise SaaS or light-mode styling.

### 1. Color Palette & Semantics
* **Backgrounds & Surfaces**:
  * Deep OLED blacks: `#000000`, `bg-black/90`, `bg-zinc-950`.
  * Glass HUD Cards: `bg-hud-card` with `backdrop-blur-xl` and subtle borders (`border-white/10` or `border-white/15`).
* **Neon Accent Colors**:
  * **Emerald / Neon Green (`#10b981`, `emerald-400`, `emerald-500`)**:
    * Positive profit/cash-out, active state, balanced ledgers (`Balanced ±0`), confirmed checkmarks, primary financial metrics.
    * Glow dropshadows: `drop-shadow-[0_0_8px_rgba(34,197,94,0.8)]` and `shadow-[0_0_10px_rgba(16,185,129,0.3)]`.
  * **Cyan / Neon Blue (`#06b6d4`, `cyan-400`, `cyan-500`)**:
    * Primary interactive controls, active navigation tabs, bank designations, live status badges, link icons, rapid stepper buttons (`±50`, `±100`).
    * Glow focus rings: `focus:border-cyan-400 focus:shadow-[0_0_8px_rgba(6,182,212,0.4)]`.
  * **Rose / Crimson (`#f43f5e`, `rose-400`, `rose-500`)**:
    * Losses, ledger imbalances (`Diff: +X`), destructive actions (delete session/player), validation errors.
    * Imbalance glow: `drop-shadow-[0_0_8px_rgba(244,63,94,0.8)]`.
  * **Zinc / Monochrome (`zinc-400`, `zinc-500`, `zinc-600`)**:
    * Metadata, labels, subtle dividers, inactive tabs, unlinked indicators.

### 2. Typography & Layout Rules
* **Monospace Numbers (`font-mono`)**: All financial figures, chip stacks, net amounts, dates, FX rates, and stepper inputs must use tabular monospace fonts (`tabular-nums font-mono`).
* **Micro-labels**: Uppercase, tracked-out font style (`text-[10px]` or `text-[11px] font-mono font-bold uppercase tracking-wider text-zinc-400`).
* **Full-Width, Zero-Scroll Policy**: Tables and rosters must span 100% width (`w-full`) inside the main layout (`max-w-7xl`). Avoid split-screen squeeze layouts that force horizontal scrolling on 1080p monitors. Use dedicated tabbed views (e.g. *Session Roster & Stacks* vs. *Settlement Checklist*).
* **Corner Reticles (`hud-corner-reticle`)**: Used on high-priority containers, modals, and stat callouts.
* **Custom Cybernetic Controls**: Never use default raw browser `<input type="checkbox">`. Always use cybernetic HUD toggle buttons (`w-5 h-5` square button with neon border and Lucide `<Check />` icon).

---

## 🏛️ Architecture & Database Notes

### 1. Identity Graph & Schema (`players` & `player_links`)
* **`public.players`**: Master player profiles (`id UUID`, `display_name TEXT`, `country TEXT`, `preferred_currency TEXT`).
* **`public.player_links`**: Alias and PokerNow ID mappings (`id UUID`, `player_id UUID`, `external_id TEXT`, `session_name TEXT`, `platform TEXT`).
  * **Column Names**: Always use `player_id` (not `master_player_id`) and `external_id` / `session_name` (not `session_player_name`).
* **Resolution Precedence**:
  1. Direct ID match (`entry.playerId` → `players.id`).
  2. External / PokerNow ID match (`entry.pokerNowId || entry.externalId` → `player_links.external_id`).
  3. Alias match (`entry.name` → `player_links.external_id` or `player_links.session_name`).
  4. Auto Self-Link (`entry.name` → case-insensitive `players.display_name`).

### 2. Local-First & Supabase Hybrid Syncing
* The app operates **offline-first**. All core entities are cached in `localStorage`:
  * `offsuite_games`: Cached list of sessions and ledger entries.
  * `offsuite_players`: Cached master player profiles.
  * `offsuite_player_links`: Cached alias/ID identity mappings.
  * `offsuite_settlement_marks`: Persistent check-off state for settlement checklist items.
* When Supabase credentials exist, mutations are synced directly with the DB, and auto-save is debounced (800ms) with visual status indicators (`Saving...` / `Saved` / `Error`).

### 3. Multi-Currency Regional Banking & Settlement Engine
* Each currency/region (e.g., US = USD, CA = CAD) can have a designated **Bank**.
* **Bank designation is exclusive per currency** (only 1 player per currency can be the bank at a time).
* **Settlement Invariants**:
  * Total session balance must be zero-sum (`Total Buy-Ins == Total Buy-Outs + Total Stacks`).
  * Non-bank players in a country settle their entire net balance with their regional bank in local fiat.
  * Regional banks settle the cross-border aggregate imbalance between each other in USD using live FX rates (`1 / exchangeRates.CAD`).
  * Check-off marks carry stable composite keys (`${sessionId}::${legId}`), ensuring persistent clearing status across reloads.

### 4. CSV & Hand History Parser
* Supports both **Ledger CSVs** (summary buy-in, buy-out, stacks) and **Full Hand History Logs** (hand-by-hand actions).
* Hand log parser computes pre-flop stats:
  * **VPIP %**: `(vpip_hands / hands_played) * 100` (excluding big blind checks without a raise).
  * **PFR %**: `(pfr_hands / hands_played) * 100`.
  * **3-Bet %**: `(three_bet_hands / three_bet_opps) * 100`.
* `mergeSessionEntries`: Incrementally attaches hand stats to session player entries without overwriting manual chip edits.

---

## 🛠️ Verification & Testing Commands

* **Production Build**: `npm run build` (Vite / Rolldown production build)
* **Unit Tests**: `npm test -- --run` (Node native test runner executing all `tests/**/*.test.js`)
* **Code Conventions**: Keep domain math, parser, and settlement algorithms in pure ES modules under `src/utils/` so they can be unit-tested in Node without browser DOM dependencies.
