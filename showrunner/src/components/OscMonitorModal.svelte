<script>
  import { oscMonitorState, closeOscMonitor } from '../stores/oscMonitor.svelte.js';
  import { api } from '../lib/api.js';
  import { getSocket } from '../lib/socket.js';

  const MAX_ENTRIES = 500;

  let entries         = $state([]);
  let filterText      = $state('');
  let filterDirection = $state('all'); // 'all' | 'out' | 'in'
  let listEl          = $state(null);
  let autoScroll      = $state(true);

  let filtered = $derived(entries.filter(e => {
    if (filterDirection !== 'all' && e.direction !== filterDirection) return false;
    const needle = filterText.trim().toLowerCase();
    if (!needle) return true;
    const haystack = `${e.address} ${(e.args || []).join(' ')} ${e.raw ?? ''} ${e.error ?? ''}`.toLowerCase();
    return haystack.includes(needle);
  }));

  async function load() {
    try {
      entries = await api.getOscLog();
    } catch {
      entries = [];
    }
  }

  function clearLog() {
    entries = [];
  }

  function handleScroll() {
    if (!listEl) return;
    autoScroll = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 40;
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) closeOscMonitor();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') closeOscMonitor();
  }

  $effect(() => {
    if (!oscMonitorState.open) return;
    load();
    const socket = getSocket();
    socket.on('osc_log', (entry) => {
      entries = [...entries, entry].slice(-MAX_ENTRIES);
    });
    return () => socket.off('osc_log');
  });

  // Re-run after every render of the filtered list so a freshly-arrived row
  // is actually in the DOM before we measure scrollHeight to scroll to it.
  $effect(() => {
    filtered.length;
    if (autoScroll && listEl) listEl.scrollTop = listEl.scrollHeight;
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if oscMonitorState.open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <div
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="osc-monitor-title"
    onclick={handleOverlayClick}
  >
    <div class="modal osc-monitor-modal">
      <div class="modal-header">
        <h2 class="modal-title" id="osc-monitor-title">OSC Monitor</h2>
        <button class="modal-close" onclick={closeOscMonitor} aria-label="Close">✕</button>
      </div>

      <div class="osc-monitor-toolbar">
        <div class="osc-monitor-directions">
          <button
            class="btn-history {filterDirection === 'all' ? 'primary' : ''}"
            onclick={() => filterDirection = 'all'}
          >All</button>
          <button
            class="btn-history {filterDirection === 'out' ? 'primary' : ''}"
            onclick={() => filterDirection = 'out'}
          >Out</button>
          <button
            class="btn-history {filterDirection === 'in' ? 'primary' : ''}"
            onclick={() => filterDirection = 'in'}
          >In</button>
        </div>
        <input
          class="modal-input osc-monitor-filter"
          type="text"
          placeholder="Filter by address or content…"
          bind:value={filterText}
        />
        <button class="btn-history" onclick={clearLog}>Clear</button>
      </div>

      <div class="osc-monitor-log" bind:this={listEl} onscroll={handleScroll}>
        {#if filtered.length === 0}
          <div class="osc-monitor-empty">No matching OSC traffic yet.</div>
        {:else}
          {#each filtered as entry, i (i)}
            <div class="osc-monitor-row {entry.direction} {entry.raw ? 'undecoded' : ''}">
              <span class="osc-monitor-time">{formatTime(entry.time)}</span>
              <span class="osc-monitor-dir">{entry.direction === 'out' ? '→' : '←'}</span>
              {#if entry.raw}
                <span class="osc-monitor-address">{entry.address}</span>
                <span class="osc-monitor-raw">{entry.raw}</span>
                {#if entry.error}<span class="osc-monitor-error">{entry.error}</span>{/if}
              {:else}
                <span class="osc-monitor-address">{entry.address}</span>
                <span class="osc-monitor-args">{(entry.args || []).join(' ')}</span>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}
