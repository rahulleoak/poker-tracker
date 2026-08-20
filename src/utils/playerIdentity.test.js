import test from 'node:test';
import assert from 'node:assert';

// Simulates player identity resolution and aggregation
function getPlayerDisplayName(name, externalId, players = [], playerLinks = []) {
  if (!name) return 'Unknown Player';
  const normName = name.trim().toLowerCase();
  const normExtId = (externalId || '').trim().toLowerCase();

  // 1. Check external ID match
  if (normExtId) {
    const link = playerLinks.find(l => (l.external_id || '').trim().toLowerCase() === normExtId);
    if (link) {
      const player = players.find(p => p.id === link.player_id);
      if (player) return player.display_name;
    }
  }

  // 2. Check name as external ID match (aliases)
  if (normName) {
    const link = playerLinks.find(l => (l.external_id || '').trim().toLowerCase() === normName);
    if (link) {
      const player = players.find(p => p.id === link.player_id);
      if (player) return player.display_name;
    }
  }

  // 3. Check direct display name match
  const directPlayer = players.find(p => (p.display_name || '').trim().toLowerCase() === normName);
  if (directPlayer) return directPlayer.display_name;

  return name.trim();
}

test('player identity mapping maps external IDs and aliases correctly', () => {
  const players = [
    { id: 'p-1', display_name: 'Rahul' },
    { id: 'p-2', display_name: 'John Doe' }
  ];

  const playerLinks = [
    { id: 'l-1', player_id: 'p-1', platform: 'pokernow', external_id: 'SPoLg3vOL-' },
    { id: 'l-2', player_id: 'p-1', platform: 'alias', external_id: '@RahulL' },
    { id: 'l-3', player_id: 'p-2', platform: 'pokernow', external_id: 'xyz-987' }
  ];

  // Match by external ID
  assert.strictEqual(getPlayerDisplayName('Player 1', 'SPoLg3vOL-', players, playerLinks), 'Rahul');
  assert.strictEqual(getPlayerDisplayName('Any Name', 'xyz-987', players, playerLinks), 'John Doe');

  // Match by seat name / alias
  assert.strictEqual(getPlayerDisplayName('@RahulL', null, players, playerLinks), 'Rahul');

  // Match by direct display name
  assert.strictEqual(getPlayerDisplayName('Rahul', null, players, playerLinks), 'Rahul');
  assert.strictEqual(getPlayerDisplayName('John Doe', null, players, playerLinks), 'John Doe');

  // Fallback to name if unmatched
  assert.strictEqual(getPlayerDisplayName('Alice', null, players, playerLinks), 'Alice');
});

test('poker stats aggregate correctly across multiple linked IDs', () => {
  const players = [
    { id: 'p-1', display_name: 'Rahul' }
  ];

  const playerLinks = [
    { id: 'l-1', player_id: 'p-1', platform: 'pokernow', external_id: 'SPoLg3vOL-' },
    { id: 'l-2', player_id: 'p-1', platform: 'alias', external_id: '@RahulL' }
  ];

  const games = [
    {
      id: 'g-1',
      entries: [
        { name: 'Rahul (Seat 1)', externalId: 'SPoLg3vOL-', buyIn: 100, buyOut: 200, stack: 0 },
        { name: 'Alice', buyIn: 50, buyOut: 0, stack: 0 }
      ]
    },
    {
      id: 'g-2',
      entries: [
        { name: '@RahulL', buyIn: 100, buyOut: 0, stack: 150 }, // points to Rahul
        { name: 'Alice', buyIn: 100, buyOut: 0, stack: 50 }
      ]
    }
  ];

  const stats = {};
  games.forEach(game => {
    game.entries.forEach(entry => {
      const name = getPlayerDisplayName(entry.name, entry.externalId, players, playerLinks);
      if (!stats[name]) {
        stats[name] = { name, buyIn: 0, cashOut: 0, net: 0 };
      }
      const buyIn = entry.buyIn || 0;
      const cashOut = (entry.buyOut || 0) + (entry.stack || 0);
      stats[name].buyIn += buyIn;
      stats[name].cashOut += cashOut;
      stats[name].net += (cashOut - buyIn);
    });
  });

  // Check aggregated stats for 'Rahul'
  assert.ok(stats['Rahul']);
  assert.strictEqual(stats['Rahul'].buyIn, 200);
  assert.strictEqual(stats['Rahul'].cashOut, 350);
  assert.strictEqual(stats['Rahul'].net, 150);

  // Check stats for 'Alice'
  assert.ok(stats['Alice']);
  assert.strictEqual(stats['Alice'].buyIn, 150);
  assert.strictEqual(stats['Alice'].cashOut, 50);
  assert.strictEqual(stats['Alice'].net, -100);
});
