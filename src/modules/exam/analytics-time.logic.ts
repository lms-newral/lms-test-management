/**
 * Time Management: where the three hours went.
 *
 * By subject, by what the time bought (right, wrong, nothing), and across the
 * paper from first quarter to last. The journey is built from the real visit
 * spans, so a visit straddling two quarters is split between them rather than
 * counted wherever it happened to start.
 *
 * Pure. Spec: test/exam/analytics-time.test.js.
 */

export interface VisitSpan {
  enterMs: number;
  leaveMs: number | null;
}

export interface TimeRow {
  questionId: string;
  subjectName: string | null;
  result: string;
  marks: number;
  timeMs: number;
  visits: number;
  lastAnsweredMs?: number | null;
  visitTimeline?: VisitSpan[] | null;
}

export interface SubjectTime {
  subject: string;
  questions: number;
  attempted: number;
  correct: number;
  accuracy: number | null;
  timeMs: number;
  share: number;
}

export interface OutcomeTime {
  correctMs: number;
  incorrectMs: number;
  unansweredMs: number;
  notSeenMs: number;
  totalMs: number;
}

export interface JourneyQuarter {
  quarter: number;
  fromMs: number;
  toMs: number;
  timeMs: number;
  answered: number;
  marks: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const ANSWERED = new Set(['CORRECT', 'INCORRECT', 'PARTIAL']);

export function timeBySubject(rows: TimeRow[]): SubjectTime[] {
  const total = rows.reduce((sum, r) => sum + r.timeMs, 0);
  const bySubject = new Map<string, SubjectTime>();
  for (const row of rows) {
    const subject = row.subjectName ?? 'Other';
    const entry = bySubject.get(subject) ?? {
      subject,
      questions: 0,
      attempted: 0,
      correct: 0,
      accuracy: null,
      timeMs: 0,
      share: 0,
    };
    entry.questions++;
    entry.timeMs += row.timeMs;
    if (ANSWERED.has(row.result)) entry.attempted++;
    if (row.result === 'CORRECT' || row.result === 'PARTIAL') entry.correct++;
    bySubject.set(subject, entry);
  }
  return [...bySubject.values()]
    .map((s) => ({
      ...s,
      accuracy:
        s.attempted > 0 ? round2((s.correct / s.attempted) * 100) : null,
      share: total > 0 ? round2((s.timeMs / total) * 100) : 0,
    }))
    .sort((a, b) => b.timeMs - a.timeMs);
}

export function timeByOutcome(rows: TimeRow[]): OutcomeTime {
  const out: OutcomeTime = {
    correctMs: 0,
    incorrectMs: 0,
    unansweredMs: 0,
    notSeenMs: 0,
    totalMs: 0,
  };
  for (const row of rows) {
    out.totalMs += row.timeMs;
    if (!row.visits) out.notSeenMs += row.timeMs;
    else if (row.result === 'CORRECT' || row.result === 'PARTIAL')
      out.correctMs += row.timeMs;
    else if (row.result === 'INCORRECT') out.incorrectMs += row.timeMs;
    else out.unansweredMs += row.timeMs;
  }
  return out;
}

/**
 * The paper split into equal windows. Time is clipped into each window it
 * overlaps; an answer counts in the window it was finally committed in.
 */
export function timeJourney(
  rows: TimeRow[],
  endMs: number,
  buckets = 4,
): JourneyQuarter[] {
  const size = endMs / buckets;
  const quarters: JourneyQuarter[] = Array.from(
    { length: buckets },
    (_, i) => ({
      quarter: i + 1,
      fromMs: Math.round(i * size),
      toMs: Math.round((i + 1) * size),
      timeMs: 0,
      answered: 0,
      marks: 0,
    }),
  );
  if (!(size > 0)) return quarters;

  for (const row of rows) {
    for (const visit of row.visitTimeline ?? []) {
      const from = visit.enterMs;
      const to = visit.leaveMs ?? endMs; // still open when the paper ended
      for (const quarter of quarters) {
        const overlap =
          Math.min(to, quarter.toMs) - Math.max(from, quarter.fromMs);
        if (overlap > 0) quarter.timeMs += overlap;
      }
    }
    // Only an answer that survived to the end: one that was cleared later is gone.
    const answeredAt = row.lastAnsweredMs;
    if (
      answeredAt !== null &&
      answeredAt !== undefined &&
      ANSWERED.has(row.result)
    ) {
      const index = Math.min(
        buckets - 1,
        Math.max(0, Math.floor(answeredAt / size)),
      );
      quarters[index].answered++;
      quarters[index].marks = round2(quarters[index].marks + row.marks);
    }
  }
  return quarters;
}
