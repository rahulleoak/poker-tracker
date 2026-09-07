import test from 'node:test';
import assert from 'node:assert';
import {
  normalizeName,
  collapseRuns,
  editDistance,
  nameSimilarity,
  autoGroupEntries
} from '../../src/utils/playerAutoGroup.js';

const e = (name, extra = {}) => ({ name, buyIn: 0, buyOut: 0, stack: 0, ...extra });

// Groups as sets of names, sorted, for order-independent assertions.
const asNameSets = (entries, opts) => {
  const byKey = new Map(entries.map((x) => [x.pokerNowId || x.externalId || x.name.toLowerCase(), x.name]));
  return autoGroupEntries({ entries, ...opts })
    .map((g) => g.members.map((k) => byKey.get(k)).sort())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
};

test('normalizeName strips case, accents, @/# prefixes, seat tags and punctuation', () => {
  assert.strictEqual(normalizeName('  Miguel (Seat 4) '), 'miguel');
  assert.strictEqual(normalizeName('@RahulL'), 'rahull');
  assert.strictEqual(normalizeName('José'), 'jose');
  assert.strictEqual(normalizeName('kk_kush!'), 'kkkush');
  assert.strictEqual(normalizeName('[guest] Dave'), 'guestdave'); // leading tag is not trailing
});

test('collapseRuns squeezes repeated characters', () => {
  assert.strictEqual(collapseRuns('kkkush'), 'kush');
  assert.strictEqual(collapseRuns('kkush'), 'kush');
  assert.strictEqual(collapseRuns('aaron'), 'aron');
});

test('editDistance counts an adjacent transposition as 1', () => {
  assert.strictEqual(editDistance('adam', 'adma'), 1);
  assert.strictEqual(editDistance('kkush', 'kkkush'), 1);
  assert.strictEqual(editDistance('abc', 'abc'), 0);
});

test('nameSimilarity tiers', () => {
  assert.strictEqual(nameSimilarity('Skarsh', 'skarsh'), 1); // exact
  assert.strictEqual(nameSimilarity('kkkush', 'kkush'), 0.95); // collapsed-exact
  assert.strictEqual(nameSimilarity('Mig', 'Miguel'), 0.85); // prefix
  assert.strictEqual(nameSimilarity('adam', 'adma'), 0.8); // edit distance
  assert.strictEqual(nameSimilarity('Al', 'Alice'), 0); // prefix too short
  assert.strictEqual(nameSimilarity('Ben', 'Ken'), 0); // different first letter
  assert.strictEqual(nameSimilarity('Rahul', 'adma'), 0); // unrelated
});

test('exact duplicate names with different ids are grouped', () => {
  const entries = [
    e('Skarsh', { externalId: 'sk-1' }),
    e('Skarsh', { externalId: 'sk-2' }),
    e('Rahul', { externalId: 'r-1' })
  ];
  assert.deepStrictEqual(asNameSets(entries), [['Skarsh', 'Skarsh']]);
});

test('prefix and repeated-letter variants collapse into one group each', () => {
  const entries = [
    e('Mig'),
    e('Miguel'),
    e('kkkush'),
    e('kkush'),
    e('kush'),
    e('Rahul'),
    e('adma')
  ];
  assert.deepStrictEqual(asNameSets(entries), [
    ['Mig', 'Miguel'],
    ['kkkush', 'kush', 'kkush'].sort()
  ]);
});

test('no false merges for short or first-letter-different names', () => {
  const entries = [e('Al'), e('Alice'), e('Alex'), e('Ben'), e('Ken')];
  assert.deepStrictEqual(asNameSets(entries), []);
});

test('result is independent of entry order', () => {
  const base = [e('Miguel'), e('Mig'), e('Skarsh', { externalId: 'a' }), e('Skarsh', { externalId: 'b' }), e('Rahul')];
  const shuffled = [base[4], base[1], base[3], base[0], base[2]];
  assert.deepStrictEqual(asNameSets(base), asNameSets(shuffled));
});

test('primary member prefers an id-bearing, longer name', () => {
  const entries = [e('Mig'), e('Miguel', { externalId: 'mg-1' })];
  const [group] = autoGroupEntries({ entries });
  assert.strictEqual(group.members[0], 'mg-1'); // keyOfEntry uses externalId
});

test('knownGroups force-links names that would not match on their own', () => {
  const entries = [e('kkkush', { externalId: 'k1' }), e('BoomHeadshot', { externalId: 'k2' }), e('Rahul', { externalId: 'r1' })];
  const groups = autoGroupEntries({ entries, knownGroups: [['k1', 'k2']] });
  assert.deepStrictEqual(
    groups.map((g) => [...g.members].sort()),
    [['k1', 'k2']]
  );
});

test('grouping never changes the number of people when nothing matches', () => {
  const entries = [e('Rahul'), e('adma'), e('kkkush'), e('Skarsh'), e('Mig')];
  assert.deepStrictEqual(autoGroupEntries({ entries }), []);
});
