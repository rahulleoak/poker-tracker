import test from 'node:test';
import assert from 'node:assert';
import { calculateSettlement } from './settlement.js';

test('Standard Settlement - without Bank Buddies', () => {
  const entries = [
    { name: 'Alice', buyIn: 100, buyOut: 0, stack: 0 },
    { name: 'Bob', buyIn: 100, buyOut: 0, stack: 150 },
    { name: 'Charlie', buyIn: 100, buyOut: 0, stack: 150 }
  ];

  const result = calculateSettlement({
    entries,
    chipValue: 1,
    gameCurrency: 'USD',
    settlementCurrency: 'USD',
    useBankBuddies: false
  });

  assert.strictEqual(result.isBalanced, true);
  assert.strictEqual(result.settlements.length, 2);
  assert.deepStrictEqual(result.settlements[0], { from: 'Alice', to: 'Bob', amount: 50 });
  assert.deepStrictEqual(result.settlements[1], { from: 'Alice', to: 'Charlie', amount: 50 });
});

test('Bank Buddy - Strict Mode with Explicit Banks', () => {
  const entries = [
    { name: 'Alice', buyIn: 100, buyOut: 0, stack: 0, currency: 'CAD', isBank: false },
    { name: 'Alice_Bank', buyIn: 100, buyOut: 0, stack: 120, currency: 'CAD', isBank: true },
    { name: 'Bob', buyIn: 100, buyOut: 0, stack: 200, currency: 'USD', isBank: false },
    { name: 'Bob_Bank', buyIn: 100, buyOut: 0, stack: 80, currency: 'USD', isBank: true }
  ];

  const result = calculateSettlement({
    entries,
    chipValue: 1,
    gameCurrency: 'USD',
    settlementCurrency: 'USD',
    useBankBuddies: true,
    bankSettlementMode: 'strict'
  });

  assert.strictEqual(result.isBalanced, true);

  // Cross-Border should be between banks only
  const crossBorder = result.settlements.filter(tx => tx.type === 'Cross-Border');
  assert.strictEqual(crossBorder.length, 1);
  assert.strictEqual(crossBorder[0].from, 'Alice_Bank');
  assert.strictEqual(crossBorder[0].to, 'Bob_Bank');

  // Local players settle with their local bank
  const bankSettlements = result.settlements.filter(tx => tx.type === 'Bank-Settlement');
  assert.strictEqual(bankSettlements.length, 2);
  
  const aliceSettle = bankSettlements.find(tx => tx.from === 'Alice');
  assert.notStrictEqual(aliceSettle, undefined);
  assert.strictEqual(aliceSettle.to, 'Alice_Bank');

  const bobSettle = bankSettlements.find(tx => tx.to === 'Bob');
  assert.notStrictEqual(bobSettle, undefined);
  assert.strictEqual(bobSettle.from, 'Bob_Bank');
});

test('Bank Buddy - Strict Mode with Auto-Elected Fallback Banks', () => {
  const entries = [
    { name: 'Alice', buyIn: 100, buyOut: 0, stack: 0, currency: 'CAD', isBank: false },
    { name: 'Charlie', buyIn: 50, buyOut: 0, stack: 70, currency: 'CAD', isBank: false }, // Alice has higher buy-in, so she should be elected bank
    { name: 'Bob', buyIn: 100, buyOut: 0, stack: 180, currency: 'USD', isBank: false } // Bob should be elected bank for USD
  ];

  const result = calculateSettlement({
    entries,
    chipValue: 1,
    gameCurrency: 'USD',
    settlementCurrency: 'USD',
    useBankBuddies: true,
    bankSettlementMode: 'strict'
  });

  assert.strictEqual(result.isBalanced, true);

  // Cross-Border should be between elected banks (Alice and Bob)
  const crossBorder = result.settlements.filter(tx => tx.type === 'Cross-Border');
  assert.strictEqual(crossBorder.length, 1);
  assert.strictEqual(crossBorder[0].from, 'Alice');
  assert.strictEqual(crossBorder[0].to, 'Bob');
  assert.strictEqual(crossBorder[0].amount, 80);

  // Local players settle with their elected bank, no non-bank players are treated as banks
  const bankSettlements = result.settlements.filter(tx => tx.type === 'Bank-Settlement');
  assert.strictEqual(bankSettlements.length, 1); // Only Charlie settles with Alice locally (since Bob is bank)
  assert.deepStrictEqual(bankSettlements[0], { from: 'Alice', to: 'Charlie', amount: 20, type: 'Bank-Settlement' });
});

test('Bank Buddy - International-Only Mode with Auto-Elected', () => {
  const entries = [
    { name: 'Alice', buyIn: 100, buyOut: 0, stack: 0, currency: 'CAD', isBank: false },
    { name: 'Charlie', buyIn: 50, buyOut: 0, stack: 70, currency: 'CAD', isBank: false },
    { name: 'Bob', buyIn: 100, buyOut: 0, stack: 180, currency: 'USD', isBank: false }
  ];

  const result = calculateSettlement({
    entries,
    chipValue: 1,
    gameCurrency: 'USD',
    settlementCurrency: 'USD',
    useBankBuddies: true,
    bankSettlementMode: 'international-only'
  });

  assert.strictEqual(result.isBalanced, true);

  // Cross-Border between elected banks
  const crossBorder = result.settlements.filter(tx => tx.type === 'Cross-Border');
  assert.strictEqual(crossBorder.length, 1);
  assert.strictEqual(crossBorder[0].from, 'Alice');
  assert.strictEqual(crossBorder[0].to, 'Bob');
  assert.strictEqual(crossBorder[0].amount, 80);

  // Local settlements between non-banks in the same zone
  const localSettlements = result.settlements.filter(tx => tx.type === 'Local');
  assert.strictEqual(localSettlements.length, 1);
  assert.deepStrictEqual(localSettlements[0], { from: 'Alice', to: 'Charlie', amount: 20, type: 'Local' });
});
