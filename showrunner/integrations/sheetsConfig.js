const fs   = require('fs');
const path = require('path');

const SHEETS_CONFIG_PATH = path.join(__dirname, '../sheets-config.json');

const DEFAULTS = {
  spreadsheetId:   null,
  spreadsheetName: null,
  sheetTabName:    null,
  userEmail:       null,
  tokens:          null,
};

function readSheetsConfig() {
  try {
    const raw = fs.readFileSync(SHEETS_CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeSheetsConfig(data) {
  const current = readSheetsConfig();
  const merged  = { ...current, ...data };
  fs.writeFileSync(SHEETS_CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8');
}

function getTokens() {
  return readSheetsConfig().tokens;
}

function saveTokens(tokens) {
  writeSheetsConfig({ tokens });
}

function clearTokens() {
  writeSheetsConfig({ tokens: null, userEmail: null });
}

function getSheetTarget() {
  const { spreadsheetId, sheetTabName } = readSheetsConfig();
  return { spreadsheetId, sheetTabName };
}

function saveSheetTarget({ spreadsheetId, spreadsheetName, sheetTabName }) {
  writeSheetsConfig({ spreadsheetId, spreadsheetName, sheetTabName });
}

module.exports = {
  readSheetsConfig,
  writeSheetsConfig,
  getTokens,
  saveTokens,
  clearTokens,
  getSheetTarget,
  saveSheetTarget,
};
