#!/usr/bin/env node
/**
 * Reset the showrunner dev database to empty state.
 * Usage: node scripts/reset-db.js
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../dataDir');

const DB_PATH = path.join(DATA_DIR, 'db', 'showrunner.json');

const empty = { shows: [], cast_assignments: [], scene_log: [] };

fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
console.log(`Reset ${DB_PATH}`);
