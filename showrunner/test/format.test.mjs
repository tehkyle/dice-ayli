// Pure-function tests for src/lib/format.js. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert';
import { formatDuration, formatDurationReport, formatRunTime, formatCueDisplay, toIsoDate } from '../src/lib/format.js';

test('formatDuration', () => {
  assert.strictEqual(formatDuration(null), '—');
  assert.strictEqual(formatDuration(-5), '—');
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(42_000), '42s');
  assert.strictEqual(formatDuration(90_000), '1m 30s');
  assert.strictEqual(formatDuration(3_600_000), '1h 0m 0s');
  assert.strictEqual(formatDuration(5_025_000), '1h 23m 45s');
});

test('formatDurationReport is m:ss', () => {
  assert.strictEqual(formatDurationReport(null), '—');
  assert.strictEqual(formatDurationReport(65_000), '1:05');
  assert.strictEqual(formatDurationReport(9_000), '0:09');
});

test('formatRunTime', () => {
  assert.strictEqual(formatRunTime('2026-01-01T20:00:00Z', '2026-01-01T20:45:00Z'), '45m');
  assert.strictEqual(formatRunTime('2026-01-01T20:00:00Z', '2026-01-01T21:05:00Z'), '1h 5m');
});

test('formatCueDisplay', () => {
  assert.strictEqual(formatCueDisplay('', ''), '-');
  assert.strictEqual(formatCueDisplay('', 'Opening'), 'Opening');
  assert.strictEqual(formatCueDisplay('1.2', 'Opening'), '1.2 - Opening');
});

test('toIsoDate', () => {
  assert.strictEqual(toIsoDate(new Date(2026, 6, 2)), '2026-07-02');
});
