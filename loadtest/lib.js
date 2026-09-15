/**
 * Shared pieces for the exam load and accuracy runs.
 *
 * Everything here writes to a THROWAWAY database (LOADTEST_DATABASE_URL), never
 * the service's real one: a load run creates millions of rows.
 */
const { PrismaClient } = require('@prisma/client');
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_URL = process.env.LOADTEST_DATABASE_URL || 'postgresql://loadtest:loadtest@localhost:55432/examload';
const TENANT = 'loadtest-tenant';
const API = process.env.LOADTEST_API || 'http://localhost:5858';

if (/supabase|pooler/i.test(DB_URL)) {
  throw new Error('Refusing to run a load test against the real database. Point LOADTEST_DATABASE_URL at a throwaway Postgres.');
}

/** The service's own signing code, so tokens are valid for the running API. */
const { signAttemptToken } = require('../dist/src/modules/exam/attempt-ingest.logic');

function secret() {
  const fromEnv = process.env.EXAM_TOKEN_SECRET;
  if (fromEnv) return fromEnv;
  const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
  const m = env.match(/^EXAM_TOKEN_SECRET=(.*)$/m);
  if (!m) throw new Error('EXAM_TOKEN_SECRET not found');
  return m[1].trim().replace(/^"|"$/g, '');
}

const prisma = () => new PrismaClient({ datasources: { db: { url: DB_URL } } });

// ── event chain (identical to the browser and the server) ────────────────────

const GENESIS = '0'.repeat(64);
const sortKeys = (v) =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]))
      : v;

function eventHash(prev, e) {
  const canonical = JSON.stringify(sortKeys({ seq: e.seq, t: e.t, type: e.type, q: e.q ?? null, data: e.data ?? null }));
  return createHash('sha256').update(`${prev}|${canonical}`).digest('hex');
}

function chain(prevHash, events) {
  let prev = prevHash;
  return events.map((e) => {
    const hash = eventHash(prev, e);
    prev = hash;
    return { ...e, hash };
  });
}

// ── the paper: a JEE Main shape ──────────────────────────────────────────────

const PAPER = {
  subjects: ['Physics', 'Chemistry', 'Maths'],
  scqPerSubject: 20, // Section A: single choice, +4 / -1
  natPerSubject: 10, // Section B: numeric, +4 / -1, attempt any 5
  marks: 4,
  negative: 1,
  natAttemptLimit: 5,
};

const option = (i) => ({ text: `<p>Option ${i + 1}</p>` });

/** Creates the format, the questions and their frozen snapshots, the test, the series and its node. */
async function seedPaper(db) {
  const now = new Date();
  const format = await db.testFormat.create({
    data: {
      tenantId: TENANT,
      name: 'Load test JEE Main format',
      status: 'ACTIVE',
      durationMinutes: 180,
      instructionsHtml: '<p>Load test</p>',
      createdById: 'loadtest',
    },
  });

  const questions = [];
  let orderIndex = 0;
  for (const [s, subjectName] of PAPER.subjects.entries()) {
    const subject = await db.testFormatSubject.create({
      data: {
        formatId: format.id,
        subjectName,
        totalQuestions: PAPER.scqPerSubject + PAPER.natPerSubject,
        totalMarks: (PAPER.scqPerSubject + PAPER.natAttemptLimit) * PAPER.marks,
        orderIndex: s,
      },
    });
    for (const [x, part] of [
      { name: 'Section A', kernel: 'SINGLE_CHOICE', code: 'SCQ', count: PAPER.scqPerSubject, attemptLimit: null },
      { name: 'Section B', kernel: 'NUMERIC', code: 'NAT', count: PAPER.natPerSubject, attemptLimit: PAPER.natAttemptLimit },
    ].entries()) {
      const section = await db.testFormatSection.create({
        data: { formatSubjectId: subject.id, name: part.name, orderIndex: x },
      });
      const row = await db.testFormatRow.create({
        data: {
          sectionId: section.id,
          questionTypeCode: part.code,
          kernel: part.kernel,
          questionCount: part.count,
          attemptLimit: part.attemptLimit,
          marksPerQuestion: PAPER.marks,
          negativeMarks: PAPER.negative,
          partialMarking: false,
          orderIndex: 0,
        },
      });
      for (let i = 0; i < part.count; i++) {
        questions.push({
          subjectName,
          sectionId: section.id,
          sectionName: part.name,
          rowId: row.id,
          kernel: part.kernel,
          code: part.code,
          attemptLimit: part.attemptLimit,
          orderIndex: orderIndex++,
          // The answer key: SCQ cycles through the four options, NAT is a round number.
          correctIndex: part.kernel === 'SINGLE_CHOICE' ? orderIndex % 4 : null,
          correctValue: part.kernel === 'NUMERIC' ? 10 + (orderIndex % 50) : null,
        });
      }
    }
  }

  const test = await db.test.create({
    data: {
      tenantId: TENANT,
      formatId: format.id,
      name: 'Load test full syllabus mock',
      status: 'PUBLISHED',
      publishedAt: now,
      durationMinutes: 180,
      createdById: 'loadtest',
    },
  });

  // Questions plus the frozen snapshots the scorer reads.
  await db.question.createMany({
    data: questions.map((q, i) => ({
      id: questionId(i),
      tenantId: TENANT,
      createdById: 'loadtest',
      questionText: `<p>${q.subjectName} ${q.code} question ${i + 1}</p>`,
      questionType: 'MCQ',
      marks: PAPER.marks,
      orderIndex: q.orderIndex,
      mcqOptions: q.kernel === 'SINGLE_CHOICE' ? [0, 1, 2, 3].map(option) : undefined,
      explanation: `<p>Because of step ${i + 1}.</p>`,
    })),
    skipDuplicates: true, // the bank rows are reused between runs
  });
  await db.questionUsage.createMany({
    data: questions.map((q, i) => ({
      tenantId: TENANT,
      questionId: questionId(i),
      usedInType: 'TEST',
      usedInId: test.id,
      version: 1,
      orderIndex: q.orderIndex,
      marks: PAPER.marks,
      negativeMarks: PAPER.negative,
      snapshot: {
        snapshotVersion: 1,
        questionId: questionId(i),
        questionText: `<p>${q.subjectName} ${q.code} question ${i + 1}</p>`,
        type: { code: q.code, kernel: q.kernel },
        mcqOptions:
          q.kernel === 'SINGLE_CHOICE'
            ? [0, 1, 2, 3].map((o) => ({ text: `<p>Option ${o + 1}</p>`, isCorrect: o === q.correctIndex }))
            : null,
        answerConfig: q.kernel === 'NUMERIC' ? { value: q.correctValue, tolerance: 0 } : null,
        explanation: `<p>Because of step ${i + 1}.</p>`,
        solutions: [],
        taxonomy: { chapter: { id: `ch-${i % 7}`, name: `Chapter ${i % 7}` }, topic: null, subtopic: null },
        difficulty: { code: ['EASY', 'MEDIUM', 'HARD'][i % 3] },
        marking: {
          rowId: q.rowId,
          questionTypeCode: q.code,
          kernel: q.kernel,
          marks: PAPER.marks,
          negativeMarks: PAPER.negative,
          partialMarking: false,
          attemptLimit: q.attemptLimit,
        },
      },
    })),
  });

  const series = await db.testSeries.create({
    data: {
      tenantId: TENANT,
      name: 'Load test series',
      status: 'PUBLISHED',
      publishedAt: now,
      startAt: new Date(now.getTime() - 86400_000),
      endAt: new Date(now.getTime() + 30 * 86400_000),
      createdById: 'loadtest',
    },
  });
  const node = await db.testSeriesNode.create({
    data: {
      seriesId: series.id,
      kind: 'TEST',
      testId: test.id,
      availableFrom: new Date(now.getTime() - 3600_000),
      availableTo: new Date(now.getTime() + 6 * 3600_000),
      resultAt: new Date(now.getTime() + 7 * 3600_000),
      orderIndex: 0,
    },
  });

  return { testId: test.id, seriesId: series.id, nodeId: node.id, questions: questions.map((q, i) => ({ ...q, id: questionId(i) })) };
}

const questionId = (i) => `loadtest-q-${String(i).padStart(4, '0')}`;

/** Attempts straight in the database, so a load run does not depend on login. */
async function createAttempts(db, paper, count, prefix) {
  const now = new Date();
  const deadline = new Date(now.getTime() + 180 * 60_000);
  const rows = [];
  for (let i = 0; i < count; i++) {
    rows.push({
      id: `${prefix}-${String(i).padStart(6, '0')}`,
      tenantId: TENANT,
      testId: paper.testId,
      seriesId: paper.seriesId,
      seriesNodeId: paper.nodeId,
      userId: `${prefix}-user-${i}`,
      userName: `Load Student ${i}`,
      startedAt: now,
      deadline,
      resultAt: new Date(now.getTime() + 7 * 3600_000),
    });
  }
  for (let i = 0; i < rows.length; i += 2000) {
    await db.examAttempt.createMany({ data: rows.slice(i, i + 2000), skipDuplicates: true });
  }
  const key = secret();
  return rows.map((r) => ({
    attemptId: r.id,
    token: signAttemptToken({ attemptId: r.id, userId: r.userId, tenantId: TENANT, exp: deadline.getTime() + 86400_000 }, key),
  }));
}

module.exports = { API, DB_URL, TENANT, PAPER, GENESIS, prisma, seedPaper, createAttempts, chain, eventHash, questionId, secret };
