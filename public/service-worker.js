/**
 * service-worker.js — PWA Service Worker Cache untuk Aplikasi Absensi Sekolah
 * Mengizinkan aset statis dan antarmuka dapat dibuka dalam jaringan lokal / offline
 */

const CACHE_NAME = 'absensi-cache-v1';
const STATIC_ASSETS = [
    '/',
    '/scanner',
    '/login',
    '/admin',
    '/css/shared.css',
    '/css/style.css',
    '/css/animations.css',
    '/js/animations.js',
    '/js/live-clock.js',
    '/vendor/fontawesome/css/all.min.css',
    '/vendor/inter/inter.css',
    '/assets/images/logo.png',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch((err) => {
                console.warn('[SW] Beberapa aset gagal di-cache saat install:', err);
            });
        }).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;

    // Jangan cache request API dan POST/PUT/DELETE
    if (request.url.includes('/api/') || request.method !== 'GET') {
        return;
    }

    event.respondWith(
        fetch(request)
            .then((networkResponse) => {
                // Update cache jika berhasil fetch
                if (networkResponse && networkResponse.status === 200) {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                // Ambil dari cache jika jaringan/server terputus
                return caches.match(request);
            })
    );
});
