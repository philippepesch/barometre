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

const ENCRE = '#1E2A33';
const DOUX = '#5E6B74';
const FILET = '#CDD4D9';
const LAITON = '#8A6D35';
const FOND = '#F1F3F4';

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
  cadre(x, yHaut, l, h, { fond = null, bord = null, epaisseur = 0.6, rayon = 5 } = {}) {
    const r = Math.min(rayon, l / 2, h / 2);
    const d = `M${x + r} ${yHaut} H${x + l - r} A${r} ${r} 0 0 1 ${x + l} ${yHaut + r} V${yHaut + h - r} A${r} ${r} 0 0 1 ${x + l - r} ${yHaut + h} `
      + `H${x + r} A${r} ${r} 0 0 1 ${x} ${yHaut + h - r} V${yHaut + r} A${r} ${r} 0 0 1 ${x + r} ${yHaut} Z`;
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
  }

  place(h) { if (this.y + h > BAS_CONTENU) { this.nouvellePage(); return true; } return false; }

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
    this.page.drawCircle({ x: MARGE + 9, y: A4[1] - (this.y + 7.5), size: 9, color: this.couleur(LAITON) });
    this.texte(num, MARGE + 9 - this.largeur(num, 9, 'gras') / 2, this.y + 10.7, { taille: 9, police: 'gras', couleur: '#FFFFFF' });
    this.riche([[C.majuscule(C.libelleMomentEvenement(x)), 'gras'], ...(x.titre ? [[` – ${x.titre}`, 'gras']] : [])], { taille: 10.5, retrait: R0, apres: 3 });
    const bloc = (etiquette, texte, couleur) => {
      if (!texte) return;
      this.place(30);
      this.texte(etiquette.toUpperCase(), MARGE + R0, this.y + 7.5, { taille: 7.2, police: 'gras', couleur: DOUX });
      this.y += 11;
      for (const para of texte.split(/\n+/).map((t) => t.trim()).filter(Boolean)) this.paragraphe(para, { taille: 9.6, retrait: R0, couleur, apres: 3 });
      this.y += 2;
    };
    bloc('Ce qui s\'est passé', x.faits, ENCRE);
    bloc('Vécu du patient', x.vecu, '#3B4550');
    this.place(8);
    this.page.drawLine({ start: { x: MARGE + R0, y: A4[1] - this.y - 2 }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y - 2 }, thickness: 0.5, color: this.couleur(FILET) });
    this.y += 12;
  }

  section(numero, titre, besoin = 90, { nouvellePage = false } = {}) {
    if (nouvellePage && this.y > HAUT_CONTENU + 1) this.nouvellePage();
    else if (!this.place(50 + besoin)) this.y += 16;
    const num = String(numero);
    this.cadre(MARGE, this.y, 22, 22, { fond: LAITON, rayon: 4 });
    this.texte(num, MARGE + 11 - this.largeur(num, 11, 'gras') / 2, this.y + 15.2, { taille: 11, police: 'gras', couleur: '#FFFFFF' });
    this.texte(titre, MARGE + 32, this.y + 16, { taille: 14, police: 'gras' });
    this.page.drawLine({ start: { x: MARGE, y: A4[1] - this.y - 29 }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y - 29 }, thickness: 0.8, color: this.couleur(FILET) });
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
      this.cadre(x, this.y, l, h, { fond: FOND, rayon: 5 });
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
    const dessinerEntete = () => {
      const h = taille * 1.4 + 2 * pad;
      this.page.drawRectangle({ x: MARGE, y: A4[1] - this.y - h, width: LARGEUR, height: h, color: this.couleur('#E6EBEE') });
      let x = MARGE;
      colonnes.forEach((c, i) => { this.texte(c.titre, x + pad, this.y + pad + taille, { taille, police: 'gras' }); x += largeurs[i]; });
      this.y += h;
    };
    this.place(taille * 1.4 * 3 + 4 * pad);
    dessinerEntete();
    for (const ligne of lignes) {
      const cellules = ligne.map((v, i) => this.couper(String(v ?? ''), taille, colonnes[i].gras ? 'gras' : 'normal', largeurs[i] - 2 * pad));
      const nb = Math.max(...cellules.map((c) => c.length));
      const h = nb * taille * 1.38 + 2 * pad;
      if (this.place(h)) dessinerEntete();
      let x = MARGE;
      cellules.forEach((c, i) => {
        c.forEach((l, k) => this.texte(l, x + pad, this.y + pad + taille + k * taille * 1.38, { taille, police: colonnes[i].gras ? 'gras' : 'normal', couleur: colonnes[i].doux ? DOUX : ENCRE }));
        x += largeurs[i];
      });
      this.y += h;
      this.page.drawLine({ start: { x: MARGE, y: A4[1] - this.y }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y }, thickness: 0.4, color: this.couleur(FILET) });
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
    this.place(hauteur + legende + 40 + hBandes + (avecBandes ? 40 : 0) + (marques.length ? 18 : 0));
    // À gauche : note et pictogramme météo de chaque niveau ; à droite : nom du niveau
    const gauche = MARGE + 36, droite = MARGE + LARGEUR - 60;
    const haut = this.y + 6, bas = this.y + hauteur - 26;
    const n = grille.length;
    const xDe = (i) => (n <= 1 ? (gauche + droite) / 2 : gauche + 8 + (i * (droite - gauche - 16)) / (n - 1));
    const yDe = (note) => bas - (note / 10) * (bas - haut);
    const P = (x, y) => ({ x, y: A4[1] - y });
    for (let v = 0; v <= 10; v++) {
      this.page.drawLine({ start: P(gauche, yDe(v)), end: P(droite, yDe(v)), thickness: v === 0 ? 0.7 : 0.35, color: this.couleur(v === 0 ? '#9AA5AD' : v % 2 ? '#EEF1F3' : '#E1E6E9') });
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
      this.page.drawLine({ start: P(xDe(i), bas), end: P(xDe(i), bas + 3), thickness: 0.5, color: this.couleur('#9AA5AD') });
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
        const y = bas - 8, r = 2.6, g = this.couleur('#9AA5AD');
        this.page.drawLine({ start: P(x - r, y - r), end: P(x + r, y + r), thickness: 0.9, color: g });
        this.page.drawLine({ start: P(x - r, y + r), end: P(x + r, y - r), thickness: 0.9, color: g });
      }
    });
    this.y = bas + 26;
    // Événements marquants : pastilles numérotées sous les dates, à la position du créneau concerné
    if (marques.length) {
      const parIndex = new Map();
      for (const m of marques) { const i = indexParId.get(m.creneauId); if (i === undefined) continue; parIndex.set(i, [...(parIndex.get(i) || []), m.numero]); }
      const yM = this.y + 2;
      for (const [i, nums] of parIndex) {
        const lib = nums.join(',');
        const w = Math.max(11, this.largeur(lib, 7, 'gras') + 6);
        const x = xDe(i);
        this.page.drawLine({ start: P(x, bas), end: P(x, yM), thickness: 0.5, color: this.couleur(LAITON), dashArray: [1.5, 1.5] });
        this.cadre(x - w / 2, yM, w, 11, { fond: LAITON, rayon: 5.5 });
        this.texte(lib, x - this.largeur(lib, 7, 'gras') / 2, yM + 8, { taille: 7, police: 'gras', couleur: '#FFFFFF' });
      }
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
          else this.page.drawRectangle({ x: x0 + 0.7, y: A4[1] - y0 - 9, width: w, height: 9, color: this.couleur('#F1F3F4'), borderColor: this.couleur(FILET), borderWidth: 0.5 });
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
    item((cx, cy) => { const g = this.couleur('#9AA5AD'); this.page.drawLine({ start: P(cx - 2.6, cy - 2.6), end: P(cx + 2.6, cy + 2.6), thickness: 0.9, color: g }); this.page.drawLine({ start: P(cx - 2.6, cy + 2.6), end: P(cx + 2.6, cy - 2.6), thickness: 0.9, color: g }); }, 'Créneau omis');
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
          else this.page.drawRectangle({ x: xl, y: A4[1] - yy - 3.5, width: 8, height: 8, color: this.couleur('#F1F3F4'), borderColor: this.couleur(FILET), borderWidth: 0.5 });
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
    const pas = 16;
    const parCol = Math.ceil(this.sommaire.length / colonnes);
    const lc = (LARGEUR - 20 - (colonnes - 1) * 18) / colonnes;
    this.sommaire.forEach((e, i) => {
      const col = Math.floor(i / parCol), lig = i % parCol;
      const x = MARGE + 10 + col * (lc + 18), y = yHaut + lig * pas;
      const num = `${e.numero}`;
      const pg = String(e.page + 1);
      this.texte(num, x + 12 - this.largeur(num, 9, 'gras'), y + 9, { taille: 9, police: 'gras', couleur: LAITON });
      const titre = this.couper(e.titre, 9, 'normal', lc - 50)[0] + (this.largeur(e.titre, 9) > lc - 50 ? '…' : '');
      this.texte(titre, x + 18, y + 9, { taille: 9 });
      const fin = x + 18 + this.largeur(titre, 9) + 4, xp = x + lc - this.largeur(pg, 9, 'gras');
      if (xp - 4 > fin) page.drawLine({ start: { x: fin, y: A4[1] - y - 8.4 }, end: { x: xp - 4, y: A4[1] - y - 8.4 }, thickness: 0.7, color: this.couleur('#AEB8BF'), dashArray: [0.7, 2.3] });
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
  barres(lignes, { mode = 'humeur', couleur = '#5E97C6', max = null, signalerBas = true } = {}) {
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
        this.page.drawLine({ start: { x, y: A4[1] - yA }, end: { x, y: A4[1] - yB }, thickness: v === 0 ? 0.6 : 0.3, color: this.couleur(v === 0 ? '#9AA5AD' : '#E1E6E9') });
      }
    };
    for (const l of lignes) {
      this.place(hLigne + 14);
      graduer(this.y, this.y + hLigne);
      const yc = this.y + hLigne / 2;
      const bas = plusBas && l === plusBas;
      const lignesLib = this.couper(l.libelle, 9, bas ? 'gras' : 'normal', colLib - 8);
      const lib = lignesLib.length > 1 ? `${lignesLib[0].replace(/[\s,;:]+$/, '')}…` : lignesLib[0];
      this.texte(lib, MARGE, yc + 3.2, { taille: 9, police: bas ? 'gras' : 'normal' });
      if (l.valeur !== null && l.nombre > 0) {
        const w = Math.max(2, (l.valeur / vmax) * (x1 - x0));
        const coul = mode === 'humeur' ? COULEURS_NIVEAUX[Math.max(0, Math.min(10, Math.round(l.valeur)))] : couleur;
        this.cadre(x0, yc - hBarre / 2, w, hBarre, { fond: coul, rayon: 2 });
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
    const DEF = '#57627C', FAV = '#5E97C6';
    this.texte('Défavorable', centre - 8 - this.largeur('Défavorable', 8.5, 'gras'), this.y + 9, { taille: 8.5, police: 'gras', couleur: DEF });
    this.texte('Favorable', centre + 8, this.y + 9, { taille: 8.5, police: 'gras', couleur: FAV });
    this.y += 16;
    const yHaut = this.y;
    for (const l of lignes) {
      const yc = this.y + hLigne / 2;
      this.texte(l.libelle, MARGE, yc + 3.4, { taille: 9.5, police: 'gras' });
      const wd = (l.defavorable / max) * demi, wf = (l.favorable / max) * demi;
      if (l.defavorable) {
        this.cadre(centre - 1 - wd, yc - hBarre / 2, wd, hBarre, { fond: DEF, rayon: 2 });
        const t = String(l.defavorable);
        this.texte(t, centre - 1 - wd - 4 - this.largeur(t, 9, 'gras'), yc + 3.2, { taille: 9, police: 'gras' });
      }
      if (l.favorable) {
        this.cadre(centre + 1, yc - hBarre / 2, wf, hBarre, { fond: FAV, rayon: 2 });
        this.texte(String(l.favorable), centre + 1 + wf + 4, yc + 3.2, { taille: 9, police: 'gras' });
      }
      if (!l.defavorable && !l.favorable) this.texte('—', centre + 6, yc + 3.2, { taille: 9, couleur: DOUX });
      this.y += hLigne;
    }
    this.page.drawLine({ start: { x: centre, y: A4[1] - yHaut + 2 }, end: { x: centre, y: A4[1] - this.y }, thickness: 0.8, color: this.couleur('#9AA5AD') });
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
    this.page.drawLine({ start: { x: MARGE, y: A4[1] - base }, end: { x: MARGE + LARGEUR, y: A4[1] - base }, thickness: 0.6, color: this.couleur('#9AA5AD') });
    compte.forEach((n, i) => {
      const xc = MARGE + i * pas + pas / 2;
      if (n) {
        const hb = Math.max(3, (n / max) * (h - 16));
        this.cadre(xc - lb / 2, base - hb, lb, hb, { fond: COULEURS_NIVEAUX[i], rayon: 2 });
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
    if (fondPng) {
      try {
        const img = await this.doc.embedPng(fondPng);
        this.page.drawImage(img, { x: MARGE, y: A4[1] - yH - h, width: l, height: h });
      } catch { fondPng = null; }
    }
    if (!fondPng) this.page.drawRectangle({ x: MARGE, y: A4[1] - yH - h, width: l, height: h, color: this.couleur('#F4F6F7') });
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
      this.texte(t1, xe + 23, ye + 9, { taille: 8, police: 'gras' });
      this.texte(t2, xe + 23, ye + 18.5, { taille: 7, couleur: DOUX });
    }
    // Échelle et attribution
    const lat = points.reduce((a, p) => a + p.lat, 0) / points.length;
    const e = K.echelle(cadre, lat);
    const xe = MARGE + 10, ye = yH + h - 10;
    this.page.drawRectangle({ x: xe - 4, y: A4[1] - ye - 4, width: e.pixels * k + 8 + this.largeur(e.libelle, 7) + 6, height: 13, color: this.couleur('#FFFFFF'), opacity: 0.85 });
    this.page.drawLine({ start: { x: xe, y: A4[1] - ye }, end: { x: xe + e.pixels * k, y: A4[1] - ye }, thickness: 1.6, color: this.couleur(ENCRE) });
    this.texte(e.libelle, xe + e.pixels * k + 4, ye + 2.5, { taille: 7, couleur: ENCRE });
    if (fondPng) {
      const a = K.ATTRIBUTION;
      const wa = this.largeur(a, 6.5) + 6;
      this.page.drawRectangle({ x: MARGE + l - wa, y: A4[1] - yH - h, width: wa, height: 10, color: this.couleur('#FFFFFF'), opacity: 0.85 });
      this.texte(a, MARGE + l - wa + 3, yH + h - 2.5, { taille: 6.5, couleur: DOUX });
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
  const textes = new Map(evals.map((e) => [e.id, C.textesPourRapport(e, modeTextes)]));
  const nbReformules = [...textes.values()].filter((t) => t.reformule).length;
  const modifsReelles = (e) => (e.historique || []).filter((h) => h.changements.some((c) => c.champ !== 'reformulation') && !estCompletion(h));
  const parametres = donnees.parametres || {};
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
  const polices = {
    normal: await doc.embedFont(PDFLib.StandardFonts.Helvetica),
    gras: await doc.embedFont(PDFLib.StandardFonts.HelveticaBold),
    italique: await doc.embedFont(PDFLib.StandardFonts.HelveticaOblique),
  };
  const periodeCourte = `Du ${C.formatDateCourte(debut)} au ${C.formatDateCourte(fin)}`;
  const R = new Redacteur(PDFLib, doc, polices, { gauche: `Baromètre de l'humeur – ${patient.nom ? `${patient.nom} – ` : ''}${titreDoc}`, droite: periodeCourte });

  // Page de garde : titre, identités, informations du rapport, chiffres clés, sommaire
  R.y = 46;
  R.page.drawRectangle({ x: 0, y: A4[1] - 8, width: A4[0], height: 8, color: R.couleur(LAITON) });
  R.texte('BAROMÈTRE DE L\'HUMEUR  ·  RAPPORT DE SUIVI', MARGE, R.y + 9, { taille: 8.5, police: 'gras', couleur: LAITON });
  R.y += 18;
  R.paragraphe(titreDoc, { taille: 24, police: 'gras', interligne: 1.15, apres: 2 });
  R.paragraphe(`Du ${C.formatDateLongue(debut)} au ${C.formatDateLongue(fin)}`, { taille: 12, police: 'gras', couleur: DOUX, apres: 12 });

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
      R.cadre(x, R.y, col, h, { fond: FOND, rayon: 6 });
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
      prochaine ? ['Prochaine séance', C.libelleSeance(prochaine)] : null,
      ['Type de rapport', type === 'complet' ? 'complet (annexe intégrale)' : 'synthétique (annexe abrégée)'],
      ['Établi le', `${C.formatDateHeure(instant)} (heure de Luxembourg)`],
    ].filter(Boolean);
    for (const [lib, val] of infos) {
      R.texte(lib, MARGE, R.y + 9.5, { taille: 9, couleur: DOUX });
      R.couper(val, 9.5, 'gras', LARGEUR - 120).forEach((l, k) => R.texte(l, MARGE + 120, R.y + 9.5 + k * 13, { taille: 9.5, police: 'gras' }));
      R.y += 15.5;
      R.page.drawLine({ start: { x: MARGE, y: A4[1] - R.y + 3 }, end: { x: MARGE + LARGEUR, y: A4[1] - R.y + 3 }, thickness: 0.35, color: R.couleur('#E1E6E9') });
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
  const avecEvenements = !!(evenements.length || contexte);
  const NB_SECTIONS = 12 + (synthese ? 1 : 0) + (avecDomaines ? 1 : 0) + (avecEvenements ? 1 : 0);
  let numSection = 0;
  const hSommaire = NB_SECTIONS * 16 + 40;
  R.cadre(MARGE, R.y, LARGEUR, hSommaire, { bord: FILET, epaisseur: 0.8, rayon: 6 });
  R.texte('Sommaire', MARGE + 10, R.y + 20, { taille: 12, police: 'gras' });
  const pageSommaire = R.page, ySommaire = R.y + 30;
  R.y += hSommaire + 12;

  // Avertissement
  const avert = 'Toutes les données proviennent exclusivement des saisies du patient dans l\'application. Les chiffres sont descriptifs : ils ne constituent ni un diagnostic ni une évaluation clinique, et ne remplacent pas l\'échange avec le thérapeute.'
    + (nbReformules ? ` ${nbReformules === 1 ? 'Un commentaire est présenté' : `${nbReformules} commentaires sont présentés`} dans une version rédigée à partir de ses saisies (orthographe corrigée, traduite en français si nécessaire), relue et validée par le patient${modeTextes === 'les-deux' ? ', suivie du texte original' : ' ; les textes originaux sont conservés dans l\'application'}.` : '');
  const lignesAvert = R.couper(avert, 8.6, 'italique', LARGEUR - 24);
  const hAvert = lignesAvert.length * 8.6 * 1.4 + 14;
  R.place(hAvert);
  R.cadre(MARGE, R.y, LARGEUR, hAvert, { fond: FOND, rayon: 5 });
  lignesAvert.forEach((l, i) => R.texte(l, MARGE + 12, R.y + 7 + 8.6 + i * 8.6 * 1.4, { taille: 8.6, police: 'italique', couleur: DOUX }));
  R.y += hAvert + 4;

  // 2. Évaluations attendues, complétées, omises
  // Synthèse de la période (rédigée avec l'accord du patient, relue et validée par lui)
  if (synthese) {
    R.section(++numSection, 'Synthèse de la période', 120, { nouvellePage: true });
    for (const ligne of String(synthese.texte).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const m = /^(Évolution|Points prioritaires)\s*:\s*(.*)$/i.exec(ligne);
      if (m) {
        R.y += 2;
        if (m[2]) R.riche([[`${m[1]} : `, 'gras'], [m[2]]], { taille: 10, apres: 4 });
        else R.paragraphe(`${m[1]} :`, { taille: 10, police: 'gras', apres: 2 });
      } else if (/^[–\-•]\s*/.test(ligne)) R.puces([ligne.replace(/^[–\-•]\s*/, '')], { taille: 10 });
      else R.paragraphe(ligne, { taille: 10, apres: 4 });
    }
    R.paragraphe(`Synthèse rédigée ${synthese.source === 'assistant' ? 'avec l\'aide d\'un assistant (Claude, Anthropic) ' : ''}à partir des données de la période, relue et validée par le patient${synthese.valideeLeUtc ? ` le ${C.formatDateHeure(synthese.valideeLeUtc)}` : ''}. Elle décrit des constats et ne constitue pas une évaluation clinique.`, { taille: 8.3, police: 'italique', couleur: DOUX });
  }

  if (avecEvenements) {
    R.section(++numSection, evenements.length ? (contexte ? 'Contexte et événements marquants' : 'Événements marquants') : 'Contexte', 120, { nouvellePage: !synthese });
    if (contexte) {
      if (evenements.length) R.sousTitre('Contexte indiqué par le patient');
      for (const para of contexte.texte.split(/\n+/).map((t) => t.trim()).filter(Boolean)) R.paragraphe(para, { taille: 10, apres: 4 });
      if (contexte.modifieLeUtc) R.paragraphe(`Mis à jour le ${C.formatDateHeure(contexte.modifieLeUtc)}.`, { taille: 8.3, couleur: DOUX });
    }
    if (evenements.length) {
      if (contexte) R.sousTitre('Événements de la période');
      evenements.forEach((x, i) => R.evenement(i + 1, x));
      R.paragraphe('Notes saisies ou importées par le patient, qui en a validé le contenu. Elles distinguent ce qui s\'est passé de ce qu\'il a ressenti ; les messages de tiers sont résumés et ne présument pas de leurs intentions. Les numéros renvoient aux pastilles du graphique chronologique.', { taille: 8.3, police: 'italique', couleur: DOUX });
    }
  }

  R.section(++numSection, 'Évaluations attendues, complétées et omises', 90, { nouvellePage: !synthese && !avecEvenements });
  R.chiffres([
    { valeur: String(comptes.attendues), libelle: 'attendues' },
    { valeur: String(comptes.completees), libelle: 'complétées' },
    { valeur: String(comptes.omises), libelle: 'omises' },
    { valeur: String(comptes.enAttente + comptes.aRattraper), libelle: comptes.aRattraper ? 'en attente ou à rattraper' : 'en attente de réponse' },
  ]);
  const det = [];
  det.push(`Deux créneaux par jour : matin (rappel à 06:00) et soir (rappel à 18:00), heure de Luxembourg. Un créneau reste ouvert jusqu'au rappel suivant ; il peut ensuite encore être rempli pendant ${C.DELAI_RATTRAPAGE_H} heures (saisie signalée en retard). Au-delà, il est compté comme omis s'il n'a pas reçu de réponse.`);
  const partsCompl = [];
  if (comptes.aLHeure) partsCompl.push(`${comptes.aLHeure} dans le créneau`);
  if (comptes.enRetard) partsCompl.push(`${comptes.enRetard} après la fin du créneau (saisie rétrospective)`);
  if (comptes.heureInconnue) partsCompl.push(`${comptes.heureInconnue} dont l'heure de saisie est inconnue (donnée historique antérieure à l'application)`);
  if (partsCompl.length) det.push(`Évaluations complétées : ${partsCompl.join(' ; ')}.`);
  if (comptes.nonRenseignees) det.push(`${C.pluriel(comptes.nonRenseignees, 'créneau antérieur', 'créneaux antérieurs')} au début du suivi dans l'application (${C.formatDateHeure(parametres.debutSuiviUtc)}) ${comptes.nonRenseignees > 1 ? 'sont marqués' : 'est marqué'} « non renseigné » et ${comptes.nonRenseignees > 1 ? 'ne sont pas comptés' : 'n\'est pas compté'} comme attendu${comptes.nonRenseignees > 1 ? 's' : ''}.`);
  if (comptes.aVenir) det.push(`${C.pluriel(comptes.aVenir, 'créneau', 'créneaux')} de la période ${comptes.aVenir > 1 ? 'sont' : 'est'} encore à venir.`);
  for (const d of det) R.paragraphe(d, { taille: 9.5, couleur: DOUX, apres: 4 });

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
  R.section(++numSection, 'Répartition des notes', 170);
  if (!stats.nombre) R.paragraphe('Aucune évaluation sur la période.');
  else {
    R.paragraphe('Nombre d\'évaluations pour chaque note, de 0 (Alerte rouge) à 10 (Plein soleil).', { taille: 8.5, couleur: DOUX, apres: 4 });
    R.histogramme(C.repartitionNotes(evals));
    const quand = (l) => l.map((e) => libCreneau(e)).join(', ');
    R.riche([['Note minimale : ', 'gras'], [`${C.libelleNote(stats.min)} (${quand(stats.evaluationsMin)})`]], { taille: 9.5 });
    R.riche([['Note maximale : ', 'gras'], [`${C.libelleNote(stats.max)} (${quand(stats.evaluationsMax)})`]], { taille: 9.5 });
  }

  // 4. Graphique
  R.section(++numSection, 'Graphique chronologique', 330);
  if (grille.length > 2 * 400) {
    R.paragraphe('Période trop longue pour un graphique lisible (plus de 400 jours) : réduisez la période pour l\'afficher.', { couleur: DOUX });
  } else {
    R.graphique(grille, prev, { couleurLieu, couleurSituation, legendeLieux, legendeSituations, evenements: evenements.map((x, i) => ({ numero: i + 1, creneauId: C.creneauEvenement(x) })) });
    R.paragraphe(`Chaque position horizontale correspond à un créneau (matin puis soir). La ligne relie les notes de créneaux consécutifs ; elle s'interrompt lorsqu'un créneau n'a pas de réponse.${parLieu.lignes.length || parSituation.lignes.length ? ' Sous les dates, les bandes de couleur indiquent le lieu de séjour et la situation professionnelle déclarés par le patient pour chaque créneau ; lorsque plusieurs lieux ont été indiqués, le créneau est partagé entre eux, dans l\'ordre.' : ''}${evenements.length ? ' Les pastilles numérotées signalent les événements marquants décrits plus haut, sur le créneau qui les suit (l\'évaluation du soir porte sur la journée, celle du matin sur la soirée et la nuit).' : ''}`, { taille: 8.5, couleur: DOUX });
  }

  // 5. Tendances
  R.section(++numSection, 'Tendances principales');
  R.puces(C.tendancesDescriptives(evals));

  // 6 et 7. Facteurs : barres (nombre de fois où le motif a été coché)
  const barresFacteurs = (pol) => {
    const l = freq.filter((f) => f.polarite === pol);
    if (!l.length) return false;
    const max = Math.max(...freq.map((f) => f.nombre));
    R.barres(l.slice(0, type === 'synthetique' ? 10 : 20).map((f) => ({ libelle: f.libelle, valeur: f.nombre, nombre: f.nombre, detail: `${Math.round((f.nombre / evals.length) * 100)} % des évaluations` })),
      { mode: 'compte', max, couleur: pol === 'favorable' ? '#5E97C6' : pol === 'defavorable' ? '#57627C' : '#9A9C94' });
    if (type === 'synthetique' && l.length > 10) R.paragraphe(`Rapport synthétique : les 10 motifs les plus fréquents sur ${l.length}.`, { taille: 8.5, couleur: DOUX });
    return true;
  };
  const rappelMotifs = 'Nombre de fois où chaque motif a été coché. Seuls les motifs explicitement cochés lors d\'une évaluation sont comptés ; les commentaires libres sont reproduits en annexe.';
  if (avecDomaines) {
    R.section(++numSection, 'Facteurs par domaine', 200);
    R.paragraphe('Chaque motif est rangé selon la source de l\'influence : corps, relations, obligations, environnement, activités ou état d\'esprit.', { taille: 9, couleur: DOUX, apres: 6 });
    R.barresDomaines(domaines, { total: evals.length });
  }
  R.section(++numSection, 'Facteurs favorables mentionnés', 160);
  if (!barresFacteurs('favorable')) R.paragraphe('Aucun facteur favorable n\'a été coché sur la période.');
  R.paragraphe(rappelMotifs, { taille: 8.5, couleur: DOUX });
  R.section(++numSection, 'Facteurs défavorables mentionnés', 160);
  if (!barresFacteurs('defavorable')) R.paragraphe('Aucun facteur défavorable n\'a été coché sur la période.');
  if (freq.some((f) => f.polarite === 'mixte')) { R.sousTitre('Facteurs mixtes'); barresFacteurs('mixte'); }
  R.paragraphe(rappelMotifs, { taille: 8.5, couleur: DOUX });

  // 8. Quand et où l'humeur est la plus basse : jours, situations, lieux (carte), activités
  R.section(++numSection, 'Jours, situations, lieux et activités', 200);
  if (!stats.nombre) R.paragraphe('Aucune évaluation sur la période.');
  else {
    R.paragraphe('Humeur moyenne (sur 10) selon le jour de la semaine, la situation professionnelle, le lieu et l\'activité déclarés par le patient. Le libellé en gras signale la moyenne la plus basse (au moins 2 évaluations).', { taille: 9, couleur: DOUX, apres: 6 });
    const enBarres = (r) => r.map((l) => ({ libelle: l.libelle, valeur: l.moyenne, nombre: l.nombre }));
    const hBarres = (n) => Math.min(200, n * 21 + 30);
    R.sousTitre('Par jour de la semaine', hBarres(7));
    R.barres(enBarres(C.humeurParJourSemaine(evals)).map((l) => ({ ...l, libelle: C.majuscule(l.libelle) })));
    R.sousTitre('Par situation professionnelle', hBarres(parSituation.lignes.length || 1));
    if (parSituation.lignes.length) {
      R.barres(enBarres(parSituation.lignes));
      if (parSituation.sansValeur) R.paragraphe(`${C.pluriel(parSituation.sansValeur, 'évaluation')} sans situation indiquée.`, { taille: 8.3, couleur: DOUX });
    } else R.paragraphe('Aucune situation professionnelle indiquée sur la période.', { taille: 9.5, couleur: DOUX });
    R.sousTitre('Par lieu', hBarres(parLieu.lignes.length || 1));
    if (parLieu.lignes.length) {
      R.barres(enBarres(parLieu.lignes.slice(0, 12)).map((x, i) => ({ ...x, libelle: C.libelleLieu(parLieu.lignes[i].valeur) })));
      if (parLieu.sansValeur) R.paragraphe(`${C.pluriel(parLieu.sansValeur, 'évaluation')} sans lieu indiqué.`, { taille: 8.3, couleur: DOUX });
      const carte = preparationCarte(evals);
      if (carte) {
        R.sousTitre('Carte des lieux', (TAILLE_CARTE.hauteur / TAILLE_CARTE.largeur) * LARGEUR + 40);
        await R.carteLieux(carte.points, carte.cadre, options.fondCarte || null);
        const sansCoord = carte.sansCoordonnees > 1 ? ` ${carte.sansCoordonnees} lieux sans coordonnées (saisis librement, ou « En route ») n'apparaissent pas sur la carte.` : carte.sansCoordonnees ? ' Un lieu sans coordonnées (saisi librement, ou « En route ») n\'apparaît pas sur la carte.' : '';
        R.paragraphe(`Taille du disque : nombre d'évaluations ; couleur et pictogramme météo : humeur moyenne (ressenti sur place quand il est indiqué), du plus sombre (humeur basse) au doré (humeur haute).${sansCoord}${options.fondCarte ? '' : ' Fond de carte non affiché (désactivé dans les réglages ou hors connexion).'}`, { taille: 8.3, couleur: DOUX });
      }
    } else R.paragraphe('Aucun lieu indiqué sur la période.', { taille: 9.5, couleur: DOUX });
    if (parActivite.lignes.length) {
      R.sousTitre('Par activité', hBarres(parActivite.lignes.length));
      R.barres(enBarres(parActivite.lignes.slice(0, 12)));
    }
    const multi = evals.some((e) => C.lieuxDe(e).length > 1);
    const surPlace = evals.reduce((t, e) => t + C.lieuxDe(e).filter((l) => C.ressentiValide(l.ressenti) !== null).length, 0);
    const texteRessenti = surPlace ? ` Pour les lieux et les activités, la moyenne utilise le « ressenti sur place » quand le patient l'a indiqué (${C.pluriel(surPlace, 'lieu')} de la période), sinon la note de la période : c'est le cas lorsqu'il s'est rendu à plusieurs endroits et que son humeur y a été différente.` : '';
    R.paragraphe(`Moyennes descriptives des notes selon les informations déclarées par le patient ; elles ne permettent pas d'établir un lien de cause à effet. Une moyenne calculée sur moins de 4 évaluations est peu représentative.${multi || parActivite.lignes.length ? ' Une évaluation où plusieurs lieux ou activités sont indiqués compte pour chacun d\'eux. « En route » désigne un déplacement (à pied, à vélo, en voiture, en bus, en train, en avion, en bateau…).' : ''}${texteRessenti}`, { taille: 8.3, couleur: DOUX });
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

  // 10. Évaluations manquantes
  R.section(++numSection, 'Évaluations manquantes');
  const omis = grille.filter((s) => s.statut === 'omis');
  const attente = grille.filter((s) => s.statut === 'en_attente' || s.statut === 'a_rattraper');
  const nonRens = grille.filter((s) => s.statut === 'non_renseigne');
  if (!omis.length) R.paragraphe('Aucun créneau omis sur la période.');
  else R.tableau([{ titre: 'Date', part: 2.4 }, { titre: 'Créneau', part: 1 }, { titre: 'Rappel prévu', part: 1.2 }], omis.map((s) => [C.formatDateLongue(s.date), C.LIBELLE_CRENEAU[s.creneau], C.formatHeure(s.prevuUtc)]));
  if (attente.length) R.paragraphe(`En attente de réponse ou encore à rattraper (délai de ${C.DELAI_RATTRAPAGE_H} h) au moment du rapport : ${attente.map(libCreneau).join(', ')}.`, { taille: 9.5 });
  if (nonRens.length) R.paragraphe(`Non renseigné (antérieur au début du suivi dans l'application, données inconnues) : ${nonRens.map(libCreneau).join(', ')}.`, { taille: 9.5, couleur: DOUX });

  // 11. Synthèse neutre
  R.section(++numSection, 'Sujets susceptibles d\'être abordés en séance');
  R.paragraphe('Relevé factuel établi automatiquement à partir des saisies, sans interprétation ; libre au patient et au thérapeute de s\'en saisir ou non.', { taille: 9, couleur: DOUX });
  R.puces(C.sujetsDeDiscussion(evals, freq, prev, comptes));

  // 12. Annexe
  R.section(++numSection, 'Annexe chronologique des évaluations', 120, { nouvellePage: true });
  if (!evals.length) R.paragraphe('Aucune évaluation sur la période.');
  const heureValidation = (e) => (e.validationConnue && e.valideLeUtc ? C.formatDateHeure(e.valideLeUtc) : 'inconnue (donnée historique)');
  if (type === 'synthetique' && evals.length) {
    const tronquer = (t, n = 220) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')} […]` : t);
    R.tableau(
      [{ titre: 'Créneau', part: 1.3 }, { titre: 'Note', part: 1.3 }, { titre: 'Saisie', part: 1.3 }, { titre: 'Motifs et commentaire', part: 4.2 }],
      evals.map((e) => [
        [libCreneau(e), e.lieu ? libLieux(e) : '', e.situation ? C.libelleSituation(e.situation) : ''].filter(Boolean).join('\n'), C.libelleNote(e.note), heureValidation(e) + (e.saisieRetrospective ? ' – rétrospective' : '') + (modifsReelles(e).length ? ' – modifiée' : ''),
        [[...e.motifs, ...e.autresMotifs].map((m) => m.libelle).join(', '), tronquer([textes.get(e.id).explication, textes.get(e.id).complement].filter(Boolean).join(' '))].filter(Boolean).join(' — ') || '—',
      ]),
      { taille: 8.5 },
    );
    R.paragraphe(`Rapport synthétique : les commentaires longs sont abrégés ; le rapport complet les reproduit intégralement.${nbReformules ? ' Les commentaires reformulés sont repris dans leur version validée par le patient.' : ''}`, { taille: 8.5, couleur: DOUX });
  } else {
    for (const e of evals) {
      R.place(80);
      R.y += 8;
      R.cadre(MARGE, R.y, LARGEUR, 26, { fond: FOND, rayon: 4 });
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
      R.riche([['Motifs cochés : ', 'gras'], [e.motifs.length || e.autresMotifs.length ? libMotifs([...e.motifs, ...e.autresMotifs]) : 'aucun']]);
      const tx = textes.get(e.id);
      if (tx.explication) { R.paragraphe(tx.reformule ? 'Description :' : 'Explication :', { taille: 9.5, police: 'gras', apres: 0 }); R.paragraphe(tx.explication, { taille: 9.5, apres: 3 }); }
      if (tx.complement) { R.paragraphe('Complément :', { taille: 9.5, police: 'gras', apres: 0 }); R.paragraphe(tx.complement, { taille: 9.5, apres: 3 }); }
      if (e.prevision) {
        const p = e.prevision;
        R.riche([
          [`Prévision pour ${C.formatDateLongue(p.cible.date)}, ${C.LIBELLE_CRENEAU[p.cible.creneau].toLowerCase()} : `, 'gras'],
          [Number.isInteger(p.note) ? C.libelleNote(p.note) : 'aucune note'],
          ...(tx.prevision ? [['. Motif : ', 'gras'], [tx.prevision]] : []),
          ...(p.motifs && p.motifs.length ? [[` (motifs associés : ${p.motifs.map((m) => m.libelle).join(', ')})`]] : []),
        ]);
      }
      if (tx.reformule) {
        R.paragraphe(`${tx.methode >= 2 ? 'Texte rédigé à partir des saisies du patient (motifs et commentaires, orthographe corrigée, traduit en français si nécessaire)' : 'Texte corrigé et raccourci'}, relu et validé par le patient${tx.valideeLeUtc ? ` le ${C.formatDateHeure(tx.valideeLeUtc)}` : ''}.`, { taille: 8.5, police: 'italique', couleur: DOUX, apres: 3 });
        if (tx.original) {
          const o = tx.original;
          R.paragraphe('Texte original du patient :', { taille: 8.5, police: 'gras', couleur: DOUX, apres: 0 });
          for (const [lib, v] of [['Explication', o.explication], ['Complément', o.complement], ['Motif de la prévision', o.prevision]]) {
            if (v) R.paragraphe(`${lib} : « ${v} »`, { taille: 8.5, police: 'italique', couleur: DOUX, apres: 2 });
          }
          R.y += 2;
        }
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

  R.dessinerSommaire(pageSommaire, ySommaire, 1);
  R.paginer('Document personnel et confidentiel – données de santé');
  return doc.save();
}
