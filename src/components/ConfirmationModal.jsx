import { AlertTriangle, HelpCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function ConfirmationModal({ 
  isOpen, 
  onClose, 
  onCancel,
  onConfirm, 
  title, 
  message, 
  confirmText,
  confirmLabel = 'Confirm', 
  cancelText,
  cancelLabel = 'Cancel', 
  isDestructive = false,
  variant
}) {
  if (!isOpen) return null;

  const handleClose = onCancel || onClose || (() => {});
  const isDanger = isDestructive || variant === 'danger';
  const finalConfirmLabel = confirmText || confirmLabel;
  const finalCancelLabel = cancelText || cancelLabel;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/80 backdrop-blur-md" 
        onClick={handleClose}
      />

      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.2 }}
        className={`hud-corner-reticle ${isDanger ? 'hud-corner-rose' : 'hud-corner-cyan'} bg-hud-card border ${
          isDanger ? 'border-rose-500/40 shadow-neon-rose' : 'border-white/20 shadow-2xl'
        } max-w-md w-full relative z-10 overflow-hidden p-6 space-y-5 backdrop-blur-2xl font-sans`}
      >
        <div className="flex items-start gap-4">
          <div className={`w-11 h-11 flex items-center justify-center border shrink-0 ${
            isDanger ? 'bg-rose-500/10 border-rose-500/30 text-rose-400' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400'
          }`}>
            {isDanger ? (
              <AlertTriangle className="w-5 h-5 drop-shadow-[0_0_6px_rgba(244,63,94,0.8)]" />
            ) : (
              <HelpCircle className="w-5 h-5 drop-shadow-[0_0_6px_rgba(6,182,212,0.8)]" />
            )}
          </div>
          <div className="space-y-1.5 flex-1">
            <h3 className="text-base font-bold text-white uppercase tracking-wider font-sans">{title}</h3>
            <p className="text-xs text-zinc-400 leading-relaxed font-sans">{message}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/10">
          <button 
            type="button" 
            onClick={handleClose} 
            className="px-4 py-2 bg-black/60 hover:bg-zinc-900 text-zinc-300 font-mono text-xs font-semibold uppercase tracking-wider transition-all border border-white/10 hover:border-white/30"
          >
            {finalCancelLabel}
          </button>
          <button 
            type="button" 
            onClick={() => {
              if (onConfirm) onConfirm();
            }} 
            className={`px-4 py-2 text-white font-mono text-xs font-bold uppercase tracking-wider transition-all ${
              isDanger 
                ? 'bg-rose-600 hover:bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.5)]' 
                : 'bg-emerald-600 hover:bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)]'
            }`}
          >
            {finalConfirmLabel}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
