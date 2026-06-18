<script>
  import { nav } from '../stores/screen.svelte.js';
  import { showData, resetShow } from '../stores/show.svelte.js';
  import { configData } from '../stores/config.svelte.js';
  import { availabilityData, toggleAvailability } from '../stores/availability.svelte.js';
  import { actorImageUrl } from '../lib/format.js';
  import { api } from '../lib/api.js';
  import ActSection from '../components/ActSection.svelte';

  async function goBack() {
    if (showData.id) {
      try { await api.deleteShow(showData.id); } catch (_) {}
    }
    resetShow();
    nav.screen = 'welcome';
  }

  function goNext() {
    nav.screen = 'cast';
  }

  const MIN_AVAILABLE_ACTORS = 7;
  let availableCount = $derived(configData.actors.length - availabilityData.unavailable.size);
  let notEnoughActors = $derived(availableCount < MIN_AVAILABLE_ACTORS);
</script>

<div class="screen-inner">
  <button class="btn-back" onclick={goBack}>← Back</button>
  <h2 class="screen-title">Show Setup</h2>

  <div class="setup-section">
    <div class="summary-section-label">Actors</div>

    <div class="act-section">
      <div class="act-header">
        <div class="act-label">Actor Availability</div>
      </div>
      <div class="availability-grid">
        {#each configData.actors as actor (actor.name)}
          <label class="scene-item availability-item">
            <input
              type="checkbox"
              checked={!availabilityData.unavailable.has(actor.name)}
              onchange={() => toggleAvailability(actor.name)}
            />
            {#if actorImageUrl(actor.image)}
              <img
                class="availability-img {availabilityData.unavailable.has(actor.name) ? 'unavailable' : ''}"
                src={actorImageUrl(actor.image)}
                alt=""
              />
            {/if}
            <span>{actor.name}</span>
          </label>
        {/each}
      </div>
    </div>

    {#if notEnoughActors}
      <div class="warning">
        At least {MIN_AVAILABLE_ACTORS} actors must be available to fill every role ({availableCount} currently checked).
      </div>
    {/if}
  </div>

  <div class="setup-section">
    <div class="summary-section-label">Scenes</div>

    <div class="act-rows">
      {#each configData.acts as act (act.id)}
        <ActSection {act} />
      {/each}
    </div>
  </div>

  <div class="screen-actions">
    <button class="btn btn-primary btn-xl" disabled={notEnoughActors} onclick={goNext}>
      Next: Assign Cast →
    </button>
  </div>
</div>
