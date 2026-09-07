// Standing bank assignments for the /admin review dialog.
//
// These players bank for their country in EVERY session — even when they are
// also playing that night. On open, the dialog puts each of them in `country`
// and makes them that country's bank; the reviewer can still override any pick.
//
// Matching is case-insensitive against the resolved master-profile name first,
// then the raw seat nickname. `country` is a code from src/utils/countries.js.
//
// Edit this list to change the defaults.
export const DEFAULT_BANKERS = [
  { names: ['adam', 'adm', 'adma'], country: 'CA' },
  { names: ['kush', 'kkkush'], country: 'US' }
];

const norm = (v) => String(v || '').trim().toLowerCase();

/** True if `value` names one of `names` (exact, or the name is a substring). */
export function matchesBanker(names, value) {
  const v = norm(value);
  if (!v) return false;
  return (names || []).some((n) => {
    const nn = norm(n);
    return nn && (v === nn || v.includes(nn));
  });
}

/** The banker config that `value` matches, or null. */
export function bankerConfigFor(value) {
  return DEFAULT_BANKERS.find((b) => matchesBanker(b.names, value)) || null;
}
