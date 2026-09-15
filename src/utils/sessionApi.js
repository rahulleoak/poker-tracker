// Thin wrapper over the `admin_sessions` table for the /admin CSV upload flow.
// See design/admin-session.md. The app has no API server — this talks to
// Supabase directly with the anon key, same pattern as App.jsx / GameEditor.jsx.

import { supabase } from './supabase';
import { legsFromSession } from './settlementLedger';
import { mapDatabaseSessionsToGames } from './sessionMapper';

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
  if (data) return data;

  // Fallback to standard sessions and ledger tables
  try {
    const { data: sData, error: sErr } = await supabase
      .from('sessions')
      .select(`
        id,
        date,
        currency,
        chip_value,
        poker_now_url,
        is_active,
        ledger (
          player_name,
          player_external_id,
          external_player_id,
          player_poker_now_id,
          buy_in,
          cash_out,
          currency,
          is_bank,
          hands_played,
          vpip_hands,
          pfr_hands,
          three_bet_opps,
          three_bet_hands
        )
      `)
      .eq('id', id)
      .maybeSingle();

    if (sErr) throw sErr;
    if (sData) {
      const mappedList = mapDatabaseSessionsToGames([sData]);
      const mapped = mappedList[0];
      if (mapped) {
        return {
          id: mapped.id,
          date: mapped.date,
          currency: mapped.currency,
          chip_value: mapped.chipValue,
          poker_now_url: mapped.pokerNowUrl,
          entries: mapped.entries
        };
      }
    }
  } catch (err) {
    console.warn('sessionApi.get fallback query error:', err);
  }

  return null;
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
  try {
    const { data, error } = await supabase
      .from('admin_session_legs')
      .select(LEG_COLUMNS)
      .order('session_date', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('sessionApi.listLegs failed:', err);
    return [];
  }
}

/**
 * Backfill / self-heal: build legs for any session that has none yet or where
 * legacy legs had countries misaligned with player currencies/settlement config.
 *
 * @returns {Promise<number>} sessions backfilled
 */
async function ensureLegs() {
  if (!supabase) return 0;
  try {
    const [sessRes, legRes] = await Promise.all([
      supabase.from('admin_sessions').select('id, date, currency, entries, settlement'),
      supabase.from('admin_session_legs').select('session_id, country, currency')
    ]);
    if (sessRes.error || !sessRes.data || sessRes.data.length === 0) {
      if (sessRes.error) console.warn('sessionApi.ensureLegs query error:', sessRes.error);
      return 0;
    }

    const existingLegs = legRes.data || [];
    const covered = new Set(existingLegs.map((r) => r.session_id));
    const missing = sessRes.data.filter((s) => !covered.has(s.id));

    // Also detect legacy sessions whose legs were hardcoded to 'CA' before multi-currency support
    const misaligned = sessRes.data.filter((s) => {
      if (!covered.has(s.id)) return false;
      const sLegs = existingLegs.filter((l) => l.session_id === s.id);
      if (sLegs.length === 0) return true;
      const entries = Array.isArray(s.entries) ? s.entries : [];
      const sCur = s.currency || 'CAD';
      const hasNonCad = sCur !== 'CAD' || entries.some((e) => e.currency && e.currency !== 'CAD');
      // If session has non-CAD currency or entries but legs table only has CA
      if (hasNonCad && sLegs.every((l) => l.country === 'CA')) {
        return true;
      }
      return false;
    });

    const sessionsToUpdate = [...missing, ...misaligned];
    if (sessionsToUpdate.length === 0) return 0;

    let n = 0;
    for (const row of sessionsToUpdate) {
      const legs = legsFromSession(row);
      if (legs.length === 0) continue;
      await supabase.from('admin_session_legs').delete().eq('session_id', row.id);
      const { error: insErr } = await supabase.from('admin_session_legs').insert(legs);
      if (!insErr) n += 1;
    }
    return n;
  } catch (err) {
    console.warn('sessionApi.ensureLegs failed:', err);
    return 0;
  }
}

/**
 * Settlement marks live in a separate table (`settlement_marks`) so checking
 * off a payment is a fast single-row insert/delete rather than a whole-session
 * rewrite.
 */
async function listMarks({ sessionId = null } = {}) {
  if (!supabase) return [];
  try {
    let query = supabase
      .from('settlement_marks')
      .select('*')
      .is('undone_at', null);
    if (sessionId) query = query.eq('session_id', sessionId);
    const { data, error } = await query.order('settled_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('sessionApi.listMarks failed:', err);
    return [];
  }
}

async function addMarks(markRows) {
  if (!supabase || !markRows?.length) return [];
  const { data, error } = await supabase
    .from('settlement_marks')
    .insert(markRows)
    .select();
  if (error) throw error;
  return data || [];
}

async function undoMarks(markIds) {
  if (!supabase || !markIds?.length) return;
  const { error } = await supabase
    .from('settlement_marks')
    .update({ undone_at: new Date().toISOString() })
    .in('id', markIds);
  if (error) throw error;
}

// Aliases for bulk / single operations
async function mark(row) {
  if (!row) return null;
  const inserted = await addMarks([row]);
  return Array.isArray(inserted) && inserted.length > 0 ? inserted[0] : null;
}

async function markBulk(rows) {
  return addMarks(rows);
}

async function unmark(markId) {
  if (!markId) return;
  return undoMarks([markId]);
}

async function unmarkBulk(markIds) {
  return undoMarks(markIds);
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
  mark,
  markBulk,
  unmark,
  unmarkBulk
};

export default sessionApi;
