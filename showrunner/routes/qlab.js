const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { checkQLab } = require('../osc/qlabBridge');

// GET /api/qlab/status
// Pings QLab and checks that each configured track variable exists.
router.get('/status', async (req, res) => {
  let trackIds;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../config.json'), 'utf8'));
    trackIds = config.characterTracks.map(t => t.id);
  } catch (err) {
    return res.status(500).json({ error: 'Could not read config.json' });
  }

  const result = await checkQLab(trackIds);
  res.json(result);
});

module.exports = router;
