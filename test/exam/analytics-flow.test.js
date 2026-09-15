// SPEC (written before the code): Solving Flow — the order the paper was actually worked in.
//
// Not the order the questions are printed in: the real path, 1 → 2 → 5 → back to 1, with how long
// each stop took and how that question ended up. It is rebuilt from the visit spans, so a question
// opened three times appears three times, in the order it happened.
//
// Module under test: src/modules/exam/analytics-flow.logic.ts
//   solvingFlow(rows, endMs) -> { steps, questionsVisited, revisited, longest }
const { solvingFlow } = require('../../dist/src/modules/exam/analytics-flow.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const END = 300_000;
const rows = [
  {
    questionId: 'a', orderIndex: 0, subjectName: 'Physics', result: 'CORRECT', marks: 4,
    visitTimeline: [{ enterMs: 0, leaveMs: 30_000 }, { enterMs: 200_000, leaveMs: 240_000 }],
  },
  {
    questionId: 'b', orderIndex: 1, subjectName: 'Physics', result: 'INCORRECT', marks: -1,
    visitTimeline: [{ enterMs: 30_000, leaveMs: 120_000 }],
  },
  {
    questionId: 'c', orderIndex: 4, subjectName: 'Maths', result: 'UNANSWERED', marks: 0,
    visitTimeline: [{ enterMs: 120_000, leaveMs: 200_000 }],
  },
  {
    questionId: 'd', orderIndex: 2, subjectName: 'Maths', result: 'UNANSWERED', marks: 0,
    visitTimeline: [],
  },
  {
    questionId: 'e', orderIndex: 3, subjectName: 'Maths', result: 'CORRECT', marks: 4,
    visitTimeline: [{ enterMs: 240_000, leaveMs: null }],
  },
];

const flow = solvingFlow(rows, END);

/* --- 1. The path ------------------------------------------------------------ */

check('a step per visit, not per question', flow.steps.length === 5);
check('the path is in the order it happened', flow.steps.map((s) => s.number).join('→') === '1→2→5→1→4', flow.steps.map((s) => s.number).join('→'));
check('steps are numbered from one', flow.steps[0].step === 1 && flow.steps[4].step === 5);
check('questions are numbered as the paper prints them', flow.steps[2].number === 5 && flow.steps[2].questionId === 'c');
check('a question never opened never appears', flow.steps.every((s) => s.questionId !== 'd'));

/* --- 2. How long each stop took --------------------------------------------- */

check('the first stop lasted its visit', flow.steps[0].durationMs === 30_000);
check('the longest stop is measured', flow.steps[1].durationMs === 90_000);
check('the return visit is its own, shorter stop', flow.steps[3].durationMs === 40_000 && flow.steps[3].questionId === 'a');
check('a visit still open at the end closes at the end', flow.steps[4].durationMs === 60_000, String(flow.steps[4].durationMs));
check('every step carries when it started', flow.steps[2].enterMs === 120_000);

/* --- 3. What each stop was worth -------------------------------------------- */

check('each step carries how that question ended', flow.steps[0].result === 'CORRECT' && flow.steps[1].result === 'INCORRECT');
check('a revisit shows the same final result both times', flow.steps[3].result === 'CORRECT');
check('the subject travels with the step', flow.steps[2].subjectName === 'Maths');

/* --- 4. The shape of the attempt -------------------------------------------- */

check('four questions were opened', flow.questionsVisited === 4);
check('one of them was come back to', flow.revisited === 1);
check('the longest single stop is called out', flow.longest.number === 2 && flow.longest.durationMs === 90_000);

const nothing = solvingFlow([], END);
check('a paper never opened has an empty path', nothing.steps.length === 0 && nothing.questionsVisited === 0);
check('and no longest stop to report', nothing.longest === null);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
