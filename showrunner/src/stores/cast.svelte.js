// castData.selections: { [trackId]: actorName|'' }
export const castData = $state({ selections: {} });

export function initCastFromTracks(tracks) {
  castData.selections = Object.fromEntries(tracks.map(t => [t.id, '']));
}

export function randomizeCast(actors) {
  const taken = new Set(Object.values(castData.selections).filter(Boolean));
  const unfilled = Object.keys(castData.selections).filter(k => !castData.selections[k]);
  const pool = actors.filter(a => !taken.has(a.name)).map(a => a.name);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  unfilled.forEach((trackId, i) => {
    if (i < pool.length) castData.selections[trackId] = pool[i];
  });
}
