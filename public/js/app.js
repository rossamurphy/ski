import { PRESETS, TOOLBAR_PRESET_IDS } from './presets.js';
import { buildStockTrack, formatPrice, formatDate } from './track.js';
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

const controlsHint = document.getElementById('controlsHint');
const toastEl = document.getElementById('toast');

const playBtn = document.getElementById('playBtn');
const playIcon = document.getElementById('playIcon');
const playLabel = document.getElementById('playLabel');
const resetBtn = document.getElementById('resetBtn');
const drawToolsEl = document.getElementById('drawTools');
const undoBtn = document.getElementById('undoBtn');
const clearDrawBtn = document.getElementById('clearDrawBtn');
const modeClassicBtn = document.getElementById('modeClassic');
const modeControlsBtn = document.getElementById('modeControls');

const tuneBtn = document.getElementById('tuneBtn');
const tunePopover = document.getElementById('tunePopover');
const steepSlider = document.getElementById('steepSlider');
const steepVal = document.getElementById('steepVal');
const smoothSlider = document.getElementById('smoothSlider');
const smoothVal = document.getElementById('smoothVal');
const rampToggle = document.getElementById('rampToggle');
const fitViewBtn = document.getElementById('fitViewBtn');

// ---------- App State ----------
const state = {
  // Current stock data
  activePresetId: 'GME21',
  symbol: 'GME',
  name: 'GameStop Short Squeeze (2021)',
  currency: 'USD',
  range: '6mo',
  isLive: false,
  isPrivate: false,
  note: '',
  rawPoints: [],

  // Track & physics options
  steepness: 1.0,
  smoothness: 1,
  launchRamp: true,
  mode: 'classic', // 'classic' | 'controls'
  tool: 'pan', // 'pan' | 'pencil' | 'boost' | 'scenery' | 'eraser' | 'spawn'

  // Built track + user-drawn strokes (each stroke is an array of segments)
  track: null,
  customSpawn: null,
  userStrokes: [], // Array<{ type: 'ink'|'boost'|'scenery', segments: Array<{ax,ay,bx,by,type}> }>
  activeStroke: null,

  // Playback
  playing: false,

  // Camera (world coordinate at screen center + zoom)
  cam: { x: 0, y: 0, zoom: 1.0, targetZoom: 1.0 },
  followRider: true,

  // Pointer & input
  pointer: { down: false, lastScreenX: 0, lastScreenY: 0, worldX: 0, worldY: 0 },
  input: { left: false, right: false, down: false, jump: false, boost: false },
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
  if (state.customSpawn) return state.customSpawn;
  return state.track ? state.track.spawn : { x: 0, y: -40 };
}

function resetRider(centerCamera = true) {
  state.playing = false;
  updatePlayButton();
  const sp = getSpawnPoint();
  sim.reset(sp.x, sp.y, state.launchRamp && !state.customSpawn ? 2.4 : 1.6);
  if (centerCamera) {
    state.followRider = true;
    state.cam.x = sp.x + 120;
    state.cam.y = sp.y + 30;
    state.cam.zoom = 1.0;
    state.cam.targetZoom = 1.0;
  }
  updateHud();
}

function rebuildTrack(preserveCustomSpawn = false) {
  state.track = buildStockTrack(state.rawPoints, {
    steepness: state.steepness,
    smoothness: state.smoothness,
    launchRamp: state.launchRamp,
  });
  if (!preserveCustomSpawn) {
    state.customSpawn = null;
  }
  rebuildGrid();
  resetRider(true);
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
  if (item.symbol.startsWith('PRIVATE:')) {
    loadPreset(item.symbol);
  } else {
    loadLiveTicker(item.symbol, state.isLive ? state.range : '1y', item.name);
  }
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
      const raw = searchInput.value.trim();
      const lower = raw.toLowerCase();
      if (lower.includes('anthropic')) {
        selectSearchResult({ symbol: 'PRIVATE:ANTHROPIC', name: 'Anthropic' });
      } else if (lower.includes('openai')) {
        selectSearchResult({ symbol: 'PRIVATE:OPENAI', name: 'OpenAI' });
      } else {
        selectSearchResult({ symbol: raw.toUpperCase(), name: raw.toUpperCase() });
      }
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
  if (!e.target.closest('#tunePopover') && !e.target.closest('#tuneBtn')) {
    tunePopover.classList.add('hidden');
  }
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
  }
  updatePlayButton();
}

playBtn.addEventListener('click', togglePlay);
resetBtn.addEventListener('click', () => resetRider(true));

function setTool(tool) {
  state.tool = tool;
  for (const btn of drawToolsEl.querySelectorAll('button[data-tool]')) {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  }
  canvas.classList.toggle('cursor-crosshair', tool !== 'pan');
}

drawToolsEl.addEventListener('click', (e) => {
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

function setMode(mode) {
  state.mode = mode;
  modeClassicBtn.classList.toggle('active', mode === 'classic');
  modeControlsBtn.classList.toggle('active', mode === 'controls');
  controlsHint.classList.toggle('hidden', mode !== 'controls');
}

modeClassicBtn.addEventListener('click', () => setMode('classic'));
modeControlsBtn.addEventListener('click', () => setMode('controls'));

tuneBtn.addEventListener('click', () => {
  tunePopover.classList.toggle('hidden');
});

steepSlider.addEventListener('input', () => {
  state.steepness = Number(steepSlider.value);
  steepVal.textContent = `${state.steepness.toFixed(2)}×`;
  rebuildTrack();
});

smoothSlider.addEventListener('input', () => {
  state.smoothness = Number(smoothSlider.value);
  smoothVal.textContent = String(state.smoothness);
  rebuildTrack();
});

rampToggle.addEventListener('change', () => {
  state.launchRamp = rampToggle.checked;
  rebuildTrack();
});

fitViewBtn.addEventListener('click', () => {
  fitWholeChart();
  tunePopover.classList.add('hidden');
});

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

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  canvas.setPointerCapture(e.pointerId);

  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const w = screenToWorld(sx, sy);

  state.pointer.down = true;
  state.pointer.lastScreenX = sx;
  state.pointer.lastScreenY = sy;
  state.pointer.worldX = w.x;
  state.pointer.worldY = w.y;

  // Middle click always pans
  if (e.button === 1 || state.tool === 'pan') {
    state.followRider = false;
    canvas.classList.add('cursor-grabbing');
    return;
  }

  if (state.tool === 'spawn') {
    state.customSpawn = { x: w.x, y: w.y - 12 };
    resetRider(false);
    showToast('Moved start flag! Hit Play to drop in.', 1700);
    return;
  }

  if (state.tool === 'eraser') {
    eraseAt(w.x, w.y);
    return;
  }

  // Drawing stroke: pencil -> 'ink', boost -> 'boost', scenery -> 'scenery'
  const lineType =
    state.tool === 'boost' ? 'boost' : state.tool === 'scenery' ? 'scenery' : 'ink';
  state.activeStroke = {
    type: lineType,
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
  const w = screenToWorld(sx, sy);
  state.pointer.worldX = w.x;
  state.pointer.worldY = w.y;

  if (!state.pointer.down) return;

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

function endPointer() {
  state.pointer.down = false;
  canvas.classList.remove('cursor-grabbing');
  if (state.activeStroke) {
    if (state.activeStroke.segments.length === 0) {
      state.userStrokes.pop();
    }
    state.activeStroke = null;
  }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const before = screenToWorld(sx, sy);

    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
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

// ---------- Keyboard Shortcuts & Controls ----------
window.addEventListener('keydown', (e) => {
  if (document.activeElement === searchInput) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undoBtn.click();
    return;
  }

  switch (e.code) {
    case 'ArrowLeft':
    case 'KeyA':
      state.input.left = true;
      break;
    case 'ArrowRight':
    case 'KeyD':
      state.input.right = true;
      break;
    case 'ArrowDown':
    case 'KeyS':
      state.input.down = true;
      break;
    case 'ArrowUp':
      state.input.jump = true;
      if (state.mode === 'controls') e.preventDefault();
      break;
    case 'Space':
      e.preventDefault();
      if (state.mode === 'controls' && state.playing) {
        state.input.jump = true;
      } else {
        togglePlay();
      }
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
    case 'KeyW':
      state.input.boost = true;
      break;
    case 'KeyP':
      togglePlay();
      break;
    case 'KeyR':
      resetRider(true);
      break;
    case 'Digit1':
      setTool('pan');
      break;
    case 'Digit2':
      setTool('pencil');
      break;
    case 'Digit3':
      setTool('boost');
      break;
    case 'Digit4':
      setTool('scenery');
      break;
    case 'Digit5':
      setTool('eraser');
      break;
    case 'Digit6':
      setTool('spawn');
      break;
  }
});

window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'ArrowLeft':
    case 'KeyA':
      state.input.left = false;
      break;
    case 'ArrowRight':
    case 'KeyD':
      state.input.right = false;
      break;
    case 'ArrowDown':
    case 'KeyS':
      state.input.down = false;
      break;
    case 'ArrowUp':
    case 'Space':
      state.input.jump = false;
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
    case 'KeyW':
      state.input.boost = false;
      break;
  }
});

// ---------- HUD Update ----------
function updateHud() {
  if (!state.track) return;
  const center = sim.getCenter();
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

  const kmh = Math.round(sim.speed * 7.5);
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
    hudStatus.textContent = 'BAILED!';
    hudStatus.classList.add('status-bailed');
  } else {
    hudStatus.textContent = sim.boosting ? 'BOOSTING' : 'RIDING';
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

  // 3. Launch Ramp (if enabled)
  if (track.rampSegments.length > 0) {
    // Support struts
    ctx.strokeStyle = 'rgba(37, 99, 235, 0.22)';
    ctx.lineWidth = 2;
    for (let i = 0; i < track.rampSegments.length; i += 4) {
      const s = track.rampSegments[i];
      ctx.beginPath();
      ctx.moveTo(s.ax, s.ay);
      ctx.lineTo(s.ax, first.y + 30);
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

  // 5. Start & Finish flags
  const sp = getSpawnPoint();
  drawFlag(sp.x - 16, sp.y + 12, '#059669', 'START');
  drawFlag(last.x, last.y, '#18181b', 'FINISH');
}

function drawFlag(x, y, color, label) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 42);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x, y - 42);
  ctx.lineTo(x + 28, y - 34);
  ctx.lineTo(x, y - 26);
  ctx.closePath();
  ctx.fill();

  ctx.font = '800 9px Inter, sans-serif';
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 5, y - 46);
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
    sim.step(grid, state.mode, state.input, state.track.bounds.maxX);

    if (state.followRider) {
      const center = sim.getCenter();
      const vel = sim.getVelocity();
      // Smooth look-ahead camera
      const targetX = center.x + vel.vx * 36 + 80;
      const targetY = center.y + vel.vy * 18;
      state.cam.x += (targetX - state.cam.x) * 0.1;
      state.cam.y += (targetY - state.cam.y) * 0.1;

      // Subtle dynamic zoom out at high speeds
      const desiredZoom = Math.max(0.55, Math.min(1.05, 1.05 - sim.speed * 0.022));
      state.cam.zoom += (desiredZoom - state.cam.zoom) * 0.03;
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
loadPreset('GME21');
requestAnimationFrame(tick);
