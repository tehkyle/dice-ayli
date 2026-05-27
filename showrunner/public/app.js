// --- State ---
let currentShowId = null;
let actors = [];          // [{ name, subtitle, image }]
let characterTracks = []; // [{ id, label, subtitle }]
let acts = [];            // [{ id, label, scenes: [] }]
const actOrderedState = {}; // actId → boolean: is act in fixed-order mode?
const actOrderedLists = {}; // actId → string[]: ordered scene IDs for rigged acts
let scenesPlayed = [];    // [{ scene, time, duration }] — live-filled during show
let lockTime = null;      // Date — set when cast is locked
let socket = null;        // socket.io connection

// --- DOM refs ---
const screens = {
  welcome:  document.getElementById('screen-welcome'),
  scenes:   document.getElementById('screen-scenes'),
  cast:     document.getElementById('screen-cast'),
  confirm:  document.getElementById('screen-confirm'),
  progress: document.getElementById('screen-progress'),
  summary:  document.getElementById('screen-summary'),
};

const todayDateEl     = document.getElementById('today-date');
const perfNumberEl    = document.getElementById('perf-number');
const btnBegin        = document.getElementById('btn-begin');
const qlabDot         = document.getElementById('qlab-dot');
const qlabStatusText  = document.getElementById('qlab-status-text');
const qlabMissingEl   = document.getElementById('qlab-missing');
const btnRetryQlab    = document.getElementById('btn-retry-qlab');
const actRowsEl       = document.getElementById('act-rows');
const btnBackScenes   = document.getElementById('btn-back-scenes');
const btnNextCast     = document.getElementById('btn-next-cast');
const castRowsEl      = document.getElementById('cast-rows');
const dupWarning      = document.getElementById('duplicate-warning');
const btnBackCast     = document.getElementById('btn-back-cast');
const btnRandomize    = document.getElementById('btn-randomize');
const btnReview       = document.getElementById('btn-review');
const btnBackConfirm  = document.getElementById('btn-back-confirm');
const castSummaryEl   = document.getElementById('cast-summary');
const lockStatusEl    = document.getElementById('lock-status');
const btnLock         = document.getElementById('btn-lock');
const btnNewShow      = document.getElementById('btn-new-show');

// Progress / Summary refs
const progressMetaEl    = document.getElementById('progress-meta');
const progressSceneList = document.getElementById('progress-scene-list');
const summaryStatsEl    = document.getElementById('summary-stats');
const summaryCastEl     = document.getElementById('summary-cast');
const summaryScenesEl   = document.getElementById('summary-scenes');
const summarySheetLink  = document.getElementById('summary-sheet-link');
const btnSummaryNewShow = document.getElementById('btn-summary-new-show');

// Modal refs
const modalOverlay    = document.getElementById('modal-overlay');
const modalClose      = document.getElementById('modal-close');
const modalDisconnected = document.getElementById('modal-state-disconnected');
const modalConnected  = document.getElementById('modal-state-connected');
const modalAuthError  = document.getElementById('modal-auth-error');
const modalEmail      = document.getElementById('modal-account-email');
const sheetPicker     = document.getElementById('sheet-picker');
const tabField        = document.getElementById('tab-field');
const tabPicker       = document.getElementById('tab-picker');
const btnSaveSheets   = document.getElementById('btn-save-sheets');
const modalSaveStatus = document.getElementById('modal-save-status');
const btnDisconnect   = document.getElementById('btn-disconnect');
const btnSettings     = document.getElementById('btn-settings');
const settingsBadge   = document.getElementById('settings-badge');

// --- Screen transitions ---
function showScreen(name) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[name].classList.add('active');
}

// --- Utilities ---
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function actorImageUrl(image) {
  return image ? `/images/actors/${image}` : null;
}

function getCastSelections() {
  const result = {};
  characterTracks.forEach(track => {
    const sel = document.getElementById(`select-${track.id}`);
    result[track.id] = sel ? sel.value : '';
  });
  return result;
}

function getSceneSelections() {
  const result = {};
  acts.forEach(act => {
    result[act.id] = act.scenes.filter(scene => {
      const cb = document.getElementById(`scene-${act.id}-${scene}`);
      return cb ? cb.checked : false;
    });
  });
  return result;
}

function buildScenePayload() {
  const scenes = {};
  const scenesOrdered = {};
  acts.forEach(act => {
    if (actOrderedState[act.id]) {
      scenes[act.id] = [...(actOrderedLists[act.id] || [])];
      scenesOrdered[act.id] = true;
    } else {
      scenes[act.id] = act.scenes.filter(scene => {
        const cb = document.getElementById(`scene-${act.id}-${scene}`);
        return cb ? cb.checked : false;
      });
    }
  });
  return { scenes, scenesOrdered };
}

function hasDuplicates(castMap) {
  const vals = Object.values(castMap).filter(Boolean);
  return vals.length !== new Set(vals).size;
}

function allAssigned(castMap) {
  return Object.values(castMap).every(v => v !== '');
}

function getActorByName(name) {
  return actors.find(a => a.name === name) || null;
}

// --- Screen 1: Welcome ---
async function initWelcomeScreen() {
  const today = new Date().toISOString().slice(0, 10);
  todayDateEl.textContent = formatDate(today);

  try {
    const res = await fetch('/api/shows');
    const allShows = await res.json();
    perfNumberEl.textContent = `Performance #${allShows.length + 1}`;
  } catch {
    perfNumberEl.textContent = 'Performance #—';
  }

  await checkQlabStatus();
}

function setQlabStatus(state, text, missingVars = []) {
  qlabDot.className = `status-dot ${state}`;
  qlabStatusText.textContent = text;

  if (missingVars.length) {
    qlabMissingEl.classList.remove('hidden');
    qlabMissingEl.innerHTML = `<strong>Missing cues in QLab:</strong> ${missingVars.map(v => `<code>${v}</code>`).join(', ')}`;
  } else {
    qlabMissingEl.classList.add('hidden');
    qlabMissingEl.innerHTML = '';
  }
}

async function checkQlabStatus() {
  btnBegin.disabled = true;
  btnRetryQlab.classList.add('hidden');
  setQlabStatus('checking', 'Checking QLab…');

  try {
    const res = await fetch('/api/qlab/status');
    const { reachable, missingVars } = await res.json();

    if (!reachable) {
      setQlabStatus('offline', 'QLab offline — cast will save locally only');
      btnBegin.disabled = false;
      btnRetryQlab.classList.remove('hidden');
      return;
    }

    if (missingVars.length) {
      setQlabStatus('warn', 'QLab connected — cues missing', missingVars);
      btnBegin.disabled = true;
      btnRetryQlab.classList.remove('hidden');
      return;
    }

    setQlabStatus('ok', 'QLab connected — all cues ready');
    btnBegin.disabled = false;
  } catch {
    setQlabStatus('offline', 'Could not reach Dacha DICE: AYLI server');
    btnBegin.disabled = false;
    btnRetryQlab.classList.remove('hidden');
  }
}

btnRetryQlab.addEventListener('click', checkQlabStatus);

btnBegin.addEventListener('click', async () => {
  btnBegin.disabled = true;
  try {
    const res = await fetch('/api/shows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    currentShowId = data.id;
    perfNumberEl.textContent = `Performance #${data.performance_number}`;
    await loadConfig();
    buildSceneScreen();
    showScreen('scenes');
  } catch {
    alert('Failed to start show. Server may be unreachable.');
    btnBegin.disabled = false;
  }
});

// --- Shared config loader ---
async function loadConfig() {
  if (actors.length && characterTracks.length) return;
  const res = await fetch('/api/config');
  const cfg = await res.json();
  actors = [...cfg.actors].sort((a, b) => a.name.localeCompare(b.name));
  characterTracks = cfg.characterTracks;
  acts = (cfg.acts || []).filter(a => a.scenes && a.scenes.length > 0);
}

// --- Screen 1.5: Scene Selection ---
function buildSceneScreen() {
  actRowsEl.innerHTML = '';

  // Reset rig state for new show
  acts.forEach(act => {
    actOrderedState[act.id] = false;
    delete actOrderedLists[act.id];
  });

  if (!acts.length) {
    buildCastScreen();
    showScreen('cast');
    return;
  }

  acts.forEach(act => {
    const section = document.createElement('div');
    section.className = 'act-section';

    const header = document.createElement('div');
    header.className = 'act-header';

    const label = document.createElement('div');
    label.className = 'act-label';
    label.textContent = act.label;

    const toggleAll = document.createElement('button');
    toggleAll.className = 'btn-toggle-all';
    toggleAll.textContent = 'Deselect all';
    toggleAll.addEventListener('click', () => {
      const checkboxes = section.querySelectorAll('input[type="checkbox"]');
      const allChecked = [...checkboxes].every(cb => cb.checked);
      checkboxes.forEach(cb => { cb.checked = !allChecked; });
      toggleAll.textContent = allChecked ? 'Select all' : 'Deselect all';
    });

    const btnRig = document.createElement('button');
    btnRig.className = 'btn-rig-toggle';
    btnRig.textContent = 'Fix Order';

    header.appendChild(label);
    header.appendChild(btnRig);
    header.appendChild(toggleAll);
    section.appendChild(header);

    const grid = document.createElement('div');
    grid.className = 'scene-grid';

    act.scenes.forEach(scene => {
      const item = document.createElement('label');
      item.className = 'scene-item';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `scene-${act.id}-${scene}`;
      cb.checked = true;

      const name = document.createElement('span');
      name.textContent = scene;

      item.appendChild(cb);
      item.appendChild(name);
      grid.appendChild(item);
    });

    const orderList = document.createElement('div');
    orderList.className = 'scene-order-list hidden';
    orderList.id = `order-list-${act.id}`;

    section.appendChild(grid);
    section.appendChild(orderList);
    actRowsEl.appendChild(section);

    btnRig.addEventListener('click', () => toggleActOrder(act.id, section, btnRig, toggleAll));
  });
}

function toggleActOrder(actId, section, btnRig, btnToggleAll) {
  const isNowOrdered = !actOrderedState[actId];
  actOrderedState[actId] = isNowOrdered;

  const grid = section.querySelector('.scene-grid');
  const orderList = section.querySelector('.scene-order-list');
  const act = acts.find(a => a.id === actId);

  if (isNowOrdered) {
    const checked = act.scenes.filter(s => {
      const cb = document.getElementById(`scene-${actId}-${s}`);
      return cb ? cb.checked : false;
    });
    actOrderedLists[actId] = checked.length ? checked : [...act.scenes];

    grid.classList.add('hidden');
    btnToggleAll.classList.add('hidden');
    buildOrderedListItems(actId, orderList);
    orderList.classList.remove('hidden');
    btnRig.textContent = 'Randomize';
    btnRig.classList.add('active');
  } else {
    const orderedSet = new Set(actOrderedLists[actId] || []);
    act.scenes.forEach(s => {
      const cb = document.getElementById(`scene-${actId}-${s}`);
      if (cb) cb.checked = orderedSet.has(s);
    });

    orderList.classList.add('hidden');
    grid.classList.remove('hidden');
    btnToggleAll.classList.remove('hidden');
    btnRig.textContent = 'Fix Order';
    btnRig.classList.remove('active');
  }
}

function buildOrderedListItems(actId, container) {
  container.innerHTML = '';
  const list = actOrderedLists[actId] || [];

  list.forEach((sceneId, index) => {
    const item = document.createElement('div');
    item.className = 'scene-order-item';
    item.draggable = true;

    const handle = document.createElement('span');
    handle.className = 'scene-order-handle';
    handle.textContent = '⠿';

    const name = document.createElement('span');
    name.className = 'scene-order-name';
    name.textContent = sceneId;

    const btnUp = document.createElement('button');
    btnUp.className = 'scene-order-btn';
    btnUp.textContent = '▲';
    btnUp.disabled = index === 0;
    btnUp.addEventListener('click', () => {
      if (index > 0) {
        [actOrderedLists[actId][index - 1], actOrderedLists[actId][index]] =
          [actOrderedLists[actId][index], actOrderedLists[actId][index - 1]];
        buildOrderedListItems(actId, container);
      }
    });

    const btnDown = document.createElement('button');
    btnDown.className = 'scene-order-btn';
    btnDown.textContent = '▼';
    btnDown.disabled = index === list.length - 1;
    btnDown.addEventListener('click', () => {
      if (index < actOrderedLists[actId].length - 1) {
        [actOrderedLists[actId][index], actOrderedLists[actId][index + 1]] =
          [actOrderedLists[actId][index + 1], actOrderedLists[actId][index]];
        buildOrderedListItems(actId, container);
      }
    });

    item.appendChild(handle);
    item.appendChild(name);
    item.appendChild(btnUp);
    item.appendChild(btnDown);

    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      item.classList.add('dragging');
      container.dataset.dragSrc = index;
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      container.querySelectorAll('.scene-order-item').forEach(el => el.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      container.querySelectorAll('.scene-order-item').forEach(el => el.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const srcIndex = parseInt(container.dataset.dragSrc, 10);
      if (srcIndex !== index) {
        const [removed] = actOrderedLists[actId].splice(srcIndex, 1);
        actOrderedLists[actId].splice(index, 0, removed);
        buildOrderedListItems(actId, container);
      }
    });

    container.appendChild(item);
  });
}

btnBackScenes.addEventListener('click', async () => {
  if (currentShowId) {
    try {
      await fetch(`/api/shows/${currentShowId}`, { method: 'DELETE' });
    } catch (_) {}
    currentShowId = null;
  }
  await initWelcomeScreen();
  showScreen('welcome');
});

btnNextCast.addEventListener('click', async () => {
  await buildCastScreen();
  showScreen('cast');
});

// --- Screen 2: Cast Assignment ---
async function buildCastScreen() {
  castRowsEl.innerHTML = '';

  characterTracks.forEach(track => {
    const row = document.createElement('div');
    row.className = 'cast-row';
    row.id = `row-${track.id}`;

    const labelEl = document.createElement('div');
    labelEl.className = 'row-label';

    const trackName = document.createElement('div');
    trackName.className = 'row-track-name';
    trackName.textContent = track.label;
    labelEl.appendChild(trackName);

    if (track.subtitle) {
      const trackSub = document.createElement('div');
      trackSub.className = 'row-track-sub';
      trackSub.textContent = track.subtitle;
      labelEl.appendChild(trackSub);
    }

    const avatar = document.createElement('img');
    avatar.className = 'row-actor-img hidden';
    avatar.id = `img-${track.id}`;
    avatar.alt = '';

    const select = document.createElement('select');
    select.className = 'row-select';
    select.id = `select-${track.id}`;

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Select actor —';
    select.appendChild(placeholder);

    actors.forEach(actor => {
      const opt = document.createElement('option');
      opt.value = actor.name;
      opt.textContent = actor.subtitle ? `${actor.name} — ${actor.subtitle}` : actor.name;
      select.appendChild(opt);
    });

    select.addEventListener('change', () => {
      updateActorAvatar(track.id, select.value);
      updateSelectOptions();
      validateCast();
    });

    const indicator = document.createElement('div');
    indicator.className = 'row-indicator';
    indicator.id = `ind-${track.id}`;

    row.appendChild(labelEl);
    row.appendChild(avatar);
    row.appendChild(select);
    row.appendChild(indicator);
    castRowsEl.appendChild(row);
  });

  updateSelectOptions();
  validateCast();
}

function updateActorAvatar(trackId, actorName) {
  const img = document.getElementById(`img-${trackId}`);
  if (!img) return;
  const actor = getActorByName(actorName);
  const url = actor ? actorImageUrl(actor.image) : null;
  if (url) {
    img.src = url;
    img.classList.remove('hidden');
  } else {
    img.src = '';
    img.classList.add('hidden');
  }
}

function updateSelectOptions() {
  const cast = getCastSelections();
  const taken = new Set(Object.values(cast).filter(Boolean));

  characterTracks.forEach(track => {
    const sel = document.getElementById(`select-${track.id}`);
    if (!sel) return;
    const ownValue = sel.value;
    Array.from(sel.options).forEach(opt => {
      if (!opt.value) return;
      opt.disabled = taken.has(opt.value) && opt.value !== ownValue;
    });
  });
}

function validateCast() {
  const cast = getCastSelections();
  const dupes = hasDuplicates(cast);
  const complete = allAssigned(cast);

  characterTracks.forEach(track => {
    const row = document.getElementById(`row-${track.id}`);
    const val = cast[track.id];

    row.classList.remove('filled', 'error');
    if (val) {
      const isDupe = dupes && Object.entries(cast)
        .some(([k, v]) => k !== track.id && v === val);
      row.classList.add(isDupe ? 'error' : 'filled');
    }
  });

  dupWarning.classList.toggle('hidden', !dupes);
  btnReview.disabled = !complete || dupes;
}

function randomizeCast() {
  const unset = [];
  const takenActors = new Set();

  characterTracks.forEach(track => {
    const sel = document.getElementById(`select-${track.id}`);
    if (!sel) return;
    if (sel.value) {
      takenActors.add(sel.value);
    } else {
      unset.push({ trackId: track.id, sel });
    }
  });

  if (!unset.length) return;

  const pool = actors.filter(a => !takenActors.has(a.name)).map(a => a.name);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  unset.forEach(({ trackId, sel }, i) => {
    if (i < pool.length) {
      sel.value = pool[i];
      updateActorAvatar(trackId, pool[i]);
    }
  });

  updateSelectOptions();
  validateCast();
}

btnBackCast.addEventListener('click', () => {
  showScreen('scenes');
});

btnRandomize.addEventListener('click', randomizeCast);

btnReview.addEventListener('click', () => {
  buildConfirmScreen(getCastSelections());
  showScreen('confirm');
});

// --- Screen 3: Confirmation ---
function buildConfirmScreen(cast) {
  castSummaryEl.innerHTML = '';
  lockStatusEl.className = 'lock-status hidden';
  btnLock.classList.remove('hidden');
  btnLock.disabled = false;
  btnBackConfirm.classList.remove('hidden');
  btnNewShow.classList.add('hidden');

  characterTracks.forEach(track => {
    const actorName = cast[track.id];
    const actor = getActorByName(actorName);
    const imageUrl = actor ? actorImageUrl(actor.image) : null;

    const row = document.createElement('div');
    row.className = 'summary-row';

    const trackEl = document.createElement('div');
    trackEl.className = 'summary-track';
    trackEl.textContent = track.label;
    if (track.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'summary-track-sub';
      sub.textContent = track.subtitle;
      trackEl.appendChild(sub);
    }

    const actorEl = document.createElement('div');
    actorEl.className = 'summary-actor';

    if (imageUrl) {
      const img = document.createElement('img');
      img.className = 'summary-actor-img';
      img.src = imageUrl;
      img.alt = actorName;
      actorEl.appendChild(img);
    }

    const nameEl = document.createElement('span');
    nameEl.textContent = actorName;
    actorEl.appendChild(nameEl);

    if (actor && actor.subtitle) {
      const sub = document.createElement('div');
      sub.className = 'summary-actor-sub';
      sub.textContent = actor.subtitle;
      actorEl.appendChild(sub);
    }

    row.appendChild(trackEl);
    row.appendChild(actorEl);
    castSummaryEl.appendChild(row);
  });
}

btnBackConfirm.addEventListener('click', () => {
  showScreen('cast');
});

btnLock.addEventListener('click', async () => {
  const cast = getCastSelections();
  const { scenes, scenesOrdered } = buildScenePayload();
  btnLock.disabled = true;

  try {
    const res = await fetch(`/api/shows/${currentShowId}/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cast, scenes, scenesOrdered }),
    });
    const data = await res.json();

    lockTime = new Date();
    scenesPlayed = [];
    buildProgressScreen(data);
    showScreen('progress');
    ensureSocket();
  } catch {
    lockStatusEl.classList.remove('hidden', 'success');
    lockStatusEl.classList.add('warn');
    lockStatusEl.textContent = 'Error saving cast. Check server connection.';
    btnLock.disabled = false;
  }
});

btnNewShow.addEventListener('click', async () => {
  currentShowId = null;
  castRowsEl.innerHTML = '';
  await initWelcomeScreen();
  showScreen('welcome');
  btnBegin.disabled = false;
});

// --- Screen 4: Show In Progress ---

function formatDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatDurationReport(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateSceneDuration(idx, ms) {
  const el = document.getElementById(`scene-dur-${idx}`);
  if (!el) return;
  el.classList.remove('progress-duration-pending');
  el.textContent = formatDuration(ms);
}

function ensureSocket() {
  if (socket) return;
  socket = io();
  socket.on('scene_started', ({ scene, time }) => {
    if (scenesPlayed.length > 0) {
      const prev = scenesPlayed[scenesPlayed.length - 1];
      prev.duration = new Date(time) - new Date(prev.time);
      updateSceneDuration(scenesPlayed.length - 1, prev.duration);
    }
    scenesPlayed.push({ scene, time, duration: null });
    appendSceneToProgress(scene, time);
  });
  socket.on('show_ended', ({ time }) => {
    if (scenesPlayed.length > 0) {
      const last = scenesPlayed[scenesPlayed.length - 1];
      last.duration = new Date(time) - new Date(last.time);
      updateSceneDuration(scenesPlayed.length - 1, last.duration);
    }
    buildSummaryScreen(time);
    showScreen('summary');
  });
}

function buildProgressScreen(lockData) {
  const startTime = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const qlabLine = lockData.qlabNotified
    ? '<span class="progress-qlab-ok">✓ QLab notified</span>'
    : '<span class="progress-qlab-warn">QLab notification failed</span>';
  progressMetaEl.innerHTML = `
    <span class="progress-perf">${perfNumberEl.textContent}</span>
    <span class="progress-start">Started ${startTime}</span>
    ${qlabLine}
  `;
  progressSceneList.innerHTML = '<div class="progress-empty">Waiting for first scene…</div>';
}

function appendSceneToProgress(scene, time) {
  const empty = progressSceneList.querySelector('.progress-empty');
  if (empty) empty.remove();

  const idx = scenesPlayed.length - 1;
  const item = document.createElement('div');
  item.className = 'progress-scene-item';
  const t = new Date(time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  item.innerHTML = `
    <span class="progress-scene-name">${scene}</span>
    <span class="progress-scene-time">${t}</span>
    <span class="progress-scene-duration progress-duration-pending" id="scene-dur-${idx}">•••</span>
  `;
  progressSceneList.appendChild(item);
  progressSceneList.scrollTop = progressSceneList.scrollHeight;
}

// --- Screen 5: Show Summary ---

async function buildSummaryScreen(endTime) {
  const showLength = lockTime && endTime ? formatDuration(new Date(endTime) - lockTime) : '—';
  summaryStatsEl.innerHTML = `
    <div class="summary-stat">
      <span class="summary-stat-label">Performance</span>
      <span class="summary-stat-value">${perfNumberEl.textContent}</span>
    </div>
    <div class="summary-stat">
      <span class="summary-stat-label">Date</span>
      <span class="summary-stat-value">${todayDateEl.textContent}</span>
    </div>
    <div class="summary-stat">
      <span class="summary-stat-label">Show Length</span>
      <span class="summary-stat-value">${showLength}</span>
    </div>
  `;

  summaryCastEl.innerHTML = '<div class="summary-section-label">Cast</div>';
  const castMap = getCastSelections();
  characterTracks.forEach(track => {
    const actorName = castMap[track.id] || '—';
    const row = document.createElement('div');
    row.className = 'summary-row';
    row.innerHTML = `<div class="summary-track">${track.label}</div><div class="summary-actor"><span>${actorName}</span></div>`;
    summaryCastEl.appendChild(row);
  });

  summaryScenesEl.innerHTML = '<div class="summary-section-label">Scenes Played</div>';
  acts.forEach(act => {
    const actScenes = scenesPlayed.filter(e => act.scenes.includes(e.scene));
    const row = document.createElement('div');
    row.className = 'summary-act-row';
    const scenesHtml = actScenes.length
      ? actScenes.map(e => `${e.scene}<span class="summary-scene-dur">${formatDurationReport(e.duration)}</span>`).join(' → ')
      : '—';
    row.innerHTML = `
      <span class="summary-act-label">${act.label}</span>
      <span class="summary-act-scenes">${scenesHtml}</span>
    `;
    summaryScenesEl.appendChild(row);
  });

  try {
    const res = await fetch('/api/config/sheets');
    const cfg = await res.json();
    if (cfg.spreadsheetId) {
      summarySheetLink.classList.remove('hidden');
      summarySheetLink.innerHTML = `<a href="https://docs.google.com/spreadsheets/d/${cfg.spreadsheetId}" target="_blank" class="btn btn-secondary">View in Google Sheets →</a>`;
    } else {
      summarySheetLink.classList.add('hidden');
    }
  } catch {
    summarySheetLink.classList.add('hidden');
  }
}

btnSummaryNewShow.addEventListener('click', async () => {
  currentShowId = null;
  scenesPlayed = [];
  castRowsEl.innerHTML = '';
  await initWelcomeScreen();
  showScreen('welcome');
});

// --- Google Sheets config modal ---

async function refreshSettingsBadge() {
  settingsBadge.className = 'settings-badge checking';
  try {
    const statusRes = await fetch('/api/auth/google/status');
    const { connected } = await statusRes.json();
    if (!connected) {
      settingsBadge.className = 'settings-badge unconfigured';
      return;
    }
    const cfgRes = await fetch('/api/config/sheets');
    const cfg = await cfgRes.json();
    const fullyConfigured = cfg.spreadsheetId && cfg.sheetTabName;
    settingsBadge.className = `settings-badge ${fullyConfigured ? 'configured' : 'unconfigured'}`;
  } catch {
    settingsBadge.className = 'settings-badge unconfigured';
  }
}

function openModal() {
  modalOverlay.classList.remove('hidden');
  loadModalState();
}

function closeModal() {
  modalOverlay.classList.add('hidden');
}

async function loadModalState() {
  modalDisconnected.classList.add('hidden');
  modalConnected.classList.add('hidden');
  modalAuthError.classList.add('hidden');
  modalSaveStatus.textContent = '';
  modalSaveStatus.className = 'modal-save-status';

  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auth_error') === '1') {
    modalAuthError.classList.remove('hidden');
  }

  let status;
  try {
    const res = await fetch('/api/auth/google/status');
    status = await res.json();
  } catch {
    modalDisconnected.classList.remove('hidden');
    return;
  }

  if (!status.connected) {
    modalDisconnected.classList.remove('hidden');
    return;
  }

  modalEmail.textContent = status.email || '';
  modalConnected.classList.remove('hidden');

  let currentCfg = {};
  try {
    const cfgRes = await fetch('/api/config/sheets');
    currentCfg = await cfgRes.json();
  } catch { /* ignore */ }

  await loadSheetPicker(currentCfg.spreadsheetId || null);
  if (currentCfg.spreadsheetId && currentCfg.sheetTabName) {
    await loadTabPicker(currentCfg.spreadsheetId, currentCfg.sheetTabName);
  }
  validateSaveButton();
}

async function loadSheetPicker(selectedId) {
  sheetPicker.innerHTML = '<option value="">— Loading… —</option>';
  tabField.classList.add('hidden');
  tabPicker.innerHTML = '';
  btnSaveSheets.disabled = true;

  try {
    const res = await fetch('/api/sheets/list');
    if (res.status === 401) {
      sheetPicker.innerHTML = '<option value="">— Auth error, reconnect —</option>';
      return;
    }
    const files = await res.json();
    sheetPicker.innerHTML = '<option value="">— Select a spreadsheet —</option>';
    files.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      if (f.id === selectedId) opt.selected = true;
      sheetPicker.appendChild(opt);
    });
  } catch {
    sheetPicker.innerHTML = '<option value="">— Failed to load —</option>';
  }
}

async function loadTabPicker(spreadsheetId, selectedTab) {
  tabField.classList.remove('hidden');
  tabPicker.innerHTML = '<option value="">— Loading tabs… —</option>';
  btnSaveSheets.disabled = true;

  try {
    const res = await fetch(`/api/sheets/${spreadsheetId}/tabs`);
    const tabs = await res.json();
    tabPicker.innerHTML = '<option value="">— Select tab —</option>';
    tabs.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === selectedTab) opt.selected = true;
      tabPicker.appendChild(opt);
    });
    if (selectedTab) tabPicker.value = selectedTab;
  } catch {
    tabPicker.innerHTML = '<option value="">— Failed to load —</option>';
  }
  validateSaveButton();
}

function validateSaveButton() {
  btnSaveSheets.disabled = !(sheetPicker.value && tabPicker.value);
}

btnSettings.addEventListener('click', openModal);
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

sheetPicker.addEventListener('change', async () => {
  const id = sheetPicker.value;
  if (!id) {
    tabField.classList.add('hidden');
    tabPicker.innerHTML = '';
    btnSaveSheets.disabled = true;
    return;
  }
  await loadTabPicker(id, null);
});

tabPicker.addEventListener('change', validateSaveButton);

btnSaveSheets.addEventListener('click', async () => {
  btnSaveSheets.disabled = true;
  modalSaveStatus.className = 'modal-save-status';
  modalSaveStatus.textContent = 'Saving…';

  const spreadsheetId   = sheetPicker.value;
  const spreadsheetName = sheetPicker.options[sheetPicker.selectedIndex]?.textContent || '';
  const sheetTabName    = tabPicker.value;

  try {
    const res = await fetch('/api/config/sheets', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ spreadsheetId, spreadsheetName, sheetTabName }),
    });
    if (res.ok) {
      modalSaveStatus.textContent = 'Saved!';
      await refreshSettingsBadge();
      setTimeout(() => { modalSaveStatus.textContent = ''; }, 2500);
    } else {
      modalSaveStatus.className = 'modal-save-status error';
      modalSaveStatus.textContent = 'Save failed.';
    }
  } catch {
    modalSaveStatus.className = 'modal-save-status error';
    modalSaveStatus.textContent = 'Network error.';
  }
  btnSaveSheets.disabled = false;
});

btnDisconnect.addEventListener('click', async () => {
  if (!confirm('Disconnect your Google account? Show export will stop working until you reconnect.')) return;
  await fetch('/api/auth/google', { method: 'DELETE' });
  await refreshSettingsBadge();
  loadModalState();
});

// --- Boot ---
(async () => {
  await initWelcomeScreen();
  await refreshSettingsBadge();
  const params = new URLSearchParams(window.location.search);
  if (params.get('sheets_config') === '1') {
    history.replaceState({}, '', window.location.pathname);
    openModal();
  }
})();
