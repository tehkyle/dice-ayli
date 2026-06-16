<script>
  import { onMount } from 'svelte';
  import { formatDate } from '../lib/format.js';
  import { api } from '../lib/api.js';
  import HistoryCard from '../components/HistoryCard.svelte';

  let shows = $state([]);
  let tracks = $state([]);
  let actors = $state([]);
  let acts = $state([]);
  let error = $state('');
  let loading = $state(true);
  let clearConfirm = $state(false);

  // Shows grouped by date: [{ date, shows[] }]
  let grouped = $derived.by(() => {
    const byDate = new Map();
    for (const show of shows) {
      if (!byDate.has(show.show_date)) byDate.set(show.show_date, []);
      byDate.get(show.show_date).push(show);
    }
    return Array.from(byDate.entries()).map(([date, dateShows]) => ({
      date,
      shows: [...dateShows].sort((a, b) => a.performance_number - b.performance_number),
    }));
  });

  onMount(async () => {
    try {
      const [showsData, config] = await Promise.all([api.getShows(), api.getConfig()]);
      actors = [...config.actors].sort((a, b) => a.name.localeCompare(b.name));
      tracks = config.characterTracks;
      acts = config.acts || [];
      shows = showsData;
    } catch {
      error = 'Could not reach Dacha DICE: AYLI server.';
    }
    loading = false;
  });

  function handleDeleted(showId) {
    shows = shows.filter(s => s.id !== showId);
  }

  async function clearAll() {
    try {
      await api.clearAllShows();
      shows = [];
    } catch {
      error = 'Failed to clear history.';
    }
    clearConfirm = false;
  }
</script>

<div class="history-page">
  <header class="history-header">
    <a href="/" class="history-back">← Back to Showrunner</a>
    <h1 class="history-title">Show History</h1>
    {#if shows.length > 0}
      {#if clearConfirm}
        <span class="history-clear-confirm">
          Delete ALL shows permanently?
          <button class="btn-history danger" onclick={clearAll}>Yes, clear all</button>
          <button class="btn-history" onclick={() => clearConfirm = false}>Cancel</button>
        </span>
      {:else}
        <button class="btn-history danger history-clear-all" onclick={() => clearConfirm = true}>Clear all</button>
      {/if}
    {/if}
  </header>

  <div id="history-root">
    {#if loading}
      <div class="history-empty">Loading…</div>
    {:else if error}
      <div class="history-error">{error}</div>
    {:else if shows.length === 0}
      <div class="history-empty">No shows recorded yet.</div>
    {:else}
      {#each grouped as { date, shows: dateShows }}
        <section class="history-date-section">
          <h2 class="history-date-heading">{formatDate(date)}</h2>
          <div class="history-cards">
            {#each dateShows as show (show.id)}
              <HistoryCard
                {show}
                {tracks}
                {actors}
                {acts}
                ondeleted={handleDeleted}
              />
            {/each}
          </div>
        </section>
      {/each}
    {/if}
  </div>
</div>
