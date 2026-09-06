// Thin wrapper over the `admin_sessions` table for the /admin CSV upload flow.
// See design/admin-session.md. The app has no API server — this talks to
// Supabase directly with the anon key, same pattern as App.jsx / GameEditor.jsx.

import { supabase } from './supabase';

const LIST_COLUMNS =
  'id, date, currency, poker_now_url, player_count, hand_count, created_at, updated_at';

/**
 * Insert or replace an admin session row. Upserts on the primary key so a
 * re-upload of the same PokerNow game overwrites rather than duplicating.
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

// --- Cross-session settlement (settlement_marks) ------------------------------

/**
 * Every session's ledger + settlement config, minus the heavy `chart_data`
 * blob. Feeds the /settlement cross-session roll-up (see design doc).
 *
 * @returns {Promise<Array<{ id, date, entries, settlement }>>}
 */
async function listForSettlement() {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('admin_sessions')
    .select('id, date, entries, settlement')
    .order('date', { ascending: false, nullsFirst: false });
  if (error) throw error;
  return data || [];
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
  listForSettlement,
  listMarks,
  addMarks,
  undoMarks,
  listBankDefaults,
  setBankDefault,
  uploadRawCsv,
  downloadRawCsv,
};

export default sessionApi;
