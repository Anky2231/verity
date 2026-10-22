import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSegments, spanToRange } from '../lib/spanMap.js';

// Minimal fake of a ProseMirror doc: two paragraphs "Hello java" / "Second line"
const para = (text) => ({ isTextblock: true, textContent: text });
const doc = { descendants(cb) { let pos = 0; for (const t of ['Hello java', 'Second line']) { cb(para(t), pos); pos += t.length + 2; } } };

test('single-block offsets map to pos+1 base', () => {
  const segs = buildSegments(doc);
  assert.deepEqual(spanToRange(segs, { start: 6, end: 10 }), { from: 7, to: 11 });
});
test('second block accounts for the newline separator', () => {
  const segs = buildSegments(doc);
  // text = "Hello java\nSecond line"; "Second" starts at offset 11
  assert.deepEqual(spanToRange(segs, { start: 11, end: 17 }), { from: 13, to: 19 });
});
test('out-of-range span returns null', () => {
  assert.equal(spanToRange(buildSegments(doc), { start: 100, end: 120 }), null);
});
