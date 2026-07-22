<script>
  import { tick } from 'svelte';
  import QRCode from 'qrcode';
  import { cameraQrModalState, closeCameraQrModal } from '../stores/cameraQrModal.svelte.js';
  import { api } from '../lib/api.js';

  let cameraUrl = $state('');
  let canvasEl  = $state(null);

  async function loadAndRender() {
    try {
      const { camera_url } = await api.getCameraUrl();
      cameraUrl = camera_url ?? '';
    } catch {}
    await tick();
    if (canvasEl && cameraUrl) {
      try { await QRCode.toCanvas(canvasEl, cameraUrl, { width: 220 }); } catch {}
    }
  }

  function handleOverlayClick(e) {
    if (e.target === e.currentTarget) closeCameraQrModal();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') closeCameraQrModal();
  }

  $effect(() => {
    if (cameraQrModalState.open) loadAndRender();
  });
</script>

<svelte:window onkeydown={handleKeydown} />

{#if cameraQrModalState.open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
  <div
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="camera-qr-modal-title"
    onclick={handleOverlayClick}
  >
    <div class="modal photo-modal">
      <div class="modal-header">
        <h2 class="modal-title" id="camera-qr-modal-title">Photo Uploads</h2>
        <button class="modal-close" onclick={closeCameraQrModal} aria-label="Close">✕</button>
      </div>

      <div class="modal-body">
        <p class="modal-desc">
          Connect to the 'Dacha Theatre' wifi network and scan this QR code to contribute photos to the wedding finale.
        </p>
        {#if cameraUrl}
          <canvas bind:this={canvasEl} class="photo-qr"></canvas>
          <div class="photo-qr-url">{cameraUrl}</div>
        {/if}
      </div>
    </div>
  </div>
{/if}
