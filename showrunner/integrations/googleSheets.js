const fs   = require('fs');
const path = require('path');

const { getTokens, saveTokens, readSheetsConfig } = require('./sheetsConfig');

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
}

function timestamp() {
  return new Date().toISOString();
}

function buildAuth() {
  const tokens = getTokens();
  if (!tokens) throw new Error('[Sheets] No OAuth tokens — connect Google account via the config modal');

  const { google } = require('googleapis');
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', (newTokens) => {
    saveTokens({ ...tokens, ...newTokens });
    console.log(`[Sheets] ${timestamp()} Tokens refreshed and persisted`);
  });
  return oauth2Client;
}

/**
 * Append one row to the configured Google Sheet for a completed show.
 *
 * Row format:
 *   Perf # | Date | Start Time | Run Time | <one col per track in config order> | <one col per act: scenes played in order>
 *
 * Configure spreadsheet and tab via the Google Sheets gear icon in the UI.
 *
 * @param {Object}   show             — show record from DB
 * @param {Object[]} castAssignments  — [{ character_track, actor_name }]
 * @param {Object[]} scenesPlayed     — [{ scene_name, timestamp }] sorted by time
 */
async function appendShowToSheet(show, performanceNumber, castAssignments, scenesPlayed) {
  let auth;
  try {
    auth = buildAuth();
  } catch (err) {
    console.warn(err.message);
    return;
  }

  const sheetsConfig  = readSheetsConfig();
  const spreadsheetId = sheetsConfig.spreadsheetId;
  const sheetTabName  = sheetsConfig.sheetTabName || 'Sheet1';

  if (!spreadsheetId) {
    console.warn('[Sheets] No spreadsheetId configured — skipping export. Select a spreadsheet in the config modal.');
    return;
  }

  const { google } = require('googleapis');
  const config = loadConfig();
  const sheets = google.sheets({ version: 'v4', auth });

  // Build cast columns in config track order
  const castMap = {};
  castAssignments.forEach(a => { castMap[a.character_track] = a.actor_name; });
  const castColumns = (config.characterTracks || []).map(t => castMap[t.id] || '');

  // Build scene columns — one per act, scenes joined by " → "
  const actIds = (config.acts || []).map(a => a.id);
  const actSceneColumns = actIds.map(actId => {
    const actScenes = scenesPlayed.filter(e => {
      const act = (config.acts || []).find(a => a.id === actId);
      return act && act.scenes.includes(e.scene_name);
    });
    return actScenes.map(e => e.scene_name).join(' → ');
  });

  const startTime = show.locked_at
    ? new Date(show.locked_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  let runTime = '';
  if (show.locked_at && show.ended_at) {
    const totalSec = Math.round((new Date(show.ended_at) - new Date(show.locked_at)) / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    runTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const row = [
    performanceNumber,
    show.show_date,
    startTime,
    runTime,
    ...castColumns,
    ...actSceneColumns,
  ];

  // Auto-write header row if A1 is empty
  const headerCheck = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetTabName}!A1`,
  });
  const hasHeader = !!(headerCheck.data.values && headerCheck.data.values[0] && headerCheck.data.values[0][0]);
  if (!hasHeader) {
    const trackHeaders = (config.characterTracks || []).map(t => t.label);
    const actHeaders   = (config.acts || []).map(a => a.label);
    const headerRow = ['Perf #', 'Date', 'Start Time', 'Run Time', ...trackHeaders, ...actHeaders];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range:            `${sheetTabName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody:      { values: [headerRow] },
    });
    console.log(`[Sheets] ${timestamp()} Header row written to "${sheetTabName}"`);
  }

  console.log(`[Sheets] ${timestamp()} Appending row for show ${show.id} to "${sheetTabName}": ${row.join(' | ')}`);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range:            `${sheetTabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody:      { values: [row] },
  });

  console.log(`[Sheets] ${timestamp()} Row appended successfully`);
}

module.exports = { appendShowToSheet };
