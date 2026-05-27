export const configData = $state({
  actors: [],
  characterTracks: [],
  acts: [],
  loaded: false,
});

export async function loadConfig() {
  if (configData.loaded) return;
  const res = await fetch('/api/config');
  const cfg = await res.json();
  configData.actors = [...cfg.actors].sort((a, b) => a.name.localeCompare(b.name));
  configData.characterTracks = cfg.characterTracks;
  configData.acts = (cfg.acts || []).filter(a => a.scenes && a.scenes.length > 0);
  configData.loaded = true;
}
