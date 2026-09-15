// Countries a player can be settled under. `code` is the stable key stored in
// state; `flag` is a plain emoji so no icon assets are needed; `currency` is
// what that country's bank settles in.
export const COUNTRIES = [
  { code: 'CA', name: 'Canada', flag: '🇨🇦', currency: 'CAD' },
  { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD' },
  { code: 'SG', name: 'Singapore', flag: '🇸🇬', currency: 'SGD' },
  { code: 'EU', name: 'Eurozone', flag: '🇪🇺', currency: 'EUR' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', currency: 'GBP' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', currency: 'AUD' },
  { code: 'IN', name: 'India', flag: '🇮🇳', currency: 'INR' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', currency: 'JPY' },
  { code: 'NZ', name: 'New Zealand', flag: '🇳🇿', currency: 'NZD' },
  { code: 'HK', name: 'Hong Kong', flag: '🇭🇰', currency: 'HKD' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', currency: 'CHF' },
  { code: 'SE', name: 'Sweden', flag: '🇸🇪', currency: 'SEK' },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷', currency: 'KRW' },
  { code: 'NO', name: 'Norway', flag: '🇳🇴', currency: 'NOK' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', currency: 'MXN' },
  { code: 'RU', name: 'Russia', flag: '🇷🇺', currency: 'RUB' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦', currency: 'ZAR' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', currency: 'BRL' },
  { code: 'TR', name: 'Turkey', flag: '🇹🇷', currency: 'TRY' },
  { code: 'CN', name: 'China', flag: '🇨🇳', currency: 'CNY' },
  { code: 'PH', name: 'Philippines', flag: '🇵🇭', currency: 'PHP' },
  { code: 'TH', name: 'Thailand', flag: '🇹🇭', currency: 'THB' },
  { code: 'MY', name: 'Malaysia', flag: '🇲🇾', currency: 'MYR' },
  { code: 'VN', name: 'Vietnam', flag: '🇻🇳', currency: 'VND' },
  { code: 'ID', name: 'Indonesia', flag: '🇮🇩', currency: 'IDR' }
];

export const DEFAULT_COUNTRY = 'CA';

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code.toUpperCase(), c]));
const BY_CURRENCY = new Map(COUNTRIES.map((c) => [c.currency.toUpperCase(), c]));

export function countryFromCurrency(curr) {
  if (!curr) return DEFAULT_COUNTRY;
  const upper = String(curr).trim().toUpperCase();
  if (BY_CODE.has(upper)) return upper;
  if (BY_CURRENCY.has(upper)) return BY_CURRENCY.get(upper).code;
  return upper.slice(0, 2);
}

export function country(codeOrCurrency) {
  if (!codeOrCurrency) return BY_CODE.get(DEFAULT_COUNTRY);
  const upper = String(codeOrCurrency).trim().toUpperCase();
  if (BY_CODE.has(upper)) return BY_CODE.get(upper);
  if (BY_CURRENCY.has(upper)) return BY_CURRENCY.get(upper);

  // Fallback for custom currencies or country codes
  return {
    code: upper,
    name: upper,
    flag: '🌐',
    currency: upper
  };
}

export function countryLabel(code) {
  const c = country(code);
  return `${c.flag} ${c.name}`;
}
