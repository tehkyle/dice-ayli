<script>
  import { historyGalleryState, closeHistoryGallery } from '../stores/historyGallery.svelte.js';
  import { api } from '../lib/api.js';
  import PhotoThumbGrid from './PhotoThumbGrid.svelte';

  let photos = $state([]);

  async function loadPhotos() {
    if (!historyGalleryState.showId) return;
    photos = [];
    try {
      const res = await api.getPhotos(historyGalleryState.showId);
      photos = res.photos;
    } catch {}
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) closeHistoryGallery();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') closeHistoryGallery();
  }

  $effect(() => {
    if (historyGalleryState.open) loadPhotos();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if historyGalleryState.open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <div
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="history-gallery-title"
    onclick={handleOverlayClick}
  >
    <div class="modal photo-modal">
      <div class="modal-header">
        <h2 class="modal-title" id="history-gallery-title">Show Photos</h2>
        <button class="modal-close" onclick={closeHistoryGallery} aria-label="Close">✕</button>
      </div>

      <div class="modal-body">
        <PhotoThumbGrid {photos} showId={historyGalleryState.showId} mode="download" />
      </div>

      <div class="modal-footer">
        <a
          href={`/api/photos/${historyGalleryState.showId}/zip`}
          download
          class="btn btn-primary"
        >
          Download All (.zip)
        </a>
      </div>
    </div>
  </div>
{/if}
