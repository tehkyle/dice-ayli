const express    = require('express');
const router     = express.Router();
const { google } = require('googleapis');

const { getTokens, saveTokens } = require('../integrations/sheetsConfig');
const { buildOAuthClient } = require('../utils');

function buildAuthenticatedClient(req) {
  const tokens = getTokens();
  if (!tokens) {
    const err = new Error('not_authenticated');
    err.status = 401;
    throw err;
  }
  const oauth2Client = buildOAuthClient(req);
  oauth2Client.setCredentials(tokens);
  oauth2Client.on('tokens', (newTokens) => saveTokens({ ...tokens, ...newTokens }));
  return oauth2Client;
}

// GET /api/sheets/list — list user's spreadsheets from Drive
router.get('/list', async (req, res) => {
  let oauth2Client;
  try {
    oauth2Client = buildAuthenticatedClient(req);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
  try {
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    const { data } = await drive.files.list({
      q:        "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      fields:   'files(id,name)',
      orderBy:  'modifiedTime desc',
      pageSize: 50,
    });
    res.json(data.files || []);
  } catch (err) {
    console.error('[Sheets] Drive list error:', err.message);
    res.status(500).json({ error: 'Failed to list spreadsheets' });
  }
});

// GET /api/sheets/:id/tabs — list tab names in a spreadsheet
router.get('/:id/tabs', async (req, res) => {
  let oauth2Client;
  try {
    oauth2Client = buildAuthenticatedClient(req);
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
  try {
    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    const { data } = await sheets.spreadsheets.get({
      spreadsheetId: req.params.id,
      fields: 'sheets.properties.title',
    });
    res.json((data.sheets || []).map(s => s.properties.title));
  } catch (err) {
    console.error('[Sheets] Tab list error:', err.message);
    res.status(500).json({ error: 'Failed to list tabs' });
  }
});

module.exports = router;
