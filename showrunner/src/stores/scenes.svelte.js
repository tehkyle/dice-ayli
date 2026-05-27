export const scenesData = $state({
  selections: {},    // { actId: string[] } — checked scenes
  ordered: {},       // { actId: boolean } — fixed-order mode per act
  orderedLists: {},  // { actId: string[] } — ordered scene IDs
});

export function initScenesFromActs(acts) {
  scenesData.selections = Object.fromEntries(acts.map(a => [a.id, [...a.scenes]]));
  scenesData.ordered = Object.fromEntries(acts.map(a => [a.id, false]));
  scenesData.orderedLists = {};
}

export function buildScenePayload() {
  const scenes = {};
  const scenesOrdered = {};
  for (const [actId, isOrdered] of Object.entries(scenesData.ordered)) {
    if (isOrdered) {
      scenes[actId] = [...(scenesData.orderedLists[actId] || [])];
      scenesOrdered[actId] = true;
    } else {
      scenes[actId] = [...(scenesData.selections[actId] || [])];
    }
  }
  return { scenes, scenesOrdered };
}
