export const TOP_CURRENCIES = [
  'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'HKD', 'NZD',
  'SEK', 'KRW', 'SGD', 'NOK', 'MXN', 'INR', 'RUB', 'ZAR', 'BRL', 'TRY'
];

// Helper to format fiat money safely
export const formatFiat = (amount, currencyCode = 'USD') => {
  const num = Number(amount);
  const safeAmount = isNaN(num) || !isFinite(num) ? 0 : num;
  const safeCurrency = currencyCode || 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: safeCurrency }).format(safeAmount);
  } catch {
    return `${safeCurrency} ${safeAmount.toFixed(2)}`;
  }
};

// Helper to format chips safely
export const formatChips = (amount) => {
  const num = Number(amount);
  const safeAmount = isNaN(num) || !isFinite(num) ? 0 : num;
  return new Intl.NumberFormat('en-US').format(safeAmount);
};
