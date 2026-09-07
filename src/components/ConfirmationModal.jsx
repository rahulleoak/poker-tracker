import { AlertTriangle, HelpCircle } from 'lucide-react';

export default function ConfirmationModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  confirmText = 'Confirm', 
  cancelText = 'Cancel', 
  isDestructive = false 
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm" 
        onClick={onClose}
      />
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl relative z-10 overflow-hidden transform transition-all p-6 space-y-6">
        <div className="flex items-start gap-4">
          <div className={"w-12 h-12 rounded-xl flex items-center justify-center border shrink-0 " + ( isDestructive ? "bg-rose-500/10 border-rose-500/20 text-rose-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" )}>
            {isDestructive ? <AlertTriangle className="w-6 h-6" /> : <HelpCircle className="w-6 h-6" />}
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold text-slate-100">{title}</h3>
            <p className="text-sm text-slate-400 leading-relaxed">{message}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800/60">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700/80 text-slate-300 font-medium rounded-lg text-sm transition-colors border border-slate-700/50">{cancelText}</button>
          <button type="button" onClick={() => {onConfirm(); onClose();}} className={"px-4 py-2 text-white font-semibold rounded-lg text-sm transition-colors shadow-lg " + ( isDestructive ? "bg-rose-600 hover:bg-rose-500 shadow-rose-900/20" : "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20" )}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}