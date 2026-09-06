import test from 'node:test';
import assert from 'node:assert';
import { toChartData, fromChartData } from '../../src/utils/chartData.js';
import { toPerPlayerSeries } from '../../src/utils/pokernow-utils/parseHandLog.js';

function makeParsed() {
  const players = new Map([
    ['id-a', { nicknames: new Set(['Al', 'Alice']), currentStack: 0, active: false, buyIn: 0, cashOut: 0 }],
    ['id-b', { nicknames: new Set(['Bob']), currentStack: 0, active: false, buyIn: 0, cashOut: 0 }],
    ['id-c', { nicknames: new Set(['Cara']), currentStack: 0, active: false, buyIn: 0, cashOut: 0 }],
  ]);
  const snapshots = [
    { handNumber: 1, timestamp: 't1', nets: { 'id-a': { nickname: 'Alice', net: 10 }, 'id-b': { nickname: 'Bob', net: -10 } } },
    { handNumber: 2, timestamp: 't2', nets: { 'id-a': { nickname: 'Alice', net: 5 }, 'id-b': { nickname: 'Bob', net: -20 }, 'id-c': { nickname: 'Cara', net: 15 } } },
    { handNumber: null, timestamp: 'latest', nets: { 'id-a': { nickname: 'Alice', net: 0 }, 'id-b': { nickname: 'Bob', net: -15 }, 'id-c': { nickname: 'Cara', net: 15 } } },
  ];
  return { players, snapshots };
}

test('toChartData produces the compact columnar shape', () => {
  const cd = toChartData(makeParsed());

  assert.deepStrictEqual(cd.players, [
    { playerId: null, nickname: 'Alice' },
    { playerId: null, nickname: 'Bob' },
    { playerId: null, nickname: 'Cara' },
  ]);
  assert.deepStrictEqual(cd.hands, [1, 2, null]);
  assert.deepStrictEqual(cd.timestamps, ['t1', 't2', 'latest']);
  assert.deepStrictEqual(cd.nets, [
    [10, -10, null], // id-c not seated in snapshot 0
    [5, -20, 15],
    [0, -15, 15],
  ]);
});

test('toChartData handles an empty / malformed parse', () => {
  assert.deepStrictEqual(toChartData(null), { players: [], hands: [], timestamps: [], nets: [] });
  assert.deepStrictEqual(toChartData({ players: new Map(), snapshots: [] }), {
    players: [], hands: [], timestamps: [], nets: [],
  });
});

test('fromChartData(toChartData(p)) round-trips the charted series', () => {
  const parsed = makeParsed();
  const rebuilt = fromChartData(toChartData(parsed));

  // player order + labels preserved
  const origIds = [...parsed.players.keys()];
  const newIds = [...rebuilt.players.keys()];
  assert.strictEqual(newIds.length, origIds.length);
  newIds.forEach((id, i) => {
    const origNick = [...parsed.players.get(origIds[i]).nicknames].slice(-1)[0];
    assert.strictEqual([...rebuilt.players.get(id).nicknames].slice(-1)[0], origNick);
  });

  // every net that was present is preserved, and absent ones stay absent
  assert.strictEqual(rebuilt.snapshots.length, parsed.snapshots.length);
  parsed.snapshots.forEach((snap, si) => {
    const rebuiltNets = rebuilt.snapshots[si].nets;
    assert.strictEqual(rebuilt.snapshots[si].handNumber, snap.handNumber ?? null);
    origIds.forEach((origId, pi) => {
      const rebuiltVal = Object.values(rebuiltNets)[pi]?.net;
      assert.strictEqual(rebuiltVal, snap.nets[origId]?.net);
    });
  });
});

test('round-trip keeps toPerPlayerSeries output stable (drives the CSV download)', () => {
  const parsed = makeParsed();
  const direct = toPerPlayerSeries(parsed);
  const viaBlob = toPerPlayerSeries(fromChartData(toChartData(parsed)));

  const directPoints = Object.values(direct).map((s) => s.points.map((p) => [p.handNumber, p.timestamp, p.net]));
  const blobPoints = Object.values(viaBlob).map((s) => s.points.map((p) => [p.handNumber, p.timestamp, p.net]));
  assert.deepStrictEqual(blobPoints, directPoints);
});

test('a long session serialises small', () => {
  const players = new Map();
  for (let p = 0; p < 8; p++) {
    players.set(`p${p}`, { nicknames: new Set([`Player${p}`]), currentStack: 0, active: false, buyIn: 0, cashOut: 0 });
  }
  const snapshots = [];
  for (let h = 1; h <= 3000; h++) {
    const nets = {};
    for (let p = 0; p < 8; p++) nets[`p${p}`] = { nickname: `Player${p}`, net: Math.round(Math.sin(h * p) * 5000) };
    snapshots.push({ handNumber: h, timestamp: `2026-09-06T${String(h % 24).padStart(2, '0')}:00:00`, nets });
  }
  const bytes = new TextEncoder().encode(JSON.stringify(toChartData({ players, snapshots }))).length;
  assert.ok(bytes < 400_000, `expected < 400 KB raw, got ${bytes}`);
});
