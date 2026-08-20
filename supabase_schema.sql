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
    platform TEXT NOT NULL DEFAULT 'pokernow',
    external_id TEXT NOT NULL,
    UNIQUE(platform, external_id)
);

-- 4. PERFORMANCE INDEXES FOR PLAYERS & LINKS
CREATE INDEX IF NOT EXISTS idx_player_links_player_id ON public.player_links(player_id);
CREATE INDEX IF NOT EXISTS idx_player_links_external_id ON public.player_links(external_id);

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
