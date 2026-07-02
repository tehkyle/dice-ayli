<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { nav } from '../stores/screen.svelte.js';
  import { showData, resetShow } from '../stores/show.svelte.js';
  import { castData } from '../stores/cast.svelte.js';
  import { configData } from '../stores/config.svelte.js';
  import { progressData, appendScene, finalizeLastScene, resetProgress } from '../stores/progress.svelte.js';
  import { getSocket } from '../lib/socket.js';
  import { api } from '../lib/api.js';
  import { photoWindowState } from '../stores/photoModal.svelte.js';
  import { formatCueDisplay } from '../lib/format.js';
  import ProgressSceneItem from '../components/ProgressSceneItem.svelte';

  let startTime = $state(
    showData.lockTime
      ? new Date(showData.lockTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
      : new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  );
  let going = $state(false);
  let goError = $state('');
  let sceneListEl = $state(null);
  let reconnecting = $state(false);
  let reconnectResult = $state(null); // null | 'ok' | 'failed'
  let reconnectTimer = null;
  let panicking = $state(false);
  let panicError = $state('');
  let panicTimer = null;

  let nextCueDisplay = $derived(formatCueDisplay(progressData.nextCueNumber, progressData.nextCueName));

  let pollTimer = null;

  async function fetchPlayhead() {
    try {
      const { cueName, cueNumber } = await api.getPlayhead();
      progressData.nextCueName = cueName ?? '';
      progressData.nextCueNumber = cueNumber ?? '';
    } catch {}
  }

  async function go() {
    going = true;
    goError = '';
    try {
      const res = await api.postGo();
      if (res?.error) goError = 'GO failed — QLab is not responding. Try reconnecting above.';
    } catch {
      goError = 'GO failed — could not reach the server.';
    }
    await fetchPlayhead();
    setTimeout(() => { going = false; }, 800);
  }

  let resending = $state(false);

  let castSyncWarning = $derived.by(() => {
    if (showData.qlabNotified && showData.castMismatches.length === 0) return '';
    if (showData.castMismatches.length === 0) return 'Cast not synced to QLab';
    const names = showData.castMismatches.map(
      id => configData.characterTracks.find(t => t.id === id)?.label ?? id
    );
    return `Cast not synced: ${names.join(', ')}`;
  });

  // Re-send + verify the locked cast; fires the CAST_CONFIRMED cue on success.
  async function resendCast() {
    resending = true;
    try {
      const result = await api.syncCast({ cast: castData.selections, confirm: true });
      showData.castMismatches = result?.mismatches ?? showData.castMismatches;
      if (result?.synced) showData.qlabNotified = true;
    } catch {}
    resending = false;
  }

  async function reconnect() {
    reconnecting = true;
    reconnectResult = null;
    clearTimeout(reconnectTimer);
    try {
      const res = await api.reconnectQLab({ cueNumber: progressData.nextCueNumber || undefined });
      reconnectResult = res?.status === 'ok' ? 'ok' : 'failed';
    } catch {
      reconnectResult = 'failed';
    }
    reconnecting = false;
    reconnectTimer = setTimeout(() => { reconnectResult = null; }, 3000);
  }

  async function forceEndShow() {
    if (!confirm('End the show and send the report to Sheets?')) return;
    try { await api.endShow(showData.id); } catch {}
    photoWindowState.open = false;
    // Navigation happens via the show_ended socket event (same as normal end)
  }

  async function restartShow() {
    if (!confirm('Cancel this show and restart from the beginning?')) return;
    try {
      const res = await api.cancelShow(showData.id);
      if (res?.error) {
        alert(`Could not cancel show: ${res.error}`);
        return;
      }
    } catch {
      alert('Could not reach server. Show was not cancelled.');
      return;
    }
    photoWindowState.open = false;
    resetProgress();
    resetShow();
    nav.screen = 'welcome';
  }

  async function panic() {
    panicking = true;
    panicError = '';
    clearTimeout(panicTimer);
    try {
      const res = await api.panicAll();
      if (res?.error) panicError = 'PANIC failed — QLab is not responding. Try again.';
    } catch {
      panicError = 'PANIC failed — could not reach the server.';
    }
    panicTimer = setTimeout(() => { panicking = false; }, 1000);
  }

  function handleKeydown(e) {
    if (e.code === 'Escape') {
      e.preventDefault();
      panic();
      return;
    }
    if (e.code === 'Space' && !going && e.target === document.body) {
      e.preventDefault();
      go();
    }
  }

  onMount(() => {

    const socket = getSocket();

    socket.on('scene_started', async ({ scene, time }) => {
      appendScene(scene, time);
      await tick();
      if (sceneListEl) sceneListEl.scrollTop = sceneListEl.scrollHeight;
    });

    socket.on('show_ended', ({ time }) => {
      finalizeLastScene(time);
      nav.screen = 'summary';
    });

    fetchPlayhead();
    pollTimer = setInterval(fetchPlayhead, 2000);
  });

  onDestroy(() => {
    clearInterval(pollTimer);
    const socket = getSocket();
    socket.off('scene_started');
    socket.off('show_ended');
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="screen-inner">
  <h2 class="screen-title">Show In Progress</h2>

  <div class="progress-meta">
    <span class="progress-perf">{showData.perfLabel}</span>
    <span class="progress-start">Started {startTime}</span>
    {#if !castSyncWarning}
      <span class="progress-qlab-ok">✓ Cast synced to QLab</span>
    {:else}
      <span class="progress-qlab-warn">{castSyncWarning}</span>
      <button class="btn-qlab-reconnect" onclick={resendCast} disabled={resending}>
        {resending ? 'Resending…' : 'Resend Cast'}
      </button>
    {/if}
    <button
      class="btn-qlab-reconnect {reconnectResult === 'ok' ? 'ok' : reconnectResult === 'failed' ? 'failed' : ''}"
      onclick={reconnect}
      disabled={reconnecting}
    >
      {reconnecting ? 'Reconnecting…' : reconnectResult === 'ok' ? '✓ Reconnected' : reconnectResult === 'failed' ? 'Failed — Retry' : 'Reconnect QLab'}
    </button>
  </div>

  <div class="progress-go-panel">
    <div class="progress-next-cue">
      <span class="progress-next-label">Next</span>
      <span class="progress-next-value">{nextCueDisplay}</span>
    </div>
    {#if goError}
      <div class="go-error">{goError}</div>
    {/if}
    <button class="btn btn-primary btn-go" disabled={going} onclick={go}>
      {going ? 'Sending…' : 'GO'}
    </button>
  </div>

  {#if panicError}
    <div class="go-error">{panicError}</div>
  {/if}
  <button class="btn-panic {panicking ? 'active' : ''}" onclick={panic}>
    {panicking ? 'PANIC' : 'Panic All'}
  </button>

  <div class="progress-scene-list" bind:this={sceneListEl}>
    {#if progressData.scenesPlayed.length === 0}
      <div class="progress-empty">Waiting for first scene…</div>
    {:else}
      {#each progressData.scenesPlayed as entry, i (i)}
        <ProgressSceneItem
          scene={entry.scene}
          time={entry.time}
          duration={entry.duration}
          index={i}
        />
      {/each}
    {/if}
  </div>

  <div class="progress-show-controls">
    <button class="btn-show-control end" onclick={forceEndShow}>End Show</button>
    <button class="btn-show-control restart" onclick={restartShow}>Restart Show</button>
  </div>
</div>
