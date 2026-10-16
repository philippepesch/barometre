// Carte des lieux : projection Web Mercator, cadrage automatique et fond OpenStreetMap facultatif.
// Le fond de carte est téléchargé depuis tile.openstreetmap.org seulement si le réglage « fondCarte »
// est actif : seules les coordonnées des tuiles (la zone affichée) sont demandées, sans autre donnée.

export const TUILE = 256;
export const ATTRIBUTION = '© les contributeurs d\'OpenStreetMap';
const URL_TUILE = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

/** Coordonnées « monde » en pixels au niveau de zoom z. */
export function projeter(lat, lon, z) {
  const n = TUILE * 2 ** z;
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n };
}

/** Lieux de la période qui ont des coordonnées (choisis dans la liste de recherche). */
export function pointsCarte(lignesParLieu) {
  return lignesParLieu
    .filter((l) => l.valeur && Number.isFinite(l.valeur.lat) && Number.isFinite(l.valeur.lon))
    .map((l) => ({ nom: l.valeur.nom, lat: l.valeur.lat, lon: l.valeur.lon, nombre: l.nombre, moyenne: l.moyenne, cle: l.cle }));
}

/**
 * Niveau de zoom et coin haut-gauche pour que tous les points tiennent dans largeur × hauteur (pixels),
 * avec une marge. Un seul point : zoom de quartier/village.
 */
export function cadrage(points, largeur, hauteur, { marge = 48, zMin = 3, zMax = 13 } = {}) {
  if (!points.length) return null;
  let z = zMax;
  for (; z > zMin; z--) {
    const p = points.map((q) => projeter(q.lat, q.lon, z));
    const w = Math.max(...p.map((q) => q.x)) - Math.min(...p.map((q) => q.x));
    const h = Math.max(...p.map((q) => q.y)) - Math.min(...p.map((q) => q.y));
    if (w <= largeur - 2 * marge && h <= hauteur - 2 * marge) break;
  }
  if (points.length === 1) z = Math.min(z, 11);
  const p = points.map((q) => projeter(q.lat, q.lon, z));
  const cx = (Math.max(...p.map((q) => q.x)) + Math.min(...p.map((q) => q.x))) / 2;
  const cy = (Math.max(...p.map((q) => q.y)) + Math.min(...p.map((q) => q.y))) / 2;
  return { z, x0: cx - largeur / 2, y0: cy - hauteur / 2, largeur, hauteur };
}

/** Position d'un point dans le cadre (pixels depuis le coin haut-gauche). */
export function positionDans(c, lat, lon) {
  const p = projeter(lat, lon, c.z);
  return { x: p.x - c.x0, y: p.y - c.y0 };
}

/** Tuiles nécessaires pour couvrir le cadre. */
export function tuiles(c) {
  const n = 2 ** c.z;
  const res = [];
  for (let tx = Math.floor(c.x0 / TUILE); tx * TUILE < c.x0 + c.largeur; tx++) {
    for (let ty = Math.floor(c.y0 / TUILE); ty * TUILE < c.y0 + c.hauteur; ty++) {
      if (ty < 0 || ty >= n) continue;
      res.push({ z: c.z, x: ((tx % n) + n) % n, y: ty, dx: tx * TUILE - c.x0, dy: ty * TUILE - c.y0, url: URL_TUILE(c.z, ((tx % n) + n) % n, ty) });
    }
  }
  return res;
}

/** Échelle graphique : longueur « ronde » (m ou km) et sa largeur en pixels, pour environ 1/5 du cadre. */
export function echelle(c, latCentre) {
  const mParPx = (156543.03392 * Math.cos((latCentre * Math.PI) / 180)) / 2 ** c.z;
  const cible = (c.largeur / 5) * mParPx;
  const p = 10 ** Math.floor(Math.log10(cible));
  const m = [1, 2, 5, 10].map((k) => k * p).filter((v) => v <= cible).pop() || p;
  return { metres: m, pixels: m / mParPx, libelle: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}

/**
 * Fond de carte assemblé dans un canevas (navigateur uniquement). Retourne un Blob PNG,
 * ou null si une tuile n'a pas pu être chargée (hors connexion, service indisponible).
 */
export async function fondDeCarte(c, { fetch: f = globalThis.fetch.bind(globalThis), echelleRendu = 1 } = {}) {
  const canevas = new OffscreenCanvas(Math.round(c.largeur * echelleRendu), Math.round(c.hauteur * echelleRendu));
  const ctx = canevas.getContext('2d');
  ctx.fillStyle = '#F2EFE9';
  ctx.fillRect(0, 0, canevas.width, canevas.height);
  const liste = tuiles(c);
  if (liste.length > 40) return null;
  const images = await Promise.all(liste.map(async (t) => {
    const rep = await f(t.url, { credentials: 'omit', referrerPolicy: 'strict-origin-when-cross-origin' });
    if (!rep.ok) throw new Error(`tuile ${rep.status}`);
    return { t, bmp: await createImageBitmap(await rep.blob()) };
  }));
  for (const { t, bmp } of images) ctx.drawImage(bmp, t.dx * echelleRendu, t.dy * echelleRendu, TUILE * echelleRendu, TUILE * echelleRendu);
  // Voile clair : les marqueurs restent lisibles et le document reste sobre
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, 0, canevas.width, canevas.height);
  return canevas.convertToBlob({ type: 'image/png' });
}
