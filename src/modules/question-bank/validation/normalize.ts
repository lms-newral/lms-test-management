import { createHash } from 'crypto';

/**
 * Reduces a question stem to a canonical form and hashes it, so that two
 * questions that differ only in markup, spacing or punctuation collide.
 *
 * Deliberately lossy in a specific order:
 *
 *   1. math nodes collapse to their SOURCE, not their rendered SVG — the same
 *      formula authored in MathLive and imported from Word must hash the same;
 *   2. images collapse to a positional placeholder, since the same diagram gets
 *      a fresh S3 key on every import and the URL would otherwise defeat the
 *      whole check;
 *   3. tags, entities, punctuation and case are dropped last.
 *
 * Pure and dependency-free so it can be unit tested and reused by the Phase 2
 * importer without pulling in Nest.
 */
export function normalizeStem(html: string): string {
  if (!html) return '';

  let s = html;

  // 1. Math -> its source. `data-math-source` is base64 of the original
  //    MathML/LaTeX; fall back to any alt text.
  //
  //    Both tag shapes must be handled. The editor (MathNode.tsx) and the Word
  //    importer (docx-parser.ts) both emit a <span ...>\(latex\)</span>; the old
  //    quiz importer baked formulas as <img> with a data-URI SVG. Matching only
  //    <img> left the sentinel dead for everything actually in the bank, so a
  //    legacy image and its span twin hashed differently -- exactly what this
  //    function's contract promises they will not do. A span carries the LaTeX
  //    as its text too, so its closing tag is consumed here rather than left
  //    behind for the generic tag-strip below to turn into stray whitespace.
  s = s.replace(
    /<(img|span)\b[^>]*\bdata-math-source="([^"]*)"[^>]*>(?:[\s\S]*?<\/\1>)?/gi,
    (_m, _tag: string, src: string) => {
      try {
        return ` math:${Buffer.from(src, 'base64').toString('utf-8').trim()} `;
      } catch {
        return ` math:${src} `;
      }
    },
  );

  // 2. Remaining images -> positional placeholder.
  let imgIndex = 0;
  s = s.replace(/<img\b[^>]*>/gi, () => ` img${imgIndex++} `);

  // 3. Strip everything else.
  s = s
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');

  s = s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_m, d: string) =>
      String.fromCharCode(parseInt(d, 10)),
    );

  s = s.toLowerCase();

  // Keep the sentinel bytes, letters, digits and whitespace. Punctuation goes:
  // "What is 2+2?" and "What is 2 + 2" are the same question.
  s = s.replace(/[^\p{L}\p{N}\s:+\-*/=^]/gu, ' ');

  // Collapse spacing around math operators so "2 + 2" and "2+2" hash alike.
  s = s.replace(/\s*([+\-*/=^])\s*/g, '$1');

  return s.replace(/\s+/g, ' ').trim();
}

export function stemHash(html: string): string | null {
  const norm = normalizeStem(html);
  // Too short to be a meaningful fingerprint — hashing "a" would mark every
  // stub question as a duplicate of every other.
  if (norm.length < 8) return null;
  return createHash('sha256').update(norm, 'utf-8').digest('hex');
}
