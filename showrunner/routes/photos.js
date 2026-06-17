const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');
const multer  = require('multer');

const { getDb, nextId } = require('../db/database');
const { broadcast } = require('./events');

const PHOTOS_DIR = path.join(__dirname, '../photos');
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 8 * 1024 * 1024 },
});

function timestampSlug(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').slice(0, 15);
}

function photosForShow(db, showId) {
  const photos = db.data.photos
    .filter(p => p.show_id === showId)
    .sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at))
    .map(({ filename, uploaded_at }) => ({ filename, uploaded_at }));
  return { show_id: showId, count: photos.length, photos };
}

// POST /api/photos/upload — operator camera page posts a captured JPEG
router.post('/upload', upload.single('photo'), (req, res) => {
  const db     = getDb();
  const showId = parseInt(req.body.show_id, 10);
  if (!Number.isInteger(showId)) return res.status(400).json({ error: 'show_id is required' });

  const show = db.data.shows.find(s => s.id === showId);
  if (!show) return res.status(404).json({ error: 'Show not found' });
  if (!show.photo_window_open) return res.status(403).json({ error: 'Upload window is closed' });
  if (!req.file || req.file.mimetype !== 'image/jpeg') {
    return res.status(400).json({ error: 'A JPEG photo is required' });
  }

  const dir      = path.join(PHOTOS_DIR, String(showId));
  const filename = `${timestampSlug()}_${crypto.randomBytes(2).toString('hex')}.jpg`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), req.file.buffer);

  const uploaded_at = new Date().toISOString();
  db.data.photos.push({ id: nextId(db.data.photos), show_id: showId, filename, uploaded_at });
  db.write();

  broadcast('photo_uploaded', { show_id: showId, count: db.data.photos.filter(p => p.show_id === showId).length });
  res.json({ success: true, filename });
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
