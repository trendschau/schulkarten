// ==============================
// INIT MAP
// ==============================

const map = L.map('map', {
  zoomControl: true
}).setView([52.52, 13.405], 12);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  maxZoom: 20
}).addTo(map);

// ==============================
// STATE
// ==============================

let zoneLayer = null;
let schoolLayer = null;
let activeZoneLayer = null;

let allSchoolsRaw = null;
let allSchoolsClean = [];

let currentSearchTerm = '';
let showOnlyWatchlist = false;

// ==============================
// WATCHLIST — localStorage
// ==============================

const STORAGE_KEY = 'schulkarte_watchlist';

function loadWatchlist() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveWatchlist(wl) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(wl));
}

function isBookmarked(id) {
  return !!loadWatchlist()[id];
}

function toggleBookmark(s) {
  const wl = loadWatchlist();
  if (wl[s.id]) {
    delete wl[s.id];
  } else {
    wl[s.id] = { school: s, note: '' };
  }
  saveWatchlist(wl);
  renderSchools();
  renderWatchlistPanel();
  updateWatchlistBadge();
}

function saveNote(id, note) {
  const wl = loadWatchlist();
  if (wl[id]) {
    wl[id].note = note;
    saveWatchlist(wl);
  }
}

function removeFromWatchlist(id) {
  const wl = loadWatchlist();
  delete wl[id];
  saveWatchlist(wl);
  renderSchools();
  renderWatchlistPanel();
  updateWatchlistBadge();
  // refresh school info panel bookmark button if same school is shown
  const currentBtn = document.querySelector('.bookmark-btn[data-id="' + id + '"]');
  if (currentBtn) {
    currentBtn.classList.remove('saved');
    currentBtn.innerHTML = bookmarkBtnInner(false);
  }
}

function updateWatchlistBadge() {
  const count = Object.keys(loadWatchlist()).length;
  const badge = document.getElementById('watchlistBadge');
  if (badge) badge.textContent = count;
}

function toggleWatchlistFilter() {
  showOnlyWatchlist = !showOnlyWatchlist;
  const btn = document.getElementById('watchlistFilterBtn');
  if (btn) btn.classList.toggle('active', showOnlyWatchlist);
  renderSchools();
}

function bookmarkBtnInner(saved) {
  const star = saved
    ? `<svg viewBox="0 0 24 24" fill="#d97706" stroke="#d97706" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
  return star + (saved ? ' Gemerkt' : ' Merken');
}

function renderWatchlistPanel() {
  const wl = loadWatchlist();
  const panel = document.getElementById('watchlistPanel');
  if (!panel) return;

  const entries = Object.values(wl);
  if (!entries.length) {
    panel.innerHTML = '<span style="color:var(--text-muted);font-style:italic;">Noch keine Schulen gemerkt.</span>';
    return;
  }

  panel.innerHTML = entries.map(({ school: s, note }) => {
    const color = getSchoolColor(s);
    const escaped = (note || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    return `
      <div class="watchlist-entry">
        <div class="watchlist-entry-header">
          <div style="display:flex;align-items:center;gap:6px;flex:1;min-width:0;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
            <span style="font-size:0.78rem;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                  title="${s.name}">${s.name}</span>
          </div>
          <button class="remove-btn" onclick="removeFromWatchlist('${s.id}')" title="Entfernen">✕</button>
        </div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:6px;padding-left:14px;">${s.type} · ${s.district}</div>
        <textarea
          class="watchlist-note"
          rows="2"
          placeholder="Notiz hinzufügen …"
          onchange="saveNote('${s.id}', this.value)"
          oninput="saveNote('${s.id}', this.value)"
        >${escaped}</textarea>
      </div>
    `;
  }).join('');
}

// ==============================
// NORMALIZE
// ==============================

function normalizeCarrier(carrier) {
  if (!carrier) return 'unbekannt';
  const c = carrier.trim().toLowerCase();
  if (c.includes('privat')) return 'privat';
  if (c.includes('öffentlich')) return 'öffentlich';
  return 'sonstiges';
}

function normalizeSchoolType(schultyp, schulart) {
  // Use schultyp directly from JSON (already normalized in the data)
  // but map to our canonical categories
  const t = `${schultyp || ''}`.toLowerCase();
  const a = `${schulart || ''}`.toLowerCase();
  const combined = t + ' ' + a;

  if (combined.includes('grundschule')) return 'Grundschule';
  if (combined.includes('gymnasium')) return 'Gymnasium';
  if (combined.includes('integriert') || combined.includes('sekundarschule') || combined.includes('iss')) return 'Integrierte Sekundarschule';
  if (combined.includes('sonder') || combined.includes('förder')) return 'Schule mit sonderpädagogischen Förderschwerpunkt';
  if (combined.includes('beruf') || combined.includes('osz') || combined.includes('oberstufenzentrum')) return 'Berufsschule';
  if (combined.includes('privat') || combined.includes('waldorf') || combined.includes('montessori')) return 'Privatschule';

  return 'Andere Schule';
}

// ==============================
// MAPPING
// ==============================

function mapSchool(feature) {
  const p = feature.properties;
  return {
    id: p.id || '',
    bsn: p.bsn || '',
    name: p.schulname || '',
    type: normalizeSchoolType(p.schultyp, p.schulart),
    schultyp: p.schultyp || '',
    schulart: p.schulart || '',
    carrier: normalizeCarrier(p.traeger),
    district: p.bezirk || '',
    districtPart: p.ortsteil || '',
    street: `${p.strasse || ''} ${p.hausnr || ''}`.trim(),
    zip: p.plz || '',
    phone: p.telefon || '',
    fax: p.fax || '',
    email: p.email || '',
    website: p.internet || '',
    schoolYear: p.schuljahr || '',
    lat: feature.geometry.coordinates[1],
    lng: feature.geometry.coordinates[0],
    raw: p
  };
}

function mapZone(feature, year) {
  const p = feature.properties;
  return {
    name: p.esb_text || p.bezeichnung || p.name || 'Einzugsgebiet',
    id: p.esb || p.schluessel || '',
    district: p.bezname || p.bezirk || '',
    year: year,
    raw: p
  };
}

// ==============================
// SCHOOL COLORS
// ==============================

const TYPE_COLORS = {
  'Grundschule':                                        '#2563eb',
  'Gymnasium':                                          '#7c3aed',
  'Integrierte Sekundarschule':                         '#059669',
  'Schule mit sonderpädagogischen Förderschwerpunkt':   '#db2777',
  'Berufsschule':                                       '#d97706',
  'Privatschule':                                       '#0891b2',
  'Andere Schule':                                      '#71717a'
};

function getSchoolColor(s) {
  return TYPE_COLORS[s.type] || '#71717a';
}

// ==============================
// ZONE STYLES
// ==============================

function zoneStyleDefault() {
  return { color: '#94a3b8', weight: 1.2, fillColor: '#64748b', fillOpacity: 0.06 };
}
function zoneStyleHover() {
  return { color: '#2563eb', weight: 2.5, fillColor: '#2563eb', fillOpacity: 0.14 };
}
function zoneStyleActive() {
  return { color: '#dc2626', weight: 2.5, fillColor: '#dc2626', fillOpacity: 0.12 };
}

// ==============================
// LOAD SCHOOLS
// ==============================

async function loadSchools() {
  const res = await fetch('data/schulen.json');
  const data = await res.json();
  allSchoolsRaw = data;
  allSchoolsClean = data.features.map(mapSchool);
  renderSchools();
}

// ==============================
// LOAD ZONES
// ==============================

async function loadZones(year) {
  try {
    const res = await fetch(`data/esb_${year}.json`);
    const data = await res.json();

    if (zoneLayer) map.removeLayer(zoneLayer);
    if (activeZoneLayer) {
      map.removeLayer(activeZoneLayer);
      activeZoneLayer = null;
    }

    zoneLayer = L.geoJSON(data, {
      style: zoneStyleDefault,
      onEachFeature: (feature, layer) => {
        const zone = mapZone(feature, year);

        layer.on('mouseover', function() {
          if (activeZoneLayer !== layer) {
            layer.setStyle(zoneStyleHover());
          }
          layer.bringToFront();
        });

        layer.on('mouseout', function() {
          if (activeZoneLayer !== layer) {
            layer.setStyle(zoneStyleDefault());
          }
        });

        layer.on('click', function() {
          if (activeZoneLayer && activeZoneLayer !== layer) {
            activeZoneLayer.setStyle(zoneStyleDefault());
          }
          if (activeZoneLayer === layer) {
            // deselect
            activeZoneLayer.setStyle(zoneStyleDefault());
            activeZoneLayer = null;
            document.getElementById('zoneInfo').innerHTML =
              '<span style="color: var(--text-muted); font-style: italic;">Klicke auf ein Gebiet …</span>';
            renderSchools(); // show all again
            return;
          }
          activeZoneLayer = layer;
          layer.setStyle(zoneStyleActive());
          showZoneInfo(zone);
          highlightSchoolsForZone(feature);
        });
      }
    }).addTo(map);
  } catch (e) {
    console.warn('Zones could not be loaded for year', year, e);
  }
}

// ==============================
// RENDER SCHOOLS (always all, dimming zone-outside ones)
// ==============================

function renderSchools(highlightedIds = null) {
  if (schoolLayer) map.removeLayer(schoolLayer);

  const selectedTypes = getSelectedSchoolTypes();
  const selectedCarriers = getSelectedCarriers();
  const search = currentSearchTerm.toLowerCase().trim();
  const wl = loadWatchlist();

  const markers = [];

  allSchoolsClean.forEach(s => {
    // Type filter
    if (!selectedTypes.includes(s.type)) return;

    // Carrier filter
    if (selectedCarriers.length > 0 && !selectedCarriers.includes(s.carrier)) return;

    // Free text search
    if (search) {
      const haystack = `${s.name} ${s.schultyp} ${s.schulart}`.toLowerCase();
      if (!haystack.includes(search)) return;
    }

    // Watchlist filter
    if (showOnlyWatchlist && !wl[s.id]) return;

    const color = getSchoolColor(s);
    const isHighlighted = highlightedIds === null || highlightedIds.has(s.id);
    const isBookmarkedSchool = !!wl[s.id];
    const opacity = isHighlighted ? 0.95 : 0.2;
    const radius = isHighlighted ? (isBookmarkedSchool ? 8 : 6) : 4;

    const marker = L.circleMarker([s.lat, s.lng], {
      radius: radius,
      color: isBookmarkedSchool && isHighlighted ? '#d97706' : (isHighlighted ? '#ffffff' : 'transparent'),
      weight: isBookmarkedSchool && isHighlighted ? 2.5 : (isHighlighted ? 1.5 : 0),
      fillColor: color,
      fillOpacity: opacity,
      pane: isHighlighted ? 'markerPane' : 'shadowPane'
    });

    marker.on('click', () => showSchoolInfo(s));

    marker.on('mouseover', function() {
      this.setStyle({ radius: radius + 3, weight: 2.5, fillOpacity: 1 });
      this.bindTooltip(
        `<strong>${s.name}</strong>${isBookmarkedSchool ? ' ★' : ''}<br><span style="color:#666">${s.type}</span>`,
        { direction: 'top', offset: [0, -6] }
      ).openTooltip();
    });

    marker.on('mouseout', function() {
      this.setStyle({
        radius: radius,
        weight: isBookmarkedSchool && isHighlighted ? 2.5 : (isHighlighted ? 1.5 : 0),
        fillOpacity: opacity
      });
    });

    markers.push(marker);
  });

  schoolLayer = L.layerGroup(markers).addTo(map);
  updateResultCount(markers.length);
}

// ==============================
// SPATIAL FILTER — highlight zone schools, dim rest
// ==============================

function highlightSchoolsForZone(zoneFeature) {
  const highlightedIds = new Set();
  const schoolsInZone = [];

  allSchoolsClean.forEach(s => {
    try {
      const pt = turf.point([s.lng, s.lat]);
      if (turf.booleanPointInPolygon(pt, zoneFeature)) {
        highlightedIds.add(s.id);
        schoolsInZone.push(s);
      }
    } catch (e) {}
  });

  renderSchools(highlightedIds);
  updateSchoolList(schoolsInZone);
}

// ==============================
// FILTER HELPERS
// ==============================

function getSelectedSchoolTypes() {
  return Array.from(document.querySelectorAll('#schoolFilters input[type="checkbox"]'))
    .filter(cb => cb.checked)
    .map(cb => cb.value);
}

function getSelectedCarriers() {
  return Array.from(document.querySelectorAll('#ownerFilters input[type="checkbox"]'))
    .filter(cb => cb.checked)
    .map(cb => cb.value);
}

// ==============================
// UI
// ==============================

function updateResultCount(n) {
  const el = document.getElementById('resultCount');
  if (!el) return;
  el.innerHTML = `<span>${n}</span> Schulen gefunden`;
}

function showZoneInfo(zone) {
  document.getElementById('zoneInfo').innerHTML = `
    <div style="margin-bottom:8px;">
      <div class="info-label">Gebiet</div>
      <div class="info-val">${zone.name}</div>
    </div>
    <div style="margin-bottom:4px;">
      <div class="info-label">Schlüssel</div>
      <div style="font-family:'DM Mono',monospace;font-size:0.75rem;color:var(--text-secondary)">${zone.id}</div>
    </div>
    <div>
      <div class="info-label">Bezirk</div>
      <div style="color:var(--text-secondary);font-size:0.75rem">${zone.district} · ${zone.year}</div>
    </div>
    <div style="margin-top:8px;font-size:0.7rem;color:var(--text-muted);font-style:italic;">Erneut klicken zum Zurücksetzen</div>
  `;
}

function showSchoolInfo(s) {
  const color = getSchoolColor(s);
  const saved = isBookmarked(s.id);
  document.getElementById('schoolInfo').innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;">
      <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${color};flex-shrink:0;margin-top:3px;"></span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:0.85rem;color:var(--text);line-height:1.3;">${s.name}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:2px;">${s.type}</div>
      </div>
      <button class="bookmark-btn ${saved ? 'saved' : ''}" data-id="${s.id}"
              onclick="toggleBookmark(${JSON.stringify(s).replace(/"/g,'&quot;')}); this.classList.toggle('saved'); this.innerHTML = bookmarkBtnInner(this.classList.contains('saved'));">
        ${bookmarkBtnInner(saved)}
      </button>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px;">
      <div>
        <div class="info-label">BSN</div>
        <div style="font-family:'DM Mono',monospace;font-size:0.72rem;color:var(--text-secondary);">${s.bsn}</div>
      </div>
      <div>
        <div class="info-label">Träger</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);">${s.carrier}</div>
      </div>
      <div>
        <div class="info-label">Bezirk</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);">${s.district}</div>
      </div>
      <div>
        <div class="info-label">Ortsteil</div>
        <div style="font-size:0.75rem;color:var(--text-secondary);">${s.districtPart}</div>
      </div>
    </div>

    <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:6px;">${s.street}, ${s.zip} Berlin</div>

    ${s.phone ? `<div style="font-size:0.73rem;color:var(--text-muted);">📞 ${s.phone}</div>` : ''}
    ${s.email ? `<div style="font-size:0.73rem;color:var(--text-muted);">✉️ ${s.email}</div>` : ''}
    ${s.website ? `<div style="margin-top:6px;"><a href="${s.website}" target="_blank" style="font-size:0.73rem;color:var(--accent);text-decoration:none;">↗ Website</a></div>` : ''}
  `;
}

function updateSchoolList(schools) {
  if (!schools.length) {
    document.getElementById('schoolInfo').innerHTML =
      '<span style="color:var(--text-muted);font-style:italic;">Keine Schulen in diesem Gebiet.</span>';
    return;
  }

  document.getElementById('schoolInfo').innerHTML =
    `<div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:8px;">${schools.length} Schulen im Gebiet</div>` +
    schools.map(s => {
      const color = getSchoolColor(s);
      return `
        <div class="school-entry" style="cursor:pointer;" onclick="showSchoolInfo(${JSON.stringify(s).replace(/"/g,'&quot;')})">
          <div style="display:flex;align-items:center;gap:7px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
            <span style="font-weight:500;font-size:0.78rem;color:var(--text);">${s.name}</span>
          </div>
          <div style="font-size:0.7rem;color:var(--text-muted);padding-left:15px;">${s.type} · ${s.carrier}</div>
        </div>
      `;
    }).join('');
}

// ==============================
// CHIP TOGGLE VISUAL STATE
// ==============================

function syncChipStates() {
  document.querySelectorAll('#schoolFilters .filter-chip').forEach(label => {
    const cb = label.querySelector('input');
    label.classList.toggle('checked', cb.checked);
  });
  document.querySelectorAll('#ownerFilters .carrier-chip').forEach(label => {
    const cb = label.querySelector('input');
    label.classList.toggle('checked', cb.checked);
  });
}

// ==============================
// EVENTS
// ==============================

// Year buttons
document.getElementById('yearFilter').addEventListener('click', (e) => {
  const btn = e.target.closest('.year-btn');
  if (!btn) return;
  document.querySelectorAll('.year-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadZones(btn.dataset.year);
});

// School type filter
document.getElementById('schoolFilters').addEventListener('change', () => {
  syncChipStates();
  renderSchools();
});

// Carrier filter
document.getElementById('ownerFilters').addEventListener('change', () => {
  syncChipStates();
  renderSchools();
});

// Free text search
document.getElementById('searchInput').addEventListener('input', (e) => {
  currentSearchTerm = e.target.value;
  renderSchools();
});

// ==============================
// INIT
// ==============================

loadZones(2025);
loadSchools();
updateWatchlistBadge();
renderWatchlistPanel();
