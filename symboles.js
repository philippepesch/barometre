// Symboles des lieux, des activités et de la situation professionnelle (maison, randonnée, repas, congé…). Dessins originaux et simples,
// décrits comme des tracés dans un carré de 48 × 48 : le même dessin sert dans l'application (SVG)
// et dans le rapport PDF (pdf-lib, drawSvgPath), comme les pictogrammes météo.

const T = '#3B5368';   // trait
const F = '#E6EDF4';   // fond clair
const A = '#7FA6C8';   // accent bleu
const V = '#8DB48A';   // vert
const R = '#D9645A';   // rouge
const O = '#E6A23C';   // orange

const cercle = (cx, cy, r) => `M${cx - r} ${cy} A${r} ${r} 0 1 0 ${cx + r} ${cy} A${r} ${r} 0 1 0 ${cx - r} ${cy} Z`;

const FORMES = {
  maison: [
    { d: 'M11 22 V40 H37 V22 L24 11 Z', fond: F, trait: T, epaisseur: 2.4 },
    { d: 'M7 25 L24 10 L41 25', trait: T, epaisseur: 3 },
    { d: 'M20.5 40 V30 H27.5 V40 Z', fond: A, trait: T, epaisseur: 2 },
  ],
  randonnee: [
    { d: 'M4 40 L17 18 L25 30 L31 22 L44 40 Z', fond: V, trait: T, epaisseur: 2.2 },
    { d: 'M14 23 L17 18 L20 23', trait: '#FFFFFF', epaisseur: 2 },
    { d: 'M33 8 V20 M33 8 L41 11 L33 14', fond: R, trait: T, epaisseur: 2 },
  ],
  repas: [
    { d: 'M12 8 V17 Q12 22 16 22 Q20 22 20 17 V8 M16 8 V40', trait: T, epaisseur: 2.6 },
    { d: 'M32 8 Q39 14 37 26 H32 Z', fond: F, trait: T, epaisseur: 2.2 },
    { d: 'M34 26 V40', trait: T, epaisseur: 2.8 },
  ],
  cafe: [
    { d: 'M9 19 H33 V29 Q33 38 21 38 Q9 38 9 29 Z', fond: F, trait: T, epaisseur: 2.4 },
    { d: 'M33 22 Q41 22 41 27 Q41 32 33 32', trait: T, epaisseur: 2.4 },
    { d: 'M16 8 Q19 11 16 14 M23 7 Q26 10 23 13', trait: O, epaisseur: 2 },
  ],
  velo: [
    { d: `${cercle(12, 32, 7.5)} ${cercle(36, 32, 7.5)}`, trait: T, epaisseur: 2.4 },
    { d: 'M12 32 L19 19 H31 L36 32 M19 19 L25 32 H12 M27 13 H33 M29 13 L31 19', trait: A, epaisseur: 2.4 },
  ],
  courses: [
    { d: 'M5 9 H11 L15 31 H37 L41 15 H13', fond: F, trait: T, epaisseur: 2.4 },
    { d: `${cercle(18, 38, 3)} ${cercle(34, 38, 3)}`, fond: T },
  ],
  sante: [
    { d: 'M19 8 H29 V19 H40 V29 H29 V40 H19 V29 H8 V19 H19 Z', fond: R, trait: '#A8443C', epaisseur: 1.6 },
  ],
  famille: [
    { d: `${cercle(16, 15, 5.5)} ${cercle(32, 15, 5.5)}`, fond: F, trait: T, epaisseur: 2.2 },
    { d: 'M5 39 Q5 24 16 24 Q24 24 25.5 31 M22.5 31 Q24 24 32 24 Q43 24 43 39 Z', fond: A, trait: T, epaisseur: 2.2 },
  ],
  travail: [
    { d: 'M7 17 H41 V39 H7 Z', fond: O, trait: T, epaisseur: 2.4 },
    { d: 'M18 17 V12 H30 V17 M7 26 H41', trait: T, epaisseur: 2.2 },
  ],
  sport: [
    { d: cercle(24, 24, 16), fond: '#FFFFFF', trait: T, epaisseur: 2.4 },
    { d: 'M24 17 L30.5 21.5 L28 29 H20 L17.5 21.5 Z', fond: T },
    { d: 'M24 8 V17 M30.5 21.5 L39 18 M28 29 L33 37 M20 29 L15 37 M17.5 21.5 L9 18', trait: T, epaisseur: 1.6 },
  ],
  culture: [
    { d: 'M19 34 V11 L39 7 V30', trait: T, epaisseur: 2.6 },
    { d: `${cercle(14, 34, 5.5)} ${cercle(34, 30, 5.5)}`, fond: A, trait: T, epaisseur: 2 },
  ],
  recherche: [
    { d: 'M7 12 Q15 8 24 12 Q33 8 41 12 V38 Q33 34 24 38 Q15 34 7 38 Z', fond: F, trait: T, epaisseur: 2.2 },
    { d: 'M24 12 V38 M11 18 H19 M11 24 H19 M29 18 H37 M29 24 H37', trait: T, epaisseur: 1.6 },
  ],
  photo: [
    { d: 'M6 16 H14 L17 11 H31 L34 16 H42 V38 H6 Z', fond: F, trait: T, epaisseur: 2.4 },
    { d: cercle(24, 26, 7), fond: A, trait: T, epaisseur: 2.2 },
  ],
  nature: [
    { d: 'M24 6 Q37 8 37 21 Q37 31 24 31 Q11 31 11 21 Q11 8 24 6 Z', fond: V, trait: T, epaisseur: 2.2 },
    { d: 'M24 18 V42 M18 42 H30', trait: '#7A5A3A', epaisseur: 3 },
  ],
  voyage: [
    { d: 'M9 16 H39 V38 H9 Z', fond: A, trait: T, epaisseur: 2.4 },
    { d: 'M18 16 V11 H30 V16 M17 16 V38 M31 16 V38', trait: T, epaisseur: 2 },
  ],
  // Situation professionnelle (« arbeits-stand »)
  arret: [ // congé maladie : lit, repos
    { d: 'M6 14 V40 M42 30 V40 M6 30 H42', trait: T, epaisseur: 2.6 },
    { d: 'M10 28 V23 Q10 20 13 20 H17 Q20 20 20 23 V28 Z', fond: F, trait: T, epaisseur: 2 },
    { d: 'M22 30 V24 Q22 22 24 22 H38 Q42 22 42 26 V30 Z', fond: A, trait: T, epaisseur: 2 },
    { d: 'M28 6 H35 L28 13 H35', trait: T, epaisseur: 2 },
  ],
  vacances: [ // congé : parasol
    { d: 'M5 22 Q24 2 43 22 Q38 18 33.5 22 Q29 18 24 22 Q19 18 14.5 22 Q10 18 5 22 Z', fond: O, trait: T, epaisseur: 2.2 },
    { d: 'M24 12 V41', trait: T, epaisseur: 2.6 },
    { d: 'M6 42 Q15 38 24 42 Q33 46 42 42', trait: '#C9A15A', epaisseur: 2.4 },
  ],
  reprise: [ // reprise progressive : marches et flèche montante
    { d: 'M6 41 H18 V32 H28 V23 H41 V41 Z', fond: F, trait: T, epaisseur: 2.2 },
    { d: 'M8 25 L21 12 M13 12 H21 V20', trait: V, epaisseur: 2.8 },
  ],
  weekend: [ // week-end, jour férié : calendrier
    { d: 'M7 12 H41 V41 H7 Z', fond: '#FFFFFF', trait: T, epaisseur: 2.4 },
    { d: 'M7 12 H41 V19 H7 Z', fond: R, trait: T, epaisseur: 2.4 },
    { d: 'M15 8 V15 M33 8 V15', trait: T, epaisseur: 2.6 },
    { d: 'M12 24 H17 V29 H12 Z M21.5 24 H26.5 V29 H21.5 Z M12 32 H17 V37 H12 Z M21.5 32 H26.5 V37 H21.5 Z', fond: F, trait: T, epaisseur: 1.2 },
    { d: 'M31 24 H36 V29 H31 Z M31 32 H36 V37 H31 Z', fond: O, trait: T, epaisseur: 1.2 },
  ],
  teletravail: [ // télétravail : ordinateur portable
    { d: 'M11 11 H37 V31 H11 Z', fond: A, trait: T, epaisseur: 2.4 },
    { d: 'M5 35 H43 L40 39 H8 Z', fond: F, trait: T, epaisseur: 2.2 },
  ],
  bureau: [ // sur site : immeuble de bureaux
    { d: 'M10 41 V8 H30 V41 Z', fond: F, trait: T, epaisseur: 2.4 },
    { d: 'M30 18 H39 V41 H30', fond: F, trait: T, epaisseur: 2.2 },
    { d: 'M15 13 H19 V17 H15 Z M22 13 H26 V17 H22 Z M15 21 H19 V25 H15 Z M22 21 H26 V25 H22 Z M15 29 H19 V33 H15 Z M22 29 H26 V33 H22 Z', fond: A },
    { d: 'M5 41 H43', trait: T, epaisseur: 2.4 },
  ],
};

/** Formes d'un symbole : [{ d, fond?, trait?, epaisseur? }] (vide si inconnu). */
export function formesSymbole(id) { return FORMES[id] || []; }

/** Symbole en SVG pour l'application. */
export function iconeSymbole(id, { taille = 18, titre = '', classe = 'icone-symbole' } = {}) {
  const formes = formesSymbole(id);
  if (!formes.length) return '';
  const contenu = formes.map((f) => `<path d="${f.d}" fill="${f.fond || 'none'}"${f.trait ? ` stroke="${f.trait}" stroke-width="${f.epaisseur || 1}" stroke-linecap="round" stroke-linejoin="round"` : ''}/>`).join('');
  return `<svg class="${classe}" viewBox="0 0 48 48" width="${taille}" height="${taille}" ${titre ? `role="img" aria-label="${titre.replace(/"/g, '&quot;')}"` : 'aria-hidden="true"'} focusable="false"><title>${titre.replace(/</g, '&lt;')}</title>${contenu}</svg>`;
}
