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

test('parsePokerNowCSV flexible ledger header and normalization', () => {
  const csv = ` "PLAYER" , "BUYIN" , "BUYOUT" , "CURRENT_STACK" 
"Alice @ 123",100,20,80
"Bob @ 456",200,0,150
"Charlie @ 789",150,50,100
`;
  const results = parsePokerNowCSV(csv);
  assert.strictEqual(results.length, 3);

  const alice = results.find(r => r.name === 'Alice');
  assert.strictEqual(alice.buyIn, 100);
  assert.strictEqual(alice.buyOut, 20);
  assert.strictEqual(alice.stack, 80);

  const bob = results.find(r => r.name === 'Bob');
  assert.strictEqual(bob.buyIn, 200);
  assert.strictEqual(bob.buyOut, 0);
  assert.strictEqual(bob.stack, 150);
});

test('parsePokerNowCSV flexible ledger header variations (ending_stack, net)', () => {
  const csv = `nickname,buy_in,buy_out,ending_stack
"Dave @ 1",300,100,200
`;
  const results = parsePokerNowCSV(csv);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].name, 'Dave');
  assert.strictEqual(results[0].buyIn, 300);
  assert.strictEqual(results[0].buyOut, 100);
  assert.strictEqual(results[0].stack, 200);
});

test('parsePokerNowCSV log parsing with ending stacks and cash outs', () => {
  // PokerNow logs export newest line first, so index 1 is newest, bottom is oldest
  const logCSV = `entry_id,entry,created_at
3,"Player stacks: #1 ""Alice @ a1"" (250) | #2 ""Bob @ b2"" (150)",2023-01-01T02:00:00Z
2,"approved the player ""Charlie @ c3"" cash out request for 300",2023-01-01T01:30:00Z
1.5,"approved the player ""Charlie @ c3"" participation with a stack of 200",2023-01-01T01:15:00Z
1,"approved the player ""Alice @ a1"" participation with a stack of 100",2023-01-01T01:00:00Z
0,"approved the player ""Bob @ b2"" participation with a stack of 100",2023-01-01T01:00:00Z
`;

  const results = parsePokerNowCSV(logCSV);
  assert.strictEqual(results.length, 3);

  const alice = results.find(r => r.name === 'Alice');
  assert.ok(alice);
  assert.strictEqual(alice.buyIn, 100);
  assert.strictEqual(alice.stack, 250);

  const bob = results.find(r => r.name === 'Bob');
  assert.ok(bob);
  assert.strictEqual(bob.buyIn, 100);
  assert.strictEqual(bob.stack, 150);

  const charlie = results.find(r => r.name === 'Charlie');
  assert.ok(charlie);
  assert.strictEqual(charlie.buyOut, 300);
});

test('parsePokerNowCSV log parsing when entry is in column 0', () => {
  const logCSV = `entry,created_at
"Player stacks: #1 ""Alice @ a1"" (200)",2023-01-01T02:00:00Z
"approved the player ""Alice @ a1"" participation with a stack of 100",2023-01-01T01:00:00Z
`;
  const results = parsePokerNowCSV(logCSV);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].name, 'Alice');
  assert.strictEqual(results[0].buyIn, 100);
  assert.strictEqual(results[0].stack, 200);
});

test('parsePokerNowCSV log parsing quitting without double counting and mid-session rejoin', () => {
  const logCSV = `entry_id,entry,created_at
4,"Player stacks: #1 ""Alice @ a1"" (300)",2023-01-01T03:00:00Z
3,"approved the player ""Alice @ a1"" participation with a stack of 100",2023-01-01T02:30:00Z
2,"player ""Alice @ a1"" stands up with a stack of 250",2023-01-01T02:00:00Z
1.5,"Player stacks: #1 ""Alice @ a1"" (250)",2023-01-01T01:30:00Z
1,"approved the player ""Alice @ a1"" participation with a stack of 100",2023-01-01T01:00:00Z
`;
  const results = parsePokerNowCSV(logCSV);
  assert.strictEqual(results.length, 1);
  const alice = results[0];
  assert.strictEqual(alice.name, 'Alice');
  assert.strictEqual(alice.buyIn, 200);
  assert.strictEqual(alice.stack, 550);
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

test('parsePokerNowLogStats with entry in column 1 and timestamps', () => {
  const logCSV = `entry_id,entry,created_at
3,"-- ending hand #1",2023-01-01T01:05:00Z
2,"Alice @ a1 calls 10",2023-01-01T01:02:00Z
1,"Player stacks: #1 ""Alice @ a1"" (100)",2023-01-01T01:01:00Z
0,"-- starting hand #1 (id: h1)",2023-01-01T01:00:00Z
`;
  const stats = parsePokerNowLogStats(logCSV);
  assert.ok(stats.Alice);
  assert.strictEqual(stats.Alice.handsPlayed, 1);
  assert.strictEqual(stats.Alice.vpipHands, 1);
});

test('parsePokerNowLogStats with player actions lacking player_id suffix', () => {
  const logCSV = `entry,created_at
"-- ending hand #1",2023-01-01T01:05:00Z
"Bob calls 10",2023-01-01T01:02:00Z
"Player stacks: #1 Bob (100)",2023-01-01T01:01:00Z
"-- starting hand #1 (id: h1)",2023-01-01T01:00:00Z
`;
  const stats = parsePokerNowLogStats(logCSV);
  assert.ok(stats.Bob);
  assert.strictEqual(stats.Bob.handsPlayed, 1);
  assert.strictEqual(stats.Bob.vpipHands, 1);
});

test('parsePokerNowLogStats with chronological log input', () => {
  const logCSV = `entry_id,entry,created_at
0,"-- starting hand #1 (id: h1)",2023-01-01T01:00:00Z
1,"Player stacks: #1 ""Charlie @ c1"" (100)",2023-01-01T01:01:00Z
2,"Charlie @ c1 raises to 30",2023-01-01T01:02:00Z
3,"-- ending hand #1",2023-01-01T01:05:00Z
`;
  const stats = parsePokerNowLogStats(logCSV);
  assert.ok(stats.Charlie);
  assert.strictEqual(stats.Charlie.handsPlayed, 1);
  assert.strictEqual(stats.Charlie.vpipHands, 1);
  assert.strictEqual(stats.Charlie.pfrHands, 1);
});

test('parsePokerNowCSV handles spaced and hyphenated column headers', () => {
  const csv = `"Player Nickname","Buy In","Cash Out","Ending Stack"
"Alice @ 123",100,50,60
`;
  const results = parsePokerNowCSV(csv);
  assert.strictEqual(results.length, 1);
  const alice = results[0];
  assert.strictEqual(alice.name, 'Alice');
  assert.strictEqual(alice.buyIn, 100);
  assert.strictEqual(alice.buyOut, 50);
  assert.strictEqual(alice.stack, 60);

  const hyphenCsv = `player-nickname,buy-in,buy-out,current-stack
"Bob @ 456",200,30,170
`;
  const hyphenResults = parsePokerNowCSV(hyphenCsv);
  assert.strictEqual(hyphenResults.length, 1);
  const bob = hyphenResults[0];
  assert.strictEqual(bob.name, 'Bob');
  assert.strictEqual(bob.buyIn, 200);
  assert.strictEqual(bob.buyOut, 30);
  assert.strictEqual(bob.stack, 170);
});

test('parsePokerNowCSV parses multi-digit cash out amounts in log entries', () => {
  const logCSV = `entry_id,entry,created_at
2,"player ""Alice @ a1"" cashed out 200",2023-01-01T01:30:00Z
1,"approved the player ""Alice @ a1"" participation with a stack of 300",2023-01-01T01:00:00Z
`;
  const results = parsePokerNowCSV(logCSV);
  assert.strictEqual(results.length, 1);
  const alice = results[0];
  assert.strictEqual(alice.name, 'Alice');
  assert.strictEqual(alice.buyIn, 300);
  assert.strictEqual(alice.buyOut, 200);
});

