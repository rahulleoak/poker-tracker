import React, { useRef } from 'react';
import { Upload, Plus, CheckCircle2, AlertCircle, ArrowRight, Globe } from 'lucide-react';
import { formatFiat } from '../utils/formatters';

export default function GamesList({ games, onCreate, onFileUpload, onEdit, exchangeRates, globalCurrency }) {
  const fileInputRef = useRef(null);

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {games.map(game => {
          const totalBuyInChips = game.entries.reduce((sum, e) => sum + e.buyIn, 0);
          const totalCashOutChips = game.entries.reduce((sum, e) => sum + (e.buyOut + e.stack), 0);
          const isBalanced = totalBuyInChips === totalCashOutChips;
          
          // Show pot in the global dashboard currency
          const rateToGlobal = exchangeRates ? (exchangeRates[globalCurrency] / exchangeRates[game.currency]) : 1;
          const potFiat = totalBuyInChips * game.chipValue * rateToGlobal;

          return (
            <div 
              key={game.id} 
              onClick={() => onEdit(game.id)}
              className="bg-slate-900 border border-slate-800 p-5 rounded-xl cursor-pointer hover:border-emerald-500/50 hover:shadow-lg hover:shadow-emerald-900/10 transition-all group relative overflow-hidden"
            >
              <div className={`absolute top-0 left-0 w-1 h-full ${game.isActive ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-slate-700'}`}></div>
              <div className="flex justify-between items-start mb-4 ml-2">
                <div>
                  <h3 className="font-bold text-slate-200">{new Date(game.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1 text-xs font-medium bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
                      <Globe className="w-3 h-3" /> {game.currency}
                    </span>
                    <p className="text-sm text-slate-500">{game.entries.length} Players</p>
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
        {games.length === 0 && (
          <div className="col-span-full py-12 text-center border-2 border-dashed border-slate-800 rounded-xl text-slate-500">
            No sessions logged yet. Create your first game!
          </div>
        )}
      </div>
    </div>
  );
}
