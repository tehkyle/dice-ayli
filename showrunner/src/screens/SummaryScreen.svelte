<script>
  import { onMount, onDestroy } from 'svelte';
  import { nav } from '../stores/screen.svelte.js';
  import { showData, resetShow } from '../stores/show.svelte.js';
  import { configData } from '../stores/config.svelte.js';
  import { castData } from '../stores/cast.svelte.js';
  import { progressData, resetProgress } from '../stores/progress.svelte.js';
  import { api } from '../lib/api.js';
  import { getSocket } from '../lib/socket.js';
  import { formatDate, formatDuration, formatDurationReport } from '../lib/format.js';
  import CastSummaryRow from '../components/CastSummaryRow.svelte';

  const today = new Date().toISOString().slice(0, 10);

  let showLength = $derived(() => {
    const last = progressData.scenesPlayed[progressData.scenesPlayed.length - 1];
    if (!showData.lockTime || !last?.duration) return '—';
    const endMs = new Date(last.time).getTime() + (last.duration ?? 0);
    return formatDuration(endMs - new Date(showData.lockTime).getTime());
  });

  let spreadsheetId = $state(null);
  let sheetsError   = $state(false);
  let copied        = $state(false);

  // Build a tab-separated row from current store state — same column order as the sheet.
  // Used for the always-available clipboard button and as the fallback if Sheets write fails.
  let tsvRow = $derived(() => {
    const sceneMap = Object.fromEntries(
      progressData.scenesPlayed.map(e => [e.scene, e])
    );

    function durStr(entry) {
      if (!entry?.duration) return '';
      const totalSec = Math.round(entry.duration / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    }

    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const start = showData.lockTime
      ? new Date(showData.lockTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '';

    const last = progressData.scenesPlayed[progressData.scenesPlayed.length - 1];
    let run = '';
    if (showData.lockTime && last) {
      const endMs   = new Date(last.time).getTime() + (last.duration ?? 0);
      const totalSec = Math.round((endMs - new Date(showData.lockTime).getTime()) / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      run = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    const castCols = configData.characterTracks.map(t => castData.selections[t.id] || '');

    const sceneCols = [];
    for (const act of configData.acts) {
      const actEntries = progressData.scenesPlayed.filter(e => act.scenes.includes(e.scene));
      sceneCols.push(actEntries.map(e => e.scene).join(' → '));
      for (const sceneName of act.scenes) {
        sceneCols.push(durStr(sceneMap[sceneName]));
      }
    }

    const staticCols = configData.staticScenes.map(name => durStr(sceneMap[name]));

    return [date, start, run, ...castCols, ...sceneCols, ...staticCols].join('\t');
  });

  onMount(async () => {
    try {
      const cfg = await api.getSheetsConfig();
      spreadsheetId = cfg.spreadsheetId ?? null;
    } catch {}

    const socket = getSocket();
    socket.on('sheets_error', () => {
      sheetsError = true;
    });
  });

  onDestroy(() => {
    getSocket().off('sheets_error');
  });

  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(tsvRow());
      copied = true;
      setTimeout(() => { copied = false; }, 2000);
    } catch {}
  }

  function startNewShow() {
    resetProgress();
    resetShow();
    nav.screen = 'welcome';
  }
</script>

<div class="screen-inner">
  <h2 class="screen-title">Show Complete</h2>

  <div class="summary-stats">
    <div class="summary-stat">
      <span class="summary-stat-label">Performance</span>
      <span class="summary-stat-value">{showData.perfLabel}</span>
    </div>
    <div class="summary-stat">
      <span class="summary-stat-label">Date</span>
      <span class="summary-stat-value">{formatDate(today)}</span>
    </div>
    <div class="summary-stat">
      <span class="summary-stat-label">Show Length</span>
      <span class="summary-stat-value">{showLength()}</span>
    </div>
  </div>

  <div class="summary-cast-section">
    <div class="summary-section-label">Cast</div>
    {#each configData.characterTracks as track (track.id)}
      {@const actorName = castData.selections[track.id] ?? '—'}
      {@const actor = configData.actors.find(a => a.name === actorName) ?? null}
      <CastSummaryRow {track} {actorName} {actor} />
    {/each}
  </div>

  <div class="summary-scenes-section">
    <div class="summary-section-label">Scenes Played</div>
    {#each configData.acts as act (act.id)}
      {@const actScenes = progressData.scenesPlayed.filter(e => act.scenes.includes(e.scene))}
      <div class="summary-act-row">
        <span class="summary-act-label">{act.label}</span>
        <span class="summary-act-scenes">
          {#if actScenes.length}
            {#each actScenes as entry, i}
              {entry.scene}<span class="summary-scene-dur">{formatDurationReport(entry.duration)}</span>{#if i < actScenes.length - 1} → {/if}
            {/each}
          {:else}
            —
          {/if}
        </span>
      </div>
    {/each}
  </div>

  {#if sheetsError}
    <div class="summary-sheets-error">
      <span class="summary-sheets-error-msg">Failed to write to Google Sheets.</span>
    </div>
  {:else if spreadsheetId}
    <div class="summary-sheet-link">
      <a
        href="https://docs.google.com/spreadsheets/d/{spreadsheetId}"
        target="_blank"
        class="btn btn-secondary"
      >
        View in Google Sheets →
      </a>
    </div>
  {/if}

  <div class="summary-clipboard">
    <button class="btn btn-secondary" onclick={copyToClipboard}>
      {copied ? 'Copied!' : 'Copy row to clipboard'}
    </button>
  </div>

  <div class="screen-actions">
    <button class="btn btn-primary btn-xl" onclick={startNewShow}>Start New Show</button>
  </div>
</div>
