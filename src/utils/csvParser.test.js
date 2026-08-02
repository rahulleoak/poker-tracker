import { parsePokerNowCSV } from './csvParser.js';
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
  
  // Alice: buyIn=100, buyOut=50, stack=60
  // Bob: buyIn=200, buyOut=0, stack=150
  // Charlie: buyIn=50, buyOut=80, stack=0
  // Dave: all 0, should be filtered out because filter does: p.buyIn > 0 || p.stack > 0 || p.buyOut > 0

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
  // Wait, if header contains 'player_nickname' and 'buy_in', it uses the CSV parsing branch, not the legacy log parser.
  // Let's test the legacy log parsing branch explicitly by using logs text without 'player_nickname' and 'buy_in' in the first line.
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
