import test from 'node:test';
import assert from 'node:assert';
import { extractPokerNowGameId, extractSessionStartDate, applyPlayerGroups } from '../../src/utils/pokernow-utils/sessionMeta.js';

test('extractPokerNowGameId reads the id from the export file name', () => {
  assert.strictEqual(
    extractPokerNowGameId('poker_now_log_pglcv61cfhVxuuwjIEWzaLuSQ.csv'),
    'pglcv61cfhVxuuwjIEWzaLuSQ'
  );
  assert.strictEqual(
    extractPokerNowGameId('ledger_pglcv61cfhVxuuwjIEWzaLuSQ.csv'),
    'pglcv61cfhVxuuwjIEWzaLuSQ'
  );
  assert.strictEqual(
    extractPokerNowGameId('poker_now_log_abc123 (1).csv'),
    'abc123'
  );
});

test('extractPokerNowGameId falls back to a game URL in the content', () => {
  assert.strictEqual(
    extractPokerNowGameId('random.csv', 'header https://www.pokernow.club/games/xyz789ABC- foot'),
    'xyz789ABC-'
  );
  assert.strictEqual(extractPokerNowGameId('random.csv', 'no url'), null);
  assert.strictEqual(extractPokerNowGameId('', ''), null);
});

test('extractSessionStartDate returns the earliest log date', () => {
  const csv = [
    'entry,at,order',
    '"x quits",2026-09-04T06:05:28.145Z,3',
    '"y folds",2026-09-01T23:25:48.128Z,1',
    '"z calls",2026-09-02T10:00:00.000Z,2'
  ].join('\n');
  assert.strictEqual(extractSessionStartDate(csv), '2026-09-01');
  assert.strictEqual(extractSessionStartDate(''), null);
  assert.strictEqual(extractSessionStartDate('no timestamps here'), null);
});

test('applyPlayerGroups collapses grouped players into one summed entry keeping the primary name', () => {
  const entries = [
    { name: 'Alice', externalId: null, buyIn: 100, buyOut: 0, stack: 40, handsPlayed: 30, vpipHands: 10, pfrHands: 5, threeBetOpps: 3, threeBetHands: 1 },
    { name: 'Bob', externalId: 'bob-id', buyIn: 50, buyOut: 20, stack: 0, handsPlayed: 12, vpipHands: 4, pfrHands: 2, threeBetOpps: 1, threeBetHands: 0 },
    { name: 'Ally', externalId: 'ally-id', buyIn: 80, buyOut: 0, stack: 200, handsPlayed: 18, vpipHands: 6, pfrHands: 3, threeBetOpps: 2, threeBetHands: 1 }
  ];

  const result = applyPlayerGroups(entries, [['Alice', 'Ally']]);
  assert.strictEqual(result.length, 2);

  const alice = result[0];
  assert.strictEqual(alice.name, 'Alice');
  assert.strictEqual(alice.externalId, 'ally-id');
  assert.strictEqual(alice.buyIn, 180);
  assert.strictEqual(alice.stack, 240);
  assert.strictEqual(alice.handsPlayed, 48);
  assert.strictEqual(alice.vpipHands, 16);
  assert.strictEqual(alice.threeBetHands, 2);

  const bob = result[1];
  assert.strictEqual(bob.name, 'Bob');
  assert.strictEqual(bob.buyIn, 50);
});

test('applyPlayerGroups leaves entries untouched when there are no multi-member groups', () => {
  const entries = [
    { name: 'Alice', buyIn: 100, buyOut: 0, stack: 40 },
    { name: 'Bob', buyIn: 50, buyOut: 0, stack: 0 }
  ];

  assert.deepStrictEqual(applyPlayerGroups(entries, []), entries);
  assert.deepStrictEqual(applyPlayerGroups(entries, [['Alice']]), entries);
  assert.deepStrictEqual(applyPlayerGroups(entries, [['Alice', 'Ghost']]), entries);
});

test('applyPlayerGroups matches tokens by pokerNowId and keeps same-named entries distinct', () => {
  const entries = [
    { name: 'kkkush', pokerNowId: '8mUZBNah98', externalId: '8mUZBNah98', buyIn: 1000, buyOut: 5720, stack: 0 },
    { name: 'kkkush', pokerNowId: 'dQmzS_6kJz', externalId: 'dQmzS_6kJz', buyIn: 24573, buyOut: 39823, stack: 0 },
    { name: 'NIG', pokerNowId: 'cjTgA9ZbYG', externalId: 'cjTgA9ZbYG', buyIn: 58556, buyOut: 73851, stack: 0 }
  ];

  // group only the two kkkush accounts by their ids
  const result = applyPlayerGroups(entries, [['8mUZBNah98', 'dQmzS_6kJz']]);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].name, 'kkkush');
  assert.strictEqual(result[0].pokerNowId, '8mUZBNah98');
  assert.strictEqual(result[0].buyIn, 25573);
  assert.strictEqual(result[0].buyOut, 45543);
  assert.strictEqual(result[1].pokerNowId, 'cjTgA9ZbYG');

  // a name token that is ambiguous only consumes one entry, so the group stays intact
  const byName = applyPlayerGroups(entries, [['kkkush', 'NIG']]);
  assert.strictEqual(byName.length, 2);
  assert.strictEqual(byName[0].name, 'kkkush');
  assert.strictEqual(byName[0].buyIn, 1000 + 58556);
});

test('applyPlayerGroups supports three-way groups and preserves ungrouped order', () => {
  const entries = [
    { name: 'A', buyIn: 10, buyOut: 0, stack: 0 },
    { name: 'B', buyIn: 20, buyOut: 0, stack: 0 },
    { name: 'C', buyIn: 30, buyOut: 0, stack: 0 },
    { name: 'D', buyIn: 40, buyOut: 0, stack: 0 }
  ];

  const result = applyPlayerGroups(entries, [['B', 'A', 'D']]);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].name, 'B');
  assert.strictEqual(result[0].buyIn, 70);
  assert.strictEqual(result[1].name, 'C');
});
