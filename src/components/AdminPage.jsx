import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Upload, XCircle } from 'lucide-react';
import { parseSessionLedger } from '../utils/pokernow-utils/parseSessionLedger';
import {
  extractPokerNowGameId,
  extractSessionStartDate,
  applyPlayerGroups
} from '../utils/pokernow-utils/sessionMeta';
import {
  createGameFromCSVEntries,
  extractPokerNowUrl
} from '../utils/sessionMapper';
import { stashSessionPreview } from '../utils/sessionHandoff';
import AdminPlayerLinkDialog from './AdminPlayerLinkDialog';

export default function AdminPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle'); // idle | parsing | review | saving | error
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(null); // { text, entries, date, gameId }

  const handleFileChange = (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    setStatus('parsing');
    setError(null);
    setPending(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const parsedEntries = parseSessionLedger(text);
        if (parsedEntries.length === 0) {
          throw new Error('No player entries found in this CSV.');
        }

        const date =
          extractSessionStartDate(text) ||
          (file.lastModified
            ? new Date(file.lastModified).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0]);

        const gameId = extractPokerNowGameId(file.name, text);

        setPending({ text, entries: parsedEntries, date, gameId });
        setStatus('review');
      } catch (err) {
        console.error('Failed to process PokerNow CSV:', err);
        setError(err.message || 'Failed to process file.');
        setStatus('error');
      }
    };

    reader.readAsText(file);
    if (event.target) event.target.value = null;
  };

  const handleCancelReview = () => {
    setPending(null);
    setStatus('idle');
  };

  const handleConfirmReview = ({ groups, countryByKey, bankByCountry, chipsPerCad, cadToUsd }) => {
    if (!pending) return;
    setStatus('saving');
    try {
      const { text, entries, date, gameId } = pending;
      const groupedEntries = applyPlayerGroups(entries, groups);

      const game = createGameFromCSVEntries(groupedEntries, 'USD', date, gameId || undefined);
      const pokerNowUrl = extractPokerNowUrl(text);
      if (pokerNowUrl) game.pokerNowUrl = pokerNowUrl;

      // The /admin flow is a throwaway preview: nothing is persisted. Hand the
      // parsed CSV + grouped ledger + bank config to the session view in-memory
      // instead of localStorage / the DB.
      stashSessionPreview({
        id: game.id,
        csvText: text,
        game,
        groups,
        settlement: { countryByKey, bankByCountry, chipsPerCad, cadToUsd }
      });
      setPending(null);
      navigate(`/admin/session/${game.id}`);
    } catch (err) {
      console.error('Failed to process PokerNow CSV:', err);
      setError(err.message || 'Failed to process file.');
      setStatus('error');
      setPending(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans flex items-center justify-center p-6">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 max-w-lg w-full shadow-2xl space-y-6">
        <div>
          <h1 className="text-xl font-bold text-emerald-400">Admin: Upload PokerNow CSV</h1>
          <p className="text-sm text-slate-500 mt-1">Upload a PokerNow ledger or log CSV to create a new session.</p>
        </div>

        <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-slate-700 rounded-xl py-10 cursor-pointer hover:border-emerald-500 transition-colors">
          <Upload className="w-6 h-6 text-slate-500" />
          <span className="text-sm text-slate-400">Click to select a CSV file</span>
          <input type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
        </label>

        {status === 'parsing' && <p className="text-sm text-slate-400">Parsing file...</p>}
        {status === 'review' && <p className="text-sm text-slate-400">Review players before creating the session.</p>}
        {status === 'saving' && <p className="text-sm text-slate-400">Saving session...</p>}

        {status === 'error' && (
          <div className="flex items-start gap-3 bg-rose-500/10 border border-rose-500/30 rounded-lg p-4">
            <XCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
            <p className="text-sm text-rose-400">{error}</p>
          </div>
        )}

        <Link to="/" className="block text-center text-sm text-slate-500 hover:text-slate-300 transition-colors">
          &larr; Back to app
        </Link>
      </div>

      {status === 'review' && pending && (
        <AdminPlayerLinkDialog
          entries={pending.entries}
          onCancel={handleCancelReview}
          onConfirm={handleConfirmReview}
        />
      )}
    </div>
  );
}
