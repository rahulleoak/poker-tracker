import { parsePokerNowCSV, parsePokerNowLogStats } from './csvParser.js';
import assert from 'node:assert';
import test from 'node:test';

test('parsePokerNowCSV with classic buy_in, buy_out, stack columns', () => {
  const csv = `player_nickname,buy_in,buy_out,stack
"Alice @ 123",100,50,60
"Bob @ 456",200,,150
"Charlie @ 789",50,80,
"Dave @ abc",0,0,0
`;

  const results = parsePokerNowCSV(csv);
  
  assert.strictEqual(results.length, 3);

  const alice = results.find(r => r.name === 'Alice');
  assert.ok(alice);
  assert.strictEqual(alice.buyIn, 100);
  assert.strictEqual(alice.buyOut, 50);
  assert.strictEqual(alice.stack, 60);

  const bob = results.find(r => r.name === 'Bob');
  assert.ok(bob);
  assert.strictEqual(bob.buyIn, 200);
  assert.strictEqual(bob.buyOut, 0);
  assert.strictEqual(bob.stack, 150);

  const charlie = results.find(r => r.name === 'Charlie');
  assert.ok(charlie);
  assert.strictEqual(charlie.buyIn, 50);
  assert.strictEqual(charlie.buyOut, 80);
  assert.strictEqual(charlie.stack, 0);

  const dave = results.find(r => r.name === 'Dave');
  assert.strictEqual(dave, undefined);
});

test('parsePokerNowCSV with missing/shuffled columns', () => {
  const csv = `buy_in,player_nickname,stack
150,"Eve @ xyz",75
`;
  const results = parsePokerNowCSV(csv);
  assert.strictEqual(results.length, 1);
  const eve = results[0];
  assert.strictEqual(eve.name, 'Eve');
  assert.strictEqual(eve.buyIn, 150);
  assert.strictEqual(eve.buyOut, 0);
  assert.strictEqual(eve.stack, 75);
});

test('parsePokerNowCSV handles traditional/legacy logs correctly', () => {
  const legacyLog = `
entry_id,action
approved the player "Alice" participation with a stack of 100
player "Alice" quits the game with a stack of 150
`;
  const results = parsePokerNowCSV(legacyLog);
  assert.strictEqual(results.length, 1);
  const alice = results[0];
  assert.strictEqual(alice.name, 'Alice');
  assert.strictEqual(alice.buyIn, 100);
  assert.strictEqual(alice.buyOut, 0);
  assert.strictEqual(alice.stack, 150);
});

test('parsePokerNowCSV handles null, undefined, empty, and invalid input without crashing', () => {
  assert.deepStrictEqual(parsePokerNowCSV(null), []);
  assert.deepStrictEqual(parsePokerNowCSV(undefined), []);
  assert.deepStrictEqual(parsePokerNowCSV(''), []);
  assert.deepStrictEqual(parsePokerNowCSV(12345), []);
  assert.deepStrictEqual(parsePokerNowCSV('random string without columns'), []);
});

test('parsePokerNowLogStats handles invalid input gracefully', () => {
  assert.deepStrictEqual(parsePokerNowLogStats(null), {});
  assert.deepStrictEqual(parsePokerNowLogStats(undefined), {});
  assert.deepStrictEqual(parsePokerNowLogStats(''), {});
  assert.deepStrictEqual(parsePokerNowLogStats(42), {});
});
