-- =========================================================================
-- POKER TRACKER ENTERPRISE MIGRATION: AUTH, PROFILES, EXTERNAL IDS & RLS
-- =========================================================================

-- 1. BASE TABLE DEFINITIONS
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    date TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    poker_now_url TEXT,
    is_active BOOLEAN DEFAULT false,
    currency TEXT DEFAULT 'USD',
    chip_value NUMERIC DEFAULT 1
);

CREATE TABLE IF NOT EXISTS public.ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID REFERENCES public.sessions(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
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

-- 2. GROUPS & GROUP MEMBERS
CREATE TABLE IF NOT EXISTS public.groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    role TEXT DEFAULT 'member',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

-- 3. EXTERNAL PLAYER IDS & USER ALIASES (Multi-platform mapping)
CREATE TABLE IF NOT EXISTS public.external_player_ids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    platform TEXT NOT NULL, -- e.g., 'pokernow', 'clubgg', 'pokerstars'
    external_id TEXT NOT NULL,
    claimed_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(platform, external_id)
);

CREATE TABLE IF NOT EXISTS public.user_aliases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, alias)
);

-- 4. ENSURE SESSIONS & LEDGER COLUMNS EXIST
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.ledger ADD COLUMN IF NOT EXISTS external_player_id TEXT;
ALTER TABLE public.ledger ADD COLUMN IF NOT EXISTS player_external_id TEXT;
ALTER TABLE public.ledger ADD COLUMN IF NOT EXISTS player_poker_now_id TEXT;
ALTER TABLE public.ledger ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 4.1 PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_session_id ON public.ledger(session_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user_id ON public.ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user_id ON public.group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_id ON public.group_members(group_id);

-- 5. FUNCTION & TRIGGER TO BACKFILL HISTORICAL LEDGER STATS UPON CLAIMING AN ID
CREATE OR REPLACE FUNCTION public.backfill_historical_ledger_on_claim()
RETURNS TRIGGER AS $$
BEGIN
    -- When a new external_player_id is linked to a user, update ledger rows matching external_id or player_name
    UPDATE public.ledger
    SET user_id = NEW.user_id
    WHERE (external_player_id = NEW.external_id OR player_external_id = NEW.external_id OR player_poker_now_id = NEW.external_id OR player_name = NEW.external_id)
      AND user_id IS NULL;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_backfill_historical_ledger ON public.external_player_ids;
CREATE TRIGGER trigger_backfill_historical_ledger
    AFTER INSERT ON public.external_player_ids
    FOR EACH ROW
    EXECUTE FUNCTION public.backfill_historical_ledger_on_claim();

-- 5.1 AUTO-CREATE PROFILE TRIGGER ON AUTH.USERS SIGNUP
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, email, display_name, avatar_url)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
        NEW.raw_user_meta_data->>'avatar_url'
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 6. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_player_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;

-- Profiles: Public read, owner insert & update
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Groups & Members
DROP POLICY IF EXISTS "Groups viewable by members" ON public.groups;
CREATE POLICY "Groups viewable by members" ON public.groups FOR SELECT USING (
    created_by = auth.uid() OR
    id IN (SELECT group_id FROM public.group_members WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Group members viewable by members" ON public.group_members;
CREATE POLICY "Group members viewable by members" ON public.group_members FOR SELECT USING (
    user_id = auth.uid()
);

-- External Player IDs & Aliases: Owner view/manage
DROP POLICY IF EXISTS "Users can manage own external IDs" ON public.external_player_ids;
CREATE POLICY "Users can manage own external IDs" ON public.external_player_ids FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own aliases" ON public.user_aliases;
CREATE POLICY "Users can manage own aliases" ON public.user_aliases FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Sessions & Ledger Hand Privacy RLS:
-- Visible only to session creator/participants or player themselves
DROP POLICY IF EXISTS "Sessions viewable by participants or owner" ON public.sessions;
CREATE POLICY "Sessions viewable by participants or owner" ON public.sessions FOR SELECT USING (
    user_id = auth.uid() OR
    user_id IS NULL OR
    EXISTS (SELECT 1 FROM public.ledger l WHERE l.session_id = sessions.id AND (l.user_id = auth.uid() OR l.user_id IS NULL))
);

DROP POLICY IF EXISTS "Sessions insert/update by owner" ON public.sessions;
CREATE POLICY "Sessions insert/update by owner" ON public.sessions FOR ALL USING (auth.uid() = user_id OR user_id IS NULL);

DROP POLICY IF EXISTS "Ledger viewable if session is viewable or player matches" ON public.ledger;
CREATE POLICY "Ledger viewable if session is viewable or player matches" ON public.ledger FOR SELECT USING (
    user_id = auth.uid() OR
    user_id IS NULL OR
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND (s.user_id = auth.uid() OR s.user_id IS NULL))
);

DROP POLICY IF EXISTS "Ledger insert/update by session owner or player" ON public.ledger;
CREATE POLICY "Ledger insert/update by session owner or player" ON public.ledger FOR ALL USING (
    user_id = auth.uid() OR
    user_id IS NULL OR
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND (s.user_id = auth.uid() OR s.user_id IS NULL))
);
