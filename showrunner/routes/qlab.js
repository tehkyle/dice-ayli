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
      if pos is missing value then return ""
      set cNum to q number of pos as text
      set cName to q name of pos as text
      if cName is "" then
        set cType to q type of pos as text
        try
          set tgt to cue target of pos
          set tgtName to q name of tgt as text
          if tgtName is "" then set tgtName to q number of tgt as text
          if tgtName is not "" then
            set cName to cType & " " & tgtName
          else
            set cName to cType
          end if
        on error
          set cName to cType
        end try
      end if
      return cNum & "||" & cName
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
    const idx          = raw.indexOf('||');
    const cueNumberRaw = idx >= 0 ? raw.slice(0, idx)  : '';
    const cueName      = idx >= 0 ? raw.slice(idx + 2) : raw;
    const cueNumber    = cueNumberRaw === '-' ? '' : cueNumberRaw;
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
