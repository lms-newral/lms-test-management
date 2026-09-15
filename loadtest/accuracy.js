/**
 * Are the analytics right?
 *
 * Every student here follows a PLAN whose outcome is decided up front from the
 * NTA rules — not by running the app's replay. The events go through the real
 * pipeline (HTTP -> Redis Stream -> ingest worker -> finalize), and then the
 * stored per-question analytics are compared with the plan.
 *
 *   node loadtest/accuracy.js [students]
 */
const { API, prisma, seedPaper, createAttempts, chain, PAPER } = require('./lib');

const DWELL = 20_000; // every visit lasts exactly this long, so time is checkable
const STUDENTS = Number(process.argv[2] ?? 40);

const SCQ_PATTERNS = ['save_correct', 'save_wrong', 'draft_only', 'mark_only', 'save_mark', 'skipped', 'never', 'cleared', 'changed'];
const NAT_PATTERNS = ['nat_correct', 'nat_wrong', 'nat_draft', 'skipped', 'never'];

/** What the student does on this question, and what must therefore be stored. */
function planFor(q, pattern) {
  const correct = q.kernel === 'SINGLE_CHOICE' ? { choice: [q.correctIndex] } : { value: q.correctValue };
  const wrongIndex = (q.correctIndex + 1) % 4;
  const base = { pattern, visits: 1, revisit: false, answer: null, status: 'NOT_ANSWERED', correct: false, answerChanges: 0 };
  switch (pattern) {
    case 'save_correct':
      return { ...base, answer: correct, status: 'ANSWERED', correct: true };
    case 'save_wrong':
      return { ...base, answer: { choice: [wrongIndex] }, status: 'ANSWERED', correct: false };
    case 'draft_only': // selected but never saved: NTA keeps it unanswered
      return { ...base };
    case 'mark_only':
      return { ...base, status: 'MARKED' };
    case 'save_mark':
      return { ...base, answer: correct, status: 'ANSWERED_MARKED', correct: true };
    case 'skipped':
      return { ...base };
    case 'never':
      return { ...base, visits: 0, status: 'NOT_VISITED' };
    case 'cleared': // saved, then cleared on a second visit
      return { ...base, visits: 2, revisit: true };
    case 'changed': // wrong, then corrected on a second visit
      return { ...base, visits: 2, revisit: true, answer: correct, status: 'ANSWERED', correct: true, answerChanges: 1 };
    case 'nat_correct':
      return { ...base, answer: { value: q.correctValue }, status: 'ANSWERED', correct: true };
    case 'nat_wrong':
      return { ...base, answer: { value: q.correctValue + 1 }, status: 'ANSWERED', correct: false };
    case 'nat_draft':
      return { ...base };
    default:
      throw new Error(`unknown pattern ${pattern}`);
  }
}

/** The events a plan produces, with the timings that make time-per-question exact. */
function buildStream(questions, plans) {
  const events = [];
  let t = 0;
  let seq = 0;
  const push = (type, q, data) => events.push({ seq: ++seq, t, type, q: q ?? null, data: data ?? null });

  for (const [i, q] of questions.entries()) {
    const plan = plans[i];
    if (plan.pattern === 'never') continue;
    const enter = t;
    push('VISIT', q.id, { via: 'NEXT' });
    t += 5_000;
    switch (plan.pattern) {
      case 'save_correct':
      case 'save_mark':
      case 'cleared':
        push('SELECT', q.id, { choice: [q.correctIndex] });
        t += 5_000;
        push(plan.pattern === 'save_mark' ? 'SAVE_MARK' : 'SAVE_NEXT', q.id);
        break;
      case 'save_wrong':
      case 'changed':
        push('SELECT', q.id, { choice: [(q.correctIndex + 1) % 4] });
        t += 5_000;
        push('SAVE_NEXT', q.id);
        break;
      case 'draft_only':
        push('SELECT', q.id, { choice: [q.correctIndex] });
        break;
      case 'mark_only':
        push('MARK_NEXT', q.id);
        break;
      case 'nat_correct':
        push('SELECT', q.id, { text: String(q.correctValue) });
        t += 5_000;
        push('SAVE_NEXT', q.id);
        break;
      case 'nat_wrong':
        push('SELECT', q.id, { text: String(q.correctValue + 1) });
        t += 5_000;
        push('SAVE_NEXT', q.id);
        break;
      case 'nat_draft':
        push('SELECT', q.id, { text: String(q.correctValue) });
        break;
      case 'skipped':
      default:
        break;
    }
    t = enter + DWELL;
  }

  // Second pass: the questions the student comes back to.
  for (const [i, q] of questions.entries()) {
    const plan = plans[i];
    if (!plan.revisit) continue;
    const enter = t;
    push('VISIT', q.id, { via: 'PALETTE' });
    t += 5_000;
    if (plan.pattern === 'cleared') push('CLEAR', q.id);
    else {
      push('SELECT', q.id, { choice: [q.correctIndex] });
      t += 5_000;
      push('SAVE_NEXT', q.id);
    }
    t = enter + DWELL;
  }

  push('SUBMIT', null, { reason: 'MANUAL' });
  return events;
}

/** When the still-open visit of this question started (the last VISIT event for it). */
function visitStart(events, qid) {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].type === 'VISIT' && events[i].q === qid) return events[i].t;
  return 0;
}

/** Attempt-any-N: only the first N answered questions of a section count. */
function applyAttemptLimit(questions, plans) {
  const perSection = new Map();
  const evaluated = new Map();
  for (const [i, q] of questions.entries()) {
    if (!plans[i].answer) {
      evaluated.set(q.id, plans[i].answer !== null);
      continue;
    }
    const used = perSection.get(q.sectionId) ?? 0;
    const limit = q.attemptLimit ?? Infinity;
    const within = used < limit;
    perSection.set(q.sectionId, used + 1);
    evaluated.set(q.id, within);
  }
  return evaluated;
}

const post = async (attempt, events) => {
  const res = await fetch(`${API}/exam/attempts/${attempt.attemptId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-attempt-token': attempt.token },
    body: JSON.stringify({ events }),
  });
  if (!res.ok) throw new Error(`ingest ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
};

async function main() {
  const db = prisma();
  console.log(`Analytics accuracy: ${STUDENTS} students through the real pipeline\n`);
  const paper = await seedPaper(db);
  const attempts = await createAttempts(db, paper, STUDENTS, `acc${Date.now().toString(36)}`);
  const questions = paper.questions;

  // Plan every student, then send their events.
  const planned = attempts.map((attempt, s) => {
    const plans = questions.map((q, i) => {
      const set = q.kernel === 'NUMERIC' ? NAT_PATTERNS : SCQ_PATTERNS;
      return planFor(q, set[(i + s) % set.length]);
    });
    return { attempt, plans, evaluated: applyAttemptLimit(questions, plans) };
  });

  let sent = 0;
  const pool = 10;
  for (let i = 0; i < planned.length; i += pool) {
    await Promise.all(
      planned.slice(i, i + pool).map(async (p) => {
        const events = chain('0'.repeat(64), buildStream(questions, p.plans));
        p.events = events;
        for (let k = 0; k < events.length; k += 100) await post(p.attempt, events.slice(k, k + 100));
        sent += events.length;
      }),
    );
    process.stdout.write(`\r  sent ${sent} events…`);
  }
  console.log(`\r  sent ${sent} events from ${planned.length} students.`);

  // Wait for ingest + scoring.
  const ids = attempts.map((a) => a.attemptId);
  const started = Date.now();
  let done = [];
  while (Date.now() - started < 180_000) {
    done = await db.examAttempt.findMany({ where: { id: { in: ids }, finalizedAt: { not: null } }, select: { id: true } });
    if (done.length === ids.length) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`  scored ${done.length}/${ids.length} attempts in ${Math.round((Date.now() - started) / 1000)}s\n`);

  // ── compare with the plan ──────────────────────────────────────────────────
  const rows = await db.examAttemptQuestion.findMany({ where: { attemptId: { in: ids } } });
  const byAttempt = new Map(ids.map((id) => [id, new Map()]));
  for (const r of rows) byAttempt.get(r.attemptId)?.set(r.questionId, r);
  const stored = await db.examAttempt.findMany({ where: { id: { in: ids } } });
  const attemptById = new Map(stored.map((a) => [a.id, a]));

  const fails = { status: [], answer: [], result: [], marks: [], time: [], visits: [], changes: [], score: [], maxMarks: [], missing: [], seq: [] };
  const note = (bucket, msg) => fails[bucket].length < 4 && fails[bucket].push(msg);

  for (const p of planned) {
    const a = attemptById.get(p.attempt.attemptId);
    const qs = byAttempt.get(p.attempt.attemptId);
    let expectedScore = 0;
    if (!a || !a.finalizedAt) {
      note('missing', `${p.attempt.attemptId} was never scored`);
      continue;
    }
    if (a.lastSeq !== p.events.length) note('seq', `${p.attempt.attemptId}: stored lastSeq ${a.lastSeq}, sent ${p.events.length}`);

    for (const [i, q] of questions.entries()) {
      const plan = p.plans[i];
      const row = qs.get(q.id);
      if (!row) {
        note('missing', `${q.id} has no analytics row`);
        continue;
      }
      const evaluated = plan.answer ? p.evaluated.get(q.id) : false;
      const expectedResult = !plan.answer ? 'UNANSWERED' : !evaluated ? 'NOT_EVALUATED' : plan.correct ? 'CORRECT' : 'INCORRECT';
      const expectedMarks = expectedResult === 'CORRECT' ? PAPER.marks : expectedResult === 'INCORRECT' ? -PAPER.negative : 0;
      expectedScore += expectedMarks;

      if (row.status !== plan.status) note('status', `${q.id} (${plan.pattern}): status ${row.status}, expected ${plan.status}`);
      const answerMatches = JSON.stringify(row.answer ?? null) === JSON.stringify(plan.answer);
      if (!answerMatches) note('answer', `${q.id} (${plan.pattern}): answer ${JSON.stringify(row.answer)}, expected ${JSON.stringify(plan.answer)}`);
      if (row.result !== expectedResult) note('result', `${q.id} (${plan.pattern}): result ${row.result}, expected ${expectedResult}`);
      if (Number(row.marks) !== expectedMarks) note('marks', `${q.id} (${plan.pattern}): marks ${row.marks}, expected ${expectedMarks}`);
      if (row.visits !== plan.visits) note('visits', `${q.id} (${plan.pattern}): visits ${row.visits}, expected ${plan.visits}`);
      const expectedTime = plan.visits * DWELL;
      if (Math.abs(row.timeMs - expectedTime) > 50) note('time', `${q.id} (${plan.pattern}): timeMs ${row.timeMs}, expected ${expectedTime}`);
      if (row.answerChanges !== plan.answerChanges) note('changes', `${q.id} (${plan.pattern}): answerChanges ${row.answerChanges}, expected ${plan.answerChanges}`);
    }

    if (Number(a.score) !== expectedScore) note('score', `${p.attempt.attemptId}: score ${a.score}, expected ${expectedScore}`);
    const expectedMax = PAPER.subjects.length * (PAPER.scqPerSubject + PAPER.natAttemptLimit) * PAPER.marks;
    if (Number(a.maxMarks) !== expectedMax) note('maxMarks', `${p.attempt.attemptId}: maxMarks ${a.maxMarks}, expected ${expectedMax}`);
  }

  const labels = {
    status: 'question status (Answered / Marked / Not Answered / Not Visited)',
    answer: 'stored answer',
    result: 'correct / incorrect / not evaluated',
    marks: 'marks per question',
    time: 'time per question',
    visits: 'visit count',
    changes: 'answer changes',
    score: 'total score',
    maxMarks: 'maximum marks (attempt-any-N)',
    missing: 'analytics rows present',
    seq: 'every event stored (no loss)',
  };
  let bad = 0;
  console.log('Checks');
  for (const [k, label] of Object.entries(labels)) {
    const ok = fails[k].length === 0;
    if (!ok) bad++;
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    for (const f of fails[k]) console.log(`          ${f}`);
  }
  console.log(bad === 0 ? '\nAll analytics matched the plan.' : `\n${bad} group(s) did not match.`);
  await db.$disconnect();
  process.exit(bad === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
