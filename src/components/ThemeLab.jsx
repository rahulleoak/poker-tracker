import { useState, useEffect } from 'react';
import { themes } from '../themes';

export function ThemeLab() {
  const [currentTheme, setCurrentTheme] = useState('default');

  useEffect(() => {
    const root = document.documentElement;
    if (currentTheme === 'default') {
      root.style.removeProperty('--bg-main');
      root.style.removeProperty('--bg-nav');
      root.style.removeProperty('--text-main');
      root.style.removeProperty('--text-primary');
      root.style.removeProperty('--text-secondary');
      root.style.removeProperty('--border-color');
    } else {
      const theme = themes[currentTheme];
      Object.entries(theme.variables).forEach(([key, value]) => {
        root.style.setProperty(key, value);
      });
    }
  }, [currentTheme]);

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-4 right-4 bg-slate-800 p-4 rounded-lg shadow-xl z-50 border border-slate-700">
      <h3 className="text-white font-bold mb-2">Theme Lab</h3>
      <select
        value={currentTheme}
        onChange={(e) => setCurrentTheme(e.target.value)}
        className="bg-slate-900 text-white p-2 rounded"
      >
        <option value="default">Default</option>
        {Object.keys(themes).map(key => (
          <option key={key} value={key}>{themes[key].name}</option>
        ))}
      </select>
    </div>
  );
}
