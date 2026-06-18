import { castData } from './cast.svelte.js';

// Names of actors marked unavailable for this performance — resets each new show.
export const availabilityData = $state({ unavailable: new Set() });

export function initAvailability() {
  availabilityData.unavailable = new Set();
}

export function toggleAvailability(actorName) {
  // Reassign rather than mutate in place — derived values reading .size/.has()
  // don't reliably re-run off in-place Set mutation, but always do off a fresh value.
  const next = new Set(availabilityData.unavailable);
  if (next.has(actorName)) {
    next.delete(actorName);
  } else {
    next.add(actorName);
    // An actor just marked unavailable can't stay assigned to a track.
    for (const trackId of Object.keys(castData.selections)) {
      if (castData.selections[trackId] === actorName) castData.selections[trackId] = '';
    }
  }
  availabilityData.unavailable = next;
}
