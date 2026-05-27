<script>
  import { formatDuration } from '../lib/format.js';

  let { scene, time, duration, index } = $props();

  let timeStr = $derived(
    new Date(time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  );
</script>

<div class="progress-scene-item">
  <span class="progress-scene-name">{scene}</span>
  <span class="progress-scene-time">{timeStr}</span>
  <span class="progress-scene-duration {duration == null ? 'progress-duration-pending' : ''}">
    {duration == null ? '•••' : formatDuration(duration)}
  </span>
</div>
