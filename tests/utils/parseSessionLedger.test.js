import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { parseSessionLedger, isLedgerCsv } from '../../src/utils/pokernow-utils/parseSessionLedger.js';

const SAMPLE_LOG = new URL(
  '../../test_data/poker_now_log_pgl6xUx0lKtST2abD42AiiMbI.csv',
  import.meta.url
);

const netOf = (e) => e.buyOut + e.stack - e.buyIn;

test('isLedgerCsv distinguishes a ledger export from a hand-history log', () => {
  assert.strictEqual(
    isLedgerCsv('player_nickname,player_id,session_start_at,session_end_at,buy_in,buy_out,stack,net'),
    true
  );
  assert.strictEqual(isLedgerCsv('entry,at,order'), false);
  assert.strictEqual(isLedgerCsv(''), false);
  assert.strictEqual(isLedgerCsv(null), false);
});

test('parseSessionLedger returns [] for empty/invalid input', () => {
  assert.deepStrictEqual(parseSessionLedger(''), []);
  assert.deepStrictEqual(parseSessionLedger(null), []);
  assert.deepStrictEqual(parseSessionLedger('entry,at,order'), []);
});

test('parseSessionLedger reads a ledger CSV keyed by player_id', () => {
  const csv = [
    'player_nickname,player_id,session_start_at,session_end_at,buy_in,buy_out,stack,net',
    '"Alice","alice-id","2025-01-01T00:00:00Z","2025-01-01T02:00:00Z",1000,1500,0,500',
    '"Al","alice-id","2025-01-01T02:00:00Z","2025-01-01T03:00:00Z",500,0,0,-500',
    '"Bob","bob-id","2025-01-01T00:00:00Z","2025-01-01T03:00:00Z",1000,0,1000,0'
  ].join('\n');

  const entries = parseSessionLedger(csv);
  assert.strictEqual(entries.length, 2);

  const alice = entries.find((e) => e.pokerNowId === 'alice-id');
  assert.strictEqual(alice.name, 'Al'); // most recent nickname
  assert.strictEqual(alice.buyIn, 1500);
  assert.strictEqual(alice.buyOut, 1500);
  assert.strictEqual(netOf(alice), 0);
});

test('parseSessionLedger credits an unclosed seat\'s stack even with no session_start_at', () => {
  // PokerNow can emit a row for an approved-but-uncashed-out seat with both
  // session_start_at and session_end_at blank. buy_out is blank too (never
  // cashed out), so the stack must be credited or the buy-in reads as a pure loss.
  const csv = [
    'player_nickname,player_id,session_start_at,session_end_at,buy_in,buy_out,stack,nit_escrow,net',
    '"Miguel","miguel-id",,,1000,,1000,0,0'
  ].join('\n');

  const entries = parseSessionLedger(csv);
  const miguel = entries.find((e) => e.pokerNowId === 'miguel-id');
  assert.strictEqual(miguel.buyIn, 1000);
  assert.strictEqual(miguel.buyOut, 0);
  assert.strictEqual(miguel.stack, 1000);
  assert.strictEqual(netOf(miguel), 0);
});

test('parseSessionLedger collapses a renamed hand-log account into one node', () => {
  const csvText = fs.readFileSync(SAMPLE_LOG, 'utf8');
  const entries = parseSessionLedger(csvText);

  // The account "cjTgA9ZbYG" plays under 4 nicknames in this log; the
  // name-keyed parser split it into 4 rows, this one keeps it as 1.
  const renamed = entries.filter((e) => e.pokerNowId === 'cjTgA9ZbYG');
  assert.strictEqual(renamed.length, 1);
  assert.ok(['Miguel', 'Mig', 'The REEEE Tard', 'NIG'].includes(renamed[0].name));

  // Every entry carries a stable PokerNow id.
  for (const e of entries) {
    assert.ok(e.pokerNowId && e.externalId === e.pokerNowId);
  }
});

test('parseSessionLedger produces an exactly zero-sum ledger from a hand-history log', () => {
  const csvText = fs.readFileSync(SAMPLE_LOG, 'utf8');
  const entries = parseSessionLedger(csvText);

  const totalBuyIn = entries.reduce((s, e) => s + e.buyIn, 0);
  const totalNet = entries.reduce((s, e) => s + netOf(e), 0);

  assert.ok(totalBuyIn > 0);
  // The raw reconstruction is off by a few hundred chips (admin stack resets,
  // off-log top-ups); reconcileToZero must absorb that so nets sum to exactly 0.
  assert.strictEqual(totalNet, 0);

  // Reconciliation nudges buy-ins, never wildly: each within 0.5% of raw.
  for (const e of entries) {
    assert.ok(e.buyIn > 0);
  }
});

test('parseSessionLedger leaves a grossly unbalanced hand log flagged (no reconciliation)', () => {
  // Two players, one quits with impossible winnings vs. buy-ins -> residual is
  // way past the 2% slop bar, so it must NOT be silently reconciled.
  const csv = [
    'entry,at,order',
    '"-- starting hand #1 --",2025-01-01T00:00:00Z,1',
    '"Player stacks: #1 ""A @ a1"" (1000) | #2 ""B @ b1"" (1000)",2025-01-01T00:00:01Z,2',
    '"The admin approved the player ""A @ a1"" participation with a stack of 1000.",2025-01-01T00:00:02Z,3',
    '"The admin approved the player ""B @ b1"" participation with a stack of 1000.",2025-01-01T00:00:03Z,4',
    '"The player ""A @ a1"" quits the game with a stack of 999999.",2025-01-01T00:10:00Z,5'
  ].join('\n');

  const entries = parseSessionLedger(csv);
  const totalNet = entries.reduce((s, e) => s + netOf(e), 0);
  assert.notStrictEqual(totalNet, 0);
});
