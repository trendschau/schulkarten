// ==============================
// CONFIG
// ==============================

// Canonical schulform list (readme.md).
// Drives school type filter chips and marker colors.
const SCHULFORMEN = [
  { value: 'Grundschule',    label: 'Grundschule',    color: '#2563eb' },
  { value: 'Gymnasium',      label: 'Gymnasium',      color: '#7c3aed' },
  { value: 'Gesamtschule',   label: 'Gesamtschule',   color: '#059669' },
  { value: 'Hauptschule',    label: 'Hauptschule',    color: '#0d9488' },
  { value: 'Realschule',     label: 'Realschule',     color: '#0891b2' },
  { value: 'Sekundarschule', label: 'Sekundarschule', color: '#047857' },
  { value: 'Förderschule',   label: 'Förderschule',   color: '#db2777' },
  { value: 'Berufsschule',   label: 'Berufsschule',   color: '#d97706' },
  { value: 'Freie Schule',   label: 'Freie Schule',   color: '#7c3aed' },
  { value: 'Andere Schule',  label: 'Andere Schule',  color: '#71717a' },
];

// Carrier filter. Values match the `rechtsform` field in the unified schema.
const CARRIERS = [
  { value: 'öffentlich', label: 'Öffentlich' },
  { value: 'privat',     label: 'Privat'     },
];

// Zone layer config — set to [] when there are no zone layers for this city.
// Each entry: { file, label, default? }
// When non-empty, JS injects the Einzugsgebiete section into the sidebar.
const ZONE_LAYERS = [];

// School data file — city name, map center and zoom come from meta in the file itself.
const SCHOOLS_FILE = 'data/schulen.geojson';

// ==============================
// INIT MAP
// ==============================

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/positron',
  center: [10.0, 51.0],
  zoom: 6,
  attributionControl: true,
});

let mapReady = false;
map.on('load', () => {
  mapReady = true;
  // Add sources and layers for schools and zones
  map.addSource('schools', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addSource('zones',   { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });

  // Zone fill
  map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zones',
    paint: { 'fill-color': '#64748b', 'fill-opacity': 0.06 } });
  // Zone outline
  map.addLayer({ id: 'zone-line', type: 'line', source: 'zones',
    paint: { 'line-color': '#94a3b8', 'line-width': 1.2 } });
  // Zone active fill
  map.addLayer({ id: 'zone-fill-active', type: 'fill', source: 'zones',
    filter: ['==', ['get', '_active'], true],
    paint: { 'fill-color': '#dc2626', 'fill-opacity': 0.12 } });
  // Zone active outline
  map.addLayer({ id: 'zone-line-active', type: 'line', source: 'zones',
    filter: ['==', ['get', '_active'], true],
    paint: { 'line-color': '#dc2626', 'line-width': 2.5 } });

  // School circles (dim)
  map.addLayer({ id: 'schools-dim', type: 'circle', source: 'schools',
    filter: ['==', ['get', '_highlighted'], false],
    paint: {
      'circle-radius': 4,
      'circle-color': ['get', '_color'],
      'circle-opacity': 0.2,
      'circle-stroke-width': 0,
    }
  });

  // School circles (normal)
  map.addLayer({ id: 'schools-main', type: 'circle', source: 'schools',
    filter: ['==', ['get', '_highlighted'], true],
    paint: {
      'circle-radius': ['case', ['get', '_marked'], 8, 6],
      'circle-color': ['get', '_color'],
      'circle-opacity': 0.95,
      'circle-stroke-width': ['case', ['get', '_marked'], 2.5, 1.5],
      'circle-stroke-color': ['case', ['get', '_marked'], '#d97706', '#ffffff'],
    }
  });

  // Hover tooltip
  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });

  map.on('mouseenter', 'schools-main', e => {
    map.getCanvas().style.cursor = 'pointer';
    const p = e.features[0].properties;
    popup.setLngLat(e.lngLat)
      .setHTML(`<strong>${p.schulname}</strong>${p._marked ? ' ★' : ''}<br><span style="color:#666;font-size:11px">${p.schulform}</span>`)
      .addTo(map);
    map.setPaintProperty('schools-main', 'circle-radius',
      ['case', ['==', ['get', 'id'], p.id], ['case', ['get', '_marked'], 11, 9],
               ['case', ['get', '_marked'], 8, 6]]);
  });
  map.on('mouseleave', 'schools-main', () => {
    map.getCanvas().style.cursor = '';
    popup.remove();
    map.setPaintProperty('schools-main', 'circle-radius',
      ['case', ['get', '_marked'], 8, 6]);
  });

  // Click school
  map.on('click', 'schools-main', e => {
    const id = e.features[0].properties.id;
    const school = allSchools.find(s => s.id === id);
    if (school) openOverlay(school);
  });
  map.on('click', 'schools-dim', e => {
    const id = e.features[0].properties.id;
    const school = allSchools.find(s => s.id === id);
    if (school) openOverlay(school);
  });

  // Click zone
  map.on('click', 'zone-fill', e => {
    const feature = e.features[0];
    closeOverlay();
    const src = map.getSource('zones');
    const current = src._data;
    const wasActive = feature.properties._active;
    // deactivate all, then toggle
    current.features.forEach(f => f.properties._active = false);
    if (!wasActive) {
      feature.properties._active = true;
      const match = current.features.find(f => f.properties === feature.properties);
      if (match) match.properties._active = true;
      highlightSchoolsForZone(feature);
    } else {
      renderSchools();
    }
    src.setData(current);
  });

  // Click map background — close overlay
  map.on('click', e => {
    const fs = map.queryRenderedFeatures(e.point, { layers: ['schools-main', 'schools-dim', 'zone-fill'] });
    if (!fs.length) closeOverlay();
  });

  // Now load data if already fetched
  if (allSchools.length) renderSchools();
});

// ==============================
// STATE
// ==============================

let allSchools           = [];
let currentSearchTerm    = '';
let showOnlyWatchlist    = false;
let currentOverlaySchool = null;

// ==============================
// MOBILE SIDEBAR TOGGLE
// ==============================

function toggleSidebar() {
  const sidebar  = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const isOpen   = sidebar.classList.contains('open');
  sidebar.classList.toggle('open', !isOpen);
  backdrop.classList.toggle('dn',  isOpen);
  backdrop.classList.toggle('db', !isOpen);
}

// ==============================
// WATCHLIST — localStorage
// ==============================

let STORAGE_KEY = 'schulkarte_watchlist_default';

function loadWatchlist() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
  catch (e) { return {}; }
}

function saveWatchlist(wl) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wl));
}

function isBookmarked(id) {
  return !!loadWatchlist()[id]?.bookmarked;
}

// ==============================
// EXPORT WATCHLIST (JSON)
// ==============================

function exportWatchlist() {
  const wl = loadWatchlist();

  // bereinigte Kopie erstellen
  const cleaned = {};

  Object.entries(wl).forEach(([id, entry]) => {
    cleaned[id] = {
      bookmarked: !!entry.bookmarked,
      note: entry.note || ''
    };
  });

  const data = {
    city: getCurrentCity(),
    items: cleaned
  };

  const blob = new Blob(
    [JSON.stringify(data, null, 2)],
    { type: 'application/json' }
  );

  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `schulkarte-${data.city}-watchlist.json`;
  a.click();

  URL.revokeObjectURL(a.href);
}


// ==============================
// CITY HELPER
// ==============================

function getCurrentCity() {
  return STORAGE_KEY.replace('schulkarte_watchlist_', '');
}


// ==============================
// IMPORT WATCHLIST (JSON)
// ==============================

function importWatchlist(file) {
  const reader = new FileReader();

  reader.onload = e => {
    try {
      if (!e.target.result) throw new Error('empty file');

      const raw = e.target.result.trim();
      const parsed = JSON.parse(raw);

      let items;
      let city = null;

      // neues Format
      if (parsed.items && typeof parsed.items === 'object') {
        items = parsed.items;
        city = parsed.city || null;
      }

      // altes Format (Fallback)
      else if (typeof parsed === 'object' && !Array.isArray(parsed)) {
        items = parsed;
      }

      else {
        throw new Error('invalid structure');
      }

      // bereinigen + normalisieren
      const cleaned = {};

      Object.entries(items).forEach(([id, entry]) => {
        if (!id) return;

        cleaned[id] = {
          bookmarked: !!entry?.bookmarked,
          note: entry?.note || ''
        };
      });

      // City Check
      const currentCity = getCurrentCity();

      if (city && city !== currentCity) {
        const proceed = confirm(
          `Diese Datei ist für "${city}". Aktuelle Karte ist "${currentCity}". Trotzdem importieren?`
        );
        if (!proceed) return;
      }

      saveWatchlist(cleaned);
      if (allSchools.length) renderSchools();
      updateWatchlistBadge();

      // reset so the same file can be re-imported
      const inp = document.getElementById('importWatchlistInput');
      if (inp) inp.value = '';

    } catch (err) {
      console.error(err);
      alert('Ungültige Datei');
    }
  };

  reader.readAsText(file);
}


// ==============================
// BUTTON BINDINGS
// ==============================

// Export Button
const exportBtn = document.getElementById('exportWatchlistBtn');
if (exportBtn) {
  exportBtn.addEventListener('click', exportWatchlist);
}

// Import Input (type="file")
const importInput = document.getElementById('importWatchlistInput');
if (importInput) {
  importInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) importWatchlist(file);
  });
}

// ==============================
// TOGGLE BOOKMARK
// ==============================

function toggleBookmark(s) {
  const wl = loadWatchlist();
  const id = s.id;

  if (!wl[id]) {
    wl[id] = {
      bookmarked: true,
      note: ''
    };
  } else {
    wl[id].bookmarked = !wl[id].bookmarked;

    // cleanup: wenn unbookmarked + keine Note → löschen
    if (!wl[id].bookmarked && (!wl[id].note || wl[id].note.trim() === '')) {
      delete wl[id];
    }
  }

  saveWatchlist(wl);
  renderSchools();
  updateWatchlistBadge();
}

// ==============================
// BADGE
// ==============================

function updateWatchlistBadge() {
  const badge = document.getElementById('watchlistBadge');
  if (badge) {
    const count = Object.values(loadWatchlist()).filter(e => e.bookmarked).length;
    badge.textContent = count;
  }
  updateNavBadge();
}

function toggleWatchlistFilter() {
  showOnlyWatchlist = !showOnlyWatchlist;

  const btn = document.getElementById('watchlistFilterBtn');
  if (btn) btn.classList.toggle('active', showOnlyWatchlist);

  renderSchools();
}

// ==============================
// BUTTON UI
// ==============================

function bookmarkBtnInner(saved) {
  const star = saved
    ? `<svg viewBox="0 0 24 24" fill="#d97706" stroke="#d97706" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
      </svg>`;

  return star + (saved ? ' Gemerkt' : ' Merken');
}

// ==============================
// NOTES (Overlay)
// ==============================

document.addEventListener('input', e => {
  if (e.target.id !== 'overlayNote') return;
  if (!currentOverlaySchool) return;

  const wl = loadWatchlist();
  const id = currentOverlaySchool.id;

  if (!wl[id]) {
    wl[id] = {
      bookmarked: false,
      note: ''
    };
  }

  wl[id].note = e.target.value;

  // cleanup: wenn kein bookmark + keine note → löschen
  if (!wl[id].bookmarked && (!wl[id].note || wl[id].note.trim() === '')) {
    delete wl[id];
  }

  saveWatchlist(wl);
});


// ==============================
// SCHOOL OVERLAY
// ==============================

// Human-readable labels for eigenschaften tags
const EIGENSCHAFT_LABELS = {
  jahrgangsuebergreifend:    'Jahrgangsübergreifend',
  schuleingangsphase:        'Schuleingangsphase',
  gebundener_ganztag:        'Gebundener Ganztag',
  offener_ganztag:           'Offener Ganztag',
  lernzeiten:                'Lernzeiten',
  begabtenfoerderung:        'Begabtenförderung',
  bilingual:                 'Bilingual',
  inklusion:                 'Inklusion',
  projektorientiert:         'Projektorientiert',
  individualisiertes_lernen: 'Individualisiertes Lernen',
  digitale_bildung:          'Digitale Bildung',
  berufsorientierung:        'Berufsorientierung',
  sport:                     'Sport',
  musik:                     'Musik',
  kunst:                     'Kunst',
  theater:                   'Theater',
  tanz:                      'Tanz',
  mint:                      'MINT',
  bne:                       'BNE',
  fremdsprachenprofil:       'Fremdsprachenprofil',
};

// Helper: read a field with optional fallback key
function getValue(obj, key, fallback) {
  const v = obj[key];
  if (v !== null && v !== undefined && v !== '') return v;
  if (fallback) {
    const fb = obj[fallback];
    if (fb !== null && fb !== undefined && fb !== '') return fb;
  }
  return null;
}

const OVERLAY_CONFIG = [
  {
    type: 'grid',
    columns: 2,
    fields: [
      { key: 'id', label: 'ID' },
      { key: 'traeger', label: 'Träger' },
      { key: 'bezirk', label: 'Bezirk' },
      { key: 'ortsteil', label: 'Ortsteil' }
    ]
  },

  {
    type: 'grid',
    columns: 2,
    fields: [
      { key: 'schuelerzahl', fallback: 'schueler', label: 'Schüler:innen' },
      { key: 'lehrkraefte', label: 'Lehrkräfte' },
      { key: 'betreuungspersonal', label: 'Personal' },
      { key: 'klassengroesse_avg', label: 'Ø Klassengröße' },
      { key: 'gymnasialquote', label: 'Gymnasialquote' },
      { key: 'sozialindex', fallback: 'sozialindexstufe', label: 'Sozialindex' }
    ]
  },

  {
    type: 'tags',
    key: 'eigenschaften',
    label: 'Profil'
  }
];

function openOverlay(s) {
  currentOverlaySchool = s;

  const saved = isBookmarked(s.id);

  document.getElementById('overlayName').textContent = s.schulname;
  document.getElementById('overlayType').textContent = s.schulform;

  const bBtn = document.getElementById('overlayBookmarkBtn');
  bBtn.className = 'bookmark-btn' + (saved ? ' saved' : '');
  bBtn.innerHTML = bookmarkBtnInner(saved);

  const overlay = document.getElementById('schoolOverlay');
  overlay.classList.remove('dn');
  overlay.classList.add('db');

  const wl = loadWatchlist();
  document.getElementById('overlayNote').value = wl[s.id]?.note || '';

  renderOverlayHeader(s);
  renderOverlay(s);
}

function renderOverlay(s) {
  // ── Stats grid ────────────────────────────────────────────────
  const gridEl = document.getElementById('overlayGrid');
  if (gridEl) {
    const GRID_FIELDS = [
      { key: 'id',                label: 'ID'              },
      { key: 'traeger',           label: 'Träger'          },
      { key: 'rechtsform',        label: 'Rechtsform'      },
      { key: 'betrieb_seit',      label: 'In Betrieb seit' },
      { key: 'bezirk',            label: 'Bezirk'          },
      { key: 'ortsteil',          label: 'Ortsteil'        },
      { key: 'schuelerzahl',      fallback: 'schueler',        label: 'Schüler:innen'   },
      { key: 'lehrkraefte',                                    label: 'Lehrkräfte'      },
      { key: 'betreuungspersonal',                             label: 'Personal'        },
      { key: 'klassengroesse_avg',                             label: 'Ø Klassengröße'  },
      { key: 'gymnasialquote',                                 label: 'Gymnasialquote'  },
      { key: 'sozialindex',       fallback: 'sozialindexstufe',label: 'Sozialindex'     },
    ];

    const cells = GRID_FIELDS.map(f => {
      const value = getValue(s, f.key, f.fallback);
      if (value === null || value === undefined || value === '') return '';
      return `
        <div>
          <div class="info-label">${f.label}</div>
          <div class="f7" style="font-family:'DM Mono',monospace;color:var(--text-secondary);">
            ${Array.isArray(value) ? value.join(', ') : value}
          </div>
        </div>`;
    }).filter(Boolean).join('');

    gridEl.innerHTML = cells;
  }

  // ── Eigenschaften tags ────────────────────────────────────────
  const tagsEl = document.getElementById('overlayTags');
  if (tagsEl) {
    const list = Array.isArray(s.eigenschaften) ? s.eigenschaften.filter(Boolean) : [];
    if (list.length) {
      tagsEl.innerHTML = `
        <div class="info-label">Profil</div>
        <div class="flex flex-wrap" style="gap:6px;margin-top:6px;">
          ${list.map(e => `
            <span style="font-size:11px;padding:4px 8px;border-radius:999px;
                         background:var(--chip-bg);border:1px solid var(--border);
                         color:var(--text-secondary);white-space:nowrap;">
              ${EIGENSCHAFT_LABELS[e] || e}
            </span>`).join('')}
        </div>`;
    } else {
      tagsEl.innerHTML = '';
    }
  }
}

function renderOverlayHeader(s) {
  // Dot color
  const dot = document.getElementById('overlayDot');
  if (dot) dot.style.background = getSchoolColor(s.schulform);

  // Contact sub-header — address · phone · email · website
  const contact = document.getElementById('overlayContact');
  if (!contact) return;

  const items = [];

  // Address
  const addrParts = [];
  if (s.strasse) addrParts.push(s.strasse);
  if (s.plz || s.ort) addrParts.push(`${s.plz || ''} ${s.ort || ''}`.trim());
  if (addrParts.length) {
    items.push(`<span class="overlay-contact-item">📍 ${addrParts.join(', ')}</span>`);
  }

  // Phone
  const phone = [s.telefon_vorwahl, s.telefon].filter(Boolean).join(' ');
  if (phone) {
    items.push(`<a href="tel:${phone.replace(/\s/g,'')}" class="overlay-contact-item overlay-contact-link">📞 ${phone}</a>`);
  }

  // Email
  if (s.email) {
    items.push(`<a href="mailto:${s.email}" class="overlay-contact-item overlay-contact-link">✉ ${s.email}</a>`);
  }

  // Website
  if (s.internet) {
    const url = s.internet.startsWith('http') ? s.internet : `https://${s.internet}`;
    items.push(`<a href="${url}" target="_blank" rel="noopener" class="overlay-contact-item overlay-contact-link">↗ Website</a>`);
  }

  contact.innerHTML = items.join('');
}

function closeOverlay() {
  const overlay = document.getElementById('schoolOverlay');
  overlay.classList.add('dn');
  overlay.classList.remove('db');
  currentOverlaySchool = null;
}

function overlayToggleBookmark() {
  if (!currentOverlaySchool) return;
  toggleBookmark(currentOverlaySchool);
  const saved = isBookmarked(currentOverlaySchool.id);
  const bBtn  = document.getElementById('overlayBookmarkBtn');
  bBtn.className = 'bookmark-btn' + (saved ? ' saved' : '');
  bBtn.innerHTML = bookmarkBtnInner(saved);
}

// ==============================
// COLORS
// ==============================

const TYPE_COLORS = Object.fromEntries(SCHULFORMEN.map(sf => [sf.value, sf.color]));

function getSchoolColor(schulform) {
  return TYPE_COLORS[schulform] || '#71717a';
}

// ==============================
// LOAD SCHOOLS
// ==============================

async function loadSchools() {
  const res  = await fetch(SCHOOLS_FILE);
  const data = await res.json();

  const meta = data.meta || {};

  // set city-specific storage key
  const citySlug = (meta.city || 'default')
    .toLowerCase()
    .replace(/\s+/g, '_');

  STORAGE_KEY = `schulkarte_watchlist_${citySlug}`;

  if (meta.lat && meta.lng) map.flyTo({ center: [meta.lng, meta.lat], zoom: meta.zoom ?? 13 });

  if (meta.city) {
    const cityLabel = `Schulkarte ${meta.city}`;
    document.title = cityLabel;
    const h1 = document.getElementById('sidebarTitle');
    if (h1) h1.textContent = cityLabel;
    const navTitle = document.getElementById('topNavTitle');
    if (navTitle) navTitle.textContent = cityLabel;
  }

  allSchools = data.features.map(f => ({
    ...f.properties,
    schulform: f.properties.schulform || 'Andere Schule',
    lat: f.geometry.coordinates[1],
    lng: f.geometry.coordinates[0],
  }));

  initMappingInfo(meta);
  injectLicense(meta);
  buildSchoolFilters();
  renderSchools();
  updateWatchlistBadge(); // ensure correct count after key change
}

// ==============================
// LOAD ZONES
// ==============================

async function loadZones(file) {
  try {
    const res  = await fetch(file);
    const data = await res.json();
    // reset _active flag on all features
    data.features.forEach(f => { f.properties._active = false; });
    if (mapReady) {
      map.getSource('zones').setData(data);
    } else {
      map.once('load', () => map.getSource('zones').setData(data));
    }
  } catch (err) {
    console.warn('Zone layer could not be loaded:', file, err);
  }
}

// ==============================
// RENDER SCHOOLS
// ==============================

function renderSchools(highlightedIds = null) {
  if (!mapReady) return;

  const selectedTypes    = getSelectedSchoolTypes();
  const selectedCarriers = getSelectedCarriers();
  const search           = currentSearchTerm.toLowerCase().trim();
  const wl               = loadWatchlist();

  const features = [];

  allSchools.forEach(s => {
    if (!selectedTypes.includes(s.schulform)) return;
    if (selectedCarriers.length > 0 && !selectedCarriers.includes(s.rechtsform)) return;
    if (search && !`${s.schulname} ${s.schulform} ${s.schulform_raw}`.toLowerCase().includes(search)) return;
    if (showOnlyWatchlist && !wl[s.id]?.bookmarked) return;

    const isHighlighted = highlightedIds === null || highlightedIds.has(s.id);
    const isMarked      = !!wl[s.id]?.bookmarked;

    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: {
        id:            s.id,
        schulname:     s.schulname,
        schulform:     s.schulform,
        _color:        getSchoolColor(s.schulform),
        _highlighted:  isHighlighted,
        _marked:       isMarked,
      }
    });
  });

  map.getSource('schools').setData({ type: 'FeatureCollection', features });
  updateResultCount(features.length);
}

// ==============================
// SPATIAL FILTER
// ==============================

function highlightSchoolsForZone(zoneFeature) {
  const ids = new Set();
  allSchools.forEach(s => {
    try {
      if (turf.booleanPointInPolygon(turf.point([s.lng, s.lat]), zoneFeature))
        ids.add(s.id);
    } catch (e) {}
  });
  renderSchools(ids);
}

// ==============================
// FILTER HELPERS
// ==============================

function getSelectedSchoolTypes() {
  return Array.from(document.querySelectorAll('#schoolFilters input[type="checkbox"]'))
    .filter(cb => cb.checked).map(cb => cb.value);
}

function getSelectedCarriers() {
  return Array.from(document.querySelectorAll('#ownerFilters input[type="checkbox"]'))
    .filter(cb => cb.checked).map(cb => cb.value);
}

// ==============================
// UI HELPERS
// ==============================

function updateResultCount(n) {
  const el = document.getElementById('resultCount');
  if (el) el.innerHTML = `<span>${n}</span> Schulen gefunden`;
}

function syncChipStates() {
  document.querySelectorAll('#schoolFilters .filter-chip').forEach(label => {
    label.classList.toggle('checked', label.querySelector('input').checked);
  });
  document.querySelectorAll('#ownerFilters .carrier-chip').forEach(label => {
    label.classList.toggle('checked', label.querySelector('input').checked);
  });
}

// ==============================
// BUILD SIDEBAR FILTERS FROM CONFIG
// ==============================

function buildSchoolFilters() {
  // count occurrences per schulform
  const counts = {};
  allSchools.forEach(s => {
    counts[s.schulform] = (counts[s.schulform] || 0) + 1;
  });

  // filter only those with data
  const availableForms = SCHULFORMEN.filter(sf => counts[sf.value] > 0);

  document.getElementById('schoolFilters').innerHTML = availableForms.map(sf => `
    <label class="filter-chip checked">
      <input type="checkbox" value="${sf.value}" checked>
      <span class="chip-dot" style="background:${sf.color};"></span>
      ${sf.label}
    </label>`).join('');
}

function buildCarrierFilters() {
  document.getElementById('ownerFilters').innerHTML = CARRIERS.map(c => `
    <label class="carrier-chip checked">
      <input type="checkbox" value="${c.value}" checked>${c.label}
    </label>`).join('');
}

function buildZoneButtons() {
  if (!ZONE_LAYERS.length) return;

  // Inject the full Einzugsgebiete block before the anchor — only when there is data.
  const anchor = document.getElementById('zoneAnchor');
  anchor.insertAdjacentHTML('beforebegin', `
    <div class="mb3" id="zoneSection">
      <div class="section-title">Einzugsgebiete</div>
      <div class="flex flex-wrap" id="zoneFilter" style="gap:6px;">
        ${ZONE_LAYERS.map(z => `
          <button class="year-btn${z.default ? ' active' : ''}"
                  data-zone-file="${z.file}">
            ${z.label}
          </button>`).join('')}
      </div>
    </div>
    <div class="divider"></div>
  `);

  document.getElementById('zoneFilter').addEventListener('click', e => {
    const btn = e.target.closest('.year-btn');
    if (!btn) return;
    document.querySelectorAll('#zoneFilter .year-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    loadZones(btn.dataset.zoneFile);
  });
}

function injectLicense(meta) {
  if (!meta.lizenzhinweis) return;

  // avoid injecting twice on hot-reloads
  if (document.getElementById('licenseBlock')) return;

  const anchor = document.getElementById('ownerFilters')?.closest('.mb3');
  if (!anchor) return;

  anchor.insertAdjacentHTML('afterend', `
    <div class="divider"></div>
    <div class="mb3" id="licenseBlock">
      <div class="section-title">Datenlizenzen</div>
      <div class="f7" style="color:var(--text-muted);line-height:1.5;">
        ${meta.lizenzhinweis}
      </div>
    </div>
  `);
}

function initMappingInfo(meta) {
  if (!meta.mappinghinweis) return;

  const btn = document.getElementById('mappingInfoBtn');
  if (!btn) return;

  let tooltip;

  btn.addEventListener('mouseenter', () => {
    tooltip = document.createElement('div');
    tooltip.className = 'pa2 br2 f7';
    tooltip.style.position = 'absolute';
    tooltip.style.background = 'var(--sidebar-bg)';
    tooltip.style.border = '1px solid var(--border)';
    tooltip.style.boxShadow = '0 4px 12px rgba(0,0,0,.1)';
    tooltip.style.maxWidth = '240px';
    tooltip.style.zIndex = 999;

    tooltip.innerHTML = meta.mappinghinweis;

    document.body.appendChild(tooltip);

    const rect = btn.getBoundingClientRect();
    tooltip.style.left = rect.left + 'px';
    tooltip.style.top  = (rect.bottom + 6) + 'px';
  });

  btn.addEventListener('mouseleave', () => {
    if (tooltip) tooltip.remove();
  });
}

// ==============================
// EVENTS
// ==============================

document.getElementById('schoolFilters')?.addEventListener('change', () => {
  syncChipStates(); renderSchools();
});

document.getElementById('ownerFilters')?.addEventListener('change', () => {
  syncChipStates(); renderSchools();
});

document.getElementById('searchInput')?.addEventListener('input', e => {
  currentSearchTerm = e.target.value;
  renderSchools();
});

// ==============================
// INIT
// ==============================

// buildSchoolFilters();
buildCarrierFilters();
buildZoneButtons();

const defaultZone = ZONE_LAYERS.find(z => z.default);
if (defaultZone) loadZones(defaultZone.file);

loadSchools();
updateWatchlistBadge();

// ==============================
// TOP NAV BADGE
// ==============================

function updateNavBadge() {
  const badge = document.getElementById('navBadge');
  if (!badge) return;
  const count = Object.values(loadWatchlist()).filter(e => e.bookmarked).length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline-flex' : 'none';
}

updateNavBadge();