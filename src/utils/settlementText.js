// Plain-text settlement for pasting into a chat.
//
// Deterministic by construction: countries sorted by code, transfers by
// lower-cased name then key, amounts via toFixed(2), no timestamps / locale
// formatting / iteration-order dependence. Same settlement + same set of settled
// leg ids => byte-for-byte identical output on any machine.

// Codepoint compare — locale-independent (unlike String.localeCompare).
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const amt = (n, cur) => `${Math.abs(Number(n) || 0).toFixed(2)} ${cur}`;

/**
 * @param {ReturnType<import('./bankSettlement.js').computeBankSettlement>} s
 * @param {{ sessionId?: string, isSettled?: (legId: string) => boolean }} [opts]
 * @returns {string}
 */
export function buildSettlementText(s, { sessionId = '', isSettled = () => false } = {}) {
  const box = (legId) => (isSettled(legId) ? '[x]' : '[ ]');
  const out = [
    `Settlement — ${sessionId}`,
    `${s.chipsPerCad} chips = 1 CAD · 1 CAD = ${s.cadToUsd} USD`
  ];

  const countries = [...(s.countries || [])].sort((a, b) => cmp(a.code, b.code));
  for (const c of countries) {
    out.push('');
    out.push(
      `${c.flag} ${c.name} — ${c.bankName ? `bank: ${c.bankName}` : 'no bank'} (${c.currency})`
    );
    if (!c.bankName) {
      out.push('  (assign a bank to route settlement)');
      continue;
    }
    const transfers = (s.playerTransfers || [])
      .filter((t) => t.country === c.code)
      .sort(
        (a, b) =>
          cmp(a.partyName.toLowerCase(), b.partyName.toLowerCase()) || cmp(a.partyKey, b.partyKey)
      );
    for (const t of transfers) {
      const line =
        t.direction === 'to_bank'
          ? `${t.partyName} pays ${amt(t.amountLocal, t.currency)} to ${c.bankName}`
          : `${c.bankName} pays ${amt(t.amountLocal, t.currency)} to ${t.partyName}`;
      const cad = c.currency !== 'CAD' ? ` (${amt(t.amount, 'CAD')})` : '';
      out.push(`${box(t.legId)} ${line}${cad}`);
    }
    out.push(
      `${c.bankName} (bank): net ${c.netLocal >= 0 ? '+' : '-'}${amt(c.netLocal, c.currency)}`
    );
  }

  const banks = [...(s.bankTransfers || [])].sort(
    (a, b) =>
      cmp(a.from.toLowerCase(), b.from.toLowerCase()) ||
      cmp(a.to.toLowerCase(), b.to.toLowerCase())
  );
  if (banks.length > 0) {
    out.push('');
    out.push('Between banks');
    for (const t of banks) {
      const usd = s.cadToUsd !== 1 ? ` (${amt(t.amount * s.cadToUsd, 'USD')})` : '';
      out.push(`${box(t.legId)} ${t.from} → ${t.to} ${amt(t.amount, 'CAD')}${usd}`);
    }
  }

  return out.join('\n');
}
