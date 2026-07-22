const CACHE_NAME = 'atlas-cache-v1';
const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './cricket_atlas.json',
    './audio/ui_click.mp3',
    './audio/bat_hit.mp3',
    './audio/crowd_groan.mp3',
    'https://fonts.googleapis.com/css2?family=Anton&family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap',
    'https://www.gstatic.com/firebasejs/10.10.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/10.10.0/firebase-auth-compat.js',
    'https://www.gstatic.com/firebasejs/10.10.0/firebase-database-compat.js'
    // add your icon paths here if you have them, e.g., './icon-192.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request).catch(() => {
                // optional: fallback logic if offline and not cached
            });
        })
    );
});
