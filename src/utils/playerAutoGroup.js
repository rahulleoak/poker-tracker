import { keyOfEntry } from './bankSettlement.js';

// Deterministic name-similarity clustering for the /admin "Review & Link" step.
// Given the raw ledger entries, it collapses names that almost certainly belong
// to the same person ("Skarsh" + "Skarsh", "Mig" + "Miguel", "kkkush" + "kkush")
// into groups. Row order never affects the output.

const LEADING_JUNK = /^[@#\s]+/;
const TRAILING_TAG = /\s*[([][^)\]]*[)\]]\s*$/; // one trailing "(Seat 4)" / "[guest]"

/** Lowercase, de-accent, drop @/# prefixes, drop a trailing seat/guest tag, keep alphanumerics. */
export function normalizeName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(LEADING_JUNK, '')
    .replace(TRAILING_TAG, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Squeeze runs of the same character: "kkkush" -> "kush", "aaron" -> "aron". */
export function collapseRuns(s) {
  return String(s || '').replace(/(.)\1+/g, '$1');
}

/**
 * Optimal string alignment distance (Damerau-Levenshtein with adjacent
 * transposition). Transposition is the most common real typo, so "adam"/"adma"
 * is distance 1 here vs 2 under plain Levenshtein.
 */
export function editDistance(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const d = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[m][n];
}

/**
 * Similarity of two raw names in [0, 1]. Discrete tiers, highest wins:
 *   1.00  exact after normalization                 ("Skarsh" == "skarsh")
 *   0.95  equal after squeezing repeated letters    ("kkkush" ~ "kkush")
 *   0.85  one is a prefix of the other (>=3 chars, >=50% length)  ("mig" ~ "miguel")
 *   0.80  edit distance within a length-scaled budget, same first letter ("adam" ~ "adma")
 *   0     otherwise
 */
export function nameSimilarity(rawA, rawB) {
  const a = normalizeName(rawA);
  const b = normalizeName(rawB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  if (collapseRuns(a) === collapseRuns(b)) return 0.95;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (long.startsWith(short) && short.length >= 3 && short.length / long.length >= 0.5) {
    return 0.85;
  }

  if (a[0] === b[0]) {
    const minLen = Math.min(a.length, b.length);
    const budget = minLen <= 4 ? 1 : minLen <= 8 ? 2 : 3;
    if (editDistance(a, b) <= budget) return 0.8;
  }

  return 0;
}

class UnionFind {
  constructor(keys) {
    this.parent = new Map(keys.map((k) => [k, k]));
  }
  find(x) {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root);
    while (this.parent.get(x) !== root) {
      const next = this.parent.get(x);
      this.parent.set(x, root);
      x = next;
    }
    return root;
  }
  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

// Higher rank = better "canonical" identity for a group's primary member.
// A real external/PokerNow id outranks everything; longer names beat shorter
// ("Miguel" over "Mig"); the caller's key sort breaks any remaining tie.
function primaryRank(entry) {
  const hasId = entry?.pokerNowId || entry?.externalId ? 1 : 0;
  return hasId * 1000 + normalizeName(entry?.name).length;
}

/**
 * Cluster ledger entries that look like the same person by name.
 *
 * @param {Object}   opts
 * @param {Array}    opts.entries              parsed ledger entries
 * @param {number}  [opts.threshold=0.8]       minimum nameSimilarity to link a pair
 * @param {(e) => string} [opts.keyOf]         entry -> stable key (default keyOfEntry)
 * @param {Array<string[]>} [opts.knownGroups] key groups to force-link regardless
 *        of name (e.g. rebuilt from previously confirmed player links)
 * @returns {Array<{ members: string[] }>}  groups of 2+ keys, primary key first,
 *          in a stable order. Deterministic for a given entry set.
 */
export function autoGroupEntries({
  entries = [],
  threshold = 0.8,
  keyOf = keyOfEntry,
  knownGroups = []
} = {}) {
  const byKey = new Map();
  for (const e of entries) {
    if (!e) continue;
    const key = keyOf(e);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, e);
  }

  const keys = [...byKey.keys()].sort(); // determinism anchor
  const uf = new UnionFind(keys);

  for (const grp of knownGroups) {
    const present = grp.filter((k) => byKey.has(k));
    for (let i = 1; i < present.length; i++) uf.union(present[0], present[i]);
  }

  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = byKey.get(keys[i]);
      const b = byKey.get(keys[j]);
      if (nameSimilarity(a.name, b.name) >= threshold) uf.union(keys[i], keys[j]);
    }
  }

  const buckets = new Map();
  for (const k of keys) {
    const root = uf.find(k);
    if (!buckets.has(root)) buckets.set(root, []);
    buckets.get(root).push(k);
  }

  const groups = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    members.sort(
      (x, y) => primaryRank(byKey.get(y)) - primaryRank(byKey.get(x)) || (x < y ? -1 : 1)
    );
    groups.push({ members });
  }
  groups.sort((g1, g2) => (g1.members[0] < g2.members[0] ? -1 : 1));
  return groups;
}
