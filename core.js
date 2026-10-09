// Baromètre de l'humeur — logique métier pure (aucun accès au DOM ni au réseau).
// Ce module est partagé par l'application, le générateur de rapport et les tests.

export const VERSION_APP = '1.3.0';
export const FORMAT_DONNEES = 'barometre-humeur';
export const VERSION_FORMAT = 1;
export const FUSEAU = 'Europe/Luxembourg';

export const NIVEAUX = [
  'Alerte rouge', 'Nuit noire', 'Tempête', 'Ciel orageux', 'Ciel gris', 'Entre deux',
  'Éclaircie', 'Beau temps', 'Ciel bleu', 'Grand soleil', 'Plein soleil',
];

export const CRENEAUX = ['matin', 'soir'];
export const HEURES_RAPPEL = { matin: '06:00', soir: '18:00' };
export const LIBELLE_CRENEAU = { matin: 'Matin', soir: 'Soir' };
export const OUVERTURE_ANTICIPEE_MIN = 60;

export const POLARITES = ['favorable', 'defavorable', 'mixte'];
export const LIBELLE_POLARITE = { favorable: 'Favorable', defavorable: 'Défavorable', mixte: 'Mixte' };

export const STATUTS = {
  a_venir: 'À venir',
  en_attente: 'En attente',
  repondu: 'Répondu',
  repondu_retard: 'Répondu en retard',
  omis: 'Omis',
  non_renseigne: 'Non renseigné',
};

export function nomNiveau(note) {
  return Number.isInteger(note) && note >= 0 && note <= 10 ? NIVEAUX[note] : '';
}

export function libelleNote(note) {
  return Number.isInteger(note) ? `${note}/10 – ${nomNiveau(note)}` : '—';
}

// ---------------------------------------------------------------------------
// Identifiants

export function nouvelId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------------
// Heure locale luxembourgeoise (changements d'heure gérés par la base IANA du navigateur)

const fmtParties = new Intl.DateTimeFormat('en-GB', {
  timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function partiesLocales(instant) {
  const p = {};
  for (const x of fmtParties.formatToParts(new Date(+instant))) p[x.type] = x.value;
  return {
    annee: +p.year, mois: +p.month, jour: +p.day,
    heure: +p.hour, minute: +p.minute, seconde: +p.second,
    date: `${p.year}-${p.month}-${p.day}`,
  };
}

export function decalageMinutes(instant) {
  const ms = Math.floor(+instant / 1000) * 1000;
  const p = partiesLocales(ms);
  const commeUtc = Date.UTC(p.annee, p.mois - 1, p.jour, p.heure, p.minute, p.seconde);
  return Math.round((commeUtc - ms) / 60000);
}

/** Convertit une date civile + heure locale de Luxembourg en instant UTC (ms). */
export function localVersUtc(dateStr, hhmm) {
  const [a, m, j] = dateStr.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  const naif = Date.UTC(a, m - 1, j, h, mi);
  const d1 = decalageMinutes(naif - 60 * 60000);
  let t = naif - d1 * 60000;
  const d2 = decalageMinutes(t);
  if (d2 !== d1) t = naif - d2 * 60000;
  return t;
}

export function dateLocale(instant) {
  return partiesLocales(instant).date;
}

export function ajouterJours(dateStr, n) {
  const [a, m, j] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j + n));
  return d.toISOString().slice(0, 10);
}

export function joursEntre(debut, fin) {
  const t = (s) => { const [a, m, j] = s.split('-').map(Number); return Date.UTC(a, m - 1, j); };
  return Math.round((t(fin) - t(debut)) / 86400000);
}

export function estDateValide(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, j] = s.split('-').map(Number);
  const d = new Date(Date.UTC(a, m - 1, j));
  return d.getUTCFullYear() === a && d.getUTCMonth() === m - 1 && d.getUTCDate() === j;
}

// ---------------------------------------------------------------------------
// Formatage français (affichage en heure de Luxembourg)

const fmtDateLongue = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtDateMoyenne = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const fmtMois = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', month: 'long', year: 'numeric' });

function dateMidi(dateStr) {
  const [a, m, j] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, j, 12));
}
const propre = (s) => s.replace(/[\u202f\u00a0]/g, ' ');

export function formatDateLongue(dateStr) { return propre(fmtDateLongue.format(dateMidi(dateStr))); }
export function formatDateMoyenne(dateStr) { return propre(fmtDateMoyenne.format(dateMidi(dateStr))); }
export function formatMois(dateStr) { return propre(fmtMois.format(dateMidi(dateStr))); }
export function formatDateCourte(dateStr) {
  const [a, m, j] = dateStr.split('-');
  return `${j}/${m}/${a}`;
}
export function formatHeure(instant) {
  const p = partiesLocales(typeof instant === 'string' ? Date.parse(instant) : instant);
  return `${String(p.heure).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}
export function formatDateHeure(instant) {
  const ms = typeof instant === 'string' ? Date.parse(instant) : instant;
  return `${formatDateCourte(dateLocale(ms))} à ${formatHeure(ms)}`;
}
export function nombreFr(x, decimales = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  const v = Math.sign(x) * Math.round(Math.abs(x) * 10 ** decimales) / 10 ** decimales;
  return (Number.isInteger(v) ? String(v) : v.toFixed(decimales)).replace('.', ',').replace(/^-/, '−');
}
export function signeFr(x, decimales = 1) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  if (Math.abs(x) < 10 ** -decimales / 2) return '0';
  return (x > 0 ? '+' : '') + nombreFr(x, decimales);
}
export function majuscule(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }
export function pluriel(n, sing, plur) { return `${n} ${n > 1 ? (plur || sing + 's') : sing}`; }

// ---------------------------------------------------------------------------
// Créneaux

export function idCreneau(date, creneau) { return `${date}_${creneau}`; }

export function heurePrevue(date, creneau) { return localVersUtc(date, HEURES_RAPPEL[creneau]); }

export function creneauSuivant({ date, creneau }) {
  return creneau === 'matin' ? { date, creneau: 'soir' } : { date: ajouterJours(date, 1), creneau: 'matin' };
}
export function creneauPrecedent({ date, creneau }) {
  return creneau === 'soir' ? { date, creneau: 'matin' } : { date: ajouterJours(date, -1), creneau: 'soir' };
}
export function expiration(date, creneau) {
  const s = creneauSuivant({ date, creneau });
  return heurePrevue(s.date, s.creneau);
}

function minutesDuJour(hhmm) { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; }

/** Créneau dont la fenêtre de réponse contient l'instant donné. */
export function creneauOuvert(instant) {
  const p = partiesLocales(instant);
  const min = p.heure * 60 + p.minute;
  if (min >= minutesDuJour(HEURES_RAPPEL.soir)) return { date: p.date, creneau: 'soir' };
  if (min >= minutesDuJour(HEURES_RAPPEL.matin)) return { date: p.date, creneau: 'matin' };
  return { date: ajouterJours(p.date, -1), creneau: 'soir' };
}

export function prochainCreneau(instant) {
  return creneauSuivant(creneauOuvert(instant));
}

export function peutRepondre({ date, creneau }, instant) {
  return instant >= heurePrevue(date, creneau) - OUVERTURE_ANTICIPEE_MIN * 60000;
}

export function statutCreneau({ date, creneau }, evaluation, instant, debutSuiviUtc) {
  const exp = expiration(date, creneau);
  if (evaluation) {
    if (!evaluation.validationConnue || !evaluation.valideLeUtc) return 'repondu';
    return Date.parse(evaluation.valideLeUtc) > exp ? 'repondu_retard' : 'repondu';
  }
  if (instant < heurePrevue(date, creneau)) return 'a_venir';
  const debut = debutSuiviUtc ? Date.parse(debutSuiviUtc) : null;
  if (debut !== null && exp <= debut) return 'non_renseigne';
  if (instant < exp) return 'en_attente';
  return 'omis';
}

export function indexerParCreneau(evaluations) {
  const m = new Map();
  for (const e of evaluations) m.set(e.creneauId, e);
  return m;
}

export function grilleCreneaux(debut, fin, evaluations, instant, debutSuiviUtc) {
  const parCreneau = indexerParCreneau(evaluations);
  const res = [];
  for (let d = debut; d <= fin; d = ajouterJours(d, 1)) {
    for (const c of CRENEAUX) {
      const id = idCreneau(d, c);
      const ev = parCreneau.get(id) || null;
      res.push({
        id, date: d, creneau: c,
        prevuUtc: heurePrevue(d, c), expireUtc: expiration(d, c),
        evaluation: ev,
        statut: statutCreneau({ date: d, creneau: c }, ev, instant, debutSuiviUtc),
      });
    }
  }
  return res;
}

export function comptesCreneaux(grille) {
  const c = { attendues: 0, completees: 0, aLHeure: 0, enRetard: 0, omises: 0, enAttente: 0, aVenir: 0, nonRenseignees: 0, heureInconnue: 0 };
  for (const s of grille) {
    switch (s.statut) {
      case 'repondu':
        c.completees++; c.aLHeure++;
        if (s.evaluation && !s.evaluation.validationConnue) { c.heureInconnue++; c.aLHeure--; }
        break;
      case 'repondu_retard': c.completees++; c.enRetard++; break;
      case 'omis': c.omises++; break;
      case 'en_attente': c.enAttente++; break;
      case 'a_venir': c.aVenir++; break;
      case 'non_renseigne': c.nonRenseignees++; break;
      default: break;
    }
  }
  c.attendues = c.completees + c.omises + c.enAttente;
  return c;
}

// ---------------------------------------------------------------------------
// Sécurité

const SIGNAUX = [
  'suicid', 'suizid', 'selbstmord', 'me tuer', 'en finir', 'mettre fin a mes jours', 'mettre fin a ma vie',
  'mettre fin a tout', 'plus envie de vivre', 'pas envie de vivre', 'envie de mourir', 'veux mourir',
  'voudrais mourir', 'prefererais mourir', 'me faire du mal', 'me blesser', 'me mutiler', 'envie de disparaitre',
  'disparaitre pour toujours', 'plus la force de vivre', 'je suis en danger', 'danger immediat', 'idees noires',
  'me jeter', 'me pendre', 'overdose', 'nicht mehr leben', 'umbringen',
];

export function normaliserTexte(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, ' ').replace(/\s+/g, ' ');
}

export function detecterSignaux(textes) {
  const t = normaliserTexte((Array.isArray(textes) ? textes : [textes]).filter(Boolean).join(' \n '));
  return SIGNAUX.filter((s) => t.includes(s));
}

export function verificationSecurite(note, textes) {
  const signaux = detecterSignaux(textes);
  const raisons = [];
  if (note === 0) raisons.push('note de 0/10');
  if (signaux.length) raisons.push('formulation évoquant une détresse');
  return { declenchee: raisons.length > 0, raisons };
}

// ---------------------------------------------------------------------------
// Bibliothèque de motifs

export function normaliserLibelle(s) { return normaliserTexte(s).trim(); }

export function creerMotif(libelle, polarite, instant = Date.now(), ordre = 0) {
  const l = String(libelle || '').trim();
  if (!l) throw new Error('Le libellé du motif est vide.');
  if (!POLARITES.includes(polarite)) throw new Error('Polarité inconnue.');
  return { id: nouvelId(), libelle: l, polarite, actif: true, regroupeDans: null, ordre, creeLeUtc: new Date(instant).toISOString(), modifieLeUtc: null };
}

export function racineMotif(id, bibliotheque) {
  const parId = new Map(bibliotheque.map((m) => [m.id, m]));
  let m = parId.get(id);
  const vus = new Set();
  while (m && m.regroupeDans && parId.has(m.regroupeDans) && !vus.has(m.id)) {
    vus.add(m.id);
    m = parId.get(m.regroupeDans);
  }
  return m || null;
}

export function instantaneMotif(m) { return { id: m.id, libelle: m.libelle, polarite: m.polarite }; }

// ---------------------------------------------------------------------------
// Évaluations

const LIMITE_TEXTE = 10000;

export function validerSaisie(s) {
  const erreurs = [];
  if (!Number.isInteger(s.note) || s.note < 0 || s.note > 10) erreurs.push('Choisissez une note entière entre 0 et 10 pour la question 1.');
  if (s.prevision && s.prevision.note !== null && s.prevision.note !== undefined) {
    if (!Number.isInteger(s.prevision.note) || s.prevision.note < 0 || s.prevision.note > 10) erreurs.push('La note prévue doit être un entier entre 0 et 10.');
  }
  if (!estDateValide(s.date)) erreurs.push('Date invalide.');
  if (!CRENEAUX.includes(s.creneau)) erreurs.push('Créneau invalide.');
  for (const champ of ['explication', 'complement']) {
    if (s[champ] && String(s[champ]).length > LIMITE_TEXTE) erreurs.push('Texte trop long (10 000 caractères maximum).');
  }
  if (s.prevision && s.prevision.motif && String(s.prevision.motif).length > LIMITE_TEXTE) erreurs.push('Motif de prévision trop long.');
  for (const a of s.autresMotifs || []) {
    if (!String(a.libelle || '').trim()) erreurs.push('Un motif « Autre » est vide.');
    if (!POLARITES.includes(a.polarite)) erreurs.push('Polarité de motif inconnue.');
  }
  return erreurs;
}

function nettoyerTexte(s) { const t = String(s || '').trim(); return t || ''; }

function construirePrevision(date, creneau, prevision) {
  if (!prevision || prevision.note === null || prevision.note === undefined) {
    if (prevision && (nettoyerTexte(prevision.motif) || (prevision.motifs || []).length)) {
      return { cible: creneauSuivant({ date, creneau }), note: null, niveau: '', motif: nettoyerTexte(prevision.motif), motifs: (prevision.motifs || []).map(instantaneMotif) };
    }
    return null;
  }
  return {
    cible: creneauSuivant({ date, creneau }),
    note: prevision.note,
    niveau: nomNiveau(prevision.note),
    motif: nettoyerTexte(prevision.motif),
    motifs: (prevision.motifs || []).map(instantaneMotif),
  };
}

/**
 * Crée une évaluation à partir d'une saisie validée.
 * saisie = { date, creneau, note, motifs:[motif], autresMotifs:[{libelle,polarite}], explication, complement,
 *            prevision:{note|null, motif, motifs:[motif]} }
 */
export function creerEvaluation(saisie, instant = Date.now()) {
  const erreurs = validerSaisie(saisie);
  if (erreurs.length) throw new Error(erreurs.join(' '));
  const { date, creneau } = saisie;
  const exp = expiration(date, creneau);
  const textes = [saisie.explication, saisie.complement, saisie.prevision && saisie.prevision.motif, ...(saisie.autresMotifs || []).map((a) => a.libelle)];
  return {
    id: nouvelId(),
    creneauId: idCreneau(date, creneau),
    date,
    creneau,
    rappelPrevuUtc: new Date(heurePrevue(date, creneau)).toISOString(),
    valideLeUtc: new Date(instant).toISOString(),
    validationConnue: true,
    saisieRetrospective: instant > exp,
    note: saisie.note,
    niveau: nomNiveau(saisie.note),
    motifs: (saisie.motifs || []).map(instantaneMotif),
    autresMotifs: (saisie.autresMotifs || []).map((a) => ({ libelle: a.libelle.trim(), polarite: a.polarite })),
    explication: nettoyerTexte(saisie.explication),
    complement: nettoyerTexte(saisie.complement),
    prevision: construirePrevision(date, creneau, saisie.prevision),
    securite: verificationSecurite(saisie.note, textes),
    source: 'application',
    creeLeUtc: new Date(instant).toISOString(),
    modifieLeUtc: null,
    version: 1,
    historique: [],
  };
}

const CHAMPS_MODIFIABLES = ['note', 'motifs', 'autresMotifs', 'explication', 'complement', 'prevision'];
export const LIBELLE_CHAMP = {
  note: 'Note', niveau: 'Niveau', motifs: 'Motifs', autresMotifs: 'Autres motifs', explication: 'Explication',
  complement: 'Complément', prevision: 'Prévision', reformulation: 'Version pour le rapport',
};

/**
 * Modifie une évaluation en conservant un historique d'audit complet.
 * Retourne null si rien n'a changé (aucune modification silencieuse ni vide).
 */
export function modifierEvaluation(ev, saisie, raison, instant = Date.now()) {
  const fusion = {
    date: ev.date, creneau: ev.creneau,
    note: saisie.note ?? ev.note,
    motifs: saisie.motifs ?? ev.motifs,
    autresMotifs: saisie.autresMotifs ?? ev.autresMotifs,
    explication: saisie.explication ?? ev.explication,
    complement: saisie.complement ?? ev.complement,
    prevision: saisie.prevision === undefined ? (ev.prevision ? { ...ev.prevision } : null) : saisie.prevision,
  };
  const erreurs = validerSaisie(fusion);
  if (erreurs.length) throw new Error(erreurs.join(' '));
  const nouveau = {
    note: fusion.note,
    motifs: fusion.motifs.map(instantaneMotif),
    autresMotifs: fusion.autresMotifs.map((a) => ({ libelle: a.libelle.trim(), polarite: a.polarite })),
    explication: nettoyerTexte(fusion.explication),
    complement: nettoyerTexte(fusion.complement),
    prevision: saisie.prevision === undefined ? ev.prevision : construirePrevision(ev.date, ev.creneau, fusion.prevision),
  };
  const changements = [];
  for (const champ of CHAMPS_MODIFIABLES) {
    const avant = ev[champ] ?? null;
    const apres = nouveau[champ] ?? null;
    if (JSON.stringify(avant) !== JSON.stringify(apres)) changements.push({ champ, avant, apres });
  }
  if (!changements.length) return null;
  // Si un texte original change, la version reformulée doit être revue avant d'être réutilisée.
  const textesChanges = changements.some((c) => c.champ === 'explication' || c.champ === 'complement'
    || (c.champ === 'prevision' && ((c.avant && c.avant.motif) || '') !== ((c.apres && c.apres.motif) || '')));
  if (textesChanges && ev.reformulation && ev.reformulation.statut === 'validee') {
    nouveau.reformulation = { ...ev.reformulation, statut: 'a_revoir', valideeLeUtc: null };
    changements.push({ champ: 'reformulation', avant: ev.reformulation, apres: nouveau.reformulation });
  }
  const le = new Date(instant).toISOString();
  const textes = [nouveau.explication, nouveau.complement, nouveau.prevision && nouveau.prevision.motif, ...nouveau.autresMotifs.map((a) => a.libelle)];
  return {
    ...ev,
    ...nouveau,
    niveau: nomNiveau(nouveau.note),
    securite: verificationSecurite(nouveau.note, textes),
    modifieLeUtc: le,
    version: (ev.version || 1) + 1,
    historique: [...(ev.historique || []), { le, version: (ev.version || 1) + 1, raison: nettoyerTexte(raison), changements }],
  };
}

// ---------------------------------------------------------------------------
// Version reformulée pour le rapport (orthographe corrigée, phrases raccourcies, style professionnel).
// Le texte original n'est jamais modifié ; seule une version VALIDÉE par le patient figure dans le PDF.

export const STATUTS_REFORMULATION = { proposee: 'Proposition à relire', validee: 'Validée', a_revoir: 'À revoir (texte original modifié)' };

export function textesOriginaux(ev) {
  return { explication: ev.explication || '', complement: ev.complement || '', prevision: (ev.prevision && ev.prevision.motif) || '' };
}

export function aDesTextes(ev) {
  const t = textesOriginaux(ev);
  return !!(t.explication || t.complement || t.prevision);
}

/**
 * Enregistre (ou retire, avec null) une version reformulée, avec une entrée d'audit.
 * reformulation = { explication, complement, prevision, statut: 'proposee'|'validee', source: 'assistant'|'manuelle' }
 */
export function definirReformulation(ev, reformulation, raison, instant = Date.now()) {
  const le = new Date(instant).toISOString();
  let apres = null;
  if (reformulation) {
    const champs = { explication: nettoyerTexte(reformulation.explication), complement: nettoyerTexte(reformulation.complement), prevision: nettoyerTexte(reformulation.prevision) };
    for (const v of Object.values(champs)) if (v.length > LIMITE_TEXTE) throw new Error('Texte reformulé trop long.');
    const orig = textesOriginaux(ev);
    for (const k of Object.keys(champs)) if (champs[k] && !orig[k]) throw new Error('Une version reformulée ne peut pas ajouter un texte absent de l\'original.');
    if (!champs.explication && !champs.complement && !champs.prevision) throw new Error('La version reformulée est vide.');
    const statut = reformulation.statut === 'validee' ? 'validee' : 'proposee';
    apres = {
      ...champs,
      statut,
      source: reformulation.source === 'manuelle' ? 'manuelle' : 'assistant',
      creeLeUtc: (ev.reformulation && ev.reformulation.creeLeUtc) || le,
      valideeLeUtc: statut === 'validee' ? le : null,
    };
  }
  const avant = ev.reformulation ?? null;
  if (JSON.stringify(avant && { ...avant, valideeLeUtc: null, creeLeUtc: null }) === JSON.stringify(apres && { ...apres, valideeLeUtc: null, creeLeUtc: null })) return null;
  const version = (ev.version || 1) + 1;
  return {
    ...ev,
    reformulation: apres,
    modifieLeUtc: le,
    version,
    historique: [...(ev.historique || []), { le, version, raison: nettoyerTexte(raison), changements: [{ champ: 'reformulation', avant, apres }] }],
  };
}

/** Textes à utiliser dans le rapport selon le mode : 'reformule' (défaut), 'original' ou 'les-deux'. */
export function textesPourRapport(ev, mode = 'reformule') {
  const orig = textesOriginaux(ev);
  const r = ev.reformulation;
  const valide = !!(r && r.statut === 'validee');
  if (mode === 'original' || !valide) return { ...orig, reformule: false, original: null, valideeLeUtc: null };
  const choix = { explication: orig.explication ? (r.explication || orig.explication) : '', complement: orig.complement ? (r.complement || orig.complement) : '', prevision: orig.prevision ? (r.prevision || orig.prevision) : '' };
  return { ...choix, reformule: true, original: mode === 'les-deux' ? orig : null, valideeLeUtc: r.valideeLeUtc };
}

export function entreesReformulation(evaluations) {
  return trierChrono(evaluations).filter(aDesTextes).map((e) => {
    const t = textesOriginaux(e);
    return { id: e.id, explication: t.explication, complement: t.complement, prevision: t.prevision };
  });
}

export function instructionsReformulation({ personne = 'troisieme' } = {}) {
  const style = personne === 'premiere'
    ? 'à la première personne (« je »), comme si le patient écrivait lui-même de façon soignée'
    : 'à la troisième personne (« Le patient… », « Il… »)';
  return `Tu es un assistant de rédaction. Tu reçois des extraits du journal d'humeur d'un patient, destinés à son psychothérapeute.

Pour chaque entrée et chaque champ non vide :
- corrige l'orthographe, la grammaire et la ponctuation ;
- raccourcis nettement (environ la moitié de la longueur, ou moins) ;
- adopte un style professionnel, clair, neutre et factuel, ${style} ;
- conserve toutes les informations utiles au thérapeute : faits, émotions, causes évoquées, projets, difficultés, chiffres et noms propres ;
- n'ajoute aucune information, aucune interprétation, aucun vocabulaire clinique ni diagnostic ;
- si un champ est vide, renvoie une chaîne vide ;
- conserve exactement chaque « id ».

Réponds uniquement avec du JSON valide, sans texte autour, sous cette forme exacte :
{"entrees": [{"id": "…", "explication": "…", "complement": "…", "prevision": "…"}]}`;
}

export function demandeReformulation(evaluations, options = {}) {
  return `${instructionsReformulation(options)}

Entrées :
${JSON.stringify(entreesReformulation(evaluations), null, 2)}
`;
}

/** Évaluations dont la version pour le rapport reste à préparer. */
export function aReformuler(ev) {
  return aDesTextes(ev) && (!ev.reformulation || ev.reformulation.statut === 'a_revoir');
}

/** Lit la réponse de l'assistant (JSON, éventuellement entouré de texte ou de balises de code). */
export function lireReponseReformulation(texte, evaluations) {
  const brut = String(texte || '');
  let liste = null;
  const o1 = brut.indexOf('{'), o2 = brut.lastIndexOf('}');
  if (o1 >= 0 && o2 > o1) {
    try { const obj = JSON.parse(brut.slice(o1, o2 + 1)); if (obj && Array.isArray(obj.entrees)) liste = obj.entrees; } catch { /* essai suivant */ }
  }
  if (!liste) {
    const debut = brut.indexOf('[');
    const fin = brut.lastIndexOf(']');
    if (debut < 0 || fin < debut) throw new Error('Aucune donnée JSON trouvée dans la réponse.');
    try { liste = JSON.parse(brut.slice(debut, fin + 1)); } catch { throw new Error('La réponse n\'est pas un JSON valide. Demande à l\'assistant de répondre uniquement en JSON.'); }
  }
  if (!Array.isArray(liste)) throw new Error('La réponse doit contenir une liste d\'entrées.');
  const parId = new Map(evaluations.map((e) => [e.id, e]));
  const propositions = [];
  const ignorees = [];
  for (const x of liste) {
    const ev = x && parId.get(x.id);
    if (!ev) { ignorees.push(x && x.id); continue; }
    const orig = textesOriginaux(ev);
    const prop = {};
    for (const k of ['explication', 'complement', 'prevision']) prop[k] = orig[k] ? nettoyerTexte(x[k]) : '';
    if (!prop.explication && !prop.complement && !prop.prevision) { ignorees.push(x.id); continue; }
    propositions.push({ id: ev.id, ...prop });
  }
  return { propositions, ignorees };
}

// ---------------------------------------------------------------------------
// Statistiques (purement descriptives)

export function moyenne(valeurs) {
  const v = valeurs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

export function trierChrono(evaluations) {
  return [...evaluations].sort((a, b) => (a.creneauId < b.creneauId ? -1 : a.creneauId > b.creneauId ? 1 : 0));
}

export function dansPeriode(evaluations, debut, fin) {
  return evaluations.filter((e) => e.date >= debut && e.date <= fin);
}

export function statistiques(evaluations) {
  const notes = evaluations.map((e) => e.note);
  const matin = evaluations.filter((e) => e.creneau === 'matin');
  const soir = evaluations.filter((e) => e.creneau === 'soir');
  const min = notes.length ? Math.min(...notes) : null;
  const max = notes.length ? Math.max(...notes) : null;
  return {
    nombre: evaluations.length,
    moyenne: moyenne(notes),
    nombreMatin: matin.length,
    moyenneMatin: moyenne(matin.map((e) => e.note)),
    nombreSoir: soir.length,
    moyenneSoir: moyenne(soir.map((e) => e.note)),
    min, max,
    evaluationsMin: trierChrono(evaluations.filter((e) => e.note === min)),
    evaluationsMax: trierChrono(evaluations.filter((e) => e.note === max)),
  };
}

export function evolution(evaluations, aujourdhui, jours) {
  const debut = ajouterJours(aujourdhui, -(jours - 1));
  const debutPrec = ajouterJours(debut, -jours);
  const finPrec = ajouterJours(debut, -1);
  const actuelles = dansPeriode(evaluations, debut, aujourdhui);
  const precedentes = dansPeriode(evaluations, debutPrec, finPrec);
  const m = moyenne(actuelles.map((e) => e.note));
  const mp = moyenne(precedentes.map((e) => e.note));
  return {
    jours, debut, fin: aujourdhui,
    nombre: actuelles.length, moyenne: m,
    nombrePrecedent: precedentes.length, moyennePrecedente: mp,
    difference: m !== null && mp !== null ? m - mp : null,
  };
}

export function frequenceMotifs(evaluations, bibliotheque) {
  const parId = new Map(bibliotheque.map((m) => [m.id, m]));
  const compte = new Map();
  const ajouter = (cle, libelle, polarite, ev) => {
    const c = compte.get(cle) || { cle, libelle, polarite, nombre: 0, dates: [] };
    c.nombre++;
    c.dates.push(ev.creneauId);
    compte.set(cle, c);
  };
  for (const ev of evaluations) {
    const vus = new Set();
    for (const m of ev.motifs || []) {
      const r = parId.has(m.id) ? racineMotif(m.id, bibliotheque) : null;
      const cle = r ? r.id : `libre:${normaliserLibelle(m.libelle)}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      ajouter(cle, r ? r.libelle : m.libelle, r ? r.polarite : m.polarite, ev);
    }
    for (const a of ev.autresMotifs || []) {
      const cle = `libre:${normaliserLibelle(a.libelle)}`;
      if (vus.has(cle)) continue;
      vus.add(cle);
      ajouter(cle, a.libelle, a.polarite, ev);
    }
  }
  return [...compte.values()].sort((a, b) => b.nombre - a.nombre || a.libelle.localeCompare(b.libelle, 'fr'));
}

export function comparaisonsPrevisions(evaluations, toutesEvaluations = evaluations) {
  const parCreneau = indexerParCreneau(toutesEvaluations);
  const lignes = [];
  for (const ev of trierChrono(evaluations)) {
    if (!ev.prevision || !Number.isInteger(ev.prevision.note)) continue;
    const cible = ev.prevision.cible;
    const reel = parCreneau.get(idCreneau(cible.date, cible.creneau)) || null;
    lignes.push({
      source: ev, cible, prevue: ev.prevision.note,
      reelle: reel ? reel.note : null,
      ecart: reel ? reel.note - ev.prevision.note : null,
    });
  }
  const comparees = lignes.filter((l) => l.ecart !== null);
  return {
    lignes,
    nombreComparees: comparees.length,
    ecartMoyen: moyenne(comparees.map((l) => l.ecart)),
    ecartAbsoluMoyen: moyenne(comparees.map((l) => Math.abs(l.ecart))),
    exactes: comparees.filter((l) => l.ecart === 0).length,
    realiteSuperieure: comparees.filter((l) => l.ecart > 0).length,
    realiteInferieure: comparees.filter((l) => l.ecart < 0).length,
  };
}

/** Constats descriptifs, sans interprétation médicale. */
export function tendancesDescriptives(evaluations) {
  const ev = trierChrono(evaluations);
  const t = [];
  if (ev.length === 0) return ['Aucune évaluation sur la période : aucune tendance ne peut être décrite.'];
  if (ev.length === 1) return ['Une seule évaluation sur la période : aucune tendance ne peut être décrite.'];
  const moitie = Math.floor(ev.length / 2);
  const a = moyenne(ev.slice(0, moitie).map((e) => e.note));
  const b = moyenne(ev.slice(ev.length - moitie).map((e) => e.note));
  const diff = b - a;
  if (ev.length >= 4) {
    t.push(`Moyenne des ${moitie} premières évaluations : ${nombreFr(a)}/10 ; des ${moitie} dernières : ${nombreFr(b)}/10 (écart ${signeFr(diff)} point${Math.abs(diff) >= 2 ? 's' : ''}).`);
  } else {
    t.push(`Première note de la période : ${ev[0].note}/10 ; dernière note : ${ev[ev.length - 1].note}/10.`);
  }
  const s = statistiques(ev);
  if (s.nombreMatin && s.nombreSoir) {
    const d = s.moyenneSoir - s.moyenneMatin;
    if (Math.abs(d) < 0.05) t.push('Les moyennes du matin et du soir sont identiques.');
    else t.push(`La moyenne du soir est ${d > 0 ? 'supérieure' : 'inférieure'} de ${nombreFr(Math.abs(d))} point${Math.abs(d) >= 2 ? 's' : ''} à celle du matin (${pluriel(s.nombreMatin, 'évaluation')} le matin, ${pluriel(s.nombreSoir, 'évaluation')} le soir).`);
  }
  t.push(`Amplitude observée : de ${s.min}/10 à ${s.max}/10.`);
  let changements = 0;
  for (let i = 1; i < ev.length; i++) if (Math.abs(ev[i].note - ev[i - 1].note) >= 3) changements++;
  if (changements) t.push(`${pluriel(changements, 'variation')} d'au moins 3 points entre deux évaluations successives.`);
  return t;
}

export function sujetsDeDiscussion(evaluations, frequences, previsions, comptes) {
  const sujets = [];
  const def = frequences.filter((f) => f.polarite === 'defavorable').slice(0, 3);
  const fav = frequences.filter((f) => f.polarite === 'favorable').slice(0, 3);
  const mix = frequences.filter((f) => f.polarite === 'mixte').slice(0, 3);
  const liste = (fs) => fs.map((f) => `${f.libelle} (${f.nombre})`).join(', ');
  if (def.length) sujets.push(`Facteurs défavorables le plus souvent cochés : ${liste(def)}.`);
  if (fav.length) sujets.push(`Facteurs favorables le plus souvent cochés : ${liste(fav)}.`);
  if (mix.length) sujets.push(`Facteurs mixtes cochés : ${liste(mix)}.`);
  const basses = trierChrono(evaluations.filter((e) => e.note <= 3));
  if (basses.length) sujets.push(`${pluriel(basses.length, 'évaluation')} à 3/10 ou moins : ${basses.map((e) => `${formatDateCourte(e.date)} ${LIBELLE_CRENEAU[e.creneau].toLowerCase()} (${e.note}/10)`).join(', ')}.`);
  const secu = trierChrono(evaluations.filter((e) => e.securite && e.securite.declenchee));
  if (secu.length) sujets.push(`Une vérification de sécurité a été proposée lors de ${pluriel(secu.length, 'évaluation')} : ${secu.map((e) => `${formatDateCourte(e.date)} ${LIBELLE_CRENEAU[e.creneau].toLowerCase()}`).join(', ')}.`);
  const grands = previsions.lignes.filter((l) => l.ecart !== null && Math.abs(l.ecart) >= 3);
  if (grands.length) sujets.push(`Écarts d'au moins 3 points entre prévision et réalité : ${grands.map((l) => `${formatDateCourte(l.cible.date)} ${LIBELLE_CRENEAU[l.cible.creneau].toLowerCase()} (prévu ${l.prevue}, constaté ${l.reelle})`).join(', ')}.`);
  if (comptes && comptes.omises) sujets.push(`${pluriel(comptes.omises, 'créneau omis', 'créneaux omis')} sur la période.`);
  if (comptes && comptes.enRetard) sujets.push(`${pluriel(comptes.enRetard, 'évaluation saisie', 'évaluations saisies')} après la fin de son créneau (saisie rétrospective).`);
  const commentees = evaluations.filter((e) => e.explication || e.complement || (e.prevision && e.prevision.motif));
  if (commentees.length) sujets.push(`${pluriel(commentees.length, 'évaluation comporte', 'évaluations comportent')} un commentaire libre, reproduit en annexe.`);
  if (!sujets.length) sujets.push('Aucun élément particulier ne ressort des données saisies sur la période.');
  return sujets;
}

// ---------------------------------------------------------------------------
// Paramètres

export function parametresParDefaut(instant = Date.now()) {
  return {
    theme: 'auto',
    destinataire: '',
    debutSuiviUtc: new Date(instant).toISOString(),
    contactConfiance: { nom: '', telephone: '' },
    rappelsDansApplication: false,
    serveurRappels: { url: '', jeton: '', actif: false },
    ia: { actif: false, fournisseur: 'anthropic', cle: '', modele: 'claude-sonnet-5-5', personne: 'troisieme', automatique: true, consentementUtc: null, consentementFournisseur: '' },
    titreRappelDiscret: false,
    derniereSauvegardeUtc: null,
    prochaineSeance: '',
    dernierRapport: null,
    derniereSauvegardeFichierUtc: null,
  };
}

// ---------------------------------------------------------------------------
// Export / import

/** Les clés d'accès ne quittent jamais l'appareil (ni sauvegardes, ni exports). */
export function sansSecrets(parametres) {
  const p = { ...parametres };
  if (p.ia) p.ia = { ...p.ia, cle: '' };
  return p;
}

export function exporterJSON({ parametres, motifs, evaluations, archives = [] }, instant = Date.now()) {
  return {
    format: FORMAT_DONNEES,
    versionFormat: VERSION_FORMAT,
    versionApplication: VERSION_APP,
    exporteLeUtc: new Date(instant).toISOString(),
    fuseau: FUSEAU,
    parametres: sansSecrets(parametres),
    motifs: [...motifs],
    evaluations: trierChrono(evaluations),
    archives: [...archives],
  };
}

function verifierEvaluation(e) {
  const ok = e && typeof e.id === 'string' && estDateValide(e.date) && CRENEAUX.includes(e.creneau)
    && Number.isInteger(e.note) && e.note >= 0 && e.note <= 10 && e.creneauId === idCreneau(e.date, e.creneau);
  if (!ok) throw new Error(`Évaluation invalide dans le fichier (${e && e.id ? e.id : 'sans identifiant'}).`);
  return {
    motifs: [], autresMotifs: [], explication: '', complement: '', prevision: null, historique: [],
    securite: { declenchee: false, raisons: [] }, version: 1, modifieLeUtc: null, validationConnue: !!e.valideLeUtc,
    niveau: nomNiveau(e.note), rappelPrevuUtc: new Date(heurePrevue(e.date, e.creneau)).toISOString(),
    ...e,
  };
}

function verifierMotif(m) {
  if (!m || typeof m.id !== 'string' || !String(m.libelle || '').trim() || !POLARITES.includes(m.polarite)) {
    throw new Error(`Motif invalide dans le fichier (${m && m.libelle ? m.libelle : 'sans libellé'}).`);
  }
  return { actif: true, regroupeDans: null, ordre: 0, creeLeUtc: null, modifieLeUtc: null, ...m };
}

export function lireJSON(texte) {
  let d;
  try { d = typeof texte === 'string' ? JSON.parse(texte.replace(/^\uFEFF/, '')) : texte; } catch { throw new Error('Le fichier n\'est pas un JSON lisible.'); }
  if (!d || d.format !== FORMAT_DONNEES) throw new Error('Ce fichier ne provient pas du Baromètre de l\'humeur.');
  if (d.versionFormat > VERSION_FORMAT) throw new Error('Ce fichier provient d\'une version plus récente de l\'application.');
  return {
    parametres: d.parametres || null,
    motifs: (d.motifs || []).map(verifierMotif),
    evaluations: (d.evaluations || []).map(verifierEvaluation),
    archives: d.archives || [],
    exporteLeUtc: d.exporteLeUtc || null,
  };
}

// CSV (séparateur « ; », UTF-8 avec BOM : s'ouvre directement dans Excel en français)

const COLONNES_EVAL = [
  'id', 'date', 'creneau', 'rappel_prevu_local', 'rappel_prevu_utc', 'validation_locale', 'validation_utc',
  'heure_validation_connue', 'saisie_retrospective', 'note', 'niveau', 'motifs', 'autres_motifs', 'explication',
  'complement', 'prevision_cible', 'prevision_note', 'prevision_niveau', 'prevision_motif', 'verification_securite',
  'source', 'note_origine', 'cree_le_utc', 'modifie_le_utc', 'version', 'motifs_json', 'autres_motifs_json', 'prevision_json',
  'securite_json', 'reformulation_json', 'historique_json',
];
const COLONNES_MOTIF = ['id', 'libelle', 'polarite', 'actif', 'regroupe_dans', 'ordre', 'origine', 'cree_le_utc', 'modifie_le_utc'];

function celluleCSV(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exporterCSVEvaluations(evaluations) {
  const lignes = [COLONNES_EVAL.join(';')];
  for (const e of trierChrono(evaluations)) {
    const p = e.prevision;
    const v = {
      id: e.id, date: e.date, creneau: e.creneau,
      rappel_prevu_local: formatDateHeure(e.rappelPrevuUtc), rappel_prevu_utc: e.rappelPrevuUtc,
      validation_locale: e.valideLeUtc ? formatDateHeure(e.valideLeUtc) : 'inconnue', validation_utc: e.valideLeUtc || '',
      heure_validation_connue: e.validationConnue ? 'oui' : 'non', saisie_retrospective: e.saisieRetrospective ? 'oui' : 'non',
      note: e.note, niveau: e.niveau,
      motifs: (e.motifs || []).map((m) => m.libelle).join(' | '),
      autres_motifs: (e.autresMotifs || []).map((m) => m.libelle).join(' | '),
      explication: e.explication, complement: e.complement,
      prevision_cible: p ? `${p.cible.date} ${p.cible.creneau}` : '', prevision_note: p && Number.isInteger(p.note) ? p.note : '',
      prevision_niveau: p ? p.niveau : '', prevision_motif: p ? p.motif : '',
      verification_securite: e.securite && e.securite.declenchee ? 'oui' : 'non',
      source: e.source, note_origine: e.noteOrigine || '', cree_le_utc: e.creeLeUtc || '', modifie_le_utc: e.modifieLeUtc || '', version: e.version,
      motifs_json: JSON.stringify(e.motifs || []), autres_motifs_json: JSON.stringify(e.autresMotifs || []),
      prevision_json: JSON.stringify(p || null), securite_json: JSON.stringify(e.securite || null),
      reformulation_json: 'reformulation' in e ? JSON.stringify(e.reformulation ?? null) : '',
      historique_json: JSON.stringify(e.historique || []),
    };
    lignes.push(COLONNES_EVAL.map((c) => celluleCSV(v[c])).join(';'));
  }
  return '\uFEFF' + lignes.join('\r\n') + '\r\n';
}

export function exporterCSVMotifs(motifs) {
  const lignes = [COLONNES_MOTIF.join(';')];
  for (const m of motifs) {
    const v = { id: m.id, libelle: m.libelle, polarite: m.polarite, actif: m.actif ? 'oui' : 'non', regroupe_dans: m.regroupeDans || '', ordre: m.ordre ?? 0, origine: m.origine || '', cree_le_utc: m.creeLeUtc || '', modifie_le_utc: m.modifieLeUtc || '' };
    lignes.push(COLONNES_MOTIF.map((c) => celluleCSV(v[c])).join(';'));
  }
  return '\uFEFF' + lignes.join('\r\n') + '\r\n';
}

export function analyserCSV(texte) {
  const t = texte.replace(/^\uFEFF/, '');
  const premiere = t.split(/\r?\n/, 1)[0];
  const sep = (premiere.match(/;/g) || []).length >= (premiere.match(/,/g) || []).length ? ';' : ',';
  const lignes = [];
  let ligne = [], champ = '', guillemets = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (guillemets) {
      if (c === '"') { if (t[i + 1] === '"') { champ += '"'; i++; } else guillemets = false; } else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.length > 1 || ligne[0] !== '') lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  if (!lignes.length) return [];
  const entetes = lignes[0].map((h) => h.trim());
  return lignes.slice(1).map((l) => Object.fromEntries(entetes.map((h, i) => [h, l[i] ?? ''])));
}

export function lireCSV(texte) {
  const rangees = analyserCSV(texte);
  if (!rangees.length) throw new Error('Le fichier CSV est vide.');
  const cles = Object.keys(rangees[0]);
  if (cles.includes('note') && cles.includes('creneau')) {
    const evaluations = rangees.map((r) => {
      const json = (k, d) => { try { return r[k] ? JSON.parse(r[k]) : d; } catch { throw new Error(`Colonne ${k} illisible.`); } };
      const note = Number.parseInt(r.note, 10);
      return verifierEvaluation({
        id: r.id || nouvelId(), date: r.date, creneau: r.creneau, creneauId: idCreneau(r.date, r.creneau),
        rappelPrevuUtc: r.rappel_prevu_utc || undefined, valideLeUtc: r.validation_utc || null,
        validationConnue: r.heure_validation_connue ? r.heure_validation_connue === 'oui' : !!r.validation_utc,
        saisieRetrospective: r.saisie_retrospective === 'oui', note, niveau: nomNiveau(note),
        motifs: json('motifs_json', []), autresMotifs: json('autres_motifs_json', []),
        explication: r.explication || '', complement: r.complement || '', prevision: json('prevision_json', null),
        securite: json('securite_json', verificationSecurite(note, [r.explication, r.complement])),
        source: r.source || 'import', ...(r.note_origine ? { noteOrigine: r.note_origine } : {}), creeLeUtc: r.cree_le_utc || null, modifieLeUtc: r.modifie_le_utc || null,
        version: Number.parseInt(r.version, 10) || 1, historique: json('historique_json', []),
        ...(r.reformulation_json ? { reformulation: json('reformulation_json', null) } : {}),
      });
    });
    return { type: 'evaluations', evaluations, motifs: [] };
  }
  if (cles.includes('libelle') && cles.includes('polarite')) {
    const motifs = rangees.map((r) => verifierMotif({
      id: r.id || nouvelId(), libelle: r.libelle, polarite: r.polarite, actif: r.actif !== 'non',
      regroupeDans: r.regroupe_dans || null, ordre: Number.parseInt(r.ordre, 10) || 0, ...(r.origine ? { origine: r.origine } : {}),
      creeLeUtc: r.cree_le_utc || null, modifieLeUtc: r.modifie_le_utc || null,
    }));
    return { type: 'motifs', evaluations: [], motifs };
  }
  throw new Error('Colonnes CSV non reconnues : utilisez un fichier exporté par l\'application.');
}

const horodatage = (x) => Date.parse(x.modifieLeUtc || x.creeLeUtc || 0) || 0;

/**
 * Fusionne des données importées avec les données locales sans rien perdre :
 * toute évaluation écartée est placée dans les archives.
 */
export function fusionner(local, importe, instant = Date.now()) {
  const le = new Date(instant).toISOString();
  const evals = new Map(local.evaluations.map((e) => [e.id, e]));
  const parCreneau = new Map(local.evaluations.map((e) => [e.creneauId, e]));
  const archives = [];
  const rapport = { ajoutees: 0, misesAJour: 0, identiques: 0, conflits: 0, anciennesIgnorees: 0, motifsAjoutes: 0, motifsMisAJour: 0 };
  for (const e of importe.evaluations) {
    const existante = evals.get(e.id);
    if (existante) {
      if (JSON.stringify(existante) === JSON.stringify(e)) { rapport.identiques++; continue; }
      const vI = e.version || 1, vL = existante.version || 1;
      if (vI > vL) {
        evals.set(e.id, e); parCreneau.set(e.creneauId, e); rapport.misesAJour++;
      } else if (vI < vL) {
        rapport.anciennesIgnorees++;
      } else {
        archives.push({ id: nouvelId(), archiveLeUtc: le, raison: 'Version concurrente lors d\'un import (version locale conservée).', evaluation: e });
        rapport.conflits++;
      }
      continue;
    }
    const occupant = parCreneau.get(e.creneauId);
    if (occupant) {
      archives.push({ id: nouvelId(), archiveLeUtc: le, raison: 'Créneau déjà renseigné sur cet appareil lors d\'un import (évaluation locale conservée).', evaluation: e });
      rapport.conflits++;
      continue;
    }
    evals.set(e.id, e); parCreneau.set(e.creneauId, e); rapport.ajoutees++;
  }
  const motifs = new Map(local.motifs.map((m) => [m.id, m]));
  for (const m of importe.motifs) {
    const ex = motifs.get(m.id);
    if (!ex) { motifs.set(m.id, m); rapport.motifsAjoutes++; } else if (horodatage(m) > horodatage(ex)) { motifs.set(m.id, m); rapport.motifsMisAJour++; }
  }
  return { evaluations: [...evals.values()], motifs: [...motifs.values()], archives, rapport };
}

// ---------------------------------------------------------------------------
// Rappels : calendrier .ics et script Windows

function echapperICS(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
function plierICS(ligne) {
  const enc = new TextEncoder();
  if (enc.encode(ligne).length <= 75) return ligne;
  const res = [];
  let cour = '';
  for (const ch of ligne) {
    if (enc.encode(cour + ch).length > (res.length ? 74 : 75)) { res.push(cour); cour = ''; }
    cour += ch;
  }
  res.push(cour);
  return res.join('\r\n ');
}

export function genererICS(urlApplication, { discret = false, instant = Date.now() } = {}) {
  const auj = dateLocale(instant).replace(/-/g, '');
  const stamp = new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const base = urlApplication.replace(/[?#].*$/, '');
  const ev = (creneau) => {
    const hh = HEURES_RAPPEL[creneau].replace(':', '') + '00';
    const titre = discret ? (creneau === 'matin' ? 'Rappel du matin' : 'Rappel du soir') : `Baromètre de l'humeur – évaluation du ${creneau}`;
    const url = `${base}?creneau=${creneau}`;
    return [
      'BEGIN:VEVENT', `UID:barometre-humeur-${creneau}@appareil-local`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${FUSEAU}:${auj}T${hh}`, 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
      `SUMMARY:${echapperICS(titre)}`, `DESCRIPTION:${echapperICS(`Ouvrez l'application installée pour répondre.\n${url}`)}`,
      `URL:${url}`, 'TRANSP:TRANSPARENT', 'CLASS:PRIVATE',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${echapperICS(titre)}`, 'TRIGGER:PT0M', 'END:VALARM',
      'END:VEVENT',
    ];
  };
  const lignes = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Barometre de l humeur//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', `TZID:${FUSEAU}`,
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'TZNAME:CEST', 'DTSTART:19700329T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'TZNAME:CET', 'DTSTART:19701025T030000', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'END:STANDARD',
    'END:VTIMEZONE',
    ...ev('matin'), ...ev('soir'),
    'END:VCALENDAR',
  ];
  return lignes.map(plierICS).join('\r\n') + '\r\n';
}

function echapperXML(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

/**
 * Script Windows (fichier .cmd autonome) qui installe deux tâches planifiées à 06:00 et 18:00
 * (heure locale de Windows, changements d'heure automatiques) affichant une notification Windows.
 * Un clic ouvre l'évaluation correspondante dans Microsoft Edge.
 */
export function genererScriptWindows(urlApplication, { discret = false } = {}) {
  const base = urlApplication.replace(/[?#].*$/, '');
  if (!/^https:\/\/|^http:\/\/localhost/.test(base)) throw new Error('Adresse de l\'application invalide.');
  const ps = (s) => s.replace(/'/g, "''");
  const titre = (c) => (discret ? (c === 'matin' ? 'Rappel du matin' : 'Rappel du soir') : `Évaluation du ${c}`);
  const corps = discret ? 'Cliquez pour ouvrir.' : 'Comment te sens-tu en ce moment ? Cliquez pour répondre.';
  const xml = (c) => echapperXML(`microsoft-edge:${base}?creneau=${c}`);
  const lignes = [
    '<# : Barometre de l humeur - rappels Windows',
    '@echo off',
    'chcp 65001 >nul',
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "$f=\'%~f0\'; iex ([IO.File]::ReadAllText($f,[Text.Encoding]::UTF8))"',
    'echo.',
    'pause',
    'exit /b',
    '#>',
    '$ErrorActionPreference = "Stop"',
    `$dossier = Join-Path $env:LOCALAPPDATA "BarometreHumeur"`,
    '$script = Join-Path $dossier "rappel.ps1"',
    'function Installer {',
    '  New-Item -ItemType Directory -Force -Path $dossier | Out-Null',
    '  $contenu = @\'',
    'param([string]$creneau)',
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
    'if ($creneau -eq "matin") {',
    `  $xml = '<toast activationType="protocol" launch="${ps(xml('matin'))}" scenario="reminder"><visual><binding template="ToastGeneric"><text>${ps(echapperXML(titre('matin')))}</text><text>${ps(echapperXML(corps))}</text></binding></visual><actions><action content="Répondre" activationType="protocol" arguments="${ps(xml('matin'))}"/><action content="Plus tard" activationType="system" arguments="dismiss"/></actions></toast>'`,
    '} else {',
    `  $xml = '<toast activationType="protocol" launch="${ps(xml('soir'))}" scenario="reminder"><visual><binding template="ToastGeneric"><text>${ps(echapperXML(titre('soir')))}</text><text>${ps(echapperXML(corps))}</text></binding></visual><actions><action content="Répondre" activationType="protocol" arguments="${ps(xml('soir'))}"/><action content="Plus tard" activationType="system" arguments="dismiss"/></actions></toast>'`,
    '}',
    '$doc = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$doc.LoadXml($xml)',
    '$app = \'{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe\'',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($doc))',
    '\'@',
    '  [IO.File]::WriteAllText($script, $contenu, (New-Object Text.UTF8Encoding $true))',
    '  foreach ($c in @(@{n="matin";h="06:00"}, @{n="soir";h="18:00"})) {',
    '    $nom = "Barometre humeur - " + $c.n',
    '    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ("-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"" + $script + "`" -creneau " + $c.n)',
    '    $declencheur = New-ScheduledTaskTrigger -Daily -At $c.h',
    '    $declencheur.StartBoundary = (Get-Date).Date.AddHours([int]$c.h.Substring(0,2)).ToString("yyyy-MM-ddTHH:mm:ss")',
    '    $reglages = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 5)',
    '    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited',
    '    Register-ScheduledTask -TaskName $nom -TaskPath "\\" -Action $action -Trigger $declencheur -Settings $reglages -Principal $principal -Force | Out-Null',
    '  }',
    '  Write-Host ""',
    '  Write-Host "Rappels installés : tous les jours à 06:00 et 18:00 (heure de Windows)." -ForegroundColor Green',
    '  Write-Host "Une notification de test va s\'afficher."',
    '  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -creneau matin',
    '}',
    'function Desinstaller {',
    '  foreach ($n in @("matin","soir")) { Unregister-ScheduledTask -TaskName ("Barometre humeur - " + $n) -Confirm:$false -ErrorAction SilentlyContinue }',
    '  Remove-Item -Recurse -Force $dossier -ErrorAction SilentlyContinue',
    '  Write-Host "Rappels supprimés." -ForegroundColor Green',
    '}',
    'Write-Host "Baromètre de l\'humeur - rappels Windows"',
    'Write-Host ""',
    'Write-Host "  1  Installer les rappels (06:00 et 18:00)"',
    'Write-Host "  2  Supprimer les rappels"',
    'Write-Host "  3  Afficher une notification de test"',
    'Write-Host ""',
    '$choix = Read-Host "Votre choix (1, 2 ou 3)"',
    'switch ($choix) {',
    '  "1" { Installer }',
    '  "2" { Desinstaller }',
    '  "3" { if (Test-Path $script) { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $script -creneau soir } else { Write-Host "Installez d\'abord les rappels (choix 1)." } }',
    '  default { Write-Host "Aucune action." }',
    '}',
  ];
  return lignes.join('\r\n') + '\r\n';
}
