import { useEffect, useState } from 'react';
import { fetchExchangeRates, cadToUsdRate } from '../utils/fx';

/**
 * Live USD-per-CAD rate for the /admin settlement flow, fetched once on mount
 * from the same FX source the main app uses. Falls back to `fallback` until a
 * live rate resolves (and stays there if the fetch fails).
 *
 * @param {number} [fallback=0.73]
 * @returns {{ cadToUsd: number, isLive: boolean }}
 */
export function useLiveCadToUsd(fallback = 0.73) {
  const [state, setState] = useState({ cadToUsd: fallback, isLive: false });

  useEffect(() => {
    let cancelled = false;
    fetchExchangeRates().then((rates) => {
      const live = cadToUsdRate(rates);
      if (!cancelled && live != null) setState({ cadToUsd: live, isLive: true });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
