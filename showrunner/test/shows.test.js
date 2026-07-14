const { test } = require('node:test');
const assert = require('node:assert');
const { hasIllegalDuplicateActor, importHistory } = require('../routes/shows');

function fakeDb() {
  return { data: { shows: [], cast_assignments: [], scene_log: [], photos: [] }, write() {} };
}

test('Singer may share with DJ or any other single track', () => {
  assert.strictEqual(hasIllegalDuplicateActor({ Track_DJ: 'Alice', Track_Singer: 'Alice' }), false);
  assert.strictEqual(hasIllegalDuplicateActor({ Track_1: 'Alice', Track_Singer: 'Alice' }), false);
});

test('two non-Singer tracks sharing an actor is a duplicate', () => {
  assert.strictEqual(hasIllegalDuplicateActor({ Track_DJ: 'Alice', Track_1: 'Alice' }), true);
});

test('three tracks sharing an actor is a duplicate even with the Singer involved', () => {
  assert.strictEqual(hasIllegalDuplicateActor({ Track_DJ: 'Alice', Track_1: 'Alice', Track_Singer: 'Alice' }), true);
});

test('importHistory remaps show ids so an import never collides with existing shows', () => {
  const db = fakeDb();
  db.data.shows.push({ id: 1, show_date: '2026-01-01' }); // pre-existing show, id 1 already taken

  const idMap = importHistory(db, [
    {
      id: 1, // same id as the pre-existing show — must not collide
      show_date: '2026-02-02',
      notes: 'opening night',
      performance_number: 1, // derived field — must not be stored on the show record
      cast: [{ id: 5, show_id: 1, character_track: 'Track_DJ', actor_name: 'Alice' }],
      scenes_played: [{ id: 9, show_id: 1, scene_name: 'Act 1', position: null, timestamp: '2026-02-02T00:00:00Z' }],
      photos: [{ id: 3, show_id: 1, filename: 'a.jpg', uploaded_at: '2026-02-02T00:00:00Z' }],
    },
  ]);

  const newId = idMap.get(1);
  assert.notStrictEqual(newId, 1, 'imported show must not reuse an id already in use');
  assert.strictEqual(db.data.shows.length, 2);

  const imported = db.data.shows.find(s => s.id === newId);
  assert.strictEqual(imported.notes, 'opening night');
  assert.strictEqual(imported.performance_number, undefined);
  assert.strictEqual(imported.cast, undefined);

  assert.deepStrictEqual(
    db.data.cast_assignments.map(c => [c.show_id, c.character_track, c.actor_name]),
    [[newId, 'Track_DJ', 'Alice']]
  );
  assert.strictEqual(db.data.scene_log[0].show_id, newId);
  assert.strictEqual(db.data.photos[0].show_id, newId);
});
