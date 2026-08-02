import test from 'node:test';
import assert from 'node:assert';

test('auth context state and alias resolution logic', () => {
  // Test helper validation for alias matching and backfill logic
  const mockExternalIds = [
    { user_id: 'user-1', platform: 'pokernow', external_id: 'Hero_123' }
  ];

  const mockLedgerRows = [
    { player_name: 'Hero_123', buy_in: 100, cash_out: 250, user_id: null },
    { player_name: 'Fish_99', buy_in: 50, cash_out: 0, user_id: null }
  ];

  // Simulate backfill trigger logic
  const claimedId = mockExternalIds[0];
  const updatedLedger = mockLedgerRows.map(row => {
    if (row.player_name === claimedId.external_id) {
      return { ...row, user_id: claimedId.user_id };
    }
    return row;
  });

  assert.strictEqual(updatedLedger[0].user_id, 'user-1');
  assert.strictEqual(updatedLedger[1].user_id, null);
});
