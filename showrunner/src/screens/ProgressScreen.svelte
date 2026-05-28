<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { nav } from '../stores/screen.svelte.js';
  import { showData } from '../stores/show.svelte.js';
  import { progressData, appendScene, finalizeLastScene } from '../stores/progress.svelte.js';
  import { getSocket } from '../lib/socket.js';
  import { api } from '../lib/api.js';
  import ProgressSceneItem from '../components/ProgressSceneItem.svelte';

  let startTime = $state(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
  let going = $state(false);
  let sceneListEl = $state(null);

  let nextCueDisplay = $derived(() => {
    const { nextCueName, nextCueNumber } = progressData;
    if (!nextCueName && !nextCueNumber) return '-';
    return nextCueNumber ? `${nextCueNumber} - ${nextCueName}` : nextCueName;
  });

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
    try { await api.postGo(); } catch {}
    await fetchPlayhead();
    setTimeout(() => { going = false; }, 800);
  }

  function handleKeydown(e) {
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
    {#if showData.qlabNotified}
      <span class="progress-qlab-ok">✓ QLab notified</span>
    {:else}
      <span class="progress-qlab-warn">QLab notification failed</span>
    {/if}
  </div>

  <div class="progress-go-panel">
    <div class="progress-next-cue">
      <span class="progress-next-label">Next</span>
      <span class="progress-next-value">{nextCueDisplay()}</span>
    </div>
    <button class="btn btn-primary btn-go" disabled={going} onclick={go}>
      {going ? 'Sending…' : 'GO'}
    </button>
  </div>

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
</div>
