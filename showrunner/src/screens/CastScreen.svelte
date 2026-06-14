<script>
  import { nav } from '../stores/screen.svelte.js';
  import { configData } from '../stores/config.svelte.js';
  import { castData, randomizeCast } from '../stores/cast.svelte.js';
  import CastRow from '../components/CastRow.svelte';

  let takenActors = $derived(
    new Set(Object.values(castData.selections).filter(Boolean))
  );

  // Track which actor names appear in more than one slot so each CastRow
  // can highlight itself without re-scanning siblings.
  let dupeActors = $derived.by(() => {
    const counts = {};
    for (const v of Object.values(castData.selections)) {
      if (v) counts[v] = (counts[v] || 0) + 1;
    }
    return new Set(Object.keys(counts).filter(k => counts[k] > 1));
  });

  let hasDupes  = $derived(dupeActors.size > 0);
  let allDone   = $derived(configData.characterTracks.every(t => castData.selections[t.id]));
  let reviewDisabled = $derived(hasDupes || !allDone);
</script>

<div class="screen-inner">
  <button class="btn-back" onclick={() => { nav.screen = 'scenes'; }}>← Back</button>
  <h2 class="screen-title">Assign Cast</h2>

  <div class="cast-rows">
    {#each configData.characterTracks as track (track.id)}
      <CastRow
        {track}
        actors={configData.actors}
        {takenActors}
        isDupe={dupeActors.has(castData.selections[track.id] || '')}
      />
    {/each}
  </div>

  {#if hasDupes}
    <div class="warning">An actor is assigned to more than one track. Resolve before continuing.</div>
  {/if}

  <div class="screen-actions">
    <button class="btn btn-secondary" onclick={() => randomizeCast(configData.actors)}>
      Randomize unfilled
    </button>
    <button
      class="btn btn-primary btn-xl"
      disabled={reviewDisabled}
      onclick={() => { nav.screen = 'confirm'; }}
    >
      Review Cast →
    </button>
  </div>
</div>
