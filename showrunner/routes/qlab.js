const express = require('express');
const router  = express.Router();
const path    = require('path');
const fs      = require('fs');
const os      = require('os');
const { exec } = require('child_process');

const { checkQLab, sendGo } = require('../osc/qlabBridge');

// Returns "cueNumber||cueName" for the playhead of the front (active) cue list —
// exactly what QLab's Go button would fire next.
const PLAYHEAD_SCRIPT = `tell application "QLab"
  tell front workspace
    try
      set pos to playback position of front cue list
      if pos is missing value then
        return ""
      end if
      return (q number of pos as text) & "||" & (q name of pos)
    on error errMsg
      return "ERR:" & errMsg
    end try
  end tell
end tell`;

const PLAYHEAD_SCRIPT_PATH = path.join(os.tmpdir(), 'qlabplayhead.applescript');
fs.writeFileSync(PLAYHEAD_SCRIPT_PATH, PLAYHEAD_SCRIPT);

// GET /api/qlab/status
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

// GET /api/qlab/playhead
router.get('/playhead', (req, res) => {
  exec(`osascript "${PLAYHEAD_SCRIPT_PATH}"`, (err, stdout, stderr) => {
    const raw = stdout.trim();
    console.log(`[QLab] playhead — err: ${err?.message || 'none'} | stdout: "${raw}" | stderr: "${stderr?.trim()}"`);
    if (err || !raw || raw.startsWith('ERR:')) return res.json({ cueName: '', cueNumber: '' });
    const idx = raw.indexOf('||');
    const cueNumber = idx >= 0 ? raw.slice(0, idx)  : '';
    const cueName   = idx >= 0 ? raw.slice(idx + 2) : raw;
    res.json({ cueName, cueNumber });
  });
});

// POST /api/qlab/go
router.post('/go', async (req, res) => {
  try {
    await sendGo();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
