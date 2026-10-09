// Synchronisation entre appareils par un coffre chiffré de bout en bout.
// Le chiffrement (AES-GCM 256 bits, clé dérivée de la phrase secrète par PBKDF2-SHA-256)
// a lieu sur l'appareil : le service en ligne ne voit jamais les données en clair.

const ITERATIONS = 310000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64 = (buf) => { let s = ''; const o = new Uint8Array(buf); for (let i = 0; i < o.length; i += 0x8000) s += String.fromCharCode(...o.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const cles = new Map();
async function cle(phrase, sel, iterations) {
  const id = `${iterations}:${b64(sel)}:${phrase}`;
  if (!cles.has(id)) {
    const base = await crypto.subtle.importKey('raw', enc.encode(phrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    cles.set(id, await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: sel, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']));
  }
  return cles.get(id);
}

export async function chiffrer(objet, phrase, selExistant = null) {
  const sel = selExistant ? deB64(selExistant) : crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await cle(phrase, sel, ITERATIONS);
  const donnees = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(objet)));
  return { v: 1, alg: 'AES-GCM-256/PBKDF2-SHA-256', iter: ITERATIONS, sel: b64(sel), iv: b64(iv), donnees: b64(donnees) };
}

export async function dechiffrer(coffre, phrase) {
  try {
    const k = await cle(phrase, deB64(coffre.sel), coffre.iter || ITERATIONS);
    const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(coffre.iv) }, k, deB64(coffre.donnees));
    return JSON.parse(dec.decode(clair));
  } catch {
    throw new Error('Phrase de synchronisation incorrecte : elle doit être identique sur tous tes appareils.');
  }
}

async function erreur(rep) {
  let detail = '';
  try { detail = (await rep.json()).erreur || ''; } catch { /* pas de JSON */ }
  if (rep.status === 401) return 'Mot de passe du service refusé.';
  if (rep.status === 404) return 'Le service en ligne ne connaît pas la synchronisation : remplace son code par la dernière version de worker.js.';
  return `Le service en ligne a répondu ${rep.status}${detail ? ` : ${detail}` : ''}.`;
}

export async function lireCoffre({ url, jeton }, f = globalThis.fetch.bind(globalThis)) {
  const rep = await f(`${url}/coffre`, { headers: { authorization: `Bearer ${jeton}` }, cache: 'no-store' });
  if (!rep.ok) throw new Error(await erreur(rep));
  return rep.json(); // { version, coffre }
}

export async function ecrireCoffre({ url, jeton }, versionPrecedente, coffre, f = globalThis.fetch.bind(globalThis)) {
  const rep = await f(`${url}/coffre`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' },
    body: JSON.stringify({ versionPrecedente, coffre }),
  });
  if (rep.status === 409) return { conflit: true };
  if (!rep.ok) throw new Error(await erreur(rep));
  return { conflit: false, ...(await rep.json()) };
}

/** Code de connexion à recopier sur l'autre appareil (adresse et mot de passe du service, sans la phrase). */
export function codeConnexion(url, jeton) {
  return `BAROMETRE-${btoa(JSON.stringify({ u: url, j: jeton })).replace(/=+$/, '')}`;
}

export function lireCodeConnexion(code) {
  const m = /BAROMETRE-([A-Za-z0-9+/]+)/.exec(String(code || '').replace(/\s+/g, ''));
  if (!m) throw new Error('Code de connexion non reconnu : il commence par BAROMETRE-.');
  try {
    const s = m[1] + '='.repeat((4 - (m[1].length % 4)) % 4);
    const o = JSON.parse(atob(s));
    if (!/^https:\/\//.test(o.u) || !o.j) throw new Error();
    return { url: o.u, jeton: o.j };
  } catch { throw new Error('Code de connexion incomplet : copie-le en entier.'); }
}
