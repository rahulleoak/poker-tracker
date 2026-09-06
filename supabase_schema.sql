-- =========================================================================
-- OFFSUITE DATABASE SCHEMA: SIMPLIFIED LOCAL-FIRST & COLLABORATIVE SESSION LOGGING
-- =========================================================================

-- 1. SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    poker_now_url TEXT,
    is_active BOOLEAN DEFAULT false,
    currency TEXT DEFAULT 'USD',
    chip_value NUMERIC DEFAULT 1
);

-- 2. LEDGER TABLE
CREATE TABLE IF NOT EXISTS public.ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    player_name TEXT,
    buy_in NUMERIC DEFAULT 0,
    cash_out NUMERIC DEFAULT 0,
    hands_played INTEGER DEFAULT 0,
    vpip_hands INTEGER DEFAULT 0,
    pfr_hands INTEGER DEFAULT 0,
    three_bet_opps INTEGER DEFAULT 0,
    three_bet_hands INTEGER DEFAULT 0,
    external_player_id TEXT,
    player_external_id TEXT,
    player_poker_now_id TEXT,
    currency TEXT DEFAULT 'USD',
    is_bank BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_ledger_session_id ON public.ledger(session_id);

-- 3B. PLAYERS AND PLAYER LINKS TABLES
CREATE TABLE IF NOT EXISTS public.players (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.player_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
    session_name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. PERFORMANCE INDEXES FOR PLAYERS & LINKS
CREATE INDEX IF NOT EXISTS idx_player_links_player_id ON public.player_links(player_id);
CREATE INDEX IF NOT EXISTS idx_player_links_session_name ON public.player_links(session_name);

-- 5. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_links ENABLE ROW LEVEL SECURITY;

-- Sessions: Public read and collaborative write access
DROP POLICY IF EXISTS "Sessions viewable by participants or owner" ON public.sessions;
CREATE POLICY "Sessions are viewable by everyone" ON public.sessions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Sessions insert/update by owner" ON public.sessions;
CREATE POLICY "Sessions can be inserted by anyone" ON public.sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Sessions can be updated by anyone" ON public.sessions FOR UPDATE USING (true);
CREATE POLICY "Sessions can be deleted by anyone" ON public.sessions FOR DELETE USING (true);

-- Ledger: Public read and collaborative write access
DROP POLICY IF EXISTS "Ledger viewable if session is viewable or player matches" ON public.ledger;
CREATE POLICY "Ledger is viewable by everyone" ON public.ledger FOR SELECT USING (true);

DROP POLICY IF EXISTS "Ledger insert/update by session owner or player" ON public.ledger;
CREATE POLICY "Ledger can be inserted by anyone" ON public.ledger FOR INSERT WITH CHECK (true);
CREATE POLICY "Ledger can be updated by anyone" ON public.ledger FOR UPDATE USING (true);
CREATE POLICY "Ledger can be deleted by anyone" ON public.ledger FOR DELETE USING (true);

-- Players: Public read and collaborative write access
CREATE POLICY "Players are viewable by everyone" ON public.players FOR SELECT USING (true);
CREATE POLICY "Players can be inserted by anyone" ON public.players FOR INSERT WITH CHECK (true);
CREATE POLICY "Players can be updated by anyone" ON public.players FOR UPDATE USING (true);
CREATE POLICY "Players can be deleted by anyone" ON public.players FOR DELETE USING (true);

-- Player Links: Public read and collaborative write access
CREATE POLICY "Player links are viewable by everyone" ON public.player_links FOR SELECT USING (true);
CREATE POLICY "Player links can be inserted by anyone" ON public.player_links FOR INSERT WITH CHECK (true);
CREATE POLICY "Player links can be updated by anyone" ON public.player_links FOR UPDATE USING (true);
CREATE POLICY "Player links can be deleted by anyone" ON public.player_links FOR DELETE USING (true);

-- =========================================================================
-- 6. ADMIN SESSIONS  (see design/admin-session.md — the /admin CSV upload flow)
--    Separate namespace from `sessions` / `ledger`. Keyed on the PokerNow game
--    id (or a generated fallback). Not gated: public read + write, same as the
--    rest of the app. Render-ready blobs (`chart_data`, `entries`) are the read
--    source; `raw_csv_path` / `parser_version` are reserved scaffold.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_sessions (
    id             TEXT PRIMARY KEY,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by     TEXT,

    date           DATE,
    currency       TEXT NOT NULL DEFAULT 'USD',
    chip_value     NUMERIC NOT NULL DEFAULT 1,
    poker_now_url  TEXT,

    player_count   INT NOT NULL DEFAULT 0,
    hand_count     INT NOT NULL DEFAULT 0,

    chart_data     JSONB NOT NULL,
    entries        JSONB NOT NULL,

    groups         JSONB NOT NULL DEFAULT '[]'::jsonb,
    profiles       JSONB NOT NULL DEFAULT '[]'::jsonb,
    settlement     JSONB NOT NULL DEFAULT '{}'::jsonb,

    raw_csv_path   TEXT,                        -- SCAFFOLD ONLY, not written/read yet
    parser_version INT NOT NULL DEFAULT 1       -- SCAFFOLD ONLY
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_date ON public.admin_sessions(date DESC);

-- Keep updated_at fresh on every update/upsert-conflict.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_sessions_touch ON public.admin_sessions;
CREATE TRIGGER trg_admin_sessions_touch
  BEFORE UPDATE ON public.admin_sessions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_sessions readable by everyone" ON public.admin_sessions;
CREATE POLICY "admin_sessions readable by everyone" ON public.admin_sessions FOR SELECT USING (true);
DROP POLICY IF EXISTS "admin_sessions insertable by anyone" ON public.admin_sessions;
CREATE POLICY "admin_sessions insertable by anyone" ON public.admin_sessions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS "admin_sessions updatable by anyone" ON public.admin_sessions;
CREATE POLICY "admin_sessions updatable by anyone" ON public.admin_sessions FOR UPDATE USING (true);
DROP POLICY IF EXISTS "admin_sessions deletable by anyone" ON public.admin_sessions;
CREATE POLICY "admin_sessions deletable by anyone" ON public.admin_sessions FOR DELETE USING (true);

-- =========================================================================
-- 7. ADMIN BANK DEFAULTS  (standing banker per country for the /admin review
--    dialog — see src/utils/adminBankDefaults.js for the name-based fallback)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_bank_defaults (
    country    TEXT PRIMARY KEY,                 -- code from src/utils/countries.js ('CA' | 'US')
    player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_bank_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_bank_defaults readable by everyone" ON public.admin_bank_defaults;
CREATE POLICY "admin_bank_defaults readable by everyone" ON public.admin_bank_defaults FOR SELECT USING (true);
DROP POLICY IF EXISTS "admin_bank_defaults writable by anyone" ON public.admin_bank_defaults;
CREATE POLICY "admin_bank_defaults writable by anyone" ON public.admin_bank_defaults FOR ALL USING (true) WITH CHECK (true);

-- =========================================================================
-- 8. SETTLEMENT MARKS  (see design/banks-settlement.md)
--    One row per settled leg. A "leg" is a single player's whole net with
--    their country's bank for one session (`computeBankSettlement` emits one
--    per non-bank member as `player:<key>`), or one inter-bank transfer
--    (`bank:<from>><to>`). Rows are never hard-deleted — Undo sets `undone_at`
--    so the history survives. Not gated: public read + write.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.settlement_marks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id       TEXT NOT NULL REFERENCES public.admin_sessions(id) ON DELETE CASCADE,
    leg_id           TEXT NOT NULL,               -- 'player:<key>' | 'bank:<from>><to>'
    scope            TEXT NOT NULL,               -- 'player' | 'bank'
    country          TEXT,                        -- 'CA' | 'US'; null for inter-bank legs

    party_key        TEXT NOT NULL,               -- master playerId when resolved, else keyOfEntry / bank fromKey
    party_name       TEXT,                        -- snapshot label for the Recently-settled list
    counterparty_key TEXT,                        -- master playerId of the bank, when resolved
    counterparty_name TEXT,                       -- the bank (player scope) / creditor bank (bank scope)
    direction        TEXT,                        -- 'to_bank' | 'from_bank' | 'bank'

    amount_cad       NUMERIC,                     -- snapshot at settle time
    amount_local     NUMERIC,
    currency         TEXT,
    session_date     DATE,

    settled_by       TEXT,                        -- best effort, anon
    settled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    undone_at        TIMESTAMPTZ                  -- non-null => reverted
);

-- Additive for deployments created before counterparty_key existed.
ALTER TABLE public.settlement_marks ADD COLUMN IF NOT EXISTS counterparty_key TEXT;

-- At most one active mark per leg; an undone row can coexist with a fresh one.
CREATE UNIQUE INDEX IF NOT EXISTS settlement_marks_active_uq
  ON public.settlement_marks (session_id, leg_id) WHERE undone_at IS NULL;
CREATE INDEX IF NOT EXISTS settlement_marks_country_idx
  ON public.settlement_marks (country) WHERE undone_at IS NULL;

ALTER TABLE public.settlement_marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settlement_marks readable by everyone" ON public.settlement_marks;
CREATE POLICY "settlement_marks readable by everyone" ON public.settlement_marks FOR SELECT USING (true);
DROP POLICY IF EXISTS "settlement_marks writable by anyone" ON public.settlement_marks;
CREATE POLICY "settlement_marks writable by anyone" ON public.settlement_marks FOR ALL USING (true) WITH CHECK (true);
