const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '../config.json');

router.get('/', (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    res.json(config);
  } catch (err) {
    console.error(`[CONFIG] Failed to read config.json: ${err.message}`);
    res.status(500).json({ error: 'Could not load config.json' });
  }
});

module.exports = router;
