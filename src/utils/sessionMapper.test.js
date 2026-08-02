import test from 'node:test';
import assert from 'node:assert';
import { mapDatabaseSessionsToGames, createDefaultGame, createGameFromCSVEntries } from './sessionMapper.js';

test('mapDatabaseSessionsToGames maps full sessions with stats columns correctly', () => {
  const dbData = [
    {
      id: 'session-123',
      date: '2025-02-01',
      currency: 'USD',
      chip_value: 0.5,
      poker_now_url: 'https://pokernow.club/games/test',
      is_active: true,
      ledger: [
        {
          player_name: 'Alice',
          buy_in: 100,
          cash_out: 150,
          currency: 'USD',
          is_bank: true,
          hands_played: 50,
          vpip_hands: 20,
          pfr_hands: 15,
          three_bet_opps: 10,
          three_bet_hands: 3
        }
      ]
    }
  ];

  const games = mapDatabaseSessionsToGames(dbData);
  assert.strictEqual(games.length, 1);

  const game = games[0];
  assert.strictEqual(game.id, 'session-123');
  assert.strictEqual(game.date, '2025-02-01');
  assert.strictEqual(game.currency, 'USD');
  assert.strictEqual(game.chipValue, 0.5);
  assert.strictEqual(game.isActive, true);
  assert.strictEqual(game.entries.length, 1);

  const alice = game.entries[0];
  assert.strictEqual(alice.name, 'Alice');
  assert.strictEqual(alice.buyIn, 100);
  assert.strictEqual(alice.stack, 150);
  assert.strictEqual(alice.isBank, true);
  assert.strictEqual(alice.handsPlayed, 50);
  assert.strictEqual(alice.vpipHands, 20);
  assert.strictEqual(alice.pfrHands, 15);
  assert.strictEqual(alice.threeBetOpps, 10);
  assert.strictEqual(alice.threeBetHands, 3);
});

test('mapDatabaseSessionsToGames backward compatibility for legacy rows without pre-flop stats columns', () => {
  const legacyDbData = [
    {
      id: 'legacy-session-999',
      date: '2024-05-15',
      currency: 'EUR',
      chip_value: 1,
      is_active: false,
      ledger: [
        {
          player_name: 'Bob',
          buy_in: 200,
          cash_out: 0,
          currency: 'EUR',
          is_bank: false
          // hands_played, vpip_hands, etc. omitted completely
        }
      ]
    }
  ];

  const games = mapDatabaseSessionsToGames(legacyDbData);
  assert.strictEqual(games.length, 1);

  const game = games[0];
  assert.strictEqual(game.id, 'legacy-session-999');
  assert.strictEqual(game.currency, 'EUR');
  assert.strictEqual(game.entries.length, 1);

  const bob = game.entries[0];
  assert.strictEqual(bob.name, 'Bob');
  assert.strictEqual(bob.buyIn, 200);
  assert.strictEqual(bob.stack, 0);
  assert.strictEqual(bob.handsPlayed, 0);
  assert.strictEqual(bob.vpipHands, 0);
  assert.strictEqual(bob.pfrHands, 0);
  assert.strictEqual(bob.threeBetOpps, 0);
  assert.strictEqual(bob.threeBetHands, 0);
});

test('mapDatabaseSessionsToGames handles null/undefined ledger gracefully', () => {
  const dbDataWithNullLedger = [
    {
      id: 'session-null-ledger',
      date: '2025-01-01',
      ledger: null
    },
    {
      id: 'session-undefined-ledger',
      date: '2025-01-02'
    },
    null
  ];

  const games = mapDatabaseSessionsToGames(dbDataWithNullLedger);
  assert.strictEqual(games.length, 2);

  assert.strictEqual(games[0].id, 'session-null-ledger');
  assert.deepStrictEqual(games[0].entries, []);

  assert.strictEqual(games[1].id, 'session-undefined-ledger');
  assert.deepStrictEqual(games[1].entries, []);
});

test('createDefaultGame produces valid manual session model', () => {
  const game = createDefaultGame('GBP', 'custom-manual-id');

  assert.strictEqual(game.id, 'custom-manual-id');
  assert.strictEqual(game.currency, 'GBP');
  assert.strictEqual(game.chipValue, 1);
  assert.strictEqual(game.isActive, true);
  assert.strictEqual(game.entries.length, 2);
  assert.strictEqual(game.entries[0].name, 'Player 1');
  assert.strictEqual(game.entries[1].name, 'Player 2');
});

test('createGameFromCSVEntries produces valid game from parsed CSV entries', () => {
  const parsed = [
    { name: 'Charlie', buyIn: 150, buyOut: 20, stack: 100, handsPlayed: 30, vpipHands: 10 },
    { name: 'Dave', buyIn: 50, buyOut: 0, stack: 80 }
  ];

  const game = createGameFromCSVEntries(parsed, 'CAD', '2025-02-10', 'csv-game-id');

  assert.strictEqual(game.id, 'csv-game-id');
  assert.strictEqual(game.date, '2025-02-10');
  assert.strictEqual(game.currency, 'CAD');
  assert.strictEqual(game.isActive, false);
  assert.strictEqual(game.entries.length, 2);

  const charlie = game.entries[0];
  assert.strictEqual(charlie.name, 'Charlie');
  assert.strictEqual(charlie.buyIn, 150);
  assert.strictEqual(charlie.buyOut, 20);
  assert.strictEqual(charlie.stack, 100);
  assert.strictEqual(charlie.handsPlayed, 30);
  assert.strictEqual(charlie.vpipHands, 10);

  const dave = game.entries[1];
  assert.strictEqual(dave.name, 'Dave');
  assert.strictEqual(dave.buyIn, 50);
  assert.strictEqual(dave.stack, 80);
  assert.strictEqual(dave.handsPlayed, 0);
});

test('createGameFromCSVEntries handles empty/null parsed entries safely', () => {
  const game = createGameFromCSVEntries([], 'USD');
  assert.strictEqual(game.entries.length, 2);
  assert.strictEqual(game.entries[0].name, 'Player 1');
  assert.strictEqual(game.entries[1].name, 'Player 2');

  const nullGame = createGameFromCSVEntries(null, 'USD');
  assert.strictEqual(nullGame.entries.length, 2);
});
