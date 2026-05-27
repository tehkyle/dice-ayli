export const sheetsData = $state({ badge: 'checking' }); // 'checking'|'configured'|'unconfigured'

export async function refreshBadge() {
  sheetsData.badge = 'checking';
  try {
    const statusRes = await fetch('/api/auth/google/status');
    const { connected } = await statusRes.json();
    if (!connected) { sheetsData.badge = 'unconfigured'; return; }
    const cfgRes = await fetch('/api/config/sheets');
    const cfg = await cfgRes.json();
    sheetsData.badge = (cfg.spreadsheetId && cfg.sheetTabName) ? 'configured' : 'unconfigured';
  } catch {
    sheetsData.badge = 'unconfigured';
  }
}
