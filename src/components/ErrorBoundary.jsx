import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('OffSuite ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="hud-corner-reticle bg-hud-card/95 border border-rose-500/30 p-8 text-center max-w-xl mx-auto my-12 shadow-2xl backdrop-blur-xl font-mono">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-none bg-rose-500/10 border border-rose-500/30 text-rose-400 mb-4">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-bold text-white uppercase tracking-wider mb-2">
            Interface Rendering Exception
          </h2>
          <p className="text-xs text-zinc-400 mb-4 font-mono">
            {this.state.error?.message || 'An unexpected rendering error occurred in this view.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
            className="px-4 py-2 bg-black border border-rose-500/50 text-rose-300 hover:text-white hover:bg-rose-500/20 text-xs font-bold uppercase tracking-wider transition-all inline-flex items-center gap-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
