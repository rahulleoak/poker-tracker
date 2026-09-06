import test from 'node:test';
import assert from 'node:assert';
import { buildCountrySettlement, markKey } from '../../src/utils/settlementLedger.js';

// net chips = buyOut + stack - buyIn
const e = (name, pokerNowId, net, playerId = null) => ({
  name,
  pokerNowId,
  playerId,
  buyIn: net < 0 ? -net : 0,
  buyOut: 0,
  stack: net > 0 ? net : 0
});

const bankCfg = { bankByCountry: { CA: 'adam' }, chipsPerCad: 1 };

const session = (id, date, entries) => ({ id, date, entries, settlement: bankCfg });

test('rolls one session up per player against the bank', () => {
  const s = session('s1', '2026-09-01', [
    e('Adam', 'adam', 0, 'adam-id'),
    e('Akarsh', 'akarsh', -100, 'ak-id'),
    e('Miguel', 'miguel', 100, 'mig-id')
  ]);
  const r = buildCountrySettlement({ sessions: [s], marks: [], countryCode: 'CA' });

  const ak = r.players.find((p) => p.name === 'Akarsh');
  assert.strictEqual(ak.direction, 'owes_bank');
  assert.ok(Math.abs(ak.outstandingLocal + 100) < 1e-9);
  assert.strictEqual(ak.outstandingCount, 1);

  const mig = r.players.find((p) => p.name === 'Miguel');
  assert.strictEqual(mig.direction, 'bank_owes');
  assert.ok(Math.abs(mig.outstandingLocal - 100) < 1e-9);

  assert.ok(Math.abs(r.collectLocal - 100) < 1e-9);
  assert.ok(Math.abs(r.payLocal - 100) < 1e-9);
  assert.strictEqual(r.outstandingPlayerCount, 2);
});

test('sums a player across sessions, keyed by master playerId', () => {
  const sessions = [
    session('s1', '2026-09-01', [
      e('Adam', 'adam', 0, 'adam-id'),
      e('Akarsh', 'akarsh', -100, 'ak-id'),
      e('Miguel', 'miguel', 100, 'mig-id')
    ]),
    // different seat nickname / id, same profile
    session('s2', '2026-09-08', [
      e('Adam', 'adam', 0, 'adam-id'),
      e('AkarshM', 'akarsh_2', -50, 'ak-id'),
      e('Miguel', 'miguel', 50, 'mig-id')
    ])
  ];
  const r = buildCountrySettlement({ sessions, marks: [], countryCode: 'CA' });

  const ak = r.players.find((p) => p.name === 'AkarshM'); // newest session name wins
  assert.strictEqual(ak.outstandingCount, 2);
  assert.ok(Math.abs(ak.outstandingLocal + 150) < 1e-9);
});

test('an active mark clears that leg from the outstanding total', () => {
  const sessions = [
    session('s1', '2026-09-01', [
      e('Adam', 'adam', 0, 'adam-id'),
      e('Akarsh', 'akarsh', -100, 'ak-id'),
      e('Miguel', 'miguel', 100, 'mig-id')
    ]),
    session('s2', '2026-09-08', [
      e('Adam', 'adam', 0, 'adam-id'),
      e('Akarsh', 'akarsh', -50, 'ak-id'),
      e('Miguel', 'miguel', 50, 'mig-id')
    ])
  ];
  const marks = [{ session_id: 's1', leg_id: 'player:akarsh', undone_at: null }];
  const r = buildCountrySettlement({ sessions, marks, countryCode: 'CA' });

  const ak = r.players.find((p) => p.name === 'Akarsh');
  assert.strictEqual(ak.outstandingCount, 1);
  assert.strictEqual(ak.settledCount, 1);
  assert.ok(Math.abs(ak.outstandingLocal + 50) < 1e-9);
});

test('an undone mark is ignored', () => {
  const s = session('s1', '2026-09-01', [
    e('Adam', 'adam', 0, 'adam-id'),
    e('Akarsh', 'akarsh', -100, 'ak-id'),
    e('Miguel', 'miguel', 100, 'mig-id')
  ]);
  const marks = [{ session_id: 's1', leg_id: 'player:akarsh', undone_at: '2026-09-02T00:00:00Z' }];
  const r = buildCountrySettlement({ sessions: [s], marks, countryCode: 'CA' });
  const ak = r.players.find((p) => p.name === 'Akarsh');
  assert.strictEqual(ak.outstandingCount, 1);
});

test('markKey composes session and leg into a collision-free key', () => {
  assert.strictEqual(markKey('s1', 'player:akarsh'), markKey('s1', 'player:akarsh'));
  assert.notStrictEqual(markKey('s1', 'player:a'), markKey('s1', 'player:b'));
  assert.notStrictEqual(markKey('s1', 'x'), markKey('s2', 'x'));
});

test('nameOf resolves master profile names for bank and parties', () => {
  const s = session('s1', '2026-09-01', [
    e('adm', 'adam', 0, 'adam-id'),
    e('akarshL', 'akarsh', -100, 'ak-id'),
    e('mig', 'miguel', 100, 'mig-id')
  ]);
  const nameOf = (id) =>
    ({ 'adam-id': 'Adam', 'ak-id': 'Akarsh', 'mig-id': 'Miguel' }[id] || null);
  const r = buildCountrySettlement({ sessions: [s], marks: [], countryCode: 'CA', nameOf });

  assert.strictEqual(r.bankName, 'Adam');
  const ak = r.players.find((p) => p.playerId === 'ak-id');
  assert.strictEqual(ak.name, 'Akarsh');
  assert.strictEqual(ak.lines[0].bankName, 'Adam');
  assert.strictEqual(ak.lines[0].bankPartyKey, 'adam-id');
});

test('opposite-direction sessions net against each other', () => {
  const sessions = [
    session('s1', '2026-09-01', [
      e('Adam', 'adam', 0, 'adam-id'),
      e('Akarsh', 'akarsh', -100, 'ak-id'),
      e('Miguel', 'miguel', 100, 'mig-id')
    ]),
    session('s2', '2026-09-08', [
      e('Adam', 'adam', 0, 'adam-id'),
      e('Akarsh', 'akarsh', 40, 'ak-id'),
      e('Miguel', 'miguel', -40, 'mig-id')
    ])
  ];
  const r = buildCountrySettlement({ sessions, marks: [], countryCode: 'CA' });
  const ak = r.players.find((p) => p.name === 'Akarsh');
  // owed 100, then up 40 → net owes 60
  assert.ok(Math.abs(ak.outstandingLocal + 60) < 1e-9);
  assert.strictEqual(ak.direction, 'owes_bank');
});
