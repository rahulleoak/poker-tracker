import test from 'node:test';
import assert from 'node:assert';
import {
  buildCountrySettlement,
  legsFromSession,
  markKey
} from '../../src/utils/settlementLedger.js';

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
const legsOf = (...sessions) => sessions.flatMap(legsFromSession);

test('legsFromSession flattens transfers to leg rows', () => {
  const legs = legsFromSession(
    session('s1', '2026-09-01', [
      e('Adam', 'adam', 0, 'adam-id'),
      e('Akarsh', 'akarsh', -100, 'ak-id'),
      e('Miguel', 'miguel', 100, 'mig-id')
    ])
  );
  const ak = legs.find((l) => l.leg_id === 'player:akarsh');
  assert.strictEqual(ak.scope, 'player');
  assert.strictEqual(ak.country, 'CA');
  assert.strictEqual(ak.party_key, 'ak-id'); // resolved to the master profile
  assert.strictEqual(ak.bank_key, 'adam-id');
  assert.strictEqual(ak.direction, 'to_bank');
  assert.strictEqual(ak.amount_cad, 100);
  assert.strictEqual(ak.session_date, '2026-09-01');
});

test('rolls one session up per player against the bank', () => {
  const r = buildCountrySettlement({
    legs: legsOf(
      session('s1', '2026-09-01', [
        e('Adam', 'adam', 0, 'adam-id'),
        e('Akarsh', 'akarsh', -100, 'ak-id'),
        e('Miguel', 'miguel', 100, 'mig-id')
      ])
    ),
    marks: [],
    countryCode: 'CA'
  });

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
  const r = buildCountrySettlement({
    legs: legsOf(
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
    ),
    marks: [],
    countryCode: 'CA'
  });

  const ak = r.players.find((p) => p.partyKey === 'ak-id');
  assert.strictEqual(ak.name, 'AkarshM'); // newest session name wins
  assert.strictEqual(ak.outstandingCount, 2);
  assert.ok(Math.abs(ak.outstandingLocal + 150) < 1e-9);
});

test('an active mark clears that leg from the outstanding total', () => {
  const legs = legsOf(
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
  );
  const marks = [{ session_id: 's1', leg_id: 'player:akarsh', undone_at: null }];
  const r = buildCountrySettlement({ legs, marks, countryCode: 'CA' });

  const ak = r.players.find((p) => p.name === 'Akarsh');
  assert.strictEqual(ak.outstandingCount, 1);
  assert.strictEqual(ak.settledCount, 1);
  assert.ok(Math.abs(ak.outstandingLocal + 50) < 1e-9);
});

test('an undone mark is ignored', () => {
  const legs = legsOf(
    session('s1', '2026-09-01', [
      e('Adam', 'adam', 0, 'adam-id'),
      e('Akarsh', 'akarsh', -100, 'ak-id'),
      e('Miguel', 'miguel', 100, 'mig-id')
    ])
  );
  const marks = [{ session_id: 's1', leg_id: 'player:akarsh', undone_at: '2026-09-02T00:00:00Z' }];
  const r = buildCountrySettlement({ legs, marks, countryCode: 'CA' });
  const ak = r.players.find((p) => p.name === 'Akarsh');
  assert.strictEqual(ak.outstandingCount, 1);
});

test('markKey composes session and leg into a collision-free key', () => {
  assert.strictEqual(markKey('s1', 'player:akarsh'), markKey('s1', 'player:akarsh'));
  assert.notStrictEqual(markKey('s1', 'player:a'), markKey('s1', 'player:b'));
  assert.notStrictEqual(markKey('s1', 'x'), markKey('s2', 'x'));
});

test('nameOf resolves master profile names for bank and parties', () => {
  const legs = legsOf(
    session('s1', '2026-09-01', [
      e('adm', 'adam', 0, 'adam-id'),
      e('akarshL', 'akarsh', -100, 'ak-id'),
      e('mig', 'miguel', 100, 'mig-id')
    ])
  );
  const nameOf = (id) =>
    ({ 'adam-id': 'Adam', 'ak-id': 'Akarsh', 'mig-id': 'Miguel' }[id] || null);
  const r = buildCountrySettlement({ legs, marks: [], countryCode: 'CA', nameOf });

  assert.strictEqual(r.bankName, 'Adam');
  const ak = r.players.find((p) => p.playerId === 'ak-id');
  assert.strictEqual(ak.name, 'Akarsh');
  assert.strictEqual(ak.lines[0].bankName, 'Adam');
  assert.strictEqual(ak.lines[0].bankPartyKey, 'adam-id');
});

test('opposite-direction sessions net against each other', () => {
  const r = buildCountrySettlement({
    legs: legsOf(
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
    ),
    marks: [],
    countryCode: 'CA'
  });
  const ak = r.players.find((p) => p.partyKey === 'ak-id');
  // owed 100, then up 40 → net owes 60
  assert.ok(Math.abs(ak.outstandingLocal + 60) < 1e-9);
  assert.strictEqual(ak.direction, 'owes_bank');
});

test('two-country session: inter-bank leg shows on both countries', () => {
  const legs = legsFromSession({
    id: 's1',
    date: '2026-09-01',
    entries: [
      e('Adam', 'adam', -100, 'adam-id'),
      e('P1', 'p1', 400, 'p1-id'),
      e('Kush', 'kush', 0, 'kush-id'),
      e('P2', 'p2', -300, 'p2-id')
    ],
    settlement: {
      countryByKey: { kush: 'US', p2: 'US' },
      bankByCountry: { CA: 'adam', US: 'kush' },
      chipsPerCad: 100
    }
  });

  const bankLeg = legs.find((l) => l.scope === 'bank');
  assert.ok(bankLeg);
  assert.strictEqual(bankLeg.country, 'US'); // debtor
  assert.strictEqual(bankLeg.counter_country, 'CA'); // creditor

  const ca = buildCountrySettlement({ legs, marks: [], countryCode: 'CA' });
  const us = buildCountrySettlement({ legs, marks: [], countryCode: 'US' });
  assert.strictEqual(ca.bankLines.length, 1);
  assert.strictEqual(us.bankLines.length, 1);
  assert.strictEqual(us.bankLines[0].outgoing, true); // US bank pays
  assert.strictEqual(ca.bankLines[0].outgoing, false); // CA bank receives
});
