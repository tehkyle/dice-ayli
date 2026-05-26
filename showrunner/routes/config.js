const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const { readSheetsConfig, saveSheetTarget } = require('../integrations/sheetsConfig');

const CONFIG_PATH = path.join(__dirname, '../config.json');

router.get('/', (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    res.json(config);
  } catch (err) {
    console.error(`[CONFIG] Failed to read config.json: ${err.message}`);
    res.status(500).json({ error: 'Could not load config.json' });
  }
});

// GET /api/config/sheets — current sheets config (tokens excluded)
router.get('/sheets', (req, res) => {
  const { tokens: _tokens, ...safe } = readSheetsConfig();
  res.json(safe);
});

// POST /api/config/sheets — save spreadsheet target
router.post('/sheets', (req, res) => {
  const { spreadsheetId, spreadsheetName, sheetTabName } = req.body;
  if (!spreadsheetId || !sheetTabName) {
    return res.status(400).json({ error: 'spreadsheetId and sheetTabName are required' });
  }
  saveSheetTarget({ spreadsheetId, spreadsheetName: spreadsheetName || '', sheetTabName });
  res.json({ success: true });
});

module.exports = router;
