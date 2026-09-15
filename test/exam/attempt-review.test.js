// SPEC (written before the code): who may open the solution review, and how it shows results.
//
// Two gates, decided with the user on 15 Sep 2026:
//   - SOLUTIONS open as soon as the student's own attempt is submitted and scored. They do not
//     wait for the result time. (The user accepted the consequence: someone who submits early
//     holds the answer key while others are still writing.)
//   - ANALYTICS — rank, percentile, comparison with toppers — wait for the result time, because
//     they only mean anything once the cohort has finished.
//
// Module under test: src/modules/exam/attempt-review.logic.ts
//   reviewProblem({ status, finalizedAt } | null)          -> null | 'NOT_ATTEMPTED' | 'NOT_SUBMITTED' | 'SCORING'
//   analyticsProblem({ status, finalizedAt, resultAt } | null, now)
//                                                          -> the same, plus 'RESULTS_PENDING'
//   reviewPaletteStatus(result) -> 'CORRECT' | 'INCORRECT' | 'PARTIAL' | 'NOT_ANSWERED' | 'DROPPED'
//   answerLabel(kernel, answer, optionCount) -> '1' | '1, 3' | '9.81' | '—'   (options are numbered 1..n, as NTA shows them)
//   correctLabel(kernel, options, answerConfig) -> same format for the key ('9.8 ± 0.1' with tolerance)
const {
  reviewProblem,
  analyticsProblem,
  reviewPaletteStatus,
  answerLabel,
  correctLabel,
} = require('../../dist/src/modules/exam/attempt-review.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const now = new Date('2027-01-10T12:00:00Z');
const before = new Date('2027-01-10T11:00:00Z');
const after = new Date('2027-01-10T13:00:00Z');

/* --- 1. Solutions: open once the student's own attempt is scored ---------- */

check('no attempt: nothing to review', reviewProblem(null) === 'NOT_ATTEMPTED');
check('an attempt still running cannot be reviewed', reviewProblem({ status: 'IN_PROGRESS', finalizedAt: null }) === 'NOT_SUBMITTED');
check('submitted but not yet scored: wait', reviewProblem({ status: 'SUBMITTED', finalizedAt: null }) === 'SCORING');
check('submitted and scored: solutions open, without waiting for the result time', reviewProblem({ status: 'SUBMITTED', finalizedAt: before }) === null);

/* --- 2. Analytics: only once results are declared ------------------------- */

check('no attempt: no analytics', analyticsProblem(null, now) === 'NOT_ATTEMPTED');
check('an attempt still running has no analytics', analyticsProblem({ status: 'IN_PROGRESS', finalizedAt: null, resultAt: before }, now) === 'NOT_SUBMITTED');
check('before the result time analytics stay hidden', analyticsProblem({ status: 'SUBMITTED', finalizedAt: before, resultAt: after }, now) === 'RESULTS_PENDING');
check('exactly at the result time analytics open', analyticsProblem({ status: 'SUBMITTED', finalizedAt: before, resultAt: now }, now) === null);
check('past the result time but not yet scored: wait', analyticsProblem({ status: 'SUBMITTED', finalizedAt: null, resultAt: before }, now) === 'SCORING');
check('a missing result time keeps analytics closed', analyticsProblem({ status: 'SUBMITTED', finalizedAt: before, resultAt: null }, now) === 'RESULTS_PENDING');

/* --- 3. Palette in review ------------------------------------------------- */

check('correct is CORRECT', reviewPaletteStatus('CORRECT') === 'CORRECT');
check('incorrect is INCORRECT', reviewPaletteStatus('INCORRECT') === 'INCORRECT');
check('partial is PARTIAL', reviewPaletteStatus('PARTIAL') === 'PARTIAL');
check('unanswered and not evaluated are NOT_ANSWERED', reviewPaletteStatus('UNANSWERED') === 'NOT_ANSWERED' && reviewPaletteStatus('NOT_EVALUATED') === 'NOT_ANSWERED');
check('dropped is DROPPED', reviewPaletteStatus('DROPPED') === 'DROPPED');

/* --- 4. Answer labels ------------------------------------------------------ */

check('a single choice is its option number', answerLabel('SINGLE_CHOICE', { choice: [0] }, 4) === '1');
check('several choices are option numbers in order', answerLabel('MULTI_CHOICE', { choice: [2, 0] }, 4) === '1, 3');
check('a numeric answer is its value', answerLabel('NUMERIC', { value: 9.81 }, 0) === '9.81');
check('no answer is a dash', answerLabel('SINGLE_CHOICE', null, 4) === '—' && answerLabel('MULTI_CHOICE', { choice: [] }, 4) === '—');
check('an option index outside the options is ignored', answerLabel('SINGLE_CHOICE', { choice: [7] }, 4) === '—');

const T = { isCorrect: true };
const F = { isCorrect: false };
check('the key of a single choice is its option number', correctLabel('SINGLE_CHOICE', [F, T, F, F], null) === '2');
check('the key of a multiple choice lists every correct option', correctLabel('MULTI_CHOICE', [T, F, T, T], null) === '1, 3, 4');
check('the key of a numeric question shows the tolerance', correctLabel('NUMERIC', null, { value: 9.8, tolerance: 0.1 }) === '9.8 ± 0.1');
check('the key of an exact numeric question is just the value', correctLabel('NUMERIC', null, { value: 2, tolerance: 0 }) === '2');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
