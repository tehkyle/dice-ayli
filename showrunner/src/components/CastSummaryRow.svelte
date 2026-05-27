<script>
  import { actorImageUrl } from '../lib/format.js';

  let { track, actorName, actor = null } = $props();
  let imgUrl = $derived(actor ? actorImageUrl(actor.image) : null);
</script>

<div class="summary-row">
  <div class="summary-track">
    {track.label}
    {#if track.subtitle}
      <div class="summary-track-sub">{track.subtitle}</div>
    {/if}
  </div>
  <div class="summary-actor">
    {#if imgUrl}
      <img class="summary-actor-img" src={imgUrl} alt={actorName} />
    {/if}
    <span>{actorName}</span>
    {#if actor?.subtitle}
      <div class="summary-actor-sub">{actor.subtitle}</div>
    {/if}
  </div>
</div>
