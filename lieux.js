// Saisie du lieu (autocomplétion) et de la situation professionnelle.
// Recherche mondiale : service Photon (OpenStreetMap, komoot, Allemagne), seulement si le réglage
// « rechercheLieux » est actif. Seules les lettres tapées sont envoyées, sans aucune autre donnée.
import * as C from './core.js';
import { iconeMeteo } from './meteo.js';

const PHOTON = 'https://photon.komoot.io/api/';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Recherche de localités dans le monde entier. Lève une erreur si le service ne répond pas. */
export async function rechercherEnLigne(texte, { signal, fetch: f = globalThis.fetch.bind(globalThis) } = {}) {
  const q = encodeURIComponent(texte.trim());
  const essais = [`${PHOTON}?q=${q}&limit=12&lang=fr&osm_tag=place`, `${PHOTON}?q=${q}&limit=12`];
  let derniere = null;
  for (const url of essais) {
    const rep = await f(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', headers: { accept: 'application/json' } });
    if (rep.ok) return C.lieuxDepuisPhoton(await rep.json()).slice(0, 8);
    derniere = rep.status;
    if (rep.status !== 400) break;
  }
  throw new Error(`service de recherche indisponible (${derniere})`);
}

/** Ressenti sur place : une rangée de 11 pictogrammes (0 à 10), facultative ; un 2e appui efface. */
function champRessentiHTML(id, valeur) {
  const v = C.ressentiValide(valeur);
  return `<div class="champ-ressenti" id="${id}-ressenti" data-valeur="${v ?? ''}">
      <p class="ressenti-tete"><span>Ressenti ici <small class="doux">(facultatif)</small></span><span class="ressenti-etat doux" id="${id}-ressenti-etat" aria-live="polite">${etatRessenti(v)}</span></p>
      <div class="ressenti-echelle" role="radiogroup" aria-label="Ressenti à ce lieu, de 0 à 10">${C.NIVEAUX.map((nom, i) => `<button type="button" role="radio" aria-checked="${v === i}" data-v="${i}" title="${i} – ${esc(nom)}" aria-label="${i} – ${esc(nom)}" style="--c: var(--n${i})">${iconeMeteo(i, { taille: 22 })}<span>${i}</span></button>`).join('')}</div>
    </div>`;
}
/** Moyen de déplacement pour « En route » : facultatif, un appui ; un 2e appui efface. */
function champTransportHTML(id, valeur, visible) {
  const v = C.TRANSPORTS[valeur] ? valeur : '';
  return `<div class="champ-transport" id="${id}-transport" data-valeur="${v}" ${visible ? '' : 'hidden'}>
      <p class="ressenti-tete"><span>Comment ? <small class="doux">(facultatif)</small></span></p>
      <div class="puces-transport" role="radiogroup" aria-label="Moyen de déplacement">${C.ORDRE_TRANSPORTS.map((t) => `<button type="button" class="puce-action" role="radio" aria-pressed="${t === v}" aria-checked="${t === v}" data-t="${t}">${esc(C.LIBELLE_COURT_TRANSPORT[t])}</button>`).join('')}</div>
    </div>`;
}

function brancherTransport(zone) {
  if (!zone) return null;
  zone.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const v = zone.dataset.valeur === b.dataset.t ? '' : b.dataset.t;
    zone.dataset.valeur = v;
    zone.querySelectorAll('[data-t]').forEach((x) => { x.setAttribute('aria-pressed', String(x.dataset.t === v)); x.setAttribute('aria-checked', String(x.dataset.t === v)); });
  });
  return () => zone.dataset.valeur || null;
}

const etatRessenti = (v) => (v === null ? 'comme la note de la période' : esc(C.libelleNote(v)));

export function champLieuHTML(id, lieu, { libelle = 'Lieu où tu te trouves', activite = false, itinerance = false, ressenti = false } = {}) {
  const itin = C.estItinerance(lieu);
  return `<div class="champ champ-lieu${itin ? ' est-itinerance' : ''}">
    ${itinerance ? `<div class="tete-lieu"><label for="${id}">${esc(libelle)}</label><button type="button" class="puce-action" id="${id}-itinerance" aria-pressed="${itin}" title="Déplacement : à pied, vélo, voiture, bus, train, avion, bateau…">En route</button></div>` : `<label for="${id}">${esc(libelle)}</label>`}
    <div class="combo">
      <input type="text" id="${id}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-liste" autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="120"
        placeholder="Tape les premières lettres : Arsdorf, Luxembourg, Lisbonne…" value="${esc(C.libelleLieu(lieu, { complet: true }))}">
      <button type="button" class="combo-effacer" id="${id}-effacer" aria-label="Effacer le lieu" ${lieu ? '' : 'hidden'}>×</button>
      <ul class="combo-liste" id="${id}-liste" role="listbox" aria-label="Lieux proposés" hidden></ul>
    </div>
    <p class="doux combo-etat" id="${id}-etat" aria-live="polite"></p>
    ${itinerance ? champTransportHTML(id, itin ? lieu.transport : null, itin) : ''}
    ${activite ? `<div class="champ-activite">
      <label for="${id}-activite">Ce que tu y as fait <small class="doux">(facultatif)</small></label>
      <div class="combo">
        <input type="text" id="${id}-activite" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-activite-liste" autocomplete="off" autocapitalize="sentences" maxlength="${C.LONGUEUR_ACTIVITE}" placeholder="Tape les premières lettres : courses, restaurant…" value="${esc(lieu && lieu.activite ? lieu.activite : '')}">
        <ul class="combo-liste" id="${id}-activite-liste" role="listbox" aria-label="Activités proposées" hidden></ul>
      </div>
    </div>` : ''}
    ${ressenti ? champRessentiHTML(id, lieu ? lieu.ressenti : null) : ''}
  </div>`;
}

/**
 * Branche l'autocomplétion. connus = C.lieuxConnus(...) ; enLigne = recherche mondiale autorisée.
 * Retourne { valeur() } : le lieu choisi, un lieu connu correspondant au texte, ou un lieu libre.
 */
export function brancherChampLieu(id, { initial = null, connus = [], enLigne = true, surChangement = () => {}, fetch: f } = {}) {
  const input = document.getElementById(id);
  const liste = document.getElementById(`${id}-liste`);
  const etat = document.getElementById(`${id}-etat`);
  const effacer = document.getElementById(`${id}-effacer`);
  let choisi = initial;
  let options = [];
  let actif = -1;
  let minuterie = null;
  let controleur = null;
  let requete = 0;

  const decrire = () => {
    if (!input.value.trim()) { etat.textContent = ''; return; }
    const l = resoudre();
    if (!l || C.estItinerance(l)) etat.textContent = '';
    else if (l.source === 'carte') etat.textContent = `Lieu reconnu : ${[l.nom, l.region, l.pays].filter(Boolean).join(', ')}.`;
    else etat.textContent = 'Lieu enregistré tel que tu l\'as écrit. Pour qu\'il soit reconnu sur la carte, choisis une proposition de la liste.';
  };

  const fermer = () => { liste.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); actif = -1; };

  const dessiner = (locaux, distants, message) => {
    options = [...locaux.map((c) => c.lieu), ...distants];
    const ligne = (l, i) => `<li role="option" id="${id}-opt-${i}" data-i="${i}" aria-selected="false"><span class="combo-nom">${esc(l.nom)}</span>${l.region || l.pays ? ` <span class="doux">${esc([l.region, l.pays].filter(Boolean).join(', '))}</span>` : ''}</li>`;
    let html = '';
    if (locaux.length) html += `<li role="presentation" class="combo-groupe">Tes lieux</li>${locaux.map((c, i) => ligne(c.lieu, i)).join('')}`;
    if (distants.length) html += `<li role="presentation" class="combo-groupe">Dans le monde</li>${distants.map((l, i) => ligne(l, i + locaux.length)).join('')}`;
    if (message) html += `<li role="presentation" class="combo-message doux">${esc(message)}</li>`;
    liste.innerHTML = html;
    liste.hidden = !html;
    input.setAttribute('aria-expanded', String(!!html));
    actif = -1;
  };

  const choisir = (l) => {
    choisi = l;
    input.value = C.libelleLieu(l, { complet: true });
    effacer.hidden = false;
    fermer();
    decrire();
    surChangement(l);
  };

  const marquer = (i) => {
    const items = liste.querySelectorAll('[role="option"]');
    items.forEach((li) => li.setAttribute('aria-selected', 'false'));
    if (i < 0 || i >= items.length) { actif = -1; input.removeAttribute('aria-activedescendant'); return; }
    actif = i;
    items[i].setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', items[i].id);
    items[i].scrollIntoView({ block: 'nearest' });
  };

  const chercher = () => {
    const texte = input.value.trim();
    const locaux = C.filtrerLieux(connus, texte, texte ? 5 : 6);
    // Les lieux déjà connus ne sont pas répétés dans les résultats mondiaux
    const dejaVus = new Set(locaux.map((c) => C.cleLieu(c.lieu)));
    clearTimeout(minuterie);
    if (controleur) controleur.abort();
    if (!enLigne || texte.length < 2) {
      dessiner(locaux, [], !enLigne && texte.length >= 2 && !locaux.length ? 'Recherche mondiale désactivée (Réglages) : ton texte sera enregistré tel quel.' : '');
      return;
    }
    if (!navigator.onLine) { dessiner(locaux, [], 'Hors connexion : seuls tes lieux habituels sont proposés.'); return; }
    dessiner(locaux, [], 'Recherche dans le monde…');
    const n = ++requete;
    minuterie = setTimeout(async () => {
      controleur = new AbortController();
      try {
        const res = await rechercherEnLigne(texte, { signal: controleur.signal, fetch: f });
        if (n !== requete || document.activeElement !== input) return; // l'utilisateur est passé à autre chose
        const distants = res.filter((l) => !dejaVus.has(C.cleLieu(l)));
        dessiner(locaux, distants, distants.length || locaux.length ? '' : 'Aucun lieu trouvé : ton texte sera enregistré tel quel.');
      } catch (e) {
        if (e.name === 'AbortError' || n !== requete || document.activeElement !== input) return;
        dessiner(locaux, [], 'Recherche mondiale momentanément indisponible : ton texte sera enregistré tel quel.');
      }
    }, 300);
  };

  input.addEventListener('input', () => { choisi = null; effacer.hidden = !input.value; etat.textContent = ''; chercher(); surChangement(null); });
  input.addEventListener('focus', () => { if (!input.value) chercher(); });
  input.addEventListener('keydown', (e) => {
    const n = liste.querySelectorAll('[role="option"]').length;
    if (e.key === 'ArrowDown') { e.preventDefault(); if (liste.hidden) chercher(); else marquer(Math.min(n - 1, actif + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marquer(Math.max(0, actif - 1)); }
    else if (e.key === 'Enter') { if (!liste.hidden && actif >= 0) { e.preventDefault(); choisir(options[actif]); } else if (!liste.hidden) { e.preventDefault(); fermer(); decrire(); } }
    else if (e.key === 'Escape') { if (!liste.hidden) { e.preventDefault(); fermer(); } }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (!liste.contains(document.activeElement)) { fermer(); decrire(); } }, 150));
  // pointerdown : choisir avant que le champ ne perde le focus
  liste.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li) return;
    e.preventDefault();
    choisir(options[Number(li.dataset.i)]);
  });
  effacer.addEventListener('click', () => { choisi = null; input.value = ''; effacer.hidden = true; etat.textContent = ''; surChangement(null); input.focus(); });

  function resoudre() {
    const t = input.value.trim();
    if (!t) return null;
    if (choisi && (t === C.libelleLieu(choisi, { complet: true }) || t === choisi.nom)) return choisi;
    const k = C.normaliserLibelle(t);
    if (k.startsWith('itinerance') || k.startsWith('en route')) return { ...C.LIEU_ITINERANCE };
    const connu = connus.find((c) => C.normaliserLibelle(c.lieu.nom) === k || C.normaliserLibelle(C.libelleLieu(c.lieu, { complet: true })) === k);
    if (connu) return connu.lieu;
    return C.normaliserLieu({ nom: t, source: 'libre' });
  }
  if (initial) decrire();
  return { valeur: resoudre, definir: (l) => { if (l) choisir(l); else { choisi = null; input.value = ''; effacer.hidden = true; etat.textContent = ''; } } };
}

export function champSituationHTML(nom, situation, { avecEffacer = true, legende = 'Situation professionnelle' } = {}) {
  const st = situation ? situation.statut : '';
  const mod = situation ? situation.modalite : '';
  return `<fieldset class="champ champ-situation" data-situation="${nom}">
    <legend>${esc(legende)}</legend>
    <div class="puces">${C.ORDRE_SITUATIONS.map((s) => `<label class="puce"><input type="radio" name="${nom}" value="${s}" ${st === s ? 'checked' : ''}><span>${esc(C.SITUATIONS[s])}</span></label>`).join('')}</div>
    <div class="modalite" ${C.SITUATIONS_AVEC_MODALITE.includes(st) ? '' : 'hidden'}>
      <p class="doux" style="margin:10px 0 6px">Où travailles-tu ?</p>
      <div class="segmente">${Object.entries(C.MODALITES).map(([v, l]) => `<label><input type="radio" name="${nom}-modalite" value="${v}" ${mod === v ? 'checked' : ''}><span>${esc(l)}</span></label>`).join('')}</div>
    </div>
    ${avecEffacer ? `<p style="margin:6px 0 0"><button type="button" class="bouton-discret" data-effacer-situation="${nom}" ${st ? '' : 'hidden'}>Ne rien indiquer</button></p>` : ''}
  </fieldset>`;
}

/** Branche le champ de situation ; retourne { valeur() } → { statut, modalite } ou null. */
export function brancherChampSituation(racine, nom, { surChangement = () => {} } = {}) {
  const zone = racine.querySelector(`[data-situation="${nom}"]`);
  const modalite = zone.querySelector('.modalite');
  const effacer = zone.querySelector(`[data-effacer-situation="${nom}"]`);
  const lire = () => {
    const st = zone.querySelector(`[name="${nom}"]:checked`);
    if (!st) return null;
    const m = zone.querySelector(`[name="${nom}-modalite"]:checked`);
    return C.normaliserSituation({ statut: st.value, modalite: m ? m.value : null });
  };
  const maj = () => {
    const v = lire();
    modalite.hidden = !(v && C.SITUATIONS_AVEC_MODALITE.includes(v.statut));
    if (effacer) effacer.hidden = !v;
    surChangement(v);
  };
  zone.addEventListener('change', maj);
  if (effacer) effacer.addEventListener('click', () => { zone.querySelectorAll('input').forEach((i) => { i.checked = false; }); maj(); });
  return { valeur: lire };
}

// ---------------------------------------------------------------------------
// Plusieurs lieux pour une même évaluation, dans l'ordre (par ex. Arsdorf → Schouweiler → Leudelange → Arsdorf)

// Nombre de cases proposées : 3, ou davantage pour une ancienne évaluation qui en a plus (versions 1.12-1.13)
const nbProposes = (lieux) => Math.min(C.MAX_LIEUX_ANCIENS, Math.max(C.MAX_LIEUX, (lieux || []).length));
const idLieu = (i) => (i === 0 ? 'lieu' : `lieu-${i + 1}`);
const ordinal = (i) => (i === 0 ? '1er lieu' : `${i + 1}e lieu`);

export function champLieuxHTML(lieux) {
  const max = nbProposes(lieux);
  const n = Math.max(1, Math.min(max, (lieux || []).length || 1));
  return `<div class="champ-lieux" id="zone-lieux">
    <fieldset class="champ nombre-lieux">
      <legend>Nombre de lieux</legend>
      <div class="segmente">${Array.from({ length: max }, (_, i) => `<label><input type="radio" name="nb-lieux" value="${i + 1}" ${i + 1 === n ? 'checked' : ''}><span>${i + 1}</span></label>`).join('')}</div>
      <p class="doux aide-lieux" ${n > 1 ? '' : 'hidden'}>Indique-les dans l'ordre où tu y es allé. Si ton humeur a été différente selon le lieu, touche la météo ressentie sur place ; sinon, la note de la période s'applique.</p>
    </fieldset>
    <div id="liste-lieux">${champsHTML(lieux, n)}</div>
  </div>`;
}

function champsHTML(lieux, n) {
  return Array.from({ length: n }, (_, i) => champLieuHTML(idLieu(i), (lieux || [])[i] || null, { libelle: n === 1 ? 'Lieu' : ordinal(i), activite: true, itinerance: true, ressenti: n > 1 })).join('');
}

/** Branche le choix du nombre de lieux et les champs ; retourne { valeurs() } → liste ordonnée (cases vides ignorées). */
export function brancherChampLieux(racine, { initial = [], connus = [], activites = [], enLigne = true, fetch: f } = {}) {
  const zone = racine.querySelector('#zone-lieux');
  const liste = zone.querySelector('#liste-lieux');
  const aide = zone.querySelector('.aide-lieux');
  let champs = [];
  const brancher = (valeurs) => {
    champs = valeurs.map((v, i) => {
      const id = idLieu(i);
      const boutonItin = document.getElementById(`${id}-itinerance`);
      const zoneTransport = document.getElementById(`${id}-transport`);
      const transport = brancherTransport(zoneTransport);
      const marquer = (l) => {
        const itin = C.estItinerance(l);
        boutonItin.setAttribute('aria-pressed', String(itin));
        boutonItin.closest('.champ-lieu').classList.toggle('est-itinerance', itin);
        zoneTransport.hidden = !itin;
      };
      const champ = brancherChampLieu(id, { initial: v ? C.lieuSansActivite(v) : null, connus, enLigne, fetch: f, surChangement: marquer });
      boutonItin.addEventListener('click', () => {
        if (C.estItinerance(champ.valeur())) { champ.definir(null); marquer(null); document.getElementById(id).focus(); return; }
        champ.definir({ ...C.LIEU_ITINERANCE });
        marquer(C.LIEU_ITINERANCE);
      });
      const activite = document.getElementById(`${id}-activite`);
      brancherComboActivite(activite, activites);
      const ressenti = brancherRessenti(document.getElementById(`${id}-ressenti`));
      return { valeur: () => { const l = champ.valeur(); const a = activite.value.trim(); const r = ressenti ? ressenti() : (v ? v.ressenti : null); return l ? C.normaliserLieu({ ...l, activite: a, ressenti: r, transport: transport() }) : null; } };
    });
  };
  brancher(Array.from({ length: Math.max(1, initial.length) }, (_, i) => initial[i] || null));
  // Valeurs saisies, y compris celles des cases masquées quand on réduit le nombre (pour pouvoir revenir en arrière)
  let memoire = [...initial];
  zone.addEventListener('change', (e) => {
    if (e.target.name !== 'nb-lieux') return;
    const n = Number(e.target.value);
    champs.forEach((c, i) => { memoire[i] = c.valeur(); });
    const valeurs = Array.from({ length: n }, (_, i) => memoire[i] || null);
    liste.innerHTML = champsHTML(valeurs, n);
    aide.hidden = n < 2;
    brancher(valeurs);
    // Curseur dans la première case vide
    const vide = valeurs.findIndex((v) => !v);
    if (vide >= 0) document.getElementById(idLieu(vide)).focus();
  });
  return { valeurs: () => champs.map((c) => c.valeur()).filter(Boolean) };
}

/** Branche la rangée de ressenti ; retourne une fonction de lecture (null si non indiqué), ou null sans rangée. */
function brancherRessenti(zone) {
  if (!zone) return null;
  const lire = () => C.ressentiValide(zone.dataset.valeur === '' ? null : Number(zone.dataset.valeur));
  const definir = (v) => {
    zone.dataset.valeur = v ?? '';
    zone.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-checked', String(Number(b.dataset.v) === v)));
    zone.querySelector('.ressenti-etat').innerHTML = etatRessenti(v);
  };
  zone.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    const v = Number(b.dataset.v);
    definir(lire() === v ? null : v);
  });
  zone.addEventListener('keydown', (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    e.preventDefault();
    const v = Math.max(0, Math.min(10, (lire() ?? 5) + (e.key === 'ArrowRight' ? 1 : -1)));
    definir(v);
    zone.querySelector(`[data-v="${v}"]`).focus();
  });
  return lire;
}

/**
 * Saisie semi-automatique des activités : dès la première lettre, propose les activités déjà saisies
 * (les plus fréquentes d'abord) puis les suggestions de départ. Tout reste local à l'appareil.
 */
export function brancherComboActivite(input, activites) {
  const liste = document.getElementById(`${input.id}-liste`);
  let options = [];
  let actif = -1;
  const fermer = () => { liste.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); actif = -1; };
  const ouvrir = () => {
    options = C.filtrerActivites(activites, input.value, 8);
    if (!options.length || document.activeElement !== input) { fermer(); return; }
    liste.innerHTML = options.map((a, i) => `<li role="option" id="${input.id}-opt-${i}" data-i="${i}" aria-selected="false">${esc(a)}</li>`).join('');
    liste.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    actif = -1;
  };
  const marquer = (i) => {
    const items = liste.querySelectorAll('[role="option"]');
    items.forEach((li) => li.setAttribute('aria-selected', 'false'));
    if (i < 0 || i >= items.length) { actif = -1; return; }
    actif = i;
    items[i].setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', items[i].id);
    items[i].scrollIntoView({ block: 'nearest' });
  };
  const choisir = (a) => { input.value = a; fermer(); };
  input.addEventListener('input', ouvrir);
  input.addEventListener('focus', () => { if (input.value) ouvrir(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (liste.hidden) ouvrir(); else marquer(Math.min(options.length - 1, actif + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marquer(Math.max(0, actif - 1)); }
    else if (e.key === 'Enter' && !liste.hidden) { e.preventDefault(); if (actif >= 0) choisir(options[actif]); else fermer(); }
    else if (e.key === 'Escape' && !liste.hidden) { e.preventDefault(); fermer(); }
  });
  input.addEventListener('blur', () => setTimeout(fermer, 150));
  liste.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('[role="option"]');
    if (!li) return;
    e.preventDefault();
    choisir(options[Number(li.dataset.i)]);
  });
}
