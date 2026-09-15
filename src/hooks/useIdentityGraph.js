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

export function makeNameResolver(players = [], playerLinks = []) {
  const byId = new Map();
  const byExternal = new Map();
  const byName = new Map();

  for (const p of players || []) {
    if (!p) continue;
    const name = p.display_name || p.name || null;
    if (p.id) {
      byId.set(p.id, name);
      if (name) byName.set(String(name).trim().toLowerCase(), name);
    }
  }

  for (const l of playerLinks || []) {
    if (!l || !l.external_id) continue;
    const pName = byId.get(l.player_id);
    if (pName) {
      byExternal.set(String(l.external_id).trim().toLowerCase(), pName);
    }
  }

  return (key) => {
    if (!key) return null;
    if (byId.has(key)) return byId.get(key);
    const normKey = String(key).trim().toLowerCase();
    if (byExternal.has(normKey)) return byExternal.get(normKey);
    if (byName.has(normKey)) return byName.get(normKey);
    return null;
  };
}

export function makeIdResolver(players = [], playerLinks = []) {
  const byId = new Set();
  const byExternal = new Map();
  const byName = new Map();

  for (const p of players || []) {
    if (!p) continue;
    if (p.id) {
      byId.add(p.id);
      const name = p.display_name || p.name;
      if (name) byName.set(String(name).trim().toLowerCase(), p.id);
    }
  }

  for (const l of playerLinks || []) {
    if (!l || !l.external_id) continue;
    if (l.player_id) {
      byExternal.set(String(l.external_id).trim().toLowerCase(), l.player_id);
    }
  }

  return (key) => {
    if (!key) return null;
    if (byId.has(key)) return key;
    const normKey = String(key).trim().toLowerCase();
    if (byExternal.has(normKey)) return byExternal.get(normKey);
    if (byName.has(normKey)) return byName.get(normKey);
    return null;
  };
}

/**
 * @returns {{ players: Array, playerLinks: Array, loading: boolean, error: Error|null, refresh: () => void, resolve: (key: string) => string|null, nameOf: (key: string) => string|null, resolveId: (key: string) => string|null }}
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

  const resolve = useMemo(
    () => makeNameResolver(state.players, state.playerLinks),
    [state.players, state.playerLinks]
  );
  const resolveId = useMemo(
    () => makeIdResolver(state.players, state.playerLinks),
    [state.players, state.playerLinks]
  );

  return { ...state, resolve, nameOf: resolve, resolveId, refresh };
}

/** Drop the shared cache so the next `useIdentityGraph` mount refetches. */
export function invalidateIdentityGraph() {
  cache = null;
}
