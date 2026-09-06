// In-memory, single-shot handoff for the /admin preview flow.
//
// The /admin page parses a (potentially multi-MB) PokerNow CSV and hands the
// result to the /session view without persisting anything — not localStorage,
// not the DB, and not History API state (which browsers size-cap). It lives for
// exactly one client-side navigation; a direct visit or refresh of /session
// simply won't have it.

let stashed = null;

/**
 * @param {{ id: string, csvText: string, game: Object }} payload
 */
export function stashSessionPreview(payload) {
  stashed = payload || null;
}

/**
 * Non-destructive read of the preview stashed for `sessionId` (safe to call
 * during render). Returns null if nothing matches.
 *
 * @param {string} sessionId
 * @returns {{ id: string, csvText: string, game: Object } | null}
 */
export function peekSessionPreview(sessionId) {
  return stashed && stashed.id === sessionId ? stashed : null;
}

/** Drops the stashed preview so it can't leak into a later direct revisit. */
export function clearSessionPreview() {
  stashed = null;
}
