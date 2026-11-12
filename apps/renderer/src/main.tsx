import React from 'react';
import ReactDOM from 'react-dom/client';
import { AppErrorBoundary } from '@nish/ui';
import { App } from './App';
import { PopoutShell } from './components/PopoutShell';
import { isWidgetId } from './lib/layouts';
import './index.css';
// Side-effect import: registers the built-in command-palette action sources.
import './lib/paletteActions';

// Popout windows load the same bundle with ?widget=<id> — render just that
// widget in a micro-shell instead of the full dashboard.
const widgetParam = new URLSearchParams(window.location.search).get('widget');
const popoutId = isWidgetId(widgetParam) ? widgetParam : null;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>{popoutId ? <PopoutShell widgetId={popoutId} /> : <App />}</AppErrorBoundary>
  </React.StrictMode>,
);
