<script>
  import { scenesData } from '../stores/scenes.svelte.js';
  import SceneOrderList from './SceneOrderList.svelte';

  let { act } = $props();

  let actSelections = $derived(scenesData.selections[act.id] ?? []);
  let allChecked    = $derived(act.scenes.every(s => actSelections.includes(s)));

  function handleToggleScene(scene) {
    if (actSelections.includes(scene)) {
      scenesData.selections[act.id] = actSelections.filter(s => s !== scene);
    } else {
      scenesData.selections[act.id] = [...actSelections, scene];
    }
  }

  function handleToggleAll() {
    scenesData.selections[act.id] = allChecked ? [] : [...act.scenes];
  }

  function handleToggleOrder() {
    const isOrdered = scenesData.ordered[act.id];
    if (!isOrdered) {
      scenesData.orderedLists[act.id] = actSelections.length ? [...actSelections] : [...act.scenes];
      scenesData.ordered[act.id] = true;
    } else {
      const orderedSet = new Set(scenesData.orderedLists[act.id] ?? []);
      scenesData.selections[act.id] = act.scenes.filter(s => orderedSet.has(s));
      scenesData.ordered[act.id] = false;
    }
  }
</script>

<div class="act-section">
  <div class="act-header">
    <div class="act-label">{act.label}</div>
    <button
      class="btn-rig-toggle {scenesData.ordered[act.id] ? 'active' : ''}"
      onclick={handleToggleOrder}
    >
      {scenesData.ordered[act.id] ? 'Randomize' : 'Fix Order'}
    </button>
    {#if !scenesData.ordered[act.id]}
      <button class="btn-toggle-all" onclick={handleToggleAll}>
        {allChecked ? 'Deselect all' : 'Select all'}
      </button>
    {/if}
  </div>

  {#if scenesData.ordered[act.id]}
    <SceneOrderList actId={act.id} />
  {:else}
    <div class="scene-grid">
      {#each act.scenes as scene (scene)}
        <label class="scene-item">
          <input
            type="checkbox"
            checked={actSelections.includes(scene)}
            onchange={() => handleToggleScene(scene)}
          />
          <span>{scene}</span>
        </label>
      {/each}
    </div>
  {/if}
</div>
