// Lumoda staff app — offline app-shell cache.
//
// Strategy: network-first for everything in this app, falling back to the
// cache only when the network fetch actually fails. Staff always get the
// latest code when they're online; offline just means "keep working with
// whatever was last loaded" instead of a blank error page. Supabase itself
// is never touched here — business data must always be live, never served
// from a cache — so reads/writes fail normally (and visibly) when offline.
//
// Bump CACHE_NAME whenever the shell file list below changes so old caches
// get cleared out on the next activate.
const CACHE_NAME = 'lumoda-shell-v1';
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './supabase-config.js',
  './supabase-client.js',
  './warehouse.js',
  './js/core.js',
  './js/auth.js',
  './js/invoices.js',
  './js/customers.js',
  './js/products.js',
  './js/dashboard.js',
  './js/reports.js',
  './js/admin.js',
  './js/settings.js',
  './js/bootstrap.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  SDK_URL
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Supabase API/auth traffic: never intercept, never cache — always live.
  if (url.hostname.endsWith('.supabase.co')) return;

  // The SDK script is version-pinned in the URL itself, so it's safe and
  // fast to serve straight from cache, refreshing the cached copy in the
  // background.
  if (req.url === SDK_URL) {
    event.respondWith(
      caches.match(req).then(cached => {
        const fetchPromise = fetch(req).then(res => {
          caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
          return res;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  // Leave any other cross-origin request alone.
  if (url.origin !== self.location.origin) return;

  // App shell: network-first, cache fallback (index.html for navigations).
  event.respondWith(
    fetch(req)
      .then(res => {
        caches.open(CACHE_NAME).then(cache => cache.put(req, res.clone()));
        return res;
      })
      .catch(() =>
        caches.match(req).then(cached => cached || caches.match('./index.html'))
      )
  );
});
