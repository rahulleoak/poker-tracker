import { useRef, useState } from 'react';
import { Upload, Plus, CheckCircle2, AlertCircle, ArrowRight, Globe } from 'lucide-react';
import { formatFiat } from '../utils/formatters';

export default function GamesList({ games = [], onCreate, onFileUpload, onEdit, exchangeRates, globalCurrency = 'USD' }) {
  const fileInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const safeGames = Array.isArray(games) ? games : [];

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith(".csv") && onFileUpload) {
        // Construct a synthetic event to match existing onFileUpload format
        const syntheticEvent = {
          target: {
            files: [file],
            value: null
          }
        };
        onFileUpload(syntheticEvent);
      }
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <h2 className="text-2xl font-bold text-slate-100">Poker Sessions</h2>
        <div className="flex flex-wrap gap-3">
          <input 
            type="file" 
            accept=".csv" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={onFileUpload} 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Import CSV
          </button>
          <button 
            onClick={onCreate}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 shadow-lg shadow-emerald-900/20"
          >
            <Plus className="w-4 h-4" />
            Log New Session
          </button>
        </div>
      </div>

      {/* Drag & Drop Zone */}
      <div 
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all duration-300 relative overflow-hidden group ${
          isDragging 
            ? 'border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-500/5' 
            : 'border-slate-800 bg-slate-900/40 hover:bg-slate-900/80 hover:border-slate-700'
        }`}
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl group-hover:bg-indigo-500/10 transition-colors"></div>
        <div className="max-w-md mx-auto flex flex-col items-center gap-3">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center border transition-all duration-300 ${
            isDragging 
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 scale-110' 
              : 'bg-slate-800 border-slate-700 text-slate-400 group-hover:text-slate-300'
          }`}>
            <Upload className="w-6 h-6 animate-bounce" style={{ animationDuration: '3s' }} />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-200">Import PokerNow CSV Session Log</h3>
            <p className="text-xs text-slate-400 mt-1">
              Drag & drop your PokerNow CSV log file here, or <span className="text-emerald-400 underline group-hover:text-emerald-300">browse files</span>.
            </p>
          </div>
          <span className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold bg-slate-950/50 px-2.5 py-1 rounded border border-slate-800/80">
            Supports .csv
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {safeGames.map(game => {
          if (!game) return null;
          const entries = Array.isArray(game.entries) ? game.entries : [];
          const totalBuyInChips = entries.reduce((sum, e) => sum + (Number(e?.buyIn) || 0), 0);
          const totalCashOutChips = entries.reduce((sum, e) => sum + ((Number(e?.buyOut) || 0) + (Number(e?.stack) || 0)), 0);
          const isBalanced = totalBuyInChips === totalCashOutChips;
          
          const gameCurrency = game.currency || 'USD';
          const chipValue = Number(game.chipValue) || 1;
          const rateToGlobal = (exchangeRates && exchangeRates[globalCurrency] && exchangeRates[gameCurrency]) 
            ? (exchangeRates[globalCurrency] / exchangeRates[gameCurrency]) 
            : 1;
          const potFiat = totalBuyInChips * chipValue * rateToGlobal;

          const gameDate = game.date ? new Date(game.date) : new Date();
          const formattedDate = !isNaN(gameDate.getTime()) 
            ? gameDate.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })
            : 'Unknown Date';

          return (
            <div 
              key={game.id} 
              onClick={() => onEdit && onEdit(game.id)}
              className="bg-slate-900 border border-slate-800 p-5 rounded-xl cursor-pointer hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-900/10 transition-all group relative overflow-hidden"
            >
              <div className={`absolute top-0 left-0 w-1 h-full ${game.isActive ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-slate-700'}`}></div>
              <div className="flex justify-between items-start mb-4 ml-2">
                <div>
                  <h3 className="font-bold text-slate-200">{formattedDate}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 text-xs font-medium bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
                      <Globe className="w-3 h-3" /> {gameCurrency}
                    </span>
                    <p className="text-sm text-slate-500">{entries.length} Players</p>
                  </div>
                </div>
                {isBalanced ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-500" />
                )}
              </div>
              <div className="flex justify-between items-center text-sm mt-6 pt-4 border-t border-slate-800/50 ml-2">
                <div className="flex flex-col">
                  <span className="text-xs text-slate-500 uppercase tracking-wider">Pot Size</span>
                  <span className="font-semibold text-slate-200">{formatFiat(potFiat, globalCurrency)}</span>
                </div>
                <span className="text-emerald-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 text-xs font-medium">
                  View Ledger <ArrowRight className="w-3 h-3" />
                </span>
              </div>
            </div>
          );
        })}
        {safeGames.length === 0 && (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-slate-800 rounded-xl text-slate-500">
            No sessions logged yet. Create your first game!
          </div>
        )}
      </div>
    </div>
  );
}
