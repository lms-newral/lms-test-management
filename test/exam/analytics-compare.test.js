// SPEC (written before the code): "Compare with Toppers", and the Question-wise Review row.
//
// Comparison is only ever a report of what the cohort did. When the cohort is too small, or nobody
// else reached a question, the comparison is null — never a zero, which would read as "the toppers
// scored nothing there".
//
// Modules under test:
//   src/modules/exam/analytics-compare.logic.ts
//     compareSubjects(mine, top10, top25, everyone) -> one row per subject, with gaps
//   src/modules/exam/analytics-questions.logic.ts
//     reviewRow(attemptQuestion, stat) -> the Question-wise Review row
const { compareSubjects } = require('../../dist/src/modules/exam/analytics-compare.logic');
const { reviewRow } = require('../../dist/src/modules/exam/analytics-questions.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const mine = {
  Physics: { score: 64, timeMs: 3_600_000, accuracy: 80 },
  Chemistry: { score: 40, timeMs: 2_400_000, accuracy: 55 },
  Maths: { score: 28, timeMs: 3_000_000, accuracy: 40 },
};
const top10 = {
  Physics: { score: 88, timeMs: 3_000_000, accuracy: 95 },
  Chemistry: { score: 84, timeMs: 2_100_000, accuracy: 92 },
  Maths: { score: 80, timeMs: 3_300_000, accuracy: 90 },
};
const top25 = {
  Physics: { score: 76, timeMs: 3_200_000, accuracy: 88 },
  Chemistry: { score: 70, timeMs: 2_300_000, accuracy: 80 },
  Maths: { score: 64, timeMs: 3_400_000, accuracy: 76 },
};
const everyone = {
  Physics: { score: 52, timeMs: 3_500_000, accuracy: 62 },
  Chemistry: { score: 44, timeMs: 2_600_000, accuracy: 58 },
  Maths: { score: 30, timeMs: 3_100_000, accuracy: 42 },
};

/* --- 1. Subject by subject against the toppers ----------------------------- */

const rows = compareSubjects(mine, top10, top25, everyone);
const physics = rows.find((r) => r.subject === 'Physics');
const maths = rows.find((r) => r.subject === 'Maths');

check('one row per subject, in the order given', rows.length === 3 && rows[0].subject === 'Physics' && rows[2].subject === 'Maths');
check("the student's own numbers are kept", physics.mine.score === 64 && physics.mine.accuracy === 80);
check('the top 10% are alongside', physics.top10.score === 88);
check('the top 25% are alongside', physics.top25.score === 76);
check('and so is the whole cohort', physics.everyone.score === 52);
check('the gap to the top 10% is negative when behind', physics.scoreGap === -24);
check('the worst subject is the biggest gap', maths.scoreGap === -52);
check('spending longer than the toppers shows as a positive time gap', physics.timeGap === 600_000);
check('spending less time than the toppers shows as negative', maths.timeGap === -300_000);
check('the accuracy gap is reported too', physics.accuracyGap === -15);

/* --- 2. When there is no cohort to compare against ------------------------- */

const alone = compareSubjects(mine, {}, {}, {});
check('the student still sees their own subjects', alone.length === 3 && alone[1].mine.score === 40);
check('a missing topper cohort is null, never zero', alone[0].top10 === null && alone[0].top25 === null);
check('and the gaps are null, not NaN', alone[0].scoreGap === null && alone[0].timeGap === null && alone[0].accuracyGap === null);

const partial = compareSubjects(mine, { Physics: top10.Physics }, top25, everyone);
check('a subject the toppers skipped compares where it can', partial.find((r) => r.subject === 'Physics').scoreGap === -24);
check('and stays null where it cannot', partial.find((r) => r.subject === 'Maths').scoreGap === null);

/* --- 3. The Question-wise Review row --------------------------------------- */

const attemptQuestion = {
  questionId: 'q-17',
  subjectName: 'Physics',
  chapterName: 'Rotational Motion',
  topicName: 'Moment of inertia',
  difficulty: 'HARD',
  status: 'ANSWERED',
  result: 'INCORRECT',
  marks: -1,
  timeMs: 185_000,
  visits: 3,
  answerChanges: 2,
};
const stat = { attempts: 2400, correct: 720, avgTimeMs: 96_000, topperAvgTimeMs: 61_000, topperAccuracy: 84 };

const row = reviewRow(attemptQuestion, stat);
check('the question keeps its taxonomy', row.chapterName === 'Rotational Motion' && row.topicName === 'Moment of inertia');
check('the difficulty comes through', row.difficulty === 'HARD');
check('the result and marks come through', row.result === 'INCORRECT' && row.marks === -1);
check('time and revisits come through', row.timeMs === 185_000 && row.visits === 3 && row.answerChanges === 2);
check('the class accuracy is computed from the cohort', row.classAccuracy === 30);
check('the toppers accuracy is carried', row.topperAccuracy === 84);
check('how much longer than the class is shown', row.timeVsClassMs === 89_000);
check('and how much longer than the toppers', row.timeVsTopperMs === 124_000);
check('being slower than the class is flagged', row.slowerThanClass === true);

const unseen = reviewRow(attemptQuestion, { attempts: 0, correct: 0, avgTimeMs: null, topperAvgTimeMs: null, topperAccuracy: null });
check('a question nobody else reached has no class accuracy', unseen.classAccuracy === null);
check('and no time comparison', unseen.timeVsClassMs === null && unseen.slowerThanClass === null);
check('but the student still sees their own row', unseen.timeMs === 185_000 && unseen.result === 'INCORRECT');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
