<script>
  import { scenesData } from '../stores/scenes.svelte.js';

  let { actId } = $props();

  let dragSrcIndex = $state(-1);

  function moveUp(i) {
    const list = [...scenesData.orderedLists[actId]];
    [list[i - 1], list[i]] = [list[i], list[i - 1]];
    scenesData.orderedLists[actId] = list;
  }

  function moveDown(i) {
    const list = [...scenesData.orderedLists[actId]];
    [list[i], list[i + 1]] = [list[i + 1], list[i]];
    scenesData.orderedLists[actId] = list;
  }

  function onDragStart(i) {
    dragSrcIndex = i;
  }

  function onDrop(targetIndex) {
    if (dragSrcIndex < 0 || dragSrcIndex === targetIndex) return;
    const list = [...scenesData.orderedLists[actId]];
    const [removed] = list.splice(dragSrcIndex, 1);
    list.splice(targetIndex, 0, removed);
    scenesData.orderedLists[actId] = list;
    dragSrcIndex = -1;
  }
</script>

<div class="scene-order-list">
  {#each (scenesData.orderedLists[actId] ?? []) as scene, i (scene)}
    <div
      class="scene-order-item"
      draggable="true"
      ondragstart={() => onDragStart(i)}
      ondragover={(e) => e.preventDefault()}
      ondrop={() => onDrop(i)}
      ondragend={() => { dragSrcIndex = -1; }}
    >
      <span class="scene-order-handle" aria-hidden="true">⠿</span>
      <span class="scene-order-name">{scene}</span>
      <button class="scene-order-btn" disabled={i === 0} onclick={() => moveUp(i)}>▲</button>
      <button class="scene-order-btn" disabled={i === (scenesData.orderedLists[actId]?.length ?? 0) - 1} onclick={() => moveDown(i)}>▼</button>
    </div>
  {/each}
</div>
