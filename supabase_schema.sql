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

-- 4. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;

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
