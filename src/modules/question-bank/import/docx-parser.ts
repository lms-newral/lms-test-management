import * as cheerio from 'cheerio';

/**
 * Turns pandoc's HTML into staged question rows.
 *
 * PURE ON PURPOSE. No Nest, no Prisma, no filesystem, no network -- everything
 * it needs arrives as a string and everything it produces is returned. That is
 * what makes the interesting half of the importer unit-testable without a
 * database, which matters because the parsing rules are where the bugs live.
 *
 * Two things it deliberately does NOT do:
 *
 *   - resolve taxonomy, type or difficulty names to ids. It reports the raw
 *     strings and `taxonomy-resolver.ts` turns them into ids, because that
 *     needs the database and this must not.
 *   - upload or rewrite images. It leaves `<img src="...">` exactly as pandoc
 *     wrote it and reports every referenced source, so the service can upload
 *     them and rewrite the src afterwards.
 *
 * Replaces the positional parser in `quizzes/quiz.service.ts`, which reads
 * columns by index and therefore breaks the moment an author reorders them.
 */

export type Severity = 'OK' | 'WARNING' | 'BLOCKING';

export interface Issue {
  code: string;
  message: string;
  severity: Exclude<Severity, 'OK'>;
}

export interface ParsedOption {
  /** 'A', 'B', ... taken from the column header, not the position. */
  letter: string;
  html: string;
}

export interface ParsedRow {
  /** 1-based position in the table body, used to address the row in review. */
  rowIndex: number;
  /** Every cell, keyed by its header, including columns we do not understand. */
  raw: Record<string, string>;

  numberRaw?: string;
  bodyHtml: string;
  options: ParsedOption[];
  answerRaw?: string;
  typeRaw?: string;
  subjectRaw?: string;
  chapterRaw?: string;
  topicRaw?: string;
  subtopicRaw?: string;
  difficultyRaw?: string;
  explanationHtml?: string;
  solutionVideoUrl?: string;
  marks?: number;

  issues: Issue[];
}

export interface ParseResult {
  /** Canonical key per column, in document order. `null` = not understood. */
  headers: { raw: string; key: string | null }[];
  unknownHeaders: string[];
  rows: ParsedRow[];
  /** Whole-document problems, e.g. no table at all. */
  issues: Issue[];
  /** Every non-remote `src` referenced by any cell, de-duplicated. */
  imageSources: string[];
}

/* --- Header matching ------------------------------------------------------ */

/**
 * Canonical column keys and the header spellings that map to them.
 *
 * Matched case- and punctuation-insensitively, so "Question Text", "question
 * text" and "QUESTION_TEXT" are one column. The accepted set is mirrored in
 * `lms-admin-frontend/src/pages/dashboard/QuestionBank/QuestionImport.tsx`,
 * which is the page authors read before writing a document -- if a column is
 * added here, add it there in the same commit or the documentation lies.
 */
const HEADER_ALIASES: Record<string, string[]> = {
  no: ['no', 'sno', 'srno', 'qno', 'questionno', 'number', 'qnumber', 'sr'],
  question: ['question', 'questiontext', 'stem', 'questions'],
  answer: ['answer', 'answers', 'correctanswer', 'ans', 'key', 'answerkey'],
  type: ['type', 'questiontype', 'qtype'],
  subject: ['subject'],
  chapter: ['chapter'],
  topic: ['topic'],
  subtopic: ['subtopic'],
  difficulty: ['difficulty', 'level', 'difficultylevel'],
  explanation: ['explanation', 'explaination', 'solution', 'solutiontext'],
  solutionVideo: [
    'solutionvideo',
    'video',
    'videourl',
    'solutionvideourl',
    'videolink',
  ],
  marks: ['marks', 'mark', 'weightage', 'score', 'points'],
};

/** Lowercase, drop everything that is not a letter or digit. */
export function normaliseHeader(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Canonical key for a header cell, or null if we do not understand it.
 *
 * Option columns become `option:A`, `option:B`, ... The letter comes from the
 * header, so "Option C" is always option C even if the author left out B.
 */
export function matchHeader(raw: string): string | null {
  const n = normaliseHeader(raw);
  if (!n) return null;

  const option = /^(?:option|opt|choice)([a-z])$/.exec(n);
  if (option) return `option:${option[1].toUpperCase()}`;

  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.includes(n)) return key;
  }
  return null;
}

/* --- Math ----------------------------------------------------------------- */

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Rewrites pandoc's `\(latex\)` into the span `MathNode.tsx` parses.
 *
 * The bank importer runs pandoc with `--mathjax`, so Word's OMML arrives as
 * LaTeX delimited by `\(...\)` (inline) or `\[...\]` (display), usually wrapped
 * in `<span class="math inline">`. `MathNode` stores LaTeX and parses
 * `span[data-latex]`, so this is the whole of the math round-trip.
 *
 * `data-math-source` is base64 of the same LaTeX and is not decoration --
 * `validation/normalize.ts` decodes it when hashing a question for duplicate
 * detection, so a formula authored in MathLive and one imported from Word
 * collide as they should. The two files are a coupled contract.
 *
 * The element's text stays `\(latex\)` so the formula survives anywhere with no
 * math renderer at all.
 */
export function mathToEditorSpans(html: string): string {
  if (!html) return html;

  const span = (latex: string) => {
    const trimmed = latex.trim();
    if (!trimmed) return '';
    const b64 = Buffer.from(trimmed, 'utf-8').toString('base64');
    return (
      `<span class="math-inline" data-latex="${escapeAttr(trimmed)}"` +
      ` data-math-source="${b64}">\\(${escapeAttr(trimmed)}\\)</span>`
    );
  };

  // Pandoc wraps each formula in <span class="math inline|display">. Unwrap it
  // first so the delimiters below are not left inside a stray wrapper.
  let out = html.replace(
    /<span[^>]*class="[^"]*\bmath\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi,
    (_m, inner: string) => inner,
  );

  // Both delimiters in ONE pass, deliberately. Running them as two sequential
  // replaces double-wraps display math: the \[...\] pass emits a span whose own
  // text is \(latex\), which the \(...\) pass then matches and wraps again.
  out = out.replace(
    /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)/g,
    (_m, display: string | undefined, inline: string | undefined) =>
      span(display ?? inline ?? ''),
  );

  return out;
}

/* --- Table parsing -------------------------------------------------------- */

const REMOTE = /^(https?:)?\/\//i;

/**
 * A DOM element as cheerio hands it back.
 *
 * Taken from cheerio's own array element type rather than imported from
 * domhandler: domhandler is only present transitively, so naming it here would
 * couple this file to cheerio's dependency tree.
 */
type El = ReturnType<cheerio.CheerioAPI>['0'];

function cellHtml($: cheerio.CheerioAPI, el: El): string {
  const raw = $(el).html() ?? '';
  return mathToEditorSpans(raw).trim();
}

function cellText($: cheerio.CheerioAPI, el: El): string {
  return $(el).text().replace(/\s+/g, ' ').trim();
}

/** Strips tags so a cell can be compared or parsed as a plain value. */
function toPlain(html?: string): string {
  if (!html) return '';
  return cheerio
    .load(`<div>${html}</div>`)('div')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when the row looks like a header rather than a question. */
function looksLikeHeader(cells: string[]): boolean {
  const keys = cells.map(matchHeader).filter(Boolean);
  // A header must name the question column; anything else is guesswork.
  return keys.includes('question');
}

export function parseDocxHtml(html: string): ParseResult {
  const $ = cheerio.load(html ?? '');
  const issues: Issue[] = [];
  const imageSources = new Set<string>();

  const tables = $('table').toArray();
  if (tables.length === 0) {
    return {
      headers: [],
      unknownHeaders: [],
      rows: [],
      imageSources: [],
      issues: [
        {
          code: 'NO_TABLE',
          severity: 'BLOCKING',
          message:
            'No table found in the document. Questions must be in one table ' +
            'with a header row.',
        },
      ],
    };
  }

  // Take the first table whose first row is a usable header. Word documents
  // routinely open with a title or instructions table.
  let table: El | null = null;
  let headerCells: El[] = [];
  for (const t of tables) {
    const cells = $(t).find('tr').first().find('th,td').toArray();
    if (cells.length && looksLikeHeader(cells.map((c) => cellText($, c)))) {
      table = t;
      headerCells = cells;
      break;
    }
  }

  if (!table) {
    return {
      headers: [],
      unknownHeaders: [],
      rows: [],
      imageSources: [],
      issues: [
        {
          code: 'NO_HEADER',
          severity: 'BLOCKING',
          message:
            'No header row found. The first row of the table must name the ' +
            'columns, and one of them must be "Question".',
        },
      ],
    };
  }

  const headers = headerCells.map((c) => {
    const raw = cellText($, c);
    return { raw, key: matchHeader(raw) };
  });

  const unknownHeaders = headers
    .filter((h) => !h.key && h.raw)
    .map((h) => h.raw);
  if (unknownHeaders.length) {
    issues.push({
      code: 'UNKNOWN_HEADERS',
      severity: 'WARNING',
      message:
        'These columns were not recognised and were kept but not used: ' +
        unknownHeaders.join(', ') +
        '.',
    });
  }

  const seen = new Map<string, number>();
  for (const h of headers) {
    if (!h.key) continue;
    seen.set(h.key, (seen.get(h.key) ?? 0) + 1);
  }
  for (const [key, count] of seen) {
    if (count > 1) {
      issues.push({
        code: 'DUPLICATE_HEADER',
        severity: 'WARNING',
        message: `The "${key}" column appears ${count} times; the last one wins.`,
      });
    }
  }

  const bodyRows = $(table).find('tr').toArray().slice(1);
  const rows: ParsedRow[] = [];

  bodyRows.forEach((tr: El, i: number) => {
    const cells = $(tr).find('td,th').toArray();
    // A row of empty cells is what a trailing blank line in Word looks like.
    if (cells.every((c) => !cellText($, c))) return;

    const raw: Record<string, string> = {};
    const byKey: Record<string, string> = {};
    const options: ParsedOption[] = [];

    cells.forEach((cell: El, ci: number) => {
      const header = headers[ci];
      const label = header?.raw || `column ${ci + 1}`;
      const htmlValue = cellHtml($, cell);
      raw[label] = htmlValue;

      $(cell)
        .find('img')
        .each((_n: number, img: El) => {
          const src = $(img).attr('src');
          if (src && !REMOTE.test(src) && !src.startsWith('data:')) {
            imageSources.add(src);
          }
        });

      const key = header?.key;
      if (!key) return;
      if (key.startsWith('option:')) {
        const letter = key.slice('option:'.length);
        if (htmlValue) options.push({ letter, html: htmlValue });
        return;
      }
      byKey[key] = htmlValue;
    });

    const rowIssues: Issue[] = [];

    const bodyHtml = byKey.question ?? '';
    if (!toPlain(bodyHtml) && !/<img/i.test(bodyHtml)) {
      rowIssues.push({
        code: 'NO_QUESTION',
        severity: 'BLOCKING',
        message: 'This row has no question text.',
      });
    }

    const answerRaw = toPlain(byKey.answer);
    if (!answerRaw) {
      rowIssues.push({
        code: 'NO_ANSWER',
        severity: 'BLOCKING',
        message: 'This row has no answer.',
      });
    }

    let marks: number | undefined;
    const marksRaw = toPlain(byKey.marks);
    if (marksRaw) {
      const n = Number(marksRaw);
      if (Number.isFinite(n) && n > 0) {
        marks = Math.round(n);
      } else {
        rowIssues.push({
          code: 'BAD_MARKS',
          severity: 'WARNING',
          message: `Marks "${marksRaw}" is not a positive number; 1 was used.`,
        });
      }
    }

    const videoUrl = toPlain(byKey.solutionVideo);
    if (videoUrl && !REMOTE.test(videoUrl)) {
      rowIssues.push({
        code: 'BAD_VIDEO_URL',
        severity: 'WARNING',
        message: `Solution video "${videoUrl}" is not a URL; it was ignored.`,
      });
    }

    rows.push({
      rowIndex: i + 1,
      raw,
      numberRaw: toPlain(byKey.no) || undefined,
      bodyHtml,
      options: options.sort((a, b) => a.letter.localeCompare(b.letter)),
      answerRaw: answerRaw || undefined,
      typeRaw: toPlain(byKey.type) || undefined,
      subjectRaw: toPlain(byKey.subject) || undefined,
      chapterRaw: toPlain(byKey.chapter) || undefined,
      topicRaw: toPlain(byKey.topic) || undefined,
      subtopicRaw: toPlain(byKey.subtopic) || undefined,
      difficultyRaw: toPlain(byKey.difficulty) || undefined,
      explanationHtml: byKey.explanation || undefined,
      solutionVideoUrl: videoUrl && REMOTE.test(videoUrl) ? videoUrl : undefined,
      marks,
      issues: rowIssues,
    });
  });

  if (rows.length === 0) {
    issues.push({
      code: 'NO_ROWS',
      severity: 'BLOCKING',
      message: 'The table has a header but no question rows.',
    });
  }

  return {
    headers,
    unknownHeaders,
    rows,
    issues,
    imageSources: [...imageSources],
  };
}

/* --- Answers -------------------------------------------------------------- */

/**
 * Turns the Answer cell into option flags for a choice question.
 *
 * Accepts "B", "b", "A,C", "A and C", "AC", "2" and "(B)" -- authors write all
 * of these and none of them are ambiguous once the option letters are known.
 * An answer naming an option that is not present is BLOCKING: silently
 * importing a question whose key points at nothing would produce a question
 * that can never be marked correct.
 */
export function resolveChoiceAnswer(
  answerRaw: string,
  options: ParsedOption[],
): { correct: Set<string>; issues: Issue[] } {
  const issues: Issue[] = [];
  const letters = new Set(options.map((o) => o.letter));
  const correct = new Set<string>();

  const cleaned = answerRaw.replace(/\band\b/gi, ',').replace(/[()[\].]/g, ' ');
  const tokens = cleaned.split(/[\s,;/|&+]+/).filter(Boolean);

  for (const token of tokens) {
    const upper = token.toUpperCase();

    if (letters.has(upper)) {
      correct.add(upper);
      continue;
    }

    // "AC" meaning A and C -- only when every character is a known letter, so
    // a short text answer like "NO" is not silently read as options N and O.
    if (upper.length > 1 && [...upper].every((c) => letters.has(c))) {
      for (const c of upper) correct.add(c);
      continue;
    }

    // "2" meaning the second option.
    const asIndex = Number(upper);
    if (Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= options.length) {
      correct.add(options[asIndex - 1].letter);
      continue;
    }

    issues.push({
      code: 'ANSWER_NOT_AN_OPTION',
      severity: 'BLOCKING',
      message:
        `The answer "${token}" does not match any option ` +
        `(${[...letters].join(', ') || 'none present'}).`,
    });
  }

  if (correct.size === 0 && issues.length === 0) {
    issues.push({
      code: 'ANSWER_EMPTY',
      severity: 'BLOCKING',
      message: 'The answer cell is empty.',
    });
  }

  return { correct, issues };
}

/** Highest severity across a set of issues. */
export function worstSeverity(issues: Issue[]): Severity {
  if (issues.some((i) => i.severity === 'BLOCKING')) return 'BLOCKING';
  if (issues.some((i) => i.severity === 'WARNING')) return 'WARNING';
  return 'OK';
}
