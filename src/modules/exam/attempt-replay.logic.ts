/**
 * Replays an attempt's events into per-question state, following NTA rules:
 * an option click is only a draft; SAVE_NEXT / SAVE_MARK commit it; MARK_NEXT
 * marks without saving; CLEAR removes the response (the mark stays); moving to
 * another question discards an unsaved draft.
 *
 * Also derives what analytics need: every visit, answer history, active / idle /
 * hidden time, offline and outside-full-screen time, bookmarks, reports, scroll.
 *
 * Pure: shared by the finalize worker (scoring, analytics) and, as a copy, by the
 * exam screen (palette). Specs: test/exam/attempt-replay.test.js and
 * test/exam/attempt-replay-insights.test.js.
 */

export interface PaperSection {
  id: string;
  subjectName: string;
  name: string;
}

export interface PaperQuestion {
  id: string;
  sectionId: string;
  kernel: string;
  optionCount: number;
}

export interface Paper {
  sections: PaperSection[];
  questions: PaperQuestion[];
}

export interface ExamEvent {
  seq: number;
  t: number;
  type: string;
  q?: string | null;
  data?: unknown;
  hash?: string;
}

export type Answer = { choice: number[] } | { value: number };
export type Draft = { choice: number[] } | { text: string };
export type QuestionStatus = 'NOT_VISITED' | 'NOT_ANSWERED' | 'ANSWERED' | 'MARKED' | 'ANSWERED_MARKED';

export interface Visit {
  enterMs: number;
  leaveMs: number | null;
  hiddenMs: number;
}

export interface QuestionState {
  status: QuestionStatus;
  answer: Answer | null;
  draft: Draft | null;
  marked: boolean;
  visits: Visit[];
  timeMs: number;
  hiddenMs: number;
  activeMs: number;
  idleMs: number;
  firstSeenMs: number | null;
  firstAnsweredMs: number | null;
  lastAnsweredMs: number | null;
  answerChanges: number;
  answerHistory: { t: number; answer: Answer | null }[];
  selections: number;
  finalDraft: Draft | null;
  bookmarked: boolean;
  reported: boolean;
  maxScrollPct: number;
}

export interface ReplayResult {
  questions: Record<string, QuestionState>;
  visitOrder: string[];
  currentQuestionId: string | null;
  submitted: boolean;
  submitReason: string | null;
  submitMs: number | null;
  endMs: number;
  activeMs: number;
  offlineMs: number;
  outsideFullscreenMs: number;
  instructionsMs: number | null;
  copyAttempts: number;
  paletteToggles: number;
  device: Record<string, unknown> | null;
}

export const ACTIVITY_WINDOW_MS = 30_000;
const CHOICE_KERNELS = new Set(['SINGLE_CHOICE', 'MULTI_CHOICE']);
const INTERACTIONS = new Set(['VISIT', 'SELECT', 'SAVE_NEXT', 'SAVE_MARK', 'MARK_NEXT', 'CLEAR', 'SCROLL', 'BOOKMARK', 'REPORT', 'PALETTE', 'ACTIVE']);

/** A typed numeric answer, or null when it is not a plain decimal number. */
export function parseNumericAnswer(text: string): number | null {
  const s = (text ?? '').trim();
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** The draft after clicking option `index`: single choice replaces or deselects, multiple choice toggles. */
export function applyChoiceClick(kernel: string, draft: number[] | null, index: number): number[] {
  const base = draft ?? [];
  if (kernel === 'MULTI_CHOICE') {
    const set = new Set(base);
    if (set.has(index)) set.delete(index);
    else set.add(index);
    return [...set].sort((a, b) => a - b);
  }
  return base.length === 1 && base[0] === index ? [] : [index];
}

export function nextQuestionId(paper: Paper, questionId: string): string {
  const i = paper.questions.findIndex((q) => q.id === questionId);
  return paper.questions[(i + 1) % paper.questions.length].id;
}

export function prevQuestionId(paper: Paper, questionId: string): string | null {
  const i = paper.questions.findIndex((q) => q.id === questionId);
  return i > 0 ? paper.questions[i - 1].id : null;
}

export function firstQuestionOfSection(paper: Paper, sectionId: string): string | null {
  return paper.questions.find((q) => q.sectionId === sectionId)?.id ?? null;
}

const sameAnswer = (a: Answer | null, b: Answer | null) => JSON.stringify(a) === JSON.stringify(b);

function statusOf(s: QuestionState): QuestionStatus {
  const answered = s.answer !== null;
  if (s.marked) return answered ? 'ANSWERED_MARKED' : 'MARKED';
  if (answered) return 'ANSWERED';
  return s.visits.length > 0 ? 'NOT_ANSWERED' : 'NOT_VISITED';
}

function draftFrom(data: unknown): Draft | null {
  const d = (data ?? {}) as { choice?: unknown; text?: unknown };
  if (Array.isArray(d.choice)) {
    const choice = [...new Set(d.choice.filter((x): x is number => Number.isInteger(x)))].sort((a, b) => a - b);
    return { choice };
  }
  if (typeof d.text === 'string') return { text: d.text };
  return null;
}

/** The saved form of a draft, or null when it amounts to no answer. */
function answerFrom(kernel: string, draft: Draft): Answer | null {
  if (CHOICE_KERNELS.has(kernel)) {
    return 'choice' in draft && draft.choice.length > 0 ? { choice: draft.choice } : null;
  }
  if (kernel === 'NUMERIC') {
    const value = 'text' in draft ? parseNumericAnswer(draft.text) : null;
    return value === null ? null : { value };
  }
  return null;
}

// ─── interval helpers ────────────────────────────────────────────────────────

type Span = [number, number];

function union(spans: Span[]): Span[] {
  const sorted = spans.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Span[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function overlap(spans: Span[], from: number, to: number): Span[] {
  return spans.map(([a, b]): Span => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a);
}

const length = (spans: Span[]) => spans.reduce((sum, [a, b]) => sum + (b - a), 0);

function minus(spans: Span[], cut: Span[]): Span[] {
  let out = spans;
  for (const [ca, cb] of cut) {
    out = out.flatMap(([a, b]): Span[] => {
      const pieces: Span[] = cb <= a || ca >= b ? [[a, b]] : [[a, Math.min(ca, b)], [Math.max(cb, a), b]];
      return pieces.filter(([x, y]) => y > x);
    });
  }
  return out;
}

/** Total length of open/close periods; an open period ends at `end`. */
function periods(marks: { t: number; open: boolean }[], end: number): Span[] {
  const spans: Span[] = [];
  let since: number | null = null;
  for (const m of marks) {
    if (m.open && since === null) since = m.t;
    if (!m.open && since !== null) {
      spans.push([since, m.t]);
      since = null;
    }
  }
  if (since !== null) spans.push([since, end]);
  return spans;
}

export function replayAttempt(paper: Paper, events: ExamEvent[], options: { endMs?: number } = {}): ReplayResult {
  const kernels = new Map(paper.questions.map((q) => [q.id, q.kernel]));
  const questions: Record<string, QuestionState> = {};
  for (const q of paper.questions) {
    questions[q.id] = {
      status: 'NOT_VISITED',
      answer: null,
      draft: null,
      marked: false,
      visits: [],
      timeMs: 0,
      hiddenMs: 0,
      activeMs: 0,
      idleMs: 0,
      firstSeenMs: null,
      firstAnsweredMs: null,
      lastAnsweredMs: null,
      answerChanges: 0,
      answerHistory: [],
      selections: 0,
      finalDraft: null,
      bookmarked: false,
      reported: false,
      maxScrollPct: 0,
    };
  }

  // One copy per seq (the first received wins), applied in seq order.
  const seen = new Set<number>();
  const ordered = events
    .filter((e) => (seen.has(e.seq) ? false : (seen.add(e.seq), true)))
    .sort((a, b) => a.seq - b.seq);

  const visitOrder: string[] = [];
  let current: string | null = null;
  let hiddenSince: number | null = null;
  let submitted = false;
  let submitReason: string | null = null;
  let submitMs: number | null = null;
  let lastT = 0;
  let instructionsMs: number | null = null;
  let device: Record<string, unknown> | null = null;
  let copyAttempts = 0;
  let paletteToggles = 0;
  const hiddenMarks: { t: number; open: boolean }[] = [];
  const offlineMarks: { t: number; open: boolean }[] = [];
  const fullscreenMarks: { t: number; open: boolean }[] = [];
  const activity: { q: string; visitIndex: number; t: number }[] = [];

  const openVisit = () => (current ? questions[current].visits.at(-1) ?? null : null);
  const closeVisit = (t: number) => {
    const visit = openVisit();
    if (!visit || visit.leaveMs !== null) return;
    if (hiddenSince !== null) {
      visit.hiddenMs += t - hiddenSince;
      hiddenSince = t; // still hidden for whatever comes next
    }
    visit.leaveMs = t;
  };
  const commit = (q: string, t: number) => {
    const s = questions[q];
    if (!s.draft) return; // untouched: the saved answer stays as it is
    const next = answerFrom(kernels.get(q) ?? '', s.draft);
    if (next === null) {
      if (s.answer !== null) s.answerHistory.push({ t, answer: null });
      s.answer = null;
    } else {
      if (s.answer && !sameAnswer(s.answer, next)) s.answerChanges++;
      if (!sameAnswer(s.answer, next)) s.answerHistory.push({ t, answer: next });
      if (s.firstAnsweredMs === null) s.firstAnsweredMs = t;
      s.lastAnsweredMs = t;
      s.answer = next;
    }
    s.draft = null;
  };

  for (const e of ordered) {
    lastT = e.t;
    const q = e.q && questions[e.q] ? e.q : null;
    const data = (e.data ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case 'VISIT':
        if (!q || q === current) break;
        closeVisit(e.t);
        if (current) questions[current].draft = null; // leaving discards an unsaved draft
        current = q;
        questions[q].visits.push({ enterMs: e.t, leaveMs: null, hiddenMs: 0 });
        if (questions[q].firstSeenMs === null) questions[q].firstSeenMs = e.t;
        visitOrder.push(q);
        break;
      case 'SELECT':
        if (q) {
          questions[q].draft = draftFrom(e.data);
          questions[q].selections++;
        }
        break;
      case 'SAVE_NEXT':
        if (q) {
          commit(q, e.t);
          questions[q].marked = false;
        }
        break;
      case 'SAVE_MARK':
        if (q) {
          commit(q, e.t);
          questions[q].marked = true;
        }
        break;
      case 'MARK_NEXT':
        if (q) {
          questions[q].draft = null;
          questions[q].marked = true;
        }
        break;
      case 'CLEAR':
        if (q) {
          if (questions[q].answer !== null) questions[q].answerHistory.push({ t: e.t, answer: null });
          questions[q].answer = null;
          questions[q].draft = null;
        }
        break;
      case 'HIDDEN':
        if (hiddenSince === null) hiddenSince = e.t;
        hiddenMarks.push({ t: e.t, open: true });
        break;
      case 'VISIBLE': {
        const visit = openVisit();
        if (hiddenSince !== null && visit && visit.leaveMs === null) visit.hiddenMs += e.t - hiddenSince;
        hiddenSince = null;
        hiddenMarks.push({ t: e.t, open: false });
        break;
      }
      case 'OFFLINE':
        offlineMarks.push({ t: e.t, open: true });
        break;
      case 'ONLINE':
        offlineMarks.push({ t: e.t, open: false });
        break;
      case 'FULLSCREEN':
        fullscreenMarks.push({ t: e.t, open: data.inside === false });
        break;
      case 'BOOKMARK':
        if (q) questions[q].bookmarked = data.on === true;
        break;
      case 'REPORT':
        if (q) questions[q].reported = true;
        break;
      case 'SCROLL':
        if (q && typeof data.pct === 'number') {
          questions[q].maxScrollPct = Math.max(questions[q].maxScrollPct, Math.min(100, Math.max(0, data.pct)));
        }
        break;
      case 'COPY':
        copyAttempts++;
        break;
      case 'PALETTE':
        paletteToggles++;
        break;
      case 'START':
        if (typeof data.instructionsMs === 'number') instructionsMs = data.instructionsMs;
        break;
      case 'DEVICE':
        device = data;
        break;
      case 'SUBMIT': {
        if (current) questions[current].finalDraft = questions[current].draft;
        closeVisit(e.t);
        submitted = true;
        submitReason = typeof data.reason === 'string' ? data.reason : null;
        submitMs = e.t;
        break;
      }
      default:
        break;
    }
    // Activity belongs to the question open when it happens (a VISIT to its new question).
    if (INTERACTIONS.has(e.type) && current) {
      activity.push({ q: current, visitIndex: questions[current].visits.length - 1, t: e.t });
    }
    if (submitted) break;
  }

  const endMs = submitMs ?? options.endMs ?? lastT;
  if (!submitted && current) {
    questions[current].finalDraft = questions[current].draft;
    const open = openVisit();
    if (open && open.leaveMs === null && hiddenSince !== null) open.hiddenMs += endMs - hiddenSince;
  }

  const hiddenSpans = union(periods(hiddenMarks, endMs));
  let activeTotal = 0;
  for (const [id, s] of Object.entries(questions)) {
    s.timeMs = s.visits.reduce((sum, v) => sum + ((v.leaveMs ?? endMs) - v.enterMs), 0);
    s.hiddenMs = s.visits.reduce((sum, v) => sum + v.hiddenMs, 0);
    s.activeMs = s.visits.reduce((sum, v, index) => {
      const to = v.leaveMs ?? endMs;
      const windows = activity
        .filter((a) => a.q === id && a.visitIndex === index)
        .map((a): Span => [a.t - ACTIVITY_WINDOW_MS, a.t]);
      const covered = overlap(union(windows), v.enterMs, to);
      return sum + length(minus(covered, overlap(hiddenSpans, v.enterMs, to)));
    }, 0);
    s.idleMs = Math.max(0, s.timeMs - s.hiddenMs - s.activeMs);
    s.status = statusOf(s);
    activeTotal += s.activeMs;
  }

  return {
    questions,
    visitOrder,
    currentQuestionId: current,
    submitted,
    submitReason,
    submitMs,
    endMs,
    activeMs: activeTotal,
    offlineMs: length(union(periods(offlineMarks, endMs))),
    outsideFullscreenMs: length(union(periods(fullscreenMarks, endMs))),
    instructionsMs,
    copyAttempts,
    paletteToggles,
    device,
  };
}
