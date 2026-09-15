// Admin-only identity resolution + linking.
//
// This is a standalone FORK of the logic that lives inline in App.jsx
// (`getPlayerDisplayName`) and GameEditor.jsx (`handleLinkToExistingPlayer` /
// `handleCreateAndLinkPlayer`). Those files are intentionally left untouched, so
// the main app is unaffected. See design/admin-session.md, Stage 2.
//
// It talks to the same `players` / `player_links` tables the main app uses, but
// only ever adds rows (idempotently) — it never alters or deletes existing ones,
// and it does not depend on any DB unique constraint.
//
// `supabase` is imported lazily inside the write helpers so the pure resolution
// functions stay importable outside a Vite context (tests, node scripts).

const norm = (v) => String(v || '').trim().toLowerCase();

// A PokerNow player id is an opaque ~alphanumeric token; a seat alias usually
// isn't. Used only to tag `player_links.platform`, same as GameEditor.
const looksLikePokerNowId = (token) => {
  const t = String(token || '').trim();
  return t.length >= 6 && /^[A-Za-z0-9_-]+$/.test(t);
};

/**
 * Resolve one parsed ledger entry to a master profile, mirroring App.jsx's
 * `getPlayerDisplayName` precedence: external-id match → name-as-alias match →
 * direct display_name match.
 *
 * @param {{ name?: string, pokerNowId?: string, externalId?: string }} entry
 * @param {{ players?: Array<{id: string, display_name: string}>, playerLinks?: Array<{player_id: string, external_id: string}> }} graph
 * @returns {{ playerId: string, displayName: string, matchedBy: 'id'|'alias'|'name' } | null}
 */
export function resolveEntryIdentity(entry, { players = [], playerLinks = [] } = {}) {
  const name = norm(entry?.name);
  const extId = norm(entry?.pokerNowId || entry?.externalId);
  const playerById = new Map(players.map((p) => [p.id, p]));

  if (extId) {
    const link = playerLinks.find((l) => norm(l.external_id) === extId);
    const p = link && playerById.get(link.player_id);
    if (p) return { playerId: p.id, displayName: p.display_name, matchedBy: 'id' };
  }
  if (name) {
    const link = playerLinks.find((l) => norm(l.external_id) === name);
    const p = link && playerById.get(link.player_id);
    if (p) return { playerId: p.id, displayName: p.display_name, matchedBy: 'alias' };
  }
  if (name) {
    const p = players.find((x) => norm(x.display_name) === name);
    if (p) return { playerId: p.id, displayName: p.display_name, matchedBy: 'name' };
  }
  return null;
}

/**
 * `(playerId) => display_name | null` over the given profile list. Safe on null.
 */
export function makeNameResolver(players = [], playerLinks = []) {
  const byId = new Map(players.map((p) => [p.id, p.display_name || p.name || null]));
  const byExternal = new Map();
  const byName = new Map();

  for (const p of players || []) {
    if (!p) continue;
    const name = p.display_name || p.name;
    if (name) byName.set(norm(name), name);
  }

  for (const l of playerLinks || []) {
    if (!l || !l.external_id) continue;
    const pName = byId.get(l.player_id);
    if (pName) {
      byExternal.set(norm(l.external_id), pName);
    }
  }

  return (key) => {
    if (!key) return null;
    if (byId.has(key)) return byId.get(key);
    const k = norm(key);
    if (byExternal.has(k)) return byExternal.get(k);
    if (byName.has(k)) return byName.get(k);
    return null;
  };
}

/**
 * Find-or-create a `players` row by display name (case-insensitive).
 *
 * @param {string} displayName
 * @param {{ players?: Array<{id: string, display_name: string}> }} ctx
 * @returns {Promise<string|null>} the profile id, or null if it couldn't be made
 */
export async function ensureProfile(displayName, { players = [] } = {}) {
  const wanted = String(displayName || '').trim();
  if (!wanted) return null;

  const existing = players.find((p) => norm(p.display_name) === norm(wanted));
  if (existing) return existing.id;

  const { supabase } = await import('./supabase.js');
  if (!supabase) return null;

  const { data, error } = await supabase
    .from('players')
    .insert([{ display_name: wanted }])
    .select('id')
    .single();

  if (!error) return data?.id || null;

  // Raced another writer to the same name (display_name is UNIQUE) — re-read.
  const { data: again } = await supabase
    .from('players')
    .select('id')
    .ilike('display_name', wanted)
    .maybeSingle();
  return again?.id || null;
}

/**
 * Idempotently link identity tokens (PokerNow ids and/or seat names) to a
 * profile. Only tokens not already linked to *this* profile are inserted, so no
 * DB unique constraint is required and the main app's writes are unaffected.
 *
 * @param {string} playerId
 * @param {Array<string>} tokens - raw PokerNow player ids or seat names
 * @param {{ playerLinks?: Array<{player_id: string, external_id: string}> }} ctx
 * @returns {Promise<number>} count of newly created links
 */
export async function linkTokens(playerId, tokens = [], { playerLinks = [] } = {}) {
  if (!playerId) return 0;
  const cleaned = Array.from(new Set((tokens || []).map((t) => String(t || '').trim()).filter(Boolean)));
  if (cleaned.length === 0) return 0;

  const linkedToThis = new Set(
    (playerLinks || [])
      .filter((l) => l.player_id === playerId)
      .map((l) => norm(l.external_id))
  );

  const needed = cleaned.filter((t) => !linkedToThis.has(norm(t)));
  if (needed.length === 0) return 0;

  const { supabase } = await import('./supabase.js');
  if (!supabase) return 0;

  const rows = needed.map((token) => ({
    player_id: playerId,
    platform: looksLikePokerNowId(token) ? 'pokernow' : 'alias',
    external_id: token
  }));

  const { data, error } = await supabase.from('player_links').insert(rows).select('id');
  if (error) throw error;
  return data?.length || 0;
}
