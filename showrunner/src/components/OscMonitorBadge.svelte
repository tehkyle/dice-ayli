<script>
  import { openOscMonitor } from '../stores/oscMonitor.svelte.js';
</script>

<button
  class="btn-settings"
  aria-label="OSC monitor"
  onclick={openOscMonitor}
>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <polyline points="2 12 7 12 10 20 14 4 17 12 22 12"/>
  </svg>
</button>
