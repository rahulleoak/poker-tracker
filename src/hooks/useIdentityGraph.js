import { useCallback, useEffect, useState, useMemo } from 'react';
import { supabase } from '../utils/supabase';

// Admin-only shared fetch of the master identity graph (`players` +
// `player_links`). A standalone fork — it does NOT touch App.jsx's
// `fetchPlayersAndLinks`. A module-level cache lets /admin and /admin/session
// share a single round trip within a session.

let cache = null; // { players, playerLinks }
let inflight = null;

async function load() {
  if (!supabase) return { players: [], playerLinks: [] };
  const [players, playerLinks] = await Promise.all([
    supabase.from('players').select('id, display_name, country, preferred_currency'),
    supabase.from('player_links').select('id, player_id, platform, external_id')
  ]);
  return {
    players: Array.isArray(players.data) ? players.data : [],
    playerLinks: Array.isArray(playerLinks.data) ? playerLinks.data : []
  };
}

export function makeNameResolver(players = []) {
  const map = new Map();
  for (const p of players || []) {
    if (p && p.id) {
      map.set(p.id, p.display_name || p.name || null);
    }
  }
  return (key) => {
    if (!key) return null;
    return map.get(key) || null;
  };
}

/**
 * @returns {{ players: Array, playerLinks: Array, loading: boolean, error: Error|null, refresh: () => void, resolve: (key: string) => string|null, nameOf: (key: string) => string|null }}
 */
export function useIdentityGraph() {
  const [state, setState] = useState(() =>
    cache
      ? { ...cache, loading: false, error: null }
      : { players: [], playerLinks: [], loading: true, error: null }
  );

  const run = useCallback((force) => {
    if (cache && !force) {
      setState({ ...cache, loading: false, error: null });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    if (force || !inflight) {
      inflight = load().finally(() => {
        inflight = null;
      });
    }
    inflight
      .then((graph) => {
        cache = graph;
        setState({ ...graph, loading: false, error: null });
      })
      .catch((error) => {
        console.error('useIdentityGraph: load failed', error);
        setState((s) => ({ ...s, loading: false, error }));
      });
  }, []);

  useEffect(() => {
    run(false);
  }, [run]);

  const refresh = useCallback(() => run(true), [run]);

  const resolve = useMemo(() => makeNameResolver(state.players), [state.players]);

  return { ...state, resolve, nameOf: resolve, refresh };
}

/** Drop the shared cache so the next `useIdentityGraph` mount refetches. */
export function invalidateIdentityGraph() {
  cache = null;
}
