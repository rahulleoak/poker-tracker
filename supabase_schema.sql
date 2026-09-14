-- =========================================================================
-- OFFSUITE DATABASE SCHEMA: SIMPLIFIED LOCAL-FIRST & COLLABORATIVE SESSION LOGGING
-- =========================================================================

-- 1. SESSIONS TABLE
CREATE TABLE IF NOT EXISTS public.sessions (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    poker_now_url TEXT,
    is_active BOOLEAN DEFAULT false,
    currency TEXT DEFAULT 'USD',
    chip_value NUMERIC DEFAULT 1
);

-- 2. LEDGER TABLE
CREATE TABLE IF NOT EXISTS public.ledger (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
CREATE TABLE IF NOT EXISTS public.players (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name TEXT NOT NULL UNIQUE,
    country TEXT,                          -- 'CA' | 'US' (see src/utils/countries.js); null = unset
    preferred_currency TEXT DEFAULT 'USD',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Additive for deployments created before the country/currency columns existed.
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS preferred_currency TEXT DEFAULT 'USD';

CREATE TABLE IF NOT EXISTS public.player_links (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    player_id UUID REFERENCES public.players(id) ON DELETE CASCADE,
    platform TEXT DEFAULT 'pokernow',
    external_id TEXT,
    external_player_id TEXT,
    session_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Additive for deployments created before platform/external_id columns existed.
ALTER TABLE public.player_links ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'pokernow';
ALTER TABLE public.player_links ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.player_links ADD COLUMN IF NOT EXISTS external_player_id TEXT;
ALTER TABLE public.player_links ADD COLUMN IF NOT EXISTS session_name TEXT;

-- 4. PERFORMANCE INDEXES FOR PLAYERS & LINKS
CREATE INDEX IF NOT EXISTS idx_player_links_player_id ON public.player_links(player_id);
CREATE INDEX IF NOT EXISTS idx_player_links_external_id ON public.player_links(external_id);
CREATE INDEX IF NOT EXISTS idx_player_links_session_name ON public.player_links(session_name);

-- 5. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_links ENABLE ROW LEVEL SECURITY;

-- Sessions: Public read and collaborative write access
DROP POLICY IF EXISTS \"Sessions viewable by participants or owner\" ON public.sessions;
DROP POLICY IF EXISTS \"Sessions are viewable by everyone\" ON public.sessions;
CREATE POLICY \"Sessions are viewable by everyone\" ON public.sessions FOR SELECT USING (true);

DROP POLICY IF EXISTS \"Sessions insert/update by owner\" ON public.sessions;
DROP POLICY IF EXISTS \"Sessions can be inserted by anyone\" ON public.sessions;
CREATE POLICY \"Sessions can be inserted by anyone\" ON public.sessions FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS \"Sessions can be updated by anyone\" ON public.sessions;
CREATE POLICY \"Sessions can be updated by anyone\" ON public.sessions FOR UPDATE USING (true);

DROP POLICY IF EXISTS \"Sessions can be deleted by anyone\" ON public.sessions;
CREATE POLICY \"Sessions can be deleted by anyone\" ON public.sessions FOR DELETE USING (true);

-- Ledger: Public read and collaborative write access
DROP POLICY IF EXISTS \"Ledger viewable if session is viewable or player matches\" ON public.ledger;
DROP POLICY IF EXISTS \"Ledger is viewable by everyone\" ON public.ledger;
CREATE POLICY \"Ledger is viewable by everyone\" ON public.ledger FOR SELECT USING (true);

DROP POLICY IF EXISTS \"Ledger insert/update by session owner or player\" ON public.ledger;
DROP POLICY IF EXISTS \"Ledger can be inserted by anyone\" ON public.ledger;
CREATE POLICY \"Ledger can be inserted by anyone\" ON public.ledger FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS \"Ledger can be updated by anyone\" ON public.ledger;
CREATE POLICY \"Ledger can be updated by anyone\" ON public.ledger FOR UPDATE USING (true);

DROP POLICY IF EXISTS \"Ledger can be deleted by anyone\" ON public.ledger;
CREATE POLICY \"Ledger can be deleted by anyone\" ON public.ledger FOR DELETE USING (true);

-- Players: Public read and collaborative write access
DROP POLICY IF EXISTS \"Players are viewable by everyone\" ON public.players;
CREATE POLICY \"Players are viewable by everyone\" ON public.players FOR SELECT USING (true);

DROP POLICY IF EXISTS \"Players can be inserted by anyone\" ON public.players;
CREATE POLICY \"Players can be inserted by anyone\" ON public.players FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS \"Players can be updated by anyone\" ON public.players;
CREATE POLICY \"Players can be updated by anyone\" ON public.players FOR UPDATE USING (true);

DROP POLICY IF EXISTS \"Players can be deleted by anyone\" ON public.players;
CREATE POLICY \"Players can be deleted by anyone\" ON public.players FOR DELETE USING (true);

-- Player Links: Public read and collaborative write access
DROP POLICY IF EXISTS \"Player links are viewable by everyone\" ON public.player_links;
CREATE POLICY \"Player links are viewable by everyone\" ON public.player_links FOR SELECT USING (true);

DROP POLICY IF EXISTS \"Player links can be inserted by anyone\" ON public.player_links;
CREATE POLICY \"Player links can be inserted by anyone\" ON public.player_links FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS \"Player links can be updated by anyone\" ON public.player_links;
CREATE POLICY \"Player links can be updated by anyone\" ON public.player_links FOR UPDATE USING (true);

DROP POLICY IF EXISTS \"Player links can be deleted by anyone\" ON public.player_links;
CREATE POLICY \"Player links can be deleted by anyone\" ON public.player_links FOR DELETE USING (true);

-- =========================================================================
-- 6. PROCESSED SESSIONS & ANALYTICS
--    Stores structured session data, hand charts, and ledger entries.
--    Render-ready blobs (`chart_data`, `entries`) drive session analytics.
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

    raw_csv_path   TEXT,
    parser_version INT NOT NULL DEFAULT 1
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

DROP POLICY IF EXISTS \"admin_sessions readable by everyone\" ON public.admin_sessions;
CREATE POLICY \"admin_sessions readable by everyone\" ON public.admin_sessions FOR SELECT USING (true);
DROP POLICY IF EXISTS \"admin_sessions insertable by anyone\" ON public.admin_sessions;
CREATE POLICY \"admin_sessions insertable by anyone\" ON public.admin_sessions FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS \"admin_sessions updatable by anyone\" ON public.admin_sessions;
CREATE POLICY \"admin_sessions updatable by anyone\" ON public.admin_sessions FOR UPDATE USING (true);
DROP POLICY IF EXISTS \"admin_sessions deletable by anyone\" ON public.admin_sessions;
CREATE POLICY \"admin_sessions deletable by anyone\" ON public.admin_sessions FOR DELETE USING (true);

-- =========================================================================
-- 7. BANK DEFAULTS
--    Standing banker per country (see src/utils/countries.js).
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_bank_defaults (
    country    TEXT PRIMARY KEY,                 -- code from src/utils/countries.js ('CA' | 'US')
    player_id  UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_bank_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS \"admin_bank_defaults readable by everyone\" ON public.admin_bank_defaults;
CREATE POLICY \"admin_bank_defaults readable by everyone\" ON public.admin_bank_defaults FOR SELECT USING (true);
DROP POLICY IF EXISTS \"admin_bank_defaults writable by anyone\" ON public.admin_bank_defaults;
CREATE POLICY \"admin_bank_defaults writable by anyone\" ON public.admin_bank_defaults FOR ALL USING (true) WITH CHECK (true);

-- =========================================================================
-- 8. SETTLEMENT MARKS
--    One row per settled leg. Rows are never hard-deleted — Undo sets
--    `undone_at` so the transaction history survives.
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

DROP POLICY IF EXISTS \"settlement_marks readable by everyone\" ON public.settlement_marks;
CREATE POLICY \"settlement_marks readable by everyone\" ON public.settlement_marks FOR SELECT USING (true);
DROP POLICY IF EXISTS \"settlement_marks writable by anyone\" ON public.settlement_marks;
CREATE POLICY \"settlement_marks writable by anyone\" ON public.settlement_marks FOR ALL USING (true) WITH CHECK (true);

-- =========================================================================
-- 9. SESSION SETTLEMENT LEGS
--    Denormalised settlement breakdown: one row per checkable unit
--    (`computeBankSettlement` playerTransfer / bankTransfer), written at
--    session-save time so the /settlement roll-up is one indexed query.
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_session_legs (
    session_id      TEXT NOT NULL REFERENCES public.admin_sessions(id) ON DELETE CASCADE,
    leg_id          TEXT NOT NULL,               -- 'player:<key>' | 'bank:<from>><to>'
    scope           TEXT NOT NULL,               -- 'player' | 'bank'
    country         TEXT,                        -- player: the bank's country; bank: the debtor country
    counter_country TEXT,                        -- bank scope only: the creditor country

    party_key       TEXT NOT NULL,               -- master playerId when resolved, else keyOfEntry
    party_name      TEXT,                        -- display fallback (names resolve live otherwise)
    bank_key        TEXT,                        -- the banker's playerId / key at save time
    bank_name       TEXT,
    direction       TEXT NOT NULL,               -- 'to_bank' | 'from_bank' | 'bank'

    amount_cad      NUMERIC NOT NULL,            -- canonical
    amount_local    NUMERIC NOT NULL,            -- converted at THIS session's fx
    currency        TEXT NOT NULL,
    session_date    DATE,

    PRIMARY KEY (session_id, leg_id)
);

CREATE INDEX IF NOT EXISTS admin_session_legs_country_idx
  ON public.admin_session_legs (country, scope);
CREATE INDEX IF NOT EXISTS admin_session_legs_party_idx
  ON public.admin_session_legs (party_key);

ALTER TABLE public.admin_session_legs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS \"admin_session_legs readable by everyone\" ON public.admin_session_legs;
CREATE POLICY \"admin_session_legs readable by everyone\" ON public.admin_session_legs FOR SELECT USING (true);
DROP POLICY IF EXISTS \"admin_session_legs writable by anyone\" ON public.admin_session_legs;
CREATE POLICY \"admin_session_legs writable by anyone\" ON public.admin_session_legs FOR ALL USING (true) WITH CHECK (true);
