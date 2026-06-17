<script>
  import { onMount } from 'svelte';
  import { showData } from '../stores/show.svelte.js';
  import { openPhotoModal, photoWindowState } from '../stores/photoModal.svelte.js';
  import { api } from '../lib/api.js';

  onMount(async () => {
    if (!showData.id) return;
    try {
      const { open } = await api.getPhotoWindowStatus(showData.id);
      photoWindowState.open = !!open;
    } catch {}
  });
</script>

<button
  class="btn-settings"
  aria-label="Photo upload window"
  onclick={openPhotoModal}
>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
    <circle cx="12" cy="13" r="4"/>
  </svg>
  {#if photoWindowState.open}
    <span class="settings-badge configured"></span>
  {/if}
</button>
