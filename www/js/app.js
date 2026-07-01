/* ============================================================
   HOUBLON — logique de l'application
   - Recupere la position GPS (plugin Capacitor sur mobile, sinon
     l'API du navigateur pour tester dans un onglet web).
   - Interroge l'API Overpass (OpenStreetMap) pour lister les
     micro-brasseries autour de la position.
   - Affiche les resultats sur une carte Leaflet + une liste.
   ============================================================ */

'use strict';

// ---------- Etat global ----------
const state = {
  map: null,
  userMarker: null,
  accuracyCircle: null,
  markers: {},          // id -> marqueur Leaflet
  breweries: [],        // liste courante
  radius: 5000,         // metres
  userPos: null,        // { lat, lon }
  activeId: null,
};

// ---------- Elements du DOM ----------
const el = {
  status:      document.getElementById('status'),
  locateBtn:   document.getElementById('locateBtn'),
  radiusChips: document.getElementById('radiusChips'),
  sheet:       document.getElementById('sheet'),
  sheetToggle: document.getElementById('sheetToggle'),
  sheetTitle:  document.getElementById('sheetTitle'),
  taplist:     document.getElementById('taplist'),
  detail:      document.getElementById('detail'),
  detailBack:  document.getElementById('detailBack'),
  detailBody:  document.getElementById('detailBody'),
};

// ============================================================
//  Carte
// ============================================================
function initMap() {
  state.map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    center: [46.6, 2.4],   // centre de la France par defaut
    zoom: 5,
    minZoom: 3,            // evite la vue "monde entier" avec bandes noires
    worldCopyJump: true,
  });
  state.map.setView([46.6, 2.4], 5);

  // Fond de carte OpenStreetMap (assombri via CSS). Fiable, sans cle.
  // Pour changer de style, remplacez simplement l'URL ci-dessous.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap',
  }).addTo(state.map);

  // Mention en bas a gauche : laisse le coin bas-droit libre pour le bouton.
  if (state.map.attributionControl) state.map.attributionControl.setPosition('bottomleft');
}

// ============================================================
//  Geolocalisation
// ============================================================
async function getPosition() {
  const cap = window.Capacitor;
  const isNative = cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform();

  // Sur mobile : plugin Geolocation de Capacitor (gere les permissions Android).
  // On recupere le plugin via Plugins.Geolocation, ou via registerPlugin qui est
  // la methode fiable quand le paquet JS n'est pas importe par un bundler.
  if (isNative) {
    let Geo = (cap.Plugins && cap.Plugins.Geolocation) ||
              (typeof cap.registerPlugin === 'function' ? cap.registerPlugin('Geolocation') : null);
    if (Geo) {
      // Declenche la fenetre d'autorisation Android au premier lancement.
      try { await Geo.requestPermissions(); } catch (e) { /* certaines versions n'exposent pas cette methode */ }
      const pos = await Geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 20000 });
      return { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
    }
  }

  // Sinon : API du navigateur (test dans un onglet)
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('La geolocalisation n\'est pas disponible sur cet appareil.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

// ============================================================
//  Requete Overpass (donnees OpenStreetMap)
// ============================================================
async function fetchBreweries(lat, lon, radius) {
  const query =
    '[out:json][timeout:25];' +
    '(' +
      `nwr["craft"="brewery"](around:${radius},${lat},${lon});` +
      `nwr["microbrewery"="yes"](around:${radius},${lat},${lon});` +
      `nwr["industrial"="brewery"](around:${radius},${lat},${lon});` +
    ');' +
    'out center tags;';

  // Deux serveurs Overpass : si le premier echoue, on essaie le second.
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  let lastError;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (!res.ok) { lastError = new Error('Serveur occupe (' + res.status + ')'); continue; }
      const data = await res.json();
      return data.elements || [];
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error('Serveur de donnees injoignable.');
}

// ============================================================
//  Transformation + tri des resultats
// ============================================================
function distanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseBreweries(elements, userLat, userLon) {
  const byKey = new Map();

  for (const item of elements) {
    let lat, lon;
    if (item.type === 'node') { lat = item.lat; lon = item.lon; }
    else if (item.center) { lat = item.center.lat; lon = item.center.lon; }
    else continue;

    const tags = item.tags || {};
    const name = tags.name || tags.brand || 'Brasserie sans nom';
    const dist = distanceKm(userLat, userLon, lat, lon);

    // Dedoublonnage : meme nom (ou memes coordonnees) => on garde le plus proche.
    const key = tags.name ? tags.name.toLowerCase() : lat.toFixed(4) + ',' + lon.toFixed(4);
    const brewery = { id: item.type + '/' + item.id, lat, lon, tags, name, dist };
    const existing = byKey.get(key);
    if (!existing || dist < existing.dist) byKey.set(key, brewery);
  }

  return Array.from(byKey.values()).sort((a, b) => a.dist - b.dist);
}

// ============================================================
//  Rendu : marqueurs sur la carte
// ============================================================
function clearMarkers() {
  for (const id in state.markers) state.map.removeLayer(state.markers[id]);
  state.markers = {};
}

function renderMarkers(breweries) {
  clearMarkers();
  for (const b of breweries) {
    const icon = L.divIcon({
      className: '',
      html: '<div class="pin-brewery"><span>&#127866;</span></div>',
      iconSize: [30, 30],
      iconAnchor: [15, 28],
      popupAnchor: [0, -26],
    });
    const marker = L.marker([b.lat, b.lon], { icon })
      .addTo(state.map)
      .bindPopup('<b>' + escapeHtml(b.name) + '</b><br>' + b.dist.toFixed(1) + ' km');
    marker.on('click', () => selectBrewery(b.id, false));
    state.markers[b.id] = marker;
  }
}

function placeUser(lat, lon, acc) {
  if (state.userMarker) state.map.removeLayer(state.userMarker);
  if (state.accuracyCircle) state.map.removeLayer(state.accuracyCircle);

  const icon = L.divIcon({ className: '', html: '<div class="pin-user"></div>', iconSize: [22, 22], iconAnchor: [11, 11] });
  state.userMarker = L.marker([lat, lon], { icon, zIndexOffset: 1000 }).addTo(state.map);

  if (acc && acc < 2000) {
    state.accuracyCircle = L.circle([lat, lon], {
      radius: acc, color: '#9fbe4f', weight: 1, opacity: 0.4, fillColor: '#9fbe4f', fillOpacity: 0.06,
    }).addTo(state.map);
  }
}

// ============================================================
//  Rendu : liste "carte des bieres"
// ============================================================
function subtitleFor(tags) {
  const bits = [];
  if (tags['addr:city']) bits.push(tags['addr:city']);
  else if (tags['addr:suburb']) bits.push(tags['addr:suburb']);
  if (tags.brewery && tags.brewery !== 'yes') bits.push(tags.brewery.split(';')[0]);
  else if (tags.amenity === 'pub') bits.push('Pub-brasserie');
  else bits.push('Micro-brasserie');
  return bits.join(' \u00b7 ');
}

function renderList(breweries) {
  el.taplist.innerHTML = '';

  if (breweries.length === 0) {
    const li = document.createElement('li');
    li.innerHTML =
      '<div class="empty"><strong>Aucune brasserie ici</strong>' +
      '<span>Aucune micro-brasserie repertoriee dans ce rayon sur OpenStreetMap. ' +
      'Essayez un rayon plus large, ou deplacez-vous.</span></div>';
    el.taplist.appendChild(li);
    return;
  }

  for (const b of breweries) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'tap';
    btn.dataset.id = b.id;
    btn.innerHTML =
      '<span class="tap-mark">&#127866;</span>' +
      '<span class="tap-body">' +
        '<span class="tap-top">' +
          '<span class="tap-name">' + escapeHtml(b.name) + '</span>' +
          '<span class="tap-leader"></span>' +
          '<span class="tap-dist">' + formatDist(b.dist) + '</span>' +
        '</span>' +
        '<span class="tap-sub">' + escapeHtml(subtitleFor(b.tags)) + '</span>' +
      '</span>';
    btn.addEventListener('click', () => selectBrewery(b.id, true));
    li.appendChild(btn);
    el.taplist.appendChild(li);
  }
}

// ============================================================
//  Selection d'une brasserie (depuis la liste ou la carte)
// ============================================================
function selectBrewery(id, openDetail) {
  const b = state.breweries.find((x) => x.id === id);
  if (!b) return;
  state.activeId = id;

  // Met en avant le marqueur
  for (const mid in state.markers) {
    const node = state.markers[mid].getElement();
    if (node) { const pin = node.querySelector('.pin-brewery'); if (pin) pin.classList.toggle('is-active', mid === id); }
  }
  // Met en avant la ligne de la liste
  el.taplist.querySelectorAll('.tap').forEach((t) => t.classList.toggle('is-active', t.dataset.id === id));

  state.map.panTo([b.lat, b.lon], { animate: true });
  if (openDetail) showDetail(b);
}

// ============================================================
//  Fiche detaillee
// ============================================================
function detailRow(key, valueHtml) {
  return '<div class="d-row"><div class="d-key">' + key + '</div><div class="d-val">' + valueHtml + '</div></div>';
}

function showDetail(b) {
  const t = b.tags;
  const rows = [];

  if (t.description) rows.push(detailRow('A propos', escapeHtml(t.description)));

  if (t.brewery && t.brewery !== 'yes') {
    rows.push(detailRow('Bieres', escapeHtml(t.brewery.split(';').join(', '))));
  }

  const addr = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const city = [t['addr:postcode'], t['addr:city']].filter(Boolean).join(' ');
  const fullAddr = [addr, city].filter(Boolean).join(', ');
  if (fullAddr) rows.push(detailRow('Adresse', escapeHtml(fullAddr)));

  if (t.opening_hours) rows.push(detailRow('Horaires', escapeHtml(t.opening_hours)));

  const phone = t.phone || t['contact:phone'];
  if (phone) rows.push(detailRow('Telephone', '<a href="tel:' + escapeHtml(phone.replace(/\s/g, '')) + '">' + escapeHtml(phone) + '</a>'));

  const site = t.website || t['contact:website'];
  if (site) {
    const clean = site.replace(/^https?:\/\//, '').replace(/\/$/, '');
    rows.push(detailRow('Site', '<a href="' + escapeHtml(ensureHttp(site)) + '" target="_blank" rel="noopener">' + escapeHtml(clean) + '</a>'));
  }

  // Badges
  const badges = ['<span class="badge badge-dist">' + formatDist(b.dist) + ' d\'ici</span>'];
  if (t.craft === 'brewery' || t.industrial === 'brewery') badges.push('<span class="badge">Brasserie artisanale</span>');
  if (t.microbrewery === 'yes') badges.push('<span class="badge">Micro-brasserie</span>');
  if (t.real_ale === 'yes') badges.push('<span class="badge">Real ale</span>');

  // Boutons d'action
  const mapsUrl = 'https://www.google.com/maps/dir/?api=1&destination=' + b.lat + ',' + b.lon;
  const actions =
    '<div class="d-actions">' +
      '<a class="d-btn d-btn-primary" href="' + mapsUrl + '" target="_blank" rel="noopener">Itineraire</a>' +
      (site
        ? '<a class="d-btn d-btn-ghost" href="' + escapeHtml(ensureHttp(site)) + '" target="_blank" rel="noopener">Site web</a>'
        : '<span class="d-btn d-btn-ghost is-disabled">Site web</span>') +
    '</div>';

  const note = rows.length === 0
    ? '<div class="d-note">Peu d\'informations sont disponibles sur OpenStreetMap pour ce lieu. ' +
      'Vous pouvez les completer sur openstreetmap.org pour aider les autres amateurs.</div>'
    : '';

  el.detailBody.innerHTML =
    '<div class="d-name">' + escapeHtml(b.name) + '</div>' +
    '<div class="d-badges">' + badges.join('') + '</div>' +
    rows.join('') +
    actions +
    note;

  el.detail.hidden = false;
}

function hideDetail() { el.detail.hidden = true; }

// ============================================================
//  Flux principal : localiser puis chercher
// ============================================================
async function locateAndSearch() {
  el.locateBtn.classList.remove('attention');
  setBusy(true);
  setStatus('Recherche de votre position\u2026');

  let pos;
  try {
    pos = await getPosition();
  } catch (e) {
    setBusy(false);
    const denied = e && (e.code === 1 || /denied|permission/i.test(e.message || ''));
    setStatus(denied
      ? 'Localisation refusee. Autorisez l\'acces a la position pour trouver les brasseries.'
      : 'Impossible d\'obtenir votre position. Verifiez que le GPS est active.', true);
    return;
  }

  state.userPos = pos;
  placeUser(pos.lat, pos.lon, pos.acc);
  state.map.setView([pos.lat, pos.lon], 13, { animate: true });

  await runSearch();
  setBusy(false);
}

async function runSearch() {
  if (!state.userPos) return;
  setStatus('Recherche des brasseries dans un rayon de ' + (state.radius / 1000) + '\u00a0km\u2026');

  let elements;
  try {
    elements = await fetchBreweries(state.userPos.lat, state.userPos.lon, state.radius);
  } catch (e) {
    setStatus('Donnees indisponibles pour le moment. Reessayez dans un instant.', true);
    return;
  }

  state.breweries = parseBreweries(elements, state.userPos.lat, state.userPos.lon);
  renderMarkers(state.breweries);
  renderList(state.breweries);

  const n = state.breweries.length;
  el.sheetTitle.innerHTML = n > 0
    ? '<span class="count">' + n + '</span> brasserie' + (n > 1 ? 's' : '') + ' \u00b7 ' + (state.radius / 1000) + ' km'
    : 'Aucune brasserie \u00b7 ' + (state.radius / 1000) + ' km';

  openSheet(true);
  clearStatus();
}

// ============================================================
//  Petits utilitaires d'interface
// ============================================================
function setBusy(on) { el.locateBtn.classList.toggle('is-busy', on); el.locateBtn.disabled = on; }
function setStatus(msg, isError) { el.status.textContent = msg; el.status.hidden = false; el.status.classList.toggle('is-error', !!isError); }
function clearStatus() { el.status.hidden = true; }

function openSheet(open) {
  el.sheet.classList.toggle('is-open', open);
  el.sheetToggle.setAttribute('aria-expanded', String(open));
  // Leaflet doit recalculer sa taille apres l'animation de la feuille.
  setTimeout(() => state.map.invalidateSize(), 360);
}

function formatDist(km) {
  return km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1).replace('.', ',') + ' km';
}

function ensureHttp(url) { return /^https?:\/\//.test(url) ? url : 'https://' + url; }

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ============================================================
//  Ecouteurs d'evenements
// ============================================================
function bindEvents() {
  el.locateBtn.addEventListener('click', locateAndSearch);

  el.radiusChips.addEventListener('click', (ev) => {
    const chip = ev.target.closest('.chip');
    if (!chip) return;
    el.radiusChips.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.radius = parseInt(chip.dataset.radius, 10);
    // Si on a deja une position, on relance la recherche tout de suite.
    if (state.userPos) { setBusy(true); runSearch().then(() => setBusy(false)); }
  });

  el.sheetToggle.addEventListener('click', () => openSheet(!el.sheet.classList.contains('is-open')));
  el.detailBack.addEventListener('click', hideDetail);
  el.detail.addEventListener('click', (ev) => { if (ev.target === el.detail) hideDetail(); });
}

// ============================================================
//  Demarrage
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindEvents();
  setStatus('Appuyez sur le bouton \u25CE (en bas a droite) pour trouver les brasseries autour de vous.');
  el.locateBtn.classList.add('attention');   // pulsation pour reperer le bouton
  // Recalcule la taille de la carte une fois les polices/mise en page stabilisees.
  setTimeout(() => {
    state.map.invalidateSize();
    if (!state.userPos) state.map.setView([46.6, 2.4], 5);
  }, 400);
});
