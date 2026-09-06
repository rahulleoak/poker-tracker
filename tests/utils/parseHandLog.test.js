import test from 'node:test';
import assert from 'node:assert';
import { groupCumulativeNet, reconcileCumulativeNet } from '../../src/utils/pokernow-utils/parseHandLog.js';

function makeParsed() {
  const players = new Map([
    ['id-a', { nicknames: new Set(['Al', 'Alice']), currentStack: 0, active: false, buyIn: 0, cashOut: 0 }],
    ['id-b', { nicknames: new Set(['Bob']), currentStack: 0, active: false, buyIn: 0, cashOut: 0 }],
    ['id-c', { nicknames: new Set(['Alice2']), currentStack: 0, active: false, buyIn: 0, cashOut: 0 }]
  ]);
  const snapshots = [
    { handNumber: 1, timestamp: 't1', nets: { 'id-a': { nickname: 'Alice', net: 10 }, 'id-b': { nickname: 'Bob', net: -10 } } },
    { handNumber: 2, timestamp: 't2', nets: { 'id-a': { nickname: 'Alice', net: 5 }, 'id-b': { nickname: 'Bob', net: -20 }, 'id-c': { nickname: 'Alice2', net: 15 } } }
  ];
  return { players, snapshots };
}

test('groupCumulativeNet merges linked ids into one summed series', () => {
  const grouped = groupCumulativeNet(makeParsed(), [['id-a', 'id-c']]);

  assert.deepStrictEqual([...grouped.players.keys()], ['id-a', 'id-b']);
  assert.strictEqual([...grouped.players.get('id-a').nicknames].slice(-1)[0], 'Alice');

  assert.strictEqual(grouped.snapshots[0].nets['id-a'].net, 10); // id-c hasn't played yet
  assert.strictEqual(grouped.snapshots[1].nets['id-a'].net, 20); // 5 + 15
  assert.strictEqual(grouped.snapshots[1].nets['id-b'].net, -20);
  assert.ok(!('id-c' in grouped.snapshots[1].nets));
});

test('groupCumulativeNet resolves group tokens by nickname, not just id', () => {
  const grouped = groupCumulativeNet(makeParsed(), [['alice', 'alice2']]);
  assert.deepStrictEqual([...grouped.players.keys()], ['id-a', 'id-b']);
  assert.strictEqual(grouped.snapshots[1].nets['id-a'].net, 20);
});

test('groupCumulativeNet is a no-op without a resolvable multi-member group', () => {
  const parsed = makeParsed();
  assert.strictEqual(groupCumulativeNet(parsed, []), parsed);
  assert.strictEqual(groupCumulativeNet(parsed, [['id-a']]), parsed);
  assert.strictEqual(groupCumulativeNet(parsed, [['id-a', 'ghost']]), parsed);
  assert.strictEqual(groupCumulativeNet(null, [['x', 'y']]), null);
});

test('reconcileCumulativeNet drives the final point to exactly zero', () => {
  const players = new Map([
    ['a', { nicknames: new Set(['A']), currentStack: 0, active: false, buyIn: 1000, cashOut: 0 }],
    ['b', { nicknames: new Set(['B']), currentStack: 0, active: false, buyIn: 3000, cashOut: 0 }]
  ]);
  const snapshots = [
    { handNumber: 1, timestamp: 't1', nets: { a: { nickname: 'A', net: 0 }, b: { nickname: 'B', net: 0 } } },
    { handNumber: 2, timestamp: 't2', nets: { a: { nickname: 'A', net: 40 }, b: { nickname: 'B', net: -20 } } },
    { handNumber: 3, timestamp: 'latest', nets: { a: { nickname: 'A', net: 55 }, b: { nickname: 'B', net: -25 } } }
  ];

  const r = reconcileCumulativeNet({ players, snapshots });
  const final = r.snapshots[2].nets;
  assert.strictEqual(Math.round(final.a.net + final.b.net), 0);
  // residual 30 split by buy-in weight (1:3) -> a loses ~7-8, b loses ~22-23
  assert.ok(final.a.net < 55 && final.b.net < -25);
  // first snapshot is untouched (ramp = 0)
  assert.strictEqual(r.snapshots[0].nets.a.net, 0);
  assert.strictEqual(r.snapshots[0].nets.b.net, 0);
});

test('reconcileCumulativeNet leaves an already-balanced or wildly-off timeline alone', () => {
  const players = new Map([['a', { nicknames: new Set(['A']), buyIn: 100 }], ['b', { nicknames: new Set(['B']), buyIn: 100 }]]);
  const balanced = {
    players,
    snapshots: [
      { handNumber: 1, timestamp: 't1', nets: { a: { nickname: 'A', net: 0 }, b: { nickname: 'B', net: 0 } } },
      { handNumber: 2, timestamp: 'latest', nets: { a: { nickname: 'A', net: 50 }, b: { nickname: 'B', net: -50 } } }
    ]
  };
  assert.strictEqual(reconcileCumulativeNet(balanced), balanced);

  const broken = {
    players,
    snapshots: [
      { handNumber: 1, timestamp: 't1', nets: { a: { nickname: 'A', net: 0 }, b: { nickname: 'B', net: 0 } } },
      { handNumber: 2, timestamp: 'latest', nets: { a: { nickname: 'A', net: 9000 }, b: { nickname: 'B', net: 0 } } }
    ]
  };
  assert.strictEqual(reconcileCumulativeNet(broken), broken);
});
