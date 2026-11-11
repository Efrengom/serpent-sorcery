import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// Development only: ?inspector opens the sprite and effect inspector instead of the game. In a
// production build the branch is dead, so the inspector isn't built at all.
const Inspector = import.meta.env.DEV && new URLSearchParams(location.search).has('inspector') ? lazy(() => import('./ui/Inspector')) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {Inspector ? (
      <Suspense fallback={null}>
        <Inspector />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);

// A deploy replaces the files that parts loaded on demand come from, so a page opened before it
// can't fetch them: reload it, once, to pick up the new build.
window.addEventListener('vite:preloadError', (e) => {
  const KEY = 'serpent-sorcery-reloaded';
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // No session storage: reload anyway.
  }
  if (Date.now() - last < 60_000) return;
  e.preventDefault();
  location.reload();
});

// Installed (home-screen) play works offline: the service worker keeps what the game has loaded.
// Production builds only, so the dev server's live reloading is never cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
