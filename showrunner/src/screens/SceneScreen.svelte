<script>
  import { nav } from '../stores/screen.svelte.js';
  import { showData, resetShow } from '../stores/show.svelte.js';
  import { configData } from '../stores/config.svelte.js';
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
</script>

<div class="screen-inner">
  <button class="btn-back" onclick={goBack}>← Back</button>
  <h2 class="screen-title">Select Scenes</h2>

  <div class="act-rows">
    {#each configData.acts as act (act.id)}
      <ActSection {act} />
    {/each}
  </div>

  <div class="screen-actions">
    <button class="btn btn-primary btn-xl" onclick={goNext}>
      Next: Assign Cast →
    </button>
  </div>
</div>
