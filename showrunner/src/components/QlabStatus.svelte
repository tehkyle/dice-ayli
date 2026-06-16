<script>
  let { reachable = null, missingVars = [], statusText = 'Checking QLab…' } = $props();
</script>

<div class="qlab-status">
  <span class="status-dot {reachable === null ? 'checking' : reachable ? (missingVars.length ? 'warn' : 'ok') : 'offline'}"></span>
  <span>{statusText}</span>
</div>
{#if reachable && missingVars.length > 0}
  <div class="qlab-missing">
    <strong>Missing cues in QLab:</strong>
    {#each missingVars as v, i}
      <code>{v}</code>{#if i < missingVars.length - 1}, {/if}
    {/each}
  </div>
{/if}
