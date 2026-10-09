// Baromètre de l'humeur — interface
import * as C from './core.js';
import * as DB from './db.js';
import { FOURNISSEURS } from './ia.js';

const etat = { evaluations: [], motifs: [], parametres: null, archives: [] };
const ui = { periode: null, alerteDossier: false, majDisponible: null, majDemandee: false };
const contenu = document.getElementById('contenu');
const dlg = document.getElementById('dialogue');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const maintenant = () => Date.now();
const aujourdhui = () => C.dateLocale(maintenant());
const estIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
const estInstallee = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------------------------------------------------------------------------
// Données

async function chargerEtat() {
  const [p, evaluations, motifs, archives] = await Promise.all([DB.lireParametres(), DB.tout('evaluations'), DB.tout('motifs'), DB.tout('archives')]);
  etat.parametres = p ? { ...C.parametresParDefaut(), ...p } : null;
  etat.evaluations = evaluations;
  etat.motifs = motifs;
  etat.archives = archives;
}

const parCreneau = () => C.indexerParCreneau(etat.evaluations);
const motifParId = () => new Map(etat.motifs.map((m) => [m.id, m]));
const motifsActifs = () => etat.motifs.filter((m) => m.actif && !m.regroupeDans)
  .sort((a, b) => C.POLARITES.indexOf(a.polarite) - C.POLARITES.indexOf(b.polarite) || (a.ordre ?? 0) - (b.ordre ?? 0) || a.libelle.localeCompare(b.libelle, 'fr'));

async function enregistrerParametres(modifs) {
  etat.parametres = { ...etat.parametres, ...modifs };
  await DB.ecrireParametres(modifs);
}

async function enregistrerEvaluation(ev) {
  await DB.mettre('evaluations', ev);
  const i = etat.evaluations.findIndex((e) => e.id === ev.id);
  if (i >= 0) etat.evaluations[i] = ev; else etat.evaluations.push(ev);
  majBadge();
  sauvegardeAutomatique();
}

async function enregistrerMotif(m) {
  await DB.mettre('motifs', m);
  const i = etat.motifs.findIndex((x) => x.id === m.id);
  if (i >= 0) etat.motifs[i] = m; else etat.motifs.push(m);
}

function exportComplet() {
  return C.exporterJSON({ parametres: etat.parametres, motifs: etat.motifs, evaluations: etat.evaluations, archives: etat.archives }, maintenant());
}

async function prendreInstantane(raison) {
  const instant = maintenant();
  await DB.mettre('instantanes', { id: `${new Date(instant).toISOString()}_${C.nouvelId().slice(0, 8)}`, creeLeUtc: new Date(instant).toISOString(), raison, nombre: etat.evaluations.length, donnees: exportComplet() });
  const tous = (await DB.tout('instantanes')).sort((a, b) => (a.id < b.id ? 1 : -1));
  for (const vieux of tous.slice(30)) await DB.supprimer('instantanes', vieux.id);
}

async function instantaneQuotidien() {
  const tous = await DB.tout('instantanes');
  const auj = aujourdhui();
  if (!tous.some((s) => C.dateLocale(Date.parse(s.creeLeUtc)) === auj)) await prendreInstantane('Copie quotidienne automatique');
}

// ---------------------------------------------------------------------------
// Utilitaires d'affichage

function jourRelatif(date) {
  const auj = aujourdhui();
  if (date === auj) return 'aujourd\'hui';
  if (date === C.ajouterJours(auj, -1)) return 'hier';
  if (date === C.ajouterJours(auj, 1)) return 'demain';
  return C.formatDateMoyenne(date);
}

function creneauRelatif({ date, creneau }) {
  const auj = aujourdhui();
  if (date === auj) return creneau === 'matin' ? 'ce matin' : 'ce soir';
  if (date === C.ajouterJours(auj, -1)) return creneau === 'matin' ? 'hier matin' : 'hier soir';
  if (date === C.ajouterJours(auj, 1)) return creneau === 'matin' ? 'demain matin' : 'demain soir';
  return `${C.formatDateMoyenne(date)}, ${creneau}`;
}

const ICONES_STATUT = {
  repondu: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  repondu_retard: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 4.5V8l2.5 1.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  omis: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  en_attente: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="3.5" fill="currentColor"/></svg>',
  a_venir: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  non_renseigne: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};
const badgeStatut = (s, precision = '') => `<span class="statut statut-${s}">${ICONES_STATUT[s]}${esc(C.STATUTS[s])}${precision ? ` <span class="doux">${esc(precision)}</span>` : ''}</span>`;

function statutDe(ev, date, creneau) {
  return C.statutCreneau({ date, creneau }, ev, maintenant(), etat.parametres.debutSuiviUtc);
}

function echelleHTML(note, prevue) {
  const pos = (n) => `${(n / 10) * 100}%`;
  return `<div class="echelle" role="img" aria-label="${Number.isInteger(note) ? `Échelle : ${note} sur 10` : 'Échelle de 0 à 10'}">
    ${Number.isInteger(note) ? `<span class="echelle-aiguille" style="left:${pos(note)}"></span>` : ''}
    ${Number.isInteger(prevue) ? `<span class="echelle-prevue" style="left:${pos(prevue)}" title="Note prévue : ${prevue}/10"></span>` : ''}
  </div>`;
}

function annoncer(message, action) {
  const zone = document.getElementById('annonces');
  const el = document.createElement('div');
  el.className = 'annonce';
  el.innerHTML = `<span>${esc(message)}</span>`;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = action.libelle;
    b.addEventListener('click', () => { el.remove(); action.faire(); });
    el.append(b);
  }
  zone.append(el);
  while (zone.children.length > 2) zone.firstElementChild.remove();
  setTimeout(() => el.remove(), action ? 12000 : 5000);
}

function majBoutonPdf() {
  const d = etat.parametres && etat.parametres.destinataire ? etat.parametres.destinataire.trim() : '';
  document.getElementById('btn-pdf-libelle').textContent = d ? `Générer PDF – Rapport pour ${d}` : 'Générer PDF – Rapport';
}

function appliquerTheme(theme) {
  if (theme === 'clair') document.documentElement.dataset.theme = 'light';
  else if (theme === 'sombre') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

function telecharger(blob, nom) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nom; a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function partager(blob, nom) {
  try {
    const f = new File([blob], nom, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], title: nom }); return true; }
  } catch (e) { if (e && e.name === 'AbortError') return true; }
  return false;
}

/** Sur iPhone, la feuille de partage permet « Enregistrer dans Fichiers » ; ailleurs, téléchargement direct. */
async function livrer(blob, nom) {
  if (estIOS && await partager(blob, nom)) return;
  telecharger(blob, nom);
}

// ---------------------------------------------------------------------------
// Dialogues

function dialogue(html) {
  return new Promise((resoudre) => {
    dlg.innerHTML = `<form method="dialog" class="dialogue-corps">${html}</form>`;
    const form = dlg.querySelector('form');
    dlg.returnValue = '';
    const fin = () => { dlg.removeEventListener('close', fin); resoudre({ valeur: dlg.returnValue, donnees: new FormData(form), form }); };
    dlg.addEventListener('close', fin);
    dlg.showModal();
    const auto = form.querySelector('[autofocus]');
    if (auto) auto.focus();
  });
}

async function confirmer(titre, texte, libelleOk = 'Confirmer') {
  const r = await dialogue(`<h2 id="dialogue-titre">${esc(titre)}</h2><p>${texte}</p>
    <div class="dialogue-actions"><button class="bouton-secondaire" value="non" formnovalidate>Annuler</button><button class="bouton" value="oui">${esc(libelleOk)}</button></div>`);
  return r.valeur === 'oui';
}

function contenuAide(contexte) {
  const c = etat.parametres && etat.parametres.contactConfiance;
  const tel = c && c.telephone ? c.telephone.replace(/[^\d+]/g, '') : '';
  return `${contexte}
    <p><strong>Es-tu en sécurité en ce moment ?</strong> Si tu te sens en danger, ou si tu penses à te faire du mal, tu n'as pas à rester seul avec cela. Une personne peut t'aider maintenant :</p>
    <ul class="aide-liste">
      <li><a class="urgence" href="tel:112"><span><strong>112</strong><br><span class="doux">Urgences, jour et nuit, gratuit</span></span><span>Appeler</span></a></li>
      <li><a href="tel:+352454545"><span><strong>SOS Détresse – 45 45 45</strong><br><span class="doux">Écoute anonyme, tous les jours de 11 h à 23 h, jusqu'à 3 h le vendredi et le samedi</span></span><span>Appeler</span></a></li>
      ${tel ? `<li><a href="tel:${esc(tel)}"><span><strong>${esc(c.nom || 'Personne de confiance')}</strong><br><span class="doux">${esc(c.telephone)}</span></span><span>Appeler</span></a></li>` : ''}
    </ul>
    <p class="doux" style="margin-top:14px">Cette application ne pose aucun diagnostic et ne remplace ni ton thérapeute, ni les secours. Une note supérieure à zéro n'exclut pas un besoin d'aide : ce message reste accessible en bas de chaque page.</p>`;
}

async function ouvrirAide(contexte = '') {
  await dialogue(`<h2 id="dialogue-titre">Besoin d'aide maintenant</h2>${contenuAide(contexte)}
    <div class="dialogue-actions"><button class="bouton" value="ok">Fermer</button></div>`);
}

async function verificationSecurite(ev) {
  const raisons = ev.securite.raisons;
  const contexte = `<p>${raisons.includes('note de 0/10') ? 'Tu as indiqué 0/10.' : 'Ce que tu as écrit évoque peut-être une détresse importante.'} Ton évaluation est bien enregistrée. Prenons un instant.</p>`;
  await dialogue(`<h2 id="dialogue-titre">Prenons un instant</h2>${contenuAide(contexte)}
    <div class="dialogue-actions"><button class="bouton" value="ok">Je suis en sécurité pour l'instant</button></div>`);
}

// ---------------------------------------------------------------------------
// Routage

const VUES = {
  '': vueAccueil, accueil: vueAccueil, evaluer: vueEvaluer, modifier: vueModifier, evaluation: vueFiche,
  calendrier: vueCalendrier, motifs: vueMotifs, reglages: vueReglages, textes: vueTextes,
};

function router() {
  const morceaux = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [route, ...args] = morceaux;
  document.body.classList.toggle('sans-navigation', !etat.parametres);
  if (!etat.parametres) { vueBienvenue(); marquerOnglet(''); return; }
  const vue = VUES[route] || vueAccueil;
  marquerOnglet(route === 'modifier' || route === 'evaluation' || route === 'textes' ? '' : route);
  try { vue(args); } catch (e) { console.error(e); contenu.innerHTML = `<div class="erreurs"><p>Une erreur est survenue : ${esc(e.message)}</p><p><a href="#/">Retour à l'accueil</a></p></div>`; }
  contenu.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function marquerOnglet(route) {
  const actif = { '': 'accueil', accueil: 'accueil' }[route] || route;
  document.querySelectorAll('.navigation a').forEach((a) => {
    if (a.dataset.onglet === actif) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

function aller(hash) {
  if (location.hash === hash) router(); else location.hash = hash;
}

/** Ouverture depuis une notification : ?creneau=matin|soir[&date=AAAA-MM-JJ] */
function traiterParametresURL() {
  const p = new URLSearchParams(location.search);
  const creneau = p.get('creneau');
  if (!C.CRENEAUX.includes(creneau)) return;
  let cible;
  const date = p.get('date');
  if (date && C.estDateValide(date)) cible = { date, creneau };
  else {
    const t = maintenant();
    const ouvert = C.creneauOuvert(t);
    const suivant = C.creneauSuivant(ouvert);
    if (ouvert.creneau === creneau) cible = ouvert;
    else if (suivant.creneau === creneau && C.peutRepondre(suivant, t)) cible = suivant;
    else cible = C.creneauPrecedent(ouvert);
  }
  history.replaceState(null, '', `${location.pathname}#/evaluer/${cible.date}/${cible.creneau}`);
}

// ---------------------------------------------------------------------------
// Bienvenue

function vueBienvenue() {
  contenu.innerHTML = `<section class="bienvenue">
    <h1>Bienvenue dans ton baromètre de l'humeur</h1>
    ${echelleHTML(6)}
    <p>Deux fois par jour, à 06:00 et à 18:00, tu notes ton humeur de 0 à 10, ce qui l'explique, et ce que tu prévois pour la suite. Les données restent enregistrées sur cet appareil uniquement : aucun compte, aucun serveur, aucune publicité.</p>
    <div class="bloc">
      <h2>Démarrer</h2>
      <p>Si tu as reçu le fichier <strong>donnees-initiales.json</strong> (tes motifs personnels et ta première évaluation), importe-le maintenant. Si tu as une sauvegarde, tu peux aussi la restaurer ici.</p>
      <div class="rangee">
        <label class="bouton" for="fichier-depart">Importer un fichier</label>
        <input type="file" id="fichier-depart" accept=".json,.csv,application/json,text/csv" class="visuellement-cache">
        <button type="button" class="bouton-secondaire" data-action="demarrer-vide">Commencer sans fichier</button>
      </div>
      <p class="doux" style="margin-top:12px">Le suivi commencera maintenant : les créneaux antérieurs seront marqués « non renseigné », jamais remplis automatiquement.</p>
    </div>
    ${!estInstallee() ? `<div class="bandeau"><strong>Conseil</strong>${estIOS ? 'Sur iPhone, ajoute d\'abord l\'application à l\'écran d\'accueil (bouton Partager, puis « Sur l\'écran d\'accueil ») et ouvre-la depuis cette icône : ses données sont distinctes de celles de Safari.' : 'Installe l\'application (icône d\'installation dans la barre d\'adresse d\'Edge ou de Chrome) pour l\'ouvrir comme un programme et recevoir les rappels.'}</div>` : ''}
  </section>`;
  document.getElementById('fichier-depart').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    await initialiser();
    await importerFichier(f, { premierDemarrage: true });
  });
}

async function initialiser() {
  const p = C.parametresParDefaut(maintenant());
  await DB.ecrireParametres(p);
  etat.parametres = p;
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch { /* facultatif */ }
  majBoutonPdf();
}

// ---------------------------------------------------------------------------
// Accueil (tableau de bord)

function vueAccueil() {
  const t = maintenant();
  const index = parCreneau();
  const ouvert = C.creneauOuvert(t);
  const evOuvert = index.get(C.idCreneau(ouvert.date, ouvert.creneau));
  const suivant = C.creneauSuivant(ouvert);
  const evSuivant = index.get(C.idCreneau(suivant.date, suivant.creneau));
  const finOuvert = C.expiration(ouvert.date, ouvert.creneau);
  let blocMaintenant;
  if (!evOuvert) {
    blocMaintenant = `<h1>Évaluation ${ouvert.creneau === 'matin' ? 'du matin' : 'du soir'}${ouvert.date !== aujourdhui() ? ` (${jourRelatif(ouvert.date)})` : ''}</h1>
      <p class="etat-creneau">${badgeStatut('en_attente')} Rappel de ${C.formatHeure(C.heurePrevue(ouvert.date, ouvert.creneau))}, réponse possible jusqu'à ${C.formatHeure(finOuvert)}.</p>
      <div><a class="bouton" href="#/evaluer/${ouvert.date}/${ouvert.creneau}">Répondre maintenant</a></div>`;
  } else {
    const prochainLib = `${creneauRelatif(suivant)} à ${C.formatHeure(C.heurePrevue(suivant.date, suivant.creneau))}`;
    blocMaintenant = `<h1>Évaluation ${ouvert.creneau === 'matin' ? 'du matin' : 'du soir'} enregistrée</h1>
      <p class="etat-creneau">${evOuvert.validationConnue ? `Validée à ${C.formatHeure(evOuvert.valideLeUtc)}` : 'Heure de saisie inconnue'} : <strong>${esc(C.libelleNote(evOuvert.note))}</strong>.</p>
      <p class="etat-creneau">Prochaine évaluation : ${esc(prochainLib)}.${!evSuivant && C.peutRepondre(suivant, t) ? ` <a href="#/evaluer/${suivant.date}/${suivant.creneau}">Répondre dès maintenant</a>` : ''}</p>`;
  }

  // Créneaux sans réponse sur les 7 derniers jours
  const grille7 = C.grilleCreneaux(C.ajouterJours(aujourdhui(), -6), aujourdhui(), etat.evaluations, t, etat.parametres.debutSuiviUtc);
  const manquants = grille7.filter((s) => s.statut === 'omis').reverse();

  const triees = C.trierChrono(etat.evaluations);
  const derniere = triees[triees.length - 1];
  let blocHumeur = '<p class="doux">Aucune évaluation pour l\'instant.</p>';
  if (derniere) {
    const p = derniere.prevision;
    blocHumeur = `<div class="humeur-actuelle"><span class="lecture-note">${derniere.note}</span><span class="lecture-sur">/10</span><span class="lecture-nom">${esc(derniere.niveau)}</span></div>
      ${echelleHTML(derniere.note, p && Number.isInteger(p.note) ? p.note : null)}
      <p class="encre-2">Dernière évaluation : <a href="#/evaluation/${esc(derniere.id)}">${esc(C.majuscule(C.formatDateLongue(derniere.date)))}, ${derniere.creneau}</a>${derniere.validationConnue ? `, validée le ${C.formatDateHeure(derniere.valideLeUtc)}` : ', heure de saisie inconnue (donnée historique)'}.</p>
      ${p && Number.isInteger(p.note) ? `<p class="encre-2">Prévision pour ${esc(creneauRelatif(p.cible))} : <strong>${esc(C.libelleNote(p.note))}</strong> (losange sur l'échelle).</p>` : ''}`;
  }

  const rappelSauvegarde = besoinRappelSauvegarde();
  contenu.innerHTML = `
    ${ui.majDisponible ? '<div class="bandeau bandeau-laiton rangee-espacee"><span>Une nouvelle version de l\'application est prête.</span><button class="bouton-secondaire" data-action="mettre-a-jour">Mettre à jour</button></div>' : ''}
    ${ui.alerteDossier ? '<div class="bandeau bandeau-laiton rangee-espacee"><span>La sauvegarde automatique dans ton dossier attend ton autorisation.</span><button class="bouton-secondaire" data-action="autoriser-dossier">Autoriser</button></div>' : ''}
    ${bandeauSeance()}
    ${aRelire() ? `<div class="bandeau bandeau-laiton rangee-espacee"><span>${aRelire() > 1 ? `${aRelire()} versions reformulées pour le rapport attendent ta relecture.` : 'Une version reformulée pour le rapport attend ta relecture.'}</span><a class="bouton-secondaire" href="#/textes">Relire</a></div>` : ''}
    ${rappelSauvegarde ? `<div class="bandeau rangee-espacee"><span>${esc(rappelSauvegarde)}</span><button class="bouton-secondaire" data-action="exporter-json">Sauvegarder maintenant</button></div>` : ''}
    <div class="grille-2">
      <div>
        <section class="bloc maintenant" aria-label="Évaluation en cours">${blocMaintenant}</section>
        ${manquants.length ? `<section class="bloc"><h2>Créneaux sans réponse</h2>
          <p class="doux">Tu peux encore les renseigner : la saisie sera signalée comme rétrospective.</p>
          <ul class="liste-simple">${manquants.map((s) => `<li><span>${esc(C.majuscule(creneauRelatif(s)))} ${badgeStatut('omis')}</span><a class="bouton-discret" href="#/evaluer/${s.date}/${s.creneau}">Saisir maintenant</a></li>`).join('')}</ul></section>` : ''}
      </div>
      <section class="bloc" aria-label="Humeur actuelle"><h2>Humeur actuelle</h2>${blocHumeur}</section>
    </div>
    ${blocMiseEnRoute()}
    ${tableauDeBord()}
  `;
  attacherGraphique();
  contenu.querySelectorAll('[name="periode"]').forEach((r) => r.addEventListener('change', () => { ui.periode = r.value === 'tout' ? 'tout' : Number(r.value); vueAccueil(); }));
}

function blocMiseEnRoute() {
  const p = etat.parametres;
  if (p.miseEnRouteMasquee) return '';
  const rappels = !!(p.serveurRappels && p.serveurRappels.actif);
  const ia = iaPrete();
  if (rappels && ia) return '';
  const ligne = (fait, texte, lien) => `<li><span>${fait ? ICONES_STATUT.repondu : ICONES_STATUT.a_venir} ${texte}</span>${fait ? '<span class="doux">fait</span>' : `<a class="bouton-discret" href="${lien}">Configurer</a>`}</li>`;
  return `<section class="bloc" aria-label="Mise en route"><div class="rangee-espacee"><h2 style="margin:0">Mise en route</h2><button type="button" class="bouton-discret" data-action="masquer-mise-en-route">Masquer</button></div>
    <ul class="liste-simple liste-etapes">
      ${ligne(rappels, 'Notifications à 06:00 et 18:00 sur cet appareil', '#/reglages/rappels')}
      ${ligne(ia, 'Version professionnelle automatique pour le thérapeute', '#/reglages/ia')}
    </ul></section>`;
}

function bandeauSeance() {
  const p = etat.parametres;
  const seance = p.prochaineSeance;
  if (!seance || !C.estDateValide(seance)) return '';
  const auj = aujourdhui();
  const veille = C.ajouterJours(seance, -1);
  if (auj !== seance && auj !== veille) return '';
  const dr = p.dernierRapport;
  if (dr && dr.genereLeUtc && C.dateLocale(Date.parse(dr.genereLeUtc)) >= veille) return '';
  const dest = (p.destinataire || '').trim() || 'ton thérapeute';
  return `<div class="bandeau bandeau-laiton rangee-espacee"><span>Séance avec ${esc(dest)} ${auj === seance ? 'aujourd\'hui' : 'demain'} : prépare ton rapport.</span><button type="button" class="bouton" data-action="ouvrir-pdf">Générer le rapport</button></div>`;
}

function besoinRappelSauvegarde() {
  const p = etat.parametres;
  const nb = etat.evaluations.filter((e) => e.source !== 'historique').length;
  if (nb < 3) return '';
  const derniere = [p.derniereSauvegardeUtc, p.derniereSauvegardeFichierUtc].filter(Boolean).sort().pop();
  if (!derniere) return 'Aucune sauvegarde de tes données n\'a encore été faite.';
  const jours = Math.floor((maintenant() - Date.parse(derniere)) / 86400000);
  return jours >= 14 ? `Dernière sauvegarde il y a ${jours} jours.` : '';
}

function bornesPeriode() {
  const fin = aujourdhui();
  if (ui.periode === null) {
    const premiere = [C.dateLocale(Date.parse(etat.parametres.debutSuiviUtc)), ...etat.evaluations.map((e) => e.date)].sort()[0];
    ui.periode = C.joursEntre(premiere, fin) < 30 ? 'tout' : 30;
  }
  if (ui.periode === 'tout') {
    const dates = [C.dateLocale(Date.parse(etat.parametres.debutSuiviUtc)), ...etat.evaluations.map((e) => e.date)].sort();
    return { debut: dates[0] < fin ? dates[0] : fin, fin };
  }
  return { debut: C.ajouterJours(fin, -(ui.periode - 1)), fin };
}

function tableauDeBord() {
  const t = maintenant();
  const { debut, fin } = bornesPeriode();
  const evals = C.dansPeriode(etat.evaluations, debut, fin);
  const grille = C.grilleCreneaux(debut, fin, etat.evaluations, t, etat.parametres.debutSuiviUtc);
  const comptes = C.comptesCreneaux(grille);
  const s = C.statistiques(evals);
  const freq = C.frequenceMotifs(evals, etat.motifs);
  const prev = C.comparaisonsPrevisions(evals, etat.evaluations);
  const periodes = [[7, '7 jours'], [14, '14 jours'], [30, '30 jours'], [90, '90 jours'], ['tout', 'Tout']];
  const tuile = (v, l) => `<div class="tuile"><div class="tuile-valeur">${v}</div><div class="tuile-libelle">${l}</div></div>`;
  const moy = (x, n) => (n ? `${C.nombreFr(x)}` : '—');
  const evo = [7, 14, 30, 90].map((j) => C.evolution(etat.evaluations, fin, j));
  const barres = (pol, titre) => {
    const l = freq.filter((f) => f.polarite === pol).slice(0, 8);
    if (!l.length) return `<div><h3><span class="pastille ${pol}"></span> ${titre}</h3><p class="doux">Aucun motif ${titre.toLowerCase().replace(/s$/, '')} coché sur la période.</p></div>`;
    return `<div><h3 style="display:flex;gap:8px;align-items:center"><span class="pastille ${pol}"></span> ${titre}</h3><div class="barres">${l.map((f) => {
      const part = Math.round((f.nombre / Math.max(1, evals.length)) * 100);
      return `<div class="barre"><span>${esc(f.libelle)}</span><span class="doux chiffres">${f.nombre} (${part} %)</span><div class="barre-piste"><div class="barre-remplie ${pol}" style="width:${part}%"></div></div></div>`;
    }).join('')}</div></div>`;
  };
  return `
  <section class="section" aria-labelledby="titre-stats">
    <div class="section-titre"><h2 id="titre-stats">Tableau de bord</h2>
      <fieldset class="segmente periodes"><legend class="visuellement-cache">Période</legend>${periodes.map(([v, l]) => `<label><input type="radio" name="periode" value="${v}" ${String(ui.periode) === String(v) ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>
    </div>
    <p class="doux">Du ${C.formatDateCourte(debut)} au ${C.formatDateCourte(fin)}. Ces chiffres décrivent tes saisies ; ils ne constituent pas un diagnostic.</p>
    <div class="tuiles">
      ${tuile(moy(s.moyenne, s.nombre), 'Moyenne générale')}
      ${tuile(moy(s.moyenneMatin, s.nombreMatin), 'Moyenne du matin')}
      ${tuile(moy(s.moyenneSoir, s.nombreSoir), 'Moyenne du soir')}
      ${tuile(s.nombre ? s.min : '—', 'Note minimale')}
      ${tuile(s.nombre ? s.max : '—', 'Note maximale')}
      ${tuile(`${comptes.completees}<span class="doux" style="font-size:1rem"> / ${comptes.attendues}</span>`, 'Évaluations complétées / attendues')}
      ${tuile(comptes.omises, 'Évaluations omises')}
    </div>
  </section>
  <section class="bloc" aria-labelledby="titre-courbe">
    <h2 id="titre-courbe">Courbe des notes</h2>
    ${graphiqueHTML(grille, prev)}
  </section>
  <div class="grille-2">
    <section class="bloc" aria-labelledby="titre-evolution">
      <h2 id="titre-evolution">Évolution</h2>
      <div class="defile"><table class="donnees"><thead><tr><th>Période</th><th class="nombre">Moyenne</th><th class="nombre">Période précédente</th><th class="nombre">Écart</th></tr></thead><tbody>
      ${evo.map((e) => `<tr><td>${e.jours} jours</td><td class="nombre">${e.nombre ? `${C.nombreFr(e.moyenne)} <span class="doux">(${e.nombre})</span>` : '—'}</td><td class="nombre">${e.nombrePrecedent ? `${C.nombreFr(e.moyennePrecedente)} <span class="doux">(${e.nombrePrecedent})</span>` : '—'}</td><td class="nombre">${e.difference === null ? '—' : C.signeFr(e.difference)}</td></tr>`).join('')}
      </tbody></table></div>
      <p class="doux" style="margin-top:8px">Entre parenthèses : nombre d'évaluations. La période précédente a la même durée.</p>
    </section>
    <section class="bloc" aria-labelledby="titre-prev">
      <h2 id="titre-prev">Prévisions et réalité</h2>
      ${prev.nombreComparees ? `<div class="tuiles" style="margin-bottom:12px">${tuile(C.signeFr(prev.ecartMoyen), 'Écart moyen (constaté − prévu)')}${tuile(C.nombreFr(prev.ecartAbsoluMoyen), 'Écart absolu moyen')}${tuile(`${prev.exactes}/${prev.nombreComparees}`, 'Prévisions exactes')}</div>` : '<p class="doux">Aucune prévision ne peut encore être comparée à une note constatée.</p>'}
      ${prev.lignes.length ? `<div class="defile"><table class="donnees"><thead><tr><th>Créneau visé</th><th class="nombre">Prévue</th><th class="nombre">Constatée</th><th class="nombre">Écart</th></tr></thead><tbody>
      ${prev.lignes.slice(-6).reverse().map((l) => `<tr><td>${esc(C.majuscule(creneauRelatif(l.cible)))}</td><td class="nombre">${l.prevue}</td><td class="nombre">${l.reelle ?? '—'}</td><td class="nombre">${l.ecart === null ? `<span class="doux">${esc(C.STATUTS[statutDe(null, l.cible.date, l.cible.creneau)].toLowerCase())}</span>` : C.signeFr(l.ecart, 0)}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
    </section>
  </div>
  <section class="bloc" aria-labelledby="titre-motifs">
    <h2 id="titre-motifs">Fréquence des motifs</h2>
    <p class="doux">Seuls les motifs cochés sont comptés, en part des ${C.pluriel(evals.length, 'évaluation')} de la période.</p>
    <div class="grille-2" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${barres('favorable', 'Favorables')}${barres('defavorable', 'Défavorables')}${freq.some((f) => f.polarite === 'mixte') ? barres('mixte', 'Mixtes') : ''}</div>
  </section>
  <p><a class="bouton-secondaire" href="#/calendrier">Voir le calendrier complet</a></p>`;
}

let donneesGraphique = null;

function graphiqueHTML(grille, prev) {
  const W = Math.round(Math.max(320, Math.min(760, (contenu.clientWidth || 760) - 40))), H = W < 500 ? 220 : 250, g = 30, d = 10, h = 14, b = 44;
  const n = grille.length;
  const x = (i) => (n <= 1 ? (g + W - d) / 2 : g + 8 + (i * (W - d - g - 16)) / (n - 1));
  const y = (v) => h + (1 - v / 10) * (H - h - b);
  let svg = '';
  for (let v = 0; v <= 10; v += 2) svg += `<line class="${v === 0 ? 'axe' : 'grille'}" x1="${g}" x2="${W - d}" y1="${y(v)}" y2="${y(v)}"/><text class="etiquette" x="${g - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  const jours = [...new Set(grille.map((s) => s.date))];
  const pas = Math.max(1, Math.ceil(jours.length / (W < 500 ? 5 : 8)));
  jours.forEach((jr, k) => {
    if (k % pas) return;
    const i = grille.findIndex((s) => s.date === jr);
    svg += `<text class="etiquette" x="${x(i)}" y="${H - b + 30}" text-anchor="start">${esc(C.formatDateCourte(jr).slice(0, 5))}</text>`;
  });
  let chemin = '';
  grille.forEach((s, i) => {
    const prec = grille[i - 1];
    if (s.evaluation) chemin += `${prec && prec.evaluation ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s.evaluation.note).toFixed(1)} `;
  });
  if (chemin) svg += `<path class="trace" d="${chemin}"/>`;
  const idx = new Map(grille.map((s, i) => [s.id, i]));
  const prevParCible = new Map();
  for (const l of prev.lignes) {
    const i = idx.get(C.idCreneau(l.cible.date, l.cible.creneau));
    if (i === undefined) continue;
    prevParCible.set(i, l);
    const cx = x(i), cy = y(l.prevue), r = n > 60 ? 3.5 : 5.5;
    svg += `<path class="prevue" d="M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z"/>`;
  }
  const t = n > 60 ? 3.2 : 5.2;
  grille.forEach((s, i) => {
    if (s.evaluation) {
      const coul = `var(--n${s.evaluation.note})`;
      svg += s.creneau === 'matin'
        ? `<circle class="point" cx="${x(i)}" cy="${y(s.evaluation.note)}" r="${t}" fill="${coul}"/>`
        : `<rect class="point" x="${x(i) - t}" y="${y(s.evaluation.note) - t}" width="${2 * t}" height="${2 * t}" rx="1.5" fill="${coul}"/>`;
    } else if (s.statut === 'omis') {
      const cy = y(0) + 10, r = 3;
      svg += `<path class="omis" d="M${x(i) - r} ${cy - r}L${x(i) + r} ${cy + r}M${x(i) + r} ${cy - r}L${x(i) - r} ${cy + r}"/>`;
    }
  });
  svg += '<line class="curseur-vertical" x1="0" x2="0" y1="0" y2="0" visibility="hidden"/>';
  donneesGraphique = { grille, x, W, H, prevParCible, haut: h, bas: H - b };
  const nbRep = grille.filter((s) => s.evaluation).length;
  const tableau = grille.filter((s) => s.evaluation || s.statut === 'omis').map((s) => `<tr><td>${esc(C.formatDateCourte(s.date))}</td><td>${s.creneau}</td><td>${s.evaluation ? esc(C.libelleNote(s.evaluation.note)) : 'omis'}</td></tr>`).join('');
  return `<div class="graphique" id="graphique">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe de ${nbRep} notes sur la période">${svg}</svg>
    </div>
    <div class="legende">
      <span><svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="var(--doux)"/></svg>Matin</span>
      <span><svg viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" rx="1.5" fill="var(--doux)"/></svg>Soir</span>
      <span><svg viewBox="0 0 14 14"><path d="M7 1.5L12.5 7L7 12.5L1.5 7Z" fill="none" stroke="var(--laiton)" stroke-width="1.6"/></svg>Note prévue</span>
      <span><svg viewBox="0 0 14 14"><path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="var(--doux)" stroke-width="1.6"/></svg>Créneau omis</span>
    </div>
    ${tableau ? `<details class="repli" style="margin-top:8px"><summary>Afficher les données en tableau</summary><div class="defile"><table class="donnees"><thead><tr><th>Date</th><th>Créneau</th><th>Note</th></tr></thead><tbody>${tableau}</tbody></table></div></details>` : '<p class="doux">Aucune donnée sur la période.</p>'}`;
}

function attacherGraphique() {
  const zone = document.getElementById('graphique');
  if (!zone || !donneesGraphique) return;
  const svg = zone.querySelector('svg');
  const ligne = svg.querySelector('.curseur-vertical');
  let bulle = null;
  const masquer = () => { if (bulle) { bulle.remove(); bulle = null; } ligne.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', (e) => {
    const { grille, x, W, prevParCible, haut, bas } = donneesGraphique;
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let meilleur = 0, dist = Infinity;
    grille.forEach((s, i) => { const dd = Math.abs(x(i) - px); if (dd < dist) { dist = dd; meilleur = i; } });
    const s = grille[meilleur];
    const l = prevParCible.get(meilleur);
    const lignes = [`<strong>${esc(C.formatDateMoyenne(s.date))}, ${s.creneau}</strong>`];
    if (s.evaluation) lignes.push(esc(C.libelleNote(s.evaluation.note)));
    else lignes.push(esc(C.STATUTS[s.statut]));
    if (l) lignes.push(`Prévu : ${l.prevue}/10`);
    if (!bulle) { bulle = document.createElement('div'); bulle.className = 'infobulle'; zone.append(bulle); }
    bulle.innerHTML = lignes.join('<br>');
    const xr = (x(meilleur) / W) * r.width;
    bulle.style.left = `${Math.min(Math.max(xr, 70), r.width - 70)}px`;
    bulle.style.top = `${(haut / donneesGraphique.H) * r.height + 4}px`;
    ligne.setAttribute('x1', x(meilleur)); ligne.setAttribute('x2', x(meilleur));
    ligne.setAttribute('y1', haut); ligne.setAttribute('y2', bas);
    ligne.setAttribute('visibility', 'visible');
  });
  svg.addEventListener('pointerleave', masquer);
}

// ---------------------------------------------------------------------------
// Questionnaire

function vueEvaluer(args) {
  const t = maintenant();
  let cible;
  if (args.length >= 2 && C.estDateValide(args[0]) && C.CRENEAUX.includes(args[1])) cible = { date: args[0], creneau: args[1] };
  else {
    const index = parCreneau();
    const ouvert = C.creneauOuvert(t);
    const suivant = C.creneauSuivant(ouvert);
    if (!index.has(C.idCreneau(ouvert.date, ouvert.creneau))) cible = ouvert;
    else if (!index.has(C.idCreneau(suivant.date, suivant.creneau)) && C.peutRepondre(suivant, t)) cible = suivant;
    else {
      contenu.innerHTML = `<section class="colonne-centree"><h1>Rien à évaluer pour l'instant</h1>
        <p>L'évaluation ${ouvert.creneau === 'matin' ? 'du matin' : 'du soir'} est déjà enregistrée. Prochaine évaluation : ${esc(creneauRelatif(suivant))} à ${C.formatHeure(C.heurePrevue(suivant.date, suivant.creneau))} (réponse possible une heure avant).</p>
        <p><a class="bouton-secondaire" href="#/calendrier">Renseigner un créneau passé depuis le calendrier</a></p></section>`;
      return;
    }
  }
  const existante = parCreneau().get(C.idCreneau(cible.date, cible.creneau));
  if (existante) {
    contenu.innerHTML = `<section class="colonne-centree"><h1>Créneau déjà renseigné</h1>
      <p>L'évaluation ${cible.creneau === 'matin' ? 'du matin' : 'du soir'} du ${esc(C.formatDateLongue(cible.date))} existe déjà (${esc(C.libelleNote(existante.note))}).</p>
      <div class="rangee"><a class="bouton" href="#/evaluation/${esc(existante.id)}">Voir l'évaluation</a><a class="bouton-secondaire" href="#/modifier/${esc(existante.id)}">La modifier</a></div></section>`;
    return;
  }
  if (!C.peutRepondre(cible, t)) {
    contenu.innerHTML = `<section class="colonne-centree"><h1>Ce créneau n'est pas encore ouvert</h1>
      <p>L'évaluation ${cible.creneau === 'matin' ? 'du matin' : 'du soir'} du ${esc(C.formatDateLongue(cible.date))} sera possible à partir de ${C.formatHeure(C.heurePrevue(cible.date, cible.creneau) - C.OUVERTURE_ANTICIPEE_MIN * 60000)}.</p>
      <p><a class="bouton-secondaire" href="#/">Retour à l'accueil</a></p></section>`;
    return;
  }
  formulaire(cible, null);
}

function vueModifier([id]) {
  const ev = etat.evaluations.find((e) => e.id === id);
  if (!ev) { contenu.innerHTML = '<p>Évaluation introuvable. <a href="#/calendrier">Calendrier</a></p>'; return; }
  formulaire({ date: ev.date, creneau: ev.creneau }, ev);
}

function curseurHTML(id, valeur, libelle) {
  const vierge = !Number.isInteger(valeur);
  return `<input class="curseur${vierge ? ' vierge' : ''}" type="range" id="${id}" min="0" max="10" step="1" value="${vierge ? 5 : valeur}" aria-label="${esc(libelle)}" aria-valuetext="${vierge ? 'aucune note choisie' : `${valeur} sur 10, ${C.nomNiveau(valeur)}`}">
    <div class="graduations" aria-hidden="true">${Array.from({ length: 11 }, (_, i) => `<span style="left:calc(15px + (100% - 30px) * ${i / 10})">${i}</span>`).join('')}</div>`;
}

function pucesMotifs(nom, selection, extra = []) {
  const actifs = motifsActifs();
  const groupes = C.POLARITES.map((pol) => {
    const liste = [...actifs.filter((m) => m.polarite === pol), ...extra.filter((m) => m.polarite === pol)];
    if (!liste.length) return '';
    const titre = { favorable: 'Facteurs favorables', defavorable: 'Facteurs défavorables', mixte: 'Facteurs mixtes' }[pol];
    return `<div class="motifs-groupe"><h3><span class="pastille ${pol}"></span>${titre}</h3><div class="puces">${liste.map((m) => `<label class="puce"><input type="checkbox" name="${nom}" value="${esc(m.id)}" ${selection.has(m.id) ? 'checked' : ''}><span>${esc(m.libelle)}</span></label>`).join('')}</div></div>`;
  }).join('');
  return groupes || '<p class="doux">Ta bibliothèque de motifs est vide : utilise « Autre » pour en créer.</p>';
}

function formulaire(cible, ev) {
  const t = maintenant();
  const exp = C.expiration(cible.date, cible.creneau);
  const retro = !ev && t > exp;
  const suivant = C.creneauSuivant(cible);
  const prevLib = cible.date === aujourdhui() || suivant.date === aujourdhui() || suivant.date === C.ajouterJours(aujourdhui(), 1) ? creneauRelatif(suivant) : `le ${suivant.creneau} du ${C.formatDateMoyenne(suivant.date)}`;
  const s = {
    note: ev ? ev.note : null,
    autres: ev ? ev.autresMotifs.map((a) => ({ ...a, ajouter: false, cle: C.nouvelId() })) : [],
    prevNote: ev && ev.prevision && Number.isInteger(ev.prevision.note) ? ev.prevision.note : null,
  };
  const parId = motifParId();
  const extra = ev ? ev.motifs.filter((m) => !parId.has(m.id) || !parId.get(m.id).actif || parId.get(m.id).regroupeDans) : [];
  const extraPrev = ev && ev.prevision ? ev.prevision.motifs.filter((m) => !parId.has(m.id) || !parId.get(m.id).actif || parId.get(m.id).regroupeDans) : [];
  const selection = new Set(ev ? ev.motifs.map((m) => m.id) : []);
  const selectionPrev = new Set(ev && ev.prevision ? ev.prevision.motifs.map((m) => m.id) : []);
  const titre = `Évaluation ${cible.creneau === 'matin' ? 'du matin' : 'du soir'}`;

  contenu.innerHTML = `<form class="colonne-centree" id="form-eval" novalidate>
    <p class="doux" style="margin:0">${esc(C.majuscule(C.formatDateLongue(cible.date)))}</p>
    <h1>${ev ? `Modifier l'évaluation ${cible.creneau === 'matin' ? 'du matin' : 'du soir'}` : titre}</h1>
    ${ev ? `<div class="bandeau bandeau-laiton"><strong>Modification tracée</strong>L'heure de validation d'origine est conservée ; la modification et son heure sont ajoutées à l'historique de l'évaluation.</div>`
    : retro ? `<div class="bandeau bandeau-laiton"><strong>Saisie rétrospective</strong>Ce créneau s'est terminé le ${C.formatDateHeure(exp)}. Ta réponse sera enregistrée avec l'heure réelle de validation et signalée comme saisie en retard.</div>`
    : `<p class="encre-2">Rappel prévu à ${C.formatHeure(C.heurePrevue(cible.date, cible.creneau))}. L'heure de ta réponse sera enregistrée automatiquement au moment de la validation.</p>`}
    <div id="erreurs" class="erreurs" hidden tabindex="-1"></div>

    <section class="question" aria-labelledby="q1">
      <p class="question-numero">Question 1</p>
      <h2 id="q1">Comment te sens-tu actuellement, de 0 à 10 ?</h2>
      <div class="ciel ${s.note === null ? 'vierge' : ''}" id="ciel" style="--ciel: var(--n${s.note ?? 5})">
        <div class="lecture" aria-live="polite"><span class="lecture-note" id="lecture-note">${s.note ?? '–'}</span><span class="lecture-sur">/10</span><span class="lecture-nom" id="lecture-nom">${s.note === null ? 'à choisir' : esc(C.nomNiveau(s.note))}</span></div>
        ${curseurHTML('note', s.note, 'Note actuelle de 0 à 10')}
        <p class="consigne" id="consigne-note" ${s.note !== null ? 'hidden' : ''}>Fais glisser ou touche le curseur pour choisir ta note.</p>
        <div class="securite" id="securite-zero" ${s.note === 0 ? '' : 'hidden'}>
          <p><strong>Merci de l'avoir indiqué.</strong> Si tu te sens en danger ou si tu penses à te faire du mal, appelle le <a href="tel:112"><strong>112</strong></a> ou parle à quelqu'un maintenant.</p>
          <p><button type="button" class="bouton-secondaire" data-action="aide">Voir les aides disponibles</button></p>
        </div>
      </div>
    </section>

    <section class="question" aria-labelledby="q2">
      <p class="question-numero">Question 2</p>
      <h2 id="q2">Pourquoi te sens-tu ainsi ?</h2>
      <p class="doux">Coche tout ce qui s'applique (facultatif).</p>
      ${pucesMotifs('motif', selection, extra)}
      <div class="motifs-groupe" id="autres-zone" ${s.autres.length ? '' : 'hidden'}><h3>Autres motifs</h3><div class="puces" id="autres-liste"></div></div>
      <p style="margin-top:12px"><button type="button" class="bouton-secondaire" id="btn-autre" aria-expanded="false" aria-controls="autre-panneau">Autre…</button></p>
      <div class="autre-motif" id="autre-panneau" hidden>
        <div class="champ"><label for="autre-libelle">Nouveau motif</label><input type="text" id="autre-libelle" maxlength="120" autocomplete="off" placeholder="Par exemple : Visite chez mes parents"></div>
        <fieldset class="champ"><legend class="doux" style="font-weight:600;margin-bottom:6px">Ce motif est plutôt…</legend>
          <div class="segmente">${C.POLARITES.map((p, i) => `<label><input type="radio" name="autre-polarite" value="${p}" ${i === 0 ? 'checked' : ''}><span>${C.LIBELLE_POLARITE[p]}</span></label>`).join('')}</div>
        </fieldset>
        <label class="interrupteur"><input type="checkbox" id="autre-biblio" checked> Enregistrer dans ma bibliothèque pour les prochaines évaluations</label>
        <div class="rangee" style="margin-top:12px"><button type="button" class="bouton" id="btn-autre-ajouter">Ajouter ce motif</button><button type="button" class="bouton-discret" id="btn-autre-annuler">Annuler</button></div>
      </div>
      <div class="champ" style="margin-top:18px"><label for="explication">Explication libre <small class="doux">(facultatif)</small></label>
        <textarea id="explication" spellcheck="true" lang="fr" autocapitalize="sentences" maxlength="10000" rows="4">${esc(ev ? ev.explication : '')}</textarea></div>
      <details class="repli" ${ev && ev.complement ? 'open' : ''}><summary>Ajouter un complément</summary>
        <div class="champ"><label for="complement" class="visuellement-cache">Complément</label><textarea id="complement" spellcheck="true" lang="fr" autocapitalize="sentences" maxlength="10000" rows="3">${esc(ev ? ev.complement : '')}</textarea></div>
      </details>
    </section>

    <section class="question" aria-labelledby="q3">
      <p class="question-numero">Question 3</p>
      <h2 id="q3">Quelle note prévois-tu pour ${esc(prevLib)}, et pourquoi ?</h2>
      <div class="ciel ${s.prevNote === null ? 'vierge' : ''}" id="ciel-prev" style="--ciel: var(--n${s.prevNote ?? 5})">
        <div class="lecture" aria-live="polite"><span class="lecture-note" id="lecture-prev">${s.prevNote ?? '–'}</span><span class="lecture-sur">/10</span><span class="lecture-nom" id="lecture-prev-nom">${s.prevNote === null ? 'facultatif' : esc(C.nomNiveau(s.prevNote))}</span></div>
        ${curseurHTML('prevision', s.prevNote, `Note prévue pour ${prevLib}`)}
        <p class="consigne">Facultatif. <button type="button" class="bouton-discret" id="btn-prev-effacer" ${s.prevNote === null ? 'hidden' : ''}>Ne pas faire de prévision</button></p>
      </div>
      <div class="champ"><label for="prevision-motif">Pourquoi ? <small class="doux">(facultatif)</small></label>
        <textarea id="prevision-motif" spellcheck="true" lang="fr" autocapitalize="sentences" rows="2" maxlength="10000">${esc(ev && ev.prevision ? ev.prevision.motif : '')}</textarea></div>
      <details class="repli" ${selectionPrev.size ? 'open' : ''}><summary>Associer des motifs à cette prévision</summary>${pucesMotifs('motif-prev', selectionPrev, extraPrev)}</details>
    </section>

    ${ev ? `<div class="champ"><label for="raison">Raison de la modification <small class="doux">(facultatif, conservée dans l'historique)</small></label><input type="text" id="raison" maxlength="300"></div>` : ''}
    <div class="rangee" style="margin-top:8px">
      <button type="submit" class="bouton" id="btn-enregistrer">${ev ? 'Enregistrer la modification' : 'Enregistrer l\'évaluation'}</button>
      <a class="bouton-discret" href="${ev ? `#/evaluation/${esc(ev.id)}` : '#/'}">Annuler</a>
    </div>
  </form>`;

  const form = document.getElementById('form-eval');
  const brancherCurseur = (idCurseur, idCiel, idNote, idNom, surChoix) => {
    const c = document.getElementById(idCurseur);
    const maj = () => {
      const v = Number(c.value);
      c.classList.remove('vierge');
      document.getElementById(idCiel).classList.remove('vierge');
      document.getElementById(idCiel).style.setProperty('--ciel', `var(--n${v})`);
      document.getElementById(idNote).textContent = v;
      document.getElementById(idNom).textContent = C.nomNiveau(v);
      c.setAttribute('aria-valuetext', `${v} sur 10, ${C.nomNiveau(v)}`);
      surChoix(v);
    };
    for (const evt of ['input', 'change', 'pointerup']) c.addEventListener(evt, maj);
    c.addEventListener('keydown', (e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) setTimeout(maj, 0); });
    return c;
  };
  brancherCurseur('note', 'ciel', 'lecture-note', 'lecture-nom', (v) => {
    s.note = v;
    document.getElementById('consigne-note').hidden = true;
    document.getElementById('securite-zero').hidden = v !== 0;
  });
  const curseurPrev = brancherCurseur('prevision', 'ciel-prev', 'lecture-prev', 'lecture-prev-nom', (v) => {
    s.prevNote = v;
    document.getElementById('btn-prev-effacer').hidden = false;
  });
  document.getElementById('btn-prev-effacer').addEventListener('click', () => {
    s.prevNote = null;
    curseurPrev.value = 5; curseurPrev.classList.add('vierge');
    curseurPrev.setAttribute('aria-valuetext', 'aucune note choisie');
    document.getElementById('ciel-prev').classList.add('vierge');
    document.getElementById('lecture-prev').textContent = '–';
    document.getElementById('lecture-prev-nom').textContent = 'facultatif';
    document.getElementById('btn-prev-effacer').hidden = true;
  });

  const dessinerAutres = () => {
    document.getElementById('autres-zone').hidden = !s.autres.length;
    document.getElementById('autres-liste').innerHTML = s.autres.map((a) => `<label class="puce puce-libre"><input type="checkbox" checked data-autre="${a.cle}"><span><span class="pastille ${a.polarite}"></span>${esc(a.libelle)}${a.ajouter ? ' <small class="doux">(nouveau)</small>' : ''}</span></label>`).join('');
  };
  dessinerAutres();
  document.getElementById('autres-liste').addEventListener('change', (e) => {
    const cle = e.target.dataset.autre;
    if (cle && !e.target.checked) { s.autres = s.autres.filter((a) => a.cle !== cle); dessinerAutres(); }
  });
  const panneau = document.getElementById('autre-panneau');
  const btnAutre = document.getElementById('btn-autre');
  const basculer = (ouvrir) => { panneau.hidden = !ouvrir; btnAutre.setAttribute('aria-expanded', String(ouvrir)); if (ouvrir) document.getElementById('autre-libelle').focus(); };
  btnAutre.addEventListener('click', () => basculer(panneau.hidden));
  document.getElementById('btn-autre-annuler').addEventListener('click', () => basculer(false));
  const ajouterAutre = () => {
    const champ = document.getElementById('autre-libelle');
    const libelle = champ.value.trim();
    if (!libelle) { champ.focus(); return; }
    const polarite = form.querySelector('[name="autre-polarite"]:checked').value;
    const existant = etat.motifs.find((m) => C.normaliserLibelle(m.libelle) === C.normaliserLibelle(libelle) && m.actif && !m.regroupeDans);
    if (existant) {
      const cb = form.querySelector(`[name="motif"][value="${CSS.escape(existant.id)}"]`);
      if (cb) cb.checked = true;
      annoncer(`« ${existant.libelle} » existe déjà dans ta bibliothèque : il a été coché.`);
    } else if (!s.autres.some((a) => C.normaliserLibelle(a.libelle) === C.normaliserLibelle(libelle))) {
      s.autres.push({ libelle, polarite, ajouter: document.getElementById('autre-biblio').checked, cle: C.nouvelId() });
      dessinerAutres();
    }
    champ.value = '';
    basculer(false);
    btnAutre.focus();
  };
  document.getElementById('btn-autre-ajouter').addEventListener('click', ajouterAutre);
  document.getElementById('autre-libelle').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ajouterAutre(); } });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const zoneErreurs = document.getElementById('erreurs');
    if (s.note === null) {
      zoneErreurs.hidden = false;
      zoneErreurs.textContent = 'Choisis d\'abord une note pour la question 1 : touche ou fais glisser le curseur.';
      zoneErreurs.focus();
      return;
    }
    const bouton = document.getElementById('btn-enregistrer');
    bouton.disabled = true;
    try {
      const instant = maintenant();
      const parIdMaj = motifParId();
      const resoudre = (ids, extras) => [...ids].map((id) => parIdMaj.get(id) || extras.find((m) => m.id === id)).filter(Boolean);
      // Nouveaux motifs à enregistrer dans la bibliothèque
      const motifsChoisis = resoudre(new Set([...form.querySelectorAll('[name="motif"]:checked')].map((c) => c.value)), extra);
      const autresMotifs = [];
      let ordre = Math.max(0, ...etat.motifs.map((m) => m.ordre ?? 0)) + 1;
      for (const a of s.autres) {
        if (a.ajouter) {
          const m = C.creerMotif(a.libelle, a.polarite, instant, ordre++);
          await enregistrerMotif(m);
          motifsChoisis.push(m);
        } else autresMotifs.push({ libelle: a.libelle, polarite: a.polarite });
      }
      const saisie = {
        date: cible.date, creneau: cible.creneau, note: s.note,
        motifs: motifsChoisis, autresMotifs,
        explication: document.getElementById('explication').value,
        complement: document.getElementById('complement').value,
        prevision: {
          note: s.prevNote,
          motif: document.getElementById('prevision-motif').value,
          motifs: resoudre(new Set([...form.querySelectorAll('[name="motif-prev"]:checked')].map((c) => c.value)), extraPrev),
        },
      };
      let resultat;
      if (ev) {
        resultat = C.modifierEvaluation(ev, saisie, document.getElementById('raison').value, instant);
        if (!resultat) { annoncer('Aucun changement : l\'évaluation n\'a pas été modifiée.'); aller(`#/evaluation/${ev.id}`); return; }
      } else {
        const erreurs = C.validerSaisie(saisie);
        if (erreurs.length) throw new Error(erreurs.join(' '));
        resultat = C.creerEvaluation(saisie, instant);
      }
      await enregistrerEvaluation(resultat);
      annoncer(ev ? `Modification enregistrée le ${C.formatDateHeure(instant)}.` : `Évaluation enregistrée à ${C.formatHeure(instant)}.`);
      aller(ev ? `#/evaluation/${resultat.id}` : '#/');
      if (resultat.securite && resultat.securite.declenchee) await verificationSecurite(resultat);
      await preparerApresSaisie(resultat);
    } catch (err) {
      zoneErreurs.hidden = false;
      zoneErreurs.textContent = `L'évaluation n'a pas pu être enregistrée : ${err.message}`;
      zoneErreurs.focus();
      bouton.disabled = false;
    }
  });
}

// ---------------------------------------------------------------------------
// Fiche d'une évaluation

function vueFiche([id]) {
  const ev = etat.evaluations.find((e) => e.id === id);
  if (!ev) { contenu.innerHTML = '<section class="colonne-centree"><h1>Évaluation introuvable</h1><p>Elle a peut-être été retirée (voir Réglages, Archives).</p><p><a href="#/calendrier">Calendrier</a></p></section>'; return; }
  const statut = statutDe(ev, ev.date, ev.creneau);
  const p = ev.prevision;
  const reel = p ? parCreneau().get(C.idCreneau(p.cible.date, p.cible.creneau)) : null;
  const libM = (l) => (l.length ? l.map((m) => `<span class="puce"><span><span class="pastille ${m.polarite}"></span>${esc(m.libelle)}</span></span>`).join(' ') : '<span class="doux">aucun</span>');
  const valeur = (c, v) => {
    if (v === null || v === undefined || v === '') return '<em>vide</em>';
    if (c === 'note') return esc(C.libelleNote(v));
    if (c === 'motifs' || c === 'autresMotifs') return v.length ? esc(v.map((m) => m.libelle).join(', ')) : '<em>aucun</em>';
    if (c === 'reformulation') return `${esc(C.STATUTS_REFORMULATION[v.statut] || v.statut)}${v.source === 'assistant' ? ' (proposée par un assistant)' : ''}`;
    if (c === 'prevision') return Number.isInteger(v.note) ? esc(`${C.libelleNote(v.note)}${v.motif ? ` – ${v.motif}` : ''}`) : esc(v.motif || 'aucune note');
    return `<span class="texte-libre">${esc(v)}</span>`;
  };
  contenu.innerHTML = `<section class="colonne-centree fiche">
    <p class="doux" style="margin:0">${esc(C.majuscule(C.formatDateLongue(ev.date)))}</p>
    <h1>Évaluation ${ev.creneau === 'matin' ? 'du matin' : 'du soir'}</h1>
    <div class="ciel" style="--ciel: var(--n${ev.note})"><div class="lecture"><span class="lecture-note">${ev.note}</span><span class="lecture-sur">/10</span><span class="lecture-nom">${esc(ev.niveau)}</span></div>${echelleHTML(ev.note, null)}</div>
    <div class="bloc"><dl>
      <dt>Statut</dt><dd>${badgeStatut(statut, ev.validationConnue ? '' : '(heure inconnue)')}</dd>
      <dt>Rappel prévu</dt><dd>${C.formatDateHeure(ev.rappelPrevuUtc)}</dd>
      <dt>Validation</dt><dd>${ev.validationConnue ? C.formatDateHeure(ev.valideLeUtc) : 'Heure réelle inconnue (donnée historique)'}${ev.saisieRetrospective ? ' — saisie rétrospective, après la fin du créneau' : ''}</dd>
      ${ev.modifieLeUtc ? `<dt>Dernière modification</dt><dd>${C.formatDateHeure(ev.modifieLeUtc)}</dd>` : ''}
      ${ev.noteOrigine ? `<dt>Origine</dt><dd>${esc(ev.noteOrigine)}</dd>` : ''}
      <dt>Motifs</dt><dd><div class="puces">${libM([...ev.motifs, ...ev.autresMotifs])}</div></dd>
      ${ev.explication ? `<dt>Explication</dt><dd class="texte-libre">${esc(ev.explication)}</dd>` : ''}
      ${ev.complement ? `<dt>Complément</dt><dd class="texte-libre">${esc(ev.complement)}</dd>` : ''}
      <dt>Prévision</dt><dd>${p ? `${Number.isInteger(p.note) ? `<strong>${esc(C.libelleNote(p.note))}</strong>` : 'aucune note'} pour ${esc(creneauRelatif(p.cible))}${p.motif ? `<br><span class="texte-libre">${esc(p.motif)}</span>` : ''}${p.motifs.length ? `<div class="puces" style="margin-top:6px">${libM(p.motifs)}</div>` : ''}
        ${Number.isInteger(p.note) ? `<br><span class="doux">${reel ? `Constaté : ${esc(C.libelleNote(reel.note))} (écart ${C.signeFr(reel.note - p.note, 0)})` : `Créneau visé : ${esc(C.STATUTS[statutDe(null, p.cible.date, p.cible.creneau)].toLowerCase())}`}</span>` : ''}` : '<span class="doux">aucune</span>'}</dd>
      ${ev.securite && ev.securite.declenchee ? `<dt>Sécurité</dt><dd>Une vérification de sécurité a été proposée (${esc(ev.securite.raisons.join(', '))}).</dd>` : ''}
    </dl></div>
    ${C.aDesTextes(ev) ? blocVersionRapport(ev) : ''}
    ${ev.historique && ev.historique.length ? `<div class="bloc"><h2>Historique des modifications</h2><ol class="historique">${ev.historique.map((h) => `<li><strong>${C.formatDateHeure(h.le)}</strong> (version ${h.version})${h.raison ? ` — raison : ${esc(h.raison)}` : ''}
      <ul>${h.changements.map((c) => `<li>${esc(C.LIBELLE_CHAMP[c.champ] || c.champ)} : ${valeur(c.champ, c.avant)} → ${valeur(c.champ, c.apres)}</li>`).join('')}</ul></li>`).join('')}</ol></div>` : ''}
    <div class="rangee">
      <a class="bouton" href="#/modifier/${esc(ev.id)}">Modifier</a>
      <button type="button" class="bouton-secondaire" data-action="retirer" data-id="${esc(ev.id)}">Retirer…</button>
      <a class="bouton-discret" href="#/calendrier/${ev.date.slice(0, 7)}">Calendrier</a>
    </div>
  </section>`;
}

async function retirerEvaluation(id) {
  const ev = etat.evaluations.find((e) => e.id === id);
  if (!ev) return;
  const r = await dialogue(`<h2 id="dialogue-titre">Retirer cette évaluation ?</h2>
    <p>Elle ne sera plus comptée ni affichée, mais restera conservée dans les archives (Réglages) et pourra être restaurée.</p>
    <div class="champ"><label for="raison-retrait">Raison <small class="doux">(facultatif)</small></label><input type="text" id="raison-retrait" name="raison" maxlength="300" autofocus></div>
    <div class="dialogue-actions"><button class="bouton-secondaire" value="non" formnovalidate>Annuler</button><button class="bouton" value="oui">Retirer</button></div>`);
  if (r.valeur !== 'oui') return;
  const archive = { id: C.nouvelId(), archiveLeUtc: new Date(maintenant()).toISOString(), raison: `Retirée par l'utilisateur${r.donnees.get('raison') ? ` : ${r.donnees.get('raison')}` : ''}.`, evaluation: ev };
  await prendreInstantane('Avant retrait d\'une évaluation');
  await DB.archiverEvaluation(archive);
  etat.evaluations = etat.evaluations.filter((e) => e.id !== id);
  etat.archives.push(archive);
  annoncer('Évaluation retirée et archivée.');
  aller('#/calendrier');
}

// ---------------------------------------------------------------------------
// Calendrier

function vueCalendrier([mois]) {
  const t = maintenant();
  const auj = aujourdhui();
  const m = /^\d{4}-\d{2}$/.test(mois || '') ? mois : auj.slice(0, 7);
  const premier = `${m}-01`;
  const dernier = C.ajouterJours(C.ajouterJours(premier, 32).slice(0, 7) + '-01', -1);
  const decalage = (new Date(`${premier}T12:00:00Z`).getUTCDay() + 6) % 7;
  const grille = C.grilleCreneaux(premier, dernier, etat.evaluations, t, etat.parametres.debutSuiviUtc);
  const parJour = new Map();
  for (const s of grille) { if (!parJour.has(s.date)) parJour.set(s.date, {}); parJour.get(s.date)[s.creneau] = s; }
  const precedent = C.ajouterJours(premier, -1).slice(0, 7);
  const suivant = C.ajouterJours(dernier, 1).slice(0, 7);
  const caseCreneau = (s) => {
    const lettre = s.creneau === 'matin' ? 'M' : 'S';
    const lib = `${C.formatDateLongue(s.date)}, ${s.creneau} : ${s.evaluation ? C.libelleNote(s.evaluation.note) : C.STATUTS[s.statut]}`;
    const inner = `<span class="lettre">${lettre}</span><span class="val">${s.evaluation ? s.evaluation.note : s.statut === 'omis' ? '×' : s.statut === 'en_attente' ? '•' : ''}</span>`;
    const classe = `cal-creneau st-${s.statut}${s.evaluation ? ' a-note' : ''}`;
    const style = s.evaluation ? ` style="--ciel: var(--n${s.evaluation.note})"` : '';
    if (s.evaluation) return `<a class="${classe}"${style} href="#/evaluation/${esc(s.evaluation.id)}" aria-label="${esc(lib)}" title="${esc(lib)}">${inner}</a>`;
    if (C.peutRepondre(s, t)) return `<a class="${classe}" href="#/evaluer/${s.date}/${s.creneau}" aria-label="${esc(lib)}, saisir" title="${esc(lib)}">${inner}</a>`;
    return `<span class="${classe}" aria-label="${esc(lib)}" title="${esc(lib)}">${inner}</span>`;
  };
  let cases = '';
  for (let i = 0; i < decalage; i++) cases += '<div class="cal-case hors-mois" aria-hidden="true"></div>';
  for (let d = premier; d <= dernier; d = C.ajouterJours(d, 1)) {
    const j = parJour.get(d);
    cases += `<div class="cal-case${d === auj ? ' aujourdhui' : ''}"><span class="cal-num">${Number(d.slice(8))}</span>${caseCreneau(j.matin)}${caseCreneau(j.soir)}</div>`;
  }
  const comptes = C.comptesCreneaux(grille);
  const omis = grille.filter((s) => s.statut === 'omis');
  contenu.innerHTML = `<section>
    <div class="cal-entete">
      <a class="bouton-secondaire" href="#/calendrier/${precedent}" aria-label="Mois précédent">‹</a>
      <h1>${esc(C.majuscule(C.formatMois(premier)))}</h1>
      <a class="bouton-secondaire" href="#/calendrier/${suivant}" aria-label="Mois suivant">›</a>
    </div>
    <div class="cal" role="grid" aria-label="Calendrier des évaluations">
      ${['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map((j) => `<div class="cal-jour-semaine" aria-hidden="true">${j}</div>`).join('')}
      ${cases}
    </div>
    <div class="cal-legende">
      <span><i></i>M : matin, S : soir</span>
      <span><i style="background:color-mix(in oklab,var(--n7) 30%,var(--surface));border-color:color-mix(in oklab,var(--n7) 60%,var(--surface))"></i>Répondu (note)</span>
      <span><i class="l-retard"></i>Répondu en retard</span>
      <span><i class="l-attente"></i>En attente (•)</span>
      <span><i class="l-omis"></i>Omis (×)</span>
      <span><i class="l-vide"></i>À venir ou non renseigné</span>
    </div>
    <p class="encre-2">Ce mois-ci : ${comptes.completees} complétée${comptes.completees > 1 ? 's' : ''} sur ${comptes.attendues} attendue${comptes.attendues > 1 ? 's' : ''}, ${comptes.omises} omise${comptes.omises > 1 ? 's' : ''}${comptes.enRetard ? `, dont ${comptes.enRetard} saisie${comptes.enRetard > 1 ? 's' : ''} en retard` : ''}.</p>
    ${omis.length ? `<details class="repli"><summary>Liste des créneaux omis (${omis.length})</summary><ul class="liste-simple">${omis.map((s) => `<li><span>${esc(C.majuscule(C.formatDateLongue(s.date)))}, ${s.creneau}</span><a class="bouton-discret" href="#/evaluer/${s.date}/${s.creneau}">Saisir maintenant</a></li>`).join('')}</ul></details>` : ''}
    <p class="doux">Touche un créneau passé sans réponse pour le renseigner : la saisie sera signalée comme rétrospective.</p>
  </section>`;
}

// ---------------------------------------------------------------------------
// Bibliothèque de motifs

function vueMotifs() {
  const usage = new Map();
  for (const e of etat.evaluations) {
    for (const m of [...e.motifs, ...(e.prevision ? e.prevision.motifs : [])]) usage.set(m.id, (usage.get(m.id) || 0) + 1);
  }
  const parId = motifParId();
  const ligne = (m) => {
    const enfants = etat.motifs.filter((x) => x.regroupeDans === m.id);
    return `<div class="motif-ligne">
      <div><div class="motif-libelle"><span class="pastille ${m.polarite}"></span> ${esc(m.libelle)}</div>
        <div class="motif-meta">${C.LIBELLE_POLARITE[m.polarite]}, utilisé ${usage.get(m.id) || 0} fois${enfants.length ? `, regroupe : ${enfants.map((x) => esc(x.libelle)).join(', ')}` : ''}${m.regroupeDans ? `, regroupé dans « ${esc(parId.get(m.regroupeDans)?.libelle || '?')} »` : ''}${!m.actif && !m.regroupeDans ? ', désactivé' : ''}</div></div>
      <div class="actions">
        ${m.regroupeDans ? `<button type="button" class="bouton-discret" data-action="motif-degrouper" data-id="${esc(m.id)}">Dégrouper</button>`
    : `<button type="button" class="bouton-discret" data-action="motif-modifier" data-id="${esc(m.id)}">Modifier</button>
           ${m.actif ? `<button type="button" class="bouton-discret" data-action="motif-regrouper" data-id="${esc(m.id)}">Regrouper</button><button type="button" class="bouton-discret" data-action="motif-desactiver" data-id="${esc(m.id)}">Désactiver</button>` : `<button type="button" class="bouton-discret" data-action="motif-activer" data-id="${esc(m.id)}">Réactiver</button>`}`}
        <button type="button" class="bouton-discret" data-action="motif-supprimer" data-id="${esc(m.id)}">Supprimer</button>
      </div></div>`;
  };
  const actifs = motifsActifs();
  const inactifs = etat.motifs.filter((m) => !m.actif || m.regroupeDans).sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr'));
  contenu.innerHTML = `<section class="colonne-centree">
    <h1>Bibliothèque de motifs</h1>
    <p class="encre-2">Les motifs proposés à la question 2. Les modifier, les regrouper ou les supprimer ne change jamais les évaluations déjà enregistrées : chacune conserve les motifs tels qu'ils ont été cochés. Un motif regroupé est compté avec son motif principal dans les statistiques.</p>
    <form class="bloc" id="form-motif">
      <h2>Ajouter un motif</h2>
      <div class="champ"><label for="nouveau-motif">Libellé</label><input type="text" id="nouveau-motif" maxlength="120" required autocomplete="off"></div>
      <fieldset class="champ"><legend class="visuellement-cache">Type</legend><div class="segmente">${C.POLARITES.map((p, i) => `<label><input type="radio" name="polarite" value="${p}" ${i === 0 ? 'checked' : ''}><span>${C.LIBELLE_POLARITE[p]}</span></label>`).join('')}</div></fieldset>
      <button class="bouton" type="submit">Ajouter</button>
    </form>
    ${C.POLARITES.map((pol) => {
    const l = actifs.filter((m) => m.polarite === pol);
    return `<div class="bloc"><h2>${{ favorable: 'Facteurs favorables', defavorable: 'Facteurs défavorables', mixte: 'Facteurs mixtes' }[pol]} <span class="doux">(${l.length})</span></h2>${l.length ? l.map(ligne).join('') : '<p class="doux">Aucun motif.</p>'}</div>`;
  }).join('')}
    ${inactifs.length ? `<div class="bloc"><h2>Désactivés et regroupés <span class="doux">(${inactifs.length})</span></h2><p class="doux">Ils ne sont plus proposés dans le questionnaire.</p>${inactifs.map(ligne).join('')}</div>` : ''}
  </section>`;
  document.getElementById('form-motif').addEventListener('submit', async (e) => {
    e.preventDefault();
    const libelle = document.getElementById('nouveau-motif').value.trim();
    if (!libelle) return;
    if (etat.motifs.some((m) => C.normaliserLibelle(m.libelle) === C.normaliserLibelle(libelle))) { annoncer('Un motif portant ce libellé existe déjà.'); return; }
    const pol = e.target.querySelector('[name="polarite"]:checked').value;
    await enregistrerMotif(C.creerMotif(libelle, pol, maintenant(), Math.max(0, ...etat.motifs.map((m) => m.ordre ?? 0)) + 1));
    annoncer(`Motif « ${libelle} » ajouté.`);
    vueMotifs();
  });
}

async function actionMotif(action, id) {
  const m = etat.motifs.find((x) => x.id === id);
  if (!m) return;
  const le = new Date(maintenant()).toISOString();
  if (action === 'motif-modifier') {
    const r = await dialogue(`<h2 id="dialogue-titre">Modifier le motif</h2>
      <div class="champ"><label for="m-lib">Libellé</label><input type="text" id="m-lib" name="libelle" value="${esc(m.libelle)}" maxlength="120" required autofocus></div>
      <fieldset class="champ"><legend style="font-weight:600;margin-bottom:6px">Type</legend><div class="segmente">${C.POLARITES.map((p) => `<label><input type="radio" name="polarite" value="${p}" ${m.polarite === p ? 'checked' : ''}><span>${C.LIBELLE_POLARITE[p]}</span></label>`).join('')}</div></fieldset>
      <p class="doux">Les évaluations passées gardent le libellé d'origine.</p>
      <div class="dialogue-actions"><button class="bouton-secondaire" value="non" formnovalidate>Annuler</button><button class="bouton" value="oui">Enregistrer</button></div>`);
    if (r.valeur !== 'oui') return;
    const libelle = String(r.donnees.get('libelle') || '').trim();
    if (!libelle) return;
    await enregistrerMotif({ ...m, libelle, polarite: r.donnees.get('polarite'), modifieLeUtc: le });
  } else if (action === 'motif-desactiver' || action === 'motif-activer') {
    await enregistrerMotif({ ...m, actif: action === 'motif-activer', modifieLeUtc: le });
  } else if (action === 'motif-degrouper') {
    await enregistrerMotif({ ...m, regroupeDans: null, actif: true, modifieLeUtc: le });
  } else if (action === 'motif-regrouper') {
    const descendants = new Set([m.id]);
    let change = true;
    while (change) { change = false; for (const x of etat.motifs) if (x.regroupeDans && descendants.has(x.regroupeDans) && !descendants.has(x.id)) { descendants.add(x.id); change = true; } }
    const cibles = motifsActifs().filter((x) => !descendants.has(x.id));
    if (!cibles.length) { annoncer('Aucun autre motif actif dans lequel regrouper celui-ci.'); return; }
    const r = await dialogue(`<h2 id="dialogue-titre">Regrouper « ${esc(m.libelle)} »</h2>
      <p>Il ne sera plus proposé ; ses occurrences passées seront comptées avec le motif choisi dans les statistiques et les rapports. Les évaluations elles-mêmes ne changent pas.</p>
      <div class="champ"><label for="m-cible">Regrouper dans</label><select id="m-cible" name="cible" autofocus>${cibles.map((x) => `<option value="${esc(x.id)}">${esc(x.libelle)} (${C.LIBELLE_POLARITE[x.polarite].toLowerCase()})</option>`).join('')}</select></div>
      <div class="dialogue-actions"><button class="bouton-secondaire" value="non" formnovalidate>Annuler</button><button class="bouton" value="oui">Regrouper</button></div>`);
    if (r.valeur !== 'oui') return;
    await enregistrerMotif({ ...m, regroupeDans: r.donnees.get('cible'), actif: false, modifieLeUtc: le });
    for (const enfant of etat.motifs.filter((x) => x.regroupeDans === m.id)) await enregistrerMotif({ ...enfant, regroupeDans: r.donnees.get('cible'), modifieLeUtc: le });
  } else if (action === 'motif-supprimer') {
    const ok = await confirmer(`Supprimer « ${m.libelle} » ?`, 'Il sera retiré de la bibliothèque. Les évaluations passées le conservent tel qu\'il a été coché et il reste compté sous ce libellé dans les rapports.', 'Supprimer');
    if (!ok) return;
    await prendreInstantane('Avant suppression d\'un motif');
    for (const enfant of etat.motifs.filter((x) => x.regroupeDans === m.id)) await enregistrerMotif({ ...enfant, regroupeDans: null, actif: true, modifieLeUtc: le });
    await DB.supprimer('motifs', m.id);
    etat.motifs = etat.motifs.filter((x) => x.id !== m.id);
  }
  vueMotifs();
}

// ---------------------------------------------------------------------------
// Textes pour le rapport : version corrigée, raccourcie et professionnelle

const aRelire = () => etat.evaluations.filter((e) => e.reformulation && e.reformulation.statut !== 'validee' && C.aDesTextes(e)).length;
const nbMots = (t) => (String(t || '').trim() ? String(t).trim().split(/\s+/).length : 0);
const LIBELLES_TEXTES = { explication: 'Explication', complement: 'Complément', prevision: 'Motif de la prévision' };

function blocVersionRapport(ev) {
  const r = ev.reformulation;
  if (!r) return `<div class="bloc"><h2>Version pour le rapport</h2><p class="doux">Aucune version corrigée : le rapport reprendra le texte original.</p><a class="bouton-secondaire" href="#/textes/${esc(ev.id)}">Préparer une version corrigée</a></div>`;
  const t = C.textesOriginaux(ev);
  return `<div class="bloc"><h2>Version pour le rapport</h2>
    <p>${badgeReformulation(r)}${r.valideeLeUtc ? ` <span class="doux">le ${C.formatDateHeure(r.valideeLeUtc)}</span>` : ''}</p>
    <dl>${Object.keys(LIBELLES_TEXTES).filter((k) => t[k] && r[k]).map((k) => `<dt>${LIBELLES_TEXTES[k]}</dt><dd class="texte-libre">${esc(r[k])}</dd>`).join('')}</dl>
    <p style="margin-top:12px"><a class="bouton-secondaire" href="#/textes/${esc(ev.id)}">${r.statut === 'validee' ? 'Modifier' : 'Relire et valider'}</a></p></div>`;
}

function badgeReformulation(r) {
  if (!r) return '<span class="statut statut-a_venir">Aucune version</span>';
  if (r.statut === 'validee') return `<span class="statut statut-repondu">${ICONES_STATUT.repondu}Validée</span>`;
  return `<span class="statut statut-en_attente">${ICONES_STATUT.en_attente}${esc(C.STATUTS_REFORMULATION[r.statut])}</span>`;
}

async function copierTexte(texte) {
  try { await navigator.clipboard.writeText(texte); return true; } catch {
    const zone = document.getElementById('demande-texte');
    if (zone) { zone.closest('details').open = true; zone.select(); try { return document.execCommand('copy'); } catch { return false; } }
    return false;
  }
}

function vueTextes([idCible]) {
  const tous = C.trierChrono(etat.evaluations.filter(C.aDesTextes)).reverse();
  const aTraiter = tous.filter(C.aReformuler);
  const proposees = tous.filter((e) => e.reformulation && e.reformulation.statut === 'proposee');
  const validees = tous.filter((e) => e.reformulation && e.reformulation.statut === 'validee');
  const cible = idCible ? tous.find((e) => e.id === idCible) : null;
  const filtre = ui.filtreTextes || 'a-faire';
  const affichees = cible ? [cible] : (filtre === 'toutes' ? tous : tous.filter((e) => !e.reformulation || e.reformulation.statut !== 'validee'));
  const personne = ui.personneTextes || (etat.parametres.ia && etat.parametres.ia.personne) || 'troisieme';
  const demande = aTraiter.length ? C.demandeReformulation(aTraiter, { personne }) : '';
  const auto = iaPrete();
  const dest = (etat.parametres.destinataire || '').trim() || 'le thérapeute';
  const carte = (ev) => {
    const t = C.textesOriginaux(ev);
    const r = ev.reformulation;
    const champs = Object.keys(LIBELLES_TEXTES).filter((k) => t[k]);
    return `<article class="bloc carte-texte" id="t-${esc(ev.id)}" data-id="${esc(ev.id)}">
      <div class="rangee-espacee"><h3 style="margin:0">${esc(C.majuscule(C.formatDateLongue(ev.date)))}, ${ev.creneau} <span class="doux">– ${esc(C.libelleNote(ev.note))}</span></h3>${badgeReformulation(r)}</div>
      ${champs.map((k) => `<div class="champ" style="margin-top:14px">
        <label for="t-${esc(ev.id)}-${k}">${LIBELLES_TEXTES[k]} – version pour ${esc(dest)}</label>
        <textarea id="t-${esc(ev.id)}-${k}" data-champ="${k}" rows="${Math.min(10, Math.max(3, Math.ceil((r && r[k] ? r[k] : t[k]).length / 70)))}" maxlength="10000" spellcheck="true" lang="fr" autocapitalize="sentences" placeholder="Pas encore de version corrigée">${esc(r ? r[k] : '')}</textarea>
        <small class="doux" data-compte="${k}">${r && r[k] ? `${nbMots(r[k])} mots, ` : ''}original : ${nbMots(t[k])} mots</small>
        <details class="repli" ${cible ? 'open' : ''}><summary>Ton texte original</summary><p class="texte-libre encre-2">${esc(t[k])}</p></details>
      </div>`).join('')}
      <div class="rangee">
        <button type="button" class="bouton" data-texte="valider">${r && r.statut === 'validee' ? 'Enregistrer et valider' : 'Valider cette version'}</button>
        ${auto ? `<button type="button" class="bouton-secondaire" data-texte="proposer">${r ? 'Nouvelle proposition' : 'Préparer automatiquement'}</button>` : ''}
        ${!r ? '<button type="button" class="bouton-secondaire" data-texte="partir">Partir de mon texte original</button>' : ''}
        ${r ? '<button type="button" class="bouton-discret" data-texte="retirer">Retirer cette version</button>' : ''}
        <a class="bouton-discret" href="#/evaluation/${esc(ev.id)}">Voir l'évaluation</a>
      </div>
    </article>`;
  };

  if (cible) {
    contenu.innerHTML = `<section class="colonne-centree">
      <h1>Version pour ${esc(dest)}</h1>
      <p class="encre-2">${cible.reformulation && cible.reformulation.statut === 'proposee' ? 'Voici une proposition corrigée, raccourcie et rédigée dans un style professionnel. Vérifie qu\'elle respecte ce que tu voulais dire, modifie-la si besoin, puis valide-la : seule une version validée figure dans le rapport.' : 'Relis ou rédige la version qui figurera dans le rapport. Ton texte original reste intact.'}</p>
      ${carte(cible)}
      <p><a class="bouton-discret" href="#/textes">Tous les textes pour le rapport</a></p>
    </section>`;
  } else {
    contenu.innerHTML = `<section class="colonne-centree">
      <h1>Textes pour le rapport</h1>
      <p class="encre-2">Le rapport PDF présente tes commentaires avec l'orthographe corrigée, des phrases plus courtes et un style professionnel, dans une version que tu as relue et validée. Ton texte original n'est jamais modifié ; sans version validée, c'est lui qui figure dans le rapport.</p>
      <div class="tuiles" style="margin-bottom:18px">
        <div class="tuile"><div class="tuile-valeur">${aTraiter.length}</div><div class="tuile-libelle">sans version corrigée</div></div>
        <div class="tuile"><div class="tuile-valeur">${proposees.length}</div><div class="tuile-libelle">propositions à valider</div></div>
        <div class="tuile"><div class="tuile-valeur">${validees.length}</div><div class="tuile-libelle">versions validées</div></div>
      </div>
      <div class="bloc">
        <h2>Préparation des versions</h2>
        ${auto ? `<p>Préparation automatique activée avec ${esc(C.majuscule(FOURNISSEURS[etat.parametres.ia.fournisseur].nom))} : chaque nouvelle évaluation commentée reçoit une proposition, que tu valides.</p>
          ${aTraiter.length ? `<button type="button" class="bouton" id="btn-preparer-tout">Préparer maintenant ${aTraiter.length > 1 ? `les ${aTraiter.length} versions` : 'la version manquante'}</button>` : '<p class="doux">Aucune version à préparer.</p>'}`
    : `<p>Pour que les propositions soient préparées automatiquement après chaque évaluation, active la préparation automatique dans les Réglages.</p><a class="bouton" href="#/reglages/ia">Activer la préparation automatique</a>`}
        ${aTraiter.length ? `<details class="repli" style="margin-top:14px"><summary>Ou par copier-coller dans un assistant</summary>
          <ol class="etapes">
            <li>Copie la demande (${C.pluriel(aTraiter.length, 'évaluation')}).</li>
            <li>Colle-la dans l'assistant de ton choix, par exemple Claude, et envoie-la.</li>
            <li>Colle sa réponse complète ci-dessous, puis importe-la.</li>
          </ol>
          <fieldset class="champ"><legend style="font-weight:600;margin-bottom:6px">Style souhaité</legend><div class="segmente">
            <label><input type="radio" name="personne" value="troisieme" ${personne === 'troisieme' ? 'checked' : ''}><span>« Le patient… »</span></label>
            <label><input type="radio" name="personne" value="premiere" ${personne === 'premiere' ? 'checked' : ''}><span>« Je… »</span></label>
          </div></fieldset>
          <div class="bandeau"><strong>Confidentialité</strong>En collant la demande dans un assistant en ligne, tu lui transmets ces textes. Elle ne contient ni ton nom, ni tes notes, ni les dates, mais les textes restent des données personnelles de santé.</div>
          <div class="rangee"><button type="button" class="bouton-secondaire" id="btn-copier-demande">Copier la demande</button></div>
          <details class="repli" style="margin-top:8px"><summary>Voir la demande</summary><textarea id="demande-texte" rows="10" readonly>${esc(demande)}</textarea></details>
          <div class="champ" style="margin-top:14px"><label for="reponse-assistant">Réponse de l'assistant</label><textarea id="reponse-assistant" rows="6" placeholder="Colle ici la réponse complète"></textarea></div>
          <button type="button" class="bouton-secondaire" id="btn-importer-reponse">Importer les propositions</button>
        </details>` : ''}
      </div>
      <div class="rangee-espacee section">
        <h2 style="margin:0">Relire et valider</h2>
        <fieldset class="segmente"><legend class="visuellement-cache">Afficher</legend>
          <label><input type="radio" name="filtre-textes" value="a-faire" ${filtre === 'a-faire' ? 'checked' : ''}><span>À faire</span></label>
          <label><input type="radio" name="filtre-textes" value="toutes" ${filtre === 'toutes' ? 'checked' : ''}><span>Toutes</span></label>
        </fieldset>
      </div>
      ${proposees.length > 1 ? `<p><button type="button" class="bouton-secondaire" id="btn-tout-valider">Valider les ${proposees.length} propositions</button></p>` : ''}
      ${affichees.length ? affichees.map(carte).join('') : '<p class="doux">Rien à relire pour le moment.</p>'}
    </section>`;
  }

  const rafraichir = () => vueTextes(cible ? [cible.id] : []);
  contenu.querySelectorAll('[name="personne"]').forEach((r) => r.addEventListener('change', () => { ui.personneTextes = r.value; vueTextes([]); }));
  contenu.querySelectorAll('[name="filtre-textes"]').forEach((r) => r.addEventListener('change', () => { ui.filtreTextes = r.value; vueTextes([]); }));
  const bPreparer = document.getElementById('btn-preparer-tout');
  if (bPreparer) bPreparer.addEventListener('click', async () => {
    bPreparer.disabled = true; bPreparer.textContent = 'Préparation en cours…';
    const n = await preparerVersions(aTraiter, { silencieux: false });
    if (n !== null) annoncer(`${C.pluriel(n, 'proposition préparée', 'propositions préparées')} : relis-les et valide-les.`);
    vueTextes([]);
  });
  const bCopier = document.getElementById('btn-copier-demande');
  if (bCopier) bCopier.addEventListener('click', async () => annoncer(await copierTexte(demande) ? 'Demande copiée : colle-la dans l\'assistant.' : 'Copie automatique impossible : sélectionne le texte de la demande et copie-le.'));
  const bImporter = document.getElementById('btn-importer-reponse');
  if (bImporter) bImporter.addEventListener('click', async () => {
    try {
      const { propositions, ignorees } = C.lireReponseReformulation(document.getElementById('reponse-assistant').value, etat.evaluations);
      if (!propositions.length) throw new Error('Aucune proposition reconnue dans la réponse.');
      await enregistrerPropositions(propositions, 'Proposition de version corrigée importée depuis un assistant (copier-coller)');
      ui.filtreTextes = 'a-faire';
      annoncer(`${C.pluriel(propositions.length, 'proposition importée', 'propositions importées')}${ignorees.length ? `, ${ignorees.length} ignorée(s)` : ''}. Relis-les avant de valider.`);
      vueTextes([]);
    } catch (e) { annoncer(e.message); }
  });
  const bTout = document.getElementById('btn-tout-valider');
  if (bTout) bTout.addEventListener('click', async () => {
    if (!(await confirmer('Valider toutes les propositions ?', 'Vérifie d\'abord que chaque proposition respecte le sens de ton texte original. Tu pourras encore les modifier ensuite.', 'Tout valider'))) return;
    const instant = maintenant();
    for (const ev of etat.evaluations.filter((e) => e.reformulation && e.reformulation.statut === 'proposee')) {
      const maj = C.definirReformulation(ev, { ...ev.reformulation, statut: 'validee' }, 'Version pour le rapport validée', instant);
      if (maj) await enregistrerEvaluation(maj);
    }
    annoncer('Propositions validées.');
    vueTextes([]);
  });
  contenu.querySelectorAll('.carte-texte').forEach((carteEl) => {
    const id = carteEl.dataset.id;
    carteEl.querySelectorAll('textarea[data-champ]').forEach((ta) => ta.addEventListener('input', () => {
      const ev = etat.evaluations.find((e) => e.id === id);
      carteEl.querySelector(`[data-compte="${ta.dataset.champ}"]`).textContent = `${nbMots(ta.value)} mots, original : ${nbMots(C.textesOriginaux(ev)[ta.dataset.champ])} mots`;
    }));
    carteEl.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-texte]');
      if (!b) return;
      const ev = etat.evaluations.find((x) => x.id === id);
      if (b.dataset.texte === 'partir') {
        const t = C.textesOriginaux(ev);
        carteEl.querySelectorAll('textarea[data-champ]').forEach((ta) => { ta.value = t[ta.dataset.champ]; ta.dispatchEvent(new Event('input')); });
        carteEl.querySelector('textarea[data-champ]').focus();
        return;
      }
      if (b.dataset.texte === 'proposer') {
        b.disabled = true; b.textContent = 'Préparation en cours…';
        const n = await preparerVersions([ev], { silencieux: false, force: true });
        if (n) annoncer('Nouvelle proposition prête : relis-la avant de valider.');
        rafraichir();
        return;
      }
      try {
        let maj;
        if (b.dataset.texte === 'retirer') {
          if (!(await confirmer('Retirer cette version ?', 'Le rapport reprendra ton texte original. Le retrait est noté dans l\'historique.', 'Retirer'))) return;
          maj = C.definirReformulation(ev, null, 'Version pour le rapport retirée', maintenant());
        } else {
          const valeurs = {};
          carteEl.querySelectorAll('textarea[data-champ]').forEach((ta) => { valeurs[ta.dataset.champ] = ta.value; });
          maj = C.definirReformulation(ev, { ...valeurs, statut: 'validee', source: ev.reformulation ? ev.reformulation.source : 'manuelle' }, 'Version pour le rapport validée', maintenant());
          if (!maj) { annoncer('Cette version était déjà validée.'); return; }
        }
        if (maj) await enregistrerEvaluation(maj);
        annoncer(b.dataset.texte === 'retirer' ? 'Version retirée.' : 'Version validée : elle figurera dans le rapport.');
        if (cible && b.dataset.texte !== 'retirer') aller(aRelire() ? '#/textes' : '#/'); else rafraichir();
      } catch (err) { annoncer(err.message); }
    });
  });
}

// Préparation automatique par un service d'IA (avec l'accord explicite du patient)

function iaPrete() {
  const ia = etat.parametres && etat.parametres.ia;
  if (!ia || !ia.actif || !ia.consentementUtc || ia.consentementFournisseur !== ia.fournisseur) return false;
  if (ia.fournisseur === 'anthropic') return !!ia.cle;
  return !!(etat.parametres.serveurRappels && etat.parametres.serveurRappels.url);
}

async function enregistrerPropositions(propositions, raison) {
  const instant = maintenant();
  for (const p of propositions) {
    const ev = etat.evaluations.find((e) => e.id === p.id);
    if (!ev) continue;
    const maj = C.definirReformulation(ev, { ...p, statut: 'proposee', source: 'assistant' }, raison, instant);
    if (maj) await enregistrerEvaluation(maj);
  }
}

/** Retourne le nombre de propositions enregistrées, ou null en cas d'échec. */
async function preparerVersions(evaluations, { silencieux = true, force = false } = {}) {
  const liste = evaluations.filter((e) => C.aDesTextes(e) && (force || C.aReformuler(e)));
  if (!liste.length || !iaPrete()) return 0;
  if (ui.preparationEnCours) return 0;
  ui.preparationEnCours = true;
  try {
    const { reformuler, FOURNISSEURS: F } = await import('./ia.js');
    const { propositions } = await reformuler(etat.parametres, liste);
    await enregistrerPropositions(propositions, `Proposition de version professionnelle préparée automatiquement (${F[etat.parametres.ia.fournisseur].nom})`);
    return propositions.length;
  } catch (e) {
    if (!silencieux) annoncer(`Version professionnelle non préparée : ${e.message}`);
    else console.warn(e);
    return null;
  } finally {
    ui.preparationEnCours = false;
  }
}

/** Après l'enregistrement d'une évaluation : préparer la version et ouvrir directement l'écran de validation. */
async function preparerApresSaisie(ev) {
  if (!iaPrete() || !etat.parametres.ia.automatique || !C.aReformuler(ev)) return false;
  if (!navigator.onLine) { annoncer('Hors connexion : la version pour le thérapeute sera préparée automatiquement plus tard.'); return false; }
  const dest = (etat.parametres.destinataire || '').trim() || 'le thérapeute';
  dlg.innerHTML = `<div class="dialogue-corps"><h2 id="dialogue-titre">Version pour ${esc(dest)}</h2>
    <p>Correction et reformulation de ton commentaire en cours…</p>
    <p class="doux">Tu pourras la relire et la valider dans un instant. Ton texte original reste intact.</p>
    <div class="dialogue-actions"><button type="button" class="bouton-discret" id="btn-sans-attendre">Continuer sans attendre</button></div></div>`;
  let attend = true;
  dlg.showModal();
  document.getElementById('btn-sans-attendre').addEventListener('click', () => { attend = false; dlg.close(); });
  const n = await preparerVersions([ev], { silencieux: false });
  if (dlg.open) dlg.close();
  if (!n) { if (n === 0) return false; annoncer('La version sera préparée automatiquement à la prochaine ouverture.'); return false; }
  if (attend) aller(`#/textes/${ev.id}`);
  else annoncer('Version pour le thérapeute prête à valider.', { libelle: 'Relire', faire: () => aller(`#/textes/${ev.id}`) });
  return true;
}

/** À l'ouverture : préparer les versions restées en attente (hors connexion, échec précédent…). */
async function rattrapageVersions() {
  if (!iaPrete() || !etat.parametres.ia.automatique || !navigator.onLine) return;
  const enAttente = etat.evaluations.filter(C.aReformuler);
  if (!enAttente.length) return;
  const n = await preparerVersions(enAttente);
  if (n) {
    annoncer(`${C.pluriel(n, 'version préparée', 'versions préparées')} pour le thérapeute, à valider.`, { libelle: 'Relire', faire: () => aller('#/textes') });
    const h = location.hash;
    if (h === '' || h === '#/' || h === '#') vueAccueil();
  }
}

// ---------------------------------------------------------------------------
// Rapport PDF

let pdfLibPromesse = null;
function chargerPdfLib() {
  if (globalThis.PDFLib) return Promise.resolve(globalThis.PDFLib);
  if (!pdfLibPromesse) {
    pdfLibPromesse = new Promise((ok, ko) => {
      const s = document.createElement('script');
      s.src = 'pdf-lib.min.js';
      s.onload = () => ok(globalThis.PDFLib);
      s.onerror = () => { pdfLibPromesse = null; ko(new Error('Le module PDF n\'a pas pu être chargé.')); };
      document.head.append(s);
    });
  }
  return pdfLibPromesse;
}

async function ouvrirPdf() {
  if (!etat.parametres) { annoncer('Commence par configurer l\'application.'); return; }
  const fin = aujourdhui();
  const dates = [C.dateLocale(Date.parse(etat.parametres.debutSuiviUtc)), ...etat.evaluations.map((e) => e.date)].sort();
  const debutTout = dates[0] < fin ? dates[0] : fin;
  const debut30 = C.ajouterJours(fin, -29) > debutTout ? C.ajouterJours(fin, -29) : debutTout;
  const dest = (etat.parametres.destinataire || '').trim();
  // Par défaut : tout ce qui s'est passé depuis le dernier rapport (ou depuis le début du suivi)
  const dr = etat.parametres.dernierRapport;
  let debutDefaut = debutTout;
  if (dr && dr.fin) { debutDefaut = C.ajouterJours(dr.fin, 1); if (debutDefaut > fin) debutDefaut = dr.debut || debutTout; }
  dlg.innerHTML = `<form class="dialogue-corps" id="form-pdf" novalidate>
    <h2 id="dialogue-titre">Générer le rapport PDF${dest ? ` pour ${esc(dest)}` : ''}</h2>
    <p class="encre-2">Le rapport est calculé sur cet appareil à partir de tes données enregistrées, uniquement quand tu le demandes.${dr ? ` Dernier rapport : du ${C.formatDateCourte(dr.debut)} au ${C.formatDateCourte(dr.fin)}, généré le ${C.formatDateHeure(dr.genereLeUtc)}.` : ''}</p>
    <div class="rangee" style="margin-bottom:12px">
      ${dr ? '<button type="button" class="bouton-discret" data-periode="depuis">Depuis le dernier rapport</button>' : ''}
      <button type="button" class="bouton-discret" data-periode="7">7 derniers jours</button>
      <button type="button" class="bouton-discret" data-periode="30">30 derniers jours</button>
      <button type="button" class="bouton-discret" data-periode="tout">Tout le suivi</button>
    </div>
    <div class="rangee" style="align-items:flex-start">
      <div class="champ" style="flex:1;min-width:150px"><label for="pdf-debut">Date de début</label><input type="date" id="pdf-debut" value="${debutDefaut}" max="${fin}" required></div>
      <div class="champ" style="flex:1;min-width:150px"><label for="pdf-fin">Date de fin</label><input type="date" id="pdf-fin" value="${fin}" required></div>
    </div>
    <fieldset class="champ"><legend style="font-weight:600;margin-bottom:6px">Type de rapport</legend>
      <label class="interrupteur"><input type="radio" name="type" value="complet" checked> <span>Complet <span class="doux">– tous les commentaires en annexe</span></span></label>
      <label class="interrupteur" style="margin-top:8px"><input type="radio" name="type" value="synthetique"> <span>Synthétique <span class="doux">– commentaires abrégés, tableaux résumés</span></span></label>
    </fieldset>
    <fieldset class="champ"><legend style="font-weight:600;margin-bottom:6px">Commentaires dans le rapport</legend>
      <label class="interrupteur"><input type="radio" name="textes" value="reformule" checked> <span>Version corrigée et raccourcie <span class="doux">– si tu l'as validée, sinon texte original</span></span></label>
      <label class="interrupteur" style="margin-top:8px"><input type="radio" name="textes" value="les-deux"> <span>Version corrigée, suivie du texte original</span></label>
      <label class="interrupteur" style="margin-top:8px"><input type="radio" name="textes" value="original"> <span>Texte original uniquement</span></label>
    </fieldset>
    ${(() => { const n = etat.evaluations.filter((e) => C.aDesTextes(e) && !(e.reformulation && e.reformulation.statut === 'validee')).length; return n ? `<p class="bandeau">${n > 1 ? `${n} commentaires n'ont` : 'Un commentaire n\'a'} pas encore de version corrigée validée. <a href="#/textes" data-fermer-dialogue>Préparer les textes pour le rapport</a></p>` : ''; })()}
    <div id="pdf-message" class="erreurs" hidden></div>
    <div id="pdf-resultat" hidden></div>
    <div class="dialogue-actions"><button type="button" class="bouton-secondaire" data-fermer>Fermer</button><button type="submit" class="bouton" id="pdf-generer">Générer le PDF</button></div>
  </form>`;
  dlg.showModal();
  const form = document.getElementById('form-pdf');
  form.querySelector('[data-fermer]').addEventListener('click', () => dlg.close());
  form.querySelectorAll('[data-fermer-dialogue]').forEach((a) => a.addEventListener('click', () => dlg.close()));
  form.querySelectorAll('[data-periode]').forEach((b) => b.addEventListener('click', () => {
    document.getElementById('pdf-fin').value = fin;
    document.getElementById('pdf-debut').value = b.dataset.periode === 'tout' ? debutTout : b.dataset.periode === 'depuis' ? debutDefaut : C.ajouterJours(fin, -(Number(b.dataset.periode) - 1));
  }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('pdf-message');
    const res = document.getElementById('pdf-resultat');
    const bouton = document.getElementById('pdf-generer');
    msg.hidden = true; res.hidden = true;
    const debut = document.getElementById('pdf-debut').value;
    const finChoisie = document.getElementById('pdf-fin').value;
    const type = form.querySelector('[name="type"]:checked').value;
    const textes = form.querySelector('[name="textes"]:checked').value;
    if (!C.estDateValide(debut) || !C.estDateValide(finChoisie) || debut > finChoisie) {
      msg.hidden = false; msg.textContent = 'Choisis une date de début antérieure ou égale à la date de fin.'; return;
    }
    bouton.disabled = true; bouton.textContent = 'Génération…';
    try {
      const PDFLib = await chargerPdfLib();
      const { genererRapport, nomFichierRapport } = await import('./rapport.js');
      const octets = await genererRapport(PDFLib, { evaluations: etat.evaluations, motifs: etat.motifs, parametres: etat.parametres }, { debut, fin: finChoisie, type, textes, instant: maintenant() });
      const blob = new Blob([octets], { type: 'application/pdf' });
      const nom = nomFichierRapport(debut, finChoisie, type);
      const nbPages = (new TextDecoder('latin1').decode(octets).match(/\/Type\s*\/Page[^s]/g) || []).length;
      res.hidden = false;
      await enregistrerParametres({ dernierRapport: { debut, fin: finChoisie, type, genereLeUtc: new Date(maintenant()).toISOString() } });
      const seance = etat.parametres.prochaineSeance || '';
      res.innerHTML = `<div class="bandeau bandeau-laiton"><strong>Rapport prêt</strong>${esc(nom)}${nbPages ? `, ${nbPages} page${nbPages > 1 ? 's' : ''}` : ''}.<div class="rangee" style="margin-top:10px"><button type="button" class="bouton" id="pdf-telecharger">Télécharger</button>${navigator.canShare ? '<button type="button" class="bouton-secondaire" id="pdf-partager">Partager ou enregistrer</button>' : ''}<button type="button" class="bouton-discret" id="pdf-ouvrir">Ouvrir</button></div></div>
        <div class="champ" style="margin-top:12px"><label for="pdf-seance">Date de ta prochaine séance <small class="doux">(facultatif : un rappel s'affichera la veille et le jour même)</small></label>
          <div class="rangee"><input type="date" id="pdf-seance" value="${seance > fin ? seance : ''}" min="${C.ajouterJours(fin, 1)}" style="flex:1;min-width:150px"><button type="button" class="bouton-secondaire" id="pdf-seance-ok">Enregistrer</button></div></div>`;
      document.getElementById('pdf-seance-ok').addEventListener('click', async () => {
        const v = document.getElementById('pdf-seance').value;
        await enregistrerParametres({ prochaineSeance: C.estDateValide(v) ? v : '' });
        annoncer(C.estDateValide(v) ? `Prochaine séance notée : ${C.formatDateLongue(v)}.` : 'Date de séance effacée.');
      });
      document.getElementById('pdf-telecharger').addEventListener('click', () => telecharger(blob, nom));
      document.getElementById('pdf-ouvrir').addEventListener('click', () => { const u = URL.createObjectURL(blob); window.open(u, '_blank', 'noopener'); setTimeout(() => URL.revokeObjectURL(u), 120000); });
      const bp = document.getElementById('pdf-partager');
      if (bp) bp.addEventListener('click', async () => { if (!(await partager(blob, nom))) telecharger(blob, nom); });
      if (!estIOS) telecharger(blob, nom);
    } catch (err) {
      msg.hidden = false; msg.textContent = `Le rapport n'a pas pu être généré : ${err.message}`;
    } finally {
      bouton.disabled = false; bouton.textContent = 'Générer le PDF';
    }
  });
}

// ---------------------------------------------------------------------------
// Import / export

async function exporter(type) {
  const date = aujourdhui();
  if (type === 'json') {
    await livrer(new Blob([JSON.stringify(exportComplet(), null, 2)], { type: 'application/json' }), `barometre-humeur_sauvegarde_${date}.json`);
    await enregistrerParametres({ derniereSauvegardeUtc: new Date(maintenant()).toISOString() });
    annoncer('Sauvegarde complète exportée.');
  } else if (type === 'csv-evaluations') {
    await livrer(new Blob([C.exporterCSVEvaluations(etat.evaluations)], { type: 'text/csv;charset=utf-8' }), `barometre-humeur_evaluations_${date}.csv`);
  } else if (type === 'csv-motifs') {
    await livrer(new Blob([C.exporterCSVMotifs(etat.motifs)], { type: 'text/csv;charset=utf-8' }), `barometre-humeur_motifs_${date}.csv`);
  }
}

async function importerFichier(fichier, { premierDemarrage = false } = {}) {
  let lu;
  try {
    const texte = await fichier.text();
    if (/\.csv$/i.test(fichier.name) || (!texte.trim().startsWith('{') && texte.includes(';'))) {
      const r = C.lireCSV(texte);
      lu = { evaluations: r.evaluations, motifs: r.motifs, parametres: null, archives: [], csv: r.type };
    } else lu = C.lireJSON(texte);
  } catch (e) {
    annoncer(`Import impossible : ${e.message}`);
    router();
    return;
  }
  const estSauvegardeComplete = !!(lu.parametres && lu.parametres.debutSuiviUtc);
  let mode = 'fusion';
  if (estSauvegardeComplete || !premierDemarrage) {
    const r = await dialogue(`<h2 id="dialogue-titre">Importer ${esc(fichier.name)}</h2>
      <p>Ce fichier contient ${C.pluriel(lu.evaluations.length, 'évaluation')} et ${C.pluriel(lu.motifs.length, 'motif')}${lu.exporteLeUtc ? `, exporté le ${C.formatDateHeure(lu.exporteLeUtc)}` : ''}.</p>
      <fieldset class="champ"><legend style="font-weight:600;margin-bottom:6px">Que faire ?</legend>
        <label class="interrupteur"><input type="radio" name="mode" value="fusion" ${premierDemarrage && estSauvegardeComplete ? '' : 'checked'}> <span>Fusionner avec les données de cet appareil <span class="doux">(recommandé : rien n'est perdu, les doublons sont archivés)</span></span></label>
        ${estSauvegardeComplete ? `<label class="interrupteur" style="margin-top:8px"><input type="radio" name="mode" value="remplacer" ${premierDemarrage ? 'checked' : ''}> <span>Remplacer toutes les données de cet appareil par celles du fichier <span class="doux">(une copie de l'état actuel est conservée dans les instantanés)</span></span></label>` : ''}
      </fieldset>
      <div class="dialogue-actions"><button class="bouton-secondaire" value="non" formnovalidate>Annuler</button><button class="bouton" value="oui">Importer</button></div>`);
    if (r.valeur !== 'oui') { router(); return; }
    mode = r.donnees.get('mode') || 'fusion';
  }
  try {
    await prendreInstantane(`Avant import de ${fichier.name}`);
    if (mode === 'remplacer') {
      const parametres = { ...C.parametresParDefaut(), ...lu.parametres };
      await DB.remplacerTout({ evaluations: lu.evaluations, motifs: lu.motifs, parametres, archives: lu.archives || [] });
      await chargerEtat();
      annoncer(`Données restaurées : ${C.pluriel(etat.evaluations.length, 'évaluation')}.`);
    } else {
      const f = C.fusionner({ evaluations: etat.evaluations, motifs: etat.motifs }, lu, maintenant());
      await DB.mettrePlusieurs('evaluations', f.evaluations);
      await DB.mettrePlusieurs('motifs', f.motifs);
      if (f.archives.length) await DB.mettrePlusieurs('archives', f.archives);
      if (lu.parametres && lu.parametres.destinataire && !etat.parametres.destinataire) await enregistrerParametres({ destinataire: lu.parametres.destinataire });
      await chargerEtat();
      const r = f.rapport;
      const parts = [`${r.ajoutees} évaluation${r.ajoutees > 1 ? 's' : ''} ajoutée${r.ajoutees > 1 ? 's' : ''}`];
      if (r.misesAJour) parts.push(`${r.misesAJour} mise${r.misesAJour > 1 ? 's' : ''} à jour`);
      if (r.conflits) parts.push(`${r.conflits} en conflit (archivée${r.conflits > 1 ? 's' : ''})`);
      if (r.motifsAjoutes) parts.push(`${r.motifsAjoutes} motif${r.motifsAjoutes > 1 ? 's' : ''} ajouté${r.motifsAjoutes > 1 ? 's' : ''}`);
      annoncer(`Import terminé : ${parts.join(', ')}.`);
    }
    majBoutonPdf();
    appliquerTheme(etat.parametres.theme);
    majBadge();
    aller('#/');
  } catch (e) {
    annoncer(`Import interrompu : ${e.message}. Tes données précédentes sont intactes.`);
    await chargerEtat();
    router();
  }
}

// Sauvegarde automatique dans un dossier (Edge et Chrome sur ordinateur)
const dossierPossible = () => 'showDirectoryPicker' in window;

async function choisirDossier() {
  try {
    const poignee = await window.showDirectoryPicker({ id: 'barometre-sauvegardes', mode: 'readwrite', startIn: 'documents' });
    await DB.mettre('poignees', { cle: 'dossier', poignee, nom: poignee.name });
    ui.alerteDossier = false;
    await sauvegardeAutomatique(true);
    annoncer(`Sauvegarde automatique activée dans « ${poignee.name} ».`);
  } catch (e) { if (e.name !== 'AbortError') annoncer(`Dossier non utilisable : ${e.message}`); }
  router();
}

async function sauvegardeAutomatique(interactive = false) {
  if (!dossierPossible() || !etat.parametres) return;
  try {
    const ligne = await DB.lire('poignees', 'dossier');
    if (!ligne) return;
    const h = ligne.poignee;
    let perm = await h.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted' && interactive) perm = await h.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') { ui.alerteDossier = true; return; }
    const fichier = await h.getFileHandle(`barometre-humeur_sauvegarde_${aujourdhui()}.json`, { create: true });
    const flux = await fichier.createWritable();
    await flux.write(JSON.stringify(exportComplet(), null, 2));
    await flux.close();
    ui.alerteDossier = false;
    await enregistrerParametres({ derniereSauvegardeFichierUtc: new Date(maintenant()).toISOString() });
  } catch (e) {
    console.warn('Sauvegarde automatique impossible', e);
    ui.alerteDossier = true;
  }
}

// ---------------------------------------------------------------------------
// Rappels et notifications

let minuterie = null;
async function planifierRappelsInternes() {
  clearTimeout(minuterie);
  if (!etat.parametres || !etat.parametres.rappelsDansApplication || !('Notification' in window) || Notification.permission !== 'granted') return;
  const t = maintenant();
  const prochain = C.prochainCreneau(t);
  const quand = C.heurePrevue(prochain.date, prochain.creneau);
  minuterie = setTimeout(async () => {
    if (!parCreneau().has(C.idCreneau(prochain.date, prochain.creneau))) await notifier(prochain);
    majBadge();
    planifierRappelsInternes();
  }, Math.min(Math.max(quand - t + 1000, 1000), 2 ** 31 - 1));
}

async function notifier({ date, creneau }) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const discret = etat.parametres.titreRappelDiscret;
    await reg.showNotification(discret ? (creneau === 'matin' ? 'Rappel du matin' : 'Rappel du soir') : `Évaluation du ${creneau}`, {
      body: discret ? 'Touchez pour ouvrir.' : 'Comment te sens-tu en ce moment ?',
      tag: `barometre-${date}-${creneau}`, icon: 'icone-192.png', badge: 'icone-badge.png',
      data: { url: `./?creneau=${creneau}&date=${date}` },
    });
  } catch (e) { console.warn(e); }
}

async function majBadge() {
  if (!('setAppBadge' in navigator) || !etat.parametres) return;
  try {
    const t = maintenant();
    const grille = C.grilleCreneaux(C.ajouterJours(aujourdhui(), -1), aujourdhui(), etat.evaluations, t, etat.parametres.debutSuiviUtc);
    const n = grille.filter((s) => s.statut === 'en_attente').length;
    if (n) await navigator.setAppBadge(n); else await navigator.clearAppBadge();
  } catch { /* non pris en charge */ }
}

function cleVersOctets(b64) {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function activerServeur(url, jeton) {
  const base = url.replace(/\/+$/, '');
  if (!/^https:\/\//.test(base)) throw new Error('L\'adresse du service doit commencer par https://');
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error(estIOS && !estInstallee() ? 'Sur iPhone, ouvre d\'abord l\'application depuis son icône sur l\'écran d\'accueil.' : 'Ce navigateur ne prend pas en charge les notifications push.');
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Les notifications ont été refusées. Autorise-les dans les réglages de l\'appareil.');
  const r = await fetch(`${base}/cle-publique`, { headers: { authorization: `Bearer ${jeton}` } });
  if (!r.ok) throw new Error(await erreurService(r));
  const { cle } = await r.json();
  const reg = await navigator.serviceWorker.ready;
  let abonnement = await reg.pushManager.getSubscription();
  if (abonnement) {
    const actuelle = abonnement.options && abonnement.options.applicationServerKey;
    const attendue = cleVersOctets(cle);
    if (actuelle && new Uint8Array(actuelle).join() !== attendue.join()) { await abonnement.unsubscribe(); abonnement = null; }
  }
  if (!abonnement) abonnement = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: cleVersOctets(cle) });
  const r2 = await fetch(`${base}/abonnements`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` },
    body: JSON.stringify({ abonnement: abonnement.toJSON(), discret: !!etat.parametres.titreRappelDiscret, appareil: estIOS ? 'iPhone' : navigator.platform || 'ordinateur' }),
  });
  if (!r2.ok) throw new Error(await erreurService(r2));
  await enregistrerParametres({ serveurRappels: { url: base, jeton, actif: true } });
}

async function desactiverServeur() {
  const { url, jeton } = etat.parametres.serveurRappels || {};
  try {
    const reg = await navigator.serviceWorker.ready;
    const ab = await reg.pushManager.getSubscription();
    if (ab) {
      if (url) await fetch(`${url}/abonnements`, { method: 'DELETE', headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` }, body: JSON.stringify({ endpoint: ab.endpoint }) }).catch(() => {});
      await ab.unsubscribe();
    }
  } catch { /* déjà désactivé */ }
  await enregistrerParametres({ serveurRappels: { url: url || '', jeton: jeton || '', actif: false } });
}

async function testerServeur() {
  const { url, jeton } = etat.parametres.serveurRappels;
  const reg = await navigator.serviceWorker.ready;
  const ab = await reg.pushManager.getSubscription();
  if (!ab) throw new Error('Cet appareil n\'est pas abonné.');
  const r = await fetch(`${url}/test`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${jeton}` }, body: JSON.stringify({ endpoint: ab.endpoint }) });
  if (!r.ok) throw new Error(await erreurService(r));
}

async function erreurService(r) {
  let detail = '';
  try { detail = (await r.json()).erreur || ''; } catch { /* pas de JSON */ }
  if (r.status === 401) return 'Mot de passe refusé : il doit être identique à la variable JETON du service de rappels.';
  if (r.status === 404) return 'Adresse introuvable : vérifie l\'adresse du service de rappels.';
  return `Le service de rappels a répondu ${r.status}${detail ? ` : ${detail}` : ''}.`;
}

// ---------------------------------------------------------------------------
// Réglages

async function vueReglages([section] = []) {
  const p = etat.parametres;
  const instantanes = (await DB.tout('instantanes')).sort((a, b) => (a.id < b.id ? 1 : -1));
  const dossier = dossierPossible() ? await DB.lire('poignees', 'dossier') : null;
  let persiste = null, estimation = null;
  try { if (navigator.storage) { persiste = navigator.storage.persisted ? await navigator.storage.persisted() : null; estimation = navigator.storage.estimate ? await navigator.storage.estimate() : null; } } catch { /* facultatif */ }
  const permNotif = 'Notification' in window ? Notification.permission : 'indisponible';
  const debutLocal = (() => { const ms = Date.parse(p.debutSuiviUtc); const q = C.partiesLocales(ms); return `${q.date}T${String(q.heure).padStart(2, '0')}:${String(q.minute).padStart(2, '0')}`; })();
  const adresse = location.href.split('#')[0].split('?')[0];
  const serv = p.serveurRappels || {};
  contenu.innerHTML = `<section class="colonne-centree">
    <h1>Réglages</h1>

    <div class="bloc"><h2>Apparence</h2>
      <fieldset><legend class="visuellement-cache">Thème</legend><div class="segmente">${[['auto', 'Automatique'], ['clair', 'Clair'], ['sombre', 'Sombre']].map(([v, l]) => `<label><input type="radio" name="theme" value="${v}" ${p.theme === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
    </div>

    <form class="bloc" id="form-general"><h2>Rapport et suivi</h2>
      <div class="champ"><label for="destinataire">Destinataire du rapport PDF</label><input type="text" id="destinataire" value="${esc(p.destinataire)}" maxlength="80" placeholder="Nom de ton thérapeute"><small class="doux">Apparaît sur le bouton et en titre du rapport.</small></div>
      <div class="champ"><label for="prochaine-seance">Prochaine séance <small class="doux">(facultatif : rappel la veille et le jour même pour générer le rapport)</small></label><input type="date" id="prochaine-seance" value="${esc(p.prochaineSeance || '')}"></div>
      <div class="champ"><label for="debut-suivi">Début du suivi dans l'application</label><input type="datetime-local" id="debut-suivi" value="${debutLocal}"><small class="doux">Heure de Luxembourg. Les créneaux terminés avant cette date sont « non renseignés » et ne comptent pas comme omis.</small></div>
      <div class="champ"><label for="contact-nom">Personne de confiance ou thérapeute <small class="doux">(proposée dans l'écran d'aide)</small></label>
        <div class="rangee"><input type="text" id="contact-nom" value="${esc(p.contactConfiance.nom)}" placeholder="Nom" style="flex:1;min-width:140px"><input type="tel" id="contact-tel" value="${esc(p.contactConfiance.telephone)}" placeholder="Téléphone" style="flex:1;min-width:140px"></div></div>
      <button class="bouton" type="submit">Enregistrer</button>
    </form>

    <div class="bloc" id="rappels"><h2>Rappels de 06:00 et 18:00</h2>
      <p class="encre-2">Notifications : <strong>${{ granted: 'autorisées', denied: 'refusées', default: 'pas encore demandées', indisponible: 'non prises en charge ici' }[permNotif]}</strong>. Rappels de l'application sur cet appareil : <strong>${serv.actif ? 'activés' : 'non activés'}</strong>.</p>
      <h3>Notifications de l'application (iPhone et Windows)</h3>
      <p>Chaque jour à 06:00 et 18:00, heure de Luxembourg, une notification « Évaluation du matin » ou « du soir » s'affiche, même application fermée. La toucher ouvre directement l'évaluation. Elles sont envoyées par ton service de rappels gratuit (voir le guide, rubrique « Rappels » : installation unique d'environ 10 minutes). Ce service ne reçoit jamais tes évaluations.</p>
      ${estIOS && !estInstallee() ? '<div class="bandeau"><strong>Sur iPhone</strong>Ouvre d\'abord l\'application depuis son icône sur l\'écran d\'accueil : les notifications ne fonctionnent que là.</div>' : ''}
      <div class="champ"><label for="serveur-url">Adresse du service de rappels</label><input type="url" id="serveur-url" value="${esc(serv.url)}" placeholder="https://barometre-rappels.ton-nom.workers.dev" inputmode="url" autocapitalize="off" spellcheck="false"></div>
      <div class="champ"><label for="serveur-jeton">Mot de passe du service (variable JETON)</label><input type="text" id="serveur-jeton" value="${esc(serv.jeton)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <div class="rangee">
        <button type="button" class="bouton" data-action="serveur-activer">${serv.actif ? 'Réactiver sur cet appareil' : 'Activer les rappels sur cet appareil'}</button>
        ${serv.actif ? '<button type="button" class="bouton-secondaire" data-action="serveur-tester">Envoyer une notification de test</button><button type="button" class="bouton-discret" data-action="serveur-desactiver">Désactiver</button>' : ''}
      </div>
      <label class="interrupteur" style="margin-top:14px"><input type="checkbox" id="rappel-discret" ${p.titreRappelDiscret ? 'checked' : ''}> <span>Texte de notification discret <span class="doux">(« Rappel du matin » au lieu de « Évaluation du matin »)</span></span></label>
      <details class="repli" style="margin-top:14px"><summary>Solutions de secours, sans service de rappels</summary>
        <label class="interrupteur" style="margin:8px 0"><input type="checkbox" id="rappels-internes" ${p.rappelsDansApplication && permNotif === 'granted' ? 'checked' : ''} ${permNotif === 'indisponible' ? 'disabled' : ''}> <span>Rappels quand l'application est ouverte <span class="doux">(fenêtre ouverte ou réduite)</span></span></label>
        <p><strong>Windows</strong> : ce programme crée deux tâches planifiées (06:00 et 18:00) qui affichent une notification ; un clic ouvre l'évaluation dans Edge. Après le téléchargement, double-clique sur le fichier ; si Windows affiche « Windows a protégé votre ordinateur », choisis « Informations complémentaires » puis « Exécuter quand même », puis tape 1.</p>
        <p><button type="button" class="bouton-secondaire" data-action="script-windows">Télécharger le programme de rappels Windows</button></p>
        <p><strong>Calendrier</strong> : deux rendez-vous quotidiens avec alerte (l'alerte ouvre le calendrier ; ouvre ensuite le Baromètre depuis son icône).</p>
        <p><button type="button" class="bouton-secondaire" data-action="calendrier-ics">Télécharger les rappels de calendrier (.ics)</button></p>
      </details>
    </div>

    ${blocIA()}

    <div class="bloc" id="sauvegarde"><h2>Sauvegarde et restauration</h2>
      <p class="encre-2">Dernière sauvegarde exportée : ${p.derniereSauvegardeUtc ? C.formatDateHeure(p.derniereSauvegardeUtc) : 'jamais'}.${p.derniereSauvegardeFichierUtc ? ` Dernière copie automatique : ${C.formatDateHeure(p.derniereSauvegardeFichierUtc)}.` : ''}</p>
      <div class="rangee">
        <button type="button" class="bouton" data-action="exporter-json">Exporter tout (JSON)</button>
        <button type="button" class="bouton-secondaire" data-action="exporter-csv-evaluations">Évaluations (CSV)</button>
        <button type="button" class="bouton-secondaire" data-action="exporter-csv-motifs">Motifs (CSV)</button>
      </div>
      <p class="doux" style="margin-top:8px">Le fichier JSON contient tout (évaluations, historiques, motifs, réglages, archives) : c'est lui qui sert à restaurer ou à transférer vers un autre appareil. Les CSV s'ouvrent dans Excel.</p>
      <h3 style="margin-top:18px">Importer ou restaurer</h3>
      <label class="bouton-secondaire" for="fichier-import">Choisir un fichier JSON ou CSV…</label>
      <input type="file" id="fichier-import" accept=".json,.csv,application/json,text/csv" class="visuellement-cache">
      <p class="doux" style="margin-top:8px">Par défaut, l'import fusionne sans rien effacer : en cas de doublon, la version locale est gardée et l'autre est archivée.</p>
      ${dossierPossible() ? `<h3 style="margin-top:18px">Copie automatique dans un dossier</h3>
        <p>${dossier ? `Après chaque évaluation, une copie du jour est écrite dans le dossier « ${esc(dossier.nom)} ».` : 'Choisis un dossier (par exemple Documents\\Baromètre) : après chaque évaluation, l\'application y écrit une copie datée.'}</p>
        <div class="rangee"><button type="button" class="bouton-secondaire" data-action="choisir-dossier">${dossier ? 'Changer de dossier' : 'Choisir un dossier'}</button>${dossier ? '<button type="button" class="bouton-discret" data-action="autoriser-dossier">Faire une copie maintenant</button><button type="button" class="bouton-discret" data-action="oublier-dossier">Arrêter</button>' : ''}</div>` : ''}
      <h3 style="margin-top:18px">Instantanés internes</h3>
      <p class="doux">Copies conservées automatiquement sur cet appareil (une par jour et avant chaque import, retrait ou restauration ; les 30 dernières). Elles protègent contre une fausse manœuvre, pas contre la perte de l'appareil.</p>
      ${instantanes.length ? `<ul class="liste-simple">${instantanes.slice(0, 10).map((s) => `<li><span>${C.formatDateHeure(s.creeLeUtc)} <span class="doux">– ${esc(s.raison)}, ${C.pluriel(s.nombre, 'évaluation')}</span></span><span><button type="button" class="bouton-discret" data-action="instantane-telecharger" data-id="${esc(s.id)}">Télécharger</button><button type="button" class="bouton-discret" data-action="instantane-restaurer" data-id="${esc(s.id)}">Restaurer</button></span></li>`).join('')}</ul>` : '<p class="doux">Aucun instantané.</p>'}
      ${etat.archives.length ? `<h3 style="margin-top:18px">Archives</h3><p class="doux">Évaluations retirées ou écartées lors d'un import. Elles ne sont jamais supprimées automatiquement.</p>
        <ul class="liste-simple">${etat.archives.sort((a, b) => (a.archiveLeUtc < b.archiveLeUtc ? 1 : -1)).map((a) => `<li><span>${esc(C.formatDateCourte(a.evaluation.date))} ${a.evaluation.creneau}, ${esc(C.libelleNote(a.evaluation.note))}<br><span class="doux">${esc(a.raison)} (${C.formatDateHeure(a.archiveLeUtc)})</span></span><button type="button" class="bouton-discret" data-action="archive-restaurer" data-id="${esc(a.id)}">Restaurer</button></li>`).join('')}</ul>` : ''}
    </div>

    <div class="bloc"><h2>Confidentialité et stockage</h2>
      <p>Tes données sont enregistrées uniquement dans la base locale de ce navigateur sur cet appareil. Aucune donnée n'est envoyée sur Internet : le rapport PDF est calculé ici, sans service externe. Le seul échange réseau facultatif est l'abonnement aux notifications push, qui ne contient aucune donnée de santé.</p>
      <p class="encre-2">Protection contre l'effacement automatique par le navigateur : <strong>${persiste === null ? 'inconnue' : persiste ? 'active' : 'non accordée'}</strong>${estimation && estimation.usage ? `, espace utilisé : ${C.nombreFr(estimation.usage / 1024, 0)} Ko` : ''}.</p>
      ${persiste === false ? '<p><button type="button" class="bouton-secondaire" data-action="persister">Demander la protection du stockage</button></p>' : ''}
      <p class="doux">Adresse de l'application : ${esc(adresse)}</p>
      <p class="doux">Version ${C.VERSION_APP}. Fuseau horaire : Europe/Luxembourg (heure d'été et d'hiver automatiques).</p>
    </div>

    <div class="bloc"><h2>Effacer les données de cet appareil</h2>
      <p>Supprime définitivement toutes les évaluations, motifs, réglages et instantanés de cet appareil. Une sauvegarde JSON est téléchargée juste avant.</p>
      <button type="button" class="bouton-secondaire" data-action="tout-effacer">Effacer toutes les données…</button>
    </div>
  </section>`;

  contenu.querySelectorAll('[name="theme"]').forEach((r) => r.addEventListener('change', async () => { await enregistrerParametres({ theme: r.value }); appliquerTheme(r.value); }));
  document.getElementById('form-general').addEventListener('submit', async (e) => {
    e.preventDefault();
    const debutVal = document.getElementById('debut-suivi').value;
    const modifs = {
      destinataire: document.getElementById('destinataire').value.trim(),
      contactConfiance: { nom: document.getElementById('contact-nom').value.trim(), telephone: document.getElementById('contact-tel').value.trim() },
      prochaineSeance: C.estDateValide(document.getElementById('prochaine-seance').value) ? document.getElementById('prochaine-seance').value : '',
    };
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(debutVal)) modifs.debutSuiviUtc = new Date(C.localVersUtc(debutVal.slice(0, 10), debutVal.slice(11))).toISOString();
    await enregistrerParametres(modifs);
    majBoutonPdf();
    annoncer('Réglages enregistrés.');
  });
  document.getElementById('rappels-internes').addEventListener('change', async (e) => {
    if (e.target.checked) {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { e.target.checked = false; annoncer('Notifications refusées : autorise-les dans les réglages du navigateur.'); return; }
      await enregistrerParametres({ rappelsDansApplication: true });
      annoncer('Rappels activés tant que l\'application est ouverte.');
    } else await enregistrerParametres({ rappelsDansApplication: false });
    planifierRappelsInternes();
  });
  document.getElementById('rappel-discret').addEventListener('change', (e) => enregistrerParametres({ titreRappelDiscret: e.target.checked }));
  document.getElementById('fichier-import').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) importerFichier(f); });
  brancherIA();
  if (section) { const el = document.getElementById(section); if (el) setTimeout(() => el.scrollIntoView({ block: 'start' }), 50); }
}

function blocIA() {
  const ia = { ...C.parametresParDefaut().ia, ...(etat.parametres.ia || {}) };
  const pret = iaPrete();
  const serv = etat.parametres.serveurRappels || {};
  return `<form class="bloc" id="ia" autocomplete="off"><h2>Version professionnelle automatique</h2>
    <p>Après chaque évaluation commentée, ton texte est envoyé à un service d'intelligence artificielle qui prépare une version corrigée, raccourcie et rédigée dans un style professionnel pour ${esc((etat.parametres.destinataire || '').trim() || 'ton thérapeute')}. L'écran de validation s'ouvre aussitôt : tu valides ou tu modifies. Ton texte original reste intact.</p>
    <p class="encre-2">État : <strong>${pret ? `activée avec ${esc(FOURNISSEURS[ia.fournisseur].nom)} depuis le ${C.formatDateHeure(ia.consentementUtc)}` : 'désactivée'}</strong>.</p>
    <fieldset class="champ"><legend style="font-weight:600;margin-bottom:6px">Service utilisé</legend>
      <label class="interrupteur"><input type="radio" name="ia-fournisseur" value="anthropic" ${ia.fournisseur === 'anthropic' ? 'checked' : ''}> <span>Claude, d'Anthropic <span class="doux">– recommandé : le plus simple, directement depuis l'iPhone ou le PC ; quelques centimes par évaluation</span></span></label>
      <details class="repli" ${ia.fournisseur === 'serveur' ? 'open' : ''}><summary>Autre service</summary>
        <label class="interrupteur"><input type="radio" name="ia-fournisseur" value="serveur" ${ia.fournisseur === 'serveur' ? 'checked' : ''}> <span>Mistral AI (France) <span class="doux">– nécessite ton propre serveur européen avec une clé Mistral (voir serveur-rappels)</span></span></label>
      </details>
    </fieldset>
    <div class="champ" data-ia-anthropic ${ia.fournisseur === 'anthropic' ? '' : 'hidden'}><label for="ia-cle">Clé d'accès Claude</label>
      <input type="password" id="ia-cle" value="${esc(ia.cle)}" placeholder="sk-ant-…" spellcheck="false" autocapitalize="off">
      <small class="doux">À créer dans la Claude Console (console.anthropic.com, rubrique API Keys), après avoir ajouté un petit crédit. Elle reste sur cet appareil et n'est jamais incluse dans les sauvegardes. Fixe une limite de dépense mensuelle dans la Console.</small></div>
    <details class="repli" data-ia-anthropic ${ia.fournisseur === 'anthropic' ? '' : 'hidden'}><summary>Réglage avancé</summary>
      <div class="champ"><label for="ia-modele">Modèle</label><input type="text" id="ia-modele" value="${esc(ia.modele)}" spellcheck="false" autocapitalize="off"></div></details>
    <fieldset class="champ"><legend style="font-weight:600;margin-bottom:6px">Style de la version</legend><div class="segmente">
      <label><input type="radio" name="ia-personne" value="troisieme" ${ia.personne !== 'premiere' ? 'checked' : ''}><span>« Le patient… »</span></label>
      <label><input type="radio" name="ia-personne" value="premiere" ${ia.personne === 'premiere' ? 'checked' : ''}><span>« Je… »</span></label>
    </div></fieldset>
    <label class="interrupteur"><input type="checkbox" id="ia-auto" ${ia.automatique ? 'checked' : ''}> <span>Préparer automatiquement après chaque évaluation</span></label>
    <div class="bandeau" style="margin-top:14px"><strong>Ton accord</strong>
      <label class="interrupteur" style="margin-top:6px"><input type="checkbox" id="ia-accord" ${pret ? 'checked' : ''}> <span>J'accepte que le texte de mes commentaires soit envoyé au service choisi ci-dessus pour préparer ces versions. Ni mon nom, ni mes notes, ni les dates ne sont envoyés, mais mes textes peuvent eux-mêmes contenir des informations personnelles. Je peux retirer cet accord à tout moment.</span></label></div>
    <div class="rangee">
      <button type="submit" class="bouton">Enregistrer et tester</button>
      ${pret ? '<button type="button" class="bouton-discret" id="ia-desactiver">Désactiver et retirer mon accord</button>' : ''}
    </div>
    <p class="doux" id="ia-resultat" style="margin-top:10px"></p>
  </form>`;
}

function brancherIA() {
  const form = document.getElementById('ia');
  if (!form) return;
  form.querySelectorAll('[name="ia-fournisseur"]').forEach((r) => r.addEventListener('change', () => {
    form.querySelectorAll('[data-ia-anthropic]').forEach((el) => { el.hidden = r.value !== 'anthropic'; });
  }));
  const bDes = document.getElementById('ia-desactiver');
  if (bDes) bDes.addEventListener('click', async () => {
    await enregistrerParametres({ ia: { ...etat.parametres.ia, actif: false, consentementUtc: null, consentementFournisseur: '' } });
    annoncer('Préparation automatique désactivée : plus aucun texte ne sera envoyé.');
    vueReglages(['ia']);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = document.getElementById('ia-resultat');
    const fournisseur = form.querySelector('[name="ia-fournisseur"]:checked').value;
    const accord = document.getElementById('ia-accord').checked;
    const ancien = etat.parametres.ia || {};
    const ia = {
      ...C.parametresParDefaut().ia, ...ancien,
      fournisseur,
      cle: document.getElementById('ia-cle').value.trim(),
      modele: document.getElementById('ia-modele').value.trim() || 'claude-sonnet-5-5',
      personne: form.querySelector('[name="ia-personne"]:checked').value,
      automatique: document.getElementById('ia-auto').checked,
    };
    if (!accord) {
      await enregistrerParametres({ ia: { ...ia, actif: false, consentementUtc: null, consentementFournisseur: '' } });
      res.textContent = 'Réglages enregistrés. Sans ton accord coché, aucun texte n\'est envoyé.';
      return;
    }
    if (fournisseur === 'anthropic' && !ia.cle) { res.textContent = 'Saisis d\'abord ta clé d\'accès Claude.'; return; }
    if (fournisseur === 'serveur' && !(etat.parametres.serveurRappels && etat.parametres.serveurRappels.url)) { res.textContent = 'Configure d\'abord l\'adresse et le jeton de ton serveur (rubrique Rappels).'; return; }
    const nouveau = { ...ia, actif: true, consentementUtc: ancien.consentementFournisseur === fournisseur && ancien.consentementUtc ? ancien.consentementUtc : new Date(maintenant()).toISOString(), consentementFournisseur: fournisseur };
    await enregistrerParametres({ ia: nouveau });
    res.textContent = 'Test en cours avec une phrase d\'exemple…';
    const { reformuler, trouverModele } = await import('./ia.js');
    const exemple = C.creerEvaluation({ date: aujourdhui(), creneau: 'matin', note: 5, explication: 'je me sent un peu fatiguer aujourdhui mais sa va quand meme, jai bien dormi' });
    try {
      let r;
      try { r = await reformuler(etat.parametres, [exemple]); } catch (err) {
        if (fournisseur !== 'anthropic' || !/Modèle introuvable/.test(err.message)) throw err;
        const modele = await trouverModele(ia.cle);
        if (!modele) throw err;
        await enregistrerParametres({ ia: { ...etat.parametres.ia, modele } });
        document.getElementById('ia-modele').value = modele;
        r = await reformuler(etat.parametres, [exemple]);
      }
      const p = r.propositions[0];
      res.innerHTML = p ? `Test réussi. Exemple : « je me sent un peu fatiguer aujourdhui mais sa va quand meme, jai bien dormi » devient « ${esc(p.explication)} ». La préparation automatique est active.` : 'Le service a répondu, mais sans proposition exploitable. Réessaie.';
      annoncer('Préparation automatique activée.');
      rattrapageVersions().catch(() => {});
    } catch (err) {
      res.textContent = `Le test a échoué : ${err.message} La préparation reste activée et sera réessayée ; corrige le réglage si besoin.`;
    }
  });
}

async function actionReglage(action, id) {
  const p = etat.parametres;
  const adresse = location.href.split('#')[0].split('?')[0];
  try {
    switch (action) {
      case 'script-windows':
        telecharger(new Blob([C.genererScriptWindows(adresse, { discret: p.titreRappelDiscret })], { type: 'application/octet-stream' }), 'Rappels-Barometre-humeur.cmd');
        break;
      case 'calendrier-ics':
        await livrer(new Blob([C.genererICS(adresse, { discret: p.titreRappelDiscret })], { type: 'text/calendar' }), 'rappels-barometre-humeur.ics');
        break;
      case 'serveur-activer':
        await activerServeur(document.getElementById('serveur-url').value.trim(), document.getElementById('serveur-jeton').value.trim());
        annoncer('Notifications push activées sur cet appareil.');
        vueReglages();
        break;
      case 'serveur-desactiver':
        await desactiverServeur(); annoncer('Notifications push désactivées.'); vueReglages();
        break;
      case 'serveur-tester':
        await testerServeur(); annoncer('Notification de test demandée au serveur.');
        break;
      case 'choisir-dossier': await choisirDossier(); break;
      case 'autoriser-dossier': await sauvegardeAutomatique(true); annoncer(ui.alerteDossier ? 'Copie impossible : autorisation refusée.' : 'Copie écrite dans le dossier.'); router(); break;
      case 'oublier-dossier': await DB.supprimer('poignees', 'dossier'); ui.alerteDossier = false; vueReglages(); break;
      case 'persister': await navigator.storage.persist(); vueReglages(); break;
      case 'instantane-telecharger': {
        const s = await DB.lire('instantanes', id);
        if (s) await livrer(new Blob([JSON.stringify(s.donnees, null, 2)], { type: 'application/json' }), `barometre-humeur_instantane_${s.id.slice(0, 16).replace(/:/g, '-')}.json`);
        break;
      }
      case 'instantane-restaurer': {
        const s = await DB.lire('instantanes', id);
        if (!s) return;
        const ok = await confirmer('Restaurer cet instantané ?', `Les données actuelles seront remplacées par celles du ${esc(C.formatDateHeure(s.creeLeUtc))} (${C.pluriel(s.nombre, 'évaluation')}). Une copie de l'état actuel est d'abord conservée.`, 'Restaurer');
        if (!ok) return;
        await prendreInstantane('Avant restauration d\'un instantané');
        const d = C.lireJSON(s.donnees);
        await DB.remplacerTout({ evaluations: d.evaluations, motifs: d.motifs, parametres: { ...C.parametresParDefaut(), ...d.parametres }, archives: d.archives });
        await chargerEtat();
        appliquerTheme(etat.parametres.theme); majBoutonPdf();
        annoncer('Instantané restauré.');
        vueReglages();
        break;
      }
      case 'archive-restaurer': {
        const a = etat.archives.find((x) => x.id === id);
        if (!a) return;
        if (parCreneau().has(a.evaluation.creneauId)) { annoncer('Ce créneau a déjà une évaluation : retire-la d\'abord pour restaurer celle-ci.'); return; }
        await DB.restaurerArchive(a);
        await chargerEtat();
        annoncer('Évaluation restaurée.');
        vueReglages();
        break;
      }
      case 'tout-effacer': {
        const r = await dialogue(`<h2 id="dialogue-titre">Effacer toutes les données ?</h2>
          <p>Cette action est définitive sur cet appareil. Une sauvegarde JSON va d'abord être téléchargée.</p>
          <div class="champ"><label for="confirmation">Tape EFFACER pour confirmer</label><input type="text" id="confirmation" name="confirmation" autocomplete="off" required pattern="EFFACER" autofocus></div>
          <div class="dialogue-actions"><button class="bouton-secondaire" value="non" formnovalidate>Annuler</button><button class="bouton" value="oui">Effacer</button></div>`);
        if (r.valeur !== 'oui' || r.donnees.get('confirmation') !== 'EFFACER') return;
        telecharger(new Blob([JSON.stringify(exportComplet(), null, 2)], { type: 'application/json' }), `barometre-humeur_avant-effacement_${aujourdhui()}.json`);
        await DB.toutEffacer();
        await chargerEtat();
        majBoutonPdf();
        aller('#/');
        break;
      }
      default: break;
    }
  } catch (e) {
    annoncer(/failed to fetch|load failed|networkerror/i.test(e.message) ? 'Service injoignable : vérifie l\'adresse et ta connexion Internet.' : e.message);
  }
}

// ---------------------------------------------------------------------------
// Événements globaux

document.addEventListener('click', (e) => {
  const cible = e.target.closest('[data-action]');
  if (!cible) return;
  const { action, id } = cible.dataset;
  if (action === 'ouvrir-pdf') { e.preventDefault(); ouvrirPdf(); return; }
  if (action === 'aide') { e.preventDefault(); ouvrirAide(); return; }
  if (action === 'masquer-mise-en-route') { enregistrerParametres({ miseEnRouteMasquee: true }).then(() => router()); return; }
  if (action === 'demarrer-vide') { initialiser().then(() => { annoncer('Suivi démarré.'); aller('#/'); }); return; }
  if (action === 'retirer') { retirerEvaluation(id); return; }
  if (action === 'mettre-a-jour') { if (ui.majDisponible) { ui.majDemandee = true; ui.majDisponible.postMessage({ type: 'activer' }); } return; }
  if (action.startsWith('motif-')) { actionMotif(action, id); return; }
  if (action === 'exporter-json') { exporter('json').then(() => router()); return; }
  if (action === 'exporter-csv-evaluations') { exporter('csv-evaluations'); return; }
  if (action === 'exporter-csv-motifs') { exporter('csv-motifs'); return; }
  actionReglage(action, id);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && etat.parametres) {
    majBadge();
    planifierRappelsInternes();
    const h = location.hash;
    if (h === '' || h === '#/' || h === '#') vueAccueil();
  }
});

function enregistrerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const signaler = (w) => { ui.majDisponible = w; annoncer('Une nouvelle version est prête.', { libelle: 'Mettre à jour', faire: () => { ui.majDemandee = true; w.postMessage({ type: 'activer' }); } }); };
    if (reg.waiting && navigator.serviceWorker.controller) signaler(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) signaler(w); });
    });
    setInterval(() => reg.update().catch(() => {}), 6 * 3600 * 1000);
  }).catch((e) => console.warn('Service worker non enregistré', e));
  // Rechargement uniquement après une mise à jour demandée (jamais lors de la première installation)
  let recharge = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (ui.majDemandee && !recharge) { recharge = true; location.reload(); } });
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'ouvrir' && e.data.url) {
      const u = new URL(e.data.url, location.href);
      history.replaceState(null, '', u.pathname + u.search);
      traiterParametresURL();
      router();
    }
  });
}

async function demarrer() {
  try {
    await chargerEtat();
  } catch (e) {
    contenu.innerHTML = `<div class="erreurs"><p><strong>La base de données locale n'a pas pu être ouverte.</strong></p><p>${esc(e.message)}</p><p>Vérifie que le navigateur n'est pas en navigation privée et qu'il autorise le stockage pour ce site.</p></div>`;
    return;
  }
  if (etat.parametres) appliquerTheme(etat.parametres.theme);
  majBoutonPdf();
  traiterParametresURL();
  window.addEventListener('hashchange', router);
  router();
  enregistrerServiceWorker();
  if (etat.parametres) {
    instantaneQuotidien().catch((e) => console.warn(e));
    rattrapageVersions().catch((e) => console.warn(e));
    window.addEventListener('online', () => rattrapageVersions().catch((e) => console.warn(e)));
    planifierRappelsInternes();
    majBadge();
  }
  // Redessine le graphique si la largeur de la fenêtre change nettement
  let largeur = window.innerWidth, attente = null;
  window.addEventListener('resize', () => {
    clearTimeout(attente);
    attente = setTimeout(() => {
      const h = location.hash;
      if (Math.abs(window.innerWidth - largeur) > 40 && etat.parametres && (h === '' || h === '#/' || h === '#')) { largeur = window.innerWidth; vueAccueil(); }
    }, 250);
  });
  // Rafraîchit l'accueil à chaque changement de créneau
  setInterval(() => { const h = location.hash; if (etat.parametres && (h === '' || h === '#/' || h === '#')) vueAccueil(); }, 5 * 60 * 1000);
}

demarrer();
