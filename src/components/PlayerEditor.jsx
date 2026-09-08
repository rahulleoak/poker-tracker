import { useMemo, useState } from 'react';
import { UserPlus, Check, ChevronDown, Landmark, User } from 'lucide-react';
import { COUNTRIES } from '../utils/countries';
import { TOP_CURRENCIES } from '../utils/formatters';

// Compact create / edit surface for master player profiles + their country
// association. Rendered under Banks & settlement on /admin. Writes go through
// `sessionApi.createPlayer` / `updatePlayer`; the caller refreshes the identity
// graph so the new/renamed row shows up everywhere.

function CountrySelect({ value, onChange, disabled }) {
  return (
    <select
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      className="bg-slate-800 border border-slate-700 rounded-md text-xs px-2 py-1 outline-none focus:border-emerald-500 text-slate-200 disabled:opacity-50 shrink-0"
    >
      <option value="">— no country —</option>
      {COUNTRIES.map((c) => (
        <option key={c.code} value={c.code}>
          {c.flag} {c.name}
        </option>
      ))}
    </select>
  );
}

// Uncontrolled from props: the parent gives each row a key that includes the
// saved country/currency, so a graph refresh remounts it with a fresh draft. The name is
// display-only — the country and preferred currency are editable here.
function PlayerRow({ player, saving, saved, isBank, onSave }) {
  const [country, setCountry] = useState(player.country || '');
  const [preferredCurrency, setPreferredCurrency] = useState(player.preferred_currency || 'USD');

  const dirty = (country || '') !== (player.country || '') || preferredCurrency !== (player.preferred_currency || 'USD');
  const canSave = dirty && !saving;

  return (
    <div className="flex items-center gap-3 px-5 py-3">
      {isBank ? (
        <Landmark className="w-4 h-4 shrink-0 text-emerald-400" aria-label="Bank" />
      ) : (
        <User className="w-4 h-4 shrink-0 text-slate-600" aria-label="Player" />
      )}
      <span className="flex-1 min-w-0 truncate text-sm text-slate-200">{player.display_name}</span>
      <CountrySelect value={country} onChange={(c) => setCountry(c || '')} disabled={saving} />
      
      <select
        value={preferredCurrency}
        onChange={(e) => setPreferredCurrency(e.target.value)}
        disabled={saving}
        className="bg-slate-800 border border-slate-700 rounded-md text-xs px-2 py-1 outline-none focus:border-emerald-500 text-slate-200 disabled:opacity-50 shrink-0 w-20"
      >
        {TOP_CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <button
        onClick={() => onSave({ display_name: player.display_name, country: country || null, preferred_currency: preferredCurrency })}
        disabled={!canSave}
        className="flex items-center justify-end gap-1 w-14 text-xs font-medium text-emerald-400 hover:text-emerald-300 disabled:opacity-30 disabled:hover:text-emerald-400 shrink-0"
      >
        {saved ? <Check className="w-3.5 h-3.5" /> : saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

export default function PlayerEditor({ players = [], bankByCountry = {}, onCreate, onUpdate }) {
  const [name, setName] = useState('');
  const [country, setCountry] = useState('CA');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const toggleGroup = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  const wanted = name.trim();
  const nameTaken = players.some(
    (p) => p.display_name.trim().toLowerCase() === wanted.toLowerCase()
  );

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!wanted || nameTaken || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ display_name: wanted, country: country || null });
      setName('');
      setCountry('CA');
    } catch (err) {
      setError(err.message || 'Failed to create player.');
    } finally {
      setBusy(false);
    }
  };

  const handleUpdate = async (id, patch) => {
    setSavingId(id);
    setError(null);
    try {
      await onUpdate(id, patch);
      setSavedId(id);
      setTimeout(() => setSavedId((s) => (s === id ? null : s)), 1500);
    } catch (err) {
      setError(err.message || 'Failed to update player.');
    } finally {
      setSavingId(null);
    }
  };

  // Grouped by settle-country; within each group the country's standing banker
  // sorts first, then everyone else alphabetically. Players with no country fall
  // into a trailing "No country" group.
  const groups = useMemo(() => {
    const known = new Set(COUNTRIES.map((c) => c.code));
    const byCode = new Map();
    const noCountry = [];
    for (const p of players) {
      const code = known.has(p.country) ? p.country : null;
      if (!code) {
        noCountry.push(p);
        continue;
      }
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push(p);
    }
    const order = (code, list) => {
      const bankId = bankByCountry[code] || null;
      return [...list].sort((a, b) => {
        const rank = (x) => (x.id === bankId ? 0 : 1);
        return rank(a) - rank(b) || a.display_name.localeCompare(b.display_name);
      });
    };
    const out = COUNTRIES.filter((c) => byCode.has(c.code)).map((c) => ({
      key: c.code,
      label: `${c.flag} ${c.name}`,
      bankId: bankByCountry[c.code] || null,
      players: order(c.code, byCode.get(c.code))
    }));
    if (noCountry.length) {
      out.push({
        key: '__none__',
        label: 'No country',
        bankId: null,
        players: [...noCountry].sort((a, b) => a.display_name.localeCompare(b.display_name))
      });
    }
    return out;
  }, [players, bankByCountry]);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-800">
        <h2 className="text-sm font-medium text-slate-300">Players</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Create a player and set the country they settle under, or change an existing
          player&apos;s country.
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 bg-slate-950/40"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New player name"
          spellCheck={false}
          className="flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-md text-sm px-2 py-1 outline-none focus:border-emerald-500 text-slate-200 placeholder-slate-600"
        />
        <CountrySelect value={country} onChange={(c) => setCountry(c || '')} disabled={busy} />
        <button
          type="submit"
          disabled={!wanted || nameTaken || busy}
          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white text-xs font-bold rounded-md px-3 py-1.5 shrink-0 transition-colors"
        >
          <UserPlus className="w-3.5 h-3.5" /> Add
        </button>
      </form>

      {nameTaken && wanted && (
        <p className="px-5 py-2 text-xs text-amber-400">
          A player named &ldquo;{wanted}&rdquo; already exists.
        </p>
      )}
      {error && <p className="px-5 py-2 text-xs text-rose-400">{error}</p>}

      <div className="max-h-[360px] overflow-y-auto">
        {groups.length === 0 ? (
          <p className="text-xs text-slate-600 px-5 py-3">No players yet — add one above.</p>
        ) : (
          groups.map((g) => {
            const isOpen = expanded.has(g.key);
            return (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.key)}
                  className="w-full flex items-center gap-2 px-5 py-1.5 bg-slate-950/50 border-y border-slate-800/70 text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 shrink-0 transition-transform ${isOpen ? '' : '-rotate-90'}`}
                  />
                  {g.label} <span className="text-slate-600">· {g.players.length}</span>
                </button>
                {isOpen && (
                  <div className="divide-y divide-slate-800/70">
                    {g.players.map((p) => (
                      <PlayerRow
                        key={`${p.id}:${p.display_name}:${p.country || ''}:${p.preferred_currency || 'USD'}`}
                        player={p}
                        saving={savingId === p.id}
                        saved={savedId === p.id}
                        isBank={g.bankId != null && p.id === g.bankId}
                        onSave={(patch) => handleUpdate(p.id, patch)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
