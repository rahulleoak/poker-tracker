// Countries a player can be settled under. `code` is the stable key stored in
// state; `flag` is a plain emoji so no icon assets are needed; `currency` is
// what that country's bank settles in.
export const COUNTRIES = [
  { code: 'CA', name: 'Canada', flag: '🇨🇦', currency: 'CAD' },
  { code: 'US', name: 'United States', flag: '🇺🇸', currency: 'USD' }
];

export const DEFAULT_COUNTRY = 'CA';

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export function country(code) {
  return BY_CODE.get(code) || BY_CODE.get(DEFAULT_COUNTRY);
}

export function countryLabel(code) {
  const c = country(code);
  return `${c.flag} ${c.name}`;
}
