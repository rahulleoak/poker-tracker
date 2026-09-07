// Live FX rates. Free, no-key endpoint; base currency is USD, so
// `rates[X]` is "how many X per 1 USD" (e.g. rates.CAD ≈ 1.37).
export const FX_ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

/**
 * Fetches the latest USD-based exchange-rate table.
 *
 * @returns {Promise<Record<string, number> | null>} `data.rates`
 *   (e.g. `{ USD: 1, CAD: 1.37, ... }`), or null if the request fails.
 */
export async function fetchExchangeRates() {
  try {
    const res = await fetch(FX_ENDPOINT);
    const data = await res.json();
    return data && data.rates ? data.rates : null;
  } catch (err) {
    console.error('Failed to fetch FX rates, using fallback:', err);
    return null;
  }
}

/**
 * USD value of 1 CAD, derived from a USD-based rate table (`1 / rates.CAD`).
 *
 * @param {Record<string, number> | null | undefined} rates
 * @returns {number | null} e.g. 0.73, or null when `rates.CAD` is missing/invalid.
 */
export function cadToUsdRate(rates) {
  const cadPerUsd = Number(rates?.CAD);
  return cadPerUsd > 0 ? 1 / cadPerUsd : null;
}
