import test from 'node:test';
import assert from 'node:assert';
import { cadToUsdRate } from '../../src/utils/fx.js';

test('cadToUsdRate inverts the USD-based CAD rate', () => {
  assert.strictEqual(cadToUsdRate({ USD: 1, CAD: 1.25 }), 0.8);
  assert.strictEqual(cadToUsdRate({ CAD: 2 }), 0.5);
});

test('cadToUsdRate returns null for a missing or invalid CAD rate', () => {
  assert.strictEqual(cadToUsdRate(null), null);
  assert.strictEqual(cadToUsdRate(undefined), null);
  assert.strictEqual(cadToUsdRate({}), null);
  assert.strictEqual(cadToUsdRate({ CAD: 0 }), null);
  assert.strictEqual(cadToUsdRate({ CAD: -1 }), null);
  assert.strictEqual(cadToUsdRate({ CAD: 'nope' }), null);
});
