import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { PasscodeGate } from './components/PasscodeGate';
import { primeAudioUnlock } from './lib/feedback';
import './index.css';

// Arm the iOS audio-context unlock on the first user tap (the passcode /
// start-session tap), so the capture beep works from the first scan onward.
primeAudioUnlock();

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
  // When a new SW activates and takes control mid-session (a fresh deploy),
  // reload once so the latest bundle loads. Guarded against the first-ever
  // install (no prior controller) and against reload loops.
  let refreshing = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing || !hadController) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        reg.update().catch(() => {}); // check for a newer SW on each load
      })
      .catch((err) => console.warn('Service worker registration failed:', err));
  });
}
