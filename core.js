// Baromètre de l'humeur — logique métier pure (aucun accès au DOM ni au réseau).
// Ce module est partagé par l'application, le générateur de rapport et les tests.

export const VERSION_APP = '1.12.0';
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
  a_rattraper: 'À rattraper',
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

/** Après la fin du créneau, une évaluation oubliée peut encore être saisie pendant ce délai (en heures). */
export const DELAI_RATTRAPAGE_H = 24;
export function limiteSaisie(date, creneau) {
  return expiration(date, creneau) + DELAI_RATTRAPAGE_H * 3600000;
}
/** Une NOUVELLE évaluation peut être saisie pour ce créneau (les modifications restent toujours possibles). */
export function peutSaisir(creneau, instant) {
  return peutRepondre(creneau, instant) && instant < limiteSaisie(creneau.date, creneau.creneau);
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
  if (instant < exp + DELAI_RATTRAPAGE_H * 3600000) return 'a_rattraper';
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
  const c = { attendues: 0, completees: 0, aLHeure: 0, enRetard: 0, omises: 0, enAttente: 0, aRattraper: 0, aVenir: 0, nonRenseignees: 0, heureInconnue: 0 };
  for (const s of grille) {
    switch (s.statut) {
      case 'repondu':
        c.completees++; c.aLHeure++;
        if (s.evaluation && !s.evaluation.validationConnue) { c.heureInconnue++; c.aLHeure--; }
        break;
      case 'repondu_retard': c.completees++; c.enRetard++; break;
      case 'omis': c.omises++; break;
      case 'en_attente': c.enAttente++; break;
      case 'a_rattraper': c.aRattraper++; break;
      case 'a_venir': c.aVenir++; break;
      case 'non_renseigne': c.nonRenseignees++; break;
      default: break;
    }
  }
  c.attendues = c.completees + c.omises + c.enAttente + c.aRattraper;
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

export const LONGUEUR_DESCRIPTION_MOTIF = 200;

export function creerMotif(libelle, polarite, instant = Date.now(), ordre = 0, description = '') {
  const l = String(libelle || '').trim();
  if (!l) throw new Error('Le libellé du motif est vide.');
  if (!POLARITES.includes(polarite)) throw new Error('Polarité inconnue.');
  const d = String(description || '').replace(/\s+/g, ' ').trim().slice(0, LONGUEUR_DESCRIPTION_MOTIF);
  return { id: nouvelId(), libelle: l, polarite, actif: true, regroupeDans: null, ordre, ...(d ? { description: d } : {}), creeLeUtc: new Date(instant).toISOString(), modifieLeUtc: null };
}

/**
 * Courte description d'un motif, affichée quand on le coche : celle saisie, sinon la liste des motifs
 * qui y sont regroupés. Chaîne vide s'il n'y a rien à dire.
 */
export function descriptionMotif(m, bibliotheque = []) {
  if (!m) return '';
  if (m.description) return m.description;
  const enfants = bibliotheque.filter((x) => x.regroupeDans === m.id).map((x) => x.libelle);
  return enfants.length ? `Comprend : ${enfants.join(', ')}.` : '';
}

// Simplification proposée de la bibliothèque (octobre 2026) : motifs proches réunis sous un libellé court.
// L'ordre compte : un motif est rangé dans le premier groupe dont un mot-clé correspond (sans accents ni casse).
export const PLAN_MOTIFS = [
  { libelle: 'Calme et solitude', polarite: 'favorable', cles: [/calme/, /tranquill/, /absence de bruit/, /solitude/], description: 'Calme, tranquillité, absence de bruit, solitude appréciée.' },
  { libelle: 'Liberté, sans contraintes', polarite: 'favorable', cles: [/liberte/, /autonomie/, /contrainte/], description: 'Se sentir libre et autonome, sans obligations ni contraintes.' },
  { libelle: 'Réussite ou retour positif', polarite: 'favorable', cles: [/retour positif/, /application/, /reussite/], description: 'Un travail abouti ou reconnu : retour positif sur les recherches, application créée, finalisée ou améliorée…' },
  { libelle: 'Projets personnels (recherches, photo…)', polarite: 'favorable', cles: [/projet/, /genealog/, /histoire/, /recherche/, /photo/], description: 'Projets créatifs et personnels : recherches généalogiques, histoire d\'Arsdorf, photographie…' },
  { libelle: 'Journée utile et occupée', polarite: 'favorable', cles: [/occupe/, /utile/], description: 'Sentiment d\'avoir été occupé de manière constructive, journée utile.' },
  { libelle: 'Activité physique, promenade', polarite: 'favorable', cles: [/promenade/, /activite physique/, /sport/], description: 'Promenade, sport ou toute activité physique, même avec peu de motivation.' },
  { libelle: 'Fanclub du KSC', polarite: 'favorable', cles: [/fanclub/, /karlsruher/, /\bksc\b/], description: 'Activités liées au fanclub du Karlsruher SC.' },
  { libelle: 'Moments avec mes proches', polarite: 'favorable', cles: [/enfant/, /(^|\s)ami/, /proches/, /famill/], description: 'Moments partagés avec les enfants, la famille ou des amis.' },
  { libelle: 'Santé : soin ou bonne nouvelle', polarite: 'favorable', cles: [/diagnostic/, /pedicure/, /medecin/, /sante/, /soin/], description: 'Soin reçu ou bonne nouvelle médicale : diagnostic clair, pédicure médicale…' },
  { libelle: 'Bon sommeil', polarite: 'favorable', cles: [/sommeil/, /dormi/], description: 'Nuit réparatrice, bien dormi.' },
  { libelle: 'Peur du retour au travail', polarite: 'defavorable', cles: [/bureau/, /retour (potentiel )?(au|a) (travail|bureau)/, /retour au travail/], description: 'Appréhension d\'un retour possible au bureau.' },
  { libelle: 'Contraintes familiales (organisation)', polarite: 'defavorable', cles: [/contraintes? famil/, /logisti/, /organisation famil/], description: 'Stress d\'organisation dans la famille : rendez-vous, horaires, logistique (sans conflit).' },
  {
    libelle: 'Conflits personnels', polarite: 'defavorable', cles: [/conflit/, /dispute/, /streit/, /couple/], description: 'Dispute ou tension avec une personne proche. Précise avec qui (facultatif).',
    sous: [
      { libelle: 'Conflit dans le couple', cles: [/couple/, /conjoint/, /partenaire/, /compagne/, /epouse/, /\bfemme\b/], description: 'Avec ma femme.' },
      { libelle: 'Conflit avec mes enfants', cles: [/\bfils\b/, /\bfille\b/, /enfant/], description: 'Avec mon fils ou mes enfants.' },
      { libelle: 'Conflit avec mes parents ou ma famille', cles: [/\bmere\b/, /maman/, /\bpere\b/, /papa/, /parents/, /\bsoeur\b/, /\bfrere\b/, /oncle/, /tante/], description: 'Avec ma mère, mon père ou un autre membre de la famille.' },
      { libelle: 'Conflit avec un ami ou un collègue', cles: [/(^|\s)ami/, /collegue/, /copain/], description: 'Avec un bon ami ou un collègue proche.' },
      { libelle: 'Conflit avec une autre personne', cles: [/autre personne/, /quelqu.un/], description: 'Avec quelqu\'un d\'autre, sans préciser.' },
    ],
  },
  { libelle: 'Mes enfants (manque, culpabilité)', polarite: 'defavorable', cles: [/enfant/, /culpabilit/], description: 'Les enfants manquent, ou culpabilité de ne pas assez s\'investir auprès d\'eux.' },
  { libelle: 'Bruit et désordre au domicile', polarite: 'defavorable', cles: [/bruit/, /travaux/, /domicile/, /desordre/], description: 'Bruit, travaux, stress ou désordre visuel au domicile.' },
  { libelle: 'Soucis financiers ou administratifs', polarite: 'defavorable', cles: [/financ/, /courrier/, /administrat/, /facture/], description: 'Préoccupations d\'argent, courrier désagréable (rétention, pénalité, facture, résultats d\'analyses).' },
  { libelle: 'Fatigue, mauvais repos', polarite: 'defavorable', cles: [/fatigue/, /repos/, /recuper/], description: 'Fatigue, difficulté à se reposer et à récupérer.' },
  { libelle: 'Trop d\'écran', polarite: 'defavorable', cles: [/ecran/], description: 'Temps excessif passé devant un écran.' },
  { libelle: 'Santé : douleurs, peur de la maladie', polarite: 'defavorable', cles: [/douleur/, /cancer/, /maladie/], description: 'Douleurs physiques, peur du cancer ou de la maladie.' },
  { libelle: 'Manque d\'organisation ou de motivation', polarite: 'defavorable', cles: [/organis/, /motiv/, /equilibre/], description: 'Difficulté à s\'organiser, à se motiver (activité physique) ou à trouver un équilibre de vie sain.' },
  { libelle: 'Surcharge mentale', polarite: 'defavorable', cles: [/stimul/, /court.?circuit/, /surcharge/], description: 'Trop de sollicitations en même temps, sensation de court-circuit mental.' },
  { libelle: 'Contrariétés du quotidien', polarite: 'defavorable', cles: [/flash/, /trop vite/, /performance/, /\bksc\b/, /contrariet/], description: 'Petits événements contrariants : excès de vitesse flashé, mauvais résultats du KSC…' },
  { libelle: 'Anxiété, préoccupations', polarite: 'defavorable', cles: [/anxi/, /preoccup/, /angoiss/], description: 'Anxiété diffuse, préoccupations personnelles.' },
];

/**
 * Proposition de simplification : pour chaque groupe du plan, les motifs actifs qui s'y rangent,
 * le motif conservé (celui qui porte déjà le nouveau libellé, sinon le plus utilisé), et les motifs non classés.
 */
export function planSimplification(motifs, usage = new Map(), plan = PLAN_MOTIFS) {
  const actifs = motifs.filter((m) => m.actif && !m.regroupeDans);
  // Liste à plat : les sous-motifs suivent leur motif parent (champ « parent » = index du parent)
  const cibles = [];
  for (const g of plan) {
    const ip = cibles.push({ ...g, parent: null }) - 1;
    for (const sm of g.sous || []) cibles.push({ ...sm, polarite: g.polarite, parent: ip });
  }
  const groupes = cibles.map((g) => ({ cible: g, membres: [], principal: null }));
  const nonClasses = [];
  for (const m of actifs) {
    const n = normaliserLibelle(m.libelle);
    let i = cibles.findIndex((g) => g.polarite === m.polarite && normaliserLibelle(g.libelle) === n);
    if (i < 0) {
      i = cibles.findIndex((g) => g.parent === null && g.polarite === m.polarite && g.cles.some((r) => r.test(n)));
      // Dans un motif à sous-catégories, la sous-catégorie qui correspond (sinon le motif lui-même)
      if (i >= 0) {
        const sous = cibles.findIndex((g) => g.parent === i && g.cles.some((r) => r.test(n)));
        if (sous >= 0) i = sous;
      }
    }
    if (i < 0) nonClasses.push(m); else groupes[i].membres.push(m);
  }
  let changements = 0;
  for (const g of groupes) {
    const k = normaliserLibelle(g.cible.libelle);
    g.principal = g.membres.find((m) => normaliserLibelle(m.libelle) === k)
      || [...g.membres].sort((a, b) => (usage.get(b.id) || 0) - (usage.get(a.id) || 0) || (a.ordre ?? 0) - (b.ordre ?? 0))[0] || null;
    g.aCreer = !g.principal;
    const p = g.principal;
    const parent = g.cible.parent === null ? null : groupes[g.cible.parent].principal;
    if (!p || p.libelle !== g.cible.libelle || (p.description || '') !== g.cible.description || (g.cible.parent !== null && (!parent || p.parentId !== parent.id))) changements++;
    changements += g.membres.filter((m) => m !== p).length;
  }
  return { groupes, nonClasses, changements };
}

/** Motifs à enregistrer pour appliquer la simplification (renommés, regroupés, créés, rattachés). Rien n'est supprimé. */
export function appliquerSimplification(motifs, plan, instant = Date.now()) {
  const le = new Date(instant).toISOString();
  const sortie = [];
  const finaux = [];
  let ordre = Math.max(0, ...motifs.map((m) => m.ordre ?? 0));
  plan.groupes.forEach((g, i) => {
    const parent = g.cible.parent === null ? null : finaux[g.cible.parent];
    let p = g.principal;
    if (!p) {
      p = { ...creerMotif(g.cible.libelle, g.cible.polarite, instant, ++ordre, g.cible.description), ...(parent ? { parentId: parent.id } : {}) };
      sortie.push(p);
    } else if (p.libelle !== g.cible.libelle || (p.description || '') !== g.cible.description || (parent ? p.parentId !== parent.id : !!p.parentId)) {
      const { parentId: _ancien, ...sansParent } = p;
      p = { ...sansParent, libelle: g.cible.libelle, description: g.cible.description, ordre: i, ...(parent ? { parentId: parent.id } : {}), modifieLeUtc: le };
      sortie.push(p);
    }
    finaux[i] = p;
    for (const m of g.membres) if (m.id !== p.id) sortie.push({ ...m, regroupeDans: p.id, actif: false, modifieLeUtc: le });
  });
  return sortie;
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

/** Sous-motifs actifs d'un motif (affichés quand le motif est coché). */
export function sousMotifs(m, bibliotheque) {
  return bibliotheque.filter((x) => x.parentId === m.id && x.actif && !x.regroupeDans);
}

// ---------------------------------------------------------------------------
// Contexte de chaque évaluation : lieu de séjour et situation professionnelle

export const SITUATIONS = {
  conge_maladie: 'Congé maladie',
  conge: 'Congé',
  temps_plein: 'Travail à temps plein',
  reprise_progressive: 'Reprise progressive',
  weekend_ferie: 'Week-end / jour férié',
};
export const ORDRE_SITUATIONS = ['conge_maladie', 'conge', 'temps_plein', 'reprise_progressive', 'weekend_ferie'];
export const SITUATIONS_AVEC_MODALITE = ['temps_plein', 'reprise_progressive'];
export const MODALITES = { teletravail: 'Télétravail', sur_site: 'Sur site' };

const nombreOuNull = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? Math.round(v * 1e5) / 1e5 : null);

/** Pas de lieu fixe sur la période : randonnée, tour à vélo, balade… */
export const LIEU_ITINERANCE = Object.freeze({ nom: 'Itinérance', region: '', pays: '', codePays: '', lat: null, lon: null, source: 'itinerance' });
export const estItinerance = (l) => !!l && l.source === 'itinerance';
export const LONGUEUR_ACTIVITE = 80;

/** Lieu normalisé { nom, region, pays, codePays, lat, lon, source, activite? } ou null. */
export function normaliserLieu(l) {
  if (!l) return null;
  const txt = (v, n = 120) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const activite = txt(l.activite, LONGUEUR_ACTIVITE);
  if (l.source === 'itinerance') return { ...LIEU_ITINERANCE, ...(activite ? { activite } : {}) };
  const nom = txt(l.nom);
  if (!nom) return null;
  const code = txt(l.codePays, 3).toUpperCase();
  return {
    nom,
    region: txt(l.region),
    pays: txt(l.pays),
    codePays: /^[A-Z]{2}$/.test(code) ? code : '',
    lat: nombreOuNull(l.lat, -90, 90),
    lon: nombreOuNull(l.lon, -180, 180),
    source: l.source === 'carte' ? 'carte' : 'libre',
    ...(activite ? { activite } : {}),
  };
}

/** Le lieu seul, sans l'activité (pour le proposer à nouveau). */
export function lieuSansActivite(l) {
  if (!l) return null;
  const { activite, ...reste } = l;
  return reste;
}

/** Clé de regroupement : même nom (sans accents ni casse) et même pays. */
export function cleLieu(l) {
  return l ? `${normaliserLibelle(l.nom)}|${(l.codePays || '').toLowerCase()}` : '';
}

export function libelleLieu(l, { complet = false } = {}) {
  if (!l) return '';
  if (estItinerance(l)) return complet ? 'Itinérance (randonnée, vélo, balade…)' : 'Itinérance';
  if (!complet) return l.nom;
  const details = [l.region && normaliserLibelle(l.region) !== normaliserLibelle(l.nom) ? l.region : '', l.pays].filter(Boolean);
  return details.length ? `${l.nom} (${details.join(', ')})` : l.nom;
}

export const MAX_LIEUX = 3; // par période d'environ 12 heures

/** Liste ordonnée de lieux normalisés (lieux vides ignorés, au plus MAX_LIEUX). */
export function normaliserLieux(liste) {
  return (Array.isArray(liste) ? liste : [liste]).map(normaliserLieu).filter(Boolean).slice(0, MAX_LIEUX);
}

/**
 * Lieux d'une évaluation, dans l'ordre de la journée. Les évaluations anciennes (ou modifiées sur un
 * appareil pas encore mis à jour) n'ont que « lieu » : on s'y fie si la liste ne commence pas par lui.
 */
export function lieuxDe(e) {
  if (!e) return [];
  if (Array.isArray(e.lieux) && e.lieux.length && cleLieu(e.lieux[0]) === cleLieu(e.lieu)) return e.lieux;
  return e.lieu ? [e.lieu] : [];
}

/** « Arsdorf → Schouweiler (pédicure médicale) → Leudelange → Arsdorf » */
export function libelleLieux(liste, { complet = false, activites = true, separateur = ' → ' } = {}) {
  return (liste || []).map((l) => `${libelleLieu(l, { complet })}${activites && l.activite ? ` (${l.activite})` : ''}`).join(separateur);
}

/** Activités suggérées au départ ; celles déjà saisies passent devant. */
export const ACTIVITES_PROPOSEES = [
  'Lieu de travail', 'Télétravail', 'Courses', 'Restaurant', 'Visite familiale', 'Sortie entre amis',
  'Rendez-vous médical', 'Pédicure médicale', 'Kinésithérapie', 'Séance de psychothérapie', 'Démarches administratives',
  'Sport', 'Match de foot', 'Randonnée', 'Tour à vélo', 'Promenade', 'Cinéma', 'Concert', 'Lecture', 'Repos à la maison', 'Jardinage', 'Bricolage',
];

/** Activités déjà saisies (de la plus fréquente à la moins fréquente), puis les suggestions de départ. */
export function activitesConnues(evaluations) {
  const compte = new Map();
  for (const e of evaluations) {
    for (const l of lieuxDe(e)) {
      if (!l.activite) continue;
      const k = normaliserLibelle(l.activite);
      const c = compte.get(k) || { libelle: l.activite, nombre: 0 };
      c.nombre++;
      compte.set(k, c);
    }
  }
  const saisies = [...compte.values()].sort((a, b) => b.nombre - a.nombre || a.libelle.localeCompare(b.libelle, 'fr')).map((c) => c.libelle);
  const vus = new Set(compte.keys());
  return [...saisies, ...ACTIVITES_PROPOSEES.filter((a) => !vus.has(normaliserLibelle(a)))];
}

/** Activités dont un mot commence par le texte tapé (sans accents ni casse), début de libellé d'abord. */
export function filtrerActivites(activites, texte, max = 8) {
  const q = normaliserLibelle(texte);
  if (!q) return activites.slice(0, max);
  return activites
    .map((a, i) => { const n = normaliserLibelle(a); return { a, i, rang: n.startsWith(q) ? 0 : n.split(/[\s'’\-(]+/).some((m) => m.startsWith(q)) ? 1 : n.includes(q) ? 2 : 9 }; })
    .filter((x) => x.rang < 9 && normaliserLibelle(x.a) !== q)
    .sort((x, y) => x.rang - y.rang || x.i - y.i)
    .slice(0, max).map((x) => x.a);
}

export function humeurParActivite(evaluations) {
  return humeurParCategorie(evaluations, (e) => lieuxDe(e).filter((l) => l.activite).map((l) => l.activite), normaliserLibelle, (a) => a);
}

export function cleLieux(liste) { return (liste || []).map(cleLieu).join('>'); }

/** Situation normalisée { statut, modalite } ou null. La modalité n'existe que pour le travail. */
export function normaliserSituation(x) {
  if (!x || !SITUATIONS[x.statut]) return null;
  const modalite = SITUATIONS_AVEC_MODALITE.includes(x.statut) && MODALITES[x.modalite] ? x.modalite : null;
  return { statut: x.statut, modalite };
}

export function cleSituation(x) { return x ? `${x.statut}${x.modalite ? `:${x.modalite}` : ''}` : ''; }

export function libelleSituation(x) {
  if (!x || !SITUATIONS[x.statut]) return '';
  return `${SITUATIONS[x.statut]}${x.modalite ? ` – ${MODALITES[x.modalite].toLowerCase()}` : ''}`;
}

/** Lieux déjà utilisés, du plus récent au plus ancien (pour l'autocomplétion). */
export function lieuxConnus(evaluations) {
  const parCle = new Map();
  for (const e of trierChrono(evaluations)) {
    for (const avecActivite of lieuxDe(e)) {
      if (estItinerance(avecActivite)) continue; // proposée par son propre bouton
      const l = lieuSansActivite(avecActivite);
      const k = cleLieu(l);
      const ex = parCle.get(k);
      // On garde la version la plus précise (avec coordonnées) et la plus récente
      const lieu = ex && ex.lieu.lat !== null && l.lat === null ? ex.lieu : l;
      parCle.set(k, { cle: k, lieu, nombre: (ex ? ex.nombre : 0) + 1, dernier: e.creneauId });
    }
  }
  return [...parCle.values()].sort((a, b) => (a.dernier < b.dernier ? 1 : -1));
}

/** Filtre les lieux connus selon le texte tapé (début de mot, sans accents ni casse). */
export function filtrerLieux(connus, texte, max = 6) {
  const q = normaliserLibelle(texte);
  if (!q) return connus.slice(0, max);
  const score = (c) => {
    const n = normaliserLibelle(c.lieu.nom);
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if (n.split(/[\s'-]+/).some((m) => m.startsWith(q))) return 2;
    return normaliserLibelle(libelleLieu(c.lieu, { complet: true })).includes(q) ? 3 : 9;
  };
  return connus.map((c) => [score(c), c]).filter(([sc]) => sc < 9).sort((a, b) => a[0] - b[0]).slice(0, max).map(([, c]) => c);
}

const TYPES_LIEUX = new Set(['city', 'town', 'village', 'hamlet', 'suburb', 'quarter', 'neighbourhood', 'locality', 'municipality', 'borough', 'isolated_dwelling', 'island', 'district']);

/** Convertit une réponse du service de recherche Photon (OpenStreetMap) en lieux normalisés. */
export function lieuxDepuisPhoton(reponse) {
  const vus = new Set();
  const sortie = [];
  for (const f of (reponse && reponse.features) || []) {
    const pr = f.properties || {};
    if (!pr.name) continue;
    if (pr.osm_key && pr.osm_key !== 'place' && pr.osm_key !== 'boundary') continue;
    if (pr.osm_value && pr.osm_key === 'place' && !TYPES_LIEUX.has(pr.osm_value)) continue;
    const coord = (f.geometry && f.geometry.coordinates) || [];
    const region = [pr.city, pr.county, pr.state].find((v) => v && normaliserLibelle(v) !== normaliserLibelle(pr.name)) || '';
    const lieu = normaliserLieu({ nom: pr.name, region, pays: pr.country, codePays: pr.countrycode, lat: coord[1], lon: coord[0], source: 'carte' });
    const k = `${cleLieu(lieu)}|${normaliserLibelle(region)}`;
    if (!lieu || vus.has(k)) continue;
    vus.add(k);
    sortie.push(lieu);
  }
  return sortie;
}

const estWeekend = (date) => { const j = new Date(`${date}T12:00:00Z`).getUTCDay(); return j === 0 || j === 6; };

/**
 * Proposition de lieu et de situation pour un créneau, d'après les évaluations précédentes :
 * lieu = le dernier lieu de la dernière évaluation ; situation = celle de la dernière évaluation du même jour,
 * sinon d'un jour du même type (semaine ou week-end). Rien n'est proposé sans antécédent.
 */
export function suggestionContexte(evaluations, { date, creneau }) {
  const id = idCreneau(date, creneau);
  const avant = trierChrono(evaluations).filter((e) => e.creneauId < id).reverse();
  // Là où la période précédente s'est terminée (hors itinérance), sans l'activité
  const precedente = avant.find((e) => lieuxDe(e).some((l) => !estItinerance(l)));
  const lieu = precedente ? lieuSansActivite(lieuxDe(precedente).filter((l) => !estItinerance(l)).at(-1)) : null;
  const sit = avant.find((e) => e.situation && (e.date === date || estWeekend(e.date) === estWeekend(date)));
  return { lieu, situation: sit ? sit.situation : null };
}

/** Humeur par catégorie (lieu ou situation) : nombre, moyenne, minimum, maximum. */
export function humeurParCategorie(evaluations, extraire, cle, libelle) {
  const groupes = new Map();
  let sansValeur = 0;
  for (const e of evaluations) {
    // Une évaluation avec plusieurs lieux compte une fois pour chacun d'eux
    const valeurs = [].concat(extraire(e) || []).filter(Boolean);
    if (!valeurs.length) { sansValeur++; continue; }
    const vus = new Set();
    for (const v of valeurs) {
      const k = cle(v);
      if (vus.has(k)) continue;
      vus.add(k);
      const g = groupes.get(k) || { cle: k, libelle: libelle(v), valeur: v, notes: [] };
      g.notes.push(e.note);
      groupes.set(k, g);
    }
  }
  const lignes = [...groupes.values()].map((g) => ({
    cle: g.cle, libelle: g.libelle, valeur: g.valeur, nombre: g.notes.length,
    moyenne: moyenne(g.notes), min: Math.min(...g.notes), max: Math.max(...g.notes),
  })).sort((a, b) => b.nombre - a.nombre || a.libelle.localeCompare(b.libelle, 'fr'));
  return { lignes, sansValeur };
}

export function humeurParLieu(evaluations) {
  return humeurParCategorie(evaluations, lieuxDe, cleLieu, (l) => libelleLieu(l, { complet: true }));
}

export const JOURS_SEMAINE = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
/** Humeur par jour de la semaine, du lundi au dimanche (jours sans évaluation inclus, nombre 0). */
export function humeurParJourSemaine(evaluations) {
  const jour = (d) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  const r = humeurParCategorie(evaluations, (e) => String(jour(e.date)), (k) => k, (k) => JOURS_SEMAINE[Number(k)]);
  return JOURS_SEMAINE.map((nom, i) => r.lignes.find((l) => l.cle === String(i)) || { cle: String(i), libelle: nom, valeur: String(i), nombre: 0, moyenne: null, min: null, max: null });
}

/** Répartition des notes de 0 à 10. */
export function repartitionNotes(evaluations) {
  const n = Array(11).fill(0);
  for (const e of evaluations) if (Number.isInteger(e.note)) n[e.note]++;
  return n;
}

export function humeurParSituation(evaluations) {
  const r = humeurParCategorie(evaluations, (e) => e.situation, cleSituation, libelleSituation);
  const ordre = (x) => ORDRE_SITUATIONS.indexOf(x.valeur.statut) * 3 + (x.valeur.modalite === 'sur_site' ? 2 : x.valeur.modalite ? 1 : 0);
  r.lignes.sort((a, b) => ordre(a) - ordre(b));
  return r;
}

/**
 * Ordre stable des lieux pour les couleurs des graphiques : du plus fréquent au moins fréquent
 * sur l'ensemble du suivi (la couleur d'un lieu ne change pas quand on change de période).
 */
export function ordreLieux(evaluations) {
  return humeurParLieu(evaluations).lignes.map((l) => l.cle);
}

/**
 * Évaluations concernées par une complétion rétroactive : période, créneaux, et
 * (sauf « remplacer ») uniquement celles où la valeur manque.
 */
export function cibleCompletion(evaluations, { debut, fin, creneaux = CRENEAUX, lieu, situation, remplacer = false }) {
  return trierChrono(dansPeriode(evaluations, debut, fin)).filter((e) => {
    if (!creneaux.includes(e.creneau)) return false;
    const changeLieu = lieu !== undefined && (remplacer || !lieuxDe(e).length) && cleLieux(lieuxDe(e)) !== cleLieux(normaliserLieux([lieu]));
    const changeSit = situation !== undefined && (remplacer || !e.situation) && cleSituation(e.situation) !== cleSituation(normaliserSituation(situation));
    return changeLieu || changeSit;
  });
}

/** Applique la complétion rétroactive ; retourne les évaluations modifiées (historique tracé). */
export function appliquerCompletion(evaluations, options, instant = Date.now()) {
  const n = { lieu: options.lieu === undefined ? undefined : normaliserLieu(options.lieu), situation: options.situation === undefined ? undefined : normaliserSituation(options.situation) };
  const modifiees = [];
  for (const e of cibleCompletion(evaluations, options)) {
    const saisie = {};
    if (n.lieu !== undefined && (options.remplacer || !lieuxDe(e).length)) saisie.lieux = n.lieu ? [n.lieu] : [];
    if (n.situation !== undefined && (options.remplacer || !e.situation)) saisie.situation = n.situation;
    const r = modifierEvaluation(e, saisie, options.raison || 'Lieu et situation complétés a posteriori', instant);
    if (r) modifiees.push(r);
  }
  return modifiees;
}

// ---------------------------------------------------------------------------
// Évaluations

const LIMITE_TEXTE = 10000;

/**
 * Informations encore manquantes pour qu'une NOUVELLE évaluation soit complète :
 * note, au moins un lieu, situation professionnelle (et modalité si besoin), au moins un motif ou un texte, note prévue.
 * Retourne [{ champ, message }] (vide si tout est rempli).
 */
export function informationsManquantes(s) {
  const m = [];
  if (!Number.isInteger(s.note)) m.push({ champ: 'q1', message: 'la note actuelle (question 1)' });
  if (!normaliserLieux(s.lieux !== undefined ? s.lieux : [s.lieu]).length) m.push({ champ: 'q4', message: 'au moins un lieu (Contexte)' });
  const sit = s.situation;
  if (!sit || !SITUATIONS[sit.statut]) m.push({ champ: 'q4', message: 'ta situation professionnelle (Contexte)' });
  else if (SITUATIONS_AVEC_MODALITE.includes(sit.statut) && !MODALITES[sit.modalite]) m.push({ champ: 'q4', message: 'télétravail ou sur site (Contexte)' });
  const motifs = (s.motifs || []).length + (s.autresMotifs || []).length;
  if (!motifs && !String(s.explication || '').trim()) m.push({ champ: 'q2', message: 'au moins un motif coché ou une explication (question 2)' });
  if (!s.prevision || !Number.isInteger(s.prevision.note)) m.push({ champ: 'q3', message: 'la note prévue (question 3)' });
  return m;
}

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
  if (s.situation && !SITUATIONS[s.situation.statut]) erreurs.push('Situation professionnelle inconnue.');
  const lieuxSaisis = s.lieux !== undefined ? [].concat(s.lieux || []) : [].concat(s.lieu || []);
  if (lieuxSaisis.some((l) => l && String(l.nom || '').length > 120)) erreurs.push('Nom de lieu trop long (120 caractères maximum).');
  if (lieuxSaisis.some((l) => l && String(l.activite || '').trim().length > LONGUEUR_ACTIVITE)) erreurs.push(`Activité trop longue (${LONGUEUR_ACTIVITE} caractères maximum).`);
  if (lieuxSaisis.filter(Boolean).length > MAX_LIEUX) erreurs.push(`${MAX_LIEUX} lieux au maximum par évaluation.`);
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
    ...champsLieux(saisie.lieux !== undefined ? saisie.lieux : saisie.lieu),
    situation: normaliserSituation(saisie.situation),
    securite: verificationSecurite(saisie.note, textes),
    source: 'application',
    creeLeUtc: new Date(instant).toISOString(),
    modifieLeUtc: null,
    version: 1,
    historique: [],
  };
}

/** { lieu, lieux } : « lieu » (le premier) reste renseigné pour les appareils pas encore mis à jour. */
function champsLieux(saisie) {
  const lieux = normaliserLieux(saisie == null ? [] : saisie);
  return { lieu: lieux[0] || null, lieux };
}

const CHAMPS_MODIFIABLES = ['note', 'motifs', 'autresMotifs', 'explication', 'complement', 'prevision', 'lieux', 'situation'];
export const LIBELLE_CHAMP = {
  note: 'Note', niveau: 'Niveau', motifs: 'Motifs', autresMotifs: 'Autres motifs', explication: 'Explication',
  complement: 'Complément', prevision: 'Prévision', reformulation: 'Version pour le rapport',
  lieu: 'Lieu', lieux: 'Lieux', situation: 'Situation professionnelle',
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
    lieux: saisie.lieux !== undefined ? saisie.lieux : saisie.lieu !== undefined ? [].concat(saisie.lieu || []) : lieuxDe(ev),
    situation: saisie.situation === undefined ? ev.situation : saisie.situation,
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
    ...champsLieux(fusion.lieux),
    situation: saisie.situation === undefined ? (ev.situation ?? null) : normaliserSituation(fusion.situation),
  };
  const changements = [];
  for (const champ of CHAMPS_MODIFIABLES) {
    const avant = champ === 'lieux' ? lieuxDe(ev) : (ev[champ] ?? null);
    const apres = nouveau[champ] ?? null;
    if (JSON.stringify(avant) !== JSON.stringify(apres)) changements.push({ champ, avant, apres });
  }
  if (!changements.length) return null;
  // Si un texte original change, la version reformulée doit être revue avant d'être réutilisée.
  const motifsPrev = (p) => JSON.stringify(((p && p.motifs) || []).map((m) => m.libelle));
  const textesChanges = changements.some((c) => c.champ === 'explication' || c.champ === 'complement' || c.champ === 'motifs' || c.champ === 'autresMotifs'
    || (c.champ === 'prevision' && (((c.avant && c.avant.motif) || '') !== ((c.apres && c.apres.motif) || '') || motifsPrev(c.avant) !== motifsPrev(c.apres))));
  if (textesChanges && ev.reformulation && ev.reformulation.statut !== 'a_revoir') {
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
// Version rédigée pour le rapport (orthographe corrigée, motifs intégrés, traduite en français, style professionnel).
// Le texte original n'est jamais modifié ; seule une version VALIDÉE par le patient figure dans le PDF.

export const STATUTS_REFORMULATION = { proposee: 'Proposition à relire', validee: 'Validée', a_revoir: 'À revoir (texte original modifié)' };

export function textesOriginaux(ev) {
  return { explication: ev.explication || '', complement: ev.complement || '', prevision: (ev.prevision && ev.prevision.motif) || '' };
}

/**
 * Méthode de rédaction des versions pour le thérapeute : 3 = complète, motifs intégrés, traduite, toujours « le patient » ;
 * 4 = idem, 500 caractères au plus par texte, sans redite quand des motifs se ressemblent.
 */
export const METHODE_VERSION = 4;
export const LONGUEUR_VERSION = 500;

/** Un texte de la version dépasse la longueur permise. */
export function versionTropLongue(r) {
  return !!r && ['explication', 'complement', 'prevision'].some((k) => String(r[k] || '').length > LONGUEUR_VERSION);
}

/** Champs qui peuvent recevoir une version : l'explication intègre aussi les motifs cochés. */
export function champsVersion(ev) {
  const t = textesOriginaux(ev);
  const motifs = (ev.motifs || []).length + (ev.autresMotifs || []).length;
  const motifsPrev = (ev.prevision && (ev.prevision.motifs || []).length) || 0;
  return { explication: !!(t.explication || motifs), complement: !!t.complement, prevision: !!(t.prevision || motifsPrev) };
}

/** Évaluation qui a de la matière pour une version rédigée (commentaires ou motifs cochés). */
export function aDesTextes(ev) {
  const c = champsVersion(ev);
  return c.explication || c.complement || c.prevision;
}

/** Version préparée avec une méthode antérieure (à refaire pour bénéficier de la nouvelle rédaction). */
export function versionAncienneMethode(ev) {
  const r = ev.reformulation;
  return !!(r && ((r.methode || 1) < 3 || versionTropLongue(r)));
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
    const permis = champsVersion(ev);
    for (const k of Object.keys(champs)) if (champs[k] && !permis[k]) throw new Error('Une version reformulée ne peut pas ajouter un texte absent de l\'original.');
    if (!champs.explication && !champs.complement && !champs.prevision) throw new Error('La version reformulée est vide.');
    const statut = reformulation.statut === 'validee' ? 'validee' : 'proposee';
    apres = {
      ...champs,
      statut,
      source: reformulation.source === 'manuelle' ? 'manuelle' : 'assistant',
      methode: reformulation.methode || (ev.reformulation && ev.reformulation.methode) || (reformulation.source === 'manuelle' ? METHODE_VERSION : 1),
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
  const c = champsVersion(ev);
  const choix = { explication: c.explication ? (r.explication || orig.explication) : '', complement: c.complement ? (r.complement || orig.complement) : '', prevision: c.prevision ? (r.prevision || orig.prevision) : '' };
  return { ...choix, reformule: true, original: mode === 'les-deux' ? orig : null, valideeLeUtc: r.valideeLeUtc, methode: r.methode || 1 };
}

/** Ce qui est transmis pour la rédaction : textes et motifs cochés, sans nom, note, date, lieu ni situation. */
export function entreesReformulation(evaluations) {
  return trierChrono(evaluations).filter(aDesTextes).map((e) => {
    const t = textesOriginaux(e);
    const tous = [...(e.motifs || []), ...(e.autresMotifs || [])];
    const parPol = (pol) => tous.filter((m) => m.polarite === pol).map((m) => m.libelle);
    return {
      id: e.id,
      motifs_favorables: parPol('favorable'), motifs_defavorables: parPol('defavorable'), motifs_mixtes: parPol('mixte'),
      explication: t.explication, complement: t.complement,
      prevision: t.prevision, motifs_prevision: ((e.prevision && e.prevision.motifs) || []).map((m) => m.libelle),
    };
  });
}

/** Pronoms et possessifs de la première personne (hors citations) : la version doit parler du « patient ». */
const PREMIERE_PERSONNE = /(^|[^\p{L}])(?:(?:je|moi|me|mon|ma|mes|nous|notre|nos)(?=[^\p{L}]|$)|[jm]['’](?=\p{L}))/iu;
export function contientPremierePersonne(texte) {
  const sansCitations = String(texte || '').replace(/«[^»]*»|"[^"]*"|“[^”]*”/g, ' ');
  return PREMIERE_PERSONNE.test(sansCitations);
}

export function instructionsReformulation() {
  const style = 'toujours à la troisième personne, en désignant l\'auteur par « le patient » (puis « il » ou « le patient »)';
  return `Tu es un rédacteur francophone de très haut niveau. Tu reçois des entrées du journal d'humeur d'un patient, destinées à son psychothérapeute. Le patient relira et validera chaque texte.

Pour chaque entrée, rédige en français, ${style}, dans une langue soignée, précise et naturelle, d'un registre professionnel, neutre et factuel :
- « explication » : un texte complet qui présente d'abord les éléments cochés par le patient (« motifs_favorables », « motifs_defavorables », « motifs_mixtes »), en les intégrant naturellement (par exemple « Le patient mentionne comme éléments favorables… »), puis tout le contenu du texte « explication ». S'il n'y a que des motifs, une ou deux phrases qui les présentent suffisent. S'il n'y a ni motifs ni explication, renvoie une chaîne vide.
- « complement » : tout le contenu du complément ; chaîne vide s'il est vide.
- « prevision » : la raison de la prévision, en y intégrant les « motifs_prevision » s'il y en a ; chaîne vide si les deux sont vides.

Règles impératives :
- Écris exclusivement à la troisième personne : jamais « je », « j' », « me », « moi », « mon », « ma », « mes », « nous ». Même si le patient écrit « je », transpose systématiquement (« je suis fatigué » devient « Le patient se dit fatigué » ou « Le patient est fatigué »). Chaque texte commence par « Le patient » ou « Il ».
- Si un texte est rédigé en allemand, en anglais, en luxembourgeois ou dans un mélange de langues, traduis-le fidèlement en français.
- Corrige toutes les fautes d'orthographe, de grammaire, de conjugaison, d'accord et de ponctuation.
- Longueur : chaque texte (« explication », « complement », « prevision ») compte au maximum ${LONGUEUR_VERSION} caractères, espaces compris. Si le contenu tient dans cette limite, conserve-le en entier (faits, émotions, causes évoquées, projets, difficultés, chiffres, noms propres, lieux). Sinon, condense en gardant l'essentiel et chaque élément important, sans rien inventer.
- Aucune redite : si plusieurs motifs ou passages expriment la même idée (par exemple « Calme et tranquillité » et « Absence de bruit », ou un motif coché que le texte répète), ne l'écris qu'une seule fois, en une formulation qui les réunit.
- N'ajoute aucune information absente des entrées, aucune interprétation, aucune hypothèse, aucun vocabulaire clinique ni diagnostic.
- Présente les motifs comme des éléments mentionnés par le patient, sans en tirer de conclusion.
- Conserve exactement chaque « id ».

Réponds uniquement avec du JSON valide, sans texte autour, sous cette forme exacte :
{"entrees": [{"id": "…", "explication": "…", "complement": "…", "prevision": "…"}]}`;
}

export function demandeReformulation(evaluations, options = {}) {
  return `${instructionsReformulation(options)}

Entrées :
${JSON.stringify(entreesReformulation(evaluations), null, 2)}
`;
}

// ---------------------------------------------------------------------------
// Synthèse de la période (1000 caractères au plus), rédigée par un assistant avec l'accord du patient,
// puis relue et validée par lui. Seules des données agrégées et les textes déjà validés sont transmis :
// jamais le nom, l'adresse, le matricule, ni les dates du calendrier (les jours sont numérotés).

export const LONGUEUR_SYNTHESE = 1000;

export function donneesSynthese(evaluations, motifs, { debut, fin, instant = Date.now(), debutSuiviUtc = null }) {
  const evals = trierChrono(dansPeriode(evaluations, debut, fin));
  const grille = grilleCreneaux(debut, fin, evaluations, instant, debutSuiviUtc);
  const comptes = comptesCreneaux(grille);
  const st = statistiques(evals);
  const prev = comparaisonsPrevisions(evals, evaluations);
  const arrondi = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
  const cat = (r) => r.lignes.map((l) => ({ libelle: l.libelle, evaluations: l.nombre, moyenne: arrondi(l.moyenne), min: l.min, max: l.max }));
  const freq = frequenceMotifs(evals, motifs);
  const textes = evals.map((e) => {
    const t = textesPourRapport(e, 'reformule');
    return t.reformule ? [t.explication, t.complement].filter(Boolean).join(' ') : '';
  });
  return {
    periode: { jours: joursEntre(debut, fin) + 1 },
    evaluations: { attendues: comptes.attendues, completees: comptes.completees, omises: comptes.omises, en_retard: comptes.enRetard },
    moyennes: { generale: arrondi(st.moyenne), matin: arrondi(st.moyenneMatin), soir: arrondi(st.moyenneSoir), min: st.nombre ? st.min : null, max: st.nombre ? st.max : null },
    echelle: NIVEAUX.map((n, i) => `${i} = ${n}`).join(' ; '),
    serie: evals.map((e, i) => ({ jour: joursEntre(debut, e.date) + 1, jour_semaine: JOURS_SEMAINE[(new Date(`${e.date}T12:00:00Z`).getUTCDay() + 6) % 7], creneau: e.creneau, note: e.note, ...(textes[i] ? { texte_valide: textes[i] } : {}) })),
    tendances: tendancesDescriptives(evals),
    par_jour_semaine: humeurParJourSemaine(evals).filter((l) => l.nombre).map((l) => ({ jour: l.libelle, evaluations: l.nombre, moyenne: arrondi(l.moyenne) })),
    par_situation: cat(humeurParSituation(evals)),
    par_lieu: cat(humeurParLieu(evals)),
    par_activite: cat(humeurParActivite(evals)),
    motifs_favorables: freq.filter((f) => f.polarite === 'favorable').map((f) => ({ motif: f.libelle, fois: f.nombre })),
    motifs_defavorables: freq.filter((f) => f.polarite === 'defavorable').map((f) => ({ motif: f.libelle, fois: f.nombre })),
    previsions: { comparees: prev.nombreComparees, identiques: prev.exactes, realite_superieure: prev.realiteSuperieure, realite_inferieure: prev.realiteInferieure, ecart_moyen: arrondi(prev.ecartMoyen) },
    verifications_securite: evals.filter((e) => e.securite && e.securite.declenchee).length,
  };
}

export function instructionsSynthese() {
  return `Tu es un rédacteur francophone de très haut niveau. Tu reçois les données agrégées d'un journal d'humeur tenu deux fois par jour par un patient (note de 0 à 10, voir « echelle »), pour une période donnée, ainsi que ses commentaires déjà relus et validés (« texte_valide »). Le texte est destiné à son psychothérapeute ; le patient le relira et le validera.

Rédige une synthèse en français, à la troisième personne (« le patient »), dans un langage professionnel mais clair, neutre et factuel, en deux parties :
Évolution : quelques phrases sur l'évolution de l'humeur pendant la période (niveau général, tendance, variations, moments, jours, situations, lieux ou activités associés aux notes les plus basses ou les plus hautes).
Points prioritaires : deux à quatre points, chacun sur une ligne commençant par « – », qui méritent l'attention en priorité selon les données (par exemple un jour, une situation ou un lieu nettement plus difficile, des motifs défavorables récurrents, des notes très basses, un écart entre prévisions et réalité, des évaluations omises).

Règles impératives :
- ${LONGUEUR_SYNTHESE} caractères au maximum au total, espaces compris.
- N'utilise que les données fournies : aucune information inventée, aucune hypothèse, aucun diagnostic, aucun vocabulaire clinique, aucun conseil de traitement.
- Présente les liens comme des constats (« les notes les plus basses sont relevées le lundi »), jamais comme des causes.
- Ne considère jamais qu'une note supérieure à zéro exclut un risque ; si une vérification de sécurité a eu lieu, mentionne-le sobrement.
- Si les données sont trop peu nombreuses pour une conclusion, dis-le simplement.
- Aucune redite : chaque idée n'est écrite qu'une fois.
- Pas de dates du calendrier (les jours sont numérotés) ; tu peux citer les jours de la semaine.

Réponds uniquement avec du JSON valide, sans texte autour : {"synthese": "Évolution : …\\nPoints prioritaires :\\n– …\\n– …"}`;
}

/** Lit la synthèse renvoyée par l'assistant (JSON, éventuellement entouré de texte ou de balises de code). */
export function lireReponseSynthese(texte) {
  const brut = String(texte || '');
  const debutJson = brut.indexOf('{');
  const finJson = brut.lastIndexOf('}');
  if (debutJson >= 0 && finJson > debutJson) {
    try {
      const d = JSON.parse(brut.slice(debutJson, finJson + 1));
      if (d && typeof d.synthese === 'string' && d.synthese.trim()) return d.synthese.trim();
    } catch { /* texte brut ci-dessous */ }
  }
  const t = brut.replace(/^```\w*|```$/g, '').trim();
  if (!t) throw new Error('Réponse vide de l\'assistant.');
  return t;
}

/** Synthèse enregistrée (et validée) pour exactement cette période, ou null. */
export function syntheseDe(parametres, debut, fin, { valideeSeulement = true } = {}) {
  const l = (parametres && parametres.syntheses) || [];
  return l.find((x) => x.debut === debut && x.fin === fin && (!valideeSeulement || x.statut === 'validee')) || null;
}

/** Ajoute ou remplace la synthèse d'une période (10 dernières conservées). */
export function enregistrerSynthese(parametres, synthese) {
  const autres = ((parametres && parametres.syntheses) || []).filter((x) => !(x.debut === synthese.debut && x.fin === synthese.fin));
  return [synthese, ...autres].slice(0, 10);
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
    const permis = champsVersion(ev);
    const prop = {};
    for (const k of ['explication', 'complement', 'prevision']) prop[k] = permis[k] ? nettoyerTexte(x[k]) : '';
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
    emailTherapeute: '',
    rechercheLieux: true,
    fondCarte: true,
    saisieComplete: true,
    alerteManquee: true,
    debutSuiviUtc: new Date(instant).toISOString(),
    contactConfiance: { nom: '', telephone: '' },
    rappelsDansApplication: false,
    serveurRappels: { url: '', jeton: '', actif: false },
    ia: { actif: false, fournisseur: 'anthropic', cle: '', modele: 'claude-opus-5-5', personne: 'troisieme', automatique: true, consentementUtc: null, consentementFournisseur: '' },
    titreRappelDiscret: false,
    derniereSauvegardeUtc: null,
    prochaineSeance: '',
    seances: [],
    patient: { nom: '', adresse: '', cns: '' },
    therapeute: { nom: '', titre: '', adresse: '' },
    rapportAvecCNS: true,
    dernierRapport: null,
    reglagesModifiesLeUtc: null,
    motifsSupprimes: [],
    synchro: { actif: false, phrase: '', version: 0, derniereUtc: null, erreur: '' },
    derniereSauvegardeFichierUtc: null,
  };
}

// ---------------------------------------------------------------------------
// Identités (rapport) : patient et thérapeute. Restent sur les appareils (et la copie chiffrée) ;
// jamais transmises au service de reformulation.

/** Matricule CNS luxembourgeois : 13 chiffres. Retourne les chiffres, ou '' si vide ; lève une erreur si invalide. */
export function normaliserCNS(texte) {
  const brut = String(texte || '').trim();
  if (!brut) return '';
  const chiffres = brut.replace(/[\s.\-/]/g, '');
  if (!/^\d{13}$/.test(chiffres)) throw new Error('Le matricule CNS doit comporter 13 chiffres.');
  return chiffres;
}

/** 1985061512345 → « 1985 0615 123 45 » (année, mois-jour, numéro, contrôle). */
export function formatCNS(cns) {
  const c = String(cns || '');
  return /^\d{13}$/.test(c) ? `${c.slice(0, 4)} ${c.slice(4, 8)} ${c.slice(8, 11)} ${c.slice(11)}` : c;
}

const nettoyerLignes = (t, max = 300) => String(t || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, max);

export function normaliserPatient(p = {}) {
  return { nom: nettoyerLignes(p.nom, 120).replace(/\n/g, ' '), adresse: nettoyerLignes(p.adresse), cns: normaliserCNS(p.cns) };
}

export function normaliserTherapeute(t = {}) {
  return { nom: nettoyerLignes(t.nom, 120).replace(/\n/g, ' '), titre: nettoyerLignes(t.titre, 120).replace(/\n/g, ' '), adresse: nettoyerLignes(t.adresse) };
}

// ---------------------------------------------------------------------------
// Séances (consultations) : date, heure de début et de fin, en heure de Luxembourg

const heureFr = (h) => h.replace(/^0(\d)/, '$1').replace(':', ' h ').replace(/ h 00$/, ' h');
const estHeure = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h || '');

export function normaliserSeance(x) {
  if (!x || !estDateValide(x.date)) throw new Error('Date de séance invalide.');
  const debut = estHeure(x.debut) ? x.debut : '';
  const fin = estHeure(x.fin) ? x.fin : '';
  if (fin && !debut) throw new Error('Indique aussi l\'heure de début.');
  if (debut && fin && fin <= debut) throw new Error('L\'heure de fin doit être après l\'heure de début.');
  return { id: x.id || nouvelId(), date: x.date, debut, fin };
}

/** Début et fin de la séance (ms UTC). Sans heure : toute la journée ; sans fin : une heure. */
export function bornesSeance(s) {
  const debut = localVersUtc(s.date, s.debut || '00:00');
  let fin;
  if (s.fin) fin = localVersUtc(s.date, s.fin);
  else if (s.debut) fin = debut + 3600000;
  else fin = localVersUtc(ajouterJours(s.date, 1), '00:00');
  return { debut, fin };
}

export function trierSeances(seances) {
  return [...(seances || [])].sort((a, b) => (a.date + (a.debut || '')).localeCompare(b.date + (b.debut || '')));
}

/** Prochaine séance (en cours ou à venir), ou null. */
export function prochaineSeance(seances, instant) {
  return trierSeances(seances).find((s) => bornesSeance(s).fin > instant) || null;
}

/** Séances terminées, de la plus récente à la plus ancienne. */
export function seancesPassees(seances, instant) {
  return trierSeances(seances).filter((s) => bornesSeance(s).fin <= instant).reverse();
}

export function libelleSeance(s, { court = false } = {}) {
  if (!s) return '';
  const jour = court ? formatDateCourte(s.date) : formatDateLongue(s.date);
  const heures = s.debut ? (s.fin ? `, ${heureFr(s.debut)}–${heureFr(s.fin)}` : `, ${heureFr(s.debut)}`) : '';
  return `${jour}${heures}`;
}

/** Liste des séances après l'ancien réglage « prochaineSeance » (date seule). */
export function seancesDepuisParametres(p) {
  const liste = Array.isArray(p && p.seances) ? p.seances.filter((s) => s && estDateValide(s.date)) : [];
  if (!liste.length && p && estDateValide(p.prochaineSeance)) return [{ id: `ancienne-${p.prochaineSeance}`, date: p.prochaineSeance, debut: '', fin: '' }];
  return trierSeances(liste);
}

/**
 * Périodes proposées pour le rapport. Chaque option : { cle, libelle, debut, fin }.
 * « Entre deux séances » : du jour de la séance au jour de la suivante (inclus).
 */
export function periodesRapport(seances, { instant, aujourdhui, debutSuivi }) {
  const passees = seancesPassees(seances, instant);
  const options = [];
  const borne = (d) => d;
  if (passees.length) {
    options.push({ cle: 'depuis-seance', libelle: `Depuis la dernière séance (${libelleSeance(passees[0], { court: true })})`, debut: borne(passees[0].date), fin: aujourdhui });
  }
  for (let i = 0; i + 1 < passees.length && i < 8; i++) {
    const a = passees[i + 1], b = passees[i];
    options.push({ cle: `entre-${a.id}-${b.id}`, entre: true, libelle: `Entre les séances du ${formatDateCourte(a.date)} et du ${formatDateCourte(b.date)}`, debut: borne(a.date), fin: b.date < aujourdhui ? b.date : aujourdhui });
  }
  const auPlusTot = (d) => (d < debutSuivi ? debutSuivi : d);
  options.push({ cle: '7', libelle: '7 derniers jours', debut: auPlusTot(ajouterJours(aujourdhui, -6)), fin: aujourdhui });
  options.push({ cle: '30', libelle: 'Dernier mois (30 jours)', debut: auPlusTot(ajouterJours(aujourdhui, -29)), fin: aujourdhui });
  options.push({ cle: 'tout', libelle: 'Depuis le début du suivi', debut: debutSuivi < aujourdhui ? debutSuivi : aujourdhui, fin: aujourdhui });
  return options.filter((o) => o.debut <= o.fin);
}

// ---------------------------------------------------------------------------
// Envoi du rapport par e-mail (depuis la messagerie de l'utilisateur)

export function estEmailValide(texte) {
  return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(String(texte || '').trim());
}

/** Objet et texte du message qui accompagne le rapport. N'inclut aucune donnée de santé. */
export function messageEnvoiRapport({ destinataire = '', debut, fin, prochaineSeance = '', seance: seanceObj = null, aujourdhui = '', patient = '' }) {
  const d = String(destinataire || '').trim();
  const periode = debut === fin ? `du ${formatDateCourte(debut)}` : `du ${formatDateCourte(debut)} au ${formatDateCourte(fin)}`;
  const s = seanceObj || (estDateValide(prochaineSeance) ? { date: prochaineSeance, debut: '', fin: '' } : null);
  const seance = s && (!aujourdhui || s.date >= aujourdhui) ? `, en vue de notre séance du ${formatDateLongue(s.date)}${s.debut ? (s.fin ? ` de ${heureFr(s.debut)} à ${heureFr(s.fin)}` : ` à ${heureFr(s.debut)}`) : ''}` : '';
  return {
    objet: `Baromètre de l'humeur – rapport ${periode}`,
    corps: `${d ? `Bonjour ${d},` : 'Bonjour,'}\n\nVeuillez trouver ci-joint mon rapport du baromètre de l'humeur pour la période ${periode}${seance}.\n\nCordialement${patient ? `\n\n${patient}` : ''}`,
  };
}

export function lienMailto(email, objet, corps) {
  const enc = (t) => encodeURIComponent(t);
  return `mailto:${estEmailValide(email) ? encodeURIComponent(String(email).trim()).replace(/%40/g, '@') : ''}?subject=${enc(objet)}&body=${enc(corps.replace(/\n/g, '\r\n'))}`;
}

// ---------------------------------------------------------------------------
// Export / import

/** Les clés d'accès ne quittent jamais l'appareil (ni sauvegardes, ni exports). */
export function sansSecrets(parametres) {
  const p = { ...parametres };
  if (p.ia) p.ia = { ...p.ia, cle: '' };
  if (p.synchro) p.synchro = { ...p.synchro, phrase: '' };
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
  const r = {
    motifs: [], autresMotifs: [], explication: '', complement: '', prevision: null, lieu: null, lieux: [], situation: null, historique: [],
    securite: { declenchee: false, raisons: [] }, version: 1, modifieLeUtc: null, validationConnue: !!e.valideLeUtc,
    niveau: nomNiveau(e.note), rappelPrevuUtc: new Date(heurePrevue(e.date, e.creneau)).toISOString(),
    ...e,
  };
  r.lieux = lieuxDe(r);
  return r;
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
  'securite_json', 'reformulation_json', 'historique_json', 'lieu', 'situation', 'lieu_json', 'situation_json', 'lieux_json',
];
const COLONNES_MOTIF = ['id', 'libelle', 'polarite', 'actif', 'regroupe_dans', 'ordre', 'origine', 'cree_le_utc', 'modifie_le_utc', 'description', 'parent_id'];

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
      lieu: libelleLieux(lieuxDe(e), { complet: true }), situation: libelleSituation(e.situation),
      lieu_json: e.lieu ? JSON.stringify(e.lieu) : '', situation_json: e.situation ? JSON.stringify(e.situation) : '',
      lieux_json: lieuxDe(e).length > 1 || lieuxDe(e).some((l) => l.activite) ? JSON.stringify(lieuxDe(e)) : '',
    };
    lignes.push(COLONNES_EVAL.map((c) => celluleCSV(v[c])).join(';'));
  }
  return '\uFEFF' + lignes.join('\r\n') + '\r\n';
}

export function exporterCSVMotifs(motifs) {
  const lignes = [COLONNES_MOTIF.join(';')];
  for (const m of motifs) {
    const v = { id: m.id, libelle: m.libelle, polarite: m.polarite, actif: m.actif ? 'oui' : 'non', regroupe_dans: m.regroupeDans || '', ordre: m.ordre ?? 0, origine: m.origine || '', cree_le_utc: m.creeLeUtc || '', modifie_le_utc: m.modifieLeUtc || '', description: m.description || '', parent_id: m.parentId || '' };
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
        ...('lieu_json' in r ? champsLieux(r.lieux_json ? json('lieux_json', []) : (r.lieu_json ? json('lieu_json', null) : [])) : {}),
        ...('situation_json' in r ? { situation: r.situation_json ? normaliserSituation(json('situation_json', null)) : null } : {}),
      });
    });
    return { type: 'evaluations', evaluations, motifs: [] };
  }
  if (cles.includes('libelle') && cles.includes('polarite')) {
    const motifs = rangees.map((r) => verifierMotif({
      id: r.id || nouvelId(), libelle: r.libelle, polarite: r.polarite, actif: r.actif !== 'non',
      regroupeDans: r.regroupe_dans || null, ordre: Number.parseInt(r.ordre, 10) || 0, ...(r.origine ? { origine: r.origine } : {}), ...(r.description ? { description: r.description } : {}), ...(r.parent_id ? { parentId: r.parent_id } : {}),
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

// ---------------------------------------------------------------------------
// Synchronisation entre appareils
// La fusion est déterministe : deux appareils qui fusionnent les mêmes données obtiennent
// exactement le même résultat, quel que soit l'ordre. Rien n'est perdu : toute évaluation
// écartée est placée dans les archives.

export const PARAMETRES_PARTAGES = ['destinataire', 'emailTherapeute', 'rechercheLieux', 'fondCarte', 'saisieComplete', 'syntheses', 'alerteManquee', 'contactConfiance', 'prochaineSeance', 'seances', 'patient', 'therapeute', 'rapportAvecCNS', 'dernierRapport', 'titreRappelDiscret', 'ia', 'theme'];

function empreinteTexte(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function trierObjet(v) {
  if (Array.isArray(v)) return v.map(trierObjet);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, trierObjet(v[k])]));
  return v;
}
const stable = (v) => JSON.stringify(trierObjet(v));

/** Données échangées entre appareils (y compris la clé d'IA : le coffre est chiffré de bout en bout). */
export function exporterSynchro({ parametres, motifs, evaluations, archives = [] }) {
  const partages = {};
  for (const k of PARAMETRES_PARTAGES) if (parametres[k] !== undefined) partages[k] = parametres[k];
  // Réglages ajoutés par une version plus récente de l'application : conservés tels quels
  for (const [k, v] of Object.entries(parametres.reglagesAutres || {})) if (!(k in partages) && !PARAMETRES_PARTAGES.includes(k)) partages[k] = v;
  return {
    format: FORMAT_DONNEES,
    versionFormat: VERSION_FORMAT,
    type: 'synchronisation',
    debutSuiviUtc: parametres.debutSuiviUtc || null,
    reglagesModifiesLeUtc: parametres.reglagesModifiesLeUtc || null,
    reglages: partages,
    motifsSupprimes: [...(parametres.motifsSupprimes || [])].sort((a, b) => (a.id < b.id ? -1 : 1)),
    motifs: [...motifs].sort((a, b) => (a.id < b.id ? -1 : 1)),
    evaluations: [...evaluations].sort((a, b) => (a.id < b.id ? -1 : 1)),
    archives: [...archives].sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

export function empreinteSynchro(donnees) {
  return donnees ? empreinteTexte(stable({ ...donnees, exporteLeUtc: null })) : '';
}

const instantDe = (x) => Date.parse((x && (x.modifieLeUtc || x.creeLeUtc || x.valideLeUtc)) || 0) || 0;

function gagnantMemeId(a, b) {
  const va = a.version || 1, vb = b.version || 1;
  if (va !== vb) return va > vb ? a : b;
  const ta = instantDe(a), tb = instantDe(b);
  if (ta !== tb) return ta > tb ? a : b;
  return stable(a) >= stable(b) ? a : b;
}

function plusAncienne(a, b) {
  const ta = Date.parse(a.creeLeUtc || a.valideLeUtc || 0) || 0;
  const tb = Date.parse(b.creeLeUtc || b.valideLeUtc || 0) || 0;
  if (ta !== tb) return ta < tb ? a : b;
  return a.id <= b.id ? a : b;
}

/**
 * Fusionne les données de cet appareil avec celles du coffre.
 * local et distant : { parametres, motifs, evaluations, archives } (distant peut venir d'exporterSynchro).
 */
export function fusionnerSynchro(local, distant) {
  const lp = local.parametres || {};
  const d = distant || {};
  const dp = { ...(d.reglages || {}), debutSuiviUtc: d.debutSuiviUtc, reglagesModifiesLeUtc: d.reglagesModifiesLeUtc, motifsSupprimes: d.motifsSupprimes };
  const archives = new Map();
  const ajouterArchive = (a) => {
    const ex = archives.get(a.id);
    if (!ex || (Date.parse(a.restaureeLeUtc || 0) || 0) > (Date.parse(ex.restaureeLeUtc || 0) || 0)) archives.set(a.id, a);
  };
  for (const a of [...(local.archives || []), ...(d.archives || [])]) ajouterArchive(a);

  // 1. Même identifiant : la version la plus récente l'emporte (versions concurrentes archivées)
  const parId = new Map();
  for (const e of [...(local.evaluations || []), ...(d.evaluations || [])]) {
    const ex = parId.get(e.id);
    if (!ex) { parId.set(e.id, e); continue; }
    if (stable(ex) === stable(e)) continue;
    const g = gagnantMemeId(ex, e);
    const p = g === ex ? e : ex;
    if ((p.version || 1) === (g.version || 1)) {
      ajouterArchive({ id: `synchro-${p.id}-v${p.version || 1}-${empreinteTexte(stable(p))}`, archiveLeUtc: g.modifieLeUtc || g.creeLeUtc || null, raison: 'Version modifiée en même temps sur un autre appareil (synchronisation) ; la plus récente est conservée.', evaluation: p });
    }
    parId.set(e.id, g);
  }
  // 2. Évaluations retirées par l'utilisateur (sauf si modifiées ou restaurées depuis)
  for (const a of archives.values()) {
    if (!a.retrait || a.restaureeLeUtc) continue;
    const e = parId.get(a.evaluation.id);
    if (e && (e.version || 1) <= (a.evaluation.version || 1)) parId.delete(a.evaluation.id);
  }
  // 3. Un seul enregistrement par créneau : le plus ancien est conservé
  const parCreneau = new Map();
  for (const e of [...parId.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const ex = parCreneau.get(e.creneauId);
    if (!ex) { parCreneau.set(e.creneauId, e); continue; }
    const g = plusAncienne(ex, e);
    const p = g === ex ? e : ex;
    ajouterArchive({ id: `synchro-creneau-${p.id}`, archiveLeUtc: p.creeLeUtc || null, raison: 'Créneau renseigné sur deux appareils (synchronisation) ; la saisie la plus ancienne est conservée.', evaluation: p });
    parCreneau.set(e.creneauId, g);
  }
  // 4. Motifs : modification la plus récente ; suppressions propagées
  const supprimes = new Map();
  for (const s of [...(lp.motifsSupprimes || []), ...(dp.motifsSupprimes || [])]) if (!supprimes.has(s.id)) supprimes.set(s.id, s);
  const motifs = new Map();
  for (const m of [...(local.motifs || []), ...(d.motifs || [])]) {
    if (supprimes.has(m.id)) continue;
    const ex = motifs.get(m.id);
    if (!ex) { motifs.set(m.id, m); continue; }
    const tm = instantDe(m), te = instantDe(ex);
    motifs.set(m.id, tm > te || (tm === te && stable(m) > stable(ex)) ? m : ex);
  }
  // 5. Réglages partagés : les plus récents ; début du suivi : le plus ancien
  const tl = Date.parse(lp.reglagesModifiesLeUtc || 0) || 0;
  const td = Date.parse(dp.reglagesModifiesLeUtc || 0) || 0;
  const autresL = { ...(lp.reglagesAutres || {}) };
  const autresD = Object.fromEntries(Object.entries(d.reglages || {}).filter(([k]) => !PARAMETRES_PARTAGES.includes(k)));
  const valL = (k) => (lp[k] !== undefined ? lp[k] : autresL[k]);
  const parametres = { ...lp };
  if (td !== tl) {
    const recent = td > tl;
    for (const k of PARAMETRES_PARTAGES) { const v = recent ? dp[k] : valL(k); if (v !== undefined) parametres[k] = v; }
    parametres.reglagesAutres = recent ? autresD : autresL;
  } else {
    // Même instant : une version plus ancienne de l'application a pu renvoyer les réglages sans ceux
    // qu'elle ne connaît pas. On garde donc, réglage par réglage, la valeur renseignée (choix symétrique).
    const vide = (v) => v === undefined || v === null || v === '';
    const choisir = (a, b) => (vide(a) ? (vide(b) ? (a !== undefined ? a : b) : b) : vide(b) ? a : (stable(b) > stable(a) ? b : a));
    for (const k of PARAMETRES_PARTAGES) { const v = choisir(valL(k), dp[k]); if (v !== undefined) parametres[k] = v; }
    const autres = {};
    for (const k of new Set([...Object.keys(autresL), ...Object.keys(autresD)])) { const v = choisir(autresL[k], autresD[k]); if (v !== undefined) autres[k] = v; }
    parametres.reglagesAutres = autres;
  }
  if (!Object.keys(parametres.reglagesAutres || {}).length) delete parametres.reglagesAutres;
  parametres.reglagesModifiesLeUtc = td > tl ? dp.reglagesModifiesLeUtc : (lp.reglagesModifiesLeUtc || dp.reglagesModifiesLeUtc || null);
  const debuts = [lp.debutSuiviUtc, dp.debutSuiviUtc].filter(Boolean).sort();
  if (debuts.length) parametres.debutSuiviUtc = debuts[0];
  parametres.motifsSupprimes = [...supprimes.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  // La clé d'IA locale n'est jamais effacée par une version distante vide
  if (lp.ia && lp.ia.cle && parametres.ia && !parametres.ia.cle) parametres.ia = { ...parametres.ia, cle: lp.ia.cle };
  return {
    parametres,
    evaluations: [...parCreneau.values()],
    motifs: [...motifs.values()],
    archives: [...archives.values()],
  };
}
