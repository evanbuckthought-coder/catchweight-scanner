import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PasscodeGate } from './components/PasscodeGate';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PasscodeGate>
      <App />
    </PasscodeGate>
  </StrictMode>,
);

// Register the service worker for installability / offline shell. Only in
// production builds — the dev server doesn't need (or want) a cached shell.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  });
}
