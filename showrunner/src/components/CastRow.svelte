<script>
  import { castData } from '../stores/cast.svelte.js';
  import { actorImageUrl } from '../lib/format.js';

  let { track, actors, takenActors, isDupe } = $props();

  let selected = $derived(castData.selections[track.id] ?? '');
  let actor    = $derived(actors.find(a => a.name === selected) ?? null);
  let imgUrl   = $derived(actor ? actorImageUrl(actor.image) : null);

  function handleChange(e) {
    castData.selections[track.id] = e.target.value;
  }
</script>

<div class="cast-row {selected ? (isDupe ? 'error' : 'filled') : ''}">
  <div class="row-label">
    <div class="row-track-name">{track.label}</div>
    {#if track.subtitle}
      <div class="row-track-sub">{track.subtitle}</div>
    {/if}
  </div>

  {#if imgUrl}
    <img class="row-actor-img" src={imgUrl} alt="" />
  {:else}
    <div class="row-actor-img" style="visibility:hidden"></div>
  {/if}

  <select class="row-select" value={selected} onchange={handleChange}>
    <option value="">— Select actor —</option>
    {#each actors as a (a.name)}
      <option
        value={a.name}
        disabled={takenActors.has(a.name) && a.name !== selected}
      >
        {a.subtitle ? `${a.name} — ${a.subtitle}` : a.name}
      </option>
    {/each}
  </select>

  <div class="row-indicator"></div>
</div>
