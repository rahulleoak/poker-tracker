# Design Plan: Player Preferred Currency Configuration

This document outlines the architecture, database migrations, API contracts, and user experience updates for introducing player preferred currency configuration.

---

## 1. Context & Motivation

Currently, when creating or uploading a poker session, players are assigned the session's native currency (which defaults to the global currency, e.g., USD or CAD) as a fallback. For games that involve international players, the session creator must manually edit the currency dropdown of every single non-native player to CAD, USD, or EUR for each new session. 

### Goal
Allow player profiles (`players` table) to store a `preferred_currency`.
- When typing a player's name manually or importing a session from a CSV, the system will resolve the player's profile and automatically set their entry currency to their preferred currency.
- Users can view and manage each player's preferred currency in the **Player Manager** tab.

---

## 2. Proposed Changes

```
┌──────────────────────────────────────────────────────────────────┐
│                      1. DATABASE & SCHEMA                        │
│ Add `preferred_currency TEXT DEFAULT 'USD'` to `public.players` │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                         2. API & CACHE                           │
│ • Update `sessionApi` (create/update player selects & updates)   │
│ • Update cache in `useIdentityGraph.js` & `App.jsx` sync        │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                     ┌───────────┴───────────┐
                     ▼                       ▼
┌───────────────────────────┐  ┌───────────────────────────────────┐
│     3. CURATION UI        │  │       4. AUTO-APPLY FLOWS         │
│ Add currency selector inside│  │ • Manual: Typing matches name in  │
│ `PlayerManager.jsx` next  │  │   `GameEditor.jsx` ➔ auto-switches│
│ to the master profiles.   │  │   row dropdown to preference.     │
└───────────────────────────┘  │ • Upload: In `App.jsx` / `/admin` │
                               │   match profiles ➔ prefill row.   │
                               └───────────────────────────────────┘
```

### 2.1 Database Schema
We will add `preferred_currency` to the `public.players` table.

```sql
-- migration.sql / supabase_schema.sql
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS preferred_currency TEXT DEFAULT 'USD';
```

### 2.2 API & Client Layer (`sessionApi.js`)
Update the backend schema queries to fetch and save `preferred_currency`:
- **`createPlayer`**: Insert and return `preferred_currency`.
- **`updatePlayer`**: Permit editing of `preferred_currency`.
- **`listPlayers`** (if it has explicit selects): Select `preferred_currency`.

### 2.3 Cache / Synchronization Layer
- **`App.jsx` (Offline Fallback & Local Storage Cache)**:
  - Cache players to `localStorage` as standard. No schema change needed since it caches the full JSON, but the offline fallback creation must include `preferred_currency`.
- **`src/hooks/useIdentityGraph.js`**:
  - Update `load` to fetch `preferred_currency`:
    ```js
    supabase.from('players').select('id, display_name, country, preferred_currency')
    ```

### 2.4 Curation UI (`PlayerManager.jsx`)
In the Master Player Profiles list:
- Display the player's current preferred currency using a compact, stylish dropdown selector (using `TOP_CURRENCIES` from `formatters.js`).
- Selecting a new value will asynchronously call `sessionApi.updatePlayer(player.id, { preferred_currency: newCurrency })` and refresh the master identity graph (`onUpdate()`).
- Show a loading spinner / saving state in-place.

---

## 3. Auto-Apply Resolution Logic

### 3.1 Manual Entry (`GameEditor.jsx`)
When editing or typing player details:
- In `handleEntryChange(index, field, value)`:
  - When `field === 'name'`, resolve the entry against `playerLinks` or `players` via `getLinkedPlayerInfo`.
  - If a master profile is matched and contains a `preferred_currency`, update `newEntries[index].currency` to that preferred currency.
  - If the player is currently designated as a bank and their currency changes, un-bank them (this safety behavior is already present and matches local rules).

### 3.2 CSV Upload Flow (`App.jsx`)
When importing a standard PokerNow CSV:
- Define `getPlayerProfile(name, externalId)` in `App.jsx` (mirroring `getPlayerDisplayName`).
- Map over parsed CSV entries after creation:
  - If a matched profile exists and contains a non-null `preferred_currency`, assign that currency to the entry.

### 3.3 Admin Review Flow (`AdminPage.jsx`)
During the CSV save/review database entry creation step:
- Retrieve each resolved profile's `preferred_currency`.
- Set `dbEntries.currency` to `preferred_currency` if defined.

---

## 4. Verification & Testing

### 4.1 Unit Testing
Add target unit tests in `tests/utils/playerIdentity.test.js`:
- Verify identity resolution maps to the correct player profile and retrieves their preferred currency.
- Verify CSV pre-mapping correctly assigns the preference.

### 4.2 UI Verification
1. Open the **Players** tab. Create a player profile and change their preferred currency from USD to CAD.
2. Verify saving state occurs and doesn't throw VITE / Supabase offline errors.
3. Open the **Sessions** tab and create a new session. Add a player, type their display name (e.g. CAD profile), and watch their currency automatically toggle to CAD.
4. Upload a CSV containing linked player names, and ensure CAD players are initialized with CAD while others default to the native currency.
