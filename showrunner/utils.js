const { google } = require('googleapis');

// Builds an unauthenticated OAuth2 client from the current request context.
// Used by both the auth flow and the authenticated sheets client.
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
  };
}

// Extracts a QLab workspace ID from an OSC reply body.
// QLab returns it either at the top level or inside data[0] for /workspaces replies.
function extractWorkspaceId(body) {
  if (body?.workspace_id) return body.workspace_id;
  if (Array.isArray(body?.data) && body.data[0]?.workspace_id) return body.data[0].workspace_id;
  return null;
}

module.exports = { buildOAuthClient, formatShow, extractWorkspaceId };
