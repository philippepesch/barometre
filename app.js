// Baromètre de l'humeur — interface
import * as C from './core.js';
import * as DB from './db.js';
import { FOURNISSEURS } from './ia.js';
import * as S from './sync.js';
import * as L from './lieux.js';
import { iconeMeteo } from './meteo.js';

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
const seances = () => C.seancesDepuisParametres(etat.parametres || {});

/** Enregistre la liste des séances (et l'ancien champ « prochaineSeance » pour les appareils pas encore à jour). */
async function enregistrerSeances(liste) {
  const triees = C.trierSeances(liste);
  const proch = C.prochaineSeance(triees, maintenant());
  await enregistrerParametres({ seances: triees, prochaineSeance: proch ? proch.date : '' });
}

/** Fenêtre d'ajout ou de modification d'une séance. Retourne la séance enregistrée, ou null. */
async function dialogueSeance(existante = null) {
  const dest = (etat.parametres.destinataire || '').trim() || 'ton thérapeute';
  for (;;) {
    const r = await dialogue(`<h2 id="dialogue-titre">${existante ? 'Modifier la séance' : `Prochaine séance avec ${esc(dest)}`}</h2>
      <div class="champ"><label for="s-date">Date</label><input type="date" id="s-date" name="date" value="${esc(existante ? existante.date : '')}" required autofocus></div>
      <div class="rangee" style="align-items:flex-start">
        <div class="champ" style="flex:1;min-width:120px"><label for="s-debut">De</label><input type="time" id="s-debut" name="debut" value="${esc(existante ? existante.debut : '')}" step="300"></div>
        <div class="champ" style="flex:1;min-width:120px"><label for="s-fin">À</label><input type="time" id="s-fin" name="fin" value="${esc(existante ? existante.fin : '')}" step="300"></div>
      </div>
      <p class="doux">Heure de Luxembourg. Les heures sont facultatives.</p>
      <div class="dialogue-actions"><button class="bouton-secondaire" value="non" formnovalidate>Annuler</button><button class="bouton" value="oui">Enregistrer</button></div>`);
    if (r.valeur !== 'oui') return null;
    try {
      const sea = C.normaliserSeance({ id: existante ? existante.id : undefined, date: r.donnees.get('date'), debut: r.donnees.get('debut'), fin: r.donnees.get('fin') });
      const liste = seances().filter((x) => x.id !== sea.id);
      await enregistrerSeances([...liste, sea]);
      annoncer(`Séance enregistrée : ${C.libelleSeance(sea)}.`);
      return sea;
    } catch (e) {
      annoncer(e.message);
      existante = { id: existante ? existante.id : undefined, date: r.donnees.get('date') || '', debut: r.donnees.get('debut') || '', fin: r.donnees.get('fin') || '' };
    }
  }
}
const motifParId = () => new Map(etat.motifs.map((m) => [m.id, m]));
const motifsActifs = () => etat.motifs.filter((m) => m.actif && !m.regroupeDans)
  .sort((a, b) => C.POLARITES.indexOf(a.polarite) - C.POLARITES.indexOf(b.polarite) || (a.ordre ?? 0) - (b.ordre ?? 0) || a.libelle.localeCompare(b.libelle, 'fr'));

async function enregistrerParametres(modifs) {
  const partage = Object.keys(modifs).some((k) => C.PARAMETRES_PARTAGES.includes(k));
  if (partage) modifs = { ...modifs, reglagesModifiesLeUtc: new Date(maintenant()).toISOString() };
  etat.parametres = { ...etat.parametres, ...modifs };
  await DB.ecrireParametres(modifs);
  if (partage) planifierSynchro();
}

async function enregistrerEvaluation(ev) {
  await DB.mettre('evaluations', ev);
  const i = etat.evaluations.findIndex((e) => e.id === ev.id);
  if (i >= 0) etat.evaluations[i] = ev; else etat.evaluations.push(ev);
  majBadge();
  sauvegardeAutomatique();
  planifierSynchro();
}

async function enregistrerMotif(m) {
  await DB.mettre('motifs', m);
  const i = etat.motifs.findIndex((x) => x.id === m.id);
  if (i >= 0) etat.motifs[i] = m; else etat.motifs.push(m);
  planifierSynchro();
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
  calendrier: vueCalendrier, motifs: vueMotifs, reglages: vueReglages, textes: vueTextes, contexte: vueContexte,
};

/** Incrémenté à chaque changement d'écran : une vue lente (asynchrone) ne doit pas recouvrir l'écran demandé ensuite. */
let numeroVue = 0;

function router() {
  numeroVue += 1;
  const morceaux = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  const [route, ...args] = morceaux;
  document.body.classList.toggle('sans-navigation', !etat.parametres);
  if (!etat.parametres) { vueBienvenue(); marquerOnglet(''); return; }
  const vue = VUES[route] || vueAccueil;
  marquerOnglet(['modifier', 'evaluation', 'textes', 'contexte'].includes(route) ? '' : route);
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
    <p>Deux fois par jour, à 06:00 et à 18:00, tu notes ton humeur de 0 à 10, ce qui l'explique, et ce que tu prévois pour la suite. Les données sont enregistrées sur cet appareil : aucun compte, aucune publicité. La synchronisation avec ton autre appareil est facultative et chiffrée.</p>
    <div class="bloc">
      <h2>Démarrer</h2>
      <p>Si tu as reçu le fichier <strong>donnees-initiales.json</strong> (tes motifs personnels et ta première évaluation), importe-le maintenant. Si tu as une sauvegarde, tu peux aussi la restaurer ici.</p>
      <div class="rangee">
        <button type="button" class="bouton" data-action="demarrer-synchro">Récupérer mes données depuis mon autre appareil</button>
        <label class="bouton-secondaire" for="fichier-depart">Importer un fichier</label>
        <input type="file" id="fichier-depart" accept=".json,.csv,application/json,text/csv" class="visuellement-cache">
        <button type="button" class="bouton-discret" data-action="demarrer-vide">Commencer sans fichier</button>
      </div>
      <p class="doux" style="margin-top:12px">Le suivi commencera maintenant : les créneaux antérieurs seront marqués « non renseigné », jamais remplis automatiquement.</p>
    </div>
    ${!estInstallee() ? `<div class="bandeau"><strong>Conseil</strong>${estIOS ? 'Sur iPhone, ajoute d\'abord l\'application à l\'écran d\'accueil (bouton Partager, puis « Sur l\'écran d\'accueil ») et ouvre-la depuis cette icône : ses données sont distinctes de celles de Safari.' : 'Installe l\'application (icône d\'installation dans la barre d\'adresse d\'Edge ou de Chrome) pour l\'ouvrir comme un programme et recevoir les rappels.'}</div>` : ''}
  </section>`;
  document.getElementById('fichier-depart').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
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
    blocHumeur = `<div class="humeur-actuelle"><span class="lecture-icone">${iconeMeteo(derniere.note, { taille: 56, titre: derniere.niveau })}</span><span class="lecture-note">${derniere.note}</span><span class="lecture-sur">/10</span><span class="lecture-nom">${esc(derniere.niveau)}</span></div>
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
    ${bandeauContexte()}
    ${rappelSauvegarde ? `<div class="bandeau rangee-espacee"><span>${esc(rappelSauvegarde)}</span><button class="bouton-secondaire" data-action="exporter-json">Sauvegarder maintenant</button></div>` : ''}
    <div class="grille-2">
      <div>
        <section class="bloc maintenant" aria-label="Évaluation en cours">${blocMaintenant}${ligneProchaineSeance()}</section>
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
  const sync = synchroActive();
  if (rappels && ia && sync) return '';
  const ligne = (fait, texte, lien) => `<li><span>${fait ? ICONES_STATUT.repondu : ICONES_STATUT.a_venir} ${texte}</span>${fait ? '<span class="doux">fait</span>' : `<a class="bouton-discret" href="${lien}">Configurer</a>`}</li>`;
  return `<section class="bloc" aria-label="Mise en route"><div class="rangee-espacee"><h2 style="margin:0">Mise en route</h2><button type="button" class="bouton-discret" data-action="masquer-mise-en-route">Masquer</button></div>
    <ul class="liste-simple liste-etapes">
      ${ligne(rappels, 'Notifications à 06:00 et 18:00 sur cet appareil', '#/reglages/rappels')}
      ${ligne(ia, 'Version professionnelle automatique pour le thérapeute', '#/reglages/ia')}
      ${ligne(sync, 'Synchronisation avec ton autre appareil', '#/reglages/synchro')}
    </ul></section>`;
}

function bandeauContexte() {
  if (etat.parametres.contexteBandeauMasque) return '';
  const n = etat.evaluations.filter((e) => !e.lieu && !e.situation).length;
  if (!n) return '';
  return `<div class="bandeau bandeau-laiton rangee-espacee"><span><strong>Nouveau : lieu et situation professionnelle</strong>${n > 1 ? `${n} évaluations passées n'ont` : 'Une évaluation passée n\'a'} pas encore ces informations. Tu peux les compléter en quelques gestes, période par période.</span>
    <span class="rangee"><a class="bouton-secondaire" href="#/contexte">Compléter</a><button type="button" class="bouton-discret" data-action="masquer-contexte">Plus tard</button></span></div>`;
}

function bandeauSeance() {
  const p = etat.parametres;
  const dest = (p.destinataire || '').trim() || 'ton thérapeute';
  const liste = seances();
  const proch = C.prochaineSeance(liste, maintenant());
  if (!proch) {
    const passee = C.seancesPassees(liste, maintenant())[0];
    if (!passee) return '';
    return `<div class="bandeau rangee-espacee"><span>Ta séance du ${esc(C.libelleSeance(passee, { court: true }))} est passée. Indique la prochaine séance avec ${esc(dest)}.</span><button type="button" class="bouton-secondaire" data-action="ajouter-seance">Ajouter la prochaine séance</button></div>`;
  }
  const seance = proch.date;
  const auj = aujourdhui();
  const veille = C.ajouterJours(seance, -1);
  if (auj !== seance && auj !== veille) return '';
  const dr = p.dernierRapport;
  if (dr && dr.genereLeUtc && C.dateLocale(Date.parse(dr.genereLeUtc)) >= veille) return '';
  const heure = proch.debut ? ` à ${proch.debut.replace(':', ' h ').replace(/ h 00$/, ' h').replace(/^0/, '')}` : '';
  return `<div class="bandeau bandeau-laiton rangee-espacee"><span>Séance avec ${esc(dest)} ${auj === seance ? 'aujourd\'hui' : 'demain'}${heure} : prépare ton rapport.</span><button type="button" class="bouton" data-action="ouvrir-pdf">Générer le rapport</button></div>`;
}

function ligneProchaineSeance() {
  const proch = C.prochaineSeance(seances(), maintenant());
  if (!proch) return '';
  const dest = (etat.parametres.destinataire || '').trim() || 'ton thérapeute';
  return `<p class="etat-creneau">Prochaine séance avec ${esc(dest)} : <strong>${esc(C.libelleSeance(proch))}</strong>. <button type="button" class="bouton-discret" data-action="modifier-seance" data-id="${esc(proch.id)}">Modifier</button></p>`;
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
  ${blocContexte(evals)}
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

/** Humeur moyenne par lieu et par situation sur la période (descriptif, sans conclusion). */
function blocContexte(evals) {
  const manquants = etat.evaluations.filter((e) => !e.lieu || !e.situation).length;
  const lienCompleter = manquants ? `<p style="margin:12px 0 0"><a class="bouton-secondaire" href="#/contexte">Compléter les évaluations passées</a> <span class="doux">${C.pluriel(manquants, 'évaluation')} sans lieu ou sans situation</span></p>` : '';
  if (!evals.some((e) => e.lieu || e.situation)) {
    return `<section class="bloc" aria-labelledby="titre-contexte"><h2 id="titre-contexte">Humeur selon le lieu et la situation</h2>
      <p class="doux">Aucun lieu ni aucune situation professionnelle indiqués sur la période. Ces informations se renseignent en bas de chaque évaluation.</p>${lienCompleter}</section>`;
  }
  const coul = couleursContexte();
  const table = (titre, r, couleur) => {
    if (!r.lignes.length) return `<div><h3>${titre}</h3><p class="doux">Rien d'indiqué sur la période.</p></div>`;
    return `<div><h3>${titre}</h3><div class="defile"><table class="donnees"><thead><tr><th>${titre}</th><th class="nombre">Évaluations</th><th class="nombre">Moyenne</th><th class="nombre">Min – max</th></tr></thead><tbody>
      ${r.lignes.map((l) => `<tr><td><i class="pastille-cat" style="background:${couleur(l.valeur)};margin-right:8px"></i>${esc(l.libelle)}</td><td class="nombre">${l.nombre}</td>
        <td class="nombre" style="white-space:nowrap">${C.nombreFr(l.moyenne)}<span class="moyenne-barre" aria-hidden="true"><i style="width:${l.moyenne * 10}%;background:var(--n${Math.round(l.moyenne)})"></i></span></td><td class="nombre">${l.min} – ${l.max}</td></tr>`).join('')}
      </tbody></table></div>
      ${r.sansValeur ? `<p class="doux" style="margin-top:6px">${C.pluriel(r.sansValeur, 'évaluation')} sans cette information.</p>` : ''}</div>`;
  };
  const pl = C.humeurParLieu(evals);
  const ps = C.humeurParSituation(evals);
  const pa = C.humeurParActivite(evals);
  const peu = [...pl.lignes, ...ps.lignes].some((l) => l.nombre < 4);
  return `<section class="bloc" aria-labelledby="titre-contexte"><h2 id="titre-contexte">Humeur selon le lieu et la situation</h2>
    <p class="doux">Moyenne de tes notes pour chaque lieu et chaque situation de la période. Ce sont des constats, pas des causes : d'autres facteurs peuvent jouer.${peu ? ' Avec moins de 4 évaluations, une moyenne est peu représentative.' : ''}</p>
    <div class="grille-2" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">${table('Lieu', pl, coul.lieu)}${table('Situation', ps, coul.situation)}${pa.lignes.length ? table('Activité', { ...pa, sansValeur: 0 }, () => 'var(--filet-fort)') : ''}</div>
    ${lienCompleter}</section>`;
}

// Couleurs des lieux : ordre stable (fréquence sur tout le suivi), 5 couleurs puis « autres lieux » en gris.
const NB_COULEURS_LIEUX = 5;
function couleursContexte() {
  const ordre = C.ordreLieux(etat.evaluations);
  return {
    ordre,
    lieu: (l) => { const i = ordre.indexOf(C.cleLieu(l)); return i >= 0 && i < NB_COULEURS_LIEUX ? `var(--cat${i + 1})` : 'var(--cat-autre)'; },
    situation: (x) => `var(--cat${C.ORDRE_SITUATIONS.indexOf(x.statut) + 1})`,
  };
}

/** Légende d'une bande : les catégories présentes sur la période, dans l'ordre des couleurs. */
function legendeContexte(titre, evals, extraire, cle, libelle, couleur, ordre) {
  const vus = new Map();
  let vide = false;
  for (const e of evals) {
    const vs = [].concat(extraire(e) || []).filter(Boolean);
    if (!vs.length) { vide = true; continue; }
    for (const v of vs) if (!vus.has(cle(v))) vus.set(cle(v), v);
  }
  if (!vus.size) return '';
  const items = [...vus.values()].sort((a, b) => ordre(a) - ordre(b));
  const autres = items.filter((v) => couleur(v) === 'var(--cat-autre)');
  const nommes = items.filter((v) => couleur(v) !== 'var(--cat-autre)');
  return `<div class="legende-contexte"><span class="titre">${titre} :</span>${nommes.map((v) => `<span><i class="pastille-cat" style="background:${couleur(v)}"></i>${esc(libelle(v))}</span>`).join('')}
    ${autres.length ? `<span><i class="pastille-cat" style="background:var(--cat-autre)"></i>${autres.length === 1 ? esc(libelle(autres[0])) : `Autres lieux (${autres.map((v) => esc(libelle(v))).join(', ')})`}</span>` : ''}
    ${vide ? '<span><i class="pastille-cat vide"></i>Non indiqué</span>' : ''}</div>`;
}

function graphiqueHTML(grille, prev) {
  const avecContexte = grille.some((s) => s.evaluation && (s.evaluation.lieu || s.evaluation.situation));
  const W = Math.round(Math.max(320, Math.min(760, (contenu.clientWidth || 760) - 40))), H0 = W < 500 ? 220 : 250, H = H0 + (avecContexte ? 62 : 0), g = 30, d = 10, h = 14, b = 44 + (avecContexte ? 62 : 0);
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
  // Bandes « Lieu » et « Situation » sous les dates : un segment par suite de créneaux identiques
  const coul = couleursContexte();
  if (avecContexte) {
    const demi = n > 1 ? (x(1) - x(0)) / 2 : 8;
    const bande = (titre, y0, extraire, cle, couleur) => {
      svg += `<text class="bande-titre" x="${g}" y="${y0}">${titre}</text>`;
      const yb = y0 + 5, hb = 11;
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
        const x0 = Math.max(g, i === 0 ? x(0) - demi : (x(i - 1) + x(i)) / 2);
        const x1 = Math.min(W - d, j === n - 1 ? x(n - 1) + demi : (x(j) + x(j + 1)) / 2);
        const vs = valeursDe(grille[i]);
        if (vs.length > 1) {
          const l = (x1 - x0 - 2) / vs.length;
          vs.forEach((v, q) => { svg += `<rect class="segment" x="${(x0 + 1 + q * l).toFixed(1)}" y="${yb}" width="${Math.max(1, l - 0.8).toFixed(1)}" height="${hb}" rx="1.5" fill="${couleur(v)}"/>`; });
        } else svg += `<rect class="segment" x="${(x0 + 1).toFixed(1)}" y="${yb}" width="${Math.max(1.5, x1 - x0 - 2).toFixed(1)}" height="${hb}" rx="2.5" fill="${vs.length ? couleur(vs[0]) : 'url(#hachures)'}"/>`;
        i = j + 1;
      }
    };
    const yb0 = H0 - 44 + 30 + 22;
    svg = `<defs><pattern id="hachures" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="var(--surface)"/><line x1="0" y1="0" x2="0" y2="5" stroke="var(--filet-fort)" stroke-width="1.6"/></pattern></defs>${svg}`;
    bande('Lieu', yb0, C.lieuxDe, C.cleLieu, coul.lieu);
    bande('Situation', yb0 + 30, (e) => e.situation, C.cleSituation, coul.situation);
  }
  svg += '<line class="curseur-vertical" x1="0" x2="0" y1="0" y2="0" visibility="hidden"/>';
  donneesGraphique = { grille, x, W, H, prevParCible, haut: h, bas: H0 - 44 };
  const nbRep = grille.filter((s) => s.evaluation).length;
  const tableau = grille.filter((s) => s.evaluation || s.statut === 'omis').map((s) => `<tr><td>${esc(C.formatDateCourte(s.date))}</td><td>${s.creneau}</td><td>${s.evaluation ? esc(C.libelleNote(s.evaluation.note)) : 'omis'}</td>${avecContexte ? `<td>${s.evaluation && s.evaluation.lieu ? esc(C.libelleLieux(C.lieuxDe(s.evaluation))) : '—'}</td><td>${s.evaluation && s.evaluation.situation ? esc(C.libelleSituation(s.evaluation.situation)) : '—'}</td>` : ''}</tr>`).join('');
  const evalsGrille = grille.filter((s) => s.evaluation).map((s) => s.evaluation);
  const ordreLieu = (l) => { const i = coul.ordre.indexOf(C.cleLieu(l)); return i < 0 ? 999 : i; };
  const legendes = avecContexte ? `${legendeContexte('Lieu', evalsGrille, C.lieuxDe, C.cleLieu, (l) => C.libelleLieu(l), coul.lieu, ordreLieu)}
    ${legendeContexte('Situation', evalsGrille, (e) => e.situation, (x) => x.statut, (x) => C.SITUATIONS[x.statut], coul.situation, (x) => C.ORDRE_SITUATIONS.indexOf(x.statut))}` : '';
  return `<div class="graphique" id="graphique">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe de ${nbRep} notes sur la période">${svg}</svg>
    </div>
    <div class="legende">
      <span><svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5" fill="var(--doux)"/></svg>Matin</span>
      <span><svg viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" rx="1.5" fill="var(--doux)"/></svg>Soir</span>
      <span><svg viewBox="0 0 14 14"><path d="M7 1.5L12.5 7L7 12.5L1.5 7Z" fill="none" stroke="var(--laiton)" stroke-width="1.6"/></svg>Note prévue</span>
      <span><svg viewBox="0 0 14 14"><path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="var(--doux)" stroke-width="1.6"/></svg>Créneau omis</span>
    </div>
    ${legendes}
    ${tableau ? `<details class="repli" style="margin-top:8px"><summary>Afficher les données en tableau</summary><div class="defile"><table class="donnees"><thead><tr><th>Date</th><th>Créneau</th><th>Note</th>${avecContexte ? '<th>Lieu</th><th>Situation</th>' : ''}</tr></thead><tbody>${tableau}</tbody></table></div></details>` : '<p class="doux">Aucune donnée sur la période.</p>'}`;
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
    if (s.evaluation) {
      lignes.push(`<span class="ligne-meteo">${iconeMeteo(s.evaluation.note, { taille: 22 })}${esc(C.libelleNote(s.evaluation.note))}</span>`);
      if (s.evaluation.lieu) lignes.push(esc(C.libelleLieux(C.lieuxDe(s.evaluation))));
      if (s.evaluation.situation) lignes.push(esc(C.libelleSituation(s.evaluation.situation)));
    } else lignes.push(esc(C.STATUTS[s.statut]));
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
  // Contexte : valeurs de l'évaluation modifiée, sinon proposition d'après les évaluations précédentes
  const proposition = ev ? null : C.suggestionContexte(etat.evaluations, cible);
  const lieuxInitiaux = ev ? C.lieuxDe(ev) : (proposition.lieu ? [proposition.lieu] : []);
  const lieuInitial = lieuxInitiaux[0] || null;
  const situationInitiale = ev ? (ev.situation || null) : proposition.situation;
  const repris = !ev && (lieuInitial || situationInitiale);

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
        <div class="lecture" aria-live="polite"><span class="lecture-icone" id="icone-note">${s.note === null ? '' : iconeMeteo(s.note, { taille: 64 })}</span><span class="lecture-note" id="lecture-note">${s.note ?? '–'}</span><span class="lecture-sur">/10</span><span class="lecture-nom" id="lecture-nom">${s.note === null ? 'à choisir' : esc(C.nomNiveau(s.note))}</span></div>
        ${curseurHTML('note', s.note, 'Note actuelle de 0 à 10')}
        <p class="consigne" id="consigne-note" ${s.note !== null ? 'hidden' : ''}>Fais glisser ou touche le curseur pour choisir ta note.</p>
        <div class="securite" id="securite-zero" ${s.note === 0 ? '' : 'hidden'}>
          <p><strong>Merci de l'avoir indiqué.</strong> Si tu te sens en danger ou si tu penses à te faire du mal, appelle le <a href="tel:112"><strong>112</strong></a> ou parle à quelqu'un maintenant.</p>
          <p><button type="button" class="bouton-secondaire" data-action="aide">Voir les aides disponibles</button></p>
        </div>
      </div>
    </section>

    <section class="question" aria-labelledby="q4">
      <p class="question-numero">Contexte</p>
      <h2 id="q4">Où as-tu été, et quelle est ta situation ?</h2>
      <p class="doux">Indique les lieux où tu as été <strong>depuis ton évaluation précédente</strong>, soit environ les 12 dernières heures${cible.creneau === 'matin' ? ' (la soirée et la nuit)' : ' (la journée)'}. ${repris ? 'Le lieu est repris de ta dernière évaluation : vérifie et modifie si quelque chose a changé.' : 'Facultatif : cela permet de voir dans les graphiques si le lieu ou le travail influencent ton humeur.'}</p>
      ${L.champLieuxHTML(lieuxInitiaux, { activites: C.activitesConnues(etat.evaluations) })}
      ${L.champSituationHTML('situation', situationInitiale)}
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
        <div class="lecture" aria-live="polite"><span class="lecture-icone" id="icone-prev">${s.prevNote === null ? '' : iconeMeteo(s.prevNote, { taille: 64 })}</span><span class="lecture-note" id="lecture-prev">${s.prevNote ?? '–'}</span><span class="lecture-sur">/10</span><span class="lecture-nom" id="lecture-prev-nom">${s.prevNote === null ? 'facultatif' : esc(C.nomNiveau(s.prevNote))}</span></div>
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
  const champLieux = L.brancherChampLieux(form, { initial: lieuxInitiaux, connus: C.lieuxConnus(etat.evaluations), enLigne: etat.parametres.rechercheLieux !== false });
  const champSituation = L.brancherChampSituation(form, 'situation');
  const brancherCurseur = (idCurseur, idCiel, idNote, idNom, surChoix, idIcone) => {
    const c = document.getElementById(idCurseur);
    const maj = () => {
      const v = Number(c.value);
      c.classList.remove('vierge');
      document.getElementById(idCiel).classList.remove('vierge');
      document.getElementById(idCiel).style.setProperty('--ciel', `var(--n${v})`);
      document.getElementById(idNote).textContent = v;
      document.getElementById(idNom).textContent = C.nomNiveau(v);
      if (idIcone) document.getElementById(idIcone).innerHTML = iconeMeteo(v, { taille: 64 });
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
  }, 'icone-note');
  const curseurPrev = brancherCurseur('prevision', 'ciel-prev', 'lecture-prev', 'lecture-prev-nom', (v) => {
    s.prevNote = v;
    document.getElementById('btn-prev-effacer').hidden = false;
  }, 'icone-prev');
  document.getElementById('btn-prev-effacer').addEventListener('click', () => {
    s.prevNote = null;
    curseurPrev.value = 5; curseurPrev.classList.add('vierge');
    curseurPrev.setAttribute('aria-valuetext', 'aucune note choisie');
    document.getElementById('ciel-prev').classList.add('vierge');
    document.getElementById('lecture-prev').textContent = '–';
    document.getElementById('lecture-prev-nom').textContent = 'facultatif';
    document.getElementById('icone-prev').innerHTML = '';
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
        lieux: champLieux.valeurs(),
        situation: champSituation.valeur(),
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
    if (c === 'lieu') return esc(C.libelleLieu(v, { complet: true }));
    if (c === 'lieux') return v.length ? esc(C.libelleLieux(v, { complet: true })) : '<em>aucun</em>';
    if (c === 'situation') return esc(C.libelleSituation(v));
    if (c === 'prevision') return Number.isInteger(v.note) ? esc(`${C.libelleNote(v.note)}${v.motif ? ` – ${v.motif}` : ''}`) : esc(v.motif || 'aucune note');
    return `<span class="texte-libre">${esc(v)}</span>`;
  };
  contenu.innerHTML = `<section class="colonne-centree fiche">
    <p class="doux" style="margin:0">${esc(C.majuscule(C.formatDateLongue(ev.date)))}</p>
    <h1>Évaluation ${ev.creneau === 'matin' ? 'du matin' : 'du soir'}</h1>
    <div class="ciel" style="--ciel: var(--n${ev.note})"><div class="lecture"><span class="lecture-icone">${iconeMeteo(ev.note, { taille: 64, titre: ev.niveau })}</span><span class="lecture-note">${ev.note}</span><span class="lecture-sur">/10</span><span class="lecture-nom">${esc(ev.niveau)}</span></div>${echelleHTML(ev.note, null)}</div>
    <div class="bloc"><dl>
      <dt>Statut</dt><dd>${badgeStatut(statut, ev.validationConnue ? '' : '(heure inconnue)')}</dd>
      <dt>Rappel prévu</dt><dd>${C.formatDateHeure(ev.rappelPrevuUtc)}</dd>
      <dt>Validation</dt><dd>${ev.validationConnue ? C.formatDateHeure(ev.valideLeUtc) : 'Heure réelle inconnue (donnée historique)'}${ev.saisieRetrospective ? ' — saisie rétrospective, après la fin du créneau' : ''}</dd>
      ${ev.modifieLeUtc ? `<dt>Dernière modification</dt><dd>${C.formatDateHeure(ev.modifieLeUtc)}</dd>` : ''}
      ${ev.noteOrigine ? `<dt>Origine</dt><dd>${esc(ev.noteOrigine)}</dd>` : ''}
      <dt>${C.lieuxDe(ev).length > 1 ? 'Lieux' : 'Lieu'}</dt><dd>${C.lieuxDe(ev).length ? C.lieuxDe(ev).map((l) => `${esc(C.libelleLieu(l, { complet: !C.estItinerance(l) }))}${l.source === 'libre' ? ' <span class="doux">(saisi librement)</span>' : ''}${l.activite ? ` : <em>${esc(l.activite)}</em>` : ''}`).join(' <span class="doux">→</span> ') : '<span class="doux">non indiqué</span>'}</dd>
      <dt>Situation</dt><dd>${ev.situation ? esc(C.libelleSituation(ev.situation)) : '<span class="doux">non indiquée</span>'}</dd>
      <dt>Motifs</dt><dd><div class="puces">${libM([...ev.motifs, ...ev.autresMotifs])}</div></dd>
      ${ev.explication ? `<dt>Explication</dt><dd class="texte-libre">${esc(ev.explication)}</dd>` : ''}
      ${ev.complement ? `<dt>Complément</dt><dd class="texte-libre">${esc(ev.complement)}</dd>` : ''}
      <dt>Prévision</dt><dd>${p ? `${Number.isInteger(p.note) ? `<strong>${esc(C.libelleNote(p.note))}</strong>` : 'aucune note'} pour ${esc(creneauRelatif(p.cible))}${p.motif ? `<br><span class="texte-libre">${esc(p.motif)}</span>` : ''}${p.motifs.length ? `<div class="puces" style="margin-top:6px">${libM(p.motifs)}</div>` : ''}
        ${Number.isInteger(p.note) ? `<br><span class="doux">${reel ? `Constaté : ${esc(C.libelleNote(reel.note))} (écart ${C.signeFr(reel.note - p.note, 0)})` : `Créneau visé : ${esc(C.STATUTS[statutDe(null, p.cible.date, p.cible.creneau)].toLowerCase())}`}</span>` : ''}` : '<span class="doux">aucune</span>'}</dd>
      ${ev.securite && ev.securite.declenchee ? `<dt>Sécurité</dt><dd>Une vérification de sécurité a été proposée (${esc(ev.securite.raisons.join(', '))}).</dd>` : ''}
    </dl></div>
    ${C.aDesTextes(ev) ? blocVersionRapport(ev) : ''}
    ${ev.historique && ev.historique.length ? `<div class="bloc"><h2>Historique des modifications</h2><ol class="historique">${ev.historique.map((h) => `<li><strong>${C.formatDateHeure(h.le)}</strong> (version ${h.version})${h.raison ? ` — raison : ${esc(h.raison)}` : ''}
      <ul>${h.changements.map((c) => `<li>${esc(c.champ === 'lieux' && (c.avant || []).length <= 1 && (c.apres || []).length <= 1 ? 'Lieu' : (C.LIBELLE_CHAMP[c.champ] || c.champ))} : ${valeur(c.champ, c.avant)} → ${valeur(c.champ, c.apres)}</li>`).join('')}</ul></li>`).join('')}</ol></div>` : ''}
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
  const archive = { id: C.nouvelId(), archiveLeUtc: new Date(maintenant()).toISOString(), retrait: true, raison: `Retirée par l'utilisateur${r.donnees.get('raison') ? ` : ${r.donnees.get('raison')}` : ''}.`, evaluation: ev };
  await prendreInstantane('Avant retrait d\'une évaluation');
  await DB.archiverEvaluation(archive);
  etat.evaluations = etat.evaluations.filter((e) => e.id !== id);
  etat.archives.push(archive);
  planifierSynchro();
  annoncer('Évaluation retirée et archivée.');
  aller('#/calendrier');
}

// ---------------------------------------------------------------------------
// Lieu et situation : complétion des évaluations passées

function vueContexte() {
  const toutes = C.trierChrono(etat.evaluations);
  const sansLieu = toutes.filter((e) => !e.lieu).length;
  const sansSit = toutes.filter((e) => !e.situation).length;
  const incompletes = toutes.filter((e) => !e.lieu || !e.situation);
  const debutDefaut = (incompletes[0] || toutes[0] || { date: aujourdhui() }).date;
  const finDefaut = (incompletes[incompletes.length - 1] || toutes[toutes.length - 1] || { date: aujourdhui() }).date;
  const tuile = (v, l) => `<div class="tuile"><div class="tuile-valeur">${v}</div><div class="tuile-libelle">${l}</div></div>`;
  const lignes = [...toutes].reverse().map((e) => `<tr><td>${esc(C.formatDateCourte(e.date))}</td><td>${e.creneau}</td><td class="nombre">${e.note}</td>
    <td>${e.lieu ? esc(C.libelleLieux(C.lieuxDe(e))) : '<span class="doux">—</span>'}</td><td>${e.situation ? esc(C.libelleSituation(e.situation)) : '<span class="doux">—</span>'}</td>
    <td><a class="bouton-discret" href="#/modifier/${esc(e.id)}">Modifier</a></td></tr>`).join('');
  contenu.innerHTML = `<section class="colonne-centree">
    <h1>Lieu et situation des évaluations passées</h1>
    <p>Indique où tu étais et quelle était ta situation pendant une période : l'application l'ajoute à toutes les évaluations de ces jours-là. Chaque ajout est noté dans l'historique de l'évaluation ; rien n'est appliqué sans ta confirmation.</p>
    <div class="tuiles" style="margin-bottom:18px">${tuile(toutes.length, 'évaluations')}${tuile(sansLieu, 'sans lieu')}${tuile(sansSit, 'sans situation')}</div>
    <form class="bloc" id="form-contexte" novalidate>
      <h2>Compléter une période</h2>
      <div class="rangee" style="align-items:flex-start">
        <div class="champ" style="flex:1;min-width:130px"><label for="ctx-debut">Du</label><input type="date" id="ctx-debut" value="${debutDefaut}"></div>
        <div class="champ" style="flex:1;min-width:130px"><label for="ctx-fin">Au</label><input type="date" id="ctx-fin" value="${finDefaut}"></div>
      </div>
      <fieldset class="champ" style="border:0;padding:0;margin:0 0 14px"><legend style="font-weight:600;margin-bottom:6px;padding:0">Créneaux</legend>
        <div class="segmente"><label><input type="radio" name="ctx-creneaux" value="tous" checked><span>Matin et soir</span></label><label><input type="radio" name="ctx-creneaux" value="matin"><span>Matin</span></label><label><input type="radio" name="ctx-creneaux" value="soir"><span>Soir</span></label></div>
      </fieldset>
      ${L.champLieuHTML('ctx-lieu', null)}
      ${L.champSituationHTML('ctx-situation', null)}
      <label class="interrupteur" style="margin-top:16px"><input type="checkbox" id="ctx-remplacer"> <span>Remplacer aussi les valeurs déjà indiquées <span class="doux">(sinon, seules les évaluations où l'information manque sont complétées)</span></span></label>
      <div id="ctx-apercu" class="bandeau en-ligne" style="margin-top:16px" aria-live="polite"></div>
      <button type="submit" class="bouton" id="ctx-appliquer" disabled>Appliquer</button>
    </form>
    <div class="bloc"><h2>Tes évaluations</h2>
      ${lignes ? `<div class="defile"><table class="donnees"><thead><tr><th>Date</th><th>Créneau</th><th class="nombre">Note</th><th>Lieu</th><th>Situation</th><th></th></tr></thead><tbody>${lignes}</tbody></table></div>` : '<p class="doux">Aucune évaluation.</p>'}
    </div>
  </section>`;
  const form = document.getElementById('form-contexte');
  const apercu = document.getElementById('ctx-apercu');
  const bouton = document.getElementById('ctx-appliquer');
  const options = () => {
    const lieu = champLieu.valeur();
    const situation = champSituation.valeur();
    const cr = form.querySelector('[name="ctx-creneaux"]:checked').value;
    return {
      debut: document.getElementById('ctx-debut').value, fin: document.getElementById('ctx-fin').value,
      creneaux: cr === 'tous' ? C.CRENEAUX : [cr],
      lieu: lieu || undefined, situation: situation || undefined,
      remplacer: document.getElementById('ctx-remplacer').checked,
    };
  };
  const majApercu = () => {
    const o = options();
    let texte = '', n = 0;
    if (!C.estDateValide(o.debut) || !C.estDateValide(o.fin) || o.debut > o.fin) texte = 'Choisis une date de début antérieure ou égale à la date de fin.';
    else if (!o.lieu && !o.situation) texte = 'Choisis un lieu, une situation, ou les deux.';
    else {
      const cibles = C.cibleCompletion(etat.evaluations, o);
      n = cibles.length;
      const quoi = [o.lieu ? `lieu : <strong>${esc(C.libelleLieu(o.lieu, { complet: true }))}</strong>` : '', o.situation ? `situation : <strong>${esc(C.libelleSituation(o.situation))}</strong>` : ''].filter(Boolean).join(' ; ');
      texte = n ? `${quoi}.<br>Sera ajouté à <strong>${C.pluriel(n, 'évaluation')}</strong>, du ${C.formatDateCourte(cibles[0].date)} au ${C.formatDateCourte(cibles[n - 1].date)}.`
        : `${quoi}.<br>Aucune évaluation à compléter dans cette période${o.remplacer ? '' : ' (les valeurs déjà indiquées sont conservées)'}.`;
    }
    apercu.innerHTML = texte;
    bouton.disabled = !n;
    bouton.textContent = n ? `Appliquer à ${C.pluriel(n, 'évaluation')}` : 'Appliquer';
  };
  const champLieu = L.brancherChampLieu('ctx-lieu', { connus: C.lieuxConnus(etat.evaluations), enLigne: etat.parametres.rechercheLieux !== false, surChangement: () => setTimeout(majApercu, 0) });
  const champSituation = L.brancherChampSituation(form, 'ctx-situation', { surChangement: majApercu });
  form.addEventListener('input', majApercu);
  form.addEventListener('change', majApercu);
  document.getElementById('ctx-lieu').addEventListener('blur', () => setTimeout(majApercu, 200));
  majApercu();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const o = options();
    const cibles = C.cibleCompletion(etat.evaluations, o);
    if (!cibles.length) return;
    const ok = await confirmer('Compléter ces évaluations ?', `${C.pluriel(cibles.length, 'évaluation')} du ${C.formatDateCourte(cibles[0].date)} au ${C.formatDateCourte(cibles[cibles.length - 1].date)} ${cibles.length > 1 ? 'seront complétées' : 'sera complétée'}. L'ajout est noté dans l'historique de chaque évaluation ; une copie de sécurité est faite avant.`, 'Appliquer');
    if (!ok) return;
    bouton.disabled = true;
    await prendreInstantane('Avant complétion du lieu et de la situation');
    const modifiees = C.appliquerCompletion(etat.evaluations, o, maintenant());
    for (const m of modifiees) await enregistrerEvaluation(m);
    annoncer(`${C.pluriel(modifiees.length, 'évaluation complétée', 'évaluations complétées')}.`);
    vueContexte();
  });
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
    const inner = `<span class="lettre">${lettre}</span>${s.evaluation ? `<span class="cal-icone">${iconeMeteo(s.evaluation.note, { taille: 18 })}</span>` : ''}<span class="val">${s.evaluation ? s.evaluation.note : s.statut === 'omis' ? '×' : s.statut === 'en_attente' ? '•' : ''}</span>`;
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
    await enregistrerParametres({ motifsSupprimes: [...(etat.parametres.motifsSupprimes || []), { id: m.id, le }] });
    planifierSynchro();
    etat.motifs = etat.motifs.filter((x) => x.id !== m.id);
  }
  vueMotifs();
}

// ---------------------------------------------------------------------------
// Textes pour le rapport : version corrigée, complète, traduite en français et professionnelle

const aRelire = () => etat.evaluations.filter((e) => e.reformulation && e.reformulation.statut !== 'validee' && C.aDesTextes(e)).length;
const nbMots = (t) => (String(t || '').trim() ? String(t).trim().split(/\s+/).length : 0);
const LIBELLES_TEXTES = { explication: 'Description (motifs et explication)', complement: 'Complément', prevision: 'Motif de la prévision' };

/** Ce que le patient a saisi pour chaque champ (les motifs cochés font partie de la description). */
function originalPourChamp(ev, k) {
  const t = C.textesOriginaux(ev);
  if (k === 'explication') {
    const m = [...(ev.motifs || []), ...(ev.autresMotifs || [])].map((x) => `${x.libelle} (${C.LIBELLE_POLARITE[x.polarite].toLowerCase()})`);
    return [m.length ? `Motifs cochés : ${m.join(', ')}.` : '', t.explication].filter(Boolean).join('\n');
  }
  if (k === 'prevision') {
    const m = ((ev.prevision && ev.prevision.motifs) || []).map((x) => x.libelle);
    return [t.prevision, m.length ? `Motifs associés : ${m.join(', ')}.` : ''].filter(Boolean).join('\n');
  }
  return t[k];
}

function blocVersionRapport(ev) {
  const r = ev.reformulation;
  if (!r) return `<div class="bloc"><h2>Version pour le rapport</h2><p class="doux">Aucune version corrigée : le rapport reprendra le texte original.</p><a class="bouton-secondaire" href="#/textes/${esc(ev.id)}">Préparer une version corrigée</a></div>`;
  const t = C.champsVersion(ev);
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
  const anciennes = tous.filter((e) => C.versionAncienneMethode(e) && !C.aReformuler(e));
  const validees = tous.filter((e) => e.reformulation && e.reformulation.statut === 'validee');
  const cible = idCible ? tous.find((e) => e.id === idCible) : null;
  const filtre = ui.filtreTextes || 'a-faire';
  const affichees = cible ? [cible] : (filtre === 'toutes' ? tous : tous.filter((e) => !e.reformulation || e.reformulation.statut !== 'validee'));
  const demande = aTraiter.length ? C.demandeReformulation(aTraiter) : '';
  const auto = iaPrete();
  const dest = (etat.parametres.destinataire || '').trim() || 'le thérapeute';
  const carte = (ev) => {
    const permis = C.champsVersion(ev);
    const t = Object.fromEntries(Object.keys(LIBELLES_TEXTES).map((k) => [k, permis[k] ? originalPourChamp(ev, k) : '']));
    const r = ev.reformulation;
    const champs = Object.keys(LIBELLES_TEXTES).filter((k) => t[k]);
    return `<article class="bloc carte-texte" id="t-${esc(ev.id)}" data-id="${esc(ev.id)}">
      <div class="rangee-espacee"><h3 style="margin:0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${iconeMeteo(ev.note, { taille: 26 })}${esc(C.majuscule(C.formatDateLongue(ev.date)))}, ${ev.creneau} <span class="doux">– ${esc(C.libelleNote(ev.note))}</span></h3>${badgeReformulation(r)}</div>
      ${champs.map((k) => `<div class="champ" style="margin-top:14px">
        <label for="t-${esc(ev.id)}-${k}">${LIBELLES_TEXTES[k]} – version pour ${esc(dest)}</label>
        <textarea id="t-${esc(ev.id)}-${k}" data-champ="${k}" rows="${Math.min(10, Math.max(3, Math.ceil((r && r[k] ? r[k] : t[k]).length / 70)))}" maxlength="10000" spellcheck="true" lang="fr" autocapitalize="sentences" placeholder="Pas encore de version corrigée">${esc(r ? r[k] : '')}</textarea>
        ${r && C.contientPremierePersonne(r[k]) ? '<p class="bandeau" style="margin:6px 0">Ce texte emploie encore la première personne (« je », « mon »…) : touche <strong>Nouvelle proposition</strong> ou corrige-le pour parler du « patient ».</p>' : ''}
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
      <p class="encre-2">${cible.reformulation && cible.reformulation.statut === 'proposee' ? 'Voici une proposition complète, corrigée, traduite en français si besoin et rédigée dans un français soigné, qui intègre tes motifs cochés. Vérifie qu\'elle respecte ce que tu voulais dire, modifie-la si besoin, puis valide-la : seule une version validée figure dans le rapport.' : 'Relis ou rédige la version qui figurera dans le rapport. Ton texte original reste intact.'}</p>
      ${carte(cible)}
      <p><a class="bouton-discret" href="#/textes">Tous les textes pour le rapport</a></p>
    </section>`;
  } else {
    contenu.innerHTML = `<section class="colonne-centree">
      <h1>Textes pour le rapport</h1>
      <p class="encre-2">Le rapport PDF présente tes commentaires et tes motifs dans une version complète, corrigée, traduite en français si besoin et rédigée dans un français soigné, que tu as relue et validée. Ton texte original n'est jamais modifié ; sans version validée, c'est lui qui figure dans le rapport.</p>
      <div class="tuiles" style="margin-bottom:18px">
        <div class="tuile"><div class="tuile-valeur">${aTraiter.length}</div><div class="tuile-libelle">sans version corrigée</div></div>
        <div class="tuile"><div class="tuile-valeur">${proposees.length}</div><div class="tuile-libelle">propositions à valider</div></div>
        <div class="tuile"><div class="tuile-valeur">${validees.length}</div><div class="tuile-libelle">versions validées</div></div>
      </div>
      <div class="bloc">
        <h2>Préparation des versions</h2>
        ${auto ? `<p>Préparation automatique activée avec ${esc(C.majuscule(FOURNISSEURS[etat.parametres.ia.fournisseur].nom))} : chaque nouvelle évaluation commentée reçoit une proposition, que tu valides.</p>
          ${anciennes.length ? `<div class="bandeau bandeau-laiton"><strong>Nouvelle méthode de rédaction</strong>${anciennes.length > 1 ? `${anciennes.length} versions ont été préparées` : 'Une version a été préparée'} avec une méthode précédente (texte raccourci, motifs absents ou texte à la première personne). Tu peux les refaire : elles redeviendront des propositions à relire et valider.<p style="margin:10px 0 0"><button type="button" class="bouton-secondaire" id="btn-refaire-anciennes">Refaire ${anciennes.length > 1 ? `les ${anciennes.length} versions` : 'cette version'}</button></p></div>` : ''}
          ${aTraiter.length ? `<button type="button" class="bouton" id="btn-preparer-tout">Préparer maintenant ${aTraiter.length > 1 ? `les ${aTraiter.length} versions` : 'la version manquante'}</button>` : '<p class="doux">Aucune version à préparer.</p>'}`
    : `<p>Pour que les propositions soient préparées automatiquement après chaque évaluation, active la préparation automatique dans les Réglages.</p><a class="bouton" href="#/reglages/ia">Activer la préparation automatique</a>`}
        ${aTraiter.length ? `<details class="repli" style="margin-top:14px"><summary>Ou par copier-coller dans un assistant</summary>
          <ol class="etapes">
            <li>Copie la demande (${C.pluriel(aTraiter.length, 'évaluation')}).</li>
            <li>Colle-la dans l'assistant de ton choix, par exemple Claude, et envoie-la.</li>
            <li>Colle sa réponse complète ci-dessous, puis importe-la.</li>
          </ol>
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
  contenu.querySelectorAll('[name="filtre-textes"]').forEach((r) => r.addEventListener('change', () => { ui.filtreTextes = r.value; vueTextes([]); }));
  const bPreparer = document.getElementById('btn-preparer-tout');
  if (bPreparer) bPreparer.addEventListener('click', async () => {
    bPreparer.disabled = true; bPreparer.textContent = 'Préparation en cours…';
    const n = await preparerVersions(aTraiter, { silencieux: false });
    if (n !== null) annoncer(`${C.pluriel(n, 'proposition préparée', 'propositions préparées')} : relis-les et valide-les.`);
    vueTextes([]);
  });
  const bRefaire = document.getElementById('btn-refaire-anciennes');
  if (bRefaire) bRefaire.addEventListener('click', async () => {
    bRefaire.disabled = true; bRefaire.textContent = 'Rédaction en cours…';
    const n = await preparerVersions(anciennes, { silencieux: false, force: true });
    if (n !== null) annoncer(`${C.pluriel(n, 'nouvelle proposition', 'nouvelles propositions')} : relis-les et valide-les.`);
    ui.filtreTextes = 'a-faire';
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
      carteEl.querySelector(`[data-compte="${ta.dataset.champ}"]`).textContent = `${nbMots(ta.value)} mots, original : ${nbMots(originalPourChamp(ev, ta.dataset.champ))} mots`;
    }));
    carteEl.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-texte]');
      if (!b) return;
      const ev = etat.evaluations.find((x) => x.id === id);
      if (b.dataset.texte === 'partir') {
        carteEl.querySelectorAll('textarea[data-champ]').forEach((ta) => { ta.value = originalPourChamp(ev, ta.dataset.champ); ta.dispatchEvent(new Event('input')); });
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
    const maj = C.definirReformulation(ev, { ...p, statut: 'proposee', source: 'assistant', methode: C.METHODE_VERSION }, raison, instant);
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
    <p>Rédaction de la version pour le thérapeute en cours…</p>
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
// Synchronisation automatique entre appareils (coffre chiffré de bout en bout)

const synchroActive = () => !!(etat.parametres && etat.parametres.synchro && etat.parametres.synchro.actif && etat.parametres.synchro.phrase
  && etat.parametres.serveurRappels && etat.parametres.serveurRappels.url && etat.parametres.serveurRappels.jeton);

let minuterieSynchro = null;
function planifierSynchro(delai = 1500) {
  if (!synchroActive()) return;
  clearTimeout(minuterieSynchro);
  minuterieSynchro = setTimeout(() => { lancerSynchro().catch((e) => console.warn(e)); }, delai);
}

function texteConfidentialite() {
  const p = etat.parametres || {};
  const sy = synchroActive();
  const push = !!(p.serveurRappels && p.serveurRappels.actif);
  const ia = !!(p.ia && p.ia.actif && p.ia.consentementUtc);
  const nomIa = ia ? (p.ia.fournisseur === 'mistral' ? 'Mistral AI' : 'Claude (Anthropic)') : '';
  const lieux = p.rechercheLieux !== false;
  const points = [
    sy ? '<li><strong>Synchronisation active</strong> : une copie de tes données, chiffrée sur cet appareil avec ta phrase de synchronisation, est conservée par ton service en ligne pour ton autre appareil. Le service ne peut pas la lire.</li>' : '',
    push ? '<li><strong>Rappels actifs</strong> : le service connaît seulement l\'adresse technique de notification de cet appareil, sans aucune donnée de santé.</li>' : '',
    lieux ? '<li><strong>Recherche des lieux</strong> : pendant que tu tapes un lieu, les lettres tapées sont envoyées au service Photon (OpenStreetMap, komoot, Allemagne) pour te proposer des localités, sans aucune autre donnée. Le lieu choisi reste dans tes données.</li>' : '',
    ia ? `<li><strong>Version professionnelle automatique</strong> : le texte de tes commentaires (sans nom, notes ni dates) est envoyé à ${nomIa}, avec ton accord du ${C.formatDateHeure(p.ia.consentementUtc)}.</li>` : '',
    '<li><strong>Envoi du rapport</strong> : seulement quand tu le demandes, depuis ta propre messagerie ou par la feuille de partage (WhatsApp, Mail…). Un e-mail ordinaire n\'est pas chiffré.</li>',
  ].filter(Boolean);
  return `<p>Tes données sont enregistrées dans la base locale de ce navigateur, sur cet appareil. Le rapport PDF est calculé ici, sans service externe.${sy || push || ia || lieux ? ' Échanges réseau actuellement actifs :' : ' Aucun échange réseau n\'est actif en dehors de ce que tu déclenches toi-même :'}</p><ul class="liste-puces">${points.join('')}</ul>`;
}

function majEtatSynchro() {
  const pied = document.getElementById('pied-stockage');
  if (pied) pied.textContent = `${synchroActive() ? 'Données conservées sur tes appareils, avec une copie de synchronisation chiffrée.' : 'Données conservées uniquement sur cet appareil.'} Cette application ne pose aucun diagnostic et ne remplace pas ton thérapeute.`;
  const el = document.getElementById('etat-synchro');
  if (!el) return;
  const sy = etat.parametres && etat.parametres.synchro;
  if (!synchroActive()) { el.textContent = ''; return; }
  el.textContent = sy.erreur ? `Synchronisation en attente : ${sy.erreur}` : sy.derniereUtc ? `Synchronisé avec ton autre appareil à ${C.formatHeure(sy.derniereUtc)}${C.dateLocale(Date.parse(sy.derniereUtc)) !== aujourdhui() ? ` le ${C.formatDateCourte(C.dateLocale(Date.parse(sy.derniereUtc)))}` : ''}.` : 'Synchronisation en cours…';
}

/** Fusionne cet appareil avec le coffre, puis renvoie le résultat. Retourne true si tout s'est bien passé. */
async function lancerSynchro({ interactif = false } = {}) {
  if (!synchroActive()) { if (interactif) annoncer('Synchronisation non activée.'); return false; }
  if (ui.synchroEnCours) { ui.synchroARefaire = true; return false; }
  if (!navigator.onLine) { if (interactif) annoncer('Hors connexion : la synchronisation reprendra automatiquement.'); return false; }
  ui.synchroEnCours = true;
  const service = { url: etat.parametres.serveurRappels.url, jeton: etat.parametres.serveurRappels.jeton };
  const phrase = etat.parametres.synchro.phrase;
  let changeLocal = false;
  try {
    if (!etat.parametres.synchro.derniereUtc) await prendreInstantane('Avant la première synchronisation');
    for (let essai = 0; essai < 4; essai++) {
      const { version, coffre } = await S.lireCoffre(service);
      const distant = coffre ? await S.dechiffrer(coffre, phrase) : null;
      const local = { parametres: etat.parametres, motifs: etat.motifs, evaluations: etat.evaluations, archives: etat.archives };
      const fusion = distant ? C.fusionnerSynchro(local, distant) : local;
      const exportFusion = C.exporterSynchro(fusion);
      if (C.empreinteSynchro(exportFusion) !== C.empreinteSynchro(C.exporterSynchro(local))) {
        await DB.remplacerTout({ evaluations: fusion.evaluations, motifs: fusion.motifs, parametres: fusion.parametres, archives: fusion.archives });
        await chargerEtat();
        changeLocal = true;
      }
      let versionFinale = version;
      if (!distant || C.empreinteSynchro(exportFusion) !== C.empreinteSynchro(distant)) {
        const r = await S.ecrireCoffre(service, version, await S.chiffrer(exportFusion, phrase, coffre && coffre.sel));
        if (r.conflit) continue;
        versionFinale = r.version;
      }
      await DB.ecrireParametres({ synchro: { ...etat.parametres.synchro, version: versionFinale, derniereUtc: new Date(maintenant()).toISOString(), erreur: '' } });
      etat.parametres.synchro = { ...etat.parametres.synchro, version: versionFinale, derniereUtc: new Date(maintenant()).toISOString(), erreur: '' };
      if (changeLocal) {
        majBoutonPdf(); appliquerTheme(etat.parametres.theme); majBadge();
        const h = location.hash;
        if (h === '' || h === '#/' || h === '#' || h.startsWith('#/calendrier')) router();
        if (interactif) annoncer('Données mises à jour depuis ton autre appareil.');
      } else if (interactif) annoncer('Synchronisé.');
      majEtatSynchro();
      return true;
    }
    throw new Error('Trop de modifications simultanées ; nouvel essai bientôt.');
  } catch (e) {
    const message = /failed to fetch|load failed|networkerror/i.test(e.message) ? 'service injoignable' : e.message;
    etat.parametres.synchro = { ...etat.parametres.synchro, erreur: message };
    await DB.ecrireParametres({ synchro: etat.parametres.synchro });
    majEtatSynchro();
    if (interactif) annoncer(`Synchronisation impossible : ${message}`);
    return false;
  } finally {
    ui.synchroEnCours = false;
    if (ui.synchroARefaire) { ui.synchroARefaire = false; planifierSynchro(); }
  }
}

function lireServiceDepuisFormulaire() {
  const url = (document.getElementById('serveur-url').value || '').trim().replace(/\/+$/, '');
  const jeton = (document.getElementById('serveur-jeton').value || '').trim();
  if (!/^https:\/\//.test(url)) throw new Error('Saisis d\'abord l\'adresse du service (elle commence par https://).');
  if (!jeton) throw new Error('Saisis d\'abord le mot de passe du service.');
  return { url, jeton };
}

async function activerSynchro() {
  try {
    const { url, jeton } = lireServiceDepuisFormulaire();
    const phrase = document.getElementById('synchro-phrase').value;
    if (phrase.trim().length < 12) throw new Error('Choisis une phrase de synchronisation d\'au moins 12 caractères (par exemple quatre mots).');
    await enregistrerParametres({ serveurRappels: { ...(etat.parametres.serveurRappels || {}), url, jeton }, synchro: { ...etat.parametres.synchro, actif: true, phrase, erreur: '' } });
    const ok = await lancerSynchro({ interactif: true });
    if (ok) annoncer('Synchronisation activée : tes appareils restent à jour automatiquement.');
    vueReglages(['synchro']);
  } catch (e) { annoncer(e.message); }
}

async function copierCodeConnexion() {
  const sr = etat.parametres.serveurRappels || {};
  if (!sr.url || !sr.jeton) { annoncer('Configure d\'abord l\'adresse et le mot de passe du service.'); return; }
  const code = S.codeConnexion(sr.url, sr.jeton);
  const champ = document.getElementById('synchro-code');
  if (champ) { champ.value = code; champ.hidden = false; champ.select(); }
  try { await navigator.clipboard.writeText(code); annoncer('Code copié : envoie-le sur ton iPhone (par exemple dans une note ou un message à toi-même).'); } catch { annoncer('Sélectionne le code affiché et copie-le.'); }
}

async function demarrerParSynchro() {
  const r = await dialogue(`<h2 id="dialogue-titre">Récupérer mes données</h2>
    <p>Sur ton autre appareil, dans Réglages &gt; Rappels et synchronisation, touche « Copier le code de connexion » et envoie-toi ce code. Colle-le ici, puis saisis ta phrase de synchronisation.</p>
    <div class="champ"><label for="code-connexion">Code de connexion</label><textarea id="code-connexion" name="code" rows="3" required autocapitalize="off" spellcheck="false" placeholder="BAROMETRE-…" autofocus></textarea></div>
    <div class="champ"><label for="phrase-connexion">Phrase de synchronisation</label><input type="password" id="phrase-connexion" name="phrase" required autocapitalize="off" spellcheck="false"></div>
    <div class="dialogue-actions"><button class="bouton-secondaire" value="non" formnovalidate>Annuler</button><button class="bouton" value="oui">Récupérer</button></div>`);
  if (r.valeur !== 'oui') return;
  try {
    const { url, jeton } = S.lireCodeConnexion(r.donnees.get('code'));
    const phrase = String(r.donnees.get('phrase') || '');
    annoncer('Récupération en cours…');
    const { coffre } = await S.lireCoffre({ url, jeton });
    if (!coffre) throw new Error('Aucune donnée à récupérer : active d\'abord la synchronisation sur ton autre appareil.');
    await S.dechiffrer(coffre, phrase);
    await initialiser();
    await enregistrerParametres({ serveurRappels: { url, jeton, actif: false }, synchro: { ...C.parametresParDefaut().synchro, actif: true, phrase } });
    const ok = await lancerSynchro({ interactif: false });
    if (!ok) throw new Error(etat.parametres.synchro.erreur || 'échec de la synchronisation');
    majBoutonPdf();
    annoncer(`Données récupérées : ${C.pluriel(etat.evaluations.length, 'évaluation')}. Active maintenant les rappels sur cet appareil.`);
    aller('#/reglages/rappels');
  } catch (e) {
    annoncer(/failed to fetch|load failed|networkerror/i.test(e.message) ? 'Service injoignable : vérifie le code et ta connexion Internet.' : e.message);
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

const estMobile = estIOS || /Android/i.test(navigator.userAgent);

/**
 * Envoi du rapport depuis la messagerie de l'utilisateur : rien ne passe par un service tiers.
 * Mobile : feuille de partage (Mail, Gmail, WhatsApp…) avec le PDF joint et l'adresse copiée.
 * Ordinateur : le PDF est téléchargé et un e-mail pré-rempli s'ouvre ; il reste à joindre le fichier.
 * Doit être appelé directement depuis un clic (exigence du navigateur pour le partage).
 */
function envoyerRapport(blob, nom, debut, fin) {
  const p = etat.parametres;
  const email = C.estEmailValide(p.emailTherapeute) ? p.emailTherapeute.trim() : '';
  const { objet, corps } = C.messageEnvoiRapport({ destinataire: p.destinataire, debut, fin, seance: C.prochaineSeance(seances(), maintenant()), aujourdhui: aujourdhui(), patient: (p.patient && p.patient.nom) || '' });
  const aide = document.getElementById('pdf-envoi-aide');
  const dire = (html) => { if (aide) { aide.hidden = false; aide.innerHTML = html; } };
  const copie = email && navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(email).then(() => true, () => false) : Promise.resolve(false);
  const adresse = email ? `<strong>${esc(email)}</strong>` : 'l\'adresse de ton thérapeute';
  let fichier = null;
  try { fichier = new File([blob], nom, { type: 'application/pdf' }); } catch { fichier = null; }
  if (estMobile && fichier && navigator.canShare && navigator.canShare({ files: [fichier] })) {
    dire(`Choisis <strong>Mail</strong> (ou ta messagerie). ${email ? `L'adresse ${adresse} est copiée : touche le champ « À », puis <strong>Coller</strong>.` : 'Saisis l\'adresse de ton thérapeute dans le champ « À ».'} Le rapport est déjà joint.`);
    navigator.share({ files: [fichier], title: objet, text: corps }).then(
      () => dire('Envoi préparé. Vérifie dans ta messagerie que le message est bien parti.'),
      (e) => { if (!e || e.name !== 'AbortError') dire(`Le partage n'a pas pu s'ouvrir. Touche <strong>Télécharger</strong>, puis joins le fichier à un e-mail pour ${adresse}.`); },
    );
    return;
  }
  // Ordinateur : téléchargement + e-mail pré-rempli
  telecharger(blob, nom);
  const a = document.createElement('a');
  a.href = C.lienMailto(email, objet, corps);
  a.rel = 'noopener';
  document.body.append(a); a.click(); a.remove();
  const texte = (ok) => `Un e-mail pré-rempli${email ? ` pour ${adresse}` : ''} s'ouvre dans ta messagerie. Joins-y le fichier <strong>${esc(nom)}</strong>, qui vient d'être enregistré dans <strong>Téléchargements</strong>, puis envoie.${ok ? ' L\'adresse est aussi copiée, si tu utilises ta messagerie dans le navigateur (Yahoo, Gmail…).' : ''} <span class="doux">Si aucune messagerie ne s'ouvre, écris un nouvel e-mail à ${adresse} et joins le fichier.</span>`;
  dire(texte(false));
  copie.then((ok) => { if (ok) dire(texte(true)); });
}

async function ouvrirPdf() {
  if (!etat.parametres) { annoncer('Commence par configurer l\'application.'); return; }
  const fin = aujourdhui();
  const dates = [C.dateLocale(Date.parse(etat.parametres.debutSuiviUtc)), ...etat.evaluations.map((e) => e.date)].sort();
  const debutTout = dates[0] < fin ? dates[0] : fin;
  const dest = (etat.parametres.destinataire || '').trim();
  const dr = etat.parametres.dernierRapport;
  // Périodes proposées : depuis la dernière séance, entre deux séances, 7 jours, dernier mois, depuis le début
  const options = C.periodesRapport(seances(), { instant: maintenant(), aujourdhui: fin, debutSuivi: debutTout });
  if (dr && dr.fin) {
    let d = C.ajouterJours(dr.fin, 1);
    if (d > fin) d = dr.debut || debutTout;
    options.splice(options.findIndex((o) => !o.entre && o.cle !== 'depuis-seance'), 0, { cle: 'depuis', libelle: 'Depuis le dernier rapport', debut: d, fin });
  }
  const simples = options.filter((o) => !o.entre);
  const entre = options.filter((o) => o.entre);
  // Par défaut : depuis la dernière séance, sinon depuis le dernier rapport, sinon tout le suivi
  const defaut = options.find((o) => o.cle === 'depuis-seance') || options.find((o) => o.cle === 'depuis') || options.find((o) => o.cle === 'tout');
  const debutDefaut = defaut.debut;
  const patient = etat.parametres.patient || {};
  dlg.innerHTML = `<form class="dialogue-corps" id="form-pdf" novalidate>
    <h2 id="dialogue-titre">Générer le rapport PDF${dest ? ` pour ${esc(dest)}` : ''}</h2>
    <p class="encre-2">Le rapport est calculé sur cet appareil à partir de tes données enregistrées, uniquement quand tu le demandes.${dr ? ` Dernier rapport : du ${C.formatDateCourte(dr.debut)} au ${C.formatDateCourte(dr.fin)}, généré le ${C.formatDateHeure(dr.genereLeUtc)}.` : ''}</p>
    <fieldset class="champ" style="border:0;padding:0;margin:0 0 10px;min-width:0"><legend style="font-weight:600;margin-bottom:8px;padding:0">Période</legend>
      <div class="puces">
        ${simples.map((o) => `<label class="puce" data-periode="${esc(o.cle)}"><input type="radio" name="pdf-periode" value="${esc(o.cle)}" ${o === defaut ? 'checked' : ''}><span>${esc(o.libelle)}</span></label>`).join('')}
        ${entre.length ? '<label class="puce" data-periode="entre"><input type="radio" name="pdf-periode" value="entre"><span>Entre deux séances</span></label>' : ''}
        <label class="puce" data-periode="perso"><input type="radio" name="pdf-periode" value="perso"><span>Personnalisée</span></label>
      </div>
      ${entre.length ? `<div class="champ" id="pdf-entre-zone" style="margin-top:10px" hidden><label for="pdf-entre">Séances</label><select id="pdf-entre">${entre.map((o) => `<option value="${esc(o.cle)}">${esc(o.libelle)}</option>`).join('')}</select></div>` : ''}
    </fieldset>
    <div class="rangee" style="align-items:flex-start">
      <div class="champ" style="flex:1;min-width:150px"><label for="pdf-debut">Date de début</label><input type="date" id="pdf-debut" value="${debutDefaut}" max="${fin}" required></div>
      <div class="champ" style="flex:1;min-width:150px"><label for="pdf-fin">Date de fin</label><input type="date" id="pdf-fin" value="${fin}" required></div>
    </div>
    ${patient.cns ? `<label class="interrupteur" style="margin-bottom:14px"><input type="checkbox" id="pdf-cns" ${etat.parametres.rapportAvecCNS !== false ? 'checked' : ''}> <span>Inclure mon matricule CNS <span class="doux">(${esc(C.formatCNS(patient.cns))})</span></span></label>` : ''}
    <fieldset class="champ"><legend style="font-weight:600;margin-bottom:6px">Type de rapport</legend>
      <label class="interrupteur"><input type="radio" name="type" value="complet" checked> <span>Complet <span class="doux">– tous les commentaires en annexe</span></span></label>
      <label class="interrupteur" style="margin-top:8px"><input type="radio" name="type" value="synthetique"> <span>Synthétique <span class="doux">– commentaires abrégés, tableaux résumés</span></span></label>
    </fieldset>
    <fieldset class="champ"><legend style="font-weight:600;margin-bottom:6px">Commentaires dans le rapport</legend>
      <label class="interrupteur"><input type="radio" name="textes" value="reformule" checked> <span>Version rédigée pour le thérapeute <span class="doux">– si tu l'as validée, sinon texte original</span></span></label>
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
  const zoneEntre = document.getElementById('pdf-entre-zone');
  const appliquer = (o) => { if (!o) return; document.getElementById('pdf-debut').value = o.debut; document.getElementById('pdf-fin').value = o.fin; };
  form.querySelectorAll('[name="pdf-periode"]').forEach((r) => r.addEventListener('change', () => {
    if (zoneEntre) zoneEntre.hidden = r.value !== 'entre';
    if (r.value === 'perso') { document.getElementById('pdf-debut').focus(); return; }
    appliquer(r.value === 'entre' ? entre.find((o) => o.cle === document.getElementById('pdf-entre').value) : options.find((o) => o.cle === r.value));
  }));
  if (zoneEntre) document.getElementById('pdf-entre').addEventListener('change', (ev) => appliquer(entre.find((o) => o.cle === ev.target.value)));
  for (const id of ['pdf-debut', 'pdf-fin']) document.getElementById(id).addEventListener('input', () => { const perso = form.querySelector('[name="pdf-periode"][value="perso"]'); if (perso) perso.checked = true; if (zoneEntre) zoneEntre.hidden = true; });
  const caseCns = document.getElementById('pdf-cns');
  if (caseCns) caseCns.addEventListener('change', () => enregistrerParametres({ rapportAvecCNS: caseCns.checked }));
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
      const octets = await genererRapport(PDFLib, { evaluations: etat.evaluations, motifs: etat.motifs, parametres: { ...etat.parametres, seances: seances() } }, { debut, fin: finChoisie, type, textes, instant: maintenant(), inclureCNS: !!(caseCns && caseCns.checked) });
      const blob = new Blob([octets], { type: 'application/pdf' });
      const nom = nomFichierRapport(debut, finChoisie, type);
      const nbPages = (new TextDecoder('latin1').decode(octets).match(/\/Type\s*\/Page[^s]/g) || []).length;
      res.hidden = false;
      await enregistrerParametres({ dernierRapport: { debut, fin: finChoisie, type, genereLeUtc: new Date(maintenant()).toISOString() } });
      const proch = C.prochaineSeance(seances(), maintenant());
      const email = C.estEmailValide(etat.parametres.emailTherapeute) ? etat.parametres.emailTherapeute.trim() : '';
      const boutonsEnvoi = email ? `<button type="button" class="bouton" data-envoi="email">${dest ? `Envoyer à ${esc(dest)}` : 'Envoyer par e-mail'}</button>` : '';
      res.innerHTML = `<div class="bandeau bandeau-laiton"><strong>Rapport prêt</strong>${esc(nom)}${nbPages ? `, ${nbPages} page${nbPages > 1 ? 's' : ''}` : ''}.<div class="rangee" style="margin-top:10px">${boutonsEnvoi}<button type="button" class="${email ? 'bouton-secondaire' : 'bouton'}" id="pdf-telecharger">Télécharger</button>${navigator.canShare ? '<button type="button" class="bouton-secondaire" id="pdf-partager">Partager ou enregistrer</button>' : ''}<button type="button" class="bouton-discret" id="pdf-ouvrir">Ouvrir</button></div><div id="pdf-envoi-aide" class="encre-2 aide-envoi" style="margin-top:10px" hidden></div></div>
        ${proch ? `<p class="encre-2" style="margin-top:12px">Prochaine séance : <strong>${esc(C.libelleSeance(proch))}</strong> <span class="doux">(modifiable dans Réglages, Séances)</span>.</p>`
    : `<div class="champ" style="margin-top:12px"><label for="pdf-seance">Prochaine séance <small class="doux">(facultatif : un rappel s'affichera la veille et le jour même)</small></label>
          <div class="rangee"><input type="date" id="pdf-seance" min="${C.ajouterJours(fin, 0)}" style="flex:2;min-width:140px" aria-label="Date"><input type="time" id="pdf-seance-debut" step="300" style="flex:1;min-width:100px" aria-label="De"><input type="time" id="pdf-seance-fin" step="300" style="flex:1;min-width:100px" aria-label="À"><button type="button" class="bouton-secondaire" id="pdf-seance-ok">Enregistrer</button></div></div>`}`;
      const bSeance = document.getElementById('pdf-seance-ok');
      if (bSeance) bSeance.addEventListener('click', async () => {
        try {
          const sea = C.normaliserSeance({ date: document.getElementById('pdf-seance').value, debut: document.getElementById('pdf-seance-debut').value, fin: document.getElementById('pdf-seance-fin').value });
          await enregistrerSeances([...seances(), sea]);
          annoncer(`Prochaine séance notée : ${C.libelleSeance(sea)}.`);
          bSeance.closest('.champ').outerHTML = `<p class="encre-2" style="margin-top:12px">Prochaine séance : <strong>${esc(C.libelleSeance(sea))}</strong>.</p>`;
        } catch (err) { annoncer(err.message); }
      });
      document.getElementById('pdf-telecharger').addEventListener('click', () => telecharger(blob, nom));
      res.querySelectorAll('[data-envoi]').forEach((b) => b.addEventListener('click', () => envoyerRapport(blob, nom, debut, finChoisie)));
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
    annoncer(`Import impossible : ${e.message} Choisis bien le fichier donnees-initiales.json ou une sauvegarde .json.`);
    router();
    return;
  }
  if (premierDemarrage && !etat.parametres) await initialiser();
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
    planifierSynchro();
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
  const vueDemandee = numeroVue;
  const p = etat.parametres;
  const instantanes = (await DB.tout('instantanes')).sort((a, b) => (a.id < b.id ? 1 : -1));
  const dossier = dossierPossible() ? await DB.lire('poignees', 'dossier') : null;
  let persiste = null, estimation = null;
  try { if (navigator.storage) { persiste = navigator.storage.persisted ? await navigator.storage.persisted() : null; estimation = navigator.storage.estimate ? await navigator.storage.estimate() : null; } } catch { /* facultatif */ }
  const permNotif = 'Notification' in window ? Notification.permission : 'indisponible';
  const debutLocal = (() => { const ms = Date.parse(p.debutSuiviUtc); const q = C.partiesLocales(ms); return `${q.date}T${String(q.heure).padStart(2, '0')}:${String(q.minute).padStart(2, '0')}`; })();
  const adresse = location.href.split('#')[0].split('?')[0];
  const serv = p.serveurRappels || {};
  if (vueDemandee !== numeroVue) return; // l'utilisateur a déjà changé d'écran
  contenu.innerHTML = `<section class="colonne-centree">
    <h1>Réglages</h1>

    <div class="bloc"><h2>Apparence</h2>
      <fieldset><legend class="visuellement-cache">Thème</legend><div class="segmente">${[['auto', 'Automatique'], ['clair', 'Clair'], ['sombre', 'Sombre']].map(([v, l]) => `<label><input type="radio" name="theme" value="${v}" ${p.theme === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
    </div>

    <form class="bloc" id="form-general"><h2>Rapport et suivi</h2>
      <div class="champ"><label for="destinataire">Destinataire du rapport PDF</label><input type="text" id="destinataire" value="${esc(p.destinataire)}" maxlength="80" placeholder="Nom de ton thérapeute"><small class="doux">Apparaît sur le bouton et en titre du rapport.</small></div>
      <div class="champ"><label for="email-therapeute">Adresse e-mail de ton thérapeute <small class="doux">(facultatif : pour envoyer le rapport en un geste)</small></label><input type="email" id="email-therapeute" value="${esc(p.emailTherapeute || '')}" maxlength="120" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="email" placeholder="adresse@exemple.lu"></div>
      <div class="champ"><label for="debut-suivi">Début du suivi dans l'application</label><input type="datetime-local" id="debut-suivi" value="${debutLocal}"><small class="doux">Heure de Luxembourg. Les créneaux terminés avant cette date sont « non renseignés » et ne comptent pas comme omis.</small></div>
      <div class="champ"><label for="contact-nom">Personne de confiance ou thérapeute <small class="doux">(proposée dans l'écran d'aide)</small></label>
        <div class="rangee"><input type="text" id="contact-nom" value="${esc(p.contactConfiance.nom)}" placeholder="Nom" style="flex:1;min-width:140px"><input type="tel" id="contact-tel" value="${esc(p.contactConfiance.telephone)}" placeholder="Téléphone" style="flex:1;min-width:140px"></div></div>
      <button class="bouton" type="submit">Enregistrer</button>
    </form>

    <form class="bloc" id="form-identites" novalidate><h2>Identités pour le rapport</h2>
      <p class="encre-2">Elles figurent en tête du rapport PDF. Elles restent sur tes appareils (et dans la copie de synchronisation chiffrée) et ne sont jamais envoyées au service de rédaction.</p>
      <h3>Toi</h3>
      <div class="champ"><label for="patient-nom">Nom complet</label><input type="text" id="patient-nom" value="${esc((p.patient || {}).nom || '')}" maxlength="120" autocomplete="name"></div>
      <div class="champ"><label for="patient-adresse">Adresse</label><textarea id="patient-adresse" rows="3" maxlength="300" autocomplete="street-address">${esc((p.patient || {}).adresse || '')}</textarea></div>
      <div class="champ"><label for="patient-cns">Matricule CNS <small class="doux">(13 chiffres ; tu choisis à chaque rapport de l'inclure ou non)</small></label><input type="text" id="patient-cns" value="${esc(C.formatCNS((p.patient || {}).cns || ''))}" maxlength="20" inputmode="numeric" autocomplete="off" spellcheck="false"></div>
      <h3 style="margin-top:18px">Ton thérapeute</h3>
      <div class="champ"><label for="therapeute-nom">Nom complet</label><input type="text" id="therapeute-nom" value="${esc((p.therapeute || {}).nom || '')}" maxlength="120" autocomplete="off"></div>
      <div class="champ"><label for="therapeute-titre">Titre professionnel</label><input type="text" id="therapeute-titre" value="${esc((p.therapeute || {}).titre || '')}" maxlength="120" placeholder="Par exemple : Psychothérapeute" autocomplete="off"></div>
      <div class="champ"><label for="therapeute-adresse">Adresse professionnelle</label><textarea id="therapeute-adresse" rows="3" maxlength="300" autocomplete="off">${esc((p.therapeute || {}).adresse || '')}</textarea></div>
      <button class="bouton" type="submit">Enregistrer</button>
    </form>

    <div class="bloc" id="seances"><h2>Séances</h2>
      ${(() => {
    const liste = seances();
    const proch = C.prochaineSeance(liste, maintenant());
    const futures = liste.filter((x) => C.bornesSeance(x).fin > maintenant());
    const passees = C.seancesPassees(liste, maintenant());
    const ligne = (x) => `<li><span>${esc(C.libelleSeance(x))}</span><span><button type="button" class="bouton-discret" data-action="modifier-seance" data-id="${esc(x.id)}">Modifier</button><button type="button" class="bouton-discret" data-action="supprimer-seance" data-id="${esc(x.id)}">Supprimer</button></span></li>`;
    return `<p>${proch ? `Prochaine séance : <strong>${esc(C.libelleSeance(proch))}</strong>.` : 'Aucune séance à venir.'} La veille et le jour même, l'accueil te rappelle de préparer le rapport ; une fois la séance passée, il te propose d'indiquer la suivante.</p>
      <p><button type="button" class="bouton" data-action="ajouter-seance">Ajouter une séance</button></p>
      ${futures.length ? `<h3>À venir</h3><ul class="liste-simple">${futures.map(ligne).join('')}</ul>` : ''}
      ${passees.length ? `<h3 style="margin-top:14px">Passées</h3><ul class="liste-simple">${passees.slice(0, 12).map(ligne).join('')}</ul>` : ''}`;
  })()}
    </div>

    <div class="bloc" id="lieux"><h2>Lieu et situation</h2>
      <p>Chaque évaluation peut indiquer le lieu où tu te trouves et ta situation professionnelle. Le tableau de bord et le rapport PDF montrent ensuite ton humeur selon ces deux informations.</p>
      <label class="interrupteur"><input type="checkbox" id="recherche-lieux" ${p.rechercheLieux !== false ? 'checked' : ''}> <span>Recherche mondiale des lieux pendant la saisie <span class="doux">(service Photon d'OpenStreetMap, exploité par komoot en Allemagne : seules les lettres tapées sont envoyées, sans ton nom, tes notes ni aucune autre donnée ; désactivée, seuls tes lieux habituels sont proposés)</span></span></label>
      <p style="margin:14px 0 0"><a class="bouton-secondaire" href="#/contexte">Compléter les évaluations passées</a></p>
    </div>

    <div class="bloc" id="rappels"><h2>Rappels et synchronisation</h2>
      <p>Ton service en ligne gratuit (voir le guide : installation unique d'environ 10 minutes) envoie les rappels de 06:00 et 18:00 et garde une copie <strong>chiffrée</strong> de tes données pour synchroniser tes appareils. Il ne peut pas lire tes évaluations.</p>
      <div class="champ"><label for="serveur-url">Adresse du service</label><input type="url" id="serveur-url" value="${esc(serv.url)}" placeholder="https://barometre-rappels.ton-nom.workers.dev" inputmode="url" autocapitalize="off" spellcheck="false"></div>
      <div class="champ"><label for="serveur-jeton">Mot de passe du service (variable JETON)</label><input type="text" id="serveur-jeton" value="${esc(serv.jeton)}" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
      <h3 style="margin-top:18px">Notifications de 06:00 et 18:00 sur cet appareil</h3>
      <p class="encre-2">Notifications : <strong>${{ granted: 'autorisées', denied: 'refusées', default: 'pas encore demandées', indisponible: 'non prises en charge ici' }[permNotif]}</strong>. Rappels sur cet appareil : <strong>${serv.actif ? 'activés' : 'non activés'}</strong>. La notification ouvre directement l'évaluation, même application fermée.</p>
      ${estIOS && !estInstallee() ? '<div class="bandeau"><strong>Sur iPhone</strong>Ouvre d\'abord l\'application depuis son icône sur l\'écran d\'accueil : les notifications ne fonctionnent que là.</div>' : ''}
      <div class="rangee">
        <button type="button" class="bouton" data-action="serveur-activer">${serv.actif ? 'Réactiver sur cet appareil' : 'Activer les rappels sur cet appareil'}</button>
        ${serv.actif ? '<button type="button" class="bouton-secondaire" data-action="serveur-tester">Envoyer une notification de test</button><button type="button" class="bouton-discret" data-action="serveur-desactiver">Désactiver</button>' : ''}
      </div>
      <label class="interrupteur" style="margin-top:14px"><input type="checkbox" id="rappel-discret" ${p.titreRappelDiscret ? 'checked' : ''}> <span>Texte de notification discret <span class="doux">(« Rappel du matin » au lieu de « Évaluation du matin »)</span></span></label>
      <div id="synchro">
        <h3 style="margin-top:22px">Synchronisation entre appareils</h3>
        ${synchroActive() ? `<p class="encre-2">État : <strong>activée</strong>. ${p.synchro.erreur ? `Dernière tentative : ${esc(p.synchro.erreur)}.` : p.synchro.derniereUtc ? `Dernière synchronisation : ${C.formatDateHeure(p.synchro.derniereUtc)}.` : ''}</p>
          <p>Chaque évaluation, modification ou réglage est envoyé automatiquement à ton autre appareil, chiffré avec ta phrase de synchronisation.</p>
          <div class="rangee"><button type="button" class="bouton-secondaire" data-action="synchro-maintenant">Synchroniser maintenant</button><button type="button" class="bouton-secondaire" data-action="synchro-code">Copier le code de connexion pour l'autre appareil</button><button type="button" class="bouton-discret" data-action="synchro-desactiver">Désactiver</button></div>
          <textarea id="synchro-code" rows="2" readonly hidden style="margin-top:10px"></textarea>`
    : `<p>Tes évaluations, motifs et réglages restent identiques sur l'iPhone et le PC, automatiquement. Les données sont chiffrées sur l'appareil avec une <strong>phrase de synchronisation</strong> que toi seul connais ; elle doit être la même sur tous tes appareils et n'est jamais envoyée.</p>
          <div class="champ"><label for="synchro-phrase">Phrase de synchronisation <small class="doux">(au moins 12 caractères, par exemple quatre mots ; note-la en lieu sûr)</small></label><input type="password" id="synchro-phrase" autocomplete="new-password" autocapitalize="off" spellcheck="false"></div>
          <button type="button" class="bouton" data-action="synchro-activer">Activer la synchronisation</button>`}
      </div>
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
      ${etat.archives.some((a) => !a.restaureeLeUtc) ? `<h3 style="margin-top:18px">Archives</h3><p class="doux">Évaluations retirées ou écartées lors d'un import. Elles ne sont jamais supprimées automatiquement.</p>
        <ul class="liste-simple">${etat.archives.filter((a) => !a.restaureeLeUtc).sort((a, b) => (a.archiveLeUtc < b.archiveLeUtc ? 1 : -1)).map((a) => `<li><span>${esc(C.formatDateCourte(a.evaluation.date))} ${a.evaluation.creneau}, ${esc(C.libelleNote(a.evaluation.note))}<br><span class="doux">${esc(a.raison)} (${C.formatDateHeure(a.archiveLeUtc)})</span></span><button type="button" class="bouton-discret" data-action="archive-restaurer" data-id="${esc(a.id)}">Restaurer</button></li>`).join('')}</ul>` : ''}
    </div>

    <div class="bloc"><h2>Confidentialité et stockage</h2>
      ${texteConfidentialite()}
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
      emailTherapeute: document.getElementById('email-therapeute').value.trim(),
      contactConfiance: { nom: document.getElementById('contact-nom').value.trim(), telephone: document.getElementById('contact-tel').value.trim() },
    };
    if (modifs.emailTherapeute && !C.estEmailValide(modifs.emailTherapeute)) { annoncer('Adresse e-mail incomplète : vérifie-la (forme nom@domaine.lu).'); document.getElementById('email-therapeute').focus(); return; }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(debutVal)) modifs.debutSuiviUtc = new Date(C.localVersUtc(debutVal.slice(0, 10), debutVal.slice(11))).toISOString();
    await enregistrerParametres(modifs);
    majBoutonPdf();
    annoncer('Réglages enregistrés.');
  });
  document.getElementById('form-identites').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const patient = C.normaliserPatient({ nom: document.getElementById('patient-nom').value, adresse: document.getElementById('patient-adresse').value, cns: document.getElementById('patient-cns').value });
      const therapeute = C.normaliserTherapeute({ nom: document.getElementById('therapeute-nom').value, titre: document.getElementById('therapeute-titre').value, adresse: document.getElementById('therapeute-adresse').value });
      await enregistrerParametres({ patient, therapeute });
      document.getElementById('patient-cns').value = C.formatCNS(patient.cns);
      annoncer('Identités enregistrées.');
    } catch (err) { annoncer(err.message); document.getElementById('patient-cns').focus(); }
  });
  document.getElementById('recherche-lieux').addEventListener('change', async (e) => {
    await enregistrerParametres({ rechercheLieux: e.target.checked });
    annoncer(e.target.checked ? 'Recherche mondiale des lieux activée.' : 'Recherche mondiale désactivée : seuls tes lieux habituels seront proposés.');
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
    <p>Après chaque évaluation commentée, ton texte et tes motifs cochés sont envoyés à un service d'intelligence artificielle qui prépare une version complète, corrigée, traduite en français si tu as écrit en allemand ou en anglais, et rédigée dans un français soigné et professionnel pour ${esc((etat.parametres.destinataire || '').trim() || 'ton thérapeute')}. L'écran de validation s'ouvre aussitôt : tu valides ou tu modifies. Ton texte original reste intact.</p>
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
      <div class="champ"><label for="ia-modele">Modèle</label><input type="text" id="ia-modele" value="${esc(!ia.modele || ia.modele === 'claude-sonnet-5-5' ? 'claude-opus-5-5' : ia.modele)}" spellcheck="false" autocapitalize="off"></div></details>
    <p class="encre-2">Style : toujours à la troisième personne (« Le patient… »), en français soigné.</p>
    <label class="interrupteur"><input type="checkbox" id="ia-auto" ${ia.automatique ? 'checked' : ''}> <span>Préparer automatiquement après chaque évaluation</span></label>
    <div class="bandeau" style="margin-top:14px"><strong>Ton accord</strong>
      <label class="interrupteur" style="margin-top:6px"><input type="checkbox" id="ia-accord" ${pret ? 'checked' : ''}> <span>J'accepte que le texte de mes commentaires et mes motifs cochés soient envoyés au service choisi ci-dessus pour préparer ces versions. Ni mon nom, ni mon adresse, ni mon matricule, ni mes notes, ni les dates, ni mes lieux ne sont envoyés, mais mes textes peuvent eux-mêmes contenir des informations personnelles. Je peux retirer cet accord à tout moment.</span></label></div>
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
      modele: document.getElementById('ia-modele').value.trim() || 'claude-opus-5-5',
      personne: 'troisieme',
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
    const exemple = C.creerEvaluation({ date: aujourdhui(), creneau: 'matin', note: 5, explication: 'je me sent un peu fatiguer aujourdhui, aber ich habe gut geschlafen' });
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
      res.innerHTML = p ? `Test réussi. Exemple : « je me sent un peu fatiguer aujourdhui, aber ich habe gut geschlafen » devient « ${esc(p.explication)} ». La préparation automatique est active.` : 'Le service a répondu, mais sans proposition exploitable. Réessaie.';
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
        const le = new Date(maintenant()).toISOString();
        const v = (a.evaluation.version || 1) + 1;
        const ev = { ...a.evaluation, version: v, modifieLeUtc: le, historique: [...(a.evaluation.historique || []), { le, version: v, raison: 'Restaurée depuis les archives', changements: [] }] };
        await DB.restaurerArchive({ ...a, restaureeLeUtc: le }, ev);
        await chargerEtat();
        planifierSynchro();
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
  if (action === 'ajouter-seance') { dialogueSeance().then((x) => { if (x) router(); }); return; }
  if (action === 'modifier-seance' || action === 'supprimer-seance') {
    const sea = seances().find((x) => x.id === id);
    if (!sea) return;
    if (action === 'modifier-seance') { dialogueSeance(sea).then((x) => { if (x) router(); }); return; }
    confirmer('Supprimer cette séance ?', esc(C.libelleSeance(sea)), 'Supprimer').then(async (ok) => {
      if (!ok) return;
      await enregistrerSeances(seances().filter((x) => x.id !== id));
      annoncer('Séance supprimée.');
      router();
    });
    return;
  }
  if (action === 'masquer-contexte') { enregistrerParametres({ contexteBandeauMasque: true }).then(() => router()); return; }
  if (action === 'masquer-mise-en-route') { enregistrerParametres({ miseEnRouteMasquee: true }).then(() => router()); return; }
  if (action === 'demarrer-synchro') { demarrerParSynchro(); return; }
  if (action === 'synchro-activer') { activerSynchro(); return; }
  if (action === 'synchro-maintenant') { lancerSynchro({ interactif: true }); return; }
  if (action === 'synchro-desactiver') { enregistrerParametres({ synchro: { ...etat.parametres.synchro, actif: false } }).then(() => { annoncer('Synchronisation désactivée sur cet appareil.'); majEtatSynchro(); vueReglages(['synchro']); }); return; }
  if (action === 'synchro-code') { copierCodeConnexion(); return; }
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
    planifierSynchro(0);
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
  majEtatSynchro();
  enregistrerServiceWorker();
  if (etat.parametres) {
    instantaneQuotidien().catch((e) => console.warn(e));
    rattrapageVersions().catch((e) => console.warn(e));
    window.addEventListener('online', () => { rattrapageVersions().catch((e) => console.warn(e)); planifierSynchro(0); });
    planifierSynchro(0);
    setInterval(() => planifierSynchro(0), 5 * 60 * 1000);
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
