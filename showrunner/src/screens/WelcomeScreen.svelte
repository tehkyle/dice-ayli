<script>
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { formatDate } from '../lib/format.js';
  import { nav } from '../stores/screen.svelte.js';
  import { showData } from '../stores/show.svelte.js';
  import { loadConfig } from '../stores/config.svelte.js';
  import { initScenesFromActs } from '../stores/scenes.svelte.js';
  import { initCastFromTracks } from '../stores/cast.svelte.js';
  import SettingsBadge from '../components/SettingsBadge.svelte';
  import QlabStatus from '../components/QlabStatus.svelte';

  const today = new Date().toISOString().slice(0, 10);

  let qlabReachable = $state(null);
  let qlabMissing = $state([]);
  let qlabText = $state('Checking QLab…');
  let showRetry = $state(false);
  let beginDisabled = $state(true);
  let beginning = $state(false);

  async function checkQlab() {
    qlabReachable = null;
    qlabText = 'Checking QLab…';
    qlabMissing = [];
    showRetry = false;
    beginDisabled = true;

    try {
      const { reachable, missingVars } = await api.getQlabStatus();
      qlabReachable = reachable;
      qlabMissing = missingVars ?? [];

      if (!reachable) {
        qlabText = 'QLab offline — connection required to begin';
        beginDisabled = true;
        showRetry = true;
      } else if (qlabMissing.length) {
        qlabText = 'QLab connected — cues missing';
        beginDisabled = true;
        showRetry = true;
      } else {
        qlabText = 'QLab connected — all cues ready';
        beginDisabled = false;
      }
    } catch {
      qlabReachable = false;
      qlabText = 'Could not reach server';
      beginDisabled = false;
      showRetry = true;
    }
  }

  async function begin() {
    beginning = true;
    beginDisabled = true;
    try {
      const data = await api.createShow();
      showData.id = data.id;
      showData.perfLabel = `Performance #${data.performance_number}`;

      await loadConfig();

      const { characterTracks, acts } = await import('../stores/config.svelte.js').then(m => m.configData);
      initScenesFromActs(acts);
      initCastFromTracks(characterTracks);

      nav.screen = 'scenes';
    } catch {
      alert('Failed to start show. Server may be unreachable.');
      beginDisabled = false;
    } finally {
      beginning = false;
    }
  }

  onMount(async () => {
    api.getPlayhead().catch(() => {});

    try {
      const shows = await api.getShows();
      showData.perfLabel = `Performance #${shows.length + 1}`;
    } catch {
      showData.perfLabel = 'Performance #—';
    }

    await checkQlab();
  });
</script>

<div class="screen-inner">
  <div class="welcome-header">
    <SettingsBadge />
  </div>
  <img src="/images/logo.png" alt="Dacha logo" class="app-logo" />
  <h1 class="app-title">Dacha DICE: AYLI</h1>
  <div class="show-meta">
    <div class="meta-date">{formatDate(today)}</div>
    <div class="meta-perf">{showData.perfLabel}</div>
  </div>
  <QlabStatus reachable={qlabReachable} missingVars={qlabMissing} statusText={qlabText} />
  <div class="screen-actions">
    <button class="btn btn-primary btn-xl" disabled={beginDisabled || beginning} onclick={begin}>
      {beginning ? 'Starting…' : 'Begin Cast Entry'}
    </button>
    {#if showRetry}
      <button class="btn btn-secondary" onclick={checkQlab}>Retry QLab check</button>
    {/if}
  </div>
  <div class="history-link"><a href="/history">View show history →</a></div>
</div>
