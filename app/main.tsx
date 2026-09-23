import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import GameApp from './ui/GameApp';
import './globals.css';
import './preview.css';
import './pfusch-shop-ui.css';
import './ride-update-v38.css';

interface AppErrorBoundaryState {
  error: Error | null;
}

/** Keep a browser-specific boot failure from leaving only the neutral canvas. */
class AppErrorBoundary extends Component<
  { children: ReactNode },
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('PFUSCH app boot failed', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="startup" role="alert">
          <strong className="wordmark">PFUSCH.</strong>
          <h1>NOCH EIN VERSUCH.</h1>
          <p>Die Startseite konnte nicht geladen werden.</p>
          <button
            className="button primary"
            onClick={() => window.location.reload()}
          >
            NEU LADEN
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('PFUSCH root element is missing');

createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <GameApp />
    </AppErrorBoundary>
  </React.StrictMode>,
);

import './refinement-v40.css';

import './ride-fix-v42.css';
