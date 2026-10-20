// Préparation automatique de la version professionnelle des commentaires par un service d'IA.
// N'est utilisé que si le patient l'a activé ET a donné son accord explicite dans les Réglages.
import * as C from './core.js';

export const FOURNISSEURS = {
  anthropic: { nom: 'Claude (Anthropic)', pays: 'États-Unis', mode: 'directement depuis cet appareil' },
  serveur: { nom: 'Mistral AI', pays: 'France', mode: 'par ton serveur européen' },
};

const TAILLE_LOT = 4;
/** Modèle par défaut : le plus soigné pour la rédaction (l'ancien défaut est remplacé automatiquement). */
export const MODELE_DEFAUT = 'claude-opus-5-5';
const ANCIENS_DEFAUTS = ['claude-sonnet-5-5'];
export const modeleEffectif = (cfg) => (!cfg.modele || ANCIENS_DEFAUTS.includes(cfg.modele) ? MODELE_DEFAUT : cfg.modele);

async function lireErreur(rep) {
  try { const d = await rep.json(); return (d && d.error && (d.error.message || d.error.type)) || d.erreur || ''; } catch { return ''; }
}

function messageErreur(statut, detail, fournisseur) {
  if (statut === 401 || statut === 403) return fournisseur === 'serveur' ? 'Jeton du serveur refusé.' : 'Clé d\'accès refusée : vérifie-la dans les Réglages.';
  if (statut === 404 || (statut === 400 && /not[ _]found|does not exist|unknown model|invalid model/i.test(detail))) return `Modèle introuvable${detail ? ` (${detail})` : ''} : vérifie le nom du modèle dans les Réglages.`;
  if (statut === 400) return `Demande refusée par le service${detail ? ` (${detail})` : ''}.`;
  if (statut === 402 || /credit|balance|billing/i.test(detail)) return 'Crédit épuisé chez le fournisseur.';
  if (statut === 429) return 'Trop de demandes : nouvel essai plus tard.';
  if (statut >= 500) return `Service momentanément indisponible${detail ? ` (${detail})` : ''} : nouvel essai plus tard.`;
  return `Erreur ${statut}${detail ? ` : ${detail}` : ''}.`;
}

async function appelerAnthropic(cfg, systeme, entrees, f) {
  const rep = await f('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': cfg.cle,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: modeleEffectif(cfg),
      max_tokens: 16000,
      system: systeme,
      messages: [{ role: 'user', content: `Entrées :\n${JSON.stringify(entrees, null, 2)}` }],
    }),
  });
  if (!rep.ok) throw new Error(messageErreur(rep.status, await lireErreur(rep), 'anthropic'));
  const d = await rep.json();
  return (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

async function appelerServeur(cfg, serveur, systeme, entrees, f) {
  if (!serveur || !serveur.url) throw new Error('Configure d\'abord l\'adresse et le jeton du serveur (Réglages, Rappels).');
  const rep = await f(`${serveur.url}/reformuler`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${serveur.jeton}` },
    body: JSON.stringify({ systeme, entrees: `Entrées :\n${JSON.stringify(entrees, null, 2)}` }),
  });
  if (!rep.ok) throw new Error(messageErreur(rep.status, await lireErreur(rep), 'serveur'));
  const d = await rep.json();
  return d.texte || '';
}

/**
 * Demande une version professionnelle pour les évaluations données.
 * Retourne { propositions:[{id, explication, complement, prevision}], ignorees:[...] }.
 */
export async function reformuler(parametres, evaluations, { fetch: f = globalThis.fetch.bind(globalThis), evenements = null } = {}) {
  const cfg = parametres.ia || {};
  if (!cfg.actif || !cfg.consentementUtc || cfg.consentementFournisseur !== cfg.fournisseur) throw new Error('La préparation automatique n\'est pas activée (Réglages).');
  if (cfg.fournisseur === 'anthropic' && !cfg.cle) throw new Error('Clé d\'accès manquante (Réglages).');
  // Événements marquants : transmis seulement avec l'accord spécifique du patient
  const evts = cfg.consentementEvenementsUtc && Array.isArray(evenements) ? evenements : null;
  const style = C.styleRedaction(parametres).id;
  const a = evaluations.filter((e) => C.aDesTextes(e, evts));
  const systeme = C.instructionsReformulation({ style });
  const entreesDe = (l) => C.entreesReformulation(l, { evenements: evts });
  const propositions = [];
  const ignorees = [];
  for (let i = 0; i < a.length; i += TAILLE_LOT) {
    const lot = a.slice(i, i + TAILLE_LOT);
    const entrees = entreesDe(lot);
    const texte = cfg.fournisseur === 'serveur'
      ? await appelerServeur(cfg, parametres.serveurRappels, systeme, entrees, f)
      : await appelerAnthropic(cfg, systeme, entrees, f);
    const r = C.lireReponseReformulation(texte, lot, evts);
    // Contrôle : une proposition encore à la première personne est redemandée une fois, avec un rappel
    // (et une proposition trop longue)
    const premiere = (p) => ['explication', 'complement', 'prevision'].some((k) => C.contientPremierePersonne(p[k]));
    const aCorriger = r.propositions.filter((p) => premiere(p) || C.versionTropLongue(p));
    if (aCorriger.length) {
      const lot2 = lot.filter((e) => aCorriger.some((p) => p.id === e.id));
      const consignes = [];
      if (aCorriger.some(premiere)) consignes.push('ta réponse précédente employait la première personne. Réécris ces entrées en parlant uniquement du « patient », sans aucun « je », « me », « mon », « ma », « mes »');
      if (aCorriger.some((p) => C.versionTropLongue(p))) consignes.push(`certains textes dépassaient ${C.LONGUEUR_VERSION} caractères. Chaque texte doit compter au maximum ${C.LONGUEUR_VERSION} caractères, espaces compris : condense en gardant l'essentiel`);
      const rappel = `${systeme}\n\nATTENTION : ${consignes.join(' ; de plus, ')}.`;
      try {
        const texte2 = cfg.fournisseur === 'serveur'
          ? await appelerServeur(cfg, parametres.serveurRappels, rappel, entreesDe(lot2), f)
          : await appelerAnthropic(cfg, rappel, entreesDe(lot2), f);
        for (const p of C.lireReponseReformulation(texte2, lot2, evts).propositions) {
          const i = r.propositions.findIndex((x) => x.id === p.id);
          if (i >= 0) r.propositions[i] = p;
        }
      } catch { /* on garde la première proposition : le patient la relit de toute façon */ }
    }
    // Style et événements pris en compte : mémorisés avec la proposition
    for (const p of r.propositions) {
      const ev = lot.find((e) => e.id === p.id);
      p.style = style;
      p.empreinteEvenements = ev ? C.empreinteEvenements(ev, evts) : '';
    }
    propositions.push(...r.propositions);
    ignorees.push(...r.ignorees);
  }
  return { propositions, ignorees };
}

/** Cherche un modèle Claude disponible (Opus de préférence, sinon Sonnet) si le modèle configuré n'existe pas (ou plus). */
export async function trouverModele(cle, { fetch: f = globalThis.fetch.bind(globalThis) } = {}) {
  const rep = await f('https://api.anthropic.com/v1/models?limit=100', {
    headers: { 'x-api-key': cle, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
  });
  if (!rep.ok) throw new Error(messageErreur(rep.status, await lireErreur(rep), 'anthropic'));
  const d = await rep.json();
  const ids = (d.data || []).map((m) => m.id);
  return ids.find((id) => /opus/i.test(id)) || ids.find((id) => /sonnet/i.test(id)) || ids[0] || null;
}

/**
 * Propositions pour la synthèse de la période (évolution, conclusions et points à aborder à cocher), avec l'accord spécifique du patient.
 * donnees = C.donneesSynthese(...) : statistiques agrégées et textes déjà validés, sans identité ni dates.
 */
export async function redigerSynthese(parametres, donnees, { fetch: f = globalThis.fetch.bind(globalThis) } = {}) {
  const cfg = parametres.ia || {};
  if (!cfg.actif || !cfg.consentementUtc || cfg.consentementFournisseur !== cfg.fournisseur) throw new Error('La préparation automatique n\'est pas activée (Réglages).');
  if (!cfg.consentementSyntheseUtc) throw new Error('Donne d\'abord ton accord pour la synthèse (Réglages, Version professionnelle automatique).');
  if (cfg.fournisseur === 'anthropic' && !cfg.cle) throw new Error('Clé d\'accès manquante (Réglages).');
  const appeler = (systeme) => (cfg.fournisseur === 'serveur'
    ? appelerServeur(cfg, parametres.serveurRappels, systeme, donnees, f)
    : appelerAnthropic(cfg, systeme, donnees, f));
  const systeme = C.instructionsSynthese({ style: C.styleRedaction(parametres).id });
  const tropLong = (p) => p.evolution.length > C.LONGUEUR_EVOLUTION || [...p.conclusions, ...p.points].some((t) => t.length > C.LONGUEUR_PROPOSITION);
  let prop = C.lirePropositionsSynthese(await appeler(systeme));
  if (tropLong(prop)) {
    try {
      const p2 = C.lirePropositionsSynthese(await appeler(`${systeme}\n\nATTENTION : ta réponse précédente dépassait les longueurs demandées (« evolution » : ${C.LONGUEUR_EVOLUTION} caractères au plus ; chaque conclusion et chaque point : ${C.LONGUEUR_PROPOSITION} caractères au plus) : condense en gardant l'essentiel.`));
      if (!tropLong(p2)) prop = p2;
    } catch { /* on garde la première version : le patient peut la raccourcir */ }
  }
  if (!prop.evolution && !prop.conclusions.length && !prop.points.length) throw new Error('Réponse vide de l\'assistant.');
  return prop;
}
