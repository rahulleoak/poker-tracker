import { motion } from 'framer-motion';

export default function MetricCard({ title, value, subtitle, icon, valueColor = "text-white" }) {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="hud-corner-reticle bg-hud-card/80 backdrop-blur-md border border-white/10 p-6 relative overflow-hidden group hover:border-white/20 transition-all duration-300"
    >
      <div className="absolute top-0 right-0 p-4 opacity-30 group-hover:opacity-60 transition-opacity">
        {icon}
      </div>
      <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-1 font-sans">{title}</p>
      <h3 className={`text-2xl sm:text-3xl font-bold font-mono tabular-nums tracking-tight ${valueColor}`}>
        {value}
      </h3>
      {subtitle && <p className="text-xs text-zinc-500 mt-1 font-sans">{subtitle}</p>}
    </motion.div>
  );
}
