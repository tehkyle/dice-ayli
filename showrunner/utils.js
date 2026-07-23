const os   = require('os');
const fs   = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CONFIG_PATH = path.join(__dirname, 'config.json');

function createOAuth2Client(redirectUri) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri
  );
}

// Builds an unauthenticated OAuth2 client from the current request context.
// Used by both the auth flow and the authenticated sheets client.
function buildOAuthClient(req) {
  const proto       = req.headers['x-forwarded-proto'] || req.protocol;
  const host        = req.headers['x-forwarded-host']  || req.headers.host;
  const redirectUri = `${proto}://${host}/api/auth/google/callback`;
  return createOAuth2Client(redirectUri);
}

// Enriches a show record with cast, scenes_played, and performance_number.
// allShows must be the full sorted-ascending array so performance_number is stable.
function formatShow(show, allShows, db) {
  const performance_number = allShows.findIndex(s => s.id === show.id) + 1;
  return {
    ...show,
    performance_number,
    cast: db.data.cast_assignments.filter(a => a.show_id === show.id),
    scenes_played: db.data.scene_log
      .filter(e => e.show_id === show.id)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
    photo_count: db.data.photos.filter(p => p.show_id === show.id).length,
  };
}

// Extracts a QLab workspace ID from an OSC reply body.
// QLab returns it either at the top level or inside data[0] for /workspaces replies.
function extractWorkspaceId(body) {
  if (body?.workspace_id) return body.workspace_id;
  if (Array.isArray(body?.data) && body.data[0]?.workspace_id) return body.data[0].workspace_id;
  return null;
}

// Stable per-show photo folder name, derived from when the show started
// rather than its numeric db id — ids restart from 1 after history is
// cleared, which would otherwise let a new show's photos land in (and
// collide with) an old show's leftover folder on disk. The show's own id
// is appended only as a tiebreaker for two shows starting the same second
// (automated tests; a human clicking "Begin Show" can't do this in practice).
function photoFolderName(show) {
  const started = show.started_at ? new Date(show.started_at) : new Date();
  const slug = started.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `${slug}-${show.id}`;
}

// Finds this machine's LAN-reachable IPv4 address so phones on the same WiFi can hit it.
// Falls back to localhost if no external interface is found (e.g. offline dev).
function getLanIp() {
  const interfaces = Object.values(os.networkInterfaces()).flat();
  const lan = interfaces.find(i => i.family === 'IPv4' && !i.internal);
  return lan ? lan.address : 'localhost';
}

// Builds the standing camera URL — no show id in it, so the same QR code/link
// works for every performance. The camera page resolves "current show" itself
// (GET /api/shows/latest) rather than being told which show via the URL.
function getCameraUrl() {
  let config = {};
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}

  const host = config.cameraHostname || getLanIp();
  const port = parseInt(process.env.PORT, 10) || 3000;
  return `http://${host}:${port}/camera`;
}

module.exports = { buildOAuthClient, createOAuth2Client, formatShow, extractWorkspaceId, getLanIp, getCameraUrl, photoFolderName };
