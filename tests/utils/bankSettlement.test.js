import test from 'node:test';
import assert from 'node:assert';
import { computeBankSettlement, keyOfEntry } from '../../src/utils/bankSettlement.js';

// buyIn/buyOut/stack shorthand: net chips = buyOut + stack - buyIn
const p = (name, net, extra = {}) => ({ name, pokerNowId: name.toLowerCase(), buyIn: 0, buyOut: 0, stack: net, ...extra });

test('keyOfEntry prefers pokerNowId then externalId then name', () => {
  assert.strictEqual(keyOfEntry({ pokerNowId: 'ABC', name: 'x' }), 'abc');
  assert.strictEqual(keyOfEntry({ externalId: 'Def', name: 'x' }), 'def');
  assert.strictEqual(keyOfEntry({ name: 'Gary' }), 'gary');
});

test('single country: non-bank players settle their whole net with the bank', () => {
  const entries = [p('Bank', 0), p('Alice', 300), p('Bob', -300)];
  const r = computeBankSettlement({
    entries,
    countryByKey: {},
    bankByCountry: { CA: 'bank' },
    chipsPerCad: 100
  });

  assert.strictEqual(r.balanced, true);
  assert.strictEqual(r.countries.length, 1);
  assert.strictEqual(r.countries[0].bankName, 'Bank');
  assert.strictEqual(r.bankTransfers.length, 0); // only one country

  const alice = r.playerTransfers.find((t) => t.to === 'Alice');
  assert.strictEqual(alice.from, 'Bank');
  assert.ok(Math.abs(alice.amount - 3) < 1e-9);

  const bob = r.playerTransfers.find((t) => t.from === 'Bob');
  assert.strictEqual(bob.to, 'Bank');
  assert.ok(Math.abs(bob.amount - 3) < 1e-9);
});

test('two countries: banks settle each country aggregate net between themselves', () => {
  const entries = [
    p('BankCA', -100, { pokerNowId: 'bankca' }),
    p('P1', 400, { pokerNowId: 'p1' }),
    p('BankUS', 0, { pokerNowId: 'bankus' }),
    p('P2', -300, { pokerNowId: 'p2' })
  ];
  const r = computeBankSettlement({
    entries,
    countryByKey: { bankus: 'US', p2: 'US' }, // BankCA + P1 default to CA
    bankByCountry: { CA: 'bankca', US: 'bankus' },
    chipsPerCad: 100
  });

  const ca = r.countries.find((c) => c.code === 'CA');
  const us = r.countries.find((c) => c.code === 'US');
  assert.ok(Math.abs(ca.net - 3) < 1e-9); // (-100 + 400) / 100
  assert.ok(Math.abs(us.net + 3) < 1e-9); // -300 / 100

  assert.strictEqual(r.bankTransfers.length, 1);
  assert.strictEqual(r.bankTransfers[0].from, 'BankUS');
  assert.strictEqual(r.bankTransfers[0].to, 'BankCA');
  assert.ok(Math.abs(r.bankTransfers[0].amount - 3) < 1e-9);
});

test('country with no bank: its players fall through to the inter-country pool', () => {
  const entries = [
    p('BankCA', 0, { pokerNowId: 'bankca' }),
    p('CADwinner', 200, { pokerNowId: 'cadw' }),
    p('Loner', -200, { pokerNowId: 'loner' })
  ];
  const r = computeBankSettlement({
    entries,
    countryByKey: { loner: 'US' }, // US has no bank assigned
    bankByCountry: { CA: 'bankca' },
    chipsPerCad: 1
  });

  // CADwinner is paid by BankCA intra-country
  assert.ok(r.playerTransfers.some((t) => t.from === 'BankCA' && t.to === 'CADwinner' && Math.abs(t.amount - 200) < 1e-9));
  // Loner (no bank) settles straight with BankCA (who carries CA's +200 net)
  assert.strictEqual(r.bankTransfers.length, 1);
  assert.strictEqual(r.bankTransfers[0].from, 'Loner');
  assert.strictEqual(r.bankTransfers[0].to, 'BankCA');
  assert.ok(Math.abs(r.bankTransfers[0].amount - 200) < 1e-9);
});

test('chipsPerCad scales every amount', () => {
  const entries = [p('B', 0), p('W', 500), p('L', -500)];
  const r = computeBankSettlement({ entries, bankByCountry: { CA: 'b' }, chipsPerCad: 250 });
  const win = r.playerTransfers.find((t) => t.to === 'W');
  assert.ok(Math.abs(win.amount - 2) < 1e-9); // 500 / 250
});

test('each country reports amounts in its own currency via cadToUsd', () => {
  const entries = [
    p('BankCA', 0, { pokerNowId: 'bankca' }),
    p('CAwin', 1000, { pokerNowId: 'cawin' }),
    p('BankUS', 0, { pokerNowId: 'bankus' }),
    p('USlose', -1000, { pokerNowId: 'uslose' })
  ];
  const r = computeBankSettlement({
    entries,
    countryByKey: { bankus: 'US', uslose: 'US' },
    bankByCountry: { CA: 'bankca', US: 'bankus' },
    chipsPerCad: 100, // 1000 chips -> 10 CAD
    cadToUsd: 0.75
  });

  assert.strictEqual(r.cadToUsd, 0.75);

  const ca = r.countries.find((c) => c.code === 'CA');
  const us = r.countries.find((c) => c.code === 'US');
  assert.strictEqual(ca.currency, 'CAD');
  assert.strictEqual(us.currency, 'USD');

  const caWin = r.playerTransfers.find((t) => t.to === 'CAwin');
  assert.ok(Math.abs(caWin.amount - 10) < 1e-9); // CAD (canonical)
  assert.ok(Math.abs(caWin.amountLocal - 10) < 1e-9); // CAD country -> unchanged
  assert.strictEqual(caWin.currency, 'CAD');

  const usLose = r.playerTransfers.find((t) => t.from === 'USlose');
  assert.ok(Math.abs(usLose.amount - 10) < 1e-9); // CAD canonical
  assert.ok(Math.abs(usLose.amountLocal - 7.5) < 1e-9); // 10 CAD * 0.75
  assert.strictEqual(usLose.currency, 'USD');

  assert.ok(Math.abs(us.netLocal + 7.5) < 1e-9); // -10 CAD * 0.75
});

test('stale bank key (bank not a member of the country) is ignored', () => {
  const entries = [p('A', 100, { pokerNowId: 'a' }), p('B', -100, { pokerNowId: 'b' })];
  const r = computeBankSettlement({
    entries,
    countryByKey: {},
    bankByCountry: { CA: 'ghost' },
    chipsPerCad: 1
  });
  assert.strictEqual(r.countries[0].bankName, null);
  assert.strictEqual(r.playerTransfers.length, 0);
  // both players go to the inter pool and settle directly
  assert.strictEqual(r.bankTransfers.length, 1);
  assert.ok(Math.abs(r.bankTransfers[0].amount - 100) < 1e-9);
});
