<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { api } from '../lib/api.js';

  const POLL_MS = 5000;

  let showId       = $state(null);
  let phase        = $state('waiting'); // 'waiting' | 'active' | 'closed' | 'error'
  let errorMessage = $state('');
  let sessionCount = $state(0);
  let uploadError  = $state(false);
  let thumbnailUrl = $state('');
  let capturing    = false;
  let everActive   = false;

  let videoEl  = $state(null);
  let canvasEl = $state(null);
  let stream   = null;
  let videoTrack = null;
  let pollTimer = null;
  let thumbTimer = null;
  let usesLatest = false; // true when opened with no ?show= (e.g. a saved home-screen icon)

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

  let facingMode    = $state('environment'); // 'environment' | 'user'
  let zoomSupported = $state(false);
  let zoomMin       = $state(1);
  let zoomMax       = $state(1);
  let zoomValue     = $state(1);
  let zoomT         = $state(0); // 0..1 slider position — mapped exponentially onto zoomMin..zoomMax

  // Zoom capability is a linear magnification factor (e.g. 1x..8x), but a constant
  // step in magnification *feels* much bigger near 1x than near 8x. Map the slider
  // position exponentially so each bit of slider travel is an equal relative change,
  // matching how native camera apps (and pinch gestures) actually feel.
  function zoomToT(zoom) {
    if (zoomMax <= zoomMin) return 0;
    return Math.log(zoom / zoomMin) / Math.log(zoomMax / zoomMin);
  }

  function tToZoom(t) {
    return zoomMin * Math.pow(zoomMax / zoomMin, t);
  }

  function readZoomCapabilities() {
    const caps = videoTrack.getCapabilities?.() ?? {};
    if (caps.zoom) {
      zoomSupported = true;
      zoomMin   = Math.max(caps.zoom.min, 0.01); // guard against a 0 min breaking the log mapping
      zoomMax   = caps.zoom.max;
      zoomValue = videoTrack.getSettings?.().zoom ?? zoomMin;
      zoomT     = zoomToT(zoomValue);
    } else {
      zoomSupported = false;
    }
  }

  function applyZoom(zoom) {
    zoomValue = Math.min(Math.max(zoom, zoomMin), zoomMax);
    zoomT = zoomToT(zoomValue);
    videoTrack?.applyConstraints({ advanced: [{ zoom: zoomValue }] }).catch(() => {});
  }

  function onZoomSlider(t) {
    zoomT = t;
    applyZoom(tToZoom(t));
  }

  let pinchStartDist = null;
  let pinchStartZoom = 1;

  function touchDistance(touches) {
    const [a, b] = touches;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  function onTouchStart(e) {
    if (zoomSupported && e.touches.length === 2) {
      pinchStartDist = touchDistance(e.touches);
      pinchStartZoom = zoomValue;
    }
  }

  function onTouchMove(e) {
    if (pinchStartDist && e.touches.length === 2) {
      e.preventDefault();
      applyZoom(pinchStartZoom * (touchDistance(e.touches) / pinchStartDist));
    }
  }

  function onTouchEnd(e) {
    if (e.touches.length < 2) pinchStartDist = null;
  }

  async function startCamera() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode },
        audio: false,
      });
      videoTrack = stream.getVideoTracks()[0];
      readZoomCapabilities();
      // The <video> element only exists once phase === 'active' renders it,
      // so flip the phase and wait for the DOM update before attaching the stream.
      phase = 'active';
      everActive = true;
      await tick();
      if (videoEl) {
        videoEl.srcObject = stream;
        videoEl.play().catch(() => {});
      }
    } catch {
      phase = 'error';
      errorMessage = 'Camera access is required. Please allow camera access and reload.';
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      videoTrack = null;
    }
    if (videoEl) videoEl.srcObject = null;
  }

  async function flipCamera() {
    if (capturing) return;
    facingMode = facingMode === 'environment' ? 'user' : 'environment';
    stopCamera();
    await startCamera();
  }

  // For a saved home-screen icon (no fixed show id), re-resolve the current show
  // on every poll so a stale icon from a past performance picks up tonight's show
  // automatically instead of being stuck pointing at whatever show existed when
  // the icon was first added.
  async function resolveShowId() {
    if (!usesLatest) return showId;
    try {
      const latest = await api.getLatestShow();
      if (!latest) return null;
      if (latest.id !== showId) {
        showId = latest.id;
        everActive = false;
        sessionCount = 0;
        if (phase === 'active') stopCamera();
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
      if (phase !== 'active') await startCamera();
    } else if (phase !== 'error') {
      if (phase === 'active') stopCamera();
      phase = everActive ? 'closed' : 'waiting';
    }
  }

  function flashThumbnail(blob) {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    thumbnailUrl = URL.createObjectURL(blob);
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      URL.revokeObjectURL(thumbnailUrl);
      thumbnailUrl = '';
    }, 1200);
  }

  async function upload(blob, isRetry = false) {
    const formData = new FormData();
    formData.append('show_id', showId);
    formData.append('photo', blob, 'photo.jpg');

    try {
      const res  = await fetch('/api/photos/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'upload failed');
      sessionCount += 1;
      uploadError = false;
      flashThumbnail(blob);
    } catch {
      if (!isRetry) return upload(blob, true);
      uploadError = true;
      setTimeout(() => { uploadError = false; }, 1500);
    } finally {
      capturing = false;
    }
  }

  function capture() {
    if (capturing || !videoEl || !videoEl.videoWidth) return;
    capturing = true;
    try {
      canvasEl.width  = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;
      canvasEl.getContext('2d').drawImage(videoEl, 0, 0);
    } catch {
      capturing = false;
      return;
    }
    canvasEl.toBlob(blob => { if (blob) upload(blob); else capturing = false; }, 'image/jpeg', 0.85);
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

    checkStatus();
    pollTimer = setInterval(checkStatus, POLL_MS);
  });

  onDestroy(() => {
    clearInterval(pollTimer);
    clearTimeout(thumbTimer);
    stopCamera();
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
  });
</script>

{#if fullscreenSupported}
  <button class="camera-fullscreen" aria-label="Toggle fullscreen" onclick={toggleFullscreen}>
    {isFullscreen ? '⤡' : '⤢'}
  </button>
{/if}

{#if phase === 'active'}
  <div
    class="camera-active"
    ontouchstart={onTouchStart}
    ontouchmove={onTouchMove}
    ontouchend={onTouchEnd}
  >
    <video bind:this={videoEl} class="camera-video" autoplay playsinline muted></video>
    <canvas bind:this={canvasEl} class="camera-canvas-hidden"></canvas>

    <div class="camera-count">{sessionCount} photo{sessionCount === 1 ? '' : 's'} taken</div>

    <button class="camera-flip" aria-label="Flip camera" onclick={flipCamera}>⟲</button>

    {#if zoomSupported}
      <div class="camera-zoom-row">
        <input
          class="camera-zoom"
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={zoomT}
          oninput={(e) => onZoomSlider(Number(e.target.value))}
          aria-label="Zoom"
        />
        <span class="camera-zoom-value">{zoomValue.toFixed(1)}x</span>
      </div>
    {/if}

    {#if thumbnailUrl}
      <img src={thumbnailUrl} alt="Last capture" class="camera-thumb-flash" />
    {/if}

    {#if uploadError}
      <div class="camera-upload-error">Upload failed — retrying…</div>
    {/if}

    <button class="camera-shutter" aria-label="Take photo" onclick={capture}></button>
  </div>
{:else}
  <div class="screen-inner camera-message">
    {#if phase === 'waiting'}
      <div class="camera-pulse"></div>
      <h2 class="screen-title">Waiting for show to start…</h2>
    {:else if phase === 'closed'}
      <h2 class="screen-title">Show complete. Thank you.</h2>
    {:else}
      <h2 class="screen-title">{errorMessage}</h2>
    {/if}
  </div>
{/if}
