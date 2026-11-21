import { PRESETS, TOOLBAR_PRESET_IDS } from './presets.js';
import { buildStockTrack, buildLaunchRamp, formatPrice, formatDate } from './track.js';
import { SpatialGrid, RiderSimulation } from './physics.js';

// ---------- DOM References ----------
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const searchInput = document.getElementById('searchInput');
const searchDropdown = document.getElementById('searchDropdown');
const searchSpinner = document.getElementById('searchSpinner');
const presetsBar = document.getElementById('presetsBar');
const timeframeBar = document.getElementById('timeframeBar');

const hudSymbol = document.getElementById('hudSymbol');
const hudBadge = document.getElementById('hudBadge');
const hudName = document.getElementById('hudName');
const hudPrice = document.getElementById('hudPrice');
const hudPct = document.getElementById('hudPct');
const hudDate = document.getElementById('hudDate');
const hudSpeed = document.getElementById('hudSpeed');
const hudAir = document.getElementById('hudAir');
const hudStatus = document.getElementById('hudStatus');
const hudNote = document.getElementById('hudNote');

const toastEl = document.getElementById('toast');

const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const playLabel = document.getElementById('playLabel');
const resetBtn = document.getElementById('resetBtn');
const toolbarEl = document.querySelector('.toolbar');
const undoBtn = document.getElementById('undoBtn');
const clearDrawBtn = document.getElementById('clearDrawBtn');
const infoWrap = document.getElementById('infoWrap');
const infoBtn = document.getElementById('infoBtn');
const infoPopover = document.getElementById('infoPopover');

const smoothSlider = document.getElementById('smoothSlider');
const smoothVal = document.getElementById('smoothVal');
const tiltSlider = document.getElementById('tiltSlider');
const tiltVal = document.getElementById('tiltVal');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomFitQuickBtn = document.getElementById('zoomFitQuickBtn');

// ---------- App State ----------
const state = {
  // Current stock data
  activePresetId: 'ANT',
  symbol: 'ANT',
  name: 'Anthropic, PBC',
  currency: 'USD',
  range: '2d',
  isLive: true,
  isPrivate: false,
  note: '',
  rawPoints: [],

  // Track & physics options
  steepness: 1.0,
  smoothness: 2,
  tiltDeg: 0,
  launchRamp: true,
  tool: 'pan', // 'pan' | 'ramp' | 'pencil' | 'eraser'

  // Built track + user-drawn strokes (each stroke is an array of segments)
  track: null,
  customRampAnchor: null,
  draggingRamp: false,
  rampDragOffset: { x: 0, y: 0 },
  userStrokes: [], // Array<{ type: 'ink', segments: Array<{ax,ay,bx,by,type}> }>
  activeStroke: null,

  // Playback
  playing: false,

  // Camera (world coordinate at screen center + zoom)
  cam: { x: 0, y: 0, zoom: 0.52, targetZoom: 0.52 },
  playZoomTarget: null,
  followRider: true,

  // Pointer
  pointer: { down: false, lastScreenX: 0, lastScreenY: 0, worldX: 0, worldY: 0 },
};

const grid = new SpatialGrid();
const sim = new RiderSimulation();

let toastTimer = null;
function showToast(msg, duration = 2600) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

// ---------- Spatial Grid & Track Building ----------
function rebuildGrid() {
  grid.clear();
  if (!state.track) return;
  grid.addSegments(state.track.rampSegments);
  grid.addSegments(state.track.segments);
  for (const stroke of state.userStrokes) {
    grid.addSegments(stroke.segments);
  }
}

function getSpawnPoint() {
  return state.track ? state.track.spawn : { x: 0, y: -40 };
}

function moveLaunchRamp(anchorX, anchorY) {
  if (!state.track) return;
  state.launchRamp = true;
  state.customRampAnchor = { x: anchorX, y: anchorY };
  const ramp = buildLaunchRamp(anchorX, anchorY);
  state.track.rampSegments = ramp.rampSegments;
  state.track.spawn = ramp.spawn;
  state.track.rampAnchor = ramp.anchor;
  state.track.rampHandle = ramp.handle;
  rebuildGrid();
  resetRider(false);
}

function isNearRamp(wx, wy) {
  if (!state.track || !state.launchRamp || !state.track.rampHandle) return false;
  const hitRadius = 32 / state.cam.zoom;
  const h = state.track.rampHandle;
  if (Math.hypot(wx - h.x, wy - h.y) <= hitRadius) return true;
  // Also allow grabbing directly on any ramp segment
  const segHit = 16 / state.cam.zoom;
  for (const s of state.track.rampSegments) {
    const mx = (s.ax + s.bx) * 0.5;
    const my = (s.ay + s.by) * 0.5;
    if (Math.hypot(wx - mx, wy - my) <= segHit) return true;
  }
  return false;
}

function resetRider(centerCamera = true) {
  state.playing = false;
  state.playZoomTarget = null;
  updatePlayButton();
  const sp = getSpawnPoint();
  // Classic Line Rider starts gently and builds speed from gravity
  sim.reset(sp.x, sp.y, 0.18);
  if (centerCamera) {
    state.followRider = true;
    // Start zoomed out so the user can see much more of the chart before hitting Play
    state.cam.zoom = 0.52;
    state.cam.targetZoom = 0.52;
    state.cam.x = sp.x + 480;
    state.cam.y = sp.y + 110;
  }
  lastHudX = null;
  updateHud(true);
}

function rebuildTrack(resetCamera = true) {
  if (resetCamera) {
    state.customRampAnchor = null;
  }
  state.track = buildStockTrack(state.rawPoints, {
    steepness: state.steepness,
    smoothness: state.smoothness,
    tiltDeg: state.tiltDeg,
    launchRamp: state.launchRamp,
    anchorAtInitialPeak: state.symbol === 'ANT',
  });
  // Preserve user-positioned ramp when smoothing or tilting
  if (!resetCamera && state.customRampAnchor && state.launchRamp) {
    const ramp = buildLaunchRamp(state.customRampAnchor.x, state.customRampAnchor.y);
    state.track.rampSegments = ramp.rampSegments;
    state.track.spawn = ramp.spawn;
    state.track.rampAnchor = ramp.anchor;
    state.track.rampHandle = ramp.handle;
  }
  rebuildGrid();
  resetRider(resetCamera);
}

function fitWholeChart() {
  if (!state.track) return;
  const { minX, maxX, minY, maxY } = state.track.bounds;
  const rect = canvas.getBoundingClientRect();
  const padX = 120;
  const padY = 140;
  const zx = (rect.width - padX) / Math.max(maxX - minX, 1);
  const zy = (rect.height - padY) / Math.max(maxY - minY, 1);
  const zoom = Math.max(0.12, Math.min(1.5, Math.min(zx, zy)));
  state.followRider = false;
  state.cam.x = (minX + maxX) * 0.5;
  state.cam.y = (minY + maxY) * 0.5;
  state.cam.zoom = zoom;
  state.cam.targetZoom = zoom;
}

// ---------- Data Loading (Presets + Live Yahoo Proxy) ----------
function applyTrackMeta() {
  hudSymbol.textContent = state.symbol;
  hudName.textContent = state.name;
  hudBadge.className = 'hud-badge';
  if (state.isPrivate) {
    hudBadge.textContent = 'PRIVATE';
    hudBadge.classList.add('private');
  } else if (state.isLive) {
    hudBadge.textContent = `LIVE · ${state.range.toUpperCase()}`;
    hudBadge.classList.add('live');
  } else {
    hudBadge.textContent = 'HALL OF FAME';
  }

  if (state.note) {
    hudNote.textContent = state.note;
    hudNote.classList.remove('hidden');
  } else {
    hudNote.classList.add('hidden');
  }

  // Timeframe selector is active for live public tickers
  timeframeBar.classList.toggle('disabled', !state.isLive);
  for (const btn of timeframeBar.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.range === state.range);
  }

  // Highlight active preset pill
  for (const btn of presetsBar.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.preset === state.activePresetId);
  }
}

async function loadPreset(presetId) {
  const preset = PRESETS[presetId];
  if (!preset) return;

  state.activePresetId = presetId;
  state.userStrokes = [];
  state.customSpawn = null;

  if (preset.isLive) {
    state.isLive = true;
    state.isPrivate = false;
    state.range = preset.range || '1y';
    const ok = await loadLiveTicker(preset.symbol, state.range, preset.name, presetId);
    if (!ok && preset.fallbackPoints) {
      state.symbol = preset.symbol;
      state.name = `${preset.name.replace(' (Live)', '')} (Offline Snapshot)`;
      state.currency = preset.currency || 'USD';
      state.isLive = false;
      state.note = 'Live API unavailable — loaded built-in snapshot.';
      state.rawPoints = preset.fallbackPoints;
      applyTrackMeta();
      rebuildTrack();
    }
    return;
  }

  state.symbol = preset.symbol;
  state.name = preset.name;
  state.currency = preset.currency || 'USD';
  state.range = preset.range || '1y';
  state.isLive = false;
  state.isPrivate = presetId.startsWith('PRIVATE:');
  state.note = preset.description || '';
  state.rawPoints = preset.points;
  applyTrackMeta();
  rebuildTrack();
}

async function loadLiveTicker(symbol, range = state.range, fallbackName = '', presetId = null) {
  if (symbol.startsWith('PRIVATE:')) {
    await loadPreset(symbol);
    return true;
  }

  showToast(`Loading ${symbol} (${range.toUpperCase()})...`, 2000);
  try {
    const resp = await fetch(
      `/api/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(range)}`
    );
    const data = await resp.json();
    if (!resp.ok || data.error) {
      showToast(data.error || `Could not load ${symbol}`, 3500);
      return false;
    }

    state.activePresetId = presetId;
    state.symbol = data.symbol;
    state.name = data.name || fallbackName || data.symbol;
    state.currency = data.currency || 'USD';
    state.range = data.range || range;
    state.isLive = true;
    state.isPrivate = false;
    state.note = '';
    state.rawPoints = data.points;
    state.userStrokes = [];
    state.customSpawn = null;
    applyTrackMeta();
    rebuildTrack();
    showToast(`Loaded ${data.symbol} · ${data.points.length} price points`, 1800);
    return true;
  } catch (err) {
    showToast(`Network error loading ${symbol}`, 3000);
    return false;
  }
}

// ---------- Search Autocomplete ----------
let searchDebounce = null;
let searchResults = [];
let selectedResultIdx = -1;

function renderSearchDropdown() {
  if (!searchResults.length) {
    searchDropdown.classList.add('hidden');
    return;
  }
  searchDropdown.innerHTML = searchResults
    .map(
      (item, idx) => `
      <div class="search-item ${idx === selectedResultIdx ? 'selected' : ''}" data-idx="${idx}">
        <div class="search-item-left">
          <span class="search-sym">${escapeHtml(
            item.symbol.replace('PRIVATE:', '')
          )}</span>
          <span class="search-name">${escapeHtml(item.name)}</span>
        </div>
        <span class="search-exch ${item.quoteType === 'PRIVATE' ? 'private' : ''}">
          ${escapeHtml(item.exchange || item.quoteType || '')}
        </span>
      </div>`
    )
    .join('');
  searchDropdown.classList.remove('hidden');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function performSearch(query) {
  const q = query.trim();
  if (!q) {
    searchResults = [];
    renderSearchDropdown();
    return;
  }
  searchSpinner.classList.remove('hidden');
  try {
    const resp = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await resp.json();
    searchResults = data.results || [];
    selectedResultIdx = searchResults.length > 0 ? 0 : -1;
    renderSearchDropdown();
  } catch {
    searchResults = [];
    renderSearchDropdown();
  } finally {
    searchSpinner.classList.add('hidden');
  }
}

function selectSearchResult(item) {
  if (!item) return;
  searchInput.value = '';
  searchResults = [];
  searchDropdown.classList.add('hidden');
  searchInput.blur();
  const defaultRange = item.symbol.toUpperCase() === 'ANT' ? '2d' : '1y';
  loadLiveTicker(item.symbol, defaultRange, item.name);
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  const val = searchInput.value;
  if (!val.trim()) {
    searchResults = [];
    renderSearchDropdown();
    return;
  }
  searchDebounce = setTimeout(() => performSearch(val), 220);
});

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (searchResults.length) {
      selectedResultIdx = (selectedResultIdx + 1) % searchResults.length;
      renderSearchDropdown();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (searchResults.length) {
      selectedResultIdx =
        (selectedResultIdx - 1 + searchResults.length) % searchResults.length;
      renderSearchDropdown();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (selectedResultIdx >= 0 && searchResults[selectedResultIdx]) {
      selectSearchResult(searchResults[selectedResultIdx]);
    } else if (searchInput.value.trim()) {
      // Allow direct ticker entry even if autocomplete hasn't finished
      const raw = searchInput.value.trim().toUpperCase();
      selectSearchResult({ symbol: raw, name: raw });
    }
  } else if (e.key === 'Escape') {
    searchDropdown.classList.add('hidden');
    searchInput.blur();
  }
});

searchDropdown.addEventListener('mousedown', (e) => {
  const row = e.target.closest('.search-item');
  if (!row) return;
  const idx = Number(row.dataset.idx);
  selectSearchResult(searchResults[idx]);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) {
    searchDropdown.classList.add('hidden');
  }
  if (!e.target.closest('#infoWrap')) {
    infoPinned = false;
    infoPopover.classList.add('hidden');
  }
});

// Info (i) hover + click popover
let infoPinned = false;
infoWrap.addEventListener('mouseenter', () => {
  infoPopover.classList.remove('hidden');
});
infoWrap.addEventListener('mouseleave', () => {
  if (!infoPinned) infoPopover.classList.add('hidden');
});
infoBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  infoPinned = !infoPinned;
  infoPopover.classList.toggle('hidden', !infoPinned);
});

// ---------- Presets & Timeframe UI ----------
for (const id of TOOLBAR_PRESET_IDS) {
  const p = PRESETS[id];
  const btn = document.createElement('button');
  btn.textContent = p.label;
  btn.dataset.preset = id;
  btn.addEventListener('click', () => loadPreset(id));
  presetsBar.appendChild(btn);
}

timeframeBar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-range]');
  if (!btn || !state.isLive) return;
  const range = btn.dataset.range;
  if (range === state.range) return;
  loadLiveTicker(state.symbol, range, state.name, state.activePresetId);
});

// ---------- Toolbar & Controls ----------
function updatePlayButton() {
  playIcon.textContent = state.playing ? '⏸' : '▶';
  playLabel.textContent = state.playing ? 'Pause' : 'Play';
  playBtn.classList.toggle('playing', state.playing);
}

function togglePlay() {
  state.playing = !state.playing;
  if (state.playing) {
    state.followRider = true;
    // Smoothly zoom in from overview when starting a run
    if (sim.time === 0 && state.cam.zoom < 0.85) {
      state.playZoomTarget = 0.92;
    }
  } else {
    state.playZoomTarget = null;
  }
  updatePlayButton();
}

function handleReset() {
  setTool('pan');
  resetRider(true);
}

playBtn.addEventListener('click', togglePlay);
resetBtn.addEventListener('click', handleReset);

function setTool(tool) {
  state.tool = tool;
  for (const btn of toolbarEl.querySelectorAll('button[data-tool]')) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  }
  canvas.classList.toggle('cursor-crosshair', tool !== 'pan');
}

toolbarEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tool]');
  if (!btn) return;
  setTool(btn.dataset.tool);
});

undoBtn.addEventListener('click', () => {
  if (state.userStrokes.length > 0) {
    state.userStrokes.pop();
    rebuildGrid();
  }
});

clearDrawBtn.addEventListener('click', () => {
  if (state.userStrokes.length > 0) {
    state.userStrokes = [];
    rebuildGrid();
    showToast('Cleared drawn lines', 1400);
  }
});

function setTilt(deg) {
  const clamped = Math.max(-40, Math.min(40, Math.round(deg)));
  if (clamped === state.tiltDeg) return;
  state.tiltDeg = clamped;
  tiltSlider.value = String(clamped);
  tiltVal.textContent = `${clamped > 0 ? '+' : ''}${clamped}°`;
  rebuildTrack(false);
}

smoothSlider.addEventListener('input', () => {
  state.smoothness = Number(smoothSlider.value);
  smoothVal.textContent = String(state.smoothness);
  rebuildTrack(false);
});

tiltSlider.addEventListener('input', () => {
  setTilt(Number(tiltSlider.value));
});

function zoomBy(factor) {
  state.playZoomTarget = null;
  const nextZoom = Math.max(0.12, Math.min(2.6, state.cam.zoom * factor));
  state.cam.zoom = nextZoom;
  state.cam.targetZoom = nextZoom;
}

zoomInBtn.addEventListener('click', () => zoomBy(1.25));
zoomOutBtn.addEventListener('click', () => zoomBy(1 / 1.25));
zoomFitQuickBtn.addEventListener('click', fitWholeChart);

// ---------- Coordinate Conversions ----------
function screenToWorld(sx, sy) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (sx - rect.width * 0.5) / state.cam.zoom + state.cam.x,
    y: (sy - rect.height * 0.5) / state.cam.zoom + state.cam.y,
  };
}

function worldToScreen(wx, wy) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (wx - state.cam.x) * state.cam.zoom + rect.width * 0.5,
    y: (wy - state.cam.y) * state.cam.zoom + rect.height * 0.5,
  };
}

// ---------- Canvas Pointer Interaction (Pan, Draw, Erase, Drop Flag) ----------
function eraseAt(wx, wy) {
  const eraseRadius = 18 / state.cam.zoom;
  let removed = false;
  for (let s = state.userStrokes.length - 1; s >= 0; s--) {
    const stroke = state.userStrokes[s];
    const kept = stroke.segments.filter((seg) => {
      const dx = seg.bx - seg.ax;
      const dy = seg.by - seg.ay;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((wx - seg.ax) * dx + (wy - seg.ay) * dy) / lenSq));
      const cx = seg.ax + t * dx;
      const cy = seg.ay + t * dy;
      const d = Math.hypot(wx - cx, wy - cy);
      if (d < eraseRadius) {
        removed = true;
        return false;
      }
      return true;
    });
    if (kept.length === 0) {
      state.userStrokes.splice(s, 1);
    } else {
      stroke.segments = kept;
    }
  }
  if (removed) rebuildGrid();
}

// Multi-touch pinch-to-zoom tracking
const activePointers = new Map();
let pinchLastDist = null;

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);

  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  activePointers.set(e.pointerId, { sx, sy });

  // Two-finger pinch-to-zoom on touch devices
  if (activePointers.size === 2) {
    state.activeStroke = null;
    const pts = [...activePointers.values()];
    pinchLastDist = Math.hypot(pts[1].sx - pts[0].sx, pts[1].sy - pts[0].sy);
    state.followRider = false;
    return;
  }

  const w = screenToWorld(sx, sy);

  state.pointer.down = true;
  state.pointer.lastScreenX = sx;
  state.pointer.lastScreenY = sy;
  state.pointer.worldX = w.x;
  state.pointer.worldY = w.y;

  // Middle click always pans
  if (e.button === 1) {
    state.followRider = false;
    canvas.classList.add('cursor-grabbing');
    return;
  }

  if (state.tool === 'rotate') {
    state.followRider = false;
    state.pointer.rotateStartY = sy;
    state.pointer.rotateStartDeg = state.tiltDeg;
    canvas.classList.add('cursor-grabbing');
    return;
  }

  // Move Ramp tool OR grabbing the blue ramp directly while paused in Pan mode
  if (
    state.tool === 'ramp' ||
    (state.tool === 'pan' && !state.playing && isNearRamp(w.x, w.y))
  ) {
    state.draggingRamp = true;
    state.followRider = false;
    canvas.classList.add('cursor-grabbing');
    if (state.tool === 'ramp') {
      // Tap/drag anywhere places the ramp exit right at the cursor
      state.rampDragOffset = { x: 0, y: 0 };
      moveLaunchRamp(w.x, w.y);
    } else {
      state.rampDragOffset = {
        x: state.track.rampAnchor.x - w.x,
        y: state.track.rampAnchor.y - w.y,
      };
    }
    return;
  }

  if (state.tool === 'pan') {
    state.followRider = false;
    canvas.classList.add('cursor-grabbing');
    return;
  }

  if (state.tool === 'eraser') {
    eraseAt(w.x, w.y);
    return;
  }

  // Drawing stroke: solid ink line
  state.activeStroke = {
    type: 'ink',
    lastX: w.x,
    lastY: w.y,
    segments: [],
  };
  state.userStrokes.push(state.activeStroke);
});

canvas.addEventListener('pointermove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (activePointers.has(e.pointerId)) {
    activePointers.set(e.pointerId, { sx, sy });
  }

  if (activePointers.size === 2) {
    const pts = [...activePointers.values()];
    const dist = Math.hypot(pts[1].sx - pts[0].sx, pts[1].sy - pts[0].sy);
    if (pinchLastDist && dist > 10) {
      const factor = dist / pinchLastDist;
      zoomBy(factor);
    }
    pinchLastDist = dist;
    return;
  }

  const w = screenToWorld(sx, sy);
  state.pointer.worldX = w.x;
  state.pointer.worldY = w.y;

  if (!state.pointer.down) return;

  if (state.tool === 'rotate') {
    // Dragging down tilts clockwise (more downhill to the right); dragging up tilts uphill
    const dy = sy - state.pointer.rotateStartY;
    setTilt(state.pointer.rotateStartDeg + dy * 0.22);
    return;
  }

  if (state.draggingRamp) {
    moveLaunchRamp(w.x + state.rampDragOffset.x, w.y + state.rampDragOffset.y);
    return;
  }

  if (state.tool === 'pan' || e.buttons === 4) {
    const dx = sx - state.pointer.lastScreenX;
    const dy = sy - state.pointer.lastScreenY;
    state.cam.x -= dx / state.cam.zoom;
    state.cam.y -= dy / state.cam.zoom;
    state.pointer.lastScreenX = sx;
    state.pointer.lastScreenY = sy;
    return;
  }

  if (state.tool === 'eraser') {
    eraseAt(w.x, w.y);
    return;
  }

  if (state.activeStroke) {
    const minSeg = 8 / state.cam.zoom;
    const dist = Math.hypot(w.x - state.activeStroke.lastX, w.y - state.activeStroke.lastY);
    if (dist >= minSeg) {
      const seg = {
        ax: state.activeStroke.lastX,
        ay: state.activeStroke.lastY,
        bx: w.x,
        by: w.y,
        type: state.activeStroke.type,
      };
      state.activeStroke.segments.push(seg);
      state.activeStroke.lastX = w.x;
      state.activeStroke.lastY = w.y;
      grid.addSegments([seg]);
    }
  }
});

function endPointer(e) {
  if (e && activePointers.has(e.pointerId)) {
    activePointers.delete(e.pointerId);
  }
  if (activePointers.size < 2) {
    pinchLastDist = null;
  }
  if (activePointers.size === 0) {
    state.pointer.down = false;
    state.draggingRamp = false;
    canvas.classList.remove('cursor-grabbing');
    if (state.activeStroke) {
      if (state.activeStroke.segments.length === 0) {
        state.userStrokes.pop();
      }
      state.activeStroke = null;
    }
  }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 18; // DOM_DELTA_LINE
    else if (e.deltaMode === 2) dy *= 200; // DOM_DELTA_PAGE
    if (Math.abs(dy) < 0.5) return;

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = screenToWorld(sx, sy);

    // Proportional exponential zoom (smooth on trackpads & mouse wheels, no inertia spikes)
    state.playZoomTarget = null;
    const clamped = Math.max(-120, Math.min(120, dy));
    const sensitivity = e.ctrlKey ? 0.006 : 0.0022;
    const factor = Math.exp(-clamped * sensitivity);
    const nextZoom = Math.max(0.12, Math.min(2.6, state.cam.zoom * factor));
    state.cam.zoom = nextZoom;
    state.cam.targetZoom = nextZoom;

    if (!state.followRider || !state.playing) {
      const after = screenToWorld(sx, sy);
      state.cam.x += before.x - after.x;
      state.cam.y += before.y - after.y;
    }
  },
  { passive: false }
);

// ---------- Keyboard Shortcuts ----------
window.addEventListener('keydown', (e) => {
  if (document.activeElement === searchInput) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undoBtn.click();
    return;
  }

  switch (e.code) {
    case 'Space':
      e.preventDefault();
      togglePlay();
      break;
    case 'KeyP':
      togglePlay();
      break;
    case 'KeyR':
      handleReset();
      break;
    case 'Digit1':
      setTool('pan');
      break;
    case 'Digit2':
      setTool('ramp');
      break;
    case 'Digit3':
      setTool('pencil');
      break;
    case 'Digit4':
      setTool('eraser');
      break;
  }
});

// ---------- HUD Update ----------
let lastHudUpdateTs = 0;
let lastHudX = null;

function updateHud(force = false) {
  if (!state.track) return;
  const now = performance.now();
  // Throttle to ~12 Hz so numbers stay readable and never flicker wildly
  if (!force && now - lastHudUpdateTs < 80) return;
  lastHudUpdateTs = now;

  const center = sim.getCenter();
  const kmh = sim.speed < 0.28 ? 0 : Math.round(sim.speed * 7.5);
  const isStopped = state.playing && sim.time > 0.6 && kmh === 0;

  // Only update displayed price/date if forced or rider moved meaningfully (> 2px)
  if (force || lastHudX === null || Math.abs(center.x - lastHudX) > 2.0) {
    lastHudX = center.x;
    const sample = state.track.getSampleAtX(center.x);
    if (sample) {
      hudPrice.textContent = formatPrice(sample.price, state.currency);
      const pct = sample.pctChange;
      const sign = pct >= 0 ? '+' : '';
      hudPct.textContent = `${sign}${pct.toFixed(1)}%`;
      hudPct.className = `hud-pct ${pct >= 0 ? 'up' : 'down'}`;
      hudDate.textContent = sample.onRamp
        ? `Launch Ramp → ${formatDate(sample.t, state.range)}`
        : formatDate(sample.t, state.range);
    }
  }

  hudSpeed.textContent = `${kmh} km/h`;
  hudAir.textContent = `Air ${sim.airTime.toFixed(1)}s`;

  hudStatus.className = '';
  if (!state.playing && sim.time === 0) {
    hudStatus.textContent = 'READY';
    hudStatus.classList.add('status-ready');
  } else if (sim.finished) {
    hudStatus.textContent = 'FINISHED!';
    hudStatus.classList.add('status-finished');
  } else if (!sim.mounted) {
    hudStatus.textContent = isStopped ? 'BAILED' : 'BAILED!';
    hudStatus.classList.add('status-bailed');
  } else if (isStopped) {
    hudStatus.textContent = 'STOPPED';
    hudStatus.classList.add('status-ready');
  } else {
    hudStatus.textContent = 'RIDING';
    hudStatus.classList.add('status-riding');
  }
}

// ---------- Canvas Rendering ----------
function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

window.addEventListener('resize', resizeCanvas);

function drawGridBackground(w, h) {
  ctx.fillStyle = '#faf9f5';
  ctx.fillRect(0, 0, w, h);

  const zoom = state.cam.zoom;
  const baseStep = zoom < 0.35 ? 320 : zoom < 0.7 ? 160 : 80;
  const left = state.cam.x - w * 0.5 / zoom;
  const right = state.cam.x + w * 0.5 / zoom;
  const top = state.cam.y - h * 0.5 / zoom;
  const bottom = state.cam.y + h * 0.5 / zoom;

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();

  const startX = Math.floor(left / baseStep) * baseStep;
  for (let x = startX; x <= right; x += baseStep) {
    const sx = (x - state.cam.x) * zoom + w * 0.5;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, h);
  }

  const startY = Math.floor(top / baseStep) * baseStep;
  for (let y = startY; y <= bottom; y += baseStep) {
    const sy = (y - state.cam.y) * zoom + h * 0.5;
    ctx.moveTo(0, sy);
    ctx.lineTo(w, sy);
  }
  ctx.stroke();

  // Subtle horizontal price guide lines from stock track
  if (state.track && state.track.worldPoints.length > 1) {
    const { minPrice, maxPrice } = state.track;
    const verticalSpan = 620 * state.steepness;
    const levels = 5;
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = 'rgba(100, 116, 139, 0.55)';
    ctx.textAlign = 'right';

    for (let i = 0; i <= levels; i++) {
      const norm = i / levels;
      const wy = (0.5 - norm) * verticalSpan;
      const sy = (wy - state.cam.y) * zoom + h * 0.5;
      if (sy < 20 || sy > h - 20) continue;

      ctx.strokeStyle = 'rgba(100, 116, 139, 0.14)';
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
      ctx.stroke();
      ctx.setLineDash([]);

      const price = minPrice + (maxPrice - minPrice) * norm;
      ctx.fillText(formatPrice(price, state.currency), w - 12, sy - 4);
    }
  }
}

function drawStockTrack() {
  const track = state.track;
  if (!track || track.worldPoints.length < 2) return;

  // 1. Subtle financial area fill under the stock line
  const first = track.worldPoints[0];
  const last = track.worldPoints[track.worldPoints.length - 1];
  const bottomY = track.bounds.maxY + 260;

  const grad = ctx.createLinearGradient(0, track.bounds.minY, 0, bottomY);
  const overallUp = last.price >= first.price;
  grad.addColorStop(0, overallUp ? 'rgba(5, 150, 105, 0.12)' : 'rgba(220, 38, 38, 0.11)');
  grad.addColorStop(1, 'rgba(250, 249, 245, 0.0)');

  ctx.beginPath();
  ctx.moveTo(first.x, bottomY);
  for (const pt of track.worldPoints) {
    ctx.lineTo(pt.x, pt.y);
  }
  ctx.lineTo(last.x, bottomY);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // 2. Date tick markers along the stock chart
  const tickEvery = Math.max(1, Math.floor(track.worldPoints.length / 10));
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = 'rgba(100, 116, 139, 0.72)';
  ctx.textAlign = 'center';
  for (let i = 0; i < track.worldPoints.length; i += tickEvery) {
    const pt = track.worldPoints[i];
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y + 6);
    ctx.lineTo(pt.x, pt.y + 24);
    ctx.stroke();
    ctx.fillText(formatDate(pt.t, state.range), pt.x, pt.y + 38);
  }

  // 3. Launch Ramp (if enabled, draggable!)
  if (track.rampSegments.length > 0) {
    const anchorY = track.rampAnchor ? track.rampAnchor.y : first.y;
    // Support struts
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.22)';
    ctx.lineWidth = 2;
    for (let i = 0; i < track.rampSegments.length; i += 4) {
      const s = track.rampSegments[i];
      ctx.beginPath();
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.ax, anchorY + 24);
      ctx.stroke();
    }

    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 4.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(track.rampSegments[0].ax, track.rampSegments[0].ay);
    for (const s of track.rampSegments) {
      ctx.lineTo(s.bx, s.by);
    }
    ctx.stroke();

    // Drag handle badge when paused so it's obvious the on-ramp is movable
    if (!state.playing && track.rampHandle) {
      const h = track.rampHandle;
      ctx.save();
      ctx.fillStyle = state.draggingRamp ? '#1d4ed8' : '#2563eb';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✥', h.x, h.y + 0.5);
      ctx.restore();
    }
  }

  // 4. Stock line segments — crisp ink base + green/red directional top edge
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Dark ink under-stroke for classic Line Rider clarity
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 5.0;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < track.worldPoints.length; i++) {
    ctx.lineTo(track.worldPoints[i].x, track.worldPoints[i].y);
  }
  ctx.stroke();

  // Green/Red price movement highlight
  ctx.lineWidth = 2.6;
  for (const s of track.segments) {
    ctx.strokeStyle = s.isUp ? '#10b981' : '#ef4444';
    ctx.beginPath();
    ctx.moveTo(s.ax, s.ay);
    ctx.lineTo(s.bx, s.by);
    ctx.stroke();
  }

  // 5. Subtle finish line at the end of the chart
  drawFinishLine(last.x, last.y);
}

function drawFinishLine(x, y) {
  ctx.save();
  ctx.strokeStyle = 'rgba(24, 24, 27, 0.35)';
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(x, y + 10);
  ctx.lineTo(x, y - 56);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.font = '800 10px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#52525b';
  ctx.textAlign = 'center';
  ctx.fillText('END', x, y - 62);
  ctx.restore();
}

function drawUserStrokes() {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of state.userStrokes) {
    if (!stroke.segments.length) continue;

    if (stroke.type === 'ink') {
      ctx.strokeStyle = '#18181b';
      ctx.lineWidth = 4.2;
    } else if (stroke.type === 'boost') {
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 4.8;
    } else {
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.72)';
      ctx.lineWidth = 2.8;
    }

    ctx.beginPath();
    for (const s of stroke.segments) {
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.bx, s.by);
    }
    ctx.stroke();

    // Draw subtle boost direction arrows on red boost lines
    if (stroke.type === 'boost') {
      ctx.strokeStyle = '#fef08a';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < stroke.segments.length; i += 2) {
        const s = stroke.segments[i];
        const mx = (s.ax + s.bx) * 0.5;
        const my = (s.ay + s.by) * 0.5;
        const ang = Math.atan2(s.by - s.ay, s.bx - s.ax);
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        ctx.beginPath();
        ctx.moveTo(-4, -3.5);
        ctx.lineTo(2, 0);
        ctx.lineTo(-4, 3.5);
        ctx.stroke();
        ctx.restore();
      }
    }
  }
}

function drawRider() {
  if (!sim.p) return;
  const { tail, nose, backTop, frontTop, butt, shoulder, hand, head } = sim.p;

  // 1. Sparks / snow spray / boost flames
  for (const sp of sim.sparks) {
    ctx.globalAlpha = Math.max(0, sp.life);
    ctx.fillStyle = sp.color;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 2.2 + sp.life * 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 2. Skis / Sled runner (classic upturned Line Rider sled)
  const sdx = nose.x - tail.x;
  const sdy = nose.y - tail.y;
  const slen = Math.hypot(sdx, sdy) || 1;
  const fx = sdx / slen;
  const fy = sdy / slen;
  const ux = fy; // up vector (screen -Y when level)
  const uy = -fx;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Ski/sled runner base
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(tail.x - fx * 4, tail.y - fy * 4);
  ctx.lineTo(nose.x + fx * 3, nose.y + fy * 3);
  // Upturned curved tip
  ctx.quadraticCurveTo(
    nose.x + fx * 11,
    nose.y + fy * 11,
    nose.x + fx * 10 + ux * 9,
    nose.y + fy * 10 + uy * 9
  );
  ctx.stroke();

  // Sled deck & struts
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(backTop.x, backTop.y);
  ctx.lineTo(frontTop.x, frontTop.y);
  ctx.moveTo(tail.x + fx * 6, tail.y + fy * 6);
  ctx.lineTo(backTop.x + fx * 3, backTop.y + fy * 3);
  ctx.moveTo(nose.x - fx * 6, nose.y - fy * 6);
  ctx.lineTo(frontTop.x - fx * 3, frontTop.y - fy * 3);
  ctx.stroke();

  // 3. Flowing Crimson Scarf
  if (sim.scarf.length > 1) {
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 4.2;
    ctx.beginPath();
    ctx.moveTo(sim.scarf[0].x, sim.scarf[0].y);
    for (let i = 1; i < sim.scarf.length; i++) {
      ctx.lineTo(sim.scarf[i].x, sim.scarf[i].y);
    }
    ctx.stroke();

    // Classic white stripe on scarf
    ctx.strokeStyle = 'rgba(255,255,255,0.65)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 4. Rider Stick Figure
  // Legs (connected to sled if mounted, flailing if bailed)
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  if (sim.mounted) {
    const kneeX = (butt.x + frontTop.x) * 0.5 + fx * 3;
    const kneeY = (butt.y + frontTop.y) * 0.5 + fy * 3;
    ctx.moveTo(butt.x, butt.y);
    ctx.lineTo(kneeX, kneeY);
    ctx.lineTo(frontTop.x - fx * 2, frontTop.y - fy * 2);
  } else {
    // Ragdoll legs trailing from butt
    const bdx = butt.x - shoulder.x;
    const bdy = butt.y - shoulder.y;
    ctx.moveTo(butt.x, butt.y);
    ctx.lineTo(butt.x + bdx * 0.7 + 4, butt.y + bdy * 0.7 + 6);
    ctx.moveTo(butt.x, butt.y);
    ctx.lineTo(butt.x + bdx * 0.6 - 5, butt.y + bdy * 0.6 + 8);
  }
  ctx.stroke();

  // Torso
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 3.8;
  ctx.beginPath();
  ctx.moveTo(butt.x, butt.y);
  ctx.lineTo(shoulder.x, shoulder.y);
  ctx.stroke();

  // Arm + Reins / Ski Pole
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(hand.x, hand.y);
  ctx.stroke();

  if (sim.mounted) {
    ctx.strokeStyle = 'rgba(24, 24, 27, 0.45)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(hand.x, hand.y);
    ctx.lineTo(nose.x + fx * 8 + ux * 7, nose.y + fy * 8 + uy * 7);
    ctx.stroke();
  }

  // Head + Beanie
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(head.x, head.y, 5.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Little beanie cap
  const headAng = Math.atan2(head.y - shoulder.y, head.x - shoulder.x) + Math.PI * 0.5;
  ctx.fillStyle = '#18181b';
  ctx.beginPath();
  ctx.arc(head.x, head.y, 5.8, headAng - Math.PI * 0.9, headAng - Math.PI * 0.1);
  ctx.fill();
}

function drawToolCursor() {
  if (state.tool === 'eraser') {
    const r = 18 / state.cam.zoom;
    ctx.save();
    ctx.strokeStyle = 'rgba(220, 38, 38, 0.7)';
    ctx.lineWidth = 1.5 / state.cam.zoom;
    ctx.setLineDash([4 / state.cam.zoom, 4 / state.cam.zoom]);
    ctx.beginPath();
    ctx.arc(state.pointer.worldX, state.pointer.worldY, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

// ---------- Main Loop ----------
function tick() {
  if (state.playing && state.track) {
    sim.step(grid, 'classic', {}, state.track.bounds.maxX);

    if (state.followRider) {
      const center = sim.getCenter();
      const vel = sim.getVelocity();
      // Smooth look-ahead camera (preserves user's chosen zoom level)
      const targetX = center.x + vel.vx * 36 + 80;
      const targetY = center.y + vel.vy * 18;
      state.cam.x += (targetX - state.cam.x) * 0.1;
      state.cam.y += (targetY - state.cam.y) * 0.1;

      // One-shot smooth zoom-in when Play starts from the zoomed-out overview
      if (state.playZoomTarget !== null) {
        const diff = state.playZoomTarget - state.cam.zoom;
        if (Math.abs(diff) < 0.005) {
          state.cam.zoom = state.playZoomTarget;
          state.playZoomTarget = null;
        } else {
          state.cam.zoom += diff * 0.06;
        }
      }
    }
    updateHud();
  }

  // Render
  const rect = canvas.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;

  drawGridBackground(w, h);

  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.scale(state.cam.zoom, state.cam.zoom);
  ctx.translate(-state.cam.x, -state.cam.y);

  drawStockTrack();
  drawUserStrokes();
  drawRider();
  drawToolCursor();

  ctx.restore();

  requestAnimationFrame(tick);
}

// ---------- Boot ----------
resizeCanvas();
loadPreset('ANT');
requestAnimationFrame(tick);
