// castData.selections: { [trackId]: actorName|'' }
export const castData = $state({ selections: {} });

export function initCastFromTracks(tracks) {
  castData.selections = Object.fromEntries(tracks.map(t => [t.id, '']));
}

const SINGER_TRACK = 'Track_Singer';

export function randomizeCast(actors) {
  const taken = new Set(Object.values(castData.selections).filter(Boolean));
  const unfilled = Object.keys(castData.selections).filter(k => !castData.selections[k]);

  // Fill every unfilled track except the Singer from a shuffled pool of unique,
  // not-yet-used actors — DJ gets a real slot here too, same as the 6 regular tracks.
  const uniqueUnfilled = unfilled.filter(id => id !== SINGER_TRACK);
  const pool = actors.filter(a => !taken.has(a.name)).map(a => a.name);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  uniqueUnfilled.forEach((trackId, i) => {
    if (i < pool.length) castData.selections[trackId] = pool[i];
  });

  // Singer is a double role — pick one of the now-filled other tracks' actors
  // (DJ included) rather than handing them a separate unique slot.
  if (unfilled.includes(SINGER_TRACK)) {
    const candidates = Object.entries(castData.selections)
      .filter(([trackId, actor]) => actor && trackId !== SINGER_TRACK)
      .map(([, actor]) => actor);
    if (candidates.length > 0) {
      castData.selections[SINGER_TRACK] = candidates[Math.floor(Math.random() * candidates.length)];
    }
  }
}

