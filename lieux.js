// Saisie du lieu (autocomplétion) et de la situation professionnelle.
// Recherche mondiale : service Photon (OpenStreetMap, komoot, Allemagne), seulement si le réglage
// « rechercheLieux » est actif. Seules les lettres tapées sont envoyées, sans aucune autre donnée.
import * as C from './core.js';

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

export function champLieuHTML(id, lieu, { libelle = 'Lieu où tu te trouves', activite = false, itinerance = false } = {}) {
  const itin = C.estItinerance(lieu);
  return `<div class="champ champ-lieu${itin ? ' est-itinerance' : ''}">
    ${itinerance ? `<div class="tete-lieu"><label for="${id}">${esc(libelle)}</label><button type="button" class="puce-action" id="${id}-itinerance" aria-pressed="${itin}" title="Pas de lieu fixe : randonnée, tour à vélo, balade…">Itinérance</button></div>` : `<label for="${id}">${esc(libelle)}</label>`}
    <div class="combo">
      <input type="text" id="${id}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-liste" autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="120"
        placeholder="Tape les premières lettres : Arsdorf, Luxembourg, Lisbonne…" value="${esc(C.libelleLieu(lieu, { complet: true }))}">
      <button type="button" class="combo-effacer" id="${id}-effacer" aria-label="Effacer le lieu" ${lieu ? '' : 'hidden'}>×</button>
      <ul class="combo-liste" id="${id}-liste" role="listbox" aria-label="Lieux proposés" hidden></ul>
    </div>
    <p class="doux combo-etat" id="${id}-etat" aria-live="polite"></p>
    ${activite ? `<div class="champ-activite">
      <label for="${id}-activite">Ce que tu y as fait <small class="doux">(facultatif)</small></label>
      <input type="text" id="${id}-activite" list="liste-activites" autocomplete="off" autocapitalize="sentences" maxlength="${C.LONGUEUR_ACTIVITE}" placeholder="Courses, restaurant, visite familiale…" value="${esc(lieu && lieu.activite ? lieu.activite : '')}">
    </div>` : ''}
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
    if (k.startsWith('itinerance')) return { ...C.LIEU_ITINERANCE };
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

const NB_PROPOSES = C.MAX_LIEUX;
const idLieu = (i) => (i === 0 ? 'lieu' : `lieu-${i + 1}`);
const ordinal = (i) => (i === 0 ? '1er lieu' : `${i + 1}e lieu`);

export function champLieuxHTML(lieux, { activites = [] } = {}) {
  const n = Math.max(1, Math.min(NB_PROPOSES, (lieux || []).length || 1));
  return `<div class="champ-lieux" id="zone-lieux">
    <fieldset class="champ nombre-lieux">
      <legend>Nombre de lieux</legend>
      <div class="segmente">${Array.from({ length: NB_PROPOSES }, (_, i) => `<label><input type="radio" name="nb-lieux" value="${i + 1}" ${i + 1 === n ? 'checked' : ''}><span>${i + 1}</span></label>`).join('')}</div>
      <p class="doux aide-lieux" ${n > 1 ? '' : 'hidden'}>Indique-les dans l'ordre où tu y es allé.</p>
    </fieldset>
    <div id="liste-lieux">${champsHTML(lieux, n)}</div>
    <datalist id="liste-activites">${activites.map((a) => `<option value="${esc(a)}"></option>`).join('')}</datalist>
  </div>`;
}

function champsHTML(lieux, n) {
  return Array.from({ length: n }, (_, i) => champLieuHTML(idLieu(i), (lieux || [])[i] || null, { libelle: n === 1 ? 'Lieu' : ordinal(i), activite: true, itinerance: true })).join('');
}

/** Branche le choix du nombre de lieux et les champs ; retourne { valeurs() } → liste ordonnée (cases vides ignorées). */
export function brancherChampLieux(racine, { initial = [], connus = [], enLigne = true, fetch: f } = {}) {
  const zone = racine.querySelector('#zone-lieux');
  const liste = zone.querySelector('#liste-lieux');
  const aide = zone.querySelector('.aide-lieux');
  let champs = [];
  const brancher = (valeurs) => {
    champs = valeurs.map((v, i) => {
      const id = idLieu(i);
      const boutonItin = document.getElementById(`${id}-itinerance`);
      const marquer = (l) => {
        const itin = C.estItinerance(l);
        boutonItin.setAttribute('aria-pressed', String(itin));
        boutonItin.closest('.champ-lieu').classList.toggle('est-itinerance', itin);
      };
      const champ = brancherChampLieu(id, { initial: v ? C.lieuSansActivite(v) : null, connus, enLigne, fetch: f, surChangement: marquer });
      boutonItin.addEventListener('click', () => {
        if (C.estItinerance(champ.valeur())) { champ.definir(null); marquer(null); document.getElementById(id).focus(); return; }
        champ.definir({ ...C.LIEU_ITINERANCE });
        marquer(C.LIEU_ITINERANCE);
        document.getElementById(`${id}-activite`).focus();
      });
      const activite = document.getElementById(`${id}-activite`);
      return { valeur: () => { const l = champ.valeur(); const a = activite.value.trim(); return l ? C.normaliserLieu({ ...l, activite: a }) : null; } };
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
