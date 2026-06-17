<script>
  import { formatTime, formatRunTime, formatDurationReport, actorImageUrl, MAX_SHOW_RUN_MS } from '../lib/format.js';
  import { api } from '../lib/api.js';
  import { openHistoryGallery } from '../stores/historyGallery.svelte.js';

  let { show, tracks, actors, acts, ondeleted } = $props();

  const actorMap = $derived(Object.fromEntries(actors.map(a => [a.name, a])));

  let editMode = $state(false);
  let deleteConfirm = $state(false);
  let editCast = $state({});
  let saving = $state(false);
  let saveError = $state('');

  function startEdit() {
    editCast = Object.fromEntries(tracks.map(t => [t.id, castByTrack[t.id] || '']));
    editMode = true;
    deleteConfirm = false;
    saveError = '';
  }

  function cancelEdit() {
    editMode = false;
    deleteConfirm = false;
    saveError = '';
  }

  async function saveEdit() {
    saving = true;
    saveError = '';
    try {
      await api.saveCast(show.id, editCast);
      show = {
        ...show,
        cast: Object.entries(editCast).map(([character_track, actor_name]) => ({ character_track, actor_name })),
      };
      editMode = false;
    } catch {
      saveError = 'Failed to save. Check server connection.';
    }
    saving = false;
  }

  async function confirmDelete() {
    try {
      await api.deleteShow(show.id);
      ondeleted(show.id);
    } catch {
      saveError = 'Failed to delete.';
      deleteConfirm = false;
    }
  }

  const castByTrack = $derived(Object.fromEntries((show.cast ?? []).map(a => [a.character_track, a.actor_name])));
  const matchedActs = $derived(acts.filter(act => show.scenes_played?.some(e => act.scenes.includes(e.scene_name))));
  const headerTime = $derived.by(() => {
    if (!show.locked_at) return 'Not locked';
    const start = formatTime(show.locked_at);
    if (!show.ended_at) return start;
    const ranLong = new Date(show.ended_at) - new Date(show.locked_at) > MAX_SHOW_RUN_MS;
    const run = ranLong ? 'Unfinished' : formatRunTime(show.locked_at, show.ended_at);
    return `${start}  ·  ${run}`;
  });
</script>

<div class="history-card">
  <div class="history-card-header">
    <div class="history-card-perf">Performance #{show.performance_number}</div>
    <div class="history-card-time">{headerTime}</div>
  </div>

  <div class="history-cast-list">
    {#each tracks as track, i}
      {@const actorName = castByTrack[track.id]}
      {@const actor = actorName ? actorMap[actorName] : null}
      <div class="history-cast-row">
        <div class="history-track-label">
          <span class="history-track-num">{i + 1}</span>
          {#if track.subtitle}<span class="history-track-sub" title={track.subtitle}>{track.subtitle}</span>{/if}
        </div>

        {#if editMode}
          <select class="history-edit-select" bind:value={editCast[track.id]}>
            <option value="">— unassigned —</option>
            {#each actors as a}
              <option value={a.name}>{a.name}</option>
            {/each}
          </select>
        {:else}
          <div class="history-actor">
            <div class="history-actor-name">{actorName || '—'}</div>
            {#if actor?.image}
              <img class="history-actor-img" src={actorImageUrl(actor.image)} alt={actorName} />
            {:else if actorName}
              <div class="history-actor-initial">{actorName[0].toUpperCase()}</div>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>

  {#if matchedActs.length > 0}
    <div class="history-scenes-section">
      {#each matchedActs as act}
        {@const actScenes = show.scenes_played.filter(e => act.scenes.includes(e.scene_name))}
        {#if actScenes.length > 0}
          <div class="history-act-row">
            <span class="history-act-label">{act.label}</span>
            <span class="history-scene-sequence">
              {#each actScenes as entry, i}
                {entry.scene_name}{#if entry.duration_ms != null}<span class="history-scene-dur">{formatDurationReport(entry.duration_ms)}</span>{/if}{#if i < actScenes.length - 1} → {/if}
              {/each}
            </span>
          </div>
        {/if}
      {/each}
    </div>
  {/if}

  {#if saveError}
    <div class="history-save-error">{saveError}</div>
  {/if}

  {#if deleteConfirm}
    <div class="history-delete-confirm">
      <span>Delete this show permanently?</span>
      <button class="btn-history danger" onclick={confirmDelete}>Yes, delete</button>
      <button class="btn-history" onclick={cancelEdit}>Cancel</button>
    </div>
  {:else if editMode}
    <div class="history-card-actions">
      <button class="btn-history primary" disabled={saving} onclick={saveEdit}>
        {saving ? 'Saving…' : 'Save'}
      </button>
      <button class="btn-history" onclick={cancelEdit}>Cancel</button>
    </div>
  {:else}
    <div class="history-card-actions">
      <button class="btn-history" onclick={startEdit}>Edit cast</button>
      {#if show.photo_count > 0}
        <button class="btn-history" onclick={() => openHistoryGallery(show.id)}>Gallery</button>
      {/if}
      <button class="btn-history danger" onclick={() => { deleteConfirm = true; }}>Delete show</button>
    </div>
  {/if}
</div>
