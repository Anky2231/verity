// Maps plain-text character offsets (blocks joined by "\n", as returned by the review API)
// to ProseMirror document positions. Server offsets refer to editor.getText({ blockSeparator: '\n' }).

export function buildSegments(doc) {
  const segs = [];
  let off = 0;
  let first = true;
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (!first) off += 1; // the "\n" between blocks
      first = false;
      segs.push({ off, pos: pos + 1, len: node.textContent.length });
      off += node.textContent.length;
      return false;
    }
    return true;
  });
  return segs;
}

export function toPos(segs, offset) {
  for (const s of segs) if (offset >= s.off && offset <= s.off + s.len) return s.pos + (offset - s.off);
  return null;
}

export function spanToRange(segs, span) {
  const from = toPos(segs, span.start);
  const to = toPos(segs, span.end);
  return from == null || to == null || to <= from ? null : { from, to };
}
