<script>
  import { tick } from 'svelte';
  import QRCode from 'qrcode';
  import { photoModalState, closePhotoModal, photoWindowState } from '../stores/photoModal.svelte.js';
  import { showData } from '../stores/show.svelte.js';
  import { getSocket } from '../lib/socket.js';
  import { api } from '../lib/api.js';
  import PhotoThumbGrid from './PhotoThumbGrid.svelte';

  let tab             = $state('controls'); // 'controls' | 'gallery'
  let cameraUrl       = $state('');
  let canvasEl        = $state(null);
  let opening         = $state(false);
  let closing         = $state(false);
  let photosReceived  = $state(null);
  let error           = $state('');
  let galleryPhotos   = $state([]);

  async function loadGallery() {
    if (!showData.id) return;
    try {
      const { photos } = await api.getPhotos(showData.id);
      galleryPhotos = photos;
    } catch {}
  }

  function handlePhotoDeleted(filename) {
    galleryPhotos = galleryPhotos.filter(p => p.filename !== filename);
  }

  async function renderQr() {
    if (!canvasEl || !cameraUrl) return;
    try { await QRCode.toCanvas(canvasEl, cameraUrl, { width: 220 }); } catch {}
  }

  async function loadStatus() {
    if (!showData.id) return;
    try {
      const status = await api.getPhotoWindowStatus(showData.id);
      photoWindowState.open = !!status.open;
      cameraUrl = status.camera_url ?? '';
    } catch {}
    try {
      const { count } = await api.getPhotos(showData.id);
      photoWindowState.count = count;
    } catch {}
    await tick();
    renderQr();
    loadGallery();
  }

  async function openWindow() {
    opening = true;
    error = '';
    try {
      const res = await api.openPhotoWindow(showData.id);
      photoWindowState.open = true;
      cameraUrl = res.camera_url;
      photosReceived = null;
      await tick();
      renderQr();
    } catch {
      error = 'Could not open the upload window. Check server connection.';
    } finally {
      opening = false;
    }
  }

  async function closeWindow() {
    closing = true;
    error = '';
    try {
      const res = await api.closePhotoWindow(showData.id);
      photoWindowState.open = false;
      photosReceived = res.photos_received;
    } catch {
      error = 'Could not close the upload window. Check server connection.';
    } finally {
      closing = false;
    }
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) closePhotoModal();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') closePhotoModal();
  }

  // The QR canvas lives inside the "controls" tab's markup, so it's a fresh DOM
  // node (and canvasEl rebinds) every time we switch back to this tab — redraw
  // onto it rather than relying on the one-time renderQr() calls in loadStatus/openWindow.
  $effect(() => {
    if (tab === 'controls' && canvasEl && cameraUrl) renderQr();
  });

  $effect(() => {
    if (!photoModalState.open) return;
    loadStatus();
    const socket = getSocket();
    socket.on('photos_changed', ({ show_id, count }) => {
      if (show_id !== showData.id) return;
      photoWindowState.count = count;
      loadGallery();
    });
    return () => socket.off('photos_changed');
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if photoModalState.open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <div
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="photo-modal-title"
    onclick={handleOverlayClick}
  >
    <div class="modal photo-modal">
      <div class="modal-header">
        <h2 class="modal-title" id="photo-modal-title">Photo Uploads</h2>
        <button class="modal-close" onclick={closePhotoModal} aria-label="Close">✕</button>
      </div>

      {#if showData.id}
        <div class="modal-tabs">
          <button class="modal-tab {tab === 'controls' ? 'active' : ''}" onclick={() => tab = 'controls'}>Controls</button>
          <button class="modal-tab {tab === 'gallery' ? 'active' : ''}" onclick={() => tab = 'gallery'}>Gallery</button>
        </div>
      {/if}

      <div class="modal-body">
        {#if !showData.id}
          <p class="modal-desc">Start a show to enable photo uploads.</p>
        {:else if tab === 'gallery'}
          <PhotoThumbGrid photos={galleryPhotos} showId={showData.id} mode="delete" ondelete={handlePhotoDeleted} />
        {:else}
          {#if cameraUrl}
            <canvas bind:this={canvasEl} class="photo-qr"></canvas>
            <div class="photo-qr-url">{cameraUrl}</div>
          {/if}

          {#if photoWindowState.open}
            <div class="photo-status success">
              ● PHOTO UPLOAD ALLOWED — {photoWindowState.count} photo{photoWindowState.count === 1 ? '' : 's'} received
            </div>
          {:else if photosReceived !== null}
            <div class="photo-status warn">
              ● PHOTO UPLOAD DISABLED — {photosReceived} photo{photosReceived === 1 ? '' : 's'} saved
            </div>
            <div class="photo-folder-path">photos/{showData.id}/</div>
          {/if}

          {#if error}
            <div class="photo-status warn">{error}</div>
          {/if}
        {/if}
      </div>

      {#if showData.id && tab === 'controls'}
        <div class="modal-footer">
          {#if !photoWindowState.open}
            <button class="btn btn-primary" disabled={opening} onclick={openWindow}>
              {opening ? 'Allowing…' : 'Allow Photo Uploads'}
            </button>
          {:else}
            <button class="btn btn-secondary" disabled={closing} onclick={closeWindow}>
              {closing ? 'Disabling…' : 'Disable Photo Uploads'}
            </button>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
