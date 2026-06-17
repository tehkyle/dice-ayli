const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'showrunner.json');
const DEFAULT = { shows: [], cast_assignments: [], scene_log: [], photos: [] };

function readData() {
  try {
    return { ...DEFAULT, ...JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) };
  } catch {
    return { ...DEFAULT, shows: [], cast_assignments: [], scene_log: [], photos: [] };
  }
}

// Drop-in replacement for lowdb's LowSync: same .data / .read() / .write() API.
const db = {
  data: readData(),
  read()  { this.data = readData(); },
  write() { fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2)); },
};

function getDb() {
  return db;
}

function nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(i => i.id)) + 1;
}

module.exports = { getDb, nextId };
