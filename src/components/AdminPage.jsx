import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Upload, XCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { parsePokerNowCSV } from '../utils/csvParser';
import { createGameFromCSVEntries, extractPokerNowUrl } from '../utils/sessionMapper';
import { loadGamesFromStorage, saveGamesToStorage, saveSessionCsv } from '../utils/storage';

export default function AdminPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle'); // idle | parsing | saving | error
  const [error, setError] = useState(null);

  const handleFileChange = (event) => {
    const file = event?.target?.files?.[0];
    if (!file) return;

    setStatus('parsing');
    setError(null);

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const text = e.target.result;
        const parsedEntries = parsePokerNowCSV(text);
        if (parsedEntries.length === 0) {
          throw new Error('No player entries found in this CSV.');
        }

        const date = file.lastModified
          ? new Date(file.lastModified).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

        const newGame = createGameFromCSVEntries(parsedEntries, 'USD', date);
        const pokerNowUrl = extractPokerNowUrl(text);
        if (pokerNowUrl) newGame.pokerNowUrl = pokerNowUrl;

        setStatus('saving');

        if (supabase) {
          const sessionPayload = {
            date: newGame.date,
            currency: newGame.currency,
            chip_value: 1,
            is_active: false,
            poker_now_url: newGame.pokerNowUrl
          };

          const { data: sessionData, error: sessionError } = await supabase
            .from('sessions')
            .insert([sessionPayload])
            .select()
            .single();

          if (sessionError) throw sessionError;

          newGame.id = sessionData.id;

          const ledgerEntries = newGame.entries.map(entry => ({
            session_id: sessionData.id,
            player_name: entry.name,
            buy_in: entry.buyIn,
            cash_out: entry.buyOut + entry.stack,
            currency: newGame.currency,
            is_bank: false,
            hands_played: entry.handsPlayed,
            vpip_hands: entry.vpipHands,
            pfr_hands: entry.pfrHands,
            three_bet_opps: entry.threeBetOpps,
            three_bet_hands: entry.threeBetHands,
            external_player_id: entry.externalId || entry.pokerNowId || null,
            player_external_id: entry.externalId || entry.pokerNowId || null,
            player_poker_now_id: entry.pokerNowId || entry.externalId || null
          }));

          const { error: ledgerError } = await supabase.from('ledger').insert(ledgerEntries);
          if (ledgerError) {
            console.warn('Ledger insert with stats failed, attempting legacy insert:', ledgerError);
            const legacyEntries = ledgerEntries.map(({ session_id, player_name, buy_in, cash_out, currency, is_bank, external_player_id, player_external_id, player_poker_now_id }) => ({
              session_id, player_name, buy_in, cash_out, currency, is_bank, external_player_id, player_external_id, player_poker_now_id
            }));
            await supabase.from('ledger').insert(legacyEntries);
          }
        } else {
          const localGames = loadGamesFromStorage();
          saveGamesToStorage([newGame, ...localGames]);
        }

        saveSessionCsv(newGame.id, text);
        navigate(`/session/${newGame.id}`);
      } catch (err) {
        console.error('Failed to process PokerNow CSV:', err);
        setError(err.message || 'Failed to process file.');
        setStatus('error');
      }
    };

    reader.readAsText(file);
    if (event.target) event.target.value = null;
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
    </div>
  );
}
