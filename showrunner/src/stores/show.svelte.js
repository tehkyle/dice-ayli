export const showData = $state({
  id: null,
  perfLabel: 'Performance #—',
  lockTime: null,
  qlabNotified: false,
  castMismatches: [],
});

export function resetShow() {
  showData.id = null;
  showData.perfLabel = 'Performance #—';
  showData.lockTime = null;
  showData.qlabNotified = false;
  showData.castMismatches = [];
}
