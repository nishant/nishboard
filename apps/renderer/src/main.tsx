import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
// Side-effect import: registers the built-in command-palette action sources.
import './lib/paletteActions';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
