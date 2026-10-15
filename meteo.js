// Pictogrammes météo des onze niveaux (0 – Alerte rouge … 10 – Plein soleil).
// Dessins originaux, décrits comme des tracés dans un carré de 48 × 48 : le même dessin sert
// dans l'application (SVG) et dans le rapport PDF (pdf-lib, drawSvgPath).

const COUL = {
  soleil: '#F2A900', soleilBord: '#C98400', rayon: '#E89B00',
  nuage: '#E3E8EC', nuageBord: '#8794A0',
  gris: '#B4BEC6', grisBord: '#6E7B86',
  sombre: '#5B6773', sombreBord: '#3B4550',
  pluie: '#3F86C4', eclair: '#F5C400', eclairBord: '#B88A00',
  lune: '#E7D9A8', luneBord: '#A99560', nuit: '#2E3A48',
  alerte: '#C62828', alerteTexte: '#FFFFFF',
};

const n = (x) => Math.round(x * 100) / 100;

/** Nuage : (x, y) = coin bas-gauche de sa base, l = largeur. */
function nuage(x, y, l) {
  const k = l / 30;
  return `M${n(x + 4 * k)} ${n(y)} H${n(x + 24 * k)} A${n(6 * k)} ${n(6 * k)} 0 0 0 ${n(x + 25 * k)} ${n(y - 12 * k)} `
    + `A${n(8.5 * k)} ${n(8.5 * k)} 0 0 0 ${n(x + 9 * k)} ${n(y - 13 * k)} A${n(6.5 * k)} ${n(6.5 * k)} 0 0 0 ${n(x + 4 * k)} ${n(y)} Z`;
}

function cercle(cx, cy, r) {
  return `M${n(cx - r)} ${n(cy)} A${n(r)} ${n(r)} 0 1 0 ${n(cx + r)} ${n(cy)} A${n(r)} ${n(r)} 0 1 0 ${n(cx - r)} ${n(cy)} Z`;
}

function rayons(cx, cy, r1, r2, nb = 8, decalage = 0) {
  let d = '';
  for (let i = 0; i < nb; i++) {
    const a = (i * 2 * Math.PI) / nb + decalage;
    d += `M${n(cx + Math.cos(a) * r1)} ${n(cy + Math.sin(a) * r1)} L${n(cx + Math.cos(a) * r2)} ${n(cy + Math.sin(a) * r2)} `;
  }
  return d.trim();
}

function gouttes(x0, y0, nb, pas, longueur, pente = 3) {
  let d = '';
  for (let i = 0; i < nb; i++) d += `M${n(x0 + i * pas)} ${n(y0)} L${n(x0 + i * pas - pente)} ${n(y0 + longueur)} `;
  return d.trim();
}

const soleil = (cx, cy, r, r1, r2, nb = 8, dec = 0) => [
  { d: rayons(cx, cy, r1, r2, nb, dec), trait: COUL.rayon, epaisseur: 2.6 },
  { d: cercle(cx, cy, r), fond: COUL.soleil, trait: COUL.soleilBord, epaisseur: 1.2 },
];

/** Formes du pictogramme pour une note (0 à 10) : [{ d, fond?, trait?, epaisseur? }]. */
export function formesMeteo(note) {
  switch (note) {
    case 0: return [ // Alerte rouge : panneau d'alerte
      { d: 'M24 5 L44.5 41 H3.5 Z', fond: COUL.alerte, trait: '#8E1B1B', epaisseur: 1.6 },
      { d: 'M24 16 L24 29', trait: COUL.alerteTexte, epaisseur: 4.2 },
      { d: cercle(24, 35.5, 2.4), fond: COUL.alerteTexte },
    ];
    case 1: return [ // Nuit noire : lune voilée par un nuage sombre
      { d: 'M29 5 A13 13 0 1 0 43 24 A10.5 10.5 0 0 1 29 5 Z', fond: COUL.lune, trait: COUL.luneBord, epaisseur: 1.2 },
      { d: nuage(4, 41, 34), fond: COUL.nuit, trait: COUL.grisBord, epaisseur: 1.4 },
    ];
    case 2: return [ // Tempête : nuage sombre, vent et pluie battante
      { d: nuage(6, 27, 34), fond: COUL.sombre, trait: COUL.sombreBord, epaisseur: 1.3 },
      { d: gouttes(14, 31, 4, 6.5, 11, 5), trait: COUL.pluie, epaisseur: 2.4 },
      { d: 'M3 13 H12 M2 19 H9', trait: COUL.grisBord, epaisseur: 2.2 },
    ];
    case 3: return [ // Ciel orageux : nuage et éclair
      { d: nuage(5, 28, 36), fond: COUL.sombre, trait: COUL.sombreBord, epaisseur: 1.3 },
      { d: 'M25 25 L18 36 H24 L20 46 L31 32 H25 L29 25 Z', fond: COUL.eclair, trait: COUL.eclairBord, epaisseur: 1.1 },
    ];
    case 4: return [ // Ciel gris : couverture nuageuse
      { d: nuage(14, 25, 28), fond: COUL.gris, trait: COUL.grisBord, epaisseur: 1.2 },
      { d: nuage(3, 38, 34), fond: COUL.nuage, trait: COUL.nuageBord, epaisseur: 1.3 },
    ];
    case 5: return [ // Entre deux : soleil presque caché
      ...soleil(32, 16, 6.5, 9.5, 13, 8, Math.PI / 8),
      { d: nuage(3, 40, 38), fond: COUL.nuage, trait: COUL.nuageBord, epaisseur: 1.3 },
    ];
    case 6: return [ // Éclaircie : soleil et nuage à parts égales
      ...soleil(29, 18, 8, 11.5, 16, 8, Math.PI / 8),
      { d: nuage(3, 41, 31), fond: COUL.nuage, trait: COUL.nuageBord, epaisseur: 1.3 },
    ];
    case 7: return [ // Beau temps : soleil, petit nuage
      ...soleil(22, 20, 9, 12.5, 17, 8, 0),
      { d: nuage(20, 42, 24), fond: COUL.nuage, trait: COUL.nuageBord, epaisseur: 1.2 },
    ];
    case 8: return soleil(24, 24, 9.5, 13.5, 18, 8, 0); // Ciel bleu : soleil dégagé
    case 9: return soleil(24, 24, 10.5, 14.5, 21, 12, 0); // Grand soleil : rayons plus nombreux
    case 10: return [ // Plein soleil : soleil éclatant, double couronne
      { d: rayons(24, 24, 15, 22.5, 8, 0), trait: COUL.rayon, epaisseur: 3 },
      { d: rayons(24, 24, 15, 19.5, 8, Math.PI / 8), trait: COUL.rayon, epaisseur: 2.2 },
      { d: cercle(24, 24, 13), fond: '#FFD54A', trait: COUL.soleilBord, epaisseur: 1 },
      { d: cercle(24, 24, 10.5), fond: COUL.soleil },
    ];
    default: return [];
  }
}

/** Pictogramme SVG (chaîne HTML), avec texte alternatif. */
export function iconeMeteo(note, { taille = 28, titre = '', classe = 'icone-meteo' } = {}) {
  const formes = formesMeteo(note);
  if (!formes.length) return '';
  const contenu = formes.map((f) => `<path d="${f.d}" fill="${f.fond || 'none'}"${f.trait ? ` stroke="${f.trait}" stroke-width="${f.epaisseur || 1}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`).join('');
  return `<svg class="${classe}" viewBox="0 0 48 48" width="${taille}" height="${taille}" ${titre ? `role="img" aria-label="${titre.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"'} focusable="false">${contenu}</svg>`;
}
