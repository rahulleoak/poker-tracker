import test from 'node:test';
import assert from 'node:assert';
import { computeBankSettlement } from '../../src/utils/bankSettlement.js';
import { buildSettlementText } from '../../src/utils/settlementText.js';

const e = (name, pokerNowId, net) => ({
  name,
  pokerNowId,
  buyIn: net < 0 ? -net : 0,
  buyOut: 0,
  stack: net > 0 ? net : 0
});

// Two countries, a bank each, one non-bank player each → an inter-bank leg too.
const entries = [
  e('Adam', 'adam', 0),
  e('Akarsh', 'akarsh', -5208),
  e('Miguel', 'miguel', -3620),
  e('Kush', 'kush', 0),
  e('Rahul', 'rahul', 8828)
];
const cfg = {
  countryByKey: { kush: 'US', rahul: 'US' },
  bankByCountry: { CA: 'adam', US: 'kush' },
  chipsPerCad: 100,
  cadToUsd: 0.723
};

test('renders a chat-ready settlement block', () => {
  const s = computeBankSettlement({ entries, ...cfg });
  const text = buildSettlementText(s, { sessionId: 'game1', isSettled: () => false });

  assert.match(text, /^Settlement — game1\n100 chips = 1 CAD · 1 CAD = 0.723 USD\n/);
  assert.match(text, /🇨🇦 Canada — bank: Adam \(CAD\)/);
  assert.match(text, /\[ \] Akarsh pays 52\.08 CAD to Adam/);
  assert.match(text, /Adam \(bank\): net [+-]\d+\.\d\d CAD/);
  assert.match(text, /🇺🇸 United States — bank: Kush \(USD\)/);
  assert.match(text, /\(\d+\.\d\d CAD\)/); // USD line shows the CAD equivalent
  assert.match(text, /Between banks\n\[ \] /);
});

test('is deterministic regardless of entry order', () => {
  const a = buildSettlementText(computeBankSettlement({ entries, ...cfg }), { sessionId: 'g' });
  const shuffled = [entries[3], entries[0], entries[4], entries[1], entries[2]];
  const b = buildSettlementText(computeBankSettlement({ entries: shuffled, ...cfg }), { sessionId: 'g' });
  assert.strictEqual(a, b);
});

test('marks settled legs with [x]', () => {
  const s = computeBankSettlement({ entries, ...cfg });
  const settled = new Set(['player:akarsh']);
  const text = buildSettlementText(s, {
    sessionId: 'g',
    isSettled: (legId) => settled.has(legId)
  });
  assert.match(text, /\[x\] Akarsh pays 52\.08 CAD to Adam/);
  assert.match(text, /\[ \] Miguel pays 36\.20 CAD to Adam/);
});

test('no bank assigned → notes it instead of transfers', () => {
  const s = computeBankSettlement({
    entries: [e('A', 'a', 100), e('B', 'b', -100)],
    bankByCountry: {},
    chipsPerCad: 1
  });
  const text = buildSettlementText(s, { sessionId: 'g' });
  assert.match(text, /no bank/);
  assert.match(text, /assign a bank to route settlement/);
});
