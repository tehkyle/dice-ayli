const { LowSync } = require('lowdb');
const { JSONFileSync } = require('lowdb/node');
const path = require('path');

const adapter = new JSONFileSync(path.join(__dirname, 'showrunner.json'));
const db = new LowSync(adapter, { shows: [], cast_assignments: [], scene_log: [] });
db.read();

function getDb() {
  return db;
}

function nextId(arr) {
  return arr.length === 0 ? 1 : Math.max(...arr.map(i => i.id)) + 1;
}

module.exports = { getDb, nextId };
