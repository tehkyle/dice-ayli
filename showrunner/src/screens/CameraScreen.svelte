<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from '../lib/api.js';
  import { getSocket } from '../lib/socket.js';
  import PhotoThumbGrid from '../components/PhotoThumbGrid.svelte';

  const POLL_MS = 5000;

  let showId       = $state(null);
  let phase        = $state('waiting'); // 'waiting' | 'active' | 'closed' | 'error'
  let errorMessage = $state('');
  let sessionCount = $state(0);
  let uploadError  = $state(false);
  let thumbnailUrl = $state('');
  let capturing    = $state(false);
  let everActive   = false;

  let fileInputEl = $state(null);
  let pollTimer = null;
  let thumbTimer = null;
  let usesLatest = false; // true when opened with no ?show= (the standing, printable camera link)

  let fullscreenSupported = typeof document !== 'undefined' &&
    !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  let isFullscreen = $state(false);

  function toggleFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      (el.requestFullscreen || el.webkitRequestFullscreen).call(el).catch(() => {});
    } else {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch(() => {});
    }
  }

  function onFullscreenChange() {
    isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  let galleryOpen    = $state(false);
  let galleryPhotos  = $state([]);

  async function loadGalleryPhotos() {
    if (!showId) return;
    try {
      const { photos } = await api.getPhotos(showId);
      galleryPhotos = photos;
    } catch {}
  }

  function openGallery() {
    galleryOpen = true;
    loadGalleryPhotos();
  }

  function closeGallery() {
    galleryOpen = false;
  }

  function handleGalleryDelete(filename) {
    galleryPhotos = galleryPhotos.filter(p => p.filename !== filename);
  }

  // The QR/link is the same for every show, so on every poll we re-resolve
  // "current show" rather than being told which one via the URL.
  async function resolveShowId() {
    if (!usesLatest) return showId;
    try {
      const latest = await api.getLatestShow();
      if (!latest) return null;
      if (latest.id !== showId) {
        showId = latest.id;
        everActive = false;
        sessionCount = 0;
        phase = 'waiting';
      }
      return showId;
    } catch {
      return showId;
    }
  }

  async function checkStatus() {
    const id = await resolveShowId();
    if (id == null) {
      if (phase !== 'error') phase = 'waiting';
      return;
    }
    let open = false;
    try {
      ({ open } = await api.getPhotoWindowStatus(id));
    } catch {
      return;
    }
    if (open) {
      phase = 'active';
      everActive = true;
    } else if (phase !== 'error') {
      phase = everActive ? 'closed' : 'waiting';
    }
  }

  function flashThumbnail(file) {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    thumbnailUrl = URL.createObjectURL(file);
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      URL.revokeObjectURL(thumbnailUrl);
      thumbnailUrl = '';
    }, 1200);
  }

  async function upload(file, isRetry = false) {
    const formData = new FormData();
    formData.append('show_id', showId);
    formData.append('photo', file, file.name || 'photo');

    try {
      const res  = await fetch('/api/photos/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'upload failed');
      sessionCount += 1;
      uploadError = false;
      flashThumbnail(file);
    } catch {
      if (!isRetry) return upload(file, true);
      uploadError = true;
      setTimeout(() => { uploadError = false; }, 1500);
    } finally {
      capturing = false;
    }
  }

  // The file input's capture="environment" hint opens the phone's native camera
  // app directly — full manual control (zoom, focus, flash) instead of reimplementing
  // it over getUserMedia, which only ever exposed a digital zoom anyway.
  function handleFileSelected(e) {
    const file = e.target.files?.[0];
    e.target.value = ''; // clear so capturing the same shot again still fires a change event
    if (!file || capturing) return;
    capturing = true;
    upload(file);
  }

  function triggerCapture() {
    if (capturing || phase !== 'active') return;
    fileInputEl?.click();
  }

  onMount(() => {
    const param = new URLSearchParams(window.location.search).get('show');
    if (!param || param === 'latest') {
      usesLatest = true;
    } else {
      showId = parseInt(param, 10);
      if (!Number.isInteger(showId)) {
        phase = 'error';
        errorMessage = 'Invalid camera link.';
        return;
      }
    }

    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    const socket = getSocket();
    socket.on('photos_changed', ({ show_id }) => {
      if (show_id === showId && galleryOpen) loadGalleryPhotos();
    });

    checkStatus();
    pollTimer = setInterval(checkStatus, POLL_MS);
  });

  onDestroy(() => {
    clearInterval(pollTimer);
    clearTimeout(thumbTimer);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
    getSocket().off('photos_changed');
  });
</script>

{#if fullscreenSupported}
  <button class="camera-fullscreen" aria-label="Toggle fullscreen" onclick={toggleFullscreen}>
    {isFullscreen ? '⤡' : '⤢'}
  </button>
{/if}

{#if galleryOpen}
  <div class="camera-gallery-overlay">
    <div class="camera-gallery-header">
      <h2 class="camera-gallery-title">Show Photos</h2>
      <button class="camera-gallery-close" onclick={closeGallery}>Close</button>
    </div>
    <div class="camera-gallery-body">
      <PhotoThumbGrid photos={galleryPhotos} showId={showId} mode="delete" ondelete={handleGalleryDelete} />
    </div>
  </div>
{/if}

<div class="camera-main">
  <div class="camera-top-right">
    <div class="camera-count">{sessionCount} photo{sessionCount === 1 ? '' : 's'} taken</div>
    <button class="camera-view-photos" onclick={openGallery}>View Photos</button>
  </div>

  <input
    bind:this={fileInputEl}
    type="file"
    accept="image/*"
    capture="environment"
    class="camera-file-input"
    onchange={handleFileSelected}
  />

  <button
    class="camera-shutter-btn"
    disabled={phase !== 'active' || capturing}
    onclick={triggerCapture}
  >
    {capturing ? 'Uploading…' : 'Take Photo'}
  </button>

  {#if phase === 'waiting'}
    <div class="camera-status-text">Waiting for show to start…</div>
  {:else if phase === 'closed'}
    <div class="camera-status-text">Show complete. Thank you.</div>
  {:else if phase === 'error'}
    <div class="camera-status-text">{errorMessage}</div>
  {/if}

  {#if thumbnailUrl}
    <img src={thumbnailUrl} alt="Last capture" class="camera-thumb-flash" />
  {/if}

  {#if uploadError}
    <div class="camera-upload-error">Upload failed — retrying…</div>
  {/if}
</div>
