let allActors = [];
let allTracks = [];
let allActs   = [];

async function load() {
  const root = document.getElementById('history-root');

  let shows, config;
  try {
    [shows, config] = await Promise.all([
      fetch('/api/shows').then(r => r.json()),
      fetch('/api/config').then(r => r.json()),
    ]);
  } catch {
    root.innerHTML = '<div class="history-error">Could not reach Showrunner server.</div>';
    return;
  }

  allActors = [...config.actors].sort((a, b) => a.name.localeCompare(b.name));
  allTracks = config.characterTracks;
  allActs   = config.acts || [];

  if (!shows.length) {
    root.innerHTML = '<div class="history-empty">No shows recorded yet.</div>';
    return;
  }

  const trackMap = Object.fromEntries(config.characterTracks.map(t => [t.id, t]));
  const actorMap = Object.fromEntries(config.actors.map(a => [a.name, a]));

  // Group shows by date (API returns reverse-chronological)
  const byDate = new Map();
  for (const show of shows) {
    if (!byDate.has(show.show_date)) byDate.set(show.show_date, []);
    byDate.get(show.show_date).push(show);
  }

  root.innerHTML = '';

  for (const [date, dateShows] of byDate) {
    const section = document.createElement('section');
    section.className = 'history-date-section';

    const heading = document.createElement('h2');
    heading.className = 'history-date-heading';
    heading.textContent = formatDate(date);
    section.appendChild(heading);

    const cards = document.createElement('div');
    cards.className = 'history-cards';

    const sorted = [...dateShows].sort((a, b) => a.performance_number - b.performance_number);
    for (const show of sorted) {
      cards.appendChild(buildShowCard(show, trackMap, actorMap));
    }

    section.appendChild(cards);
    root.appendChild(section);
  }
}

function buildShowCard(show, trackMap, actorMap) {
  const card = document.createElement('div');
  card.className = 'history-card';
  card.dataset.showId = show.id;
  renderCard(card, show, trackMap, actorMap, false);
  return card;
}

function renderCard(card, show, trackMap, actorMap, editMode) {
  card.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'history-card-header';

  const perfLabel = document.createElement('div');
  perfLabel.className = 'history-card-perf';
  perfLabel.textContent = `Performance #${show.performance_number}`;

  const timeLabel = document.createElement('div');
  timeLabel.className = 'history-card-time';
  if (show.locked_at) {
    const startStr = formatTime(show.locked_at);
    const runStr   = show.ended_at ? formatRunTime(show.locked_at, show.ended_at) : null;
    timeLabel.textContent = runStr ? `${startStr}  ·  ${runStr}` : startStr;
  } else {
    timeLabel.textContent = 'Not locked';
  }

  header.appendChild(perfLabel);
  header.appendChild(timeLabel);
  card.appendChild(header);

  // Cast list
  const castList = document.createElement('div');
  castList.className = 'history-cast-list';

  const castByTrack = Object.fromEntries(
    (show.cast || []).map(a => [a.character_track, a.actor_name])
  );

  for (const track of allTracks) {
    const actorName = castByTrack[track.id];
    const actor = actorName ? actorMap[actorName] : null;

    const row = document.createElement('div');
    row.className = 'history-cast-row';

    const trackLabel = document.createElement('div');
    trackLabel.className = 'history-track-label';
    trackLabel.textContent = track.label;
    if (track.subtitle) {
      const sub = document.createElement('span');
      sub.className = 'history-track-sub';
      sub.textContent = track.subtitle;
      trackLabel.appendChild(sub);
    }

    if (editMode) {
      const select = document.createElement('select');
      select.className = 'history-edit-select';
      select.dataset.trackId = track.id;

      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '— unassigned —';
      select.appendChild(blank);

      allActors.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name;
        if (a.name === actorName) opt.selected = true;
        select.appendChild(opt);
      });

      row.appendChild(trackLabel);
      row.appendChild(select);
    } else {
      const actorEl = document.createElement('div');
      actorEl.className = 'history-actor';

      if (actor?.image) {
        const img = document.createElement('img');
        img.className = 'history-actor-img';
        img.src = `/images/actors/${actor.image}`;
        img.alt = actorName;
        actorEl.appendChild(img);
      } else if (actorName) {
        const initial = document.createElement('div');
        initial.className = 'history-actor-initial';
        initial.textContent = actorName[0].toUpperCase();
        actorEl.appendChild(initial);
      }

      const nameEl = document.createElement('div');
      nameEl.className = 'history-actor-name';
      nameEl.textContent = actorName || '—';
      actorEl.appendChild(nameEl);

      row.appendChild(trackLabel);
      row.appendChild(actorEl);
    }

    castList.appendChild(row);
  }

  card.appendChild(castList);

  // Scenes section — one row per act showing actual play order
  const scenesPlayed = show.scenes_played || [];
  if (scenesPlayed.length > 0 && allActs.length > 0) {
    const scenesSection = document.createElement('div');
    scenesSection.className = 'history-scenes-section';

    for (const act of allActs) {
      const actScenes = scenesPlayed.filter(e => act.scenes.includes(e.scene_name));
      if (actScenes.length === 0) continue;

      const row = document.createElement('div');
      row.className = 'history-act-row';

      const label = document.createElement('span');
      label.className = 'history-act-label';
      label.textContent = act.label;

      const seq = document.createElement('span');
      seq.className = 'history-scene-sequence';
      seq.textContent = actScenes.map(e => e.scene_name).join(' → ');

      row.appendChild(label);
      row.appendChild(seq);
      scenesSection.appendChild(row);
    }

    if (scenesSection.children.length > 0) card.appendChild(scenesSection);
  }

  // Action bar
  if (editMode) {
    const actions = document.createElement('div');
    actions.className = 'history-card-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-history primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => saveEdit(card, show, trackMap, actorMap));

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn-history';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => renderCard(card, show, trackMap, actorMap, false));

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);
  } else {
    const actions = document.createElement('div');
    actions.className = 'history-card-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'btn-history';
    editBtn.textContent = 'Edit cast';
    editBtn.addEventListener('click', () => renderCard(card, show, trackMap, actorMap, true));

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn-history danger';
    deleteBtn.textContent = 'Delete show';
    deleteBtn.addEventListener('click', () => showDeleteConfirm(card, show, trackMap, actorMap));

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);
  }
}

async function saveEdit(card, show, trackMap, actorMap) {
  const selects = card.querySelectorAll('select[data-track-id]');
  const cast = {};
  selects.forEach(sel => { cast[sel.dataset.trackId] = sel.value; });

  try {
    const res = await fetch(`/api/shows/${show.id}/cast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cast }),
    });
    if (!res.ok) throw new Error('Save failed');
    const updated = await res.json();
    // Rebuild local cast array from the selections
    show.cast = Object.entries(cast).map(([character_track, actor_name]) => ({ character_track, actor_name }));
    renderCard(card, show, trackMap, actorMap, false);
  } catch {
    alert('Failed to save changes. Check server connection.');
  }
}

function showDeleteConfirm(card, show, trackMap, actorMap) {
  // Replace action bar with inline confirmation
  const existing = card.querySelector('.history-card-actions, .history-delete-confirm');
  if (existing) existing.remove();

  const confirm = document.createElement('div');
  confirm.className = 'history-delete-confirm';

  const msg = document.createElement('span');
  msg.textContent = 'Delete this show permanently?';

  const yesBtn = document.createElement('button');
  yesBtn.className = 'btn-history danger';
  yesBtn.textContent = 'Yes, delete';
  yesBtn.addEventListener('click', () => deleteShow(card, show.id));

  const noBtn = document.createElement('button');
  noBtn.className = 'btn-history';
  noBtn.textContent = 'Cancel';
  noBtn.addEventListener('click', () => renderCard(card, show, trackMap, actorMap, false));

  confirm.appendChild(msg);
  confirm.appendChild(yesBtn);
  confirm.appendChild(noBtn);
  card.appendChild(confirm);
}

async function deleteShow(card, showId) {
  try {
    const res = await fetch(`/api/shows/${showId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');

    // Fade out and remove card
    card.style.transition = 'opacity 0.3s';
    card.style.opacity = '0';
    setTimeout(() => {
      const cardsEl = card.parentElement;
      card.remove();
      // If date section is now empty, remove it too
      if (cardsEl && !cardsEl.querySelector('.history-card')) {
        cardsEl.closest('.history-date-section')?.remove();
      }
      // If no sections left, show empty state
      const root = document.getElementById('history-root');
      if (root && !root.querySelector('.history-date-section')) {
        root.innerHTML = '<div class="history-empty">No shows recorded yet.</div>';
      }
    }, 300);
  } catch {
    alert('Failed to delete show. Check server connection.');
  }
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatRunTime(startIso, endIso) {
  const totalMins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

load();
