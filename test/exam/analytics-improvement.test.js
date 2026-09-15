// SPEC (written before the code): Improvement Scope — what the paper was worth if the mistakes had
// gone the other way.
//
// A wrong answer costs twice: the marks not gained and the negative marks taken. Fixing one is
// worth maxMarks - marks (from -1 to +4 is a five mark swing), which is why mistakes are ranked by
// that swing and the most valuable are "fixed" first.
//
// Questions left blank are kept apart from mistakes. Not answering is a missed chance, not an
// error, and lumping them together would inflate the number a student sees.
//
// Module under test: src/modules/exam/analytics-improvement.logic.ts
//   improvementScope(rows, fractions?) -> { score, maxMarks, mistakes, skipped, steps, bySubject }
const { improvementScope } = require('../../dist/src/modules/exam/analytics-improvement.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

// Physics: one right, two wrong. Maths: one wrong, one skipped. Chemistry: one skipped, one unseen.
const rows = [
  { questionId: 'p1', subjectName: 'Physics', result: 'CORRECT', marks: 4, maxMarks: 4, visits: 1 },
  { questionId: 'p2', subjectName: 'Physics', result: 'INCORRECT', marks: -1, maxMarks: 4, visits: 1 },
  { questionId: 'p3', subjectName: 'Physics', result: 'INCORRECT', marks: -2, maxMarks: 8, visits: 1 },
  { questionId: 'm1', subjectName: 'Maths', result: 'INCORRECT', marks: -1, maxMarks: 4, visits: 1 },
  { questionId: 'm2', subjectName: 'Maths', result: 'UNANSWERED', marks: 0, maxMarks: 4, visits: 2 },
  { questionId: 'c1', subjectName: 'Chemistry', result: 'UNANSWERED', marks: 0, maxMarks: 4, visits: 1 },
  { questionId: 'c2', subjectName: 'Chemistry', result: 'UNANSWERED', marks: 0, maxMarks: 4, visits: 0 },
];

const scope = improvementScope(rows);

/* --- 1. Where the student stands ------------------------------------------- */

check('the score is what was actually earned', scope.score === 0, String(scope.score));
check('the paper was worth its questions', scope.maxMarks === 32, String(scope.maxMarks));
check('three mistakes are counted', scope.mistakes.count === 3);
check('a mistake is worth the full swing, not just the marks', scope.mistakes.recoverable === 5 + 10 + 5, String(scope.mistakes.recoverable));
check('blanks are counted apart from mistakes', scope.skipped.count === 3);
check('and are worth their marks, with nothing to take back', scope.skipped.recoverable === 12, String(scope.skipped.recoverable));

/* --- 2. Fixing a quarter, a half, all of them ------------------------------ */
// The most valuable mistake goes first: the 8 mark question, worth a 10 mark swing.

const at = (fraction) => scope.steps.find((s) => s.fraction === fraction);

check('three steps by default', scope.steps.length === 3 && scope.steps.map((s) => s.fraction).join() === '0.25,0.5,1');
check('a quarter of three mistakes is one', at(0.25).fixed === 1);
check('and it is the most valuable one', at(0.25).gain === 10 && at(0.25).score === 10);
check('half of three is two', at(0.5).fixed === 2);
check('the second best mistake follows', at(0.5).gain === 15 && at(0.5).score === 15);
check('fixing everything gains every swing', at(1).fixed === 3 && at(1).gain === 20 && at(1).score === 20);
check('and never exceeds what the paper was worth', scope.steps.every((s) => s.score <= scope.maxMarks));

/* --- 3. Where the marks are hiding ----------------------------------------- */

const physics = scope.bySubject.find((s) => s.subject === 'Physics');
const chemistry = scope.bySubject.find((s) => s.subject === 'Chemistry');

check('subjects are ranked by what is recoverable', scope.bySubject[0].subject === 'Physics');
check('Physics holds fifteen recoverable marks', physics.recoverable === 15 && physics.mistakes === 2);
check('Chemistry has no mistakes to fix, only blanks', chemistry.mistakes === 0 && chemistry.recoverable === 0 && chemistry.skipped === 2);

/* --- 4. A clean paper ------------------------------------------------------ */

const perfect = improvementScope([
  { questionId: 'x', subjectName: 'Physics', result: 'CORRECT', marks: 4, maxMarks: 4, visits: 1 },
]);
check('with no mistakes there is nothing to recover', perfect.mistakes.count === 0 && perfect.mistakes.recoverable === 0);
check('and every step just returns the score', perfect.steps.every((s) => s.score === 4 && s.gain === 0 && s.fixed === 0));

const empty = improvementScope([]);
check('an empty paper does not divide by zero', empty.score === 0 && empty.maxMarks === 0 && empty.steps.length === 3);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
