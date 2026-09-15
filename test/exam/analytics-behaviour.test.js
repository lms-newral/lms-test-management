// SPEC (written before the code): Attempt Behaviour — how a question was handled, not just whether
// it was right.
//
// The yardstick is the class: how long the students who got this question RIGHT took on it. Faster
// than them and correct is Solid; slower and wrong is Wasted, and so on. A question the class has
// barely touched has no yardstick, so it is left unclassified rather than guessed at.
//
// Module under test: src/modules/exam/analytics-behaviour.logic.ts
//   MIN_CLASS_ATTEMPTS                 -> 10
//   classify(question, classStat)      -> Behaviour
//   behaviourSummary(rows, statOf)     -> per behaviour: count, marks, timeMs
const {
  MIN_CLASS_ATTEMPTS,
  classify,
  behaviourSummary,
} = require('../../dist/src/modules/exam/analytics-behaviour.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

// The class took 60s on average to get this one right.
const stat = { attempts: 500, correct: 300, avgTimeMs: 75_000, avgTimeCorrectMs: 60_000 };
const q = (over) => ({ result: 'CORRECT', marks: 4, maxMarks: 4, timeMs: 30_000, visits: 1, ...over });

/* --- 1. The six behaviours ------------------------------------------------- */

check('correct and faster than the class is Solid', classify(q({ timeMs: 40_000 }), stat) === 'SOLID');
check('correct but slower is Slow', classify(q({ timeMs: 90_000 }), stat) === 'SLOW');
check('wrong after a long think is Wasted', classify(q({ result: 'INCORRECT', marks: -1, timeMs: 90_000 }), stat) === 'WASTED');
check('wrong in a hurry is Rushed', classify(q({ result: 'INCORRECT', marks: -1, timeMs: 15_000 }), stat) === 'RUSHED');
check('unanswered after a long look is Stuck', classify(q({ result: 'UNANSWERED', marks: 0, timeMs: 120_000 }), stat) === 'STUCK');
check('unanswered after a glance is Left', classify(q({ result: 'UNANSWERED', marks: 0, timeMs: 8_000 }), stat) === 'LEFT');

/* --- 2. The edges ---------------------------------------------------------- */
// "At or above the class time" counts as the slower side, so exactly equal is Slow, not Solid.

check('exactly the class time, correct, is Slow', classify(q({ timeMs: 60_000 }), stat) === 'SLOW');
check('exactly the class time, wrong, is Wasted', classify(q({ result: 'INCORRECT', marks: -1, timeMs: 60_000 }), stat) === 'WASTED');
check('a question never opened is its own case', classify(q({ result: 'UNANSWERED', marks: 0, timeMs: 0, visits: 0 }), stat) === 'NOT_SEEN');
check('partial credit counts as correct for speed', classify(q({ result: 'PARTIAL', marks: 2, timeMs: 30_000 }), stat) === 'SOLID');
check('a dropped question is nobody\'s doing', classify(q({ result: 'DROPPED', marks: 4, timeMs: 30_000 }), stat) === 'UNCLASSIFIED');
check('a question outside the attempt limit is not judged', classify(q({ result: 'NOT_EVALUATED', marks: 0, timeMs: 30_000 }), stat) === 'UNCLASSIFIED');

/* --- 3. Not enough class data to judge ------------------------------------- */

check('ten attempts is the floor', MIN_CLASS_ATTEMPTS === 10);
check('too few classmates means unclassified', classify(q({}), { attempts: 9, correct: 5, avgTimeMs: 70_000, avgTimeCorrectMs: 60_000 }) === 'UNCLASSIFIED');
check('no class data at all means unclassified', classify(q({}), null) === 'UNCLASSIFIED');
check('if nobody got it right, the class average time stands in', classify(q({ timeMs: 30_000 }), { attempts: 200, correct: 0, avgTimeMs: 75_000, avgTimeCorrectMs: null }) === 'SOLID');
check('with no usable time at all, unclassified', classify(q({}), { attempts: 200, correct: 0, avgTimeMs: null, avgTimeCorrectMs: null }) === 'UNCLASSIFIED');
check('a never-opened question is Not Seen even without class data', classify(q({ timeMs: 0, visits: 0, result: 'UNANSWERED' }), null) === 'NOT_SEEN');

/* --- 4. The summary a student reads ---------------------------------------- */

const rows = [
  { questionId: 'a', result: 'CORRECT', marks: 4, maxMarks: 4, timeMs: 30_000, visits: 1 },
  { questionId: 'b', result: 'CORRECT', marks: 4, maxMarks: 4, timeMs: 95_000, visits: 2 },
  { questionId: 'c', result: 'INCORRECT', marks: -1, maxMarks: 4, timeMs: 88_000, visits: 1 },
  { questionId: 'd', result: 'INCORRECT', marks: -1, maxMarks: 4, timeMs: 12_000, visits: 1 },
  { questionId: 'e', result: 'UNANSWERED', marks: 0, maxMarks: 4, timeMs: 140_000, visits: 3 },
  { questionId: 'f', result: 'UNANSWERED', marks: 0, maxMarks: 4, timeMs: 0, visits: 0 },
];
const statOf = new Map(rows.map((r) => [r.questionId, stat]));
const summary = behaviourSummary(rows, statOf);

check('every question lands in exactly one behaviour', Object.values(summary).reduce((n, b) => n + b.count, 0) === rows.length);
check('Solid counts the quick correct one', summary.SOLID.count === 1 && summary.SOLID.marks === 4);
check('Slow counts the slow correct one', summary.SLOW.count === 1);
check('Wasted carries the time it cost', summary.WASTED.count === 1 && summary.WASTED.timeMs === 88_000);
check('Rushed is counted', summary.RUSHED.count === 1 && summary.RUSHED.marks === -1);
check('Stuck carries its long time', summary.STUCK.count === 1 && summary.STUCK.timeMs === 140_000);
check('the unopened question is Not Seen, not Left', summary.NOT_SEEN.count === 1 && summary.LEFT.count === 0);
check('the marks add up to the attempt total', Object.values(summary).reduce((n, b) => n + b.marks, 0) === 6);
check('every behaviour is present in the summary, even at zero', Object.keys(summary).length === 8);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
