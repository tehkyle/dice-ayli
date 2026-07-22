export const cameraQrModalState = $state({ open: false });

export function openCameraQrModal() { cameraQrModalState.open = true; }
export function closeCameraQrModal() { cameraQrModalState.open = false; }
