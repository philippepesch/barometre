// Service worker : fonctionnement hors ligne et notifications.
// Changer VERSION à chaque mise à jour des fichiers de l'application.
const VERSION = 'barometre-humeur-1.4.0';
const FICHIERS = [
  './', 'index.html', 'styles.css', 'app.js', 'core.js', 'db.js', 'rapport.js', 'ia.js', 'sync.js', 'pdf-lib.min.js',
  'manifest.webmanifest', 'icone-32.png', 'icone-192.png', 'icone-512.png', 'icone-maskable-512.png',
  'apple-touch-icon.png', 'icone-badge.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const cle of await caches.keys()) if (cle !== VERSION) await caches.delete(cle);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'activer') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (req.mode === 'navigate') {
      const page = await cache.match('index.html');
      if (page) return page;
    }
    const enCache = await cache.match(req, { ignoreSearch: true });
    if (enCache) return enCache;
    try {
      return await fetch(req);
    } catch {
      return new Response('Hors ligne', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  })());
});

function creneauSelonHeure() {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Luxembourg', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return h >= 6 && h < 18 ? 'matin' : 'soir';
}

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = {}; }
  const creneau = d.creneau === 'matin' || d.creneau === 'soir' ? d.creneau : creneauSelonHeure();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? d.date : '';
  const discret = !!d.discret;
  const titre = d.titre || (discret ? (creneau === 'matin' ? 'Rappel du matin' : 'Rappel du soir') : `Évaluation du ${creneau}`);
  const corps = d.corps || (discret ? 'Touchez pour ouvrir.' : 'Comment te sens-tu en ce moment ?');
  const taches = [self.registration.showNotification(titre, {
    body: corps,
    tag: `barometre-${date || 'jour'}-${creneau}`,
    icon: 'icone-192.png',
    badge: 'icone-badge.png',
    data: { url: `./?creneau=${creneau}${date ? `&date=${date}` : ''}` },
  })];
  if (self.navigator && self.navigator.setAppBadge) taches.push(self.navigator.setAppBadge(1).catch(() => {}));
  e.waitUntil(Promise.all(taches));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const cible = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const f of fenetres) {
      if (f.url.startsWith(self.registration.scope)) {
        await f.focus();
        f.postMessage({ type: 'ouvrir', url: cible });
        return;
      }
    }
    await self.clients.openWindow(cible);
  })());
});
