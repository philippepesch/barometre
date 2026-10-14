// Génération du rapport PDF (A4) à partir des données réelles de la base locale.
// Utilise pdf-lib (licence MIT), embarqué localement : aucune donnée ne quitte l'appareil.
import * as C from './core.js';

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
    this.nouvellePage();
  }

  couleur(hex) { return hexRgb(this.PDFLib, hex); }

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

  section(numero, titre, besoin = 90) {
    this.place(46 + besoin);
    this.y += 12;
    this.page.drawLine({ start: { x: MARGE, y: A4[1] - this.y }, end: { x: MARGE + LARGEUR, y: A4[1] - this.y }, thickness: 0.6, color: this.couleur(FILET) });
    this.y += 20;
    this.texte(`${numero}.`, MARGE, this.y, { taille: 13, police: 'gras', couleur: LAITON });
    this.texte(titre, MARGE + 24, this.y, { taille: 13, police: 'gras' });
    this.y += 14;
  }

  sousTitre(t) {
    this.place(30);
    this.y += 4;
    this.texte(t, MARGE, this.y + 10, { taille: 10.5, police: 'gras' });
    this.y += 18;
  }

  chiffres(cases) {
    const h = 54;
    this.place(h + 8);
    const l = (LARGEUR - (cases.length - 1) * 8) / cases.length;
    cases.forEach((c, i) => {
      const x = MARGE + i * (l + 8);
      this.page.drawRectangle({ x, y: A4[1] - this.y - h, width: l, height: h, color: this.couleur(FOND) });
      this.texte(c.valeur, x + 10, this.y + 26, { taille: 18, police: 'gras' });
      this.texte(c.libelle, x + 10, this.y + 43, { taille: 8.5, couleur: DOUX });
    });
    this.y += h + 10;
  }

  tableau(colonnes, lignes, { taille = 9 } = {}) {
    const total = colonnes.reduce((a, c) => a + c.part, 0);
    const largeurs = colonnes.map((c) => (c.part / total) * LARGEUR);
    const pad = 5;
    const dessinerEntete = () => {
      const h = taille * 1.4 + 2 * pad;
      this.page.drawRectangle({ x: MARGE, y: A4[1] - this.y - h, width: LARGEUR, height: h, color: this.couleur(FOND) });
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
    const hauteur = dense ? 230 : 190;
    const legende = 22;
    const avecBandes = !!contexte && grille.some((s) => s.evaluation && (s.evaluation.lieu || s.evaluation.situation));
    const hBandes = avecBandes ? 52 : 0;
    this.place(hauteur + legende + 40 + hBandes + (avecBandes ? 40 : 0));
    const gauche = MARGE + 22, droite = MARGE + LARGEUR - 6;
    const haut = this.y + 6, bas = this.y + hauteur - 26;
    const n = grille.length;
    const xDe = (i) => (n <= 1 ? (gauche + droite) / 2 : gauche + 8 + (i * (droite - gauche - 16)) / (n - 1));
    const yDe = (note) => bas - (note / 10) * (bas - haut);
    const P = (x, y) => ({ x, y: A4[1] - y });
    for (let v = 0; v <= 10; v += 2) {
      this.page.drawLine({ start: P(gauche, yDe(v)), end: P(droite, yDe(v)), thickness: v === 0 ? 0.7 : 0.35, color: this.couleur(v === 0 ? '#9AA5AD' : '#E1E6E9') });
      const lib = String(v);
      this.texte(lib, gauche - 8 - this.largeur(lib, 8), yDe(v) + 3, { taille: 8, couleur: DOUX });
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
    // Bandes « Lieu » et « Situation » : un segment par suite de créneaux identiques
    if (avecBandes) {
      const demi = n > 1 ? (xDe(1) - xDe(0)) / 2 : 6;
      const bande = (titre, y0, extraire, cle, couleur) => {
        this.texte(titre, gauche, y0 - 2, { taille: 7.5, police: 'gras', couleur: DOUX });
        const cleDe = (s) => (s.evaluation ? (extraire(s.evaluation) ? cle(extraire(s.evaluation)) : '-') : null);
        for (let i = 0; i < n;) {
          const k = cleDe(grille[i]);
          if (k === null) { i++; continue; }
          let j = i;
          while (j + 1 < n && cleDe(grille[j + 1]) === k) j++;
          const x0 = Math.max(gauche, i === 0 ? xDe(0) - demi : (xDe(i - 1) + xDe(i)) / 2);
          const x1 = Math.min(droite, j === n - 1 ? xDe(n - 1) + demi : (xDe(j) + xDe(j + 1)) / 2);
          const v = extraire(grille[i].evaluation);
          const w = Math.max(1, x1 - x0 - 1.4);
          if (v) this.page.drawRectangle({ x: x0 + 0.7, y: A4[1] - y0 - 9, width: w, height: 9, color: this.couleur(couleur(v)) });
          else this.page.drawRectangle({ x: x0 + 0.7, y: A4[1] - y0 - 9, width: w, height: 9, color: this.couleur('#F1F3F4'), borderColor: this.couleur(FILET), borderWidth: 0.5 });
          i = j + 1;
        }
      };
      bande('Lieu', this.y + 6, (e) => e.lieu, C.cleLieu, contexte.couleurLieu);
      bande('Situation professionnelle', this.y + 30, (e) => e.situation, C.cleSituation, contexte.couleurSituation);
      this.y += hBandes - 6;
    }
    // Légende
    let x = MARGE + 22;
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
        let xl = MARGE + 22;
        const yl2 = () => this.y + 6;
        this.texte(`${titre} :`, xl, yl2() + 3, { taille: 8.5, police: 'gras', couleur: ENCRE });
        xl += this.largeur(`${titre} :`, 8.5, 'gras') + 8;
        for (const it of items) {
          const lw = 14 + this.largeur(it.libelle, 8.5) + 10;
          if (xl + lw > MARGE + LARGEUR) { this.y += 14; xl = MARGE + 22 + 50; }
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

  paginer(pied) {
    const n = this.pages.length;
    this.pages.forEach((p, i) => {
      this.page = p;
      p.drawLine({ start: { x: MARGE, y: A4[1] - 40 }, end: { x: MARGE + LARGEUR, y: A4[1] - 40 }, thickness: 0.4, color: this.couleur(FILET) });
      this.texte(this.entete.gauche, MARGE, 34, { taille: 8, couleur: DOUX });
      this.texte(this.entete.droite, MARGE + LARGEUR - this.largeur(this.entete.droite, 8), 34, { taille: 8, couleur: DOUX });
      const num = `Page ${i + 1} sur ${n}`;
      p.drawLine({ start: { x: MARGE, y: 40 }, end: { x: MARGE + LARGEUR, y: 40 }, thickness: 0.4, color: this.couleur(FILET) });
      this.texte(pied, MARGE, A4[1] - 26, { taille: 7.5, couleur: DOUX });
      this.texte(num, MARGE + LARGEUR - this.largeur(num, 8), A4[1] - 26, { taille: 8, couleur: DOUX });
    });
  }
}

function libCreneau(c) { return `${C.formatDateCourte(c.date)} ${C.LIBELLE_CRENEAU[c.creneau].toLowerCase()}`; }

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
  const destinataire = (parametres.destinataire || '').trim();
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
  const estCompletion = (h) => h.changements.every((c) => (c.champ === 'lieu' || c.champ === 'situation') && !c.avant);

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
  const R = new Redacteur(PDFLib, doc, polices, { gauche: `Baromètre de l'humeur – ${titreDoc}`, droite: periodeCourte });

  // 1. Titre et période
  R.texte('Baromètre de l\'humeur', MARGE, R.y + 10, { taille: 10, police: 'gras', couleur: LAITON });
  R.y += 22;
  R.paragraphe(titreDoc, { taille: 22, police: 'gras', interligne: 1.2, apres: 4 });
  R.paragraphe(`Période analysée : du ${C.formatDateLongue(debut)} au ${C.formatDateLongue(fin)}`, { taille: 11, apres: 2 });
  R.paragraphe(`Rapport ${type === 'complet' ? 'complet' : 'synthétique'} établi le ${C.formatDateHeure(instant)} (heure de Luxembourg).`, { taille: 9, couleur: DOUX, apres: 10 });
  const avert = 'Toutes les données proviennent exclusivement des saisies du patient dans l\'application. Les chiffres sont descriptifs : ils ne constituent ni un diagnostic ni une évaluation clinique, et ne remplacent pas l\'échange avec le thérapeute.'
    + (nbReformules ? ` ${nbReformules === 1 ? 'Un commentaire est présenté' : `${nbReformules} commentaires sont présentés`} dans une version corrigée et raccourcie, relue et validée par le patient${modeTextes === 'les-deux' ? ', suivie du texte original' : ' ; les textes originaux sont conservés dans l\'application'}.` : '');
  const lignesAvert = R.couper(avert, 8.8, 'italique', LARGEUR - 20);
  const hAvert = lignesAvert.length * 8.8 * 1.4 + 14;
  R.page.drawRectangle({ x: MARGE, y: A4[1] - R.y - hAvert, width: LARGEUR, height: hAvert, color: R.couleur(FOND) });
  R.page.drawRectangle({ x: MARGE, y: A4[1] - R.y - hAvert, width: 2.5, height: hAvert, color: R.couleur(LAITON) });
  lignesAvert.forEach((l, i) => R.texte(l, MARGE + 12, R.y + 7 + 8.8 + i * 8.8 * 1.4, { taille: 8.8, police: 'italique', couleur: DOUX }));
  R.y += hAvert + 4;

  // 2. Évaluations attendues, complétées, omises
  R.section(2, 'Évaluations attendues, complétées et omises');
  R.chiffres([
    { valeur: String(comptes.attendues), libelle: 'attendues' },
    { valeur: String(comptes.completees), libelle: 'complétées' },
    { valeur: String(comptes.omises), libelle: 'omises' },
    { valeur: String(comptes.enAttente), libelle: 'en attente de réponse' },
  ]);
  const det = [];
  det.push(`Deux créneaux par jour : matin (rappel à 06:00) et soir (rappel à 18:00), heure de Luxembourg. Un créneau reste ouvert jusqu'au rappel suivant ; au-delà, il est compté comme omis s'il n'a pas reçu de réponse.`);
  const partsCompl = [];
  if (comptes.aLHeure) partsCompl.push(`${comptes.aLHeure} dans le créneau`);
  if (comptes.enRetard) partsCompl.push(`${comptes.enRetard} après la fin du créneau (saisie rétrospective)`);
  if (comptes.heureInconnue) partsCompl.push(`${comptes.heureInconnue} dont l'heure de saisie est inconnue (donnée historique antérieure à l'application)`);
  if (partsCompl.length) det.push(`Évaluations complétées : ${partsCompl.join(' ; ')}.`);
  if (comptes.nonRenseignees) det.push(`${C.pluriel(comptes.nonRenseignees, 'créneau antérieur', 'créneaux antérieurs')} au début du suivi dans l'application (${C.formatDateHeure(parametres.debutSuiviUtc)}) ${comptes.nonRenseignees > 1 ? 'sont marqués' : 'est marqué'} « non renseigné » et ${comptes.nonRenseignees > 1 ? 'ne sont pas comptés' : 'n\'est pas compté'} comme attendu${comptes.nonRenseignees > 1 ? 's' : ''}.`);
  if (comptes.aVenir) det.push(`${C.pluriel(comptes.aVenir, 'créneau', 'créneaux')} de la période ${comptes.aVenir > 1 ? 'sont' : 'est'} encore à venir.`);
  for (const d of det) R.paragraphe(d, { taille: 9.5, couleur: DOUX, apres: 4 });

  // 3. Moyennes
  R.section(3, 'Moyennes');
  if (!stats.nombre) R.paragraphe('Aucune évaluation sur la période.');
  else {
    R.tableau(
      [{ titre: '', part: 2.2, gras: true }, { titre: 'Moyenne', part: 1.2 }, { titre: 'Nombre d\'évaluations', part: 1.8 }],
      [
        ['Générale', `${C.nombreFr(stats.moyenne)}/10`, String(stats.nombre)],
        ['Matin', stats.nombreMatin ? `${C.nombreFr(stats.moyenneMatin)}/10` : '—', String(stats.nombreMatin)],
        ['Soir', stats.nombreSoir ? `${C.nombreFr(stats.moyenneSoir)}/10` : '—', String(stats.nombreSoir)],
      ],
    );
    if (stats.nombre < 5) R.paragraphe(`Avec ${C.pluriel(stats.nombre, 'évaluation')}, ces moyennes sont peu représentatives.`, { taille: 9, couleur: DOUX });
  }

  // 4. Minimum et maximum
  R.section(4, 'Notes minimale et maximale');
  if (!stats.nombre) R.paragraphe('Aucune évaluation sur la période.');
  else {
    const quand = (l) => l.map((e) => libCreneau(e)).join(', ');
    R.tableau(
      [{ titre: '', part: 1.4, gras: true }, { titre: 'Note', part: 1.8 }, { titre: 'Créneau(x)', part: 3 }],
      [
        ['Minimale', C.libelleNote(stats.min), quand(stats.evaluationsMin)],
        ['Maximale', C.libelleNote(stats.max), quand(stats.evaluationsMax)],
      ],
    );
  }

  // 5. Graphique
  R.section(5, 'Graphique chronologique', 270);
  if (grille.length > 2 * 400) {
    R.paragraphe('Période trop longue pour un graphique lisible (plus de 400 jours) : réduisez la période pour l\'afficher.', { couleur: DOUX });
  } else {
    R.graphique(grille, prev, { couleurLieu, couleurSituation, legendeLieux, legendeSituations });
    R.paragraphe(`Chaque position horizontale correspond à un créneau (matin puis soir). La ligne relie les notes de créneaux consécutifs ; elle s'interrompt lorsqu'un créneau n'a pas de réponse.${parLieu.lignes.length || parSituation.lignes.length ? ' Sous les dates, les bandes de couleur indiquent le lieu de séjour et la situation professionnelle déclarés par le patient pour chaque créneau.' : ''}`, { taille: 8.5, couleur: DOUX });
  }

  // 6. Tendances
  R.section(6, 'Tendances principales');
  R.puces(C.tendancesDescriptives(evals));

  // 7 et 8. Facteurs
  const tableFacteurs = (pol) => {
    const l = freq.filter((f) => f.polarite === pol);
    if (!l.length) return false;
    R.tableau(
      [{ titre: 'Motif', part: 4 }, { titre: 'Nombre', part: 1 }, { titre: 'Part des évaluations', part: 1.6 }],
      l.map((f) => [f.libelle, String(f.nombre), `${Math.round((f.nombre / evals.length) * 100)} %`]),
    );
    return true;
  };
  const rappelMotifs = 'Seuls les motifs explicitement cochés lors d\'une évaluation sont comptés ; les commentaires libres sont reproduits en annexe.';
  R.section(7, 'Facteurs favorables mentionnés');
  if (!tableFacteurs('favorable')) R.paragraphe('Aucun facteur favorable n\'a été coché sur la période.');
  R.paragraphe(rappelMotifs, { taille: 8.5, couleur: DOUX });
  R.section(8, 'Facteurs défavorables mentionnés');
  if (!tableFacteurs('defavorable')) R.paragraphe('Aucun facteur défavorable n\'a été coché sur la période.');
  if (freq.some((f) => f.polarite === 'mixte')) { R.sousTitre('Facteurs mixtes'); tableFacteurs('mixte'); }
  R.paragraphe(rappelMotifs, { taille: 8.5, couleur: DOUX });

  // 9. Lieu de séjour et situation professionnelle
  R.section(9, 'Lieu de séjour et situation professionnelle');
  if (!parLieu.lignes.length && !parSituation.lignes.length) R.paragraphe('Aucun lieu ni aucune situation professionnelle n\'ont été indiqués sur la période.');
  else {
    const tableCat = (titre, r) => {
      if (!r.lignes.length) { R.paragraphe(`${titre} : non indiqué sur la période.`, { taille: 9.5, couleur: DOUX }); return; }
      R.tableau(
        [{ titre, part: 3.6 }, { titre: 'Évaluations', part: 1.1 }, { titre: 'Moyenne', part: 1 }, { titre: 'Min – max', part: 1.1 }],
        r.lignes.map((l) => [l.libelle, String(l.nombre), `${C.nombreFr(l.moyenne)}/10`, `${l.min} – ${l.max}`]),
      );
      if (r.sansValeur) R.paragraphe(`${C.pluriel(r.sansValeur, 'évaluation')} sans cette information.`, { taille: 8.5, couleur: DOUX });
    };
    tableCat('Lieu', parLieu);
    tableCat('Situation professionnelle', parSituation);
    const peu = [...parLieu.lignes, ...parSituation.lignes].some((l) => l.nombre < 4);
    R.paragraphe(`Moyennes descriptives des notes selon les informations déclarées par le patient ; elles ne permettent pas d'établir un lien de cause à effet.${peu ? ' Une moyenne calculée sur moins de 4 évaluations est peu représentative.' : ''}`, { taille: 8.5, couleur: DOUX });
  }

  // 10. Prévisions et réalité
  R.section(10, 'Comparaison entre prévisions et réalité');
  if (!prev.lignes.length) R.paragraphe('Aucune prévision n\'a été formulée sur la période.');
  else {
    const etatCible = (l) => {
      if (l.ecart !== null) return l.ecart === 0 ? '0 (identique)' : C.signeFr(l.ecart, 0);
      const st = statutParId.get(C.idCreneau(l.cible.date, l.cible.creneau));
      return st === 'omis' ? 'créneau omis' : st === 'en_attente' ? 'en attente de réponse' : st === 'a_venir' ? 'à venir' : 'pas de réponse';
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
  R.section(11, 'Évaluations manquantes');
  const omis = grille.filter((s) => s.statut === 'omis');
  const attente = grille.filter((s) => s.statut === 'en_attente');
  const nonRens = grille.filter((s) => s.statut === 'non_renseigne');
  if (!omis.length) R.paragraphe('Aucun créneau omis sur la période.');
  else R.tableau([{ titre: 'Date', part: 2.4 }, { titre: 'Créneau', part: 1 }, { titre: 'Rappel prévu', part: 1.2 }], omis.map((s) => [C.formatDateLongue(s.date), C.LIBELLE_CRENEAU[s.creneau], C.formatHeure(s.prevuUtc)]));
  if (attente.length) R.paragraphe(`En attente de réponse au moment du rapport : ${attente.map(libCreneau).join(', ')}.`, { taille: 9.5 });
  if (nonRens.length) R.paragraphe(`Non renseigné (antérieur au début du suivi dans l'application, données inconnues) : ${nonRens.map(libCreneau).join(', ')}.`, { taille: 9.5, couleur: DOUX });

  // 11. Synthèse neutre
  R.section(12, 'Sujets susceptibles d\'être abordés en séance');
  R.paragraphe('Relevé factuel établi automatiquement à partir des saisies, sans interprétation ; libre au patient et au thérapeute de s\'en saisir ou non.', { taille: 9, couleur: DOUX });
  R.puces(C.sujetsDeDiscussion(evals, freq, prev, comptes));

  // 12. Annexe
  R.section(13, 'Annexe chronologique des évaluations', 120);
  if (!evals.length) R.paragraphe('Aucune évaluation sur la période.');
  const heureValidation = (e) => (e.validationConnue && e.valideLeUtc ? C.formatDateHeure(e.valideLeUtc) : 'inconnue (donnée historique)');
  if (type === 'synthetique' && evals.length) {
    const tronquer = (t, n = 220) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')} […]` : t);
    R.tableau(
      [{ titre: 'Créneau', part: 1.3 }, { titre: 'Note', part: 1.3 }, { titre: 'Saisie', part: 1.3 }, { titre: 'Motifs et commentaire', part: 4.2 }],
      evals.map((e) => [
        [libCreneau(e), e.lieu ? C.libelleLieu(e.lieu) : '', e.situation ? C.libelleSituation(e.situation) : ''].filter(Boolean).join('\n'), C.libelleNote(e.note), heureValidation(e) + (e.saisieRetrospective ? ' – rétrospective' : '') + (modifsReelles(e).length ? ' – modifiée' : ''),
        [[...e.motifs, ...e.autresMotifs].map((m) => m.libelle).join(', '), tronquer([textes.get(e.id).explication, textes.get(e.id).complement].filter(Boolean).join(' '))].filter(Boolean).join(' — ') || '—',
      ]),
      { taille: 8.5 },
    );
    R.paragraphe(`Rapport synthétique : les commentaires longs sont abrégés ; le rapport complet les reproduit intégralement.${nbReformules ? ' Les commentaires reformulés sont repris dans leur version validée par le patient.' : ''}`, { taille: 8.5, couleur: DOUX });
  } else {
    for (const e of evals) {
      R.place(70);
      R.y += 6;
      R.page.drawRectangle({ x: MARGE, y: A4[1] - R.y - 22, width: LARGEUR, height: 22, color: R.couleur(FOND) });
      R.page.drawRectangle({ x: MARGE, y: A4[1] - R.y - 22, width: 4, height: 22, color: R.couleur(COULEURS_NIVEAUX[e.note]) });
      const tete = `${C.majuscule(C.formatDateLongue(e.date))} – ${C.LIBELLE_CRENEAU[e.creneau]}`;
      R.texte(tete, MARGE + 12, R.y + 15, { taille: 10, police: 'gras' });
      const note = C.libelleNote(e.note);
      R.texte(note, MARGE + LARGEUR - 10 - R.largeur(note, 10, 'gras'), R.y + 15, { taille: 10, police: 'gras' });
      R.y += 30;
      const meta = [`Rappel prévu : ${C.formatHeure(e.rappelPrevuUtc)}`, `Validation : ${heureValidation(e)}`];
      if (e.saisieRetrospective) meta.push('saisie rétrospective, après la fin du créneau');
      R.paragraphe(meta.join('   |   '), { taille: 8.5, couleur: DOUX, apres: 3 });
      if (e.lieu || e.situation) R.paragraphe([e.lieu ? `Lieu : ${C.libelleLieu(e.lieu, { complet: true })}` : '', e.situation ? `Situation : ${C.libelleSituation(e.situation)}` : ''].filter(Boolean).join('   |   '), { taille: 9.5, apres: 3 });
      if (e.noteOrigine) R.paragraphe(e.noteOrigine, { taille: 8.5, police: 'italique', couleur: DOUX, apres: 3 });
      const libMotifs = (l) => l.map((m) => `${m.libelle} (${C.LIBELLE_POLARITE[m.polarite].toLowerCase()})`).join(', ');
      R.paragraphe(`Motifs cochés : ${e.motifs.length || e.autresMotifs.length ? libMotifs([...e.motifs, ...e.autresMotifs]) : 'aucun'}`, { taille: 9.5, apres: 3 });
      const tx = textes.get(e.id);
      if (tx.explication) { R.paragraphe('Explication :', { taille: 9.5, police: 'gras', apres: 0 }); R.paragraphe(tx.explication, { taille: 9.5, apres: 3 }); }
      if (tx.complement) { R.paragraphe('Complément :', { taille: 9.5, police: 'gras', apres: 0 }); R.paragraphe(tx.complement, { taille: 9.5, apres: 3 }); }
      if (e.prevision) {
        const p = e.prevision;
        const t = `Prévision pour ${C.formatDateLongue(p.cible.date)}, ${C.LIBELLE_CRENEAU[p.cible.creneau].toLowerCase()} : ${Number.isInteger(p.note) ? C.libelleNote(p.note) : 'aucune note'}${tx.prevision ? `. Motif : ${tx.prevision}` : ''}${p.motifs && p.motifs.length ? ` (motifs associés : ${p.motifs.map((m) => m.libelle).join(', ')})` : ''}`;
        R.paragraphe(t, { taille: 9.5, apres: 3 });
      }
      if (tx.reformule) {
        R.paragraphe(`Texte corrigé et raccourci, relu et validé par le patient${tx.valideeLeUtc ? ` le ${C.formatDateHeure(tx.valideeLeUtc)}` : ''}.`, { taille: 8.5, police: 'italique', couleur: DOUX, apres: 3 });
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

  R.paginer('Document personnel et confidentiel – données de santé');
  return doc.save();
}
