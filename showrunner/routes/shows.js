const express = require('express');
const router  = express.Router();
const { getDb, nextId } = require('../db/database');
const { sendCastToQLab, sendScenesToQLab, sendPhotosPathToQLab, setActiveShow, endShow } = require('../osc/qlabBridge');
const { formatShow, getCameraUrl } = require('../utils');

function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// POST /api/shows — create a new show record
router.post('/', (req, res) => {
  const db    = getDb();
  const today = localDateString();
  const { notes } = req.body || {};

  const id = nextId(db.data.shows);
  db.data.shows.push({ id, show_date: today, locked_at: null, notes: notes || null });
  db.write();

  const sorted = [...db.data.shows].sort((a, b) => a.id - b.id);
  const performance_number = sorted.findIndex(s => s.id === id) + 1;
  res.json({ id, show_date: today, performance_number });
});

// POST /api/shows/:id/cast — lock cast + scenes, save, send OSC
router.post('/:id/cast', async (req, res) => {
  const db     = getDb();
  const showId = parseInt(req.params.id, 10);
  const { cast, scenes, scenesOrdered } = req.body || {};

  if (!cast || typeof cast !== 'object') {
    return res.status(400).json({ error: 'cast object required' });
  }

  // DJ requires a unique actor; the Singer is a double role and may share with any
  // other track except DJ. Any other repeated actor is a real duplicate.
  const byActor = {};
  for (const [track, actor] of Object.entries(cast)) {
    (byActor[actor] ??= []).push(track);
  }
  for (const tracks of Object.values(byActor)) {
    if (tracks.length < 2) continue;
    const isAllowedPair = tracks.length === 2
      && tracks.includes('Track_Singer')
      && !tracks.includes('Track_DJ');
    if (!isAllowedPair) {
      return res.status(400).json({ error: 'Duplicate actor assignments are not allowed' });
    }
  }

  const show = db.data.shows.find(s => s.id === showId);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  // Write to DB first — OSC failure must never block the save
  db.data.cast_assignments = db.data.cast_assignments.filter(a => a.show_id !== showId);
  for (const [character_track, actor_name] of Object.entries(cast)) {
    db.data.cast_assignments.push({ id: nextId(db.data.cast_assignments), show_id: showId, character_track, actor_name });
  }
  show.scenes        = scenes || null;
  show.scenesOrdered = scenesOrdered || null;
  show.locked_at     = new Date().toISOString();

  // Operators' phones need the upload window open as soon as the show is running,
  // which is this moment — cast gets assigned minutes into the live show, not before it.
  if (!show.photo_window_open) {
    show.photo_window_open      = true;
    show.photo_window_opened_at = show.locked_at;
  }
  db.write();

  setActiveShow(showId);

  let qlabNotified   = false;
  let castMismatches = Object.keys(cast);
  try {
    const castResult = await sendCastToQLab(cast, { fireConfirm: true });
    castMismatches   = castResult.mismatches;
    let scenesOk     = true;
    if (scenes && typeof scenes === 'object') {
      scenesOk = await sendScenesToQLab(scenes, scenesOrdered || {});
    }
    const photosPathOk = await sendPhotosPathToQLab(showId);
    qlabNotified = castResult.synced && scenesOk && photosPathOk;
  } catch (err) {
    console.error(`[OSC ERR] sendCastToQLab threw: ${err.message}`);
  }

  res.json({ success: true, qlabNotified, castMismatches, camera_url: getCameraUrl() });
});

// POST /api/shows/:id/end — force-end a show and trigger the Sheets report
router.post('/:id/end', (req, res) => {
  endShow(parseInt(req.params.id, 10));
  res.json({ success: true });
});

// POST /api/shows/:id/cancel — mark a show ended without writing to Sheets
router.post('/:id/cancel', (req, res) => {
  const db     = getDb();
  const showId = parseInt(req.params.id, 10);
  if (isNaN(showId)) return res.status(400).json({ error: 'Invalid show ID' });
  const show = db.data.shows.find(s => s.id === showId);
  if (!show) return res.status(404).json({ error: 'Show not found' });
  if (!show.ended_at) {
    show.ended_at = new Date().toISOString();
    show.photo_window_open      = false;
    show.photo_window_closed_at = show.ended_at;
    db.write();
  }
  setActiveShow(null);
  res.json({ success: true });
});

// DELETE /api/shows/:id — remove a show and its cast assignments
router.delete('/:id', (req, res) => {
  const db     = getDb();
  const showId = parseInt(req.params.id, 10);
  const idx    = db.data.shows.findIndex(s => s.id === showId);
  if (idx === -1) return res.status(404).json({ error: 'Show not found' });

  db.data.shows.splice(idx, 1);
  db.data.cast_assignments = db.data.cast_assignments.filter(a => a.show_id !== showId);
  db.write();
  res.json({ success: true });
});

// DELETE /api/shows — remove all shows and cast assignments
router.delete('/', (req, res) => {
  const db = getDb();
  db.data.shows = [];
  db.data.cast_assignments = [];
  db.write();
  res.json({ success: true });
});

// GET /api/shows — all shows with cast and scene log, newest first
// performance_number is each show's 1-based rank when sorted by id
router.get('/', (req, res) => {
  const db     = getDb();
  const sorted = [...db.data.shows].sort((a, b) => a.id - b.id);
  res.json(sorted.map(show => formatShow(show, sorted, db)).reverse());
});

// GET /api/shows/active — most recent show that is locked but not yet ended
router.get('/active', (req, res) => {
  const db     = getDb();
  const sorted = [...db.data.shows].sort((a, b) => a.id - b.id);
  const active = [...sorted].reverse().find(s => s.locked_at && !s.ended_at);
  if (!active) return res.json(null);
  res.json(formatShow(active, sorted, db));
});

// POST /api/shows/:id/photo-window/open — let operator phones start uploading
router.post('/:id/photo-window/open', (req, res) => {
  const db     = getDb();
  const showId = parseInt(req.params.id, 10);
  const show   = db.data.shows.find(s => s.id === showId);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  show.photo_window_open      = true;
  show.photo_window_opened_at = new Date().toISOString();
  show.photo_window_closed_at = null;
  db.write();

  res.json({
    success:        true,
    show_id:        showId,
    window_open_at: show.photo_window_opened_at,
    camera_url:     getCameraUrl(),
  });
});

// POST /api/shows/:id/photo-window/close — stop accepting uploads
router.post('/:id/photo-window/close', (req, res) => {
  const db     = getDb();
  const showId = parseInt(req.params.id, 10);
  const show   = db.data.shows.find(s => s.id === showId);
  if (!show) return res.status(404).json({ error: 'Show not found' });

  show.photo_window_open      = false;
  show.photo_window_closed_at = new Date().toISOString();
  db.write();

  res.json({ success: true, photos_received: db.data.photos.filter(p => p.show_id === showId).length });
});

// GET /api/shows/:id/photo-window/status — polled by the operator camera page,
// and used by the SM panel to redisplay the QR after reopening its modal.
router.get('/:id/photo-window/status', (req, res) => {
  const db     = getDb();
  const showId = parseInt(req.params.id, 10);
  const show   = db.data.shows.find(s => s.id === showId);
  if (!show) return res.json({ open: false });

  res.json({ open: !!show.photo_window_open, show_id: showId, camera_url: getCameraUrl() });
});

// GET /api/shows/latest — most recent show that hasn't ended yet (locked or not).
// Used by the camera page when opened from a saved home-screen icon rather than a
// freshly-scanned per-show QR code, so a reused icon resolves to whatever show is
// current instead of a stale one baked into a URL.
router.get('/latest', (req, res) => {
  const db     = getDb();
  const latest = [...db.data.shows].sort((a, b) => b.id - a.id).find(s => !s.ended_at);
  res.json(latest ? { id: latest.id } : null);
});

// GET /api/shows/today — today's shows only
router.get('/today', (req, res) => {
  const db     = getDb();
  const today  = localDateString();
  const sorted = [...db.data.shows].sort((a, b) => a.id - b.id);
  res.json(sorted.filter(s => s.show_date === today).map(show => formatShow(show, sorted, db)));
});

module.exports = router;
