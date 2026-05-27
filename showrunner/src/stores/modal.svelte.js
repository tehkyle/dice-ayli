export const modalState = $state({ open: false });
export function openModal() { modalState.open = true; }
export function closeModal() { modalState.open = false; }
