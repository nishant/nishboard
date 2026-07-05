import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { PopoutShell } from './components/PopoutShell';
import { WIDGET_TITLES } from './lib/layouts';
import type { WidgetId } from './lib/layouts';
import './index.css';
// Side-effect import: registers the built-in command-palette action sources.
import './lib/paletteActions';

// Popout windows load the same bundle with ?widget=<id> — render just that
// widget in a micro-shell instead of the full dashboard.
const widgetParam = new URLSearchParams(window.location.search).get('widget');
const popoutId =
  widgetParam !== null && widgetParam in WIDGET_TITLES ? (widgetParam as WidgetId) : null;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {popoutId ? <PopoutShell widgetId={popoutId} /> : <App />}
  </React.StrictMode>,
);
