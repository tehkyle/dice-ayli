<script>
  import { onMount } from 'svelte';
  import { nav } from '../stores/screen.svelte.js';
  import { showData } from '../stores/show.svelte.js';
  import { configData } from '../stores/config.svelte.js';
  import { castData } from '../stores/cast.svelte.js';
  import { buildScenePayload } from '../stores/scenes.svelte.js';
  import { resetProgress } from '../stores/progress.svelte.js';
  import { photoWindowState } from '../stores/photoModal.svelte.js';
  import { api } from '../lib/api.js';
  import CastSummaryRow from '../components/CastSummaryRow.svelte';

  let lockError = $state('');
  let locking = $state(false);
  let syncStatus = $state('syncing'); // 'syncing' | 'synced' | 'mismatch' | 'error'
  let syncMismatches = $state([]);
  let syncConnectStatus = $state(null);

  function trackLabel(trackId) {
    return configData.characterTracks.find(t => t.id === trackId)?.label ?? trackId;
  }

  // Pre-sync: push the cast into QLab's notes now (without firing the confirm
  // cue) and read it back, so the operator sees QLab state before locking.
  async function syncToQLab() {
    syncStatus = 'syncing';
    try {
      const result = await api.syncCast({ cast: castData.selections, confirm: false });
      if (result?.error) {
        syncStatus = 'error';
        return;
      }
      syncMismatches = result.mismatches ?? [];
      syncConnectStatus = result.connectStatus ?? null;
      syncStatus = result.synced ? 'synced' : 'mismatch';
    } catch {
      syncStatus = 'error';
    }
  }

  onMount(syncToQLab);

  async function lock() {
    locking = true;
    lockError = '';
    try {
      const { scenes, scenesOrdered } = buildScenePayload();
      const lockData = await api.lockCast(showData.id, {
        cast: castData.selections,
        scenes,
        scenesOrdered,
      });
      showData.lockTime = new Date();
      showData.qlabNotified = lockData.qlabNotified ?? false;
      showData.castMismatches = lockData.castMismatches ?? [];
      photoWindowState.open = true;
      resetProgress();
      nav.screen = 'progress';
    } catch {
      lockError = 'Error saving cast. Check server connection.';
      locking = false;
    }
  }
</script>

<div class="screen-inner">
  <button class="btn-back" onclick={() => { nav.screen = 'cast'; }}>← Back</button>
  <h2 class="screen-title">Confirm Cast</h2>

  <div class="cast-summary">
    {#each configData.characterTracks as track (track.id)}
      {#if track.id !== 'Track_Singer'}
        {@const actorName = castData.selections[track.id] ?? ''}
        {@const actor = configData.actors.find(a => a.name === actorName) ?? null}
        {@const singerName = castData.selections['Track_Singer'] ?? ''}
        <CastSummaryRow
          {track}
          {actorName}
          {actor}
          isFeaturedSinger={!!singerName && singerName === actorName}
        />
      {/if}
    {/each}
  </div>

  {#if syncStatus === 'syncing'}
    <div class="lock-status">Syncing cast to QLab…</div>
  {:else if syncStatus === 'synced'}
    <div class="lock-status success">✓ Cast synced to QLab</div>
  {:else}
    <div class="lock-status warn">
      {#if syncConnectStatus === 'badpass'}
        ⚠ QLab passcode required or incorrect — check settings.
      {:else if syncStatus === 'mismatch'}
        ⚠ QLab out of sync: {syncMismatches.map(trackLabel).join(', ')}
      {:else}
        ⚠ Could not reach QLab to verify cast.
      {/if}
      <button class="btn" onclick={syncToQLab}>Retry</button>
    </div>
  {/if}

  {#if lockError}
    <div class="lock-status warn">{lockError}</div>
  {/if}

  <div class="screen-actions">
    {#if !locking}
      <button class="btn btn-primary btn-xl" onclick={lock}>Lock &amp; Send to QLab</button>
    {:else}
      <button class="btn btn-primary btn-xl" disabled>Locking…</button>
    {/if}
  </div>
</div>
