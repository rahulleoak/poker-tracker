/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        hud: {
          black: '#050508',
          card: '#090a0f',
          surface: '#0f111a',
          border: 'rgba(255, 255, 255, 0.08)',
          'border-active': 'rgba(255, 255, 255, 0.22)',
        },
      },
      boxShadow: {
        'neon-emerald': '0 0 15px rgba(16, 185, 129, 0.35)',
        'neon-rose': '0 0 15px rgba(244, 63, 94, 0.35)',
        'neon-cyan': '0 0 15px rgba(6, 182, 212, 0.35)',
        'neon-amber': '0 0 15px rgba(245, 158, 11, 0.35)',
        'neon-indigo': '0 0 15px rgba(99, 102, 241, 0.35)',
      },
      dropShadow: {
        'glow-emerald': '0 0 8px rgba(34, 197, 94, 0.8)',
        'glow-rose': '0 0 8px rgba(244, 63, 94, 0.8)',
        'glow-cyan': '0 0 8px rgba(6, 182, 212, 0.8)',
        'glow-amber': '0 0 8px rgba(245, 158, 11, 0.8)',
        'glow-white': '0 0 6px rgba(255, 255, 255, 0.6)',
      },
    },
  },
  plugins: [],
}
