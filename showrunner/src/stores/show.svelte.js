export const showData = $state({
  id: null,
  perfLabel: 'Performance #—',
  startTime: null,
  qlabNotified: false,
  castMismatches: [],
});

export function resetShow() {
  showData.id = null;
  showData.perfLabel = 'Performance #—';
  showData.startTime = null;
  showData.qlabNotified = false;
  showData.castMismatches = [];
}
