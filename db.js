// Base de données locale (IndexedDB) : les données restent sur l'appareil.

const NOM = 'barometre-humeur';
const VERSION = 1;
export const MAGASINS = ['evaluations', 'motifs', 'parametres', 'instantanes', 'archives', 'poignees'];

let promesse = null;

export function ouvrir() {
  if (promesse) return promesse;
  promesse = new Promise((resoudre, rejeter) => {
    if (!('indexedDB' in globalThis)) { rejeter(new Error('Ce navigateur ne permet pas le stockage local (IndexedDB).')); return; }
    const req = indexedDB.open(NOM, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('evaluations')) {
        const s = db.createObjectStore('evaluations', { keyPath: 'id' });
        s.createIndex('creneauId', 'creneauId', { unique: false });
      }
      if (!db.objectStoreNames.contains('motifs')) db.createObjectStore('motifs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('parametres')) db.createObjectStore('parametres', { keyPath: 'cle' });
      if (!db.objectStoreNames.contains('instantanes')) db.createObjectStore('instantanes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('archives')) db.createObjectStore('archives', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('poignees')) db.createObjectStore('poignees', { keyPath: 'cle' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); promesse = null; };
      resoudre(db);
    };
    req.onerror = () => rejeter(req.error || new Error('Ouverture de la base impossible.'));
    req.onblocked = () => rejeter(new Error('La base est bloquée par un autre onglet : ferme les autres fenêtres de l\'application.'));
  });
  return promesse;
}

function enPromesse(req) {
  return new Promise((ok, ko) => { req.onsuccess = () => ok(req.result); req.onerror = () => ko(req.error); });
}

async function transaction(magasins, mode, travail) {
  const db = await ouvrir();
  return new Promise((ok, ko) => {
    const tx = db.transaction(magasins, mode);
    let resultat;
    tx.oncomplete = () => ok(resultat);
    tx.onerror = () => ko(tx.error || new Error('Erreur d\'écriture dans la base locale.'));
    tx.onabort = () => ko(tx.error || new Error('Écriture annulée.'));
    Promise.resolve(travail(tx)).then((r) => { resultat = r; }, (e) => { try { tx.abort(); } catch { /* déjà terminée */ } ko(e); });
  });
}

export async function tout(magasin) {
  return transaction([magasin], 'readonly', (tx) => enPromesse(tx.objectStore(magasin).getAll()));
}

export async function lire(magasin, cle) {
  return transaction([magasin], 'readonly', (tx) => enPromesse(tx.objectStore(magasin).get(cle)));
}

export async function mettre(magasin, valeur) {
  return transaction([magasin], 'readwrite', (tx) => { tx.objectStore(magasin).put(valeur); });
}

export async function mettrePlusieurs(magasin, valeurs) {
  return transaction([magasin], 'readwrite', (tx) => { const s = tx.objectStore(magasin); for (const v of valeurs) s.put(v); });
}

export async function supprimer(magasin, cle) {
  return transaction([magasin], 'readwrite', (tx) => { tx.objectStore(magasin).delete(cle); });
}

export async function lireParametres() {
  const lignes = await tout('parametres');
  if (!lignes.length) return null;
  return Object.fromEntries(lignes.map((l) => [l.cle, l.valeur]));
}

export async function ecrireParametres(p) {
  return transaction(['parametres'], 'readwrite', (tx) => {
    const s = tx.objectStore('parametres');
    for (const [cle, valeur] of Object.entries(p)) s.put({ cle, valeur });
  });
}

/** Archive une évaluation et la retire de la liste active, en une seule transaction. */
export async function archiverEvaluation(archive) {
  return transaction(['evaluations', 'archives'], 'readwrite', (tx) => {
    tx.objectStore('archives').put(archive);
    tx.objectStore('evaluations').delete(archive.evaluation.id);
  });
}

/** Remet l'évaluation en place ; l'archive est conservée et marquée comme restaurée (utile à la synchronisation). */
export async function restaurerArchive(archive, evaluation) {
  return transaction(['evaluations', 'archives'], 'readwrite', (tx) => {
    tx.objectStore('evaluations').put(evaluation || archive.evaluation);
    tx.objectStore('archives').put(archive);
  });
}

/** Remplace l'ensemble des données (restauration). Les instantanés sont conservés. */
export async function remplacerTout({ evaluations, motifs, parametres, archives }) {
  return transaction(['evaluations', 'motifs', 'parametres', 'archives'], 'readwrite', (tx) => {
    for (const m of ['evaluations', 'motifs', 'parametres', 'archives']) tx.objectStore(m).clear();
    for (const e of evaluations) tx.objectStore('evaluations').put(e);
    for (const m of motifs) tx.objectStore('motifs').put(m);
    for (const a of archives || []) tx.objectStore('archives').put(a);
    for (const [cle, valeur] of Object.entries(parametres)) tx.objectStore('parametres').put({ cle, valeur });
  });
}

export async function toutEffacer() {
  return transaction(MAGASINS, 'readwrite', (tx) => { for (const m of MAGASINS) tx.objectStore(m).clear(); });
}
