// ==============================
// CONFIG
// ==============================

// Canonical schulform list (readme.md).
// Drives school type filter chips and marker colors.
const SCHULFORMEN = [
  { value: 'Grundschule',    label: 'Grundschule',    color: 'var(--color-grundschule)'    },
  { value: 'Gymnasium',      label: 'Gymnasium',      color: 'var(--color-gymnasium)'      },
  { value: 'Gesamtschule',   label: 'Gesamtschule',   color: 'var(--color-gesamtschule)'   },
  { value: 'Hauptschule',    label: 'Hauptschule',    color: 'var(--color-hauptschule)'    },
  { value: 'Realschule',     label: 'Realschule',     color: 'var(--color-realschule)'     },
  { value: 'Sekundarschule', label: 'Sekundarschule', color: 'var(--color-sekundarschule)' },
  { value: 'Förderschule',   label: 'Förderschule',   color: 'var(--color-foerderschule)'  },
  { value: 'Berufsschule',   label: 'Berufsschule',   color: 'var(--color-berufsschule)'   },
  { value: 'Freie Schule',   label: 'Freie Schule',   color: 'var(--color-freie-schule)'   },
  { value: 'Andere Schule',  label: 'Andere Schule',  color: 'var(--color-andere)'         },
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

// Start with a neutral view; setView() is called again once meta is loaded.
const map = L.map('map', { zoomControl: true })
             .setView([51.0, 10.0], 6);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  maxZoom: 20
}).addTo(map);

// ==============================
// STATE
// ==============================

let zoneLayer            = null;
let schoolLayer          = null;
let activeZoneLayer      = null;
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
  if (!badge) return;

  const wl = loadWatchlist();
  const count = Object.values(wl).filter(e => e.bookmarked).length;

  badge.textContent = count;
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

function openOverlay(s) {
  currentOverlaySchool = s;
  const saved = isBookmarked(s.id);

  document.getElementById('overlayDot').style.background = getSchoolColor(s.schulform);
  document.getElementById('overlayName').textContent      = s.schulname;
  document.getElementById('overlayType').textContent      = s.schulform;
  document.getElementById('overlayBsn').textContent       = s.id || '–';
  document.getElementById('overlayCarrier').textContent   = s.traeger || s.rechtsform || '–';
  document.getElementById('overlayDistrict').textContent  = s.specific?.bezirk  || s.ort || '–';
  document.getElementById('overlayPart').textContent      = s.specific?.ortsteil || '–';
  document.getElementById('overlayAddr').textContent      =
    [s.strasse, s.plz ? `${s.plz} ${s.ort || ''}`.trim() : ''].filter(Boolean).join(', ') || '–';

  const bBtn = document.getElementById('overlayBookmarkBtn');
  bBtn.className = 'bookmark-btn' + (saved ? ' saved' : '');
  bBtn.innerHTML = bookmarkBtnInner(saved);

  const links = [];
  const phone = [s.telefon_vorwahl, s.telefon].filter(Boolean).join(' ');
  if (phone)     links.push(`<span class="overlay-link">📞 ${phone}</span>`);
  if (s.email)   links.push(`<a class="overlay-link" href="mailto:${s.email}">✉️ ${s.email}</a>`);
  if (s.internet) links.push(`<a class="overlay-link accent" href="${s.internet}" target="_blank" rel="noopener">↗ Website</a>`);
  document.getElementById('overlayFooter').innerHTML = links.join('');

  const overlay = document.getElementById('schoolOverlay');
  overlay.classList.remove('dn');
  overlay.classList.add('db');

  const wl = loadWatchlist();
  const entry = wl[s.id];

  document.getElementById('overlayNote').value = entry?.note || '';

  renderSpecificFields(s);
}

function renderSpecificFields(s) {
  const container = document.getElementById('overlaySpecific');
  if (!container) return;

  const spec = s.specific || {};
  const entries = Object.entries(spec);

  if (!entries.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = `
    <div class="flex flex-column" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${entries.map(([key, value]) => `
        <div>
          <div class="info-label">
            ${key}
          </div>
          <div class="f7" style="font-family:'DM Mono',monospace;color:var(--text-secondary);">
            ${formatSpecificValue(value)}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function formatSpecificValue(value) {
  if (Array.isArray(value)) {
    return value.join(', ');
  }

  if (typeof value === 'boolean') {
    return value ? 'Ja' : 'Nein';
  }

  if (value === null || value === undefined || value === '') {
    return '–';
  }

  return value;
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

map.on('click', closeOverlay);

// ==============================
// COLORS
// ==============================

const TYPE_COLORS = Object.fromEntries(SCHULFORMEN.map(sf => [sf.value, sf.color]));

function getSchoolColor(schulform) {
  return TYPE_COLORS[schulform] || 'var(--color-andere)';
}

// ==============================
// ZONE STYLES
// ==============================

const zoneStyleDefault = () => ({ color: '#94a3b8', weight: 1.2, fillColor: '#64748b', fillOpacity: 0.06 });
const zoneStyleHover   = () => ({ color: '#2563eb', weight: 2.5, fillColor: '#2563eb', fillOpacity: 0.14 });
const zoneStyleActive  = () => ({ color: '#dc2626', weight: 2.5, fillColor: '#dc2626', fillOpacity: 0.12 });

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

  if (meta.lat && meta.lng) map.setView([meta.lat, meta.lng], meta.zoom ?? 13);

  if (meta.city) {
    const cityLabel = `Schulkarte ${meta.city}`;
    document.title = cityLabel;
    const h1 = document.getElementById('sidebarTitle');
    if (h1) h1.textContent = cityLabel;
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

    if (zoneLayer)       { map.removeLayer(zoneLayer); zoneLayer = null; }
    if (activeZoneLayer) { map.removeLayer(activeZoneLayer); activeZoneLayer = null; }

    zoneLayer = L.geoJSON(data, {
      style: zoneStyleDefault,
      onEachFeature: (feature, layer) => {
        layer.on('mouseover', function () {
          if (activeZoneLayer !== layer) layer.setStyle(zoneStyleHover());
          layer.bringToFront();
        });
        layer.on('mouseout', function () {
          if (activeZoneLayer !== layer) layer.setStyle(zoneStyleDefault());
        });
        layer.on('click', function (e) {
          L.DomEvent.stopPropagation(e);
          closeOverlay();
          if (activeZoneLayer === layer) {
            activeZoneLayer.setStyle(zoneStyleDefault());
            activeZoneLayer = null;
            renderSchools();
            return;
          }
          if (activeZoneLayer) activeZoneLayer.setStyle(zoneStyleDefault());
          activeZoneLayer = layer;
          layer.setStyle(zoneStyleActive());
          highlightSchoolsForZone(feature);
        });
      }
    }).addTo(map);
  } catch (err) {
    console.warn('Zone layer could not be loaded:', file, err);
  }
}

// ==============================
// RENDER SCHOOLS
// ==============================

function renderSchools(highlightedIds = null) {
  if (schoolLayer) { map.removeLayer(schoolLayer); schoolLayer = null; }

  const selectedTypes    = getSelectedSchoolTypes();
  const selectedCarriers = getSelectedCarriers();
  const search           = currentSearchTerm.toLowerCase().trim();
  const wl               = loadWatchlist();
  const markers          = [];

  allSchools.forEach(s => {
    if (!selectedTypes.includes(s.schulform)) return;
    if (selectedCarriers.length > 0 && !selectedCarriers.includes(s.rechtsform)) return;
    if (search && !`${s.schulname} ${s.schulform} ${s.schulform_raw}`.toLowerCase().includes(search)) return;
    if (showOnlyWatchlist && !wl[s.id]?.bookmarked) return;
    
    const color         = getSchoolColor(s.schulform);
    const isHighlighted = highlightedIds === null || highlightedIds.has(s.id);
    const isMarked      = !!wl[s.id]?.bookmarked;
    const opacity       = isHighlighted ? 0.95 : 0.2;
    const radius        = isHighlighted ? (isMarked ? 8 : 6) : 4;

    const marker = L.circleMarker([s.lat, s.lng], {
      radius,
      color:       isMarked && isHighlighted ? '#d97706' : (isHighlighted ? '#ffffff' : 'transparent'),
      weight:      isMarked && isHighlighted ? 2.5 : (isHighlighted ? 1.5 : 0),
      fillColor:   color,
      fillOpacity: opacity,
      pane:        isHighlighted ? 'markerPane' : 'shadowPane'
    });

    marker.on('click', function (e) {
      L.DomEvent.stopPropagation(e);
      openOverlay(s);
    });

    marker.on('mouseover', function () {
      this.setStyle({ radius: radius + 3, weight: 2.5, fillOpacity: 1 });
      this.bindTooltip(
        `<strong>${s.schulname}</strong>${isMarked ? ' ★' : ''}<br><span style="color:#666">${s.schulform}</span>`,
        { direction: 'top', offset: [0, -6] }
      ).openTooltip();
    });

    marker.on('mouseout', function () {
      this.setStyle({
        radius,
        weight:      isMarked && isHighlighted ? 2.5 : (isHighlighted ? 1.5 : 0),
        fillOpacity: opacity
      });
    });

    markers.push(marker);
  });

  schoolLayer = L.layerGroup(markers).addTo(map);
  updateResultCount(markers.length);
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

  const sidebar = document.getElementById('ownerFilters').closest('.mb3');

  sidebar.insertAdjacentHTML('afterend', `
    <div class="divider"></div>
    <div class="mb3">
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

document.getElementById('schoolFilters').addEventListener('change', () => {
  syncChipStates(); renderSchools();
});

document.getElementById('ownerFilters').addEventListener('change', () => {
  syncChipStates(); renderSchools();
});

document.getElementById('searchInput').addEventListener('input', e => {
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