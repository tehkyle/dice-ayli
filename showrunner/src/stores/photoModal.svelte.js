export const photoModalState = $state({ open: false });
export function openPhotoModal() { photoModalState.open = true; }
export function closePhotoModal() { photoModalState.open = false; }

// Shared across PhotoBadge (dot indicator) and PhotoModal (controls) so the
// badge reflects window state even while the modal itself isn't mounted.
export const photoWindowState = $state({ open: false, count: 0 });
