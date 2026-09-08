// Thin wrapper over the `admin_sessions` table for the /admin CSV upload flow.
// See design/admin-session.md. The app has no API server — this talks to
// Supabase directly with the anon key, same pattern as App.jsx / GameEditor.jsx.

import { supabase } from './supabase';
import { legsFromSession } from './settlementLedger';

const LIST_COLUMNS =
  'id, date, currency, poker_now_url, player_count, hand_count, created_at, updated_at';

const LEG_COLUMNS =
  'session_id, leg_id, scope, country, counter_country, party_key, party_name, ' +
  'bank_key, bank_name, direction, amount_cad, amount_local, currency, session_date';

/** Replace a session's denormalised settlement legs (derived data). */
async function rebuildLegs(sessionRow) {
  if (!supabase || !sessionRow?.id) return;
  const { error: delErr } = await supabase
    .from('admin_session_legs')
    .delete()
    .eq('session_id', sessionRow.id);
  if (delErr) {
    console.warn('sessionApi: failed to clear session legs:', delErr.message);
    return;
  }
  const legs = legsFromSession(sessionRow);
  if (legs.length === 0) return;
  const { error: insErr } = await supabase.from('admin_session_legs').insert(legs);
  if (insErr) console.warn('sessionApi: failed to write session legs:', insErr.message);
}

/**
 * Insert or replace an admin session row. Upserts on the primary key so a
 * re-upload of the same PokerNow game overwrites rather than duplicating.
 *
 * A (re)save redefines the session's ledger + settlement config from scratch, so
 * every settlement check-off for this id is dropped — settled or not. Marks are
 * session-scoped state, not a league-wide fact.
 *
 * @param {Object} row - full `admin_sessions` row (see design doc for shape)
 * @returns {Promise<Object>} the stored row
 */
async function create(row) {
  if (!supabase) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / _ANON_KEY).');
  const { data, error } = await supabase
    .from('admin_sessions')
    .upsert(row, { onConflict: 'id' })
    .select()
    .single();
  if (error) throw error;
  if (row?.id) {
    const { error: wipeErr } = await supabase
      .from('settlement_marks')
      .delete()
      .eq('session_id', row.id);
    if (wipeErr) console.warn('sessionApi.create: failed to clear settlement marks:', wipeErr.message);
    await rebuildLegs(row);
  }
  return data;
}

/**
 * Fetch one session by id. Returns null when nothing matches (or Supabase is
 * not configured).
 *
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function get(id) {
  if (!supabase || !id) return null;
  const { data, error } = await supabase
    .from('admin_sessions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Lightweight list for the /admin index — never selects the heavy jsonb blobs.
 *
 * @returns {Promise<Array<Object>>} newest first
 */
async function list() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('admin_sessions')
    .select(LIST_COLUMNS)
    .order('date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Does a session with this id already exist? Used by the collision guard.
 *
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function exists(id) {
  if (!supabase || !id) return false;
  const { count, error } = await supabase
    .from('admin_sessions')
    .select('id', { count: 'exact', head: true })
    .eq('id', id);
  if (error) throw error;
  return (count || 0) > 0;
}

/**
 * Delete a session. Player profiles and links are league-wide facts and are
 * left untouched.
 *
 * @param {string} id
 */
async function remove(id) {
  if (!supabase || !id) return;
  const { error } = await supabase.from('admin_sessions').delete().eq('id', id);
  if (error) throw error;
  // TODO: not wired up — also remove `${id}.csv.gz` from Storage once the raw
  // CSV is retained (see "Raw CSV (deferred)" in the design doc).
}

// --- Cross-session settlement (admin_session_legs + settlement_marks) ---------

/**
 * Denormalised settlement legs for the /settlement roll-up. One light indexed
 * read — the heavy `chart_data` / `entries` blobs are never touched.
 *
 * @returns {Promise<Array<Object>>}
 */
async function listLegs() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('admin_session_legs')
    .select(LEG_COLUMNS)
    .order('session_date', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

/**
 * Backfill / self-heal: build legs for any session that has none yet (rows
 * saved before the legs table, or a prior write that failed). Cheap no-op once
 * every session is covered.
 *
 * @returns {Promise<number>} sessions backfilled
 */
async function ensureLegs() {
  if (!supabase) return 0;
  const [sessRes, legRes] = await Promise.all([
    supabase.from('admin_sessions').select('id'),
    supabase.from('admin_session_legs').select('session_id')
  ]);
  if (sessRes.error || legRes.error) return 0;

  const covered = new Set((legRes.data || []).map((r) => r.session_id));
  const missing = (sessRes.data || []).map((r) => r.id).filter((id) => !covered.has(id));
  if (missing.length === 0) return 0;

  const { data: rows, error } = await supabase
    .from('admin_sessions')
    .select('id, date, entries, settlement')
    .in('id', missing);
  if (error) return 0;

  let n = 0;
  for (const row of rows || []) {
    const legs = legsFromSession(row);
    if (legs.length === 0) continue;
    const { error: insErr } = await supabase.from('admin_session_legs').insert(legs);
    if (!insErr) n += 1;
  }
  return n;
}

/**
 * Active (not undone) settlement marks. Pass `sessionId` to scope to one session.
 *
 * @param {{ sessionId?: string }} [opts]
 * @returns {Promise<Array<Object>>}
 */
async function listMarks({ sessionId } = {}) {
  if (!supabase) return [];
  let q = supabase.from('settlement_marks').select('*').is('undone_at', null);
  if (sessionId) q = q.eq('session_id', sessionId);
  const { data, error } = await q.order('settled_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

/**
 * Check off one or more legs as settled. Rows are `settlement_marks` shape
 * (see design doc / supabase_schema.sql).
 *
 * @param {Array<Object>} rows
 * @returns {Promise<Array<Object>>} the inserted rows (with ids)
 */
async function addMarks(rows) {
  if (!supabase || !Array.isArray(rows) || rows.length === 0) return [];
  const { data, error } = await supabase.from('settlement_marks').insert(rows).select();
  if (error) throw error;
  return data || [];
}

/**
 * Soft-delete marks by id — the Undo path. History is kept.
 *
 * @param {Array<string>} ids
 */
async function undoMarks(ids) {
  if (!supabase || !Array.isArray(ids) || ids.length === 0) return;
  const { error } = await supabase
    .from('settlement_marks')
    .update({ undone_at: new Date().toISOString() })
    .in('id', ids)
    .is('undone_at', null);
  if (error) throw error;
}

// --- Standing bank defaults (admin_bank_defaults) -----------------------------

/**
 * @returns {Promise<Array<{ country: string, player_id: string }>>}
 */
async function listBankDefaults() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('admin_bank_defaults')
    .select('country, player_id');
  if (error) throw error;
  return data || [];
}

/**
 * Set (or clear, when playerId is falsy) the standing banker for a country.
 * @param {string} country
 * @param {string|null} playerId
 */
async function setBankDefault(country, playerId) {
  if (!supabase || !country) return;
  if (!playerId) {
    const { error } = await supabase.from('admin_bank_defaults').delete().eq('country', country);
    if (error) throw error;
    return;
  }
  const { error } = await supabase
    .from('admin_bank_defaults')
    .upsert({ country, player_id: playerId, updated_at: new Date().toISOString() }, { onConflict: 'country' });
  if (error) throw error;
}

// --- Player profiles (players) ----------------------------------------------

/**
 * Every master player profile with its optional country association. Feeds the
 * /admin Player editor; the identity graph hook is the read path everywhere else.
 *
 * @returns {Promise<Array<{ id: string, display_name: string, country: string|null }>>}
 */
async function listPlayers() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('players')
    .select('id, display_name, country')
    .order('display_name');
  if (error) throw error;
  return data || [];
}

/**
 * Create a master player profile with an optional country association and preferred currency.
 *
 * @param {{ display_name: string, country?: string|null, preferred_currency?: string }} row
 * @returns {Promise<{ id: string, display_name: string, country: string|null, preferred_currency: string }>}
 */
async function createPlayer({ display_name, country = null, preferred_currency = 'USD' } = {}) {
  if (!supabase) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / _ANON_KEY).');
  const name = String(display_name || '').trim();
  if (!name) throw new Error('A display name is required.');
  const { data, error } = await supabase
    .from('players')
    .insert([{ display_name: name, country: country || null, preferred_currency }])
    .select('id, display_name, country, preferred_currency')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Update a player's display name, country association, and/or preferred currency. Only the keys
 * present in `patch` are written.
 *
 * @param {string} id
 * @param {{ display_name?: string, country?: string|null, preferred_currency?: string }} patch
 * @returns {Promise<{ id: string, display_name: string, country: string|null, preferred_currency: string }>}
 */
async function updatePlayer(id, patch = {}) {
  if (!supabase) throw new Error('Supabase is not configured (VITE_SUPABASE_URL / _ANON_KEY).');
  if (!id) throw new Error('A player id is required.');
  const next = {};
  if (patch.display_name != null) {
    const name = String(patch.display_name).trim();
    if (!name) throw new Error('A display name is required.');
    next.display_name = name;
  }
  if ('country' in patch) next.country = patch.country || null;
  if ('preferred_currency' in patch) next.preferred_currency = patch.preferred_currency || 'USD';
  if (Object.keys(next).length === 0) throw new Error('Nothing to update.');
  const { data, error } = await supabase
    .from('players')
    .update(next)
    .eq('id', id)
    .select('id, display_name, country, preferred_currency')
    .single();
  if (error) throw error;
  return data;
}

// --- Raw CSV: scaffold only, not wired up (see "Raw CSV (deferred)") -----------

/** @todo not wired up */
async function uploadRawCsv(/* id, csvText */) {
  return null;
}

/** @todo not wired up */
async function downloadRawCsv(/* id */) {
  return null;
}

export const sessionApi = {
  create,
  get,
  list,
  exists,
  remove,
  listLegs,
  ensureLegs,
  listMarks,
  addMarks,
  undoMarks,
  listBankDefaults,
  setBankDefault,
  listPlayers,
  createPlayer,
  updatePlayer,
  uploadRawCsv,
  downloadRawCsv,
};

export default sessionApi;
