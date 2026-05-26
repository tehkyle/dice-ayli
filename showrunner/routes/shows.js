const express = require('express');
const router = express.Router();
const { getDb, nextId } = require('../db/database');
const { sendCastToQLab, sendScenesToQLab, setActiveShow } = require('../osc/qlabBridge');

// POST /api/shows — create a new show record
router.post('/', (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const { notes } = req.body || {};

  const id = nextId(db.data.shows);
  db.data.shows.push({ id, show_date: today, locked_at: null, notes: notes || null });
  db.write();

  // performance_number is computed dynamically as rank by id — not stored
  const performanceNumber = db.data.shows.findIndex(s => s.id === id) + 1;
  res.json({ id, show_date: today, performance_number: performanceNumber });
});

// POST /api/shows/:id/cast — lock cast + scenes, save, send OSC
router.post('/:id/cast', async (req, res) => {
  const db = getDb();
  const showId = parseInt(req.params.id, 10);
  const { cast, scenes, scenesOrdered } = req.body || {};

  if (!cast || typeof cast !== 'object') {
    return res.status(400).json({ error: 'cast object required' });
  }

  const actors = Object.values(cast);
  if (new Set(actors).size !== actors.length) {
    return res.status(400).json({ error: 'Duplicate actor assignments are not allowed' });
  }

  const show = db.data.shows.find(s => s.id === showId);
  if (!show) {
    return res.status(404).json({ error: 'Show not found' });
  }

  // Write to DB first — OSC failure must never block the save
  db.data.cast_assignments = db.data.cast_assignments.filter(a => a.show_id !== showId);
  for (const [character_track, actor_name] of Object.entries(cast)) {
    db.data.cast_assignments.push({ id: nextId(db.data.cast_assignments), show_id: showId, character_track, actor_name });
  }
  show.scenes = scenes || null;
  show.scenesOrdered = scenesOrdered || null;
  show.locked_at = new Date().toISOString();
  db.write();

  setActiveShow(showId);

  let qlabNotified = false;
  try {
    const castOk = await sendCastToQLab(cast);
    let scenesOk = true;
    if (scenes && typeof scenes === 'object') {
      scenesOk = await sendScenesToQLab(scenes, scenesOrdered || {});
    }
    qlabNotified = castOk && scenesOk;
  } catch (err) {
    console.error(`[OSC ERR] sendCastToQLab threw: ${err.message}`);
  }

  res.json({ success: true, qlabNotified });
});

// DELETE /api/shows/:id — remove a show and its cast assignments
router.delete('/:id', (req, res) => {
  const db = getDb();
  const showId = parseInt(req.params.id, 10);

  const idx = db.data.shows.findIndex(s => s.id === showId);
  if (idx === -1) return res.status(404).json({ error: 'Show not found' });

  db.data.shows.splice(idx, 1);
  db.data.cast_assignments = db.data.cast_assignments.filter(a => a.show_id !== showId);
  db.write();

  res.json({ success: true });
});

// GET /api/shows — all shows with cast and scene log
// performance_number is the show's 1-based position when sorted by id
router.get('/', (req, res) => {
  const db = getDb();
  const sorted = [...db.data.shows].sort((a, b) => a.id - b.id);
  const result = sorted.map((show, i) => ({
    ...show,
    performance_number: i + 1,
    cast: db.data.cast_assignments.filter(a => a.show_id === show.id),
    scenes_played: db.data.scene_log
      .filter(e => e.show_id === show.id)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
  })).reverse();
  res.json(result);
});

// GET /api/shows/today — today's shows only
router.get('/today', (req, res) => {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...db.data.shows].sort((a, b) => a.id - b.id);
  const result = sorted
    .map((show, i) => ({ ...show, performance_number: i + 1 }))
    .filter(s => s.show_date === today)
    .map(show => ({
      ...show,
      cast: db.data.cast_assignments.filter(a => a.show_id === show.id),
      scenes_played: db.data.scene_log
        .filter(e => e.show_id === show.id)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)),
    }));
  res.json(result);
});

module.exports = router;
