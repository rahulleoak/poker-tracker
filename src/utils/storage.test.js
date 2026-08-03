import test from 'node:test';
import assert from 'node:assert';
import { loadGamesFromStorage, saveGamesToStorage, mergeRemoteAndLocalGames, STORAGE_KEY } from './storage.js';

// Mock localStorage for testing
class MemoryStorage {
  constructor(initialData = {}) {
    this.store = new Map(Object.entries(initialData));
  }
  getItem(key) {
    return this.store.get(key) || null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

test('loadGamesFromStorage loads games successfully from storage', () => {
  const mockGames = [
    { id: 'game-1', date: '2025-02-01', currency: 'USD', entries: [] }
  ];
  const storage = new MemoryStorage({
    [STORAGE_KEY]: JSON.stringify(mockGames)
  });

  const loaded = loadGamesFromStorage(storage);
  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(loaded[0].id, 'game-1');
  assert.strictEqual(loaded[0].currency, 'USD');
});

test('loadGamesFromStorage returns empty array when storage is empty or invalid', () => {
  const emptyStorage = new MemoryStorage();
  assert.deepStrictEqual(loadGamesFromStorage(emptyStorage), []);

  const origError = console.error;
  console.error = () => {};
  try {
    const invalidStorage = new MemoryStorage({
      [STORAGE_KEY]: 'invalid-json{'
    });
    assert.deepStrictEqual(loadGamesFromStorage(invalidStorage), []);

    const nonArrayStorage = new MemoryStorage({
      [STORAGE_KEY]: JSON.stringify({ not: 'an-array' })
    });
    assert.deepStrictEqual(loadGamesFromStorage(nonArrayStorage), []);
  } finally {
    console.error = origError;
  }
});

test('saveGamesToStorage correctly saves games to storage', () => {
  const storage = new MemoryStorage();
  const gamesToSave = [
    { id: 'game-2', date: '2025-02-02', currency: 'EUR', entries: [] }
  ];

  saveGamesToStorage(gamesToSave, storage);
  const rawStored = storage.getItem(STORAGE_KEY);
  assert.notStrictEqual(rawStored, null);

  const parsed = JSON.parse(rawStored);
  assert.strictEqual(parsed.length, 1);
  assert.strictEqual(parsed[0].id, 'game-2');
  assert.strictEqual(parsed[0].currency, 'EUR');
});

test('mergeRemoteAndLocalGames combines remote and local games correctly', () => {
  const remoteGames = [
    { id: 'session-1', date: '2025-02-05', currency: 'USD' },
    { id: 'session-2', date: '2025-02-03', currency: 'EUR' }
  ];

  const localGames = [
    { id: 'session-2', date: '2025-02-03', currency: 'EUR' }, // overlap
    { id: 'offline-session-3', date: '2025-02-06', currency: 'GBP' } // local only
  ];

  const merged = mergeRemoteAndLocalGames(remoteGames, localGames);

  // Should have session-1, session-2, offline-session-3 (3 total)
  assert.strictEqual(merged.length, 3);

  // Should be sorted by date descending (newest first):
  // 1. offline-session-3 (2025-02-06)
  // 2. session-1 (2025-02-05)
  // 3. session-2 (2025-02-03)
  assert.strictEqual(merged[0].id, 'offline-session-3');
  assert.strictEqual(merged[1].id, 'session-1');
  assert.strictEqual(merged[2].id, 'session-2');
});
