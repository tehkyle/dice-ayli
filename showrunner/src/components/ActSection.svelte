<script>
  import { scenesData } from '../stores/scenes.svelte.js';
  import SceneOrderList from './SceneOrderList.svelte';

  let { act } = $props();

  let allChecked = $derived(
    act.scenes.every(s => (scenesData.selections[act.id] ?? []).includes(s))
  );

  function toggleScene(scene) {
    const current = scenesData.selections[act.id] ?? [];
    if (current.includes(scene)) {
      scenesData.selections[act.id] = current.filter(s => s !== scene);
    } else {
      scenesData.selections[act.id] = [...current, scene];
    }
  }

  function toggleAll() {
    if (allChecked) {
      scenesData.selections[act.id] = [];
    } else {
      scenesData.selections[act.id] = [...act.scenes];
    }
  }

  function toggleOrder() {
    const isOrdered = scenesData.ordered[act.id];
    if (!isOrdered) {
      const checked = (scenesData.selections[act.id] ?? []);
      scenesData.orderedLists[act.id] = checked.length ? [...checked] : [...act.scenes];
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
      onclick={toggleOrder}
    >
      {scenesData.ordered[act.id] ? 'Randomize' : 'Fix Order'}
    </button>
    {#if !scenesData.ordered[act.id]}
      <button class="btn-toggle-all" onclick={toggleAll}>
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
            checked={(scenesData.selections[act.id] ?? []).includes(scene)}
            onchange={() => toggleScene(scene)}
          />
          <span>{scene}</span>
        </label>
      {/each}
    </div>
  {/if}
</div>
