const express = require('express');
const router  = express.Router();
const { google } = require('googleapis');

const {
  readSheetsConfig,
  writeSheetsConfig,
  saveTokens,
  clearTokens,
} = require('../integrations/sheetsConfig');

const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

function buildOAuthClient(req) {
  const proto       = req.headers['x-forwarded-proto'] || req.protocol;
  const host        = req.headers['x-forwarded-host']  || req.headers.host;
  const redirectUri = `${proto}://${host}/api/auth/google/callback`;
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri
  );
}

// GET /api/auth/google — start OAuth flow
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return res.status(500).send(
      'OAuth not configured — set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env'
    );
  }
  const oauth2Client = buildOAuthClient(req);
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt:      'consent',
    scope:       SCOPES,
  });
  res.redirect(url);
});

// GET /api/auth/google/callback — exchange code, save tokens
router.get('/google/callback', async (req, res) => {
  if (req.query.error) {
    return res.redirect('/?sheets_config=1&auth_error=1');
  }
  try {
    const oauth2Client = buildOAuthClient(req);
    const { tokens }   = await oauth2Client.getToken(req.query.code);
    oauth2Client.setCredentials(tokens);

    const oauth2Info = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data }   = await oauth2Info.userinfo.get();

    saveTokens(tokens);
    writeSheetsConfig({ userEmail: data.email || null });

    res.redirect('/?sheets_config=1');
  } catch (err) {
    console.error('[Auth] OAuth callback error:', err.message);
    res.redirect('/?sheets_config=1&auth_error=1');
  }
});

// GET /api/auth/google/status — connection status
router.get('/google/status', (req, res) => {
  const cfg = readSheetsConfig();
  res.json({
    connected: !!(cfg.tokens && cfg.tokens.refresh_token),
    email:     cfg.userEmail || null,
  });
});

// DELETE /api/auth/google — disconnect
router.delete('/google', (req, res) => {
  clearTokens();
  res.json({ success: true });
});

module.exports = router;
