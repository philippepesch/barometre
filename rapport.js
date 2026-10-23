// Génération du rapport PDF (A4) à partir des données réelles de la base locale.
// Utilise pdf-lib (licence MIT), embarqué localement : aucune donnée ne quitte l'appareil.
import * as C from './core.js';
import { formesMeteo } from './meteo.js';
import * as K from './carte.js';

export const COULEURS_NIVEAUX = [
  '#3E4660', '#4A5470', '#57627C', '#687384', '#828A90', '#9A9C94',
  '#8FAAB8', '#77A3C2', '#5E97C6', '#C9A24E', '#D49A2E',
];

const A4 = [595.28, 841.89];
const MARGE = 56;
const LARGEUR = A4[0] - 2 * MARGE;
const HAUT_CONTENU = 64;
const BAS_CONTENU = A4[1] - 60;

// Couleurs catégorielles (lieux, situations) : palette validée pour la vision des couleurs
export const COULEURS_CATEGORIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const COULEUR_AUTRE = '#9AA5AD';

/**
 * Style visuel du rapport (« Tableau de bord ») : bande latérale, titres en bandeau, cadres avec ombre.
 * Le moteur garde des variantes de mise en page (titres, cadres, barres, couverture, décor) paramétrées par le style.
 */
export const THEMES_RAPPORT = C.THEMES_RAPPORT;
export const themeRapport = C.themeRapport;

// Tableaux et graphiques « comme dans Excel » : fond gris clair et quadrillage
const FOND_GRILLE = '#F2F4F7', TRAIT_GRILLE = '#C9D1DA';
let SUR_ACCENT, ENCRE, DOUX, FILET, LAITON, FOND, TETE, BARRE_FAV, BARRE_DEF, CADRE, RAYON, ENTETE, GRILLE, AXE, FOND_PAGE, STYLE_CADRE, STYLE_BARRE, COUVERTURE, DECO;
function appliquerTheme(t) {
  ({ encre: ENCRE, doux: DOUX, filet: FILET, accent: LAITON, fond: FOND, tete: TETE, fav: BARRE_FAV, def: BARRE_DEF, trait: CADRE, rayon: RAYON, grille: GRILLE, axe: AXE } = t);
  ENTETE = t.entete || 'pastille';
  SUR_ACCENT = t.surAccent || '#FFFFFF';
  FOND_PAGE = t.fondPage || null;
  STYLE_CADRE = t.cadre || 'bord';
  STYLE_BARRE = t.barre || 'pleine';
  COUVERTURE = t.couverture || 'classique';
  DECO = t.deco || 'aucune';
}
appliquerTheme(THEMES_RAPPORT[0]);
// Événements marquants : couleur selon l'impact déclaré (sans impact : laiton)
const COULEUR_IMPACT = { positif: '#2F6E9E', negatif: '#8A3B4A' };

// Caractères disponibles dans l'encodage WinAnsi des polices standard PDF
const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const REMPLACEMENTS = { ' ': ' ', ' ': ' ', '−': '-', '→': '->', '←': '<-', '≤': '<=', '≥': '>=', '…': '…', '‐': '-', '‑': '-', '­': '' };

export function texteWinAnsi(s) {
  let r = '';
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if (REMPLACEMENTS[ch] !== undefined) r += REMPLACEMENTS[ch];
    else if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.includes(ch)) r += ch;
    else if (ch === '\t') r += '    ';
    else if (ch === '\n' || ch === '\r') r += ch;
    else {
      const sansAccent = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      r += /^[\x20-\x7e]+$/.test(sansAccent) ? sansAccent : '?';
    }
  }
  return r;
}

export function nomFichierRapport(debut, fin, type) {
  return `Barometre-humeur_rapport-${type === 'synthetique' ? 'synthetique' : 'complet'}_${debut}_au_${fin}.pdf`;
}

function hexRgb(PDFLib, hex) {
  const n = parseInt(hex.slice(1), 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

class Redacteur {
  constructor(PDFLib, doc, polices, entete) {
    Object.assign(this, { PDFLib, doc, polices, entete });
    this.pages = [];
    this.sommaire = [];
    this.nouvellePage();
  }

  couleur(hex) { return hexRgb(this.PDFLib, hex); }

  /** Pictogramme météo d'un niveau, coin haut-gauche (x, yHaut), côté « taille » en points. */
  meteo(note, x, yHaut, taille) {
    const k = taille / 48;
    for (const f of formesMeteo(note)) {
      this.page.drawSvgPath(f.d, {
        x, y: A4[1] - yHaut, scale: k,
        ...(f.fond ? { color: this.couleur(f.fond) } : {}),
        ...(f.trait ? { borderColor: this.couleur(f.trait), borderWidth: (f.epaisseur || 1) * k, borderLineCap: this.PDFLib.LineCapStyle.Round } : {}),
      });
    }
  }

  /** Rectangle aux coins arrondis (yHaut = bord supérieur). */
  cheminCadre(x, yHaut, l, h, rayon) {
    const r = Math.max(0, Math.min(rayon, l / 2, h / 2));
    if (!r) return `M${x} ${yHaut} H${x + l} V${yHaut + h} H${x} Z`;
    return `M${x + r} ${yHaut} H${x + l - r} A${r} ${r} 0 0 1 ${x + l} ${yHaut + r} V${yHaut + h - r} A${r} ${r} 0 0 1 ${x + l - r} ${yHaut + h} `
      + `H${x + r} A${r} ${r} 0 0 1 ${x} ${yHaut + h - r} V${yHaut + r} A${r} ${r} 0 0 1 ${x + r} ${yHaut} Z`;
  }

  cadre(x, yHaut, l, h, { fond = null, bord = null, epaisseur = 0.6, rayon = 5 } = {}) {
    const d = this.cheminCadre(x, yHaut, l, h, rayon);
    this.page.drawSvgPath(d, { x: 0, y: A4[1], ...(fond ? { color: this.couleur(fond) } : {}), ...(bord ? { borderColor: this.couleur(bord), borderWidth: epaisseur } : {}) });
  }

  /**
   * Texte composé de segments [texte, police] (par ex. une étiquette en gras suivie de sa valeur),
   * avec retour à la ligne automatique.
   */
  riche(segments, { taille = 9.5, couleur = ENCRE, retrait = 0, interligne = 1.42, apres = 3, largeur = LARGEUR } = {}) {
    const mots = [];
    for (const [t, police = 'normal', coul = couleur] of segments) {
      if (!t) continue;
      const parts = texteWinAnsi(t).split(/( +)/);
      for (const p of parts) {
        if (!p) continue;
        if (/^ +$/.test(p)) { mots.push({ espace: true, police }); continue; }
        mots.push({ t: p, police, coul });
      }
    }
    const lignes = [[]];
    let x = 0;
    const max = largeur - retrait;
    let espaceEnAttente = null;
    for (const m of mots) {
      if (m.espace) { espaceEnAttente = m; continue; }
      const lm = this.largeur(m.t, taille, m.police);
      const le = espaceEnAttente && lignes[lignes.length - 1].length ? this.largeur(' ', taille, espaceEnAttente.police) : 0;
      if (x + le + lm > max && lignes[lignes.length - 1].length) { lignes.push([]); x = 0; } else x += le;
      lignes[lignes.length - 1].push({ ...m, x });
      x += lm;
      espaceEnAttente = null;
    }
    const h = taille * interligne;
    for (const ligne of lignes) {
      this.place(h);
      for (const m of ligne) this.texte(m.t, MARGE + retrait + m.x, this.y + taille, { taille, police: m.police, couleur: m.coul });
      this.y += h;
    }
    this.y += apres;
  }

  nouvellePage() {
    this.page = this.doc.addPage(A4);
    this.pages.push(this.page);
    this.y = HAUT_CONTENU;
    this.decorerPage();
  }

  /** Fond et décoration de page propres au style visuel (dessinés avant tout contenu). */
  decorerPage() {
    const p = this.page;
    if (FOND_PAGE) p.drawRectangle({ x: 0, y: 0, width: A4[0], height: A4[1], color: this.couleur(FOND_PAGE) });
    if (DECO === 'points' || DECO === 'etoiles') {
      // Trame de points (carnet) ou petites étoiles irrégulières (nuit)
      const pas = DECO === 'points' ? 14 : 23;
      let graine = 7;
      const alea = () => { graine = (graine * 9301 + 49297) % 233280; return graine / 233280; };
      for (let x = 18; x < A4[0] - 10; x += pas) {
        for (let y = 18; y < A4[1] - 10; y += pas) {
          if (DECO === 'points') p.drawCircle({ x, y, size: 0.55, color: this.couleur(GRILLE) });
          else if (alea() < 0.22) p.drawCircle({ x: x + alea() * pas, y: y + alea() * pas, size: 0.3 + alea() * 0.6, color: this.couleur('#C9D6E8'), opacity: 0.25 + alea() * 0.35 });
        }
      }
    }
    if (DECO === 'bande') p.drawRectangle({ x: 0, y: 0, width: 16, height: A4[1], color: this.couleur(LAITON) });
    if (DECO === 'cadrePage') {
      p.drawRectangle({ x: 22, y: 22, width: A4[0] - 44, height: A4[1] - 44, borderColor: this.couleur(CADRE), borderWidth: 0.9 });
      if (STYLE_CADRE === 'double') p.drawRectangle({ x: 26, y: 26, width: A4[0] - 52, height: A4[1] - 52, borderColor: this.couleur(CADRE), borderWidth: 0.4 });
    }
  }

  /** Barre d'un graphique, selon le style : pleine, arrondie, carrée, en contour ou fine (tige + pastille). */
  barre(x, yHaut, l, h, couleur, { vertical = false } = {}) {
    if (STYLE_BARRE === 'fine') {
      const c = this.couleur(couleur);
      if (vertical) {
        this.page.drawLine({ start: { x: x + l / 2, y: A4[1] - yHaut - h }, end: { x: x + l / 2, y: A4[1] - yHaut - 3 }, thickness: 2, color: c });
        this.page.drawCircle({ x: x + l / 2, y: A4[1] - yHaut - 3, size: 4, color: c });
      } else {
        this.page.drawLine({ start: { x, y: A4[1] - yHaut - h / 2 }, end: { x: x + l - 3, y: A4[1] - yHaut - h / 2 }, thickness: 2, color: c });
        this.page.drawCircle({ x: x + l - 3, y: A4[1] - yHaut - h / 2, size: 4, color: c });
      }
      return;
    }
    if (STYLE_BARRE === 'contour') { this.cadre(x, yHaut, l, h, { fond: FOND, bord: couleur, epaisseur: 1.3, rayon: 0 }); return; }
    const rayon = STYLE_BARRE === 'arrondie' ? Math.min(l, h) / 2 : STYLE_BARRE === 'carree' ? 0 : 2;
    this.cadre(x, yHaut, l, h, { fond: couleur, rayon });
  }

  place(h) {
    if (this.mesure || this.garde || this.y + h <= BAS_CONTENU) return false;
    const c = this.enCadre;
    // Dans un cadre : rien encore dessiné → le cadre commence sur la page suivante ; sinon il se poursuit
    const vide = c && c.page === this.page && this.y <= c.yDebut + 0.01;
    if (c && !vide) c.segments.push({ page: c.page, y0: c.y0, y1: Math.min(this.y + 4, BAS_CONTENU + 8), suite: true });
    this.nouvellePage();
    if (c) {
      c.page = this.page;
      if (vide) { c.y0 = this.y; this.y += 12; c.yDebut = this.y; } else c.y0 = HAUT_CONTENU - 8;
    }
    return true;
  }

  /**
   * Hauteur exacte qu'occupera « dessin » : il est exécuté à blanc (aucun tracé, aucun saut de page).
   * Sert à garder un titre avec son premier graphique et à remplir les pages sans trou.
   */
  async mesurer(dessin) {
    const sauve = { page: this.page, y: this.y, enCadre: this.enCadre, mesure: this.mesure };
    const rien = () => {};
    this.page = { drawRectangle: rien, drawLine: rien, drawText: rien, drawSvgPath: rien, drawCircle: rien, drawImage: rien, node: { addAnnot: rien } };
    this.mesure = true; this.enCadre = null; this.y = 0;
    try { await dessin(); return this.y; } finally { Object.assign(this, sauve); }
  }

  /**
   * Blocs d'un même chapitre placés sans laisser de trou : quand le bloc suivant ne tient plus sur la page,
   * un bloc plus petit du même chapitre qui y tient est placé avant lui ; sinon on passe à la page suivante.
   */
  async flux(blocs) {
    const reste = [];
    for (const b of blocs) reste.push({ ...b, h: await this.mesurer(b.dessin) });
    // Sur chaque page : la combinaison de blocs qui la remplit le mieux, dans l'ordre d'origine
    const meilleurs = (libre) => {
      let choix = [], total = -1;
      const n = Math.min(reste.length, 12);
      for (let m = 1; m < 1 << n; m++) {
        let t = 0;
        for (let k = 0; k < n; k++) if (m & (1 << k)) t += reste[k].h;
        if (t <= libre && t > total + 0.5) { total = t; choix = reste.filter((_, k) => m & (1 << k)); }
      }
      return choix;
    };
    while (reste.length) {
      let choix = meilleurs(BAS_CONTENU - this.y);
      if (!choix.length) {
        if (this.y > HAUT_CONTENU + 1) { this.nouvellePage(); choix = meilleurs(BAS_CONTENU - this.y); }
        if (!choix.length) choix = [reste[0]]; // plus grand qu'une page : il se poursuit sur la suivante
      }
      for (const b of choix) { reste.splice(reste.indexOf(b), 1); await b.dessin(); }
    }
  }

  /**
   * Graphique encadré : rectangle à coins arrondis autour de ce que dessine « dessin » (synchrone ou non).
   * « besoin » : hauteur à réserver pour que le cadre ne commence pas en bas de page.
   */
  /** Cadre d'un graphique selon le style (dessiné après le contenu : jamais de remplissage par-dessus). */
  dessinerCadre(x, y, l, h) {
    const P = (px, py) => ({ x: px, y: A4[1] - py });
    const ligne = (a, b, ep = 0.9, coul = CADRE, tirets) => this.page.drawLine({ start: P(...a), end: P(...b), thickness: ep, color: this.couleur(coul), ...(tirets ? { dashArray: tirets } : {}) });
    switch (STYLE_CADRE) {
      case 'aucun':
        ligne([x, y], [x + l, y], 0.6); break;
      case 'filets':
        ligne([x, y], [x + l, y], 1.6); ligne([x, y + 3], [x + l, y + 3], 0.5);
        ligne([x, y + h - 3], [x + l, y + h - 3], 0.5); ligne([x, y + h], [x + l, y + h], 1.6); break;
      case 'pointille':
        this.page.drawSvgPath(this.cheminCadre(x, y, l, h, RAYON), { x: 0, y: A4[1], borderColor: this.couleur(CADRE), borderWidth: 1, borderDashArray: [3, 2.5] }); break;
      case 'gauche':
        this.page.drawRectangle({ x, y: A4[1] - y - h, width: 4, height: h, color: this.couleur(LAITON) });
        ligne([x + 4, y + h], [x + l, y + h], 0.5, FILET); break;
      case 'ombre':
        this.page.drawRectangle({ x: x + 3, y: A4[1] - y - h - 3, width: l, height: 3, color: this.couleur(CADRE) });
        this.page.drawRectangle({ x: x + l, y: A4[1] - y - h - 3, width: 3, height: h, color: this.couleur(CADRE) });
        this.cadre(x, y, l, h, { bord: CADRE, epaisseur: 0.8, rayon: RAYON }); break;
      case 'double':
        this.cadre(x, y, l, h, { bord: CADRE, epaisseur: 1.4, rayon: RAYON });
        this.cadre(x + 3, y + 3, l - 6, h - 6, { bord: CADRE, epaisseur: 0.5, rayon: RAYON }); break;
      default:
        this.cadre(x, y, l, h, { bord: CADRE, epaisseur: 0.9, rayon: RAYON });
    }
  }

  encadre(besoin, dessin) {
    // Hauteur exacte quand le dessin est synchrone (mesure à blanc), sinon l'estimation fournie
    let exact = false;
    if (!this.mesure && dessin.constructor.name !== 'AsyncFunction') {
      exact = true;
      const sauve = { page: this.page, y: this.y, enCadre: this.enCadre };
      const rien = () => {};
      this.page = { drawRectangle: rien, drawLine: rien, drawText: rien, drawSvgPath: rien, drawCircle: rien, drawImage: rien, node: { addAnnot: rien } };
      this.mesure = true; this.enCadre = null; this.y = 0;
      try { dessin(); besoin = this.y + 4; } finally { Object.assign(this, sauve); this.mesure = false; }
    }
    this.place(Math.min(besoin, BAS_CONTENU - HAUT_CONTENU - 30) + 24);
    // Hauteur exacte connue et le cadre tient sur la page : aucun saut de page à l'intérieur (pas de trou)
    const garde = this.garde;
    if (exact && this.y + besoin + 24 <= BAS_CONTENU) this.garde = true;
    this.enCadre = { page: this.page, y0: this.y, yDebut: this.y + 12, segments: [] };
    this.y += 12;
    const fin = () => {
      this.garde = garde;
      const c = this.enCadre;
      this.enCadre = null;
      this.y += 4;
      c.segments.push({ page: this.page, y0: c.y0, y1: this.y });
      const courante = this.page;
      for (const sg of c.segments) {
        this.page = sg.page;
        this.dessinerCadre(MARGE - 12, sg.y0, LARGEUR + 24, sg.y1 - sg.y0);
      }
      this.page = courante;
      this.y += 12;
    };
    const r = dessin();
    if (r && typeof r.then === 'function') return r.then(fin);
    fin();
    return null;
  }

  texte(t, x, y, { taille = 10, police = 'normal', couleur = ENCRE } = {}) {
    this.page.drawText(texteWinAnsi(t), { x, y: A4[1] - y, size: taille, font: this.polices[police], color: this.couleur(couleur) });
  }

  largeur(t, taille, police = 'normal') { return this.polices[police].widthOfTextAtSize(texteWinAnsi(t), taille); }

  couper(t, taille, police, largeurMax) {
    const lignes = [];
    for (const paragraphe of texteWinAnsi(t).split(/\r?\n/)) {
      const mots = paragraphe.split(/ +/);
      let cour = '';
      for (const mot of mots) {
        const essai = cour ? `${cour} ${mot}` : mot;
        if (this.largeur(essai, taille, police) <= largeurMax) { cour = essai; continue; }
        if (cour) lignes.push(cour);
        if (this.largeur(mot, taille, police) > largeurMax) {
          let morceau = '';
          for (const ch of mot) {
            if (this.largeur(morceau + ch, taille, police) > largeurMax) { lignes.push(morceau); morceau = ''; }
            morceau += ch;
          }
          cour = morceau;
        } else cour = mot;
      }
      lignes.push(cour);
    }
    return lignes;
  }

  paragraphe(t, { taille = 10, police = 'normal', couleur = ENCRE, retrait = 0, interligne = 1.42, apres = 6, largeur = LARGEUR } = {}) {
    const h = taille * interligne;
    for (const ligne of this.couper(t, taille, police, largeur - retrait)) {
      this.place(h);
      this.texte(ligne, MARGE + retrait, this.y + taille, { taille, police, couleur });
      this.y += h;
    }
    this.y += apres;
  }

  puces(items, opts = {}) {
    const taille = opts.taille || 10;
    for (const it of items) {
      const h = taille * 1.42;
      const lignes = this.couper(it, taille, 'normal', LARGEUR - 14);
      lignes.forEach((l, i) => {
        this.place(h);
        if (i === 0) this.page.drawCircle({ x: MARGE + 3, y: A4[1] - (this.y + taille * 0.68), size: 1.6, color: this.couleur(LAITON) });
        this.texte(l, MARGE + 14, this.y + taille, { taille });
        this.y += h;
      });
      this.y += 3;
    }
    this.y += 4;
  }

  /** Un événement marquant : pastille numérotée, moment et titre, puis faits et vécu séparés. */
  evenement(numero, x) {
    const R0 = 26;
    this.place(70);
    const num = String(numero);
    this.page.drawCircle({ x: MARGE + 9, y: A4[1] - (this.y + 7.5), size: 9, color: this.couleur(COULEUR_IMPACT[x.impact] || LAITON) });
    this.texte(num, MARGE + 9 - this.largeur(num, 9, 'gras') / 2, this.y + 10.7, { taille: 9, police: 'gras', couleur: '#FFFFFF' });
    this.riche([[C.majuscule(C.libelleMomentEvenement(x)), 'gras'], ...(x.titre ? [[` – ${x.titre}`, 'gras']] : []), ...(C.IMPACTS[x.impact] ? [[`  ·  ${C.IMPACTS[x.impact].toLowerCase()}`, 'gras', COULEUR_IMPACT[x.impact]]] : [])], { taille: 10.5, retrait: R0, apres: 3 });
    const bloc = (etiquette, texte, couleur) => {
      if (!texte) return;
      this.place(30);
      this.texte(etiquette.toUpperCase(), MARGE + R0, this.y + 7.5, { taille: 7.2, police: 'gras', couleur: DOUX });
      this.y += 11;
      for (const para of texte.split(/\n+/).map((t) => t.trim()).filter(Boolean)) this.paragraphe(para, { taille: 9.6, retrait: R0, couleur, apres: 3 });
      this.y += 2;
    };
    bloc('Ce qui s\'est passé', x.faits, ENCRE);
    bloc('Vécu du patient', x.vecu, DOUX);
    this.place(8);
    this.page.drawLine({ start: { x: MARGE + R0, y: A4[1] - this.y - 2 }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y - 2 }, thickness: 0.5, color: this.couleur(FILET) });
    this.y += 12;
  }

  /** Titre de partie (I à V) : grand titre de couleur, filet épais ; repris en gras au sommaire. */
  partie(chiffre, titre, { nouvellePage = false, besoin = 160 } = {}) {
    if (nouvellePage) { if (this.y > HAUT_CONTENU + 1) this.nouvellePage(); } else if (!this.place(besoin + 64)) this.y += 14;
    const y = this.y;
    this.texte(`PARTIE ${chiffre}`, MARGE, y + 10, { taille: 9, police: 'gras', couleur: LAITON });
    this.texte(titre, MARGE, y + 34, { taille: 21, police: 'gras', couleur: ENCRE });
    this.page.drawRectangle({ x: MARGE, y: A4[1] - y - 46, width: LARGEUR, height: 2.4, color: this.couleur(LAITON) });
    this.sommaire.push({ partie: chiffre, titre, page: this.pages.length - 1, y });
    this.y += 58;
  }

  section(numero, titre, besoin = 90, { nouvellePage = false } = {}) {
    if (nouvellePage && this.y > HAUT_CONTENU + 1) this.nouvellePage();
    else if (!this.place(56 + besoin)) this.y += 16;
    const num = String(numero);
    const titreAff = ENTETE === 'centre' || ENTETE === 'crochets' ? titre.toUpperCase() : titre;
    if (ENTETE === 'marge') {
      // Grand numéro en couleur dans la marge, titre en gras, trait court de couleur
      const n2 = num.padStart(2, '0');
      this.texte(n2, MARGE - 4, this.y + 24, { taille: 30, police: 'gras', couleur: LAITON });
      const xt = MARGE + this.largeur(n2, 30, 'gras') + 6;
      this.texte(titre, xt, this.y + 21, { taille: 15.5, police: 'gras' });
      this.page.drawRectangle({ x: xt, y: A4[1] - this.y - 30, width: 46, height: 3, color: this.couleur(LAITON) });
    } else if (ENTETE === 'centre') {
      // Petit numéro, titre centré en capitales entre deux doubles filets (journal)
      const n = `— ${num} —`;
      this.texte(n, MARGE + LARGEUR / 2 - this.largeur(n, 8, 'gras') / 2, this.y + 6, { taille: 8, police: 'gras', couleur: DOUX });
      const lt = this.largeur(titreAff, 13, 'gras');
      this.texte(titreAff, MARGE + LARGEUR / 2 - lt / 2, this.y + 21, { taille: 13, police: 'gras' });
      for (const [yy, ep] of [[26.5, 1.4], [29, 0.4]]) this.page.drawLine({ start: { x: MARGE, y: A4[1] - this.y - yy }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y - yy }, thickness: ep, color: this.couleur(ENCRE) });
    } else if (ENTETE === 'crochets') {
      // Machine à écrire : [04] TITRE, souligné en pointillés
      this.texte(`[${num.padStart(2, '0')}]`, MARGE, this.y + 16, { taille: 13, police: 'gras', couleur: LAITON });
      this.texte(titreAff, MARGE + this.largeur('[00]', 13, 'gras') + 10, this.y + 16, { taille: 12.5, police: 'gras' });
      this.page.drawLine({ start: { x: MARGE, y: A4[1] - this.y - 27 }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y - 27 }, thickness: 1, color: this.couleur(ENCRE), dashArray: [4, 3] });
    } else if (ENTETE === 'onglet') {
      // Onglet de couleur avec le numéro, titre en couleur, trait fin
      const wl = this.largeur(num, 12, 'gras') + 20;
      this.cadre(MARGE - 6, this.y - 1, wl, 24, { fond: LAITON, rayon: 6 });
      this.texte(num, MARGE - 6 + wl / 2 - this.largeur(num, 12, 'gras') / 2, this.y + 15.5, { taille: 12, police: 'gras', couleur: SUR_ACCENT });
      this.texte(titre, MARGE + wl + 4, this.y + 16, { taille: 14.5, police: 'gras', couleur: LAITON });
      this.page.drawLine({ start: { x: MARGE + wl + 4, y: A4[1] - this.y - 27 }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y - 27 }, thickness: 0.8, color: this.couleur(LAITON), dashArray: [1, 2.5] });
    } else if (ENTETE === 'cercle') {
      this.page.drawCircle({ x: MARGE + 12, y: A4[1] - this.y - 11, size: 12, color: this.couleur(LAITON) });
      this.texte(num, MARGE + 12 - this.largeur(num, 11, 'gras') / 2, this.y + 15, { taille: 11, police: 'gras', couleur: SUR_ACCENT });
      this.texte(titre, MARGE + 32, this.y + 16, { taille: 14.5, police: 'gras', couleur: LAITON });
      this.page.drawLine({ start: { x: MARGE + 32, y: A4[1] - this.y - 29 }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y - 29 }, thickness: 2, color: this.couleur(FILET) });
    } else if (ENTETE === 'bandeau') {
      // Bandeau plein de la couleur du style, titre en blanc
      this.cadre(MARGE, this.y - 2, LARGEUR, 28, { fond: LAITON, rayon: Math.min(RAYON, 9) * 0.6 });
      this.texte(num, MARGE + 12, this.y + 16.5, { taille: 12, police: 'gras', couleur: SUR_ACCENT });
      this.page.drawLine({ start: { x: MARGE + 30, y: A4[1] - this.y - 4 }, end: { x: MARGE + 30, y: A4[1] - this.y - 20 }, thickness: 0.8, color: this.couleur(SUR_ACCENT), opacity: 0.6 });
      this.texte(titre, MARGE + 40, this.y + 16.5, { taille: 13.5, police: 'gras', couleur: SUR_ACCENT });
    } else if (ENTETE === 'ligne') {
      // Numéro et titre dans la couleur du style, épais trait dessous
      this.texte(num.padStart(2, '0'), MARGE, this.y + 17, { taille: 17, police: 'gras', couleur: LAITON });
      this.texte(titre, MARGE + 34, this.y + 16, { taille: 15, police: 'gras', couleur: LAITON });
      this.page.drawLine({ start: { x: MARGE, y: A4[1] - this.y - 28 }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y - 28 }, thickness: 1.8, color: this.couleur(LAITON) });
    } else {
      this.cadre(MARGE, this.y, 22, 22, { fond: LAITON, rayon: Math.min(RAYON, 11) * 0.45 });
      this.texte(num, MARGE + 11 - this.largeur(num, 11, 'gras') / 2, this.y + 15.2, { taille: 11, police: 'gras', couleur: SUR_ACCENT });
      this.texte(titre, MARGE + 32, this.y + 16, { taille: 14, police: 'gras' });
      this.page.drawLine({ start: { x: MARGE, y: A4[1] - this.y - 29 }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y - 29 }, thickness: 0.8, color: this.couleur(FILET) });
    }
    this.sommaire.push({ numero, titre, page: this.pages.length - 1, y: this.y });
    this.y += 40;
  }

  sousTitre(t, besoin = 0) {
    this.place(34 + besoin);
    this.y += 6;
    this.texte(t, MARGE, this.y + 10, { taille: 10.5, police: 'gras', couleur: LAITON });
    this.y += 18;
  }

  chiffres(cases) {
    const h = 56;
    this.place(h + 8);
    const l = (LARGEUR - (cases.length - 1) * 8) / cases.length;
    cases.forEach((c, i) => {
      const x = MARGE + i * (l + 8);
      this.cadre(x, this.y, l, h, { fond: FOND, rayon: Math.min(RAYON, 9) * 0.6 });
      let xt = x + 11;
      if (Number.isInteger(c.icone)) { this.meteo(c.icone, x + 9, this.y + 7, 24); xt = x + 39; }
      this.texte(c.valeur, xt, this.y + 27, { taille: 18, police: 'gras' });
      if (c.suffixe) this.texte(c.suffixe, xt + this.largeur(c.valeur, 18, 'gras') + 1.5, this.y + 27, { taille: 10, police: 'gras', couleur: DOUX });
      this.couper(c.libelle, 8.3, 'normal', l - 20).slice(0, 2).forEach((lg, k) => this.texte(lg, x + 11, this.y + 42 + k * 9.5, { taille: 8.3, couleur: DOUX }));
    });
    this.y += h + 12;
  }

  tableau(colonnes, lignes, { taille = 9 } = {}) {
    const total = colonnes.reduce((a, c) => a + c.part, 0);
    const largeurs = colonnes.map((c) => (c.part / total) * LARGEUR);
    const pad = 5;
    // Quadrillage complet (bordure, lignes et colonnes) sur fond gris clair, en-tête plus foncé
    const quadriller = (yH, h) => {
      const c = this.couleur(TRAIT_GRILLE);
      this.page.drawRectangle({ x: MARGE, y: A4[1] - yH - h, width: LARGEUR, height: h, borderColor: c, borderWidth: 0.6 });
      let x = MARGE;
      largeurs.slice(0, -1).forEach((l) => { x += l; this.page.drawLine({ start: { x, y: A4[1] - yH }, end: { x, y: A4[1] - yH - h }, thickness: 0.6, color: c }); });
    };
    const dessinerEntete = () => {
      const h = taille * 1.4 + 2 * pad;
      this.page.drawRectangle({ x: MARGE, y: A4[1] - this.y - h, width: LARGEUR, height: h, color: this.couleur(TETE) });
      let x = MARGE;
      colonnes.forEach((c, i) => { this.texte(c.titre, x + pad, this.y + pad + taille, { taille, police: 'gras' }); x += largeurs[i]; });
      quadriller(this.y, h);
      this.y += h;
    };
    this.place(taille * 1.4 * 3 + 4 * pad);
    dessinerEntete();
    for (const ligne of lignes) {
      const cellules = ligne.map((v, i) => this.couper(String(v ?? ''), taille, colonnes[i].gras ? 'gras' : 'normal', largeurs[i] - 2 * pad));
      const nb = Math.max(...cellules.map((c) => c.length));
      const h = nb * taille * 1.38 + 2 * pad;
      if (this.place(h)) dessinerEntete();
      this.page.drawRectangle({ x: MARGE, y: A4[1] - this.y - h, width: LARGEUR, height: h, color: this.couleur(FOND_GRILLE) });
      quadriller(this.y, h);
      let x = MARGE;
      cellules.forEach((c, i) => {
        c.forEach((l, k) => this.texte(l, x + pad, this.y + pad + taille + k * taille * 1.38, { taille, police: colonnes[i].gras ? 'gras' : 'normal', couleur: colonnes[i].doux ? DOUX : ENCRE }));
        x += largeurs[i];
      });
      this.y += h;
    }
    this.y += 10;
  }

  graphique(grille, previsions, contexte = null) {
    const dense = grille.length > 60;
    const hauteur = dense ? 250 : 232;
    const legende = 22;
    const avecBandes = !!contexte && grille.some((s) => s.evaluation && (s.evaluation.lieu || s.evaluation.situation));
    const hBandes = avecBandes ? 52 : 0;
    const marques = (contexte && contexte.evenements) || [];
    this.place(hauteur + legende + 40 + hBandes + (avecBandes ? 40 : 0) + (marques.length ? 18 + 25 : 0));
    // À gauche : note et pictogramme météo de chaque niveau ; à droite : nom du niveau
    const gauche = MARGE + 36, droite = MARGE + LARGEUR - 60;
    const haut = this.y + 6, bas = this.y + hauteur - 26;
    const n = grille.length;
    const xDe = (i) => (n <= 1 ? (gauche + droite) / 2 : gauche + 8 + (i * (droite - gauche - 16)) / (n - 1));
    const yDe = (note) => bas - (note / 10) * (bas - haut);
    const P = (x, y) => ({ x, y: A4[1] - y });
    // Zone de tracé sur fond gris clair, quadrillée (lignes des notes et une colonne par jour)
    this.page.drawRectangle({ x: gauche, y: A4[1] - bas, width: droite - gauche, height: bas - haut, color: this.couleur(FOND_GRILLE), borderColor: this.couleur(TRAIT_GRILLE), borderWidth: 0.6 });
    {
      const joursG = [...new Set(grille.map((s) => s.date))];
      const pasJ = Math.max(1, Math.ceil(joursG.length / 31));
      joursG.forEach((d, k) => {
        if (k === 0 || k % pasJ) return;
        const i = grille.findIndex((s) => s.date === d);
        const x = (xDe(i) + xDe(Math.max(0, i - 1))) / 2;
        this.page.drawLine({ start: P(x, haut), end: P(x, bas), thickness: 0.4, color: this.couleur(TRAIT_GRILLE) });
      });
    }
    for (let v = 0; v <= 10; v++) {
      this.page.drawLine({ start: P(gauche, yDe(v)), end: P(droite, yDe(v)), thickness: v === 0 ? 0.7 : 0.4, color: this.couleur(v === 0 ? AXE : TRAIT_GRILLE), opacity: v === 0 || v % 2 === 0 ? 1 : 0.6 });
      const lib = String(v);
      this.texte(lib, gauche - 21 - this.largeur(lib, 7.5, 'gras'), yDe(v) + 2.7, { taille: 7.5, police: 'gras', couleur: DOUX });
      this.meteo(v, gauche - 17, yDe(v) - 6.5, 13);
      this.texte(C.NIVEAUX[v], droite + 7, yDe(v) + 2.5, { taille: 6.8, couleur: DOUX });
    }
    // Étiquettes de dates (au plus ~10)
    const jours = [...new Set(grille.map((s) => s.date))];
    const pas = Math.max(1, Math.ceil(jours.length / 10));
    jours.forEach((d, k) => {
      if (k % pas !== 0) return;
      const i = grille.findIndex((s) => s.date === d);
      const xm = n <= 2 ? xDe(i) : (xDe(i) + xDe(Math.min(i + 1, n - 1))) / 2;
      const lib = C.formatDateCourte(d).slice(0, 5);
      this.page.drawLine({ start: P(xDe(i), bas), end: P(xDe(i), bas + 3), thickness: 0.5, color: this.couleur(AXE) });
      this.texte(lib, xm - this.largeur(lib, 8) / 2, bas + 14, { taille: 8, couleur: DOUX });
    });
    // Ligne reliant les notes de créneaux consécutifs
    for (let i = 1; i < n; i++) {
      const a = grille[i - 1].evaluation, b = grille[i].evaluation;
      if (a && b) this.page.drawLine({ start: P(xDe(i - 1), yDe(a.note)), end: P(xDe(i), yDe(b.note)), thickness: dense ? 0.8 : 1.4, color: this.couleur(ENCRE) });
    }
    // Prévisions (losanges creux à la position du créneau visé)
    const indexParId = new Map(grille.map((s, i) => [s.id, i]));
    for (const l of previsions.lignes) {
      const i = indexParId.get(C.idCreneau(l.cible.date, l.cible.creneau));
      if (i === undefined) continue;
      const x = xDe(i), y = yDe(l.prevue), r = dense ? 3 : 4.6;
      this.page.drawSvgPath(`M ${x} ${y - r} L ${x + r} ${y} L ${x} ${y + r} L ${x - r} ${y} Z`, { x: 0, y: A4[1], borderColor: this.couleur(LAITON), borderWidth: 1.1 });
    }
    // Points
    grille.forEach((s, i) => {
      const x = xDe(i);
      if (s.evaluation) {
        const y = yDe(s.evaluation.note), c = this.couleur(COULEURS_NIVEAUX[s.evaluation.note]);
        const t = dense ? 2.6 : 4.2;
        if (s.creneau === 'matin') this.page.drawCircle({ ...P(x, y), size: t, color: c, borderColor: this.couleur('#FFFFFF'), borderWidth: 0.6 });
        else this.page.drawRectangle({ x: x - t, y: A4[1] - y - t, width: 2 * t, height: 2 * t, color: c, borderColor: this.couleur('#FFFFFF'), borderWidth: 0.6 });
      } else if (s.statut === 'omis') {
        const y = bas - 8, r = 2.6, g = this.couleur(AXE);
        this.page.drawLine({ start: P(x - r, y - r), end: P(x + r, y + r), thickness: 0.9, color: g });
        this.page.drawLine({ start: P(x - r, y + r), end: P(x + r, y - r), thickness: 0.9, color: g });
      }
    });
    this.y = bas + 26;
    // Événements marquants : pastilles numérotées sous les dates, à la position du créneau concerné
    if (marques.length) {
      const parIndex = new Map();
      for (const m of marques) { const i = indexParId.get(m.creneauId); if (i === undefined) continue; parIndex.set(i, [...(parIndex.get(i) || []), m]); }
      const yM = this.y + 2;
      for (const [i, ms] of parIndex) {
        // Une pastille par événement, empilées sous le créneau, colorées selon l'impact
        const x = xDe(i);
        this.page.drawLine({ start: P(x, bas), end: P(x, yM), thickness: 0.5, color: this.couleur(LAITON), dashArray: [1.5, 1.5] });
        ms.forEach((m, k) => {
          const lib = String(m.numero);
          const w = Math.max(11, this.largeur(lib, 7, 'gras') + 6);
          const y = yM + k * 12.5;
          this.cadre(x - w / 2, y, w, 11, { fond: COULEUR_IMPACT[m.impact] || LAITON, rayon: 5.5 });
          this.texte(lib, x - this.largeur(lib, 7, 'gras') / 2, y + 8, { taille: 7, police: 'gras', couleur: '#FFFFFF' });
        });
      }
      const pile = Math.max(1, ...[...parIndex.values()].map((ms) => ms.length));
      this.y += (pile - 1) * 12.5;
      this.y += 18;
    }
    // Bandes « Lieu » et « Situation » : un segment par suite de créneaux identiques
    if (avecBandes) {
      const demi = n > 1 ? (xDe(1) - xDe(0)) / 2 : 6;
      const bande = (titre, y0, extraire, cle, couleur) => {
        this.texte(titre, gauche, y0 - 2, { taille: 7.5, police: 'gras', couleur: DOUX });
        // Plusieurs lieux dans un créneau : le segment est partagé en bandes, dans l'ordre
        const valeursDe = (s) => [].concat(extraire(s.evaluation) || []).filter(Boolean);
        const cleDe = (s, i) => {
          if (!s.evaluation) return null;
          const vs = valeursDe(s);
          return !vs.length ? '-' : vs.length > 1 ? `${i}#multi` : cle(vs[0]);
        };
        for (let i = 0; i < n;) {
          const k = cleDe(grille[i], i);
          if (k === null) { i++; continue; }
          let j = i;
          while (j + 1 < n && cleDe(grille[j + 1], j + 1) === k) j++;
          const x0 = Math.max(gauche, i === 0 ? xDe(0) - demi : (xDe(i - 1) + xDe(i)) / 2);
          const x1 = Math.min(droite, j === n - 1 ? xDe(n - 1) + demi : (xDe(j) + xDe(j + 1)) / 2);
          const vs = valeursDe(grille[i]);
          const w = Math.max(1, x1 - x0 - 1.4);
          if (vs.length > 1) {
            const l = w / vs.length;
            vs.forEach((v, q) => this.page.drawRectangle({ x: x0 + 0.7 + q * l, y: A4[1] - y0 - 9, width: Math.max(0.6, l - 0.5), height: 9, color: this.couleur(couleur(v)) }));
          } else if (vs.length) this.page.drawRectangle({ x: x0 + 0.7, y: A4[1] - y0 - 9, width: w, height: 9, color: this.couleur(couleur(vs[0])) });
          else this.page.drawRectangle({ x: x0 + 0.7, y: A4[1] - y0 - 9, width: w, height: 9, color: this.couleur(FOND), borderColor: this.couleur(FILET), borderWidth: 0.5 });
          i = j + 1;
        }
      };
      bande('Lieu', this.y + 6, C.lieuxDe, C.cleLieu, contexte.couleurLieu);
      bande('Situation professionnelle', this.y + 30, (e) => e.situation, C.cleSituation, contexte.couleurSituation);
      this.y += hBandes - 6;
    }
    // Légende
    let x = gauche;
    const yl = this.y + 6;
    const item = (dessin, lib) => { dessin(x + 4, yl); this.texte(lib, x + 12, yl + 3, { taille: 8.5, couleur: DOUX }); x += 22 + this.largeur(lib, 8.5); };
    item((cx, cy) => this.page.drawCircle({ ...P(cx, cy), size: 3.4, color: this.couleur(DOUX) }), 'Note du matin');
    item((cx, cy) => this.page.drawRectangle({ x: cx - 3.2, y: A4[1] - cy - 3.2, width: 6.4, height: 6.4, color: this.couleur(DOUX) }), 'Note du soir');
    item((cx, cy) => this.page.drawSvgPath(`M ${cx} ${cy - 4} L ${cx + 4} ${cy} L ${cx} ${cy + 4} L ${cx - 4} ${cy} Z`, { x: 0, y: A4[1], borderColor: this.couleur(LAITON), borderWidth: 1.1 }), 'Note prévue');
    item((cx, cy) => { const g = this.couleur(AXE); this.page.drawLine({ start: P(cx - 2.6, cy - 2.6), end: P(cx + 2.6, cy + 2.6), thickness: 0.9, color: g }); this.page.drawLine({ start: P(cx - 2.6, cy + 2.6), end: P(cx + 2.6, cy - 2.6), thickness: 0.9, color: g }); }, 'Créneau omis');
    this.y += legende;
    if (avecBandes) {
      for (const [titre, items] of [['Lieu', contexte.legendeLieux], ['Situation', contexte.legendeSituations]]) {
        if (!items.length) continue;
        let xl = gauche;
        const yl2 = () => this.y + 6;
        this.texte(`${titre} :`, xl, yl2() + 3, { taille: 8.5, police: 'gras', couleur: ENCRE });
        xl += this.largeur(`${titre} :`, 8.5, 'gras') + 8;
        for (const it of items) {
          const lw = 14 + this.largeur(it.libelle, 8.5) + 10;
          if (xl + lw > MARGE + LARGEUR) { this.y += 14; xl = gauche + 50; }
          const yy = yl2();
          if (it.couleur) this.page.drawRectangle({ x: xl, y: A4[1] - yy - 3.5, width: 8, height: 8, color: this.couleur(it.couleur) });
          else this.page.drawRectangle({ x: xl, y: A4[1] - yy - 3.5, width: 8, height: 8, color: this.couleur(FOND), borderColor: this.couleur(FILET), borderWidth: 0.5 });
          this.texte(it.libelle, xl + 12, yy + 3, { taille: 8.5, couleur: DOUX });
          xl += lw;
        }
        this.y += 16;
      }
    }
  }

  /** Sommaire en deux colonnes, dessiné à la fin (numéros de page connus), avec liens cliquables. */
  dessinerSommaire(page, yHaut, colonnes = 1) {
    const ici = this.page;
    this.page = page;
    const pas = 14;
    const parCol = Math.ceil(this.sommaire.length / colonnes);
    const lc = (LARGEUR - 20 - (colonnes - 1) * 18) / colonnes;
    this.sommaire.forEach((e, i) => {
      const col = Math.floor(i / parCol), lig = i % parCol;
      const x = MARGE + 10 + col * (lc + 18), y = yHaut + lig * pas;
      const pg = String(e.page + 1);
      let fin;
      if (e.partie) {
        // Partie : chiffre romain et titre en gras, de la couleur du style
        const t = `${e.partie}. ${e.titre}`;
        this.texte(t, x, y + 9, { taille: 9.3, police: 'gras', couleur: LAITON });
        fin = x + this.largeur(t, 9.3, 'gras') + 4;
      } else {
        const num = `${e.numero}`;
        this.texte(num, x + 24 - this.largeur(num, 9, 'gras'), y + 9, { taille: 9, police: 'gras', couleur: LAITON });
        const titre = this.couper(e.titre, 9, 'normal', lc - 62)[0] + (this.largeur(e.titre, 9) > lc - 62 ? '…' : '');
        this.texte(titre, x + 30, y + 9, { taille: 9 });
        fin = x + 30 + this.largeur(titre, 9) + 4;
      }
      const xp = x + lc - this.largeur(pg, 9, 'gras');
      if (xp - 4 > fin) page.drawLine({ start: { x: fin, y: A4[1] - y - 8.4 }, end: { x: xp - 4, y: A4[1] - y - 8.4 }, thickness: 0.7, color: this.couleur(DOUX), dashArray: [0.7, 2.3] });
      this.texte(pg, xp, y + 9, { taille: 9, police: 'gras' });
      try { // lien vers la section
        const ctx = this.doc.context;
        const cible = this.pages[e.page];
        const annot = ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x, A4[1] - y - 12, x + lc, A4[1] - y + 2], Border: [0, 0, 0], Dest: [cible.ref, 'XYZ', null, A4[1] - e.y + 12, null] });
        page.node.addAnnot(ctx.register(annot));
      } catch { /* liens facultatifs */ }
    });
    this.page = ici;
    return parCol * pas;
  }

  /**
   * Barres horizontales. lignes = [{ libelle, valeur, nombre, detail? }].
   * mode 'humeur' : valeur = moyenne sur 10, couleur du niveau, pictogramme ; la plus basse est signalée.
   * mode 'compte' : valeur = nombre, une seule couleur.
   */
  barres(lignes, { mode = 'humeur', couleur = BARRE_FAV, max = null, signalerBas = true } = {}) {
    if (!lignes.length) return;
    const hLigne = 21, hBarre = 11;
    const colLib = Math.min(175, Math.max(70, Math.max(...lignes.map((l) => this.largeur(l.libelle, 9, 'gras'))) + 10));
    const x0 = MARGE + colLib, x1 = MARGE + LARGEUR - 96;
    const vmax = mode === 'humeur' ? 10 : (max || Math.max(1, ...lignes.map((l) => l.valeur || 0)));
    // La moyenne la plus basse n'est signalée que si elle repose sur au moins 2 évaluations et s'écarte nettement (0,5 point)
    const avecValeur = lignes.filter((l) => l.valeur !== null && l.nombre >= 2);
    const vals = avecValeur.map((l) => l.valeur);
    const plusBas = mode === 'humeur' && signalerBas && avecValeur.length >= 2 && Math.max(...vals) - Math.min(...vals) >= 0.5
      ? avecValeur.reduce((a, b) => (b.valeur < a.valeur ? b : a)) : null;
    const hTotal = lignes.length * hLigne + 18;
    this.place(Math.min(hTotal, 200));
    // Graduations verticales, dessinées sous chaque barre
    const pasG = mode === 'humeur' ? 2 : Math.max(1, Math.ceil(vmax / 5));
    const graduer = (yA, yB) => {
      for (let v = 0; v <= vmax; v += pasG) {
        const x = x0 + (v / vmax) * (x1 - x0);
        this.page.drawLine({ start: { x, y: A4[1] - yA }, end: { x, y: A4[1] - yB }, thickness: v === 0 ? 0.6 : 0.4, color: this.couleur(v === 0 ? AXE : TRAIT_GRILLE) });
      }
    };
    for (const l of lignes) {
      this.place(hLigne + 14);
      // Fond gris clair et quadrillage de la zone des barres
      this.page.drawRectangle({ x: x0, y: A4[1] - this.y - hLigne, width: x1 - x0, height: hLigne, color: this.couleur(FOND_GRILLE), borderColor: this.couleur(TRAIT_GRILLE), borderWidth: 0.4 });
      graduer(this.y, this.y + hLigne);
      const yc = this.y + hLigne / 2;
      const bas = plusBas && l === plusBas;
      const lignesLib = this.couper(l.libelle, 9, bas ? 'gras' : 'normal', colLib - 8);
      const lib = lignesLib.length > 1 ? `${lignesLib[0].replace(/[\s,;:]+$/, '')}…` : lignesLib[0];
      this.texte(lib, MARGE, yc + 3.2, { taille: 9, police: bas ? 'gras' : 'normal' });
      if (l.valeur !== null && l.nombre > 0) {
        const w = Math.max(2, (l.valeur / vmax) * (x1 - x0));
        const coul = mode === 'humeur' ? COULEURS_NIVEAUX[Math.max(0, Math.min(10, Math.round(l.valeur)))] : couleur;
        this.barre(x0, yc - hBarre / 2, w, hBarre, coul);
        let xt = x0 + w + 5;
        if (mode === 'humeur') { this.meteo(Math.round(l.valeur), xt, yc - 7, 14); xt += 17; }
        const val = mode === 'humeur' ? C.nombreFr(l.valeur) : String(l.valeur);
        this.texte(val, xt, yc + 3.2, { taille: 9, police: 'gras' });
        const det = l.detail ?? (mode === 'humeur' ? `${C.pluriel(l.nombre, 'éval.', 'éval.')}` : '');
        if (det) this.texte(det, xt + this.largeur(val, 9, 'gras') + 4, yc + 3.2, { taille: 7.5, couleur: DOUX });
      } else this.texte('aucune évaluation', x0 + 4, yc + 3, { taille: 8, couleur: DOUX });
      this.y += hLigne;
    }
    // Échelle sous les barres
    for (let v = 0; v <= vmax; v += pasG) {
      const x = x0 + (v / vmax) * (x1 - x0), t = String(v);
      this.texte(t, x - this.largeur(t, 7) / 2, this.y + 9, { taille: 7, couleur: DOUX });
    }
    this.y += 14;
    if (plusBas) this.paragraphe(`En gras : ${plusBas.libelle}, la moyenne la plus basse (${C.nombreFr(plusBas.valeur)}/10${plusBas.nombre < 4 ? ', sur peu d\'évaluations' : ''}).`, { taille: 8.3, couleur: DOUX, apres: 4 });
    this.y += 4;
  }

  /**
   * Barres opposées par domaine : facteurs défavorables à gauche, favorables à droite (nombre d'évaluations).
   * lignes = [{ libelle, favorable, defavorable }]
   */
  barresDomaines(lignes, { total = 0 } = {}) {
    const hLigne = 26, hBarre = 12;
    const colLib = 108;
    const x0 = MARGE + colLib, x1 = MARGE + LARGEUR;
    const centre = (x0 + x1) / 2, demi = (x1 - x0) / 2 - 34;
    const max = Math.max(1, ...lignes.flatMap((l) => [l.favorable, l.defavorable]));
    this.place(lignes.length * hLigne + 40);
    const DEF = BARRE_DEF, FAV = BARRE_FAV;
    this.texte('Défavorable', centre - 8 - this.largeur('Défavorable', 8.5, 'gras'), this.y + 9, { taille: 8.5, police: 'gras', couleur: DEF });
    this.texte('Favorable', centre + 8, this.y + 9, { taille: 8.5, police: 'gras', couleur: FAV });
    this.y += 16;
    const yHaut = this.y;
    // Fond gris clair quadrillé derrière les barres opposées
    {
      const hZone = lignes.length * hLigne, c = this.couleur(TRAIT_GRILLE);
      this.page.drawRectangle({ x: x0, y: A4[1] - this.y - hZone, width: x1 - x0, height: hZone, color: this.couleur(FOND_GRILLE), borderColor: c, borderWidth: 0.6 });
      for (let k = 1; k < lignes.length; k++) this.page.drawLine({ start: { x: x0, y: A4[1] - this.y - k * hLigne }, end: { x: x1, y: A4[1] - this.y - k * hLigne }, thickness: 0.4, color: c });
      for (const f of [0.25, 0.5, 0.75]) for (const sgn of [-1, 1]) {
        const x = centre + sgn * f * demi;
        this.page.drawLine({ start: { x, y: A4[1] - this.y }, end: { x, y: A4[1] - this.y - hZone }, thickness: 0.4, color: c });
      }
    }
    for (const l of lignes) {
      const yc = this.y + hLigne / 2;
      this.texte(l.libelle, MARGE, yc + 3.4, { taille: 9.5, police: 'gras' });
      const wd = (l.defavorable / max) * demi, wf = (l.favorable / max) * demi;
      if (l.defavorable) {
        this.barre(centre - 1 - wd, yc - hBarre / 2, wd, hBarre, DEF);
        const t = String(l.defavorable);
        this.texte(t, centre - 1 - wd - 4 - this.largeur(t, 9, 'gras'), yc + 3.2, { taille: 9, police: 'gras' });
      }
      if (l.favorable) {
        this.barre(centre + 1, yc - hBarre / 2, wf, hBarre, FAV);
        this.texte(String(l.favorable), centre + 1 + wf + 4, yc + 3.2, { taille: 9, police: 'gras' });
      }
      if (!l.defavorable && !l.favorable) this.texte('—', centre + 6, yc + 3.2, { taille: 9, couleur: DOUX });
      this.y += hLigne;
    }
    this.page.drawLine({ start: { x: centre, y: A4[1] - yHaut + 2 }, end: { x: centre, y: A4[1] - this.y }, thickness: 0.8, color: this.couleur(AXE) });
    this.y += 6;
    if (total) this.paragraphe(`Nombre d'évaluations (sur ${total}) où au moins un facteur du domaine a été coché, de chaque côté.`, { taille: 8.3, couleur: DOUX });
  }

  /** Histogramme des notes de 0 à 10, avec pictogrammes. */
  histogramme(compte) {
    const h = 96, hTotal = h + 44;
    this.place(hTotal);
    const max = Math.max(1, ...compte);
    const pas = LARGEUR / 11, lb = Math.min(28, pas - 10);
    const base = this.y + h;
    // Fond gris clair quadrillé (une ligne par graduation, une colonne par note)
    {
      const c = this.couleur(TRAIT_GRILLE);
      this.page.drawRectangle({ x: MARGE, y: A4[1] - base, width: LARGEUR, height: h - 6, color: this.couleur(FOND_GRILLE), borderColor: c, borderWidth: 0.6 });
      const pasV = Math.max(1, Math.ceil(max / 5));
      for (let v = pasV; v <= max; v += pasV) {
        const y = base - (v / max) * (h - 16);
        this.page.drawLine({ start: { x: MARGE, y: A4[1] - y }, end: { x: MARGE + LARGEUR, y: A4[1] - y }, thickness: 0.4, color: c });
      }
      for (let i = 1; i < 11; i++) this.page.drawLine({ start: { x: MARGE + i * pas, y: A4[1] - base }, end: { x: MARGE + i * pas, y: A4[1] - base + h - 6 }, thickness: 0.4, color: c });
    }
    this.page.drawLine({ start: { x: MARGE, y: A4[1] - base }, end: { x: MARGE + LARGEUR, y: A4[1] - base }, thickness: 0.6, color: this.couleur(AXE) });
    compte.forEach((n, i) => {
      const xc = MARGE + i * pas + pas / 2;
      if (n) {
        const hb = Math.max(3, (n / max) * (h - 16));
        this.barre(xc - lb / 2, base - hb, lb, hb, COULEURS_NIVEAUX[i], { vertical: true });
        const t = String(n);
        this.texte(t, xc - this.largeur(t, 8.5, 'gras') / 2, base - hb - 4, { taille: 8.5, police: 'gras' });
      }
      this.meteo(i, xc - 7, base + 4, 14);
      const t = String(i);
      this.texte(t, xc - this.largeur(t, 7.5, 'gras') / 2, base + 28, { taille: 7.5, police: 'gras', couleur: DOUX });
    });
    this.y = base + 38;
  }

  /** Carte des lieux : fond OpenStreetMap (si fourni), marqueurs taille = nombre, couleur = humeur moyenne. */
  async carteLieux(points, cadre, fondPng) {
    const l = LARGEUR, h = (cadre.hauteur / cadre.largeur) * LARGEUR, k = l / cadre.largeur;
    this.place(h + 40);
    const yH = this.y;
    if (fondPng && !this.mesure) {
      try {
        const img = await this.doc.embedPng(fondPng);
        this.page.drawImage(img, { x: MARGE, y: A4[1] - yH - h, width: l, height: h });
      } catch { fondPng = null; }
    }
    if (!fondPng) this.page.drawRectangle({ x: MARGE, y: A4[1] - yH - h, width: l, height: h, color: this.couleur(FOND) });
    this.page.drawRectangle({ x: MARGE, y: A4[1] - yH - h, width: l, height: h, borderColor: this.couleur(FILET), borderWidth: 0.8 });
    const nmax = Math.max(...points.map((p) => p.nombre));
    const tries = [...points].sort((a, b) => b.nombre - a.nombre);
    const etiquettes = [];
    for (const p of tries) {
      const pos = K.positionDans(cadre, p.lat, p.lon);
      const x = MARGE + pos.x * k, y = yH + pos.y * k;
      const r = 4.5 + 9 * Math.sqrt(p.nombre / nmax);
      this.page.drawCircle({ x, y: A4[1] - y, size: r, color: this.couleur(COULEURS_NIVEAUX[Math.round(p.moyenne)]), borderColor: this.couleur('#FFFFFF'), borderWidth: 1.4 });
      etiquettes.push({ p, x, y, r });
    }
    // Étiquettes : première position libre parmi droite, gauche, dessus, dessous (sans chevaucher ni disques ni étiquettes)
    const occupes = etiquettes.map(({ x, y, r }) => ({ x0: x - r, y0: y - r, x1: x + r, y1: y + r }));
    const chevauche = (a) => occupes.some((b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0);
    for (const { p, x, y, r } of etiquettes) {
      const t1 = p.nom, t2 = `${C.nombreFr(p.moyenne)}/10 · ${C.pluriel(p.nombre, 'éval.', 'éval.')}`;
      const w = Math.max(this.largeur(t1, 8, 'gras'), this.largeur(t2, 7)) + 8 + 20;
      const essais = [[x + r + 3, y - 11], [x - r - 3 - w, y - 11], [x - w / 2, y - r - 25], [x - w / 2, y + r + 3],
        [x + r + 3, y - 30], [x + r + 3, y + 8], [x - r - 3 - w, y - 30], [x - r - 3 - w, y + 8]];
      const dans = ([a, b]) => [Math.max(MARGE + 2, Math.min(MARGE + l - w - 2, a)), Math.max(yH + 2, Math.min(yH + h - 24, b))];
      let pos = dans(essais[0]);
      for (const e of essais) {
        const c = dans(e);
        if (!chevauche({ x0: c[0] - 1, y0: c[1] - 1, x1: c[0] + w + 1, y1: c[1] + 23 })) { pos = c; break; }
      }
      const [xe, ye] = pos;
      occupes.push({ x0: xe, y0: ye, x1: xe + w, y1: ye + 22 });
      this.cadre(xe, ye, w, 22, { fond: '#FFFFFF', bord: FILET, epaisseur: 0.4, rayon: 3 });
      // Pictogramme météo de l'humeur moyenne du lieu, en plus de la couleur du disque
      this.meteo(Math.max(0, Math.min(10, Math.round(p.moyenne))), xe + 3, ye + 3, 16);
      // Étiquettes sur fond blanc : texte foncé, quel que soit le style
      this.texte(t1, xe + 23, ye + 9, { taille: 8, police: 'gras', couleur: '#1E2A33' });
      this.texte(t2, xe + 23, ye + 18.5, { taille: 7, couleur: '#5E6B74' });
    }
    // Échelle et attribution
    const lat = points.reduce((a, p) => a + p.lat, 0) / points.length;
    const e = K.echelle(cadre, lat);
    const xe = MARGE + 10, ye = yH + h - 10;
    this.page.drawRectangle({ x: xe - 4, y: A4[1] - ye - 4, width: e.pixels * k + 8 + this.largeur(e.libelle, 7) + 6, height: 13, color: this.couleur('#FFFFFF'), opacity: 0.85 });
    this.page.drawLine({ start: { x: xe, y: A4[1] - ye }, end: { x: xe + e.pixels * k, y: A4[1] - ye }, thickness: 1.6, color: this.couleur('#1E2A33') });
    this.texte(e.libelle, xe + e.pixels * k + 4, ye + 2.5, { taille: 7, couleur: '#1E2A33' });
    if (fondPng) {
      const a = K.ATTRIBUTION;
      const wa = this.largeur(a, 6.5) + 6;
      this.page.drawRectangle({ x: MARGE + l - wa, y: A4[1] - yH - h, width: wa, height: 10, color: this.couleur('#FFFFFF'), opacity: 0.85 });
      this.texte(a, MARGE + l - wa + 3, yH + h - 2.5, { taille: 6.5, couleur: '#5E6B74' });
    }
    this.y = yH + h + 8;
  }

  paginer(pied) {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      this.page = p;
      if (i > 0) {
        p.drawLine({ start: { x: MARGE, y: A4[1] - 40 }, end: { x: MARGE + LARGEUR, y: A4[1] - 40 }, thickness: 0.4, color: this.couleur(FILET) });
        this.texte(this.entete.gauche, MARGE, 34, { taille: 8, couleur: DOUX });
        this.texte(this.entete.droite, MARGE + LARGEUR - this.largeur(this.entete.droite, 8), 34, { taille: 8, couleur: DOUX });
      }
      const num = `Page ${i + 1} sur ${n}`;
      p.drawLine({ start: { x: MARGE, y: 40 }, end: { x: MARGE + LARGEUR, y: 40 }, thickness: 0.4, color: this.couleur(FILET) });
      this.texte(pied, MARGE, A4[1] - 26, { taille: 7.5, couleur: DOUX });
      this.texte(num, MARGE + LARGEUR - this.largeur(num, 8), A4[1] - 26, { taille: 8, couleur: DOUX });
    });
  }
}

function libCreneau(c) { return `${C.formatDateCourte(c.date)} ${C.LIBELLE_CRENEAU[c.creneau].toLowerCase()}`; }

/** Taille du fond de carte en pixels (affiché sur toute la largeur du texte, résolution double). */
export const TAILLE_CARTE = { largeur: 966, hauteur: 520 };

/**
 * Points et cadrage de la carte des lieux pour ces évaluations (null sans lieu localisé).
 * L'application s'en sert pour télécharger le fond de carte avant de générer le PDF.
 */
export function preparationCarte(evals) {
  const r = C.humeurParLieu(evals);
  const points = K.pointsCarte(r.lignes);
  if (!points.length) return null;
  const cadre = K.cadrage(points, TAILLE_CARTE.largeur, TAILLE_CARTE.hauteur, { marge: 90 });
  return { points, cadre, sansCoordonnees: r.lignes.length - points.length };
}

/**
 * @param PDFLib  module pdf-lib
 * @param donnees { evaluations, motifs, parametres }
 * @param options { debut:'AAAA-MM-JJ', fin:'AAAA-MM-JJ', type:'complet'|'synthetique', instant:ms }
 * @returns Uint8Array (PDF)
 */
export async function genererRapport(PDFLib, donnees, options) {
  const { debut, fin } = options;
  const type = options.type === 'synthetique' ? 'synthetique' : 'complet';
  const modeTextes = ['original', 'les-deux'].includes(options.textes) ? options.textes : 'reformule';
  const instant = options.instant ?? Date.now();
  if (!C.estDateValide(debut) || !C.estDateValide(fin) || debut > fin) throw new Error('Période invalide : la date de début doit précéder la date de fin.');
  if (C.joursEntre(debut, fin) > 3700) throw new Error('Période trop longue (10 ans maximum).');

  const toutes = donnees.evaluations;
  const evals = C.trierChrono(C.dansPeriode(toutes, debut, fin));
  // Tous les événements notés : pour savoir si une version validée les raconte déjà (pas de doublon)
  const evenementsTous = ((donnees.parametres || {}).evenements) || [];
  const textes = new Map(evals.map((e) => [e.id, C.textesPourRapport(e, modeTextes, evenementsTous)]));
  const nbReformules = [...textes.values()].filter((t) => t.reformule).length;
  const modifsReelles = (e) => (e.historique || []).filter((h) => h.changements.some((c) => c.champ !== 'reformulation') && !estCompletion(h));
  const parametres = donnees.parametres || {};
  // Rythme des évaluations (deux par jour, ou une seule à partir d'une date) : utilisé par tous les calculs de créneaux
  if ('rythme' in parametres) C.configurerRythme(parametres.rythme);
  const morceauxRythme = C.rythmePeriode(debut, fin);
  const changementRythme = morceauxRythme.length > 1 || morceauxRythme[0].creneaux.length === 1;
  // Phrase courte : « Depuis le 23/10/2026, une seule évaluation par jour, le soir, qui porte sur l'ensemble de la journée. »
  const phraseRythme = () => morceauxRythme.map((m, k) => {
    const libre = C.libelleRythme(m.creneaux);
    if (morceauxRythme.length === 1) return `Sur toute la période, ${libre}.`;
    return k === 0 ? `Jusqu'au ${C.formatDateCourte(m.jusquau)}, ${libre}.` : `Depuis le ${C.formatDateCourte(m.depuis)}, ${libre.replace(/^une évaluation/, 'une seule évaluation')}.`;
  }).join(' ');
  const patient = parametres.patient || {};
  const therapeute = parametres.therapeute || {};
  const destinataire = (parametres.destinataire || '').trim() || (therapeute.nom || '').trim();
  const listeSeances = C.seancesDepuisParametres(parametres);
  const grille = C.grilleCreneaux(debut, fin, toutes, instant, parametres.debutSuiviUtc);
  const comptes = C.comptesCreneaux(grille);
  const stats = C.statistiques(evals);
  const freq = C.frequenceMotifs(evals, donnees.motifs || []);
  const prev = C.comparaisonsPrevisions(evals, toutes);
  const statutParId = new Map(C.grilleCreneaux(debut, C.ajouterJours(fin, 1), toutes, instant, parametres.debutSuiviUtc).map((s) => [s.id, s.statut]));
  // Lieu et situation : couleurs stables (ordre de fréquence sur tout le suivi), comme dans l'application
  const ordreLieux = C.ordreLieux(toutes);
  const couleurLieu = (l) => { const i = ordreLieux.indexOf(C.cleLieu(l)); return i >= 0 && i < COULEURS_CATEGORIES.length ? COULEURS_CATEGORIES[i] : COULEUR_AUTRE; };
  const couleurSituation = (x) => COULEURS_CATEGORIES[C.ORDRE_SITUATIONS.indexOf(x.statut)] || COULEUR_AUTRE;
  const parLieu = C.humeurParLieu(evals);
  const parSituation = C.humeurParSituation(evals);
  const legendeLieux = [...parLieu.lignes].sort((a, b) => (ordreLieux.indexOf(a.cle) + 1 || 999) - (ordreLieux.indexOf(b.cle) + 1 || 999)).map((l) => ({ libelle: C.libelleLieu(l.valeur), couleur: couleurLieu(l.valeur) }));
  const legendeSituations = C.ORDRE_SITUATIONS.filter((st) => parSituation.lignes.some((l) => l.valeur.statut === st)).map((st) => ({ libelle: C.SITUATIONS[st], couleur: couleurSituation({ statut: st }) }));
  if (parLieu.sansValeur && parLieu.lignes.length) legendeLieux.push({ libelle: 'non indiqué', couleur: null });
  if (parSituation.sansValeur && parSituation.lignes.length) legendeSituations.push({ libelle: 'non indiquée', couleur: null });
  const estCompletion = (h) => h.changements.every((c) => ['lieu', 'lieux', 'situation'].includes(c.champ) && (!c.avant || (Array.isArray(c.avant) && !c.avant.length)));
  // Plusieurs lieux : noms courts dans l'ordre (la flèche n'existe pas dans les polices PDF standard)
  const libLieux = (e, complet = false) => {
    const l = C.lieuxDe(e);
    const act = (x) => C.precisionsLieu(x);
    return l.length > 1 ? l.map((x) => `${C.libelleLieu(x)}${act(x)}`).join(' › ') : `${C.libelleLieu(l[0], { complet: complet && !C.estItinerance(l[0]) })}${act(l[0])}`;
  };
  const parActivite = C.humeurParActivite(evals);

  const doc = await PDFLib.PDFDocument.create();
  const titreDoc = destinataire ? `Rapport pour ${destinataire}` : 'Rapport de suivi de l\'humeur';
  doc.setTitle(texteWinAnsi(`Baromètre de l'humeur – ${titreDoc}`));
  doc.setSubject(texteWinAnsi(`Période du ${C.formatDateCourte(debut)} au ${C.formatDateCourte(fin)}`));
  doc.setCreator('Baromètre de l\'humeur');
  doc.setProducer('Baromètre de l\'humeur (pdf-lib)');
  doc.setLanguage('fr-LU');
  doc.setCreationDate(new Date(instant));
  doc.setModificationDate(new Date(instant));
  const theme = themeRapport();
  appliquerTheme(theme);
  const SF = PDFLib.StandardFonts;
  const familles = { serif: [SF.TimesRoman, SF.TimesRomanBold, SF.TimesRomanItalic], mono: [SF.Courier, SF.CourierBold, SF.CourierOblique], sans: [SF.Helvetica, SF.HelveticaBold, SF.HelveticaOblique] };
  const [fn, fg, fi] = familles[theme.police] || familles.sans;
  const polices = { normal: await doc.embedFont(fn), gras: await doc.embedFont(fg), italique: await doc.embedFont(fi) };
  const periodeCourte = `Du ${C.formatDateCourte(debut)} au ${C.formatDateCourte(fin)}`;
  const R = new Redacteur(PDFLib, doc, polices, { gauche: `Baromètre de l'humeur – ${patient.nom ? `${patient.nom} – ` : ''}${titreDoc}`, droite: periodeCourte });

  // Page de garde : titre, identités, informations du rapport, chiffres clés, sommaire
  R.y = 46;
  const periodeLongue = `Du ${C.formatDateLongue(debut)} au ${C.formatDateLongue(fin)}`;
  // Logo de l'application en haut à droite de la page de garde (sans mention de copyright)
  const dessinerLogo = async () => {
    const taille = 40, xL = A4[0] - MARGE - taille + 6, yL = 26;
    let logo = null;
    if (options.logoPng) { try { logo = await doc.embedPng(options.logoPng); } catch { logo = null; } }
    if (logo) R.page.drawImage(logo, { x: xL, y: A4[1] - yL - taille, width: taille, height: taille });
  };
  if (COUVERTURE === 'bandeau') {
    // Grand aplat de couleur en haut de la page de garde, titre en blanc
    const lignesT = R.couper(titreDoc, 26, 'gras', LARGEUR);
    const hB = 96 + lignesT.length * 30;
    R.page.drawRectangle({ x: 0, y: A4[1] - hB, width: A4[0], height: hB, color: R.couleur(LAITON) });
    R.texte('BAROMÈTRE DE L\'HUMEUR  ·  RAPPORT DE SUIVI', MARGE, 52, { taille: 8.5, police: 'gras', couleur: FOND_PAGE || '#FFFFFF' });
    lignesT.forEach((l, k) => R.texte(l, MARGE, 92 + k * 30, { taille: 26, police: 'gras', couleur: FOND_PAGE || '#FFFFFF' }));
    R.texte(periodeLongue, MARGE, 92 + lignesT.length * 30 - 4, { taille: 12, police: 'gras', couleur: FOND_PAGE || '#FFFFFF' });
    await dessinerLogo(FOND_PAGE || SUR_ACCENT);
    R.y = hB + 22;
  } else if (COUVERTURE === 'centree') {
    // Titre centré entre deux filets, comme une une de journal ou une page sobre
    const centre = (t, taille, police, couleur) => R.texte(t, MARGE + LARGEUR / 2 - R.largeur(t, taille, police) / 2, R.y + taille, { taille, police, couleur });
    R.y = 54;
    centre('BAROMÈTRE DE L\'HUMEUR', 9, 'gras', DOUX); R.y += 18;
    R.page.drawLine({ start: { x: MARGE, y: A4[1] - R.y }, end: { x: MARGE + LARGEUR, y: A4[1] - R.y }, thickness: 1.6, color: R.couleur(ENCRE) });
    R.page.drawLine({ start: { x: MARGE, y: A4[1] - R.y - 3 }, end: { x: MARGE + LARGEUR, y: A4[1] - R.y - 3 }, thickness: 0.4, color: R.couleur(ENCRE) });
    R.y += 12;
    for (const l of R.couper(titreDoc, 25, 'gras', LARGEUR)) { centre(l, 25, 'gras', ENCRE); R.y += 30; }
    centre(periodeLongue, 11.5, 'italique', DOUX); R.y += 22;
    R.page.drawLine({ start: { x: MARGE, y: A4[1] - R.y }, end: { x: MARGE + LARGEUR, y: A4[1] - R.y }, thickness: 0.4, color: R.couleur(ENCRE) });
    R.page.drawLine({ start: { x: MARGE, y: A4[1] - R.y - 3 }, end: { x: MARGE + LARGEUR, y: A4[1] - R.y - 3 }, thickness: 1.6, color: R.couleur(ENCRE) });
    R.y += 20;
  } else {
    R.page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: R.couleur(LAITON) });
    R.texte('BAROMÈTRE DE L\'HUMEUR  ·  RAPPORT DE SUIVI', MARGE, R.y + 9, { taille: 8.5, police: 'gras', couleur: LAITON });
    R.y += 18;
    R.paragraphe(titreDoc, { taille: 24, police: 'gras', interligne: 1.15, apres: 2 });
    R.paragraphe(periodeLongue, { taille: 12, police: 'gras', couleur: DOUX, apres: 12 });
    await dessinerLogo(DOUX);
  }

  // Identités : patient et thérapeute, dans deux cadres
  const nomTherapeute = (therapeute.nom || '').trim() || destinataire;
  const cnsVisible = options.inclureCNS && patient.cns;
  const cartePatient = [
    patient.nom ? [patient.nom, 'gras', 11.5] : null,
    ...String(patient.adresse || '').split('\n').filter((l) => l.trim()).map((l) => [l.trim(), 'normal', 9.5]),
  ].filter(Boolean);
  const carteTherapeute = [
    nomTherapeute ? [nomTherapeute, 'gras', 11.5] : null,
    therapeute.titre ? [therapeute.titre, 'gras', 9.5, LAITON] : null,
    ...String(therapeute.adresse || '').split('\n').filter((l) => l.trim()).map((l) => [l.trim(), 'normal', 9.5]),
  ].filter(Boolean);
  if (cartePatient.length || carteTherapeute.length || cnsVisible) {
    const col = (LARGEUR - 14) / 2;
    const lignes = (carte) => carte.flatMap(([t, pol, tl, coul]) => R.couper(t, tl, pol, col - 26).map((l) => [l, pol, tl, coul]));
    const lp = lignes(cartePatient), lt = lignes(carteTherapeute);
    const hauteurLignes = (l) => l.reduce((h, [, , tl]) => h + tl * 1.42, 0);
    const h = Math.max(hauteurLignes(lp) + (cnsVisible ? 26 : 0), hauteurLignes(lt)) + 36;
    const carte = (x, titre, l, cns) => {
      R.cadre(x, R.y, col, h, { fond: FOND, rayon: Math.min(RAYON, 9) * 0.7 });
      R.page.drawRectangle({ x, y: A4[1] - R.y - h + 6, width: 3, height: h - 12, color: R.couleur(LAITON) });
      R.texte(titre, x + 14, R.y + 18, { taille: 7.8, police: 'gras', couleur: LAITON });
      let y = R.y + 26;
      for (const [t, pol, tl, coul] of l) { R.texte(t, x + 14, y + tl, { taille: tl, police: pol, couleur: coul || ENCRE }); y += tl * 1.42; }
      if (cns) {
        y += 6;
        R.texte('Matricule CNS', x + 14, y + 8, { taille: 7.8, couleur: DOUX });
        R.texte(C.formatCNS(patient.cns), x + 14, y + 20, { taille: 10.5, police: 'gras' });
      }
    };
    carte(MARGE, 'PATIENT', lp, cnsVisible);
    carte(MARGE + col + 14, 'THÉRAPEUTE', lt, false);
    R.y += h + 16;
  }

  // Informations du rapport (étiquette à gauche, valeur en gras)
  {
    const precedente = C.seancesPassees(listeSeances, instant)[0];
    const prochaine = C.prochaineSeance(listeSeances, instant);
    const nbJours = C.joursEntre(debut, fin) + 1;
    const infos = [
      ['Période analysée', `du ${C.formatDateCourte(debut)} au ${C.formatDateCourte(fin)} (${C.pluriel(nbJours, 'jour')})`],
      precedente ? ['Séance précédente', C.libelleSeance(precedente)] : null,
      prochaine ? ['Prochaine séance', C.libelleSeance(prochaine)] : (parametres.seanceAConvenir ? ['Prochaine séance', 'pas encore convenue'] : null),
      ['Type de rapport', type === 'complet' ? 'complet (évaluations détaillées)' : 'synthétique (évaluations abrégées)'],
      changementRythme ? ['Rythme', morceauxRythme.map((m, k) => (morceauxRythme.length === 1 ? C.libelleRythme(m.creneaux) : k === 0 ? `${C.libelleRythme(m.creneaux)} jusqu'au ${C.formatDateCourte(m.jusquau)}` : `depuis le ${C.formatDateCourte(m.depuis)} : ${C.libelleRythme(m.creneaux)}`)).join(' ; ').replace(/, qui porte sur l'ensemble de la journée/, '')] : null,
      ['Établi le', `${C.formatDateHeure(instant)} (heure de Luxembourg)`],
    ].filter(Boolean);
    for (const [lib, val] of infos) {
      R.texte(lib, MARGE, R.y + 9.5, { taille: 9, couleur: DOUX });
      const lignesVal = R.couper(val, 9.5, 'gras', LARGEUR - 120);
      lignesVal.forEach((l, k) => R.texte(l, MARGE + 120, R.y + 9.5 + k * 13, { taille: 9.5, police: 'gras' }));
      R.y += 15.5 + (lignesVal.length - 1) * 13;
      R.page.drawLine({ start: { x: MARGE, y: A4[1] - R.y + 3 }, end: { x: MARGE + LARGEUR, y: A4[1] - R.y + 3 }, thickness: 0.35, color: R.couleur(GRILLE) });
    }
    R.y += 14;
  }

  // Chiffres clés
  R.texte('En bref', MARGE, R.y + 11, { taille: 12, police: 'gras' });
  R.y += 20;
  {
    const arrondi = stats.nombre ? Math.round(stats.moyenne) : null;
    R.chiffres([
      { valeur: stats.nombre ? C.nombreFr(stats.moyenne) : '—', suffixe: stats.nombre ? '/10' : '', libelle: stats.nombre ? `moyenne générale (${C.NIVEAUX[arrondi]})` : 'moyenne générale', icone: arrondi },
      { valeur: String(comptes.completees), suffixe: `/${comptes.attendues}`, libelle: 'évaluations complétées / attendues' },
      { valeur: stats.nombre ? String(stats.min) : '—', suffixe: stats.nombre ? '/10' : '', libelle: 'note la plus basse', icone: stats.nombre ? stats.min : null },
      { valeur: stats.nombre ? String(stats.max) : '—', suffixe: stats.nombre ? '/10' : '', libelle: 'note la plus haute', icone: stats.nombre ? stats.max : null },
    ]);
  }

  // Sommaire (rempli à la fin, quand les numéros de page sont connus)
  const synthese = options.synthese && String(options.synthese.texte || '').trim() ? options.synthese : null;
  const domaines = C.frequenceDomaines(evals, donnees.motifs || []);
  const avecDomaines = domaines.some((d) => d.favorable || d.defavorable);
  // Contexte et événements marquants (notes du patient, jamais transmises à l'assistant)
  const evenements = Array.isArray(options.evenements) ? C.evenementsActifs(options.evenements, { debut, fin, rapportSeulement: true }) : [];
  const contexte = options.contexte ? C.normaliserContexte(options.contexte) : null;
  // 5 parties + 13 sections, plus les événements marquants et les facteurs par domaine s'il y en a
  const NB_SECTIONS = 5 + 13 + (evenements.length ? 1 : 0) + (avecDomaines ? 1 : 0);
  let numSection = 0;
  const hSommaire = NB_SECTIONS * 14 + 40;
  R.cadre(MARGE, R.y, LARGEUR, hSommaire, { bord: FILET, epaisseur: 0.8, rayon: Math.min(RAYON, 9) * 0.7 });
  R.texte('Sommaire', MARGE + 10, R.y + 20, { taille: 12, police: 'gras' });
  const pageSommaire = R.page, ySommaire = R.y + 30;
  R.y += hSommaire + 12;

  // Avertissement
  const avert = 'Toutes les données proviennent exclusivement des saisies du patient dans l\'application. Les chiffres sont descriptifs : ils ne constituent ni un diagnostic ni une évaluation clinique, et ne remplacent pas l\'échange avec le thérapeute.'
    + (nbReformules ? ` ${nbReformules === 1 ? 'Un commentaire est présenté' : `${nbReformules} commentaires sont présentés`} dans une version rédigée à partir de ses saisies (orthographe corrigée, traduite en français si nécessaire), relue et validée par le patient${modeTextes === 'les-deux' ? ', suivie du texte original' : ' ; les textes originaux sont conservés dans l\'application'}.` : '');
  const lignesAvert = R.couper(avert, 8.6, 'italique', LARGEUR - 24);
  const hAvert = lignesAvert.length * 8.6 * 1.4 + 14;
  R.place(hAvert);
  R.cadre(MARGE, R.y, LARGEUR, hAvert, { fond: FOND, rayon: Math.min(RAYON, 9) * 0.6 });
  lignesAvert.forEach((l, i) => R.texte(l, MARGE + 12, R.y + 7 + 8.6 + i * 8.6 * 1.4, { taille: 8.6, police: 'italique', couleur: DOUX }));
  R.y += hAvert + 4;

  // Chapitre avec graphiques : le titre reste avec son premier bloc, et les blocs remplissent les pages
  // sans laisser de trou (un bloc plus petit peut passer avant un bloc qui ne tient plus sur la page).
  const chapitre = async (titre, { avant = null, blocs = [], apres = null } = {}) => {
    // Titre + introduction + le plus petit bloc (le flux le placera en premier s'il le faut)
    const hAvant = avant ? await R.mesurer(async () => avant()) : 0;
    let hBloc = 0;
    for (const [k, b] of blocs.entries()) { const h = await R.mesurer(b); hBloc = k === 0 ? h : Math.min(hBloc, h); }
    const besoin = hAvant + hBloc;
    R.section(++numSection, titre, Math.min(besoin, BAS_CONTENU - HAUT_CONTENU - 70));
    if (avant) avant();
    await R.flux(blocs.map((dessin) => ({ dessin })));
    if (apres) apres();
  };

  // ===== Partie I – Introduction : présentation, aperçu de la période (évolution validée), contexte, évaluations
  await R.partie('I', 'Introduction', { nouvellePage: true });
  R.section(++numSection, 'Introduction', 120);
  {
    const nbJours = C.joursEntre(debut, fin) + 1;
    R.paragraphe(`Ce rapport présente le suivi de l'humeur du patient du ${C.formatDateLongue(debut)} au ${C.formatDateLongue(fin)} (${C.pluriel(nbJours, 'jour')}). ${changementRythme ? `L'humeur est évaluée sur une échelle de 0 (Alerte rouge) à 10 (Plein soleil). ${phraseRythme()}` : 'L\'humeur est évaluée deux fois par jour, le matin et le soir, sur une échelle de 0 (Alerte rouge) à 10 (Plein soleil).'} Chaque évaluation peut comporter des motifs cochés (favorables ou défavorables), un commentaire, le ou les lieux, la situation professionnelle et une prévision pour le créneau suivant ; le patient peut aussi noter des événements marquants.`, { taille: 10, apres: 6 });
    R.paragraphe('Le rapport comprend cinq parties : I. Introduction ; II. Évaluations jour par jour ; III. Impacts : événements marquants et facteurs ; IV. Analyse ; V. Conclusion et points à aborder.', { taille: 10, apres: 6 });
  }
  if (synthese) {
    const parts = C.partiesSynthese(synthese.texte);
    if (parts.evolution.length) {
      R.sousTitre('Aperçu de la période', 60);
      parts.evolution.forEach((l, k) => (k === 0 ? R.riche([['Évolution : ', 'gras'], [l]], { taille: 10, apres: 4 }) : R.paragraphe(l, { taille: 10, apres: 4 })));
      R.paragraphe(`Rédigé ${synthese.source === 'assistant' ? 'avec l\'aide d\'un assistant (Claude, Anthropic) ' : ''}à partir des données de la période, relu et validé par le patient${synthese.valideeLeUtc ? ` le ${C.formatDateHeure(synthese.valideeLeUtc)}` : ''}. Constats descriptifs, sans évaluation clinique ; la conclusion figure dans la partie V.`, { taille: 8.3, police: 'italique', couleur: DOUX });
    }
  }
  if (contexte) {
    R.sousTitre('Contexte indiqué par le patient', 60);
    for (const para of contexte.texte.split(/\n+/).map((t) => t.trim()).filter(Boolean)) R.paragraphe(para, { taille: 10, apres: 4 });
    if (contexte.modifieLeUtc) R.paragraphe(`Mis à jour le ${C.formatDateHeure(contexte.modifieLeUtc)}.`, { taille: 8.3, couleur: DOUX });
  }

  R.section(++numSection, 'Évaluations attendues, complétées et omises', 90);
  R.chiffres([
    { valeur: String(comptes.attendues), libelle: 'attendues' },
    { valeur: String(comptes.completees), libelle: 'complétées' },
    { valeur: String(comptes.omises), libelle: 'omises' },
    { valeur: String(comptes.enAttente + comptes.aRattraper), libelle: comptes.aRattraper ? 'en attente ou à rattraper' : 'en attente de réponse' },
  ]);
  const det = [];
  if (changementRythme) det.push(`${phraseRythme()} Seules les évaluations prévues par le rythme de chaque jour sont comptées comme attendues.`);
  det.push(`${changementRythme ? 'Rappels' : 'Deux créneaux par jour'} : matin (rappel à 06:00) et soir (rappel à 18:00), heure de Luxembourg${changementRythme ? ', selon le rythme' : ''}. Un créneau reste ouvert jusqu'au rappel suivant ; il peut ensuite encore être rempli pendant ${C.DELAI_RATTRAPAGE_H} heures (saisie signalée en retard). Au-delà, il est compté comme omis s'il n'a pas reçu de réponse.`);
  const partsCompl = [];
  if (comptes.aLHeure) partsCompl.push(`${comptes.aLHeure} dans le créneau`);
  if (comptes.enRetard) partsCompl.push(`${comptes.enRetard} après la fin du créneau (saisie rétrospective)`);
  if (comptes.heureInconnue) partsCompl.push(`${comptes.heureInconnue} dont l'heure de saisie est inconnue (donnée historique antérieure à l'application)`);
  if (partsCompl.length) det.push(`Évaluations complétées : ${partsCompl.join(' ; ')}.`);
  if (comptes.nonRenseignees) det.push(`${C.pluriel(comptes.nonRenseignees, 'créneau antérieur', 'créneaux antérieurs')} au début du suivi dans l'application (${C.formatDateHeure(parametres.debutSuiviUtc)}) ${comptes.nonRenseignees > 1 ? 'sont marqués' : 'est marqué'} « non renseigné » et ${comptes.nonRenseignees > 1 ? 'ne sont pas comptés' : 'n\'est pas compté'} comme attendu${comptes.nonRenseignees > 1 ? 's' : ''}.`);
  if (comptes.aVenir) det.push(`${C.pluriel(comptes.aVenir, 'créneau', 'créneaux')} de la période ${comptes.aVenir > 1 ? 'sont' : 'est'} encore à venir.`);
  for (const d of det) R.paragraphe(d, { taille: 9.5, couleur: DOUX, apres: 4 });

  // 10. Évaluations manquantes
  R.section(++numSection, 'Évaluations manquantes');
  const omis = grille.filter((s) => s.statut === 'omis');
  const attente = grille.filter((s) => s.statut === 'en_attente' || s.statut === 'a_rattraper');
  const nonRens = grille.filter((s) => s.statut === 'non_renseigne');
  if (!omis.length) R.paragraphe('Aucun créneau omis sur la période.');
  else R.tableau([{ titre: 'Date', part: 2.4 }, { titre: 'Créneau', part: 1 }, { titre: 'Rappel prévu', part: 1.2 }], omis.map((s) => [C.formatDateLongue(s.date), C.LIBELLE_CRENEAU[s.creneau], C.formatHeure(s.prevuUtc)]));
  if (attente.length) R.paragraphe(`En attente de réponse ou encore à rattraper (délai de ${C.DELAI_RATTRAPAGE_H} h) au moment du rapport : ${attente.map(libCreneau).join(', ')}.`, { taille: 9.5 });
  if (nonRens.length) R.paragraphe(`Non renseigné (antérieur au début du suivi dans l'application, données inconnues) : ${nonRens.map(libCreneau).join(', ')}.`, { taille: 9.5, couleur: DOUX });

  // ===== Partie II – Évaluations jour par jour (détail complet, ou tableau dans le rapport synthétique)
  await R.partie('II', 'Évaluations jour par jour', { nouvellePage: true });
  R.section(++numSection, 'Évaluations jour par jour', 120);
  if (!evals.length) R.paragraphe('Aucune évaluation sur la période.');
  const heureValidation = (e) => (e.validationConnue && e.valideLeUtc ? C.formatDateHeure(e.valideLeUtc) : 'inconnue (donnée historique)');
  // Événements marquants rattachés à chaque évaluation (même numéro que dans la section et le graphique)
  const evtsParCreneau = new Map();
  evenements.forEach((x, i) => { const k = C.creneauEvenement(x); evtsParCreneau.set(k, [...(evtsParCreneau.get(k) || []), { numero: i + 1, x }]); });
  const texteDetaille = (etiquette, texte, couleur = ENCRE) => {
    const paras = String(texte || '').split(/\n+/).map((t) => t.trim()).filter(Boolean);
    paras.forEach((para, i) => R.riche([...(i === 0 ? [[`${etiquette} : `, 'gras', couleur]] : []), [para, 'normal', couleur]], { taille: 9, retrait: 14, apres: 2 }));
  };
  if (type === 'synthetique' && evals.length) {
    const tronquer = (t, n = 220) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')} […]` : t);
    R.tableau(
      [{ titre: 'Créneau', part: 1.3 }, { titre: 'Note', part: 1.3 }, { titre: 'Saisie', part: 1.3 }, { titre: 'Motifs et commentaire', part: 4.2 }],
      evals.map((e) => [
        [libCreneau(e), e.lieu ? libLieux(e) : '', e.situation ? C.libelleSituation(e.situation) : ''].filter(Boolean).join('\n'), C.libelleNote(e.note), heureValidation(e) + (e.saisieRetrospective ? ' – rétrospective' : '') + (modifsReelles(e).length ? ' – modifiée' : ''),
        [[...C.libellesGroupes(e.motifs, donnees.motifs || []), ...e.autresMotifs].map((m) => m.libelle).join(', '), tronquer([textes.get(e.id).explication, textes.get(e.id).complement].filter(Boolean).join(' ')),
          (evtsParCreneau.get(e.creneauId) || []).map((v) => `Événement n° ${v.numero}${v.x.titre ? ` : ${v.x.titre}` : ''}${C.IMPACTS[v.x.impact] ? ` (${C.IMPACTS[v.x.impact].toLowerCase()})` : ''}`).join(' ; ')].filter(Boolean).join(' — ') || '—',
      ]),
      { taille: 8.5 },
    );
    R.paragraphe(`Rapport synthétique : les commentaires longs sont abrégés ; le rapport complet les reproduit intégralement.${nbReformules ? ' Les commentaires reformulés sont repris dans leur version validée par le patient.' : ''}`, { taille: 8.5, couleur: DOUX });
  } else {
    for (const e of evals) {
      R.place(80);
      R.y += 8;
      R.cadre(MARGE, R.y, LARGEUR, 26, { fond: FOND, rayon: Math.min(RAYON, 9) * 0.45 });
      R.page.drawRectangle({ x: MARGE, y: A4[1] - R.y - 26, width: 4, height: 26, color: R.couleur(COULEURS_NIVEAUX[e.note]) });
      const tete = `${C.majuscule(C.formatDateLongue(e.date))} – ${C.LIBELLE_CRENEAU[e.creneau]}`;
      R.texte(tete, MARGE + 14, R.y + 17, { taille: 10.5, police: 'gras' });
      const note = C.libelleNote(e.note);
      const xNote = MARGE + LARGEUR - 10 - R.largeur(note, 10.5, 'gras');
      R.texte(note, xNote, R.y + 17, { taille: 10.5, police: 'gras' });
      R.meteo(e.note, xNote - 25, R.y + 2, 22);
      R.y += 34;
      const meta = [`Rappel prévu : ${C.formatHeure(e.rappelPrevuUtc)}`, `Validation : ${heureValidation(e)}`];
      if (e.saisieRetrospective) meta.push('saisie rétrospective, après la fin du créneau');
      R.paragraphe(meta.join('   |   '), { taille: 8.5, couleur: DOUX, apres: 3 });
      if (e.lieu || e.situation) {
        R.riche([
          ...(e.lieu ? [[C.lieuxDe(e).length > 1 ? 'Lieux : ' : 'Lieu : ', 'gras'], [libLieux(e, true)]] : []),
          ...(e.lieu && e.situation ? [['   |   ', 'normal', FILET]] : []),
          ...(e.situation ? [['Situation : ', 'gras'], [C.libelleSituation(e.situation)]] : []),
        ]);
      }
      if (e.noteOrigine) R.paragraphe(e.noteOrigine, { taille: 8.5, police: 'italique', couleur: DOUX, apres: 3 });
      const libMotifs = (l) => l.map((m) => `${m.libelle} (${C.LIBELLE_POLARITE[m.polarite].toLowerCase()})`).join(', ');
      const tx = textes.get(e.id);
      // Une version rédigée (méthode 3 et suivantes) présente déjà les motifs cochés : pas de liste en double
      const motifsDansTexte = tx.reformule && (tx.methode || 1) >= 3;
      if (!motifsDansTexte) R.riche([['Motifs cochés : ', 'gras'], [e.motifs.length || e.autresMotifs.length ? libMotifs([...C.libellesGroupes(e.motifs, donnees.motifs || []), ...e.autresMotifs]) : 'aucun']]);
      // Texte sur plusieurs lignes (styles « par rubriques » ou « points clés »)
      const texteRedige = (t) => {
        for (const ligne of String(t).split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
          if (/^[–\-•]\s*/.test(ligne)) R.puces([ligne.replace(/^[–\-•]\s*/, '')], { taille: 9.5 });
          else R.paragraphe(ligne, { taille: 9.5, apres: 3 });
        }
      };
      if (tx.explication) { R.paragraphe(tx.reformule ? 'Description :' : 'Explication :', { taille: 9.5, police: 'gras', apres: 0 }); texteRedige(tx.explication); }
      if (tx.complement) { R.paragraphe('Complément :', { taille: 9.5, police: 'gras', apres: 0 }); texteRedige(tx.complement); }
      if (e.prevision) {
        const p = e.prevision;
        R.riche([
          [`Prévision pour ${C.formatDateLongue(p.cible.date)}, ${C.LIBELLE_CRENEAU[p.cible.creneau].toLowerCase()} : `, 'gras'],
          [Number.isInteger(p.note) ? C.libelleNote(p.note) : 'aucune note'],
          ...(tx.prevision ? [['. Motif : ', 'gras'], [tx.prevision]] : []),
          ...(p.motifs && p.motifs.length && !motifsDansTexte ? [[` (motifs associés : ${p.motifs.map((m) => m.libelle).join(', ')})`]] : []),
        ]);
      }
      if (tx.reformule) {
        R.paragraphe(`${tx.methode >= 2 ? `Texte rédigé à partir des saisies du patient (motifs, commentaires${tx.evenementsIntegres ? ' et événements marquants' : ''}, orthographe corrigée, traduit en français si nécessaire)` : 'Texte corrigé et raccourci'}, relu et validé par le patient${tx.valideeLeUtc ? ` le ${C.formatDateHeure(tx.valideeLeUtc)}` : ''}.`, { taille: 8.5, police: 'italique', couleur: DOUX, apres: 3 });
        if (tx.original) {
          const o = tx.original;
          R.paragraphe('Texte original du patient :', { taille: 8.5, police: 'gras', couleur: DOUX, apres: 0 });
          for (const [lib, v] of [['Explication', o.explication], ['Complément', o.complement], ['Motif de la prévision', o.prevision]]) {
            if (v) R.paragraphe(`${lib} : « ${v} »`, { taille: 8.5, police: 'italique', couleur: DOUX, apres: 2 });
          }
          R.y += 2;
        }
      }
      const evtsCreneau = evtsParCreneau.get(e.creneauId) || [];
      if (evtsCreneau.length && tx.evenementsIntegres) {
        // Déjà racontés dans la version rédigée : un simple renvoi aux numéros, sans redite
        R.riche([[evtsCreneau.length > 1 ? 'Événements marquants : ' : 'Événement marquant : ', 'gras', LAITON],
          ...evtsCreneau.flatMap(({ numero, x }, k) => [[`${k ? ' ; ' : ''}n° ${numero}${x.titre ? ` ${x.titre}` : ''}`], ...(C.IMPACTS[x.impact] ? [[` (${C.IMPACTS[x.impact].toLowerCase()})`, 'normal', COULEUR_IMPACT[x.impact]]] : [])])], { taille: 9, apres: 3 });
      } else if (evtsCreneau.length) {
        R.y += 2;
        R.paragraphe(evtsCreneau.length > 1 ? 'Événements marquants de la période évaluée :' : 'Événement marquant de la période évaluée :', { taille: 9.5, police: 'gras', couleur: LAITON, apres: 2 });
        for (const { numero, x } of evtsCreneau) {
          R.riche([[`${numero}. ${C.majuscule(C.libelleMomentEvenement(x))}`, 'gras'], ...(x.titre ? [[` – ${x.titre}`, 'gras']] : []), ...(C.IMPACTS[x.impact] ? [[`  ·  ${C.IMPACTS[x.impact].toLowerCase()}`, 'gras', COULEUR_IMPACT[x.impact]]] : [])], { taille: 9.3, retrait: 6, apres: 2 });
          texteDetaille('Ce qui s\'est passé', x.faits);
          texteDetaille('Vécu du patient', x.vecu, DOUX);
        }
        R.y += 2;
      }
      if (e.securite && e.securite.declenchee) R.paragraphe(`Une vérification de sécurité a été proposée (${e.securite.raisons.join(', ')}).`, { taille: 9, police: 'italique', apres: 3 });
      const completions = (e.historique || []).filter(estCompletion);
      if (completions.length) R.paragraphe(`Lieu ou situation indiqués a posteriori le ${C.formatDateHeure(completions[completions.length - 1].le)}.`, { taille: 8.5, couleur: DOUX, apres: 2 });
      if (modifsReelles(e).length) {
        for (const h of modifsReelles(e)) {
          const champs = h.changements.filter((c) => c.champ !== 'reformulation').map((c) => (c.champ === 'note' ? `note ${c.avant} → ${c.apres}` : (C.LIBELLE_CHAMP[c.champ] || c.champ).toLowerCase())).join(', ');
          R.paragraphe(`Modifiée le ${C.formatDateHeure(h.le)} : ${champs}${h.raison ? ` (raison indiquée : ${h.raison})` : ''}.`, { taille: 8.5, couleur: DOUX, apres: 2 });
        }
      }
      R.y += 4;
    }
  }

  // ===== Partie III – Impacts : événements marquants et facteurs cochés
  await R.partie('III', 'Impacts : événements marquants et facteurs', { besoin: 230 });
  {
    if (evenements.length) {
      R.section(++numSection, 'Événements marquants', 120);
      if (type === 'synthetique') evenements.forEach((x, i) => R.evenement(i + 1, x));
      else {
        // Rapport complet : un tableau d'ensemble ; le texte de chaque événement figure une seule fois,
        // avec l'évaluation qu'il concerne (annexe), ou ci-dessous s'il n'y a pas d'évaluation pour ce moment
        R.tableau(
          [{ titre: 'N°', part: 0.45 }, { titre: 'Moment', part: 2.2 }, { titre: 'Événement', part: 3.6 }, { titre: 'Impact', part: 1 }],
          evenements.map((x, i) => [String(i + 1), C.majuscule(C.libelleMomentEvenement(x)), x.titre || (x.faits || '').slice(0, 80), C.IMPACTS[x.impact] ? C.IMPACTS[x.impact].replace('Impact ', '') : '—']),
          { taille: 8.8 },
        );
        const avecEval = new Set(evals.map((e) => e.creneauId));
        const orphelins = evenements.map((x, i) => ({ x, n: i + 1 })).filter(({ x }) => !avecEval.has(C.creneauEvenement(x)));
        if (orphelins.length) {
          R.sousTitre(orphelins.length > 1 ? 'Événements sans évaluation correspondante' : 'Événement sans évaluation correspondante');
          orphelins.forEach(({ x, n }) => R.evenement(n, x));
        }
      }
      R.paragraphe(`Notes saisies ou importées par le patient, qui en a validé le contenu. Elles distinguent ce qui s'est passé de ce qu'il a ressenti ; les messages de tiers sont résumés et ne présument pas de leurs intentions. Les numéros renvoient aux pastilles du graphique chronologique ; l'impact (positif ou négatif) est celui qu'indique le patient.${type === 'synthetique' ? '' : ' Le détail de chaque événement figure une seule fois, avec l\'évaluation qu\'il concerne, dans la partie II.'}`, { taille: 8.3, police: 'italique', couleur: DOUX });
    }
  }

  // 6 et 7. Facteurs : barres (nombre de fois où le motif a été coché)
  const blocFacteurs = (pol) => {
    const l = freq.filter((f) => f.polarite === pol);
    if (!l.length) return null;
    const max = Math.max(...freq.map((f) => f.nombre));
    const lignes = l.slice(0, type === 'synthetique' ? 10 : 20);
    return () => {
      R.encadre(lignes.length * 21 + 18, () => R.barres(lignes.map((f) => ({ libelle: f.libelle, valeur: f.nombre, nombre: f.nombre, detail: `${Math.round((f.nombre / evals.length) * 100)} % des évaluations` })),
        { mode: 'compte', max, couleur: pol === 'favorable' ? BARRE_FAV : pol === 'defavorable' ? BARRE_DEF : '#9A9C94' }));
      if (type === 'synthetique' && l.length > 10) R.paragraphe(`Rapport synthétique : les 10 motifs les plus fréquents sur ${l.length}.`, { taille: 8.5, couleur: DOUX });
    };
  };
  const rappelMotifs = 'Nombre de fois où chaque motif a été coché. Seuls les motifs explicitement cochés lors d\'une évaluation sont comptés ; les commentaires libres sont reproduits dans la partie II.';
  if (avecDomaines) {
    await chapitre('Facteurs par domaine', {
      avant: () => R.paragraphe(`Chaque motif est rangé selon la source de l'influence : ${C.DOMAINES.map((d) => d.libelle.toLowerCase()).join(', ').replace(/, ([^,]*)$/, ' ou $1')}.`, { taille: 9, couleur: DOUX, apres: 6 }),
      blocs: [() => R.encadre(domaines.length * 26 + 60, () => R.barresDomaines(domaines, { total: evals.length }))],
    });
  }
  {
    const fav = blocFacteurs('favorable');
    await chapitre('Facteurs favorables mentionnés', {
      blocs: [fav || (() => R.paragraphe('Aucun facteur favorable n\'a été coché sur la période.'))],
      apres: () => R.paragraphe(rappelMotifs, { taille: 8.5, couleur: DOUX }),
    });
    const def = blocFacteurs('defavorable');
    const mix = blocFacteurs('mixte');
    await chapitre('Facteurs défavorables mentionnés', {
      blocs: [def || (() => R.paragraphe('Aucun facteur défavorable n\'a été coché sur la période.')), ...(mix ? [() => { R.sousTitre('Facteurs mixtes'); mix(); }] : [])],
      apres: () => R.paragraphe(rappelMotifs, { taille: 8.5, couleur: DOUX }),
    });
  }

  // ===== Partie IV – Analyse
  await R.partie('IV', 'Analyse', { besoin: 200 });
  // 2. Moyennes
  R.section(++numSection, 'Moyennes');
  if (!stats.nombre) R.paragraphe('Aucune évaluation sur la période.');
  else {
    const tuile = (lib, m, n) => ({ valeur: n ? C.nombreFr(m) : '—', suffixe: n ? '/10' : '', libelle: n ? `${lib} · ${C.pluriel(n, 'évaluation')}` : lib, icone: n ? Math.round(m) : null });
    R.chiffres([
      tuile('Générale', stats.moyenne, stats.nombre),
      tuile('Matin', stats.moyenneMatin, stats.nombreMatin),
      tuile('Soir', stats.moyenneSoir, stats.nombreSoir),
    ]);
    if (stats.nombre < 5) R.paragraphe(`Avec ${C.pluriel(stats.nombre, 'évaluation')}, ces moyennes sont peu représentatives.`, { taille: 9, couleur: DOUX });
  }

  // 3. Répartition des notes, minimum et maximum
  if (!stats.nombre) { R.section(++numSection, 'Répartition des notes'); R.paragraphe('Aucune évaluation sur la période.'); } else {
    const quand = (l) => l.map((e) => libCreneau(e)).join(', ');
    await chapitre('Répartition des notes', {
      avant: () => R.paragraphe('Nombre d\'évaluations pour chaque note, de 0 (Alerte rouge) à 10 (Plein soleil).', { taille: 8.5, couleur: DOUX, apres: 4 }),
      blocs: [() => R.encadre(180, () => {
        R.histogramme(C.repartitionNotes(evals));
        R.riche([['Note minimale : ', 'gras'], [`${C.libelleNote(stats.min)} (${quand(stats.evaluationsMin)})`]], { taille: 9.5 });
        R.riche([['Note maximale : ', 'gras'], [`${C.libelleNote(stats.max)} (${quand(stats.evaluationsMax)})`]], { taille: 9.5, apres: 0 });
      })],
    });
  }

  // 4. Graphique
  if (grille.length > 2 * 400) {
    R.section(++numSection, 'Graphique chronologique');
    R.paragraphe('Période trop longue pour un graphique lisible (plus de 400 jours) : réduisez la période pour l\'afficher.', { couleur: DOUX });
  } else {
    await chapitre('Graphique chronologique', {
      blocs: [() => R.encadre(470, () => { R.graphique(grille, prev, { couleurLieu, couleurSituation, legendeLieux, legendeSituations, evenements: evenements.map((x, i) => ({ numero: i + 1, creneauId: C.creneauEvenement(x), impact: x.impact })) }); })],
      apres: () => R.paragraphe(`Chaque position horizontale correspond à un créneau ${changementRythme ? 'prévu (matin puis soir, ou une seule évaluation par jour selon le rythme)' : '(matin puis soir)'}. La ligne relie les notes de créneaux consécutifs ; elle s'interrompt lorsqu'un créneau n'a pas de réponse.${parLieu.lignes.length || parSituation.lignes.length ? ' Sous les dates, les bandes de couleur indiquent le lieu de séjour et la situation professionnelle déclarés par le patient pour chaque créneau ; lorsque plusieurs lieux ont été indiqués, le créneau est partagé entre eux, dans l\'ordre.' : ''}${evenements.length ? ' Les pastilles numérotées signalent les événements marquants décrits plus haut, sur l\'évaluation qu\'ils concernent (celle du soir porte sur la journée, celle du matin sur la soirée et la nuit) ; bleue : impact positif, bordeaux : impact négatif selon le patient.' : ''}`, { taille: 8.5, couleur: DOUX }),
    });
  }

  // 5. Tendances
  R.section(++numSection, 'Tendances principales');
  R.puces(C.tendancesDescriptives(evals));

  // 8. Quand et où l'humeur est la plus basse : jours, situations, lieux (carte), activités
  if (!stats.nombre) { R.section(++numSection, 'Jours, situations, lieux et activités'); R.paragraphe('Aucune évaluation sur la période.'); } else {
    const enBarres = (r) => r.map((l) => ({ libelle: l.libelle, valeur: l.moyenne, nombre: l.nombre }));
    const hBarres = (n) => Math.min(200, n * 21 + 30);
    const hB = (n) => n * 21 + 18 + 40;
    const blocs = [
      () => R.encadre(hB(7), () => {
        R.sousTitre('Par jour de la semaine', hBarres(7));
        R.barres(enBarres(C.humeurParJourSemaine(evals)).map((l) => ({ ...l, libelle: C.majuscule(l.libelle) })));
      }),
      () => R.encadre(hB(parSituation.lignes.length || 1), () => {
        R.sousTitre('Par situation professionnelle', hBarres(parSituation.lignes.length || 1));
        if (parSituation.lignes.length) {
          R.barres(enBarres(parSituation.lignes));
          if (parSituation.sansValeur) R.paragraphe(`${C.pluriel(parSituation.sansValeur, 'évaluation')} sans situation indiquée.`, { taille: 8.3, couleur: DOUX });
        } else R.paragraphe('Aucune situation professionnelle indiquée sur la période.', { taille: 9.5, couleur: DOUX });
      }),
      () => R.encadre(hB(Math.min(12, parLieu.lignes.length) || 1), () => {
        R.sousTitre('Par lieu', hBarres(parLieu.lignes.length || 1));
        if (parLieu.lignes.length) {
          R.barres(enBarres(parLieu.lignes.slice(0, 12)).map((x, i) => ({ ...x, libelle: C.libelleLieu(parLieu.lignes[i].valeur) })));
          if (parLieu.sansValeur) R.paragraphe(`${C.pluriel(parLieu.sansValeur, 'évaluation')} sans lieu indiqué.`, { taille: 8.3, couleur: DOUX });
        } else R.paragraphe('Aucun lieu indiqué sur la période.', { taille: 9.5, couleur: DOUX });
      }),
    ];
    const carte = parLieu.lignes.length ? preparationCarte(evals) : null;
    if (carte) {
      blocs.push(() => R.encadre((TAILLE_CARTE.hauteur / TAILLE_CARTE.largeur) * LARGEUR + 110, async () => {
        R.sousTitre('Carte des lieux', (TAILLE_CARTE.hauteur / TAILLE_CARTE.largeur) * LARGEUR + 40);
        await R.carteLieux(carte.points, carte.cadre, options.fondCarte || null);
        const sansCoord = carte.sansCoordonnees > 1 ? ` ${carte.sansCoordonnees} lieux sans coordonnées (saisis librement, ou « En route ») n'apparaissent pas sur la carte.` : carte.sansCoordonnees ? ' Un lieu sans coordonnées (saisi librement, ou « En route ») n\'apparaît pas sur la carte.' : '';
        R.paragraphe(`Taille du disque : nombre d'évaluations ; couleur et pictogramme météo : humeur moyenne (ressenti sur place quand il est indiqué), du plus sombre (humeur basse) au doré (humeur haute).${sansCoord}${options.fondCarte ? '' : ' Fond de carte non affiché (désactivé dans les réglages ou hors connexion).'}`, { taille: 8.3, couleur: DOUX, apres: 0 });
      }));
    }
    if (parActivite.lignes.length) {
      blocs.push(() => R.encadre(hB(Math.min(12, parActivite.lignes.length)), () => {
        R.sousTitre('Par activité', hBarres(parActivite.lignes.length));
        R.barres(enBarres(parActivite.lignes.slice(0, 12)));
      }));
    }
    const multi = evals.some((e) => C.lieuxDe(e).length > 1);
    const surPlace = evals.reduce((t, e) => t + C.lieuxDe(e).filter((l) => C.ressentiValide(l.ressenti) !== null).length, 0);
    const texteRessenti = surPlace ? ` Pour les lieux et les activités, la moyenne utilise le « ressenti sur place » quand le patient l'a indiqué (${C.pluriel(surPlace, 'lieu')} de la période), sinon la note de la période : c'est le cas lorsqu'il s'est rendu à plusieurs endroits et que son humeur y a été différente.` : '';
    await chapitre('Jours, situations, lieux et activités', {
      avant: () => R.paragraphe('Humeur moyenne (sur 10) selon le jour de la semaine, la situation professionnelle, le lieu et l\'activité déclarés par le patient. Le libellé en gras signale la moyenne la plus basse (au moins 2 évaluations).', { taille: 9, couleur: DOUX, apres: 6 }),
      blocs,
      apres: () => R.paragraphe(`Moyennes descriptives des notes selon les informations déclarées par le patient ; elles ne permettent pas d'établir un lien de cause à effet. Une moyenne calculée sur moins de 4 évaluations est peu représentative.${multi || parActivite.lignes.length ? ' Une évaluation où plusieurs lieux ou activités sont indiqués compte pour chacun d\'eux. « En route » désigne un déplacement (à pied, à vélo, en voiture, en bus, en train, en avion, en bateau…).' : ''}${texteRessenti}`, { taille: 8.3, couleur: DOUX }),
    });
  }

  // 10. Prévisions et réalité
  R.section(++numSection, 'Comparaison entre prévisions et réalité');
  if (!prev.lignes.length) R.paragraphe('Aucune prévision n\'a été formulée sur la période.');
  else {
    const etatCible = (l) => {
      if (l.ecart !== null) return l.ecart === 0 ? '0 (identique)' : C.signeFr(l.ecart, 0);
      const st = statutParId.get(C.idCreneau(l.cible.date, l.cible.creneau));
      return st === 'omis' ? 'créneau omis' : st === 'en_attente' ? 'en attente de réponse' : st === 'a_rattraper' ? 'à rattraper' : st === 'a_venir' ? 'à venir' : 'pas de réponse';
    };
    let lignesPrev = prev.lignes;
    if (type === 'synthetique' && lignesPrev.length > 12) {
      lignesPrev = [...prev.lignes].filter((l) => l.ecart !== null).sort((a, b) => Math.abs(b.ecart) - Math.abs(a.ecart)).slice(0, 10)
        .sort((a, b) => (a.source.creneauId < b.source.creneauId ? -1 : 1));
      R.paragraphe(`Rapport synthétique : seules les 10 prévisions présentant les écarts les plus importants sont listées (sur ${prev.lignes.length}).`, { taille: 8.5, couleur: DOUX });
    }
    R.tableau(
      [{ titre: 'Prévision faite le', part: 1.6 }, { titre: 'Créneau visé', part: 1.6 }, { titre: 'Prévue', part: 0.9 }, { titre: 'Constatée', part: 1 }, { titre: 'Écart', part: 1.5 }],
      lignesPrev.map((l) => [libCreneau(l.source), libCreneau(l.cible), `${l.prevue}/10`, l.reelle === null ? '—' : `${l.reelle}/10`, etatCible(l)]),
    );
    if (prev.nombreComparees) {
      R.paragraphe(`Sur ${C.pluriel(prev.nombreComparees, 'prévision comparable', 'prévisions comparables')} : ${prev.exactes} identique(s), ${prev.realiteSuperieure} où la note constatée est supérieure, ${prev.realiteInferieure} où elle est inférieure. Écart moyen : ${C.signeFr(prev.ecartMoyen)} point ; écart absolu moyen : ${C.nombreFr(prev.ecartAbsoluMoyen)} point.`, { taille: 9.5 });
    } else R.paragraphe('Aucune prévision ne peut encore être comparée à une note constatée.', { taille: 9.5, couleur: DOUX });
    const motifPrev = (l) => (textes.get(l.source.id) || C.textesPourRapport(l.source, modeTextes)).prevision;
    const motifsPrev = prev.lignes.filter((l) => motifPrev(l));
    if (motifsPrev.length) {
      R.sousTitre('Motifs des prévisions');
      R.puces(motifsPrev.map((l) => `Pour ${libCreneau(l.cible)} (${l.prevue}/10) : ${motifPrev(l)}`), { taille: 9.5 });
    }
  }

  // ===== Partie V – Conclusion et points à aborder
  await R.partie('V', 'Conclusion', { besoin: 200 });
  // 11. Synthèse neutre
  // Fin du rapport : conclusion et points à aborder (synthèse validée, rédigée avec Claude) ;
  // à défaut, relevé factuel automatique des sujets possibles
  {
    const parts = synthese ? C.partiesSynthese(synthese.texte) : null;
    if (parts && (parts.conclusion.length || parts.points.length)) {
      R.section(++numSection, 'Conclusion et points à aborder', 120);
      parts.conclusion.forEach((l, k) => (k === 0 ? R.riche([['Conclusion : ', 'gras'], [l]], { taille: 10.5, apres: 6 }) : R.paragraphe(l, { taille: 10.5, apres: 6 })));
      if (parts.points.length) {
        R.paragraphe('Points à aborder en séance :', { taille: 10.5, police: 'gras', apres: 4 });
        R.puces(parts.points, { taille: 10.5 });
      }
      R.paragraphe(`Rédigé ${synthese.source === 'assistant' ? 'avec l\'aide d\'un assistant (Claude, Anthropic) ' : ''}à partir des données de la période, relu et validé par le patient${synthese.valideeLeUtc ? ` le ${C.formatDateHeure(synthese.valideeLeUtc)}` : ''}. Il s'agit de constats et de propositions de sujets, non d'une évaluation clinique.`, { taille: 8.3, police: 'italique', couleur: DOUX });
    } else {
      R.section(++numSection, 'Points à aborder en séance');
      R.paragraphe('Relevé factuel établi automatiquement à partir des saisies, sans interprétation (aucune conclusion rédigée et validée pour cette période) ; libre au patient et au thérapeute de s\'en saisir ou non.', { taille: 9, couleur: DOUX });
      R.puces(C.sujetsDeDiscussion(evals, freq, prev, comptes));
    }
  }

  R.dessinerSommaire(pageSommaire, ySommaire, 1);
  R.paginer('Document personnel et confidentiel – données de santé');
  return doc.save();
}
