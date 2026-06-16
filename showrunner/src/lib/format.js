export const MAX_SHOW_RUN_MS = 3 * 60 * 60 * 1000; // ponytail: 3h cutoff for "abandoned" shows, raise if a real show ever runs longer

export function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function formatTime(isoStr) {
  return new Date(isoStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function formatRunTime(startIso, endIso) {
  const totalMins = Math.round((new Date(endIso) - new Date(startIso)) / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatDuration(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// m:ss — for reports, spreadsheet TSV output, and history cards
export function formatDurationReport(ms) {
  if (ms == null || ms < 0) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function actorImageUrl(image) {
  return image ? `/images/actors/${image}` : null;
}

// YYYY-MM-DD from a Date object — used for show_date fields and day filtering
export function toIsoDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Format the next-cue display string for the progress screen
export function formatCueDisplay(cueNumber, cueName) {
  if (!cueName && !cueNumber) return '-';
  return cueNumber ? `${cueNumber} - ${cueName}` : cueName;
}
