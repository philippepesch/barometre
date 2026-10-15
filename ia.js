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
export async function reformuler(parametres, evaluations, { fetch: f = globalThis.fetch.bind(globalThis) } = {}) {
  const cfg = parametres.ia || {};
  if (!cfg.actif || !cfg.consentementUtc || cfg.consentementFournisseur !== cfg.fournisseur) throw new Error('La préparation automatique n\'est pas activée (Réglages).');
  if (cfg.fournisseur === 'anthropic' && !cfg.cle) throw new Error('Clé d\'accès manquante (Réglages).');
  const a = evaluations.filter(C.aDesTextes);
  const systeme = C.instructionsReformulation();
  const propositions = [];
  const ignorees = [];
  for (let i = 0; i < a.length; i += TAILLE_LOT) {
    const lot = a.slice(i, i + TAILLE_LOT);
    const entrees = C.entreesReformulation(lot);
    const texte = cfg.fournisseur === 'serveur'
      ? await appelerServeur(cfg, parametres.serveurRappels, systeme, entrees, f)
      : await appelerAnthropic(cfg, systeme, entrees, f);
    const r = C.lireReponseReformulation(texte, lot);
    // Contrôle : une proposition encore à la première personne est redemandée une fois, avec un rappel
    const aCorriger = r.propositions.filter((p) => ['explication', 'complement', 'prevision'].some((k) => C.contientPremierePersonne(p[k])));
    if (aCorriger.length) {
      const lot2 = lot.filter((e) => aCorriger.some((p) => p.id === e.id));
      const rappel = `${systeme}\n\nATTENTION : ta réponse précédente employait la première personne. Réécris ces entrées en parlant uniquement du « patient », sans aucun « je », « me », « mon », « ma », « mes ».`;
      try {
        const texte2 = cfg.fournisseur === 'serveur'
          ? await appelerServeur(cfg, parametres.serveurRappels, rappel, C.entreesReformulation(lot2), f)
          : await appelerAnthropic(cfg, rappel, C.entreesReformulation(lot2), f);
        for (const p of C.lireReponseReformulation(texte2, lot2).propositions) {
          const i = r.propositions.findIndex((x) => x.id === p.id);
          if (i >= 0) r.propositions[i] = p;
        }
      } catch { /* on garde la première proposition : le patient la relit de toute façon */ }
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
