import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { AuthContext } from './AuthContextDef';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(!supabase);

  const fetchProfile = useCallback(async (userId, userEmail) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code === 'PGRST116') {
        const { data: newProfile, error: insertError } = await supabase
          .from('profiles')
          .insert([{ id: userId, email: userEmail, display_name: userEmail?.split('@')[0] }])
          .select()
          .single();
        if (!insertError) setProfile(newProfile);
      } else if (data) {
        setProfile(data);
      }
    } catch (err) {
      console.error("Error fetching user profile:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id, session.user.email);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id, session.user.email);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      subscription?.unsubscribe();
    };
  }, [fetchProfile]);

  const signInWithEmail = async (email, password) => {
    if (!supabase) throw new Error("Supabase is not configured");
    return supabase.auth.signInWithPassword({ email, password });
  };

  const signUpWithEmail = async (email, password) => {
    if (!supabase) throw new Error("Supabase is not configured");
    return supabase.auth.signUp({ email, password });
  };

  const signInWithMagicLink = async (email) => {
    if (!supabase) throw new Error("Supabase is not configured");
    return supabase.auth.signInWithOtp({ email });
  };

  const signInWithOAuth = async (provider) => {
    if (!supabase) throw new Error("Supabase is not configured");
    return supabase.auth.signInWithOAuth({ provider });
  };

  const signOut = async () => {
    if (!supabase) return;
    return supabase.auth.signOut();
  };

  const value = {
    user,
    profile,
    loading,
    signInWithEmail,
    signUpWithEmail,
    signInWithMagicLink,
    signInWithOAuth,
    signOut
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
