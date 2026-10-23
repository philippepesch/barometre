// Service worker : fonctionnement hors ligne et notifications.
// Changer VERSION à chaque mise à jour des fichiers de l'application.
const VERSION = 'barometre-humeur-1.31.0';
const FICHIERS = [
  './', 'index.html', 'styles.css', 'app.js', 'core.js', 'db.js', 'rapport.js', 'ia.js', 'sync.js', 'lieux.js', 'meteo.js', 'carte.js', 'pdf-lib.min.js',
  'manifest.webmanifest', 'icone-32.png', 'icone-192.png', 'icone-512.png', 'icone-maskable-512.png',
  'apple-touch-icon.png', 'icone-badge.png',
];

self.addEventListener('install', (e) => {
  // « reload » : toujours les fichiers neufs du serveur, jamais une copie gardée par le navigateur
  // (sinon, deux mises à jour rapprochées peuvent mélanger deux versions)
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: 'reload' })))));
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

// ---------------------------------------------------------------------------
// Évaluation manquée : au rappel de 18 h, on vérifie sur CET appareil si l'évaluation du matin existe ;
// au rappel de 6 h, celle de la veille au soir. Aucune donnée ne quitte l'appareil.

function lireBase() {
  return new Promise((ok) => {
    let req;
    try { req = indexedDB.open('barometre-humeur', 1); } catch { ok(null); return; }
    req.onupgradeneeded = () => { req.transaction.abort(); }; // pas de base : ne rien créer
    req.onsuccess = () => ok(req.result);
    req.onerror = () => ok(null);
  });
}
const lireEnregistrement = (db, magasin, cle, index) => new Promise((ok) => {
  try {
    const st = db.transaction(magasin).objectStore(magasin);
    const r = index ? st.index(index).get(cle) : st.get(cle);
    r.onsuccess = () => ok(r.result || null);
    r.onerror = () => ok(null);
  } catch { ok(null); }
});
/** Créneaux prévus ce jour-là (rythme choisi dans l'application ; sans rythme : matin et soir). */
function creneauxDuJour(rythme, date) {
  let c = ['matin', 'soir'];
  for (const r of Array.isArray(rythme) ? rythme : []) if (r && typeof r.depuis === 'string' && r.depuis <= date && Array.isArray(r.creneaux) && r.creneaux.length) c = r.creneaux;
  return c;
}

function jourPrecedent(date) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const dateLux = (t) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Luxembourg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);

/** Créneau précédent non rempli (ou null) : { date, creneau, limite } */
async function creneauManque(creneau, date) {
  const db = await lireBase();
  if (!db) return null;
  try {
    const actif = await lireEnregistrement(db, 'parametres', 'alerteManquee');
    if (actif && actif.valeur === false) return null;
    const debut = await lireEnregistrement(db, 'parametres', 'debutSuiviUtc');
    const rythme = await lireEnregistrement(db, 'parametres', 'rythme');
    const jour = date || dateLux(new Date());
    // Créneau attendu précédent selon le rythme (une évaluation par jour le soir : celle de la veille au soir)
    const prevu = (c) => creneauxDuJour(rythme && rythme.valeur, c.date).includes(c.creneau);
    const avant = (c) => (c.creneau === 'soir' ? { date: c.date, creneau: 'matin' } : { date: jourPrecedent(c.date), creneau: 'soir' });
    let precedent = avant({ date: jour, creneau });
    for (let i = 0; i < 4 && !prevu(precedent); i++) precedent = avant(precedent);
    // Fin du créneau précédent = maintenant (heure du rappel) ; s'il s'est terminé avant le début du suivi, rien à signaler
    if (debut && debut.valeur && Date.parse(debut.valeur) > Date.now() - 60000) return null;
    const ev = await lireEnregistrement(db, 'evaluations', `${precedent.date}_${precedent.creneau}`, 'creneauId');
    if (ev) return null;
    // Limite de rattrapage : 24 h après le rappel qui a clos le créneau (c'est-à-dire maintenant)
    return { ...precedent, limite: creneau === 'matin' ? 'demain à 06:00' : 'demain à 18:00' };
  } finally { db.close(); }
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
  if (!d.titre) {
    taches.push(creneauManque(creneau, date).then((m) => {
      if (!m) return null;
      const quand = m.creneau === 'matin' ? 'du matin' : 'd\'hier soir';
      return self.registration.showNotification(discret ? 'Rappel à rattraper' : `Évaluation ${quand} à rattraper`, {
        body: discret ? 'Touchez pour ouvrir.' : `Elle n'est pas encore remplie. Tu peux encore la saisir jusqu'à ${m.limite}.`,
        tag: `barometre-manque-${m.date}-${m.creneau}`,
        icon: 'icone-192.png',
        badge: 'icone-badge.png',
        data: { url: `./?creneau=${m.creneau}&date=${m.date}` },
      });
    }).catch(() => null));
  }
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
