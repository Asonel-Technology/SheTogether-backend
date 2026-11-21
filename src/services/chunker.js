/** Split approved text into overlapping, sentence-aware chunks (~900 chars) suitable for embedding. */
const HEADING = /^#{1,6}\s[^\n]*$/;

function splitLong(p, max) {
  const out = [];
  let cur = '';
  for (const s of p.split(/(?<=[.!?؟۔])\s+/)) {
    if ((cur + ' ' + s).trim().length > max && cur) {
      out.push(cur.trim());
      cur = '';
    }
    cur = `${cur} ${s}`.trim();
    while (cur.length > max) {
      out.push(cur.slice(0, max));
      cur = cur.slice(max);
    }
  }
  if (cur) out.push(cur.trim());
  return out;
}

export function chunkText(body, { target = 900, max = 1400, overlap = 120 } = {}) {
  const units = [];
  let pendingHeading = '';
  for (const p of body.replace(/\r\n/g, '\n').split(/\n{2,}/).map((s) => s.trim()).filter(Boolean)) {
    if (HEADING.test(p)) { pendingHeading = p; continue; } // keep headings attached to the text that follows
    const para = pendingHeading ? `${pendingHeading}\n${p}` : p;
    pendingHeading = '';
    units.push(...(para.length <= max ? [para] : splitLong(para, max)));
  }
  if (pendingHeading) units.push(pendingHeading);

  const chunks = [];
  let cur = '';
  for (const u of units) {
    if (cur && cur.length + u.length + 2 > target) {
      chunks.push(cur);
      const tail = cur.slice(-overlap).replace(/^\S*\s/, '');
      cur = tail ? `${tail}\n\n${u}` : u;
    } else {
      cur = cur ? `${cur}\n\n${u}` : u;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}
