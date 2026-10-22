// Word-level diff (LCS). Capped so a pathological input can't stall the event loop.
const CAP = 3000;
const tok = (s) => s.split(/(\s+)/).filter((t) => t !== '');

export function wordDiff(a, b) {
  const A = tok(a).slice(0, CAP), B = tok(b).slice(0, CAP);
  const dp = Array.from({ length: A.length + 1 }, () => new Uint16Array(B.length + 1));
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  const push = (type, text) => { const l = out[out.length - 1]; l && l.type === type ? (l.text += text) : out.push({ type, text }); };
  let i = 0, j = 0;
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { push('same', A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', A[i++]);
    else push('add', B[j++]);
  }
  while (i < A.length) push('del', A[i++]);
  while (j < B.length) push('add', B[j++]);
  return out;
}
