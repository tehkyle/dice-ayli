<script>
  import { api } from '../lib/api.js';

  let { photos, showId, mode = 'download', ondelete } = $props();

  let confirmingFilename = $state(null);
  let deletingFilename   = $state(null);

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
</script>

<div class="photo-thumb-grid">
  {#each photos as photo (photo.filename)}
    {@const url = `/photos/${showId}/${photo.filename}`}
    <div class="photo-thumb-tile">
      {#if mode === 'download'}
        <a href={url} download class="photo-thumb-link">
          <img src={url} alt={photo.filename} loading="lazy" class="photo-thumb-img" />
        </a>
      {:else}
        <img src={url} alt={photo.filename} loading="lazy" class="photo-thumb-img" />
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
