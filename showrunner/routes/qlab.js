const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');

const { checkQLab, sendGo, sendPanicAll, reconnectQLab, getPlayhead, sendCastToQLab } = require('../osc/qlabBridge');

// GET /api/qlab/status
router.get('/status', async (req, res) => {
  try {
    const config   = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
    const trackIds = config.characterTracks.map(t => t.id);
    const result   = await checkQLab(trackIds);
    res.json(result);
  } catch (err) {
    console.error('[QLab] status check failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/qlab/playhead — returns the cue currently queued to fire next.
// Updated reactively via QLab's /updates subscription in qlabBridge.js.
router.get('/playhead', (req, res) => {
  res.json(getPlayhead());
});

// POST /api/qlab/sync-cast — send cast notes to QLab and verify by reading
// them back. confirm:true also fires the CAST_CONFIRMED cue once verified —
// only for a locked cast; the Confirm screen's pre-send passes confirm:false.
router.post('/sync-cast', async (req, res) => {
  try {
    const { cast, confirm } = req.body ?? {};
    if (!cast || typeof cast !== 'object') {
      return res.status(400).json({ error: 'cast object required' });
    }
    const result = await sendCastToQLab(cast, { fireConfirm: !!confirm });
    res.json(result);
  } catch (err) {
    console.error('[QLab] sync-cast failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qlab/go
router.post('/go', async (req, res) => {
  try {
    await sendGo();
    res.json({ success: true });
  } catch (err) {
    console.error('[QLab] go failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qlab/panic
router.post('/panic', async (req, res) => {
  try {
    await sendPanicAll();
    res.json({ success: true });
  } catch (err) {
    console.error('[QLab] panic failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/qlab/reconnect
router.post('/reconnect', async (req, res) => {
  try {
    const status = await reconnectQLab(req.body?.cueNumber);
    res.json({ status });
  } catch (err) {
    console.error('[QLab] reconnect failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
