-- =========================================================================
-- POKER TRACKER ENTERPRISE MIGRATION: AUTH, PROFILES, EXTERNAL IDS & RLS
-- =========================================================================

-- 1. PROFILES TABLE (Linked to Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
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
ALTER TABLE public.ledger ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- 5. FUNCTION & TRIGGER TO BACKFILL HISTORICAL LEDGER STATS UPON CLAIMING AN ID
CREATE OR REPLACE FUNCTION public.backfill_historical_ledger_on_claim()
RETURNS TRIGGER AS $$
BEGIN
    -- When a new external_player_id is linked to a user, update ledger rows matching external_id or player_name
    UPDATE public.ledger
    SET user_id = NEW.user_id
    WHERE (external_player_id = NEW.external_id OR player_name = NEW.external_id)
      AND user_id IS NULL;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_backfill_historical_ledger ON public.external_player_ids;
CREATE TRIGGER trigger_backfill_historical_ledger
    AFTER INSERT ON public.external_player_ids
    FOR EACH ROW
    EXECUTE FUNCTION public.backfill_historical_ledger_on_claim();

-- 6. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_player_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;

-- Profiles: Public read, owner update
CREATE POLICY "Profiles are viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Groups & Members
CREATE POLICY "Groups viewable by members" ON public.groups FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.group_members WHERE group_id = id AND user_id = auth.uid())
);
CREATE POLICY "Group members viewable by members" ON public.group_members FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = group_id AND gm.user_id = auth.uid())
);

-- External Player IDs & Aliases: Owner view/manage
CREATE POLICY "Users can manage own external IDs" ON public.external_player_ids FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own aliases" ON public.user_aliases FOR ALL USING (auth.uid() = user_id);

-- Sessions & Ledger Hand Privacy RLS:
-- Visible only to session creator/participants or player themselves
CREATE POLICY "Sessions viewable by participants or owner" ON public.sessions FOR SELECT USING (
    user_id = auth.uid() OR 
    EXISTS (SELECT 1 FROM public.group_members gm JOIN public.sessions s ON s.user_id = gm.user_id WHERE s.id = sessions.id AND gm.user_id = auth.uid()) OR
    EXISTS (SELECT 1 FROM public.ledger l WHERE l.session_id = sessions.id AND l.user_id = auth.uid()) OR
    user_id IS NULL -- fallback for unauth legacy sessions
);

CREATE POLICY "Sessions insert/update by owner" ON public.sessions FOR ALL USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Ledger viewable if session is viewable or player matches" ON public.ledger FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND (s.user_id = auth.uid() OR s.user_id IS NULL))
);

CREATE POLICY "Ledger insert/update by session owner or player" ON public.ledger FOR ALL USING (
    user_id = auth.uid() OR
    EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = session_id AND (s.user_id = auth.uid() OR s.user_id IS NULL))
);
