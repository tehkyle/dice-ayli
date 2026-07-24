<script>
  import { onMount, onDestroy } from 'svelte';
  import { nav } from '../stores/screen.svelte.js';
  import { showData, resetShow } from '../stores/show.svelte.js';
  import { configData } from '../stores/config.svelte.js';
  import { castData } from '../stores/cast.svelte.js';
  import { progressData, resetProgress } from '../stores/progress.svelte.js';
  import { api } from '../lib/api.js';
  import { getSocket } from '../lib/socket.js';
  import { formatDate, formatDuration, formatDurationReport, formatDurationTsv, toIsoDate } from '../lib/format.js';
  import CastSummaryRow from '../components/CastSummaryRow.svelte';
  import HistoryGalleryModal from '../components/HistoryGalleryModal.svelte';
  import { openHistoryGallery } from '../stores/historyGallery.svelte.js';

  const today = toIsoDate();

  let showLength = $derived.by(() => {
    const last = progressData.scenesPlayed[progressData.scenesPlayed.length - 1];
    if (!showData.startTime || !last?.duration) return '—';
    const endMs = new Date(last.time).getTime() + (last.duration ?? 0);
    return formatDuration(endMs - new Date(showData.startTime).getTime());
  });

  // Time from "Begin Show" to the first scene's Go — cast dicing plus any
  // house/curtain announcements, before the audience sees scene 1.1.
  let introDicingLength = $derived.by(() => {
    const first = progressData.scenesPlayed[0];
    if (!showData.startTime || !first) return '—';
    return formatDuration(new Date(first.time).getTime() - new Date(showData.startTime).getTime());
  });

  let spreadsheetId   = $state(null);
  let showrunnerEmail = $state('');
  let sheetsError     = $state(false);
  let copied          = $state(false);

  // Builds a tab-separated row matching the Google Sheets column order.
  // Used for the clipboard button and as fallback when the Sheets write fails.
  let tsvRow = $derived.by(() => {
    const sceneMap = Object.fromEntries(progressData.scenesPlayed.map(e => [e.scene, e]));

    const date  = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const start = showData.startTime
      ? new Date(showData.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '';

    const last = progressData.scenesPlayed[progressData.scenesPlayed.length - 1];
    let run = '';
    if (showData.startTime && last) {
      const endMs    = new Date(last.time).getTime() + (last.duration ?? 0);
      const totalSec = Math.round((endMs - new Date(showData.startTime).getTime()) / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      run = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    const castCols  = configData.characterTracks.map(t => castData.selections[t.id] || '');

    const first = progressData.scenesPlayed[0];
    const introDicing = (showData.startTime && first)
      ? formatDurationTsv(new Date(first.time).getTime() - new Date(showData.startTime).getTime())
      : '';

    const sceneCols = [];
    for (const act of configData.acts) {
      const actEntries = progressData.scenesPlayed.filter(e => act.scenes.includes(e.scene));
      sceneCols.push(actEntries.map(e => e.scene).join(' → '));
      for (const sceneName of act.scenes) {
        const entry = sceneMap[sceneName];
        sceneCols.push(entry?.duration ? formatDurationTsv(entry.duration) : '');
      }
    }
    const staticCols = configData.staticScenes.map(name => {
      const entry = sceneMap[name];
      return entry?.duration ? formatDurationTsv(entry.duration) : '';
    });

    return [date, start, run, showrunnerEmail, ...castCols, introDicing, ...sceneCols, ...staticCols].join('\t');
  });

  onMount(async () => {
    try {
      const cfg = await api.getSheetsConfig();
      spreadsheetId   = cfg.spreadsheetId ?? null;
      showrunnerEmail = cfg.userEmail ?? '';
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
      await navigator.clipboard.writeText(tsvRow);
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
      <span class="summary-stat-label">Intro / Dicing</span>
      <span class="summary-stat-value">{introDicingLength}</span>
    </div>
    <div class="summary-stat">
      <span class="summary-stat-label">Show Length</span>
      <span class="summary-stat-value">{showLength}</span>
    </div>
  </div>

  <div class="summary-cast-section">
    <div class="summary-section-label">Cast</div>
    {#each configData.characterTracks as track (track.id)}
      {#if track.id !== 'Track_Singer'}
        {@const singerName = castData.selections['Track_Singer'] ?? null}
        {@const actorName = castData.selections[track.id] ?? '—'}
        {@const actor = configData.actors.find(a => a.name === actorName) ?? null}
        {@const isFeaturedSinger = !!singerName && singerName === actorName}
        <CastSummaryRow {track} {actorName} {actor} {isFeaturedSinger} />
      {/if}
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

  <div class="summary-photo-gallery">
    <button class="btn btn-secondary" onclick={() => openHistoryGallery(showData.id)}>
      Photo Gallery
    </button>
  </div>

  <div class="screen-actions">
    <button class="btn btn-primary btn-xl" onclick={startNewShow}>Start New Show</button>
  </div>
</div>

<HistoryGalleryModal />
