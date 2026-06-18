<script>
  import { nav } from '../stores/screen.svelte.js';
  import { configData } from '../stores/config.svelte.js';
  import { castData, randomizeCast } from '../stores/cast.svelte.js';
  import { availabilityData } from '../stores/availability.svelte.js';
  import CastRow from '../components/CastRow.svelte';

  let availableActors = $derived(
    configData.actors.filter(a => !availabilityData.unavailable.has(a.name))
  );

  // DJ requires a unique actor (can't share with anyone, including the Singer).
  // Singer is a double role and can share with any other track *except* DJ.
  const DJ_TRACK     = 'Track_DJ';
  const SINGER_TRACK = 'Track_Singer';

  let filledEntries = $derived(Object.entries(castData.selections).filter(([, actor]) => actor));

  // DJ's dropdown: disable every actor used anywhere, including the Singer's pick.
  let fullTakenActors = $derived(new Set(filledEntries.map(([, actor]) => actor)));
  // Regular tracks' dropdowns: disable actors used by other regular tracks or DJ,
  // but not the Singer's pick alone — that's the one legal pairing.
  let regularTakenActors = $derived(
    new Set(filledEntries.filter(([trackId]) => trackId !== SINGER_TRACK).map(([, actor]) => actor))
  );
  // Singer's dropdown: only DJ's actor is off-limits.
  let djActor = $derived(castData.selections[DJ_TRACK] || '');
  let singerTakenActors = $derived(new Set(djActor ? [djActor] : []));

  function takenActorsFor(trackId) {
    if (trackId === DJ_TRACK) return fullTakenActors;
    if (trackId === SINGER_TRACK) return singerTakenActors;
    return regularTakenActors;
  }

  // A shared actor is only valid when it's exactly {Singer, one non-DJ track}.
  // Anything else (DJ sharing, or two non-Singer tracks sharing) is a real dupe.
  let dupeTracks = $derived.by(() => {
    const byActor = {};
    for (const [trackId, actor] of filledEntries) {
      (byActor[actor] ??= []).push(trackId);
    }
    const bad = new Set();
    for (const trackIds of Object.values(byActor)) {
      if (trackIds.length < 2) continue;
      const isAllowedPair = trackIds.length === 2
        && trackIds.includes(SINGER_TRACK)
        && !trackIds.includes(DJ_TRACK);
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
