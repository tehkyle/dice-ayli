const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const multer  = require('multer');
const archiver = require('archiver');

const { getDb, nextId } = require('../db/database');
const { broadcast } = require('./events');
const { getPhotosDir } = require('../dataDir');
const { getCameraUrl, photoFolderName } = require('../utils');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 8 * 1024 * 1024 },
});

// The camera page now hands over whatever the phone's native camera app produced,
// not a JPEG we encoded ourselves — iOS and Android both hand back JPEG for a
// direct camera capture in practice, so this covers the real world. HEIC/HEIF
// isn't accepted because browsers can't render it in an <img>, which would break
// the gallery; add server-side conversion here if that ever actually shows up.
const ALLOWED_MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
};

function timestampSlug(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').slice(0, 15);
}

// "July 22, 2:17pm" — matches how stage management refers to a performance, unlike the internal show id.
function showDatetimeLabel(isoString) {
  const d = isoString ? new Date(isoString) : new Date();
  const date = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    .replace(' ', '')
    .toLowerCase();
  return `${date}, ${time}`;
}

function photosForShow(db, showId) {
  const photos = db.data.photos
    .filter(p => p.show_id === showId)
    .sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at))
    .map(({ filename, uploaded_at }) => ({ filename, uploaded_at }));
  return { show_id: showId, count: photos.length, photos };
}

// POST /api/photos/upload — camera page posts a photo from the phone's native camera
router.post('/upload', upload.single('photo'), (req, res) => {
  const db     = getDb();
  const showId = parseInt(req.body.show_id, 10);
  if (!Number.isInteger(showId)) return res.status(400).json({ error: 'show_id is required' });

  const show = db.data.shows.find(s => s.id === showId);
  if (!show) return res.status(404).json({ error: 'Show not found' });
  if (!show.photo_window_open) return res.status(403).json({ error: 'Upload window is closed' });
  if (!req.file) return res.status(400).json({ error: 'A photo is required' });

  const ext = ALLOWED_MIME_EXT[req.file.mimetype];
  if (!ext) {
    return res.status(400).json({ error: `Unsupported photo format (${req.file.mimetype})` });
  }

  const dir      = path.join(getPhotosDir(), photoFolderName(show));
  const filename = `${timestampSlug()}_${crypto.randomBytes(2).toString('hex')}.${ext}`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), req.file.buffer);

  const uploaded_at = new Date().toISOString();
  db.data.photos.push({ id: nextId(db.data.photos), show_id: showId, filename, uploaded_at });
  db.write();

  broadcast('photos_changed', { show_id: showId, count: db.data.photos.filter(p => p.show_id === showId).length });
  res.json({ success: true, filename });
});

// DELETE /api/photos/:show_id/:filename — remove one photo (file + record)
router.delete('/:show_id/:filename', (req, res) => {
  const db       = getDb();
  const showId   = parseInt(req.params.show_id, 10);
  const filename = req.params.filename;

  const idx = db.data.photos.findIndex(p => p.show_id === showId && p.filename === filename);
  if (idx === -1) return res.status(404).json({ error: 'Photo not found' });

  const show = db.data.shows.find(s => s.id === showId);
  if (show) {
    try {
      fs.unlinkSync(path.join(getPhotosDir(), photoFolderName(show), filename));
    } catch {}
  }

  db.data.photos.splice(idx, 1);
  db.write();

  const count = db.data.photos.filter(p => p.show_id === showId).length;
  broadcast('photos_changed', { show_id: showId, count });
  res.json({ success: true, count });
});

// GET /api/photos/:show_id/zip — download every photo for a show as a single zip
router.get('/:show_id/zip', (req, res) => {
  const db     = getDb();
  const showId = parseInt(req.params.show_id, 10);
  const { photos } = photosForShow(db, showId);
  if (photos.length === 0) return res.status(404).json({ error: 'No photos for this show' });

  const show = db.data.shows.find(s => s.id === showId);
  const filename = `${showDatetimeLabel(show?.started_at)}.zip`;

  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });

  const archive = archiver('zip');
  archive.on('error', err => res.status(500).end(err.message));
  archive.pipe(res);
  const dir = path.join(getPhotosDir(), photoFolderName(show ?? { id: showId }));
  for (const { filename } of photos) {
    archive.file(path.join(dir, filename), { name: filename });
  }
  archive.finalize();
});

// GET /api/photos/camera-url — the standing camera page URL, no show id required.
// Same QR code works for every performance, so this can be shown before a show exists.
router.get('/camera-url', (req, res) => {
  res.json({ camera_url: getCameraUrl() });
});

// GET /api/photos/active — photos for the currently running performance, if any
router.get('/active', (req, res) => {
  const db     = getDb();
  const sorted = [...db.data.shows].sort((a, b) => a.id - b.id);
  const active = [...sorted].reverse().find(s => s.locked_at && !s.ended_at);
  res.json(active ? photosForShow(db, active.id) : null);
});

// GET /api/photos/:show_id — all photos uploaded for a given show
router.get('/:show_id', (req, res) => {
  const db = getDb();
  res.json(photosForShow(db, parseInt(req.params.show_id, 10)));
});

// Catches multer errors (e.g. LIMIT_FILE_SIZE) as clean JSON instead of Express's HTML default.
router.use((err, req, res, next) => {
  if (!err) return next();
  res.status(400).json({ error: err.message });
});

module.exports = router;
