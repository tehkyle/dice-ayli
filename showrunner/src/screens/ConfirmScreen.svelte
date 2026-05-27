<script>
  import { nav } from '../stores/screen.svelte.js';
  import { showData } from '../stores/show.svelte.js';
  import { configData } from '../stores/config.svelte.js';
  import { castData } from '../stores/cast.svelte.js';
  import { buildScenePayload } from '../stores/scenes.svelte.js';
  import { resetProgress } from '../stores/progress.svelte.js';
  import { api } from '../lib/api.js';
  import CastSummaryRow from '../components/CastSummaryRow.svelte';

  let lockError = $state('');
  let locking = $state(false);

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
      {@const actorName = castData.selections[track.id] ?? ''}
      {@const actor = configData.actors.find(a => a.name === actorName) ?? null}
      <CastSummaryRow {track} {actorName} {actor} />
    {/each}
  </div>

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
