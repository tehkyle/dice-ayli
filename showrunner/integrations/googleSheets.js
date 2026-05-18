const fs   = require('fs');
const path = require('path');

// Lazily required so the server starts fine even without googleapis installed
// or credentials configured. All errors are caught and logged, never thrown.

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
}

function timestamp() {
  return new Date().toISOString();
}

/**
 * Append one row to the configured Google Sheet for a completed show.
 *
 * Row format:
 *   Date | Perf # | Lock Time | <one col per track in config order> | <one col per act: scenes played in order>
 *
 * Required env vars:
 *   GOOGLE_SPREADSHEET_ID          — the spreadsheet ID from the URL
 *   GOOGLE_SERVICE_ACCOUNT_KEY_FILE — path to the downloaded service account JSON key
 *
 * Setup (one-time):
 *   1. Google Cloud Console → enable Google Sheets API
 *   2. Create service account → download JSON key
 *   3. Share the spreadsheet with the service account email (Editor)
 *   4. Set the env vars above in .env
 *
 * @param {Object}   show             — show record from DB
 * @param {Object[]} castAssignments  — [{ character_track, actor_name }]
 * @param {Object[]} scenesPlayed     — [{ scene_name, timestamp }] sorted by time
 */
async function appendShowToSheet(show, castAssignments, scenesPlayed) {
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
  const keyFile       = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE;

  if (!spreadsheetId || !keyFile) {
    console.warn('[Sheets] GOOGLE_SPREADSHEET_ID or GOOGLE_SERVICE_ACCOUNT_KEY_FILE not set — skipping export');
    return;
  }

  const { google } = require('googleapis');
  const config = loadConfig();

  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(keyFile),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  // Build cast columns in config track order
  const castMap = {};
  castAssignments.forEach(a => { castMap[a.character_track] = a.actor_name; });
  const castColumns = (config.characterTracks || []).map(t => castMap[t.id] || '');

  // Build scene columns — one per act, scenes joined by " → "
  const actIds = (config.acts || []).map(a => a.id);
  const actSceneColumns = actIds.map(actId => {
    const actScenes = scenesPlayed.filter(e => {
      // Match scenes belonging to this act by the act's scene list
      const act = (config.acts || []).find(a => a.id === actId);
      return act && act.scenes.includes(e.scene_name);
    });
    return actScenes.map(e => e.scene_name).join(' → ');
  });

  const lockTime = show.locked_at
    ? new Date(show.locked_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : '';

  const row = [
    show.show_date,
    show.performance_number,
    lockTime,
    ...castColumns,
    ...actSceneColumns,
  ];

  console.log(`[Sheets] ${timestamp()} Appending row for show ${show.id}: ${row.join(' | ')}`);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'Sheet1!A1',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row] },
  });

  console.log(`[Sheets] ${timestamp()} Row appended successfully`);
}

module.exports = { appendShowToSheet };
