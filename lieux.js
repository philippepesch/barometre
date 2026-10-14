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

export function champLieuHTML(id, lieu) {
  return `<div class="champ champ-lieu">
    <label for="${id}">Lieu où tu te trouves</label>
    <div class="combo">
      <input type="text" id="${id}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}-liste" autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="120"
        placeholder="Tape les premières lettres : Arsdorf, Luxembourg, Lisbonne…" value="${esc(C.libelleLieu(lieu, { complet: true }))}">
      <button type="button" class="combo-effacer" id="${id}-effacer" aria-label="Effacer le lieu" ${lieu ? '' : 'hidden'}>×</button>
      <ul class="combo-liste" id="${id}-liste" role="listbox" aria-label="Lieux proposés" hidden></ul>
    </div>
    <p class="doux combo-etat" id="${id}-etat" aria-live="polite"></p>
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
    if (!l) etat.textContent = '';
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
        if (n !== requete) return;
        const distants = res.filter((l) => !dejaVus.has(C.cleLieu(l)));
        dessiner(locaux, distants, distants.length || locaux.length ? '' : 'Aucun lieu trouvé : ton texte sera enregistré tel quel.');
      } catch (e) {
        if (e.name === 'AbortError' || n !== requete) return;
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
