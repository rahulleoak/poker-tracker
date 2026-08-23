import test from 'node:test';
import assert from 'node:assert';

// Simulates player identity resolution and aggregation with registered-players-only filtering
function getPlayerDisplayName(name, externalId, players = [], playerLinks = []) {
  if (!name) return null;
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

  // 3. Check direct display name match (auto-link matching names)
  const directPlayer = players.find(p => (p.display_name || '').trim().toLowerCase() === normName);
  if (directPlayer) return directPlayer.display_name;

  return null; // Unregistered / unmapped raw session names are filtered out
}

test('player identity mapping maps external IDs, aliases, and exact matching names correctly, and filters out unregistered players', () => {
  const players = [
    { id: 'p-1', display_name: 'Rahul' },
    { id: 'p-2', display_name: 'John Doe' },
    { id: 'p-3', display_name: 'Alice' }
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

  // Match by direct display name (auto-link matching names)
  assert.strictEqual(getPlayerDisplayName('Alice', null, players, playerLinks), 'Alice');
  assert.strictEqual(getPlayerDisplayName('Rahul', null, players, playerLinks), 'Rahul');

  // Return null for unregistered / unlinked players
  assert.strictEqual(getPlayerDisplayName('Bob', null, players, playerLinks), null);
});

test('poker stats aggregate correctly across multiple linked IDs and filter unregistered players', () => {
  const players = [
    { id: 'p-1', display_name: 'Rahul' },
    { id: 'p-2', display_name: 'Alice' }
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
        { name: 'Alice', buyIn: 50, buyOut: 0, stack: 0 },
        { name: 'UnregisteredBob', buyIn: 500, buyOut: 0, stack: 0 }
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
      if (!name) return; // filter out unregistered players
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

  // Check stats for 'Alice' (auto-linked by exact name match)
  assert.ok(stats['Alice']);
  assert.strictEqual(stats['Alice'].buyIn, 150);
  assert.strictEqual(stats['Alice'].cashOut, 50);
  assert.strictEqual(stats['Alice'].net, -100);

  // UnregisteredBob should be completely excluded
  assert.strictEqual(stats['UnregisteredBob'], undefined);
});

test('in-place identity mapping allows linking new session names to existing or new profiles', () => {
  const players = [
    { id: 'p-1', display_name: 'Rahul' }
  ];
  let playerLinks = [];

  // Initially unlinked
  assert.strictEqual(getPlayerDisplayName('Rahul (Guest)', null, players, playerLinks), null);

  // Perform in-place link to existing profile 'Rahul'
  playerLinks.push({ id: 'l-new', player_id: 'p-1', platform: 'alias', external_id: 'Rahul (Guest)' });

  // Now resolves to 'Rahul'
  assert.strictEqual(getPlayerDisplayName('Rahul (Guest)', null, players, playerLinks), 'Rahul');

  // Perform in-place creation of new profile 'Dave' and link 'Dave's Laptop'
  players.push({ id: 'p-2', display_name: 'Dave' });
  playerLinks.push({ id: 'l-dave', player_id: 'p-2', platform: 'alias', external_id: "Dave's Laptop" });

  assert.strictEqual(getPlayerDisplayName("Dave's Laptop", null, players, playerLinks), 'Dave');
});

