const express    = require('express');
const router     = express.Router();
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const archiver   = require('archiver');
const extractZip = require('extract-zip');
const multer     = require('multer');
const { getDb, nextId } = require('../db/database');
const { sendCastToQLab, sendScenesToQLab, sendPhotosPathToQLab, setActiveShow, endShow } = require('../osc/qlabBridge');
const { formatShow, getCameraUrl } = require('../utils');
const { DATA_DIR } = require('../dataDir');

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 1024 * 1024 * 1024 }, // a history export can carry a whole season of photos
});

function localDateString(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The Singer is a double role and may share with any other single track,
// DJ included. Any other repeated actor (two non-Singer tracks, or 3+
// tracks) is a real duplicate.
function hasIllegalDuplicateActor(cast) {
  const byActor = {};
  for (const [track, actor] of Object.entries(cast)) {
    (byActor[actor] ??= []).push(track);
  }
  return Object.values(byActor).some(tracks =>
    tracks.length > 1 && !(tracks.length === 2 && tracks.includes('Track_Singer'))
  );
}

// Fields formatShow()/the export route add on top of a raw show record —
// stripped back off on import so we don't store derived data as if it were real.
const DERIVED_SHOW_FIELDS = ['performance_number', 'cast', 'scenes_played', 'photo_count', 'photos'];

// Appends an exported history.json's shows (plus their cast, scene log, and
// photo records) onto whatever's already in the db, assigning each show a
// fresh id so imports never collide with — or overwrite — existing history.
// Returns a Map of the import file's old show ids to the new ones, so the
// caller can relocate the matching photo files on disk.
function importHistory(db, historyJson) {
  const idMap = new Map();

  for (const entry of historyJson) {
    const newId = nextId(db.data.shows);
    idMap.set(entry.id, newId);

    const show = { ...entry, id: newId };
    for (const field of DERIVED_SHOW_FIELDS) delete show[field];
    db.data.shows.push(show);

    for (const cast of entry.cast || []) {
      db.data.cast_assignments.push({ ...cast, id: nextId(db.data.cast_assignments), show_id: newId });
    }
    for (const logEntry of entry.scenes_played || []) {
      db.data.scene_log.push({ ...logEntry, id: nextId(db.data.scene_log), show_id: newId });
    }
    for (const photo of entry.photos || []) {
      db.data.photos.push({ ...photo, id: nextId(db.data.photos), show_id: newId });
    }
  }

  db.write();
  return idMap;
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

  if (hasIllegalDuplicateActor(cast)) {
    return res.status(400).json({ error: 'Duplicate actor assignments are not allowed' });
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

// GET /api/shows/export — every show (cast, scene log, notes) plus every
// photo, as one zip. Used by the "Export history" button on the history screen.
router.get('/export', (req, res) => {
  const db     = getDb();
  const sorted = [...db.data.shows].sort((a, b) => a.id - b.id);
  const shows  = sorted.map(show => ({
    ...formatShow(show, sorted, db),
    photos: db.data.photos
      .filter(p => p.show_id === show.id)
      .map(({ filename, uploaded_at }) => ({ filename, uploaded_at })),
  }));

  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="showrunner-history-${localDateString()}.zip"`,
  });

  const archive = archiver('zip');
  archive.on('error', err => res.status(500).end(err.message));
  archive.pipe(res);
  archive.append(JSON.stringify(shows, null, 2), { name: 'history.json' });
  for (const show of shows) {
    for (const { filename } of show.photos) {
      archive.file(path.join(DATA_DIR, 'photos', String(show.id), filename), { name: `photos/${show.id}/${filename}` });
    }
  }
  archive.finalize();
});

// POST /api/shows/import — restore shows, cast, scene log, and photos from
// a history.json zip produced by GET /api/shows/export. Always appends as
// new shows (never overwrites existing ones) — importing the same file
// twice will duplicate it.
router.post('/import', importUpload.single('archive'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'A history .zip file is required' });

  const workDir     = fs.mkdtempSync(path.join(os.tmpdir(), 'showrunner-import-'));
  const zipPath     = path.join(workDir, 'upload.zip');
  const extractDir  = path.join(workDir, 'extracted');
  const historyPath = path.join(extractDir, 'history.json');

  try {
    fs.writeFileSync(zipPath, req.file.buffer);
    await extractZip(zipPath, { dir: extractDir });

    if (!fs.existsSync(historyPath)) {
      return res.status(400).json({ error: 'Zip does not contain a history.json' });
    }

    const historyJson = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    const db          = getDb();
    const idMap       = importHistory(db, historyJson);

    for (const [oldId, newId] of idMap) {
      const srcDir = path.join(extractDir, 'photos', String(oldId));
      if (!fs.existsSync(srcDir)) continue;
      const destDir = path.join(DATA_DIR, 'photos', String(newId));
      fs.mkdirSync(destDir, { recursive: true });
      fs.cpSync(srcDir, destDir, { recursive: true });
    }

    res.json({ success: true, imported: idMap.size });
  } catch (err) {
    res.status(400).json({ error: `Import failed: ${err.message}` });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
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
module.exports.hasIllegalDuplicateActor = hasIllegalDuplicateActor;
module.exports.importHistory = importHistory;
