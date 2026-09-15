// SPEC (written before the code): scoring an attempt against the frozen paper.
//
// Keys and marking come from QuestionUsage.snapshot (options[].isCorrect,
// answerConfig { value, tolerance, integerOnly }, marking { marks, negativeMarks,
// partialMarking, attemptLimit }). A wrong rule here is a wrong rank for
// every student, so the JEE rules are spelled out case by case.
//
// Module under test: src/modules/exam/attempt-scoring.logic.ts
//   scoreQuestion(key, marking, answer) -> { result: CORRECT|INCORRECT|PARTIAL|UNANSWERED, marks }
//   scoreAttempt(sheet, states) -> totals, per-subject totals and per-question results
const { scoreQuestion, scoreAttempt } = require('../../dist/src/modules/exam/attempt-scoring.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const T = { isCorrect: true };
const F = { isCorrect: false };
const scq = { kernel: 'SINGLE_CHOICE', options: [F, T, F, F], answerConfig: null };
const mcq = { kernel: 'MULTI_CHOICE', options: [T, T, T, F], answerConfig: null };
const mcqOne = { kernel: 'MULTI_CHOICE', options: [F, T, F, F], answerConfig: null };
const nat = { kernel: 'NUMERIC', options: null, answerConfig: { value: 9.8, tolerance: 0.1 } };
const int = { kernel: 'NUMERIC', options: null, answerConfig: { value: 2, tolerance: 0, integerOnly: true } };
const main = { marks: 4, negativeMarks: 1, partialMarking: false };
const adv = { marks: 4, negativeMarks: 2, partialMarking: true };
const noNeg = { marks: 4, negativeMarks: 0, partialMarking: false };
const is = (got, result, marks) => got && got.result === result && got.marks === marks;

/* --- 1. Single correct ------------------------------------------------------ */

check('SCQ correct gets full marks', is(scoreQuestion(scq, main, { choice: [1] }), 'CORRECT', 4));
check('SCQ wrong loses the negative marks', is(scoreQuestion(scq, main, { choice: [0] }), 'INCORRECT', -1));
check('SCQ unanswered scores 0', is(scoreQuestion(scq, main, null), 'UNANSWERED', 0));
check('SCQ with an option index that does not exist is wrong', is(scoreQuestion(scq, main, { choice: [9] }), 'INCORRECT', -1));
check('SCQ with two options chosen is wrong', is(scoreQuestion(scq, main, { choice: [1, 2] }), 'INCORRECT', -1));
check('no negative marking means a wrong answer scores 0', is(scoreQuestion(scq, noNeg, { choice: [0] }), 'INCORRECT', 0));

/* --- 2. Multiple correct ---------------------------------------------------- */

check('MCQ partial: all correct options chosen gets full marks', is(scoreQuestion(mcq, adv, { choice: [0, 1, 2] }), 'CORRECT', 4));
check('MCQ partial: 2 of 3 correct, none wrong, gets +2', is(scoreQuestion(mcq, adv, { choice: [0, 2] }), 'PARTIAL', 2));
check('MCQ partial: 1 of 3 correct, none wrong, gets +1', is(scoreQuestion(mcq, adv, { choice: [1] }), 'PARTIAL', 1));
check('MCQ partial: any wrong option loses the negative marks', is(scoreQuestion(mcq, adv, { choice: [0, 1, 3] }), 'INCORRECT', -2));
check('MCQ partial: nothing chosen scores 0', is(scoreQuestion(mcq, adv, null), 'UNANSWERED', 0));
check('MCQ partial: a single correct option chosen when only one is correct is full marks', is(scoreQuestion(mcqOne, adv, { choice: [1] }), 'CORRECT', 4));
check('MCQ without partial marking: exact set is full marks', is(scoreQuestion(mcq, main, { choice: [0, 1, 2] }), 'CORRECT', 4));
check('MCQ without partial marking: a correct subset is wrong', is(scoreQuestion(mcq, main, { choice: [0, 1] }), 'INCORRECT', -1));
check('MCQ: order of chosen options does not matter', is(scoreQuestion(mcq, adv, { choice: [2, 0, 1] }), 'CORRECT', 4));

/* --- 3. Numerical ----------------------------------------------------------- */

check('NAT exact value is correct', is(scoreQuestion(nat, main, { value: 9.8 }), 'CORRECT', 4));
check('NAT inside tolerance is correct', is(scoreQuestion(nat, main, { value: 9.85 }), 'CORRECT', 4));
check('NAT exactly at the tolerance edge is correct (no float error)', is(scoreQuestion(nat, main, { value: 9.9 }), 'CORRECT', 4) && is(scoreQuestion(nat, main, { value: 9.7 }), 'CORRECT', 4));
check('NAT just outside tolerance is wrong', is(scoreQuestion(nat, main, { value: 9.91 }), 'INCORRECT', -1));
check('integer type: the integer is correct', is(scoreQuestion(int, main, { value: 2 }), 'CORRECT', 4));
check('integer type: a decimal is wrong', is(scoreQuestion(int, main, { value: 2.5 }), 'INCORRECT', -1));
check('integer type: another integer is wrong', is(scoreQuestion(int, main, { value: 3 }), 'INCORRECT', -1));
check('NAT unanswered scores 0', is(scoreQuestion(nat, main, null), 'UNANSWERED', 0));

/* --- 4. A whole attempt: the result summary from the reference screenshot -- */
// Physics, 4 single-correct questions, +4 / -1:
// q1 answered wrong, q2 opened but skipped, q3 and q4 never opened.
// Expected: score -1/16, correct 0/4, incorrect 1/4, skipped 1/4, not seen 2/4, accuracy 0%.

const sheetRow = (questionId, orderIndex, key, marking = { ...main, attemptLimit: null, rowId: 'r1' }, subjectName = 'Physics') =>
  ({ questionId, subjectName, orderIndex, key, marking });
const phySheet = [sheetRow('q1', 0, scq), sheetRow('q2', 1, scq), sheetRow('q3', 2, scq), sheetRow('q4', 3, scq)];
const reference = scoreAttempt(phySheet, {
  q1: { status: 'ANSWERED', answer: { choice: [3] } },
  q2: { status: 'NOT_ANSWERED', answer: null },
  q3: { status: 'NOT_VISITED', answer: null },
  q4: { status: 'NOT_VISITED', answer: null },
});
const P = reference.subjects.Physics;
check('reference: total -1 out of 16', reference.total === -1 && reference.maxMarks === 16, JSON.stringify([reference.total, reference.maxMarks]));
check('reference: correct 0, incorrect 1, skipped 1, not seen 2', P.correct === 0 && P.incorrect === 1 && P.skipped === 1 && P.notSeen === 2, JSON.stringify(P));
check('reference: 1 attempted, accuracy 0%', reference.attempted === 1 && reference.accuracy === 0);
check('reference: marks gained 0, marks deducted -1', reference.gained === 0 && reference.deducted === -1);
check('reference: the subject row matches the overall row', P.total === -1 && P.maxMarks === 16);

/* --- 5. Review states ------------------------------------------------------- */

const marked = scoreAttempt([sheetRow('m1', 0, scq), sheetRow('m2', 1, scq)], {
  m1: { status: 'MARKED', answer: null },
  m2: { status: 'ANSWERED_MARKED', answer: { choice: [1] } },
});
check('Marked for review without an answer scores 0 and counts as skipped', marked.questions.m1.marks === 0 && marked.subjects.Physics.skipped === 1);
check('Answered & Marked for review is evaluated', marked.questions.m2.result === 'CORRECT' && marked.total === 4);

/* --- 6. "Attempt any N" sections (JEE Main Section B style) ----------------- */

const limited = { ...main, attemptLimit: 2, rowId: 'nat5' };
const natSheet = [sheetRow('n1', 0, nat, limited), sheetRow('n2', 1, nat, limited), sheetRow('n3', 2, nat, limited)];
const allAnswered = scoreAttempt(natSheet, {
  n1: { status: 'ANSWERED', answer: { value: 9.8 } },
  n2: { status: 'ANSWERED', answer: { value: 9.8 } },
  n3: { status: 'ANSWERED', answer: { value: 9.8 } },
});
check('only the first N answered questions (paper order) are evaluated', allAnswered.questions.n1.marks === 4 && allAnswered.questions.n2.marks === 4);
check('answers beyond N are not evaluated and score 0', allAnswered.questions.n3.result === 'NOT_EVALUATED' && allAnswered.questions.n3.marks === 0);
check('the section maximum is N x marks', allAnswered.maxMarks === 8 && allAnswered.total === 8);

const skipFirst = scoreAttempt(natSheet, {
  n1: { status: 'NOT_ANSWERED', answer: null },
  n2: { status: 'ANSWERED', answer: { value: 1 } },
  n3: { status: 'ANSWERED', answer: { value: 9.8 } },
});
check('unanswered questions do not use up the N', skipFirst.questions.n2.result === 'INCORRECT' && skipFirst.questions.n3.result === 'CORRECT');
check('...so both answered ones count', skipFirst.total === 3);

/* --- 7. Several subjects ---------------------------------------------------- */

const mixed = scoreAttempt(
  [
    sheetRow('p1', 0, scq), sheetRow('p2', 1, mcq, { ...adv, attemptLimit: null, rowId: 'adv' }),
    sheetRow('c1', 2, scq, { ...main, attemptLimit: null, rowId: 'c' }, 'Chemistry'),
  ],
  {
    p1: { status: 'ANSWERED', answer: { choice: [1] } },
    p2: { status: 'ANSWERED', answer: { choice: [0, 1] } },
    c1: { status: 'ANSWERED', answer: { choice: [0] } },
  },
);
check('subject totals are kept apart', mixed.subjects.Physics.total === 6 && mixed.subjects.Chemistry.total === -1);
check('the overall total is the sum of subjects', mixed.total === 5 && mixed.maxMarks === 12);
check('partial answers are counted separately from correct ones', mixed.subjects.Physics.correct === 1 && mixed.subjects.Physics.partial === 1);
check('accuracy counts fully correct answers over attempted', mixed.attempted === 3 && mixed.accuracy === 33.33);

const empty = scoreAttempt(phySheet, {});
check('an attempt with nothing answered scores 0 with accuracy 0 (no division by zero)', empty.total === 0 && empty.accuracy === 0 && empty.subjects.Physics.notSeen === 4);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
