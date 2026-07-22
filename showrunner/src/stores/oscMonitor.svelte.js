export const oscMonitorState = $state({ open: false });
export function openOscMonitor()  { oscMonitorState.open = true; }
export function closeOscMonitor() { oscMonitorState.open = false; }
