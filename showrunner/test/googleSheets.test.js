// Sanity check for the Sheets header shape — the bug this guards against:
// appendShowToSheet only writes the header once, so if it's ever rebuilt with
// a different act/scene list than what's already in a live sheet, every column
// after the change point silently shifts out from under its label.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildHeaderRow } = require('../integrations/googleSheets');

const baseConfig = {
  characterTracks: [{ label: 'Track 1' }, { label: 'DJ' }],
  acts: [
    { label: 'Act 2', scenes: ['2A', '2B'] },
    { label: 'Act 3', scenes: ['3A', '3B', '3C'] },
  ],
  staticScenes: ['Encore'],
};

test('header row matches Date/Start/Run/Showrunner + tracks + per-act order+scenes + static scenes', () => {
  assert.deepStrictEqual(buildHeaderRow(baseConfig), [
    'Date', 'Start Time', 'Run Time', 'Showrunner',
    'Track 1', 'DJ',
    'Act 2 Order', '2A', '2B',
    'Act 3 Order', '3A', '3B', '3C',
    'Encore',
  ]);
});

test('removing a scene from an act changes the header shape (the case that must be caught, not silently appended past)', () => {
  const trimmed = { ...baseConfig, acts: [baseConfig.acts[0], { label: 'Act 3', scenes: ['3A', '3B'] }] };
  const before = buildHeaderRow(baseConfig);
  const after  = buildHeaderRow(trimmed);
  assert.notDeepStrictEqual(before, after);
  assert.strictEqual(before.length, after.length + 1);
});
