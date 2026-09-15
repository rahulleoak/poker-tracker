import test from 'node:test';
import assert from 'node:assert/strict';
import { makeNameResolver } from '../src/utils/adminIdentity.js';
import { toChartData, fromChartData } from '../src/utils/chartData.js';

test('Session Analytics: identity resolution maps seat names and IDs to master profile names', () => {
  const players = [
    { id: 'p-rahul', display_name: 'Rahul', country: 'CA', preferred_currency: 'CAD' },
    { id: 'p-kevin', display_name: 'Kevin', country: 'US', preferred_currency: 'USD' }
  ];
  const playerLinks = [
    { id: 'l-1', player_id: 'p-rahul', external_id: 'rahul_alias', session_name: 'Rahul Seat' },
    { id: 'l-2', player_id: 'p-kevin', external_id: 'kevin_pn_id', session_name: 'Kevin Pro' }
  ];

  const nameOf = makeNameResolver(players, playerLinks);

  assert.equal(nameOf('p-rahul'), 'Rahul');
  assert.equal(nameOf('p-kevin'), 'Kevin');
  assert.equal(nameOf('rahul_alias'), 'Rahul');
  assert.equal(nameOf('kevin_pn_id'), 'Kevin');
  assert.equal(nameOf('non_existent'), null);
});

test('Session Analytics: chart_data serialisation and deserialisation preserves player snapshots', () => {
  const players = new Map([
    ['id-a', { nicknames: new Set(['Rahul']), currentStack: 0, active: false, buyIn: 100, cashOut: 0 }],
    ['id-b', { nicknames: new Set(['Kevin']), currentStack: 0, active: false, buyIn: 100, cashOut: 0 }],
  ]);
  const snapshots = [
    { handNumber: 1, timestamp: 't1', nets: { 'id-a': { nickname: 'Rahul', net: 50 }, 'id-b': { nickname: 'Kevin', net: -50 } } },
    { handNumber: 2, timestamp: 't2', nets: { 'id-a': { nickname: 'Rahul', net: 100 }, 'id-b': { nickname: 'Kevin', net: -100 } } },
  ];

  const parsed = { players, snapshots };
  const cd = toChartData(parsed);

  assert.equal(cd.players.length, 2);
  assert.equal(cd.hands.length, 2);

  const roundTripped = fromChartData(cd);
  assert.equal(roundTripped.players.size, 2);
  assert.equal(roundTripped.snapshots.length, 2);
});
