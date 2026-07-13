<script>
  import { api } from '../lib/api.js';

  let { photos, showId, mode = 'download', ondelete } = $props();

  let confirmingFilename = $state(null);
  let deletingFilename   = $state(null);
  let previewPhoto       = $state(null);

  function askDelete(filename) {
    confirmingFilename = filename;
  }

  function cancelDelete() {
    confirmingFilename = null;
  }

  async function doDelete(filename) {
    deletingFilename = filename;
    try {
      await api.deletePhoto(showId, filename);
      ondelete?.(filename);
    } catch {}
    deletingFilename = null;
    confirmingFilename = null;
  }

  function openPreview(photo) {
    previewPhoto = photo;
  }

  function closePreview() {
    previewPhoto = null;
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) closePreview();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape' && previewPhoto) closePreview();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="photo-thumb-grid">
  {#each photos as photo (photo.filename)}
    {@const url = `/photos/${showId}/${photo.filename}`}
    <div class="photo-thumb-tile">
      {#if mode === 'download'}
        <a href={url} download class="photo-thumb-link">
          <img src={url} alt={photo.filename} loading="lazy" class="photo-thumb-img" />
        </a>
      {:else}
        <button type="button" class="photo-thumb-link" onclick={() => openPreview(photo)}>
          <img src={url} alt={photo.filename} loading="lazy" class="photo-thumb-img" />
        </button>
        <button class="photo-thumb-delete" aria-label="Delete photo" onclick={() => askDelete(photo.filename)}>✕</button>
      {/if}

      {#if confirmingFilename === photo.filename}
        <div class="photo-thumb-confirm">
          <span>Delete?</span>
          <button
            class="btn-history danger"
            disabled={deletingFilename === photo.filename}
            onclick={() => doDelete(photo.filename)}
          >
            {deletingFilename === photo.filename ? '…' : 'Yes'}
          </button>
          <button class="btn-history" onclick={cancelDelete}>No</button>
        </div>
      {/if}
    </div>
  {/each}

  {#if photos.length === 0}
    <div class="photo-thumb-empty">No photos yet.</div>
  {/if}
</div>

{#if previewPhoto}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <div class="photo-lightbox-overlay" role="dialog" aria-modal="true" onclick={handleOverlayClick}>
    <button class="photo-lightbox-close" aria-label="Close" onclick={closePreview}>✕</button>
    <img
      src={`/photos/${showId}/${previewPhoto.filename}`}
      alt={previewPhoto.filename}
      class="photo-lightbox-img"
    />
  </div>
{/if}
