import { useRef, useState } from 'react';
import { Upload, Plus, CheckCircle2, AlertCircle, ArrowRight, Globe, Layers, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
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
    <div className="space-y-6 animate-in fade-in duration-500 font-sans">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse drop-shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
            <h2 className="text-xl font-bold text-white uppercase tracking-tight font-sans">Poker Sessions</h2>
          </div>
          <p className="text-xs text-zinc-400 mt-0.5 font-mono">Archive of historical sessions, chip ledgers, and telemetry</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <input 
            type="file" 
            accept=".csv" 
            ref={fileInputRef} 
            className="hidden" 
            onChange={onFileUpload} 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="bg-black/80 hover:bg-zinc-900 border border-white/20 text-zinc-200 px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 hover:border-cyan-400 hover:text-cyan-300 hover:shadow-[0_0_10px_rgba(6,182,212,0.3)]"
          >
            <Upload className="w-4 h-4 text-cyan-400" />
            Import CSV
          </button>
          <button 
            onClick={onCreate}
            className="bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 shadow-[0_0_12px_rgba(16,185,129,0.4)] hover:shadow-[0_0_16px_rgba(16,185,129,0.6)]"
          >
            <Plus className="w-4 h-4" />
            Log New Session
          </button>
        </div>
      </div>

      {/* Cybernetic Drag & Drop Zone */}
      <motion.div 
        whileHover={{ scale: 1.005 }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`hud-corner-reticle border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-300 relative overflow-hidden group backdrop-blur-xl ${
          isDragging 
            ? 'border-cyan-400 bg-cyan-950/20 shadow-[0_0_20px_rgba(6,182,212,0.25)]' 
            : 'border-white/15 bg-hud-card/70 hover:border-white/30 hover:bg-hud-card/90'
        }`}
      >
        <div className="absolute top-0 right-0 w-48 h-48 bg-cyan-500/5 rounded-full blur-3xl group-hover:bg-cyan-500/10 transition-colors pointer-events-none" />
        <div className="max-w-md mx-auto flex flex-col items-center gap-3 relative z-10">
          <div className={`w-12 h-12 flex items-center justify-center border transition-all duration-300 ${
            isDragging 
              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300 scale-110 shadow-[0_0_12px_rgba(6,182,212,0.6)]' 
              : 'bg-black/60 border-white/20 text-zinc-400 group-hover:text-cyan-400 group-hover:border-cyan-500/50'
          }`}>
            <Upload className="w-5 h-5 animate-bounce" style={{ animationDuration: '2.5s' }} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-sans">
              Import PokerNow CSV Session Log
            </h3>
            <p className="text-xs text-zinc-400 mt-1 font-sans">
              Drag & drop CSV log file here, or <span className="text-cyan-400 underline font-medium">browse filesystem</span>.
            </p>
          </div>
          <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest bg-black/80 px-2.5 py-1 border border-white/10">
            AUTO-PARSES VPIP / PFR / 3-BET & CHIP LEDGER
          </span>
        </div>
      </motion.div>

      {/* Session Cards Matrix */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {safeGames.map((game, idx) => {
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
            ? gameDate.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })
            : 'Unknown Date';

          return (
            <motion.div 
              key={game.id} 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.04, duration: 0.25 }}
              onClick={() => onEdit && onEdit(game.id)}
              className={`hud-corner-reticle bg-hud-card/90 border p-5 cursor-pointer transition-all duration-300 group relative overflow-hidden backdrop-blur-xl ${
                isBalanced 
                  ? 'border-white/10 hover:border-emerald-500/50 hover:shadow-neon-emerald' 
                  : 'border-rose-500/30 hover:border-rose-500/70 hover:shadow-neon-rose'
              }`}
            >
              {/* LED Active Bar */}
              <div className={`absolute top-0 left-0 w-1 h-full ${
                game.isActive 
                  ? 'bg-emerald-400 shadow-[0_0_10px_rgba(34,197,94,0.8)]' 
                  : isBalanced ? 'bg-zinc-700' : 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]'
              }`} />

              <div className="flex justify-between items-start mb-4 pl-2">
                <div>
                  <h3 className="font-bold text-white font-sans text-base group-hover:text-cyan-300 transition-colors">
                    {formattedDate}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5 font-mono">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold bg-black border border-white/15 text-zinc-300 px-2 py-0.5">
                      <Globe className="w-3 h-3 text-cyan-400" /> {gameCurrency}
                    </span>
                    <p className="text-xs text-zinc-500">{entries.length} Players</p>
                  </div>
                </div>
                {isBalanced ? (
                  <div className="flex items-center gap-1 text-emerald-400 bg-emerald-500/10 px-2 py-0.5 border border-emerald-500/30 text-[10px] font-mono font-bold uppercase">
                    <CheckCircle2 className="w-3.5 h-3.5 drop-shadow-[0_0_6px_rgba(34,197,94,0.8)]" /> Balanced
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-rose-400 bg-rose-500/10 px-2 py-0.5 border border-rose-500/30 text-[10px] font-mono font-bold uppercase">
                    <AlertCircle className="w-3.5 h-3.5 drop-shadow-[0_0_6px_rgba(244,63,94,0.8)]" /> Discrepancy
                  </div>
                )}
              </div>

              <div className="flex justify-between items-end text-sm mt-6 pt-3.5 border-t border-white/10 pl-2">
                <div className="flex flex-col">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-mono">Total Pot Volume</span>
                  <span className="font-mono tabular-nums font-bold text-lg text-white group-hover:text-emerald-400 transition-colors">
                    {formatFiat(potFiat, globalCurrency)}
                  </span>
                </div>
                <span className="text-cyan-400 group-hover:translate-x-1 transition-transform flex items-center gap-1 text-xs font-mono font-bold uppercase tracking-wider">
                  Telemetry <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </div>
            </motion.div>
          );
        })}

        {safeGames.length === 0 && (
          <div className="col-span-full py-16 text-center border-2 border-dashed border-white/10 bg-black/40 text-zinc-500 font-mono text-xs uppercase tracking-wider">
            No sessions logged yet. Create a game or import a PokerNow CSV.
          </div>
        )}
      </div>
    </div>
  );
}
