// Offline check of the Word import parser -- no DB, no pandoc, no network.
//
// The parser is deliberately pure, so these tests feed it the HTML pandoc would
// produce and assert on what comes back. The fixtures below are shaped like
// real pandoc output: `--mathjax` writes math as <span class="math inline">
// wrapping \(latex\), and --extract-media rewrites <img src> to a relative path.
const {
  parseDocxHtml,
  matchHeader,
  normaliseHeader,
  mathToEditorSpans,
  resolveChoiceAnswer,
  worstSeverity,
} = require('../../dist/src/modules/question-bank/import/docx-parser');
const {
  normalizeStem,
  stemHash,
} = require('../../dist/src/modules/question-bank/validation/normalize');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const table = (headerCells, bodyRows) =>
  `<table><tr>${headerCells.map((h) => `<th>${h}</th>`).join('')}</tr>` +
  bodyRows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('') +
  `</table>`;

const rowsOf = (result) => result.rows;
const codes = (issues) => issues.map((i) => i.code);

/* --- 1. Header matching --------------------------------------------------- */

check('header matching is case and punctuation insensitive',
  matchHeader('Question Text') === 'question' &&
  matchHeader('QUESTION_TEXT') === 'question' &&
  matchHeader('  question text  ') === 'question');

check('option columns carry their letter, not their position',
  matchHeader('Option A') === 'option:A' &&
  matchHeader('option c') === 'option:C' &&
  matchHeader('Choice B') === 'option:B');

check('subtopic is a recognised column', matchHeader('Sub Topic') === 'subtopic');
check('unknown headers return null', matchHeader('Author Notes') === null);
check('normaliseHeader strips punctuation', normaliseHeader('Sr. No.') === 'srno');

/* --- 2. Column order must not matter -------------------------------------- */

const NATURAL = table(
  ['No', 'Question', 'Option A', 'Option B', 'Answer', 'Subject'],
  [['1', 'What is 2+2?', '3', '4', 'B', 'Maths']],
);
const SHUFFLED = table(
  ['Subject', 'Answer', 'Option B', 'Option A', 'Question', 'No'],
  [['Maths', 'B', '4', '3', 'What is 2+2?', '1']],
);

const a = rowsOf(parseDocxHtml(NATURAL))[0];
const b = rowsOf(parseDocxHtml(SHUFFLED))[0];
check('REGRESSION: reordering the columns changes nothing',
  a.bodyHtml === b.bodyHtml &&
  a.answerRaw === b.answerRaw &&
  a.subjectRaw === b.subjectRaw &&
  JSON.stringify(a.options) === JSON.stringify(b.options),
  `${JSON.stringify(a.options)} vs ${JSON.stringify(b.options)}`);

check('  option B is B even when it is written before A',
  b.options.find((o) => o.letter === 'B').html === '4');

/* --- 3. A gap in the option letters keeps the letters honest -------------- */

const GAPPED = parseDocxHtml(
  table(
    ['Question', 'Option A', 'Option C', 'Answer'],
    [['Pick one', 'first', 'third', 'C']],
  ),
);
check('an option column may be skipped without shifting the letters',
  GAPPED.rows[0].options.map((o) => o.letter).join('') === 'AC' &&
  GAPPED.rows[0].options.find((o) => o.letter === 'C').html === 'third');

/* --- 4. Optional columns may be absent entirely --------------------------- */

const MINIMAL = parseDocxHtml(
  table(['Question', 'Option A', 'Option B', 'Answer'], [['Q?', 'x', 'y', 'A']]),
);
check('a document with only the required columns parses',
  MINIMAL.rows.length === 1 &&
  MINIMAL.rows[0].subjectRaw === undefined &&
  MINIMAL.rows[0].issues.length === 0,
  JSON.stringify(codes(MINIMAL.rows[0].issues)));

/* --- 5. Unknown columns are kept, never dropped silently ------------------ */

const EXTRA = parseDocxHtml(
  table(
    ['Question', 'Option A', 'Option B', 'Answer', 'Author Notes'],
    [['Q?', 'x', 'y', 'A', 'from the 2019 paper']],
  ),
);
check('an unrecognised column raises a warning',
  codes(EXTRA.issues).includes('UNKNOWN_HEADERS'));
check('  and its content is preserved in raw',
  EXTRA.rows[0].raw['Author Notes'] === 'from the 2019 paper',
  JSON.stringify(EXTRA.rows[0].raw));

/* --- 6. Math round-trip --------------------------------------------------- */

const MATH_HTML = mathToEditorSpans(
  '<p>Find <span class="math inline">\\(x^2 + y^2\\)</span> now.</p>',
);
check('pandoc math becomes a span MathNode can parse',
  /<span class="math-inline" data-latex="x\^2 \+ y\^2"/.test(MATH_HTML),
  MATH_HTML);
check('  the LaTeX is also base64 in data-math-source, for the dedupe hash',
  MATH_HTML.includes(
    `data-math-source="${Buffer.from('x^2 + y^2', 'utf-8').toString('base64')}"`,
  ),
  MATH_HTML);
check('  and the element text stays \\(latex\\) so it survives a plain renderer',
  MATH_HTML.includes('>\\(x^2 + y^2\\)</span>'), MATH_HTML);
check('  the pandoc wrapper span is gone, not nested',
  !/class="math inline"/.test(MATH_HTML), MATH_HTML);

const DISPLAY = mathToEditorSpans('<span class="math display">\\[E = mc^2\\]</span>');
check('display math is converted too',
  /data-latex="E = mc\^2"/.test(DISPLAY), DISPLAY);
// The generated span's own text is \(latex\). Converting the two delimiters in
// separate passes made the second pass match that text and wrap it again.
check('  REGRESSION: display math is wrapped once, not twice',
  (DISPLAY.match(/math-inline/g) || []).length === 1, DISPLAY);
check('  inline math is wrapped once too',
  (MATH_HTML.match(/math-inline/g) || []).length === 1, MATH_HTML);

const NON_ASCII = mathToEditorSpans('\\(\\alpha \\ne \\beta\\)');
const decoded = Buffer.from(
  /data-math-source="([^"]*)"/.exec(NON_ASCII)[1],
  'base64',
).toString('utf-8');
check('non-ASCII LaTeX survives the base64 round trip',
  decoded === '\\alpha \\ne \\beta', decoded);

const QUOTED = mathToEditorSpans('\\(a < b & c\\)');
check('LaTeX containing < and & is escaped in the attribute',
  QUOTED.includes('data-latex="a &lt; b &amp; c"'), QUOTED);

check('text with no math is untouched',
  mathToEditorSpans('<p>plain</p>') === '<p>plain</p>');

/* --- 7. Images are reported, not rewritten -------------------------------- */

const WITH_IMG = parseDocxHtml(
  table(
    ['Question', 'Option A', 'Option B', 'Answer'],
    [['See <img src="media/image1.png"> and <img src="media/eq.wmf">', 'x', 'y', 'A']],
  ),
);
check('every local image source is reported for upload',
  WITH_IMG.imageSources.length === 2 &&
  WITH_IMG.imageSources.includes('media/image1.png') &&
  WITH_IMG.imageSources.includes('media/eq.wmf'),
  JSON.stringify(WITH_IMG.imageSources));
check('  the src is left alone for the service to rewrite',
  WITH_IMG.rows[0].bodyHtml.includes('src="media/image1.png"'));

const REMOTE_IMG = parseDocxHtml(
  table(
    ['Question', 'Option A', 'Option B', 'Answer'],
    [['<img src="https://cdn.example.com/a.png">', 'x', 'y', 'A']],
  ),
);
check('a remote image is not queued for upload',
  REMOTE_IMG.imageSources.length === 0);

check('a question that is only an image is not treated as empty',
  codes(REMOTE_IMG.rows[0].issues).length === 0,
  JSON.stringify(codes(REMOTE_IMG.rows[0].issues)));

/* --- 8. Row-level problems ------------------------------------------------ */

const BAD = parseDocxHtml(
  table(
    ['Question', 'Option A', 'Option B', 'Answer', 'Marks', 'Solution Video'],
    [
      ['', 'x', 'y', 'A', '2', 'https://youtu.be/abc'],
      ['Q?', 'x', 'y', '', '2', ''],
      ['Q?', 'x', 'y', 'A', 'lots', 'not-a-url'],
    ],
  ),
);
check('a row with no question text is BLOCKING',
  codes(BAD.rows[0].issues).includes('NO_QUESTION'));
check('a row with no answer is BLOCKING',
  codes(BAD.rows[1].issues).includes('NO_ANSWER'));
check('unparseable marks is only a WARNING',
  codes(BAD.rows[2].issues).includes('BAD_MARKS') &&
  worstSeverity(BAD.rows[2].issues) === 'WARNING');
check('a solution video that is not a URL is a WARNING and is dropped',
  codes(BAD.rows[2].issues).includes('BAD_VIDEO_URL') &&
  BAD.rows[2].solutionVideoUrl === undefined);
check('a valid marks value is read',
  BAD.rows[0].marks === 2, String(BAD.rows[0].marks));
check('a valid solution video is kept',
  BAD.rows[0].solutionVideoUrl === 'https://youtu.be/abc');

/* --- 9. Whole-document problems ------------------------------------------- */

check('a document with no table is BLOCKING',
  codes(parseDocxHtml('<p>hello</p>').issues).includes('NO_TABLE'));
check('a table with no recognisable header is BLOCKING',
  codes(parseDocxHtml(table(['A', 'B'], [['1', '2']])).issues).includes('NO_HEADER'));
check('a header with no rows under it is BLOCKING',
  codes(parseDocxHtml(table(['Question', 'Answer'], [])).issues).includes('NO_ROWS'));

const LEADING_TITLE =
  '<table><tr><td>Class XI Physics — Term 1</td></tr></table>' +
  table(['Question', 'Option A', 'Option B', 'Answer'], [['Q?', 'x', 'y', 'A']]);
check('a title table before the real one is skipped',
  parseDocxHtml(LEADING_TITLE).rows.length === 1);

const TRAILING_BLANK = parseDocxHtml(
  table(
    ['Question', 'Option A', 'Option B', 'Answer'],
    [['Q?', 'x', 'y', 'A'], ['', '', '', '']],
  ),
);
check('a trailing blank row is ignored, not reported as broken',
  TRAILING_BLANK.rows.length === 1, `got ${TRAILING_BLANK.rows.length}`);

/* --- 10. Answer resolution ------------------------------------------------ */

const opts = [
  { letter: 'A', html: 'one' },
  { letter: 'B', html: 'two' },
  { letter: 'C', html: 'three' },
];
const correctOf = (raw) => [...resolveChoiceAnswer(raw, opts).correct].sort().join('');

check('a plain letter resolves', correctOf('B') === 'B');
check('a lowercase letter resolves', correctOf('b') === 'B');
check('a bracketed letter resolves', correctOf('(B)') === 'B');
check('a comma list resolves', correctOf('A, C') === 'AC');
check('"A and C" resolves', correctOf('A and C') === 'AC');
check('a run of letters resolves', correctOf('AC') === 'AC');
check('a 1-based index resolves', correctOf('2') === 'B');

const bogus = resolveChoiceAnswer('D', opts);
check('REGRESSION: an answer naming a missing option is BLOCKING',
  bogus.correct.size === 0 &&
  codes(bogus.issues).includes('ANSWER_NOT_AN_OPTION'),
  JSON.stringify(codes(bogus.issues)));

const twoLetterWord = resolveChoiceAnswer('NO', opts);
check('a two-letter word is not silently read as two options',
  twoLetterWord.correct.size === 0 &&
  codes(twoLetterWord.issues).includes('ANSWER_NOT_AN_OPTION'));

/* --- 11. Duplicate-detection hashing -------------------------------------- */

// normalizeStem promises that "the same formula authored in MathLive and
// imported from Word must hash the same". Both of those emit a <span>; only the
// old quiz importer emitted <img>. The sentinel used to match <img> alone, so it
// was dead for everything actually in the bank and the two shapes hashed apart.
const b64 = (s) => Buffer.from(s, 'utf-8').toString('base64');
const asSpan = (l) =>
  `<span class="math-inline" data-latex="${l}" data-math-source="${b64(l)}">\\(${l}\\)</span>`;
const asImg = (l) => `<img data-math-source="${b64(l)}" alt="math">`;

check('REGRESSION: a formula hashes the same as a span and as an img',
  stemHash(`<p>Find ${asSpan('x^2+y^2=z^2')} now.</p>`) ===
  stemHash(`<p>Find ${asImg('x^2+y^2=z^2')} now.</p>`));

check('the math sentinel reaches span-shaped math',
  normalizeStem(`<p>Find ${asSpan('x^2')} now.</p>`) === 'find math:x^2 now');

check('REGRESSION: an unclosed img does not swallow a later closing tag',
  normalizeStem(`<p>${asImg('a+b')} and <span class="x">tail</span></p>`) ===
  'math:a+b and tail');

check('REGRESSION: adjacent math spans do not consume each other',
  normalizeStem(`<p>${asSpan('a+b')} then ${asSpan('c+d')}</p>`) ===
  'math:a+b then math:c+d');

check('non-math images stay positional placeholders',
  normalizeStem('<p>a <img src="1.png"> b <img src="2.png"></p>') ===
  'a img0 b img1');

check('different formulas in the same stem hash differently',
  stemHash(`<p>Evaluate ${asSpan('x^2')} here.</p>`) !==
  stemHash(`<p>Evaluate ${asSpan('x^3')} here.</p>`));

/* --- 12. Severity ordering ------------------------------------------------ */

check('worstSeverity picks BLOCKING over WARNING',
  worstSeverity([
    { code: 'x', message: '', severity: 'WARNING' },
    { code: 'y', message: '', severity: 'BLOCKING' },
  ]) === 'BLOCKING');
check('no issues is OK', worstSeverity([]) === 'OK');

console.log(
  failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
