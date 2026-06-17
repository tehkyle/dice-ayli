export const historyGalleryState = $state({ open: false, showId: null });

export function openHistoryGallery(id) {
  historyGalleryState.showId = id;
  historyGalleryState.open = true;
}

export function closeHistoryGallery() {
  historyGalleryState.open = false;
}
