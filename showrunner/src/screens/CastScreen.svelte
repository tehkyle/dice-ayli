<script>
  import { nav } from '../stores/screen.svelte.js';
  import { configData } from '../stores/config.svelte.js';
  import { castData, randomizeCast } from '../stores/cast.svelte.js';
  import { availabilityData } from '../stores/availability.svelte.js';
  import CastRow from '../components/CastRow.svelte';

  let availableActors = $derived(
    configData.actors.filter(a => !availabilityData.unavailable.has(a.name))
  );

  // Singer is a double role and can share with any other single track,
  // DJ included. No other track may share an actor with anything.
  const SINGER_TRACK = 'Track_Singer';

  let filledEntries = $derived(Object.entries(castData.selections).filter(([, actor]) => actor));

  // Every dropdown except the Singer's disables actors used by any other
  // non-Singer track — that's the one legal pairing.
  let takenActors = $derived(
    new Set(filledEntries.filter(([trackId]) => trackId !== SINGER_TRACK).map(([, actor]) => actor))
  );
  let noneTaken = new Set();

  function takenActorsFor(trackId) {
    return trackId === SINGER_TRACK ? noneTaken : takenActors;
  }

  // A shared actor is only valid when it's exactly {Singer, one other track}.
  // Anything else (two non-Singer tracks sharing, or 3+ tracks sharing) is a real dupe.
  let dupeTracks = $derived.by(() => {
    const byActor = {};
    for (const [trackId, actor] of filledEntries) {
      (byActor[actor] ??= []).push(trackId);
    }
    const bad = new Set();
    for (const trackIds of Object.values(byActor)) {
      if (trackIds.length < 2) continue;
      const isAllowedPair = trackIds.length === 2 && trackIds.includes(SINGER_TRACK);
      if (!isAllowedPair) trackIds.forEach(id => bad.add(id));
    }
    return bad;
  });

  let hasDupes  = $derived(dupeTracks.size > 0);
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
        actors={availableActors}
        takenActors={takenActorsFor(track.id)}
        isDupe={dupeTracks.has(track.id)}
      />
    {/each}
  </div>

  {#if hasDupes}
    <div class="warning">An actor is assigned to more than one track. Resolve before continuing.</div>
  {/if}

  <div class="screen-actions">
    <button class="btn btn-secondary" onclick={() => randomizeCast(availableActors)}>
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
