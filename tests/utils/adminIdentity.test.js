import test from 'node:test';
import assert from 'node:assert';
import { resolveEntryIdentity, makeNameResolver } from '../../src/utils/adminIdentity.js';

const graph = {
  players: [
    { id: 'p-rahul', display_name: 'Rahul' },
    { id: 'p-adam', display_name: 'Adam' }
  ],
  playerLinks: [
    { player_id: 'p-rahul', external_id: 'SPoLg3vOL-' }, // a PokerNow id
    { player_id: 'p-rahul', external_id: '@RahulL' } // a seat alias
  ]
};

test('resolveEntryIdentity matches on PokerNow id (case-insensitive)', () => {
  const hit = resolveEntryIdentity({ name: 'whatever', pokerNowId: 'spolg3vol-' }, graph);
  assert.deepStrictEqual(hit, { playerId: 'p-rahul', displayName: 'Rahul', matchedBy: 'id' });
});

test('resolveEntryIdentity matches on a seat-name alias', () => {
  const hit = resolveEntryIdentity({ name: '@RahulL', pokerNowId: 'unknown-id' }, graph);
  assert.strictEqual(hit.playerId, 'p-rahul');
  assert.strictEqual(hit.matchedBy, 'alias');
});

test('resolveEntryIdentity falls back to a direct display_name match', () => {
  const hit = resolveEntryIdentity({ name: 'adam', pokerNowId: 'no-link' }, graph);
  assert.deepStrictEqual(hit, { playerId: 'p-adam', displayName: 'Adam', matchedBy: 'name' });
});

test('resolveEntryIdentity returns null when nothing matches', () => {
  assert.strictEqual(resolveEntryIdentity({ name: 'Stranger', pokerNowId: 'xyz' }, graph), null);
  assert.strictEqual(resolveEntryIdentity({}, graph), null);
  assert.strictEqual(resolveEntryIdentity({ name: 'Rahul' }, { players: [], playerLinks: [] }), null);
});

test('makeNameResolver maps ids to names and tolerates null', () => {
  const nameOf = makeNameResolver(graph.players);
  assert.strictEqual(nameOf('p-adam'), 'Adam');
  assert.strictEqual(nameOf('missing'), null);
  assert.strictEqual(nameOf(null), null);
  assert.strictEqual(nameOf(undefined), null);
});
