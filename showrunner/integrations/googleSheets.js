const fs   = require('fs');
const path = require('path');

const { getTokens, saveTokens, readSheetsConfig } = require('./sheetsConfig');
const { createOAuth2Client } = require('../utils');

function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
}

function timestamp() {
  return new Date().toISOString();
}

// The column shape is derived from config's acts/scenes/tracks, so it must be
// rebuilt from the SAME config every time — never hand-edited independently of
// the row-building logic below, or the two will drift out of sync with each other.
function buildHeaderRow(config) {
  const trackHeaders = (config.characterTracks || []).map(t => t.label);
  const sceneHeaders = [];
  for (const act of (config.acts || [])) {
    sceneHeaders.push(`${act.label} Order`);
    for (const sceneName of act.scenes) sceneHeaders.push(sceneName);
  }
  const staticHeaders = config.staticScenes || [];
  return ['Date', 'Start Time', 'Run Time', 'Showrunner', ...trackHeaders, 'Intro/Dicing', ...sceneHeaders, ...staticHeaders];
}

function buildAuth() {
  const tokens = getTokens();
  if (!tokens) throw new Error('[Sheets] No OAuth tokens — connect Google account via the config modal');

  const oauth2Client = createOAuth2Client('urn:ietf:wg:oauth:2.0:oob');
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
 * Returns { success: boolean, tsvRow: string } if sheets is configured,
 * or null if sheets is not configured (no tokens / no spreadsheet).
 * tsvRow is a human-readable tab-separated fallback for manual pasting.
 */
async function appendShowToSheet(show, performanceNumber, castAssignments, scenesPlayed) {
  let auth;
  try {
    auth = buildAuth();
  } catch (err) {
    console.warn(err.message);
    return null; // not configured — no error to surface
  }

  const sheetsConfig     = readSheetsConfig();
  const spreadsheetId    = sheetsConfig.spreadsheetId;
  const sheetTabName     = sheetsConfig.sheetTabName || 'Sheet1';
  const showrunnerEmail  = sheetsConfig.userEmail || '';

  if (!spreadsheetId) {
    console.warn('[Sheets] No spreadsheetId configured — skipping export. Select a spreadsheet in the config modal.');
    return null; // not configured
  }

  const { google } = require('googleapis');
  const config = loadConfig();
  const sheets = google.sheets({ version: 'v4', auth });

  // Build cast columns in config track order
  const castMap = {};
  castAssignments.forEach(a => { castMap[a.character_track] = a.actor_name; });
  const castColumns = (config.characterTracks || []).map(t => castMap[t.id] || '');

  // Duration as a Sheets time serial (for column formatting + AVERAGE formulas)
  // or as a human-readable m:ss string for the clipboard TSV fallback.
  function durationCell(entry, { tsv = false } = {}) {
    if (!entry || entry.duration_ms == null) return '';
    if (tsv) {
      const totalSec = Math.round(entry.duration_ms / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      return `${m}:${String(s).padStart(2, '0')}`;
    }
    return entry.duration_ms / 86400000;
  }

  // Per act: one order column + one duration column per possible scene
  const actSceneColumns    = [];
  const actSceneColumnsTsv = [];
  for (const act of (config.acts || [])) {
    const actScenes = scenesPlayed.filter(e => act.scenes.includes(e.scene_name));
    const orderStr  = actScenes.map(e => e.scene_name).join(' → ');
    actSceneColumns.push(orderStr);
    actSceneColumnsTsv.push(orderStr);
    for (const sceneName of act.scenes) {
      const entry = actScenes.find(e => e.scene_name === sceneName);
      actSceneColumns.push(durationCell(entry));
      actSceneColumnsTsv.push(durationCell(entry, { tsv: true }));
    }
  }

  // Static scenes (Entr'acte, Finale, etc.) — one duration column each
  const staticSceneColumns    = (config.staticScenes || []).map(n => durationCell(scenesPlayed.find(e => e.scene_name === n)));
  const staticSceneColumnsTsv = (config.staticScenes || []).map(n => durationCell(scenesPlayed.find(e => e.scene_name === n), { tsv: true }));

  const startTime = show.started_at
    ? new Date(show.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '';

  let runTime = '';
  if (show.started_at && show.ended_at) {
    const totalSec = Math.round((new Date(show.ended_at) - new Date(show.started_at)) / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    runTime = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const showDate = show.show_date
    ? new Date(show.show_date + 'T12:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : '';

  // Time from "Begin Show" to the first scene's Go — cast dicing plus any
  // house/curtain announcements, before the audience sees the first scene.
  const firstScene = scenesPlayed[0];
  const introDicingEntry = (show.started_at && firstScene)
    ? { duration_ms: new Date(firstScene.timestamp) - new Date(show.started_at) }
    : null;

  const row = [
    showDate ? `'${showDate}` : '',
    startTime,
    runTime,
    showrunnerEmail,
    ...castColumns,
    durationCell(introDicingEntry),
    ...actSceneColumns,
    ...staticSceneColumns,
  ];

  // Human-readable TSV for clipboard fallback — no Sheets tricks, durations as m:ss
  const tsvRow = [showDate, startTime, runTime, showrunnerEmail, ...castColumns, durationCell(introDicingEntry, { tsv: true }), ...actSceneColumnsTsv, ...staticSceneColumnsTsv].join('\t');

  try {
    const expectedHeader = buildHeaderRow(config);

    // Full row, not just A1 — a single-cell check can't tell "no header yet"
    // apart from "header written for a since-changed act/scene list."
    const headerCheck = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetTabName}!1:1`,
    });
    const existingHeader = headerCheck.data.values?.[0] ?? [];

    if (existingHeader.length === 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range:            `${sheetTabName}!A1`,
        valueInputOption: 'RAW',
        requestBody:      { values: [expectedHeader] },
      });
      console.log(`[Sheets] ${timestamp()} Header row written to "${sheetTabName}"`);

      await applyColumnFormats(sheets, spreadsheetId, sheetTabName, config);
    } else if (existingHeader.length !== expectedHeader.length || !existingHeader.every((c, i) => c === expectedHeader[i])) {
      // An act's scene list changed (e.g. a scene was added/removed) after this
      // sheet's header was written. Appending now would silently shift every
      // later column out from under its label — refuse instead, so the operator
      // fixes the sheet by hand (new tab, or edit the header + realign columns)
      // rather than getting quietly corrupted data.
      console.error(`[Sheets ERR] ${timestamp()} Header in "${sheetTabName}" doesn't match the current scene config — refusing to append. Expected: [${expectedHeader.join(', ')}] — Actual: [${existingHeader.join(', ')}]`);
      return { success: false, tsvRow };
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
    return { success: true, tsvRow };

  } catch (err) {
    console.error(`[Sheets ERR] ${timestamp()} Failed to write to sheet: ${err.message}`);
    return { success: false, tsvRow };
  }
}

/**
 * Set number formats on time/duration columns so values display correctly
 * without the user needing to manually format them.
 */
async function applyColumnFormats(sheets, spreadsheetId, sheetTabName, config) {
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: 'sheets.properties',
    });
    const sheetId = meta.data.sheets.find(s => s.properties.title === sheetTabName)?.properties.sheetId;
    if (sheetId == null) return;

    let col = 0;
    col++;                                             // Date
    const startTimeCol = col++;                        // Start Time
    const runTimeCol   = col++;                        // Run Time
    col++;                                             // Showrunner
    col += (config.characterTracks || []).length;      // Cast columns
    const introDicingCol = col++;                       // Intro/Dicing

    const durationCols = [introDicingCol];
    for (const act of (config.acts || [])) {
      col++;                                           // Order column (text)
      for (const _ of act.scenes) durationCols.push(col++);
    }
    for (const _ of (config.staticScenes || [])) durationCols.push(col++);

    function colRange(colIdx) {
      return { sheetId, startColumnIndex: colIdx, endColumnIndex: colIdx + 1 };
    }
    function timeFormat(pattern) {
      return { userEnteredFormat: { numberFormat: { type: 'TIME', pattern } } };
    }

    const requests = [
      { repeatCell: { range: colRange(startTimeCol), cell: timeFormat('h:mm:ss AM/PM'),  fields: 'userEnteredFormat.numberFormat' } },
      { repeatCell: { range: colRange(runTimeCol),   cell: timeFormat('[h]:mm:ss'),       fields: 'userEnteredFormat.numberFormat' } },
      ...durationCols.map(c => ({
        repeatCell: { range: colRange(c), cell: timeFormat('[m]:ss'), fields: 'userEnteredFormat.numberFormat' },
      })),
    ];

    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
    console.log(`[Sheets] ${timestamp()} Column formats applied`);
  } catch (err) {
    console.warn(`[Sheets] ${timestamp()} Could not apply column formats: ${err.message}`);
  }
}

module.exports = { appendShowToSheet, buildHeaderRow };
