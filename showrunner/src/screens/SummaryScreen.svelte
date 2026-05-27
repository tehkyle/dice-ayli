<script>
  import { onMount } from 'svelte';
  import { nav } from '../stores/screen.svelte.js';
  import { showData, resetShow } from '../stores/show.svelte.js';
  import { configData } from '../stores/config.svelte.js';
  import { castData } from '../stores/cast.svelte.js';
  import { progressData, resetProgress } from '../stores/progress.svelte.js';
  import { api } from '../lib/api.js';
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

  onMount(async () => {
    try {
      const cfg = await api.getSheetsConfig();
      spreadsheetId = cfg.spreadsheetId ?? null;
    } catch {}
  });

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

  {#if spreadsheetId}
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

  <div class="screen-actions">
    <button class="btn btn-primary btn-xl" onclick={startNewShow}>Start New Show</button>
  </div>
</div>
