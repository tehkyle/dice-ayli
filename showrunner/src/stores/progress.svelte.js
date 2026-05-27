export const progressData = $state({
  scenesPlayed: [],  // { scene, time, duration: ms|null }[]
  nextCueName: '',
  nextCueNumber: '',
  going: false,
});

export function appendScene(scene, time) {
  if (progressData.scenesPlayed.length > 0) {
    const prev = progressData.scenesPlayed[progressData.scenesPlayed.length - 1];
    prev.duration = new Date(time) - new Date(prev.time);
  }
  progressData.scenesPlayed = [...progressData.scenesPlayed, { scene, time, duration: null }];
}

export function finalizeLastScene(endTime) {
  if (progressData.scenesPlayed.length === 0) return;
  const last = progressData.scenesPlayed[progressData.scenesPlayed.length - 1];
  last.duration = new Date(endTime) - new Date(last.time);
  progressData.scenesPlayed = [...progressData.scenesPlayed];
}

export function resetProgress() {
  progressData.scenesPlayed = [];
  progressData.nextCueName = '';
  progressData.nextCueNumber = '';
  progressData.going = false;
}
