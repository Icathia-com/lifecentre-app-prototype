// Service worker: keeps the app shell (the screens, styles, scripts and icons) so the app opens with no connection.
// It never touches data. Firestore, sign-in, the booking system, YouTube and anything else not listed below are left to the browser.
// Files are fetched from the network first (so a new version shows up straight away) and fall back to the saved copy.
// When the shell changes, raise VERSION: old copies are deleted when the new worker starts.
const VERSION = 'v5';
const CACHE = `lc-shell-${VERSION}`;

// Every file the app needs to open. app/tests/pwa.test.mjs fails if a file is missing from this list.
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'css/screens.css',
  'images/paynow-building.png', 'images/paynow-tithes.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'js/bible.js', 'js/booking-api.js', 'js/giving-text.js', 'js/data.js', 'js/firebase.js', 'js/image.js', 'js/local.js', 'js/main.js', 'js/member-signin.js', 'js/my-bookings.js', 'js/planner.js', 'js/poster.js',
  'js/router.js', 'js/sample-data.js', 'js/session.js', 'js/sites.js', 'js/task-sheet.js', 'js/ui.js', 'js/util.js', 'js/verse-card.js', 'js/youtube.js',
  'js/views/account.js', 'js/views/booking.js', 'js/views/contact.js', 'js/views/day.js', 'js/views/event-create.js', 'js/views/event.js', 'js/views/events.js',
  'js/views/giving.js', 'js/views/home.js', 'js/views/location.js', 'js/views/notifications.js', 'js/views/staff.js', 'js/views/watch.js',
];

// Code and fonts from other sites that the shell needs. These are scripts and fonts only, never data.
const FIREBASE_CODE = [
  'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js',
  'https://www.gstatic.com/firebasejs/13.1.0/firebase-firestore.js',
];
const SHELL_HOSTS = [/^https:\/\/www\.gstatic\.com\/firebasejs\//, /^https:\/\/fonts\.googleapis\.com\//, /^https:\/\/fonts\.gstatic\.com\//, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/qrcode-generator\//];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' })));
    // The Firebase code is best effort: a failure here must not stop the app from installing.
    await Promise.allSettled(FIREBASE_CODE.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('lc-shell-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(CACHE);
  try {
    const response = await Promise.race([fetch(request), new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 5000))]);
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  } catch (error) {
    const saved = await cache.match(request, { ignoreSearch: true }) ?? (fallbackKey ? await cache.match(fallbackKey) : undefined);
    if (saved) return saved;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    // Only files inside the app folder: nothing else on this site is kept.
    if (!url.pathname.startsWith(new URL('./', self.location).pathname)) return;
    event.respondWith(networkFirst(request, request.mode === 'navigate' ? 'index.html' : undefined));
  } else if (SHELL_HOSTS.some((re) => re.test(request.url))) {
    event.respondWith(networkFirst(request));
  }
});
