export const TOP_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'HKD', 'NZD',
  'SEK', 'KRW', 'SGD', 'NOK', 'MXN', 'INR', 'RUB', 'ZAR', 'BRL', 'TRY'
];

// Helper to format fiat money safely
export const formatFiat = (amount, currencyCode) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currencyCode }).format(amount);
  } catch {
    return `${currencyCode} ${amount.toFixed(2)}`;
  }
};

// Helper to format chips safely
export const formatChips = (amount) => {
  return new Intl.NumberFormat('en-US').format(amount);
};
