import { api } from '../lib/api.js';

// General app settings, kept separate from configData (show content) since
// this can be toggled mid-session via the Settings dialog and must always
// read fresh rather than being cached for the life of the app.
export const settingsData = $state({ rehearsalMode: false });

export async function loadGeneralSettings() {
  try {
    const cfg = await api.getConfig();
    settingsData.rehearsalMode = !!cfg.rehearsalMode;
  } catch {}
}
