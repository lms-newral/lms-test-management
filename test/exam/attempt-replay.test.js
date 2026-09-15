// SPEC (written before the code): replaying an attempt's events into per-question state.
//
// Everything the student sees on the palette and everything the analytics read
// comes from this replay, so it must follow NTA rules exactly:
//   * clicking an option is only a DRAFT;
//   * SAVE & NEXT / SAVE & MARK FOR REVIEW commit the draft;
//   * MARK FOR REVIEW & NEXT marks the question but does NOT save the draft;
//   * CLEAR removes the response (the review mark stays);
//   * moving away (palette, BACK, NEXT) discards an unsaved draft.
//
// Module under test: src/modules/exam/attempt-replay.logic.ts
//   replayAttempt(paper, events) -> { questions, visitOrder, currentQuestionId, submitted, submitReason, submitMs }
//   applyChoiceClick(kernel, draft, optionIndex) -> number[]
//   parseNumericAnswer(text) -> number | null
//   nextQuestionId(paper, questionId) -> string
//   prevQuestionId(paper, questionId) -> string | null
//   firstQuestionOfSection(paper, sectionId) -> string | null
const {
  replayAttempt,
  applyChoiceClick,
  parseNumericAnswer,
  nextQuestionId,
  prevQuestionId,
  firstQuestionOfSection,
} = require('../../dist/src/modules/exam/attempt-replay.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const paper = {
  sections: [
    { id: 'phyA', subjectName: 'Physics', name: 'Section A' },
    { id: 'phyB', subjectName: 'Physics', name: 'Section B' },
    { id: 'chemA', subjectName: 'Chemistry', name: 'Section A' },
  ],
  questions: [
    { id: 'q1', sectionId: 'phyA', kernel: 'SINGLE_CHOICE', optionCount: 4 },
    { id: 'q2', sectionId: 'phyA', kernel: 'MULTI_CHOICE', optionCount: 4 },
    { id: 'q3', sectionId: 'phyB', kernel: 'NUMERIC', optionCount: 0 },
    { id: 'q4', sectionId: 'chemA', kernel: 'SINGLE_CHOICE', optionCount: 4 },
  ],
};

// Builds a stream with seq 1..n; t is milliseconds since the attempt started.
const stream = (...items) => items.map(([t, type, q, data], i) => ({ seq: i + 1, t, type, q, data }));
const run = (...items) => replayAttempt(paper, stream(...items));

/* --- 1. Drafts are not answers --------------------------------------------- */

let r = run([0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [2] }]);
check('a clicked option without saving leaves the question Not Answered', r.questions.q1.status === 'NOT_ANSWERED');
check('...its saved answer is still empty', r.questions.q1.answer === null);
check('...but the draft is kept while the student stays on it', same(r.questions.q1.draft, { choice: [2] }));

r = run([0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [2] }], [2000, 'VISIT', 'q2']);
check('jumping to another question discards the unsaved draft', r.questions.q1.draft === null && r.questions.q1.answer === null);
check('...and the question stays Not Answered', r.questions.q1.status === 'NOT_ANSWERED');

r = run([0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [2] }], [2000, 'SAVE_NEXT', 'q1'], [2000, 'VISIT', 'q2']);
check('SAVE & NEXT commits the draft', same(r.questions.q1.answer, { choice: [2] }) && r.questions.q1.status === 'ANSWERED');

r = run(
  [0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [2] }], [2000, 'SAVE_NEXT', 'q1'], [2000, 'VISIT', 'q2'],
  [3000, 'VISIT', 'q1'], [4000, 'SELECT', 'q1', { choice: [0] }], [5000, 'VISIT', 'q4'],
);
check('changing a saved answer without saving keeps the old saved answer', same(r.questions.q1.answer, { choice: [2] }));

/* --- 2. Review marks -------------------------------------------------------- */

r = run([0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [1] }], [2000, 'SAVE_MARK', 'q1']);
check('SAVE & MARK FOR REVIEW gives Answered & Marked', r.questions.q1.status === 'ANSWERED_MARKED' && same(r.questions.q1.answer, { choice: [1] }));

r = run([0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [1] }], [2000, 'MARK_NEXT', 'q1'], [2000, 'VISIT', 'q2']);
check('MARK FOR REVIEW & NEXT with a draft gives Marked', r.questions.q1.status === 'MARKED');
check('...and does not save the draft', r.questions.q1.answer === null);

r = run(
  [0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [1] }], [1500, 'SAVE_NEXT', 'q1'],
  [2000, 'VISIT', 'q1'], [3000, 'MARK_NEXT', 'q1'],
);
check('MARK FOR REVIEW & NEXT on a saved question gives Answered & Marked', r.questions.q1.status === 'ANSWERED_MARKED');

r = run([0, 'VISIT', 'q1'], [1000, 'MARK_NEXT', 'q1'], [2000, 'VISIT', 'q1'], [3000, 'SELECT', 'q1', { choice: [3] }], [4000, 'SAVE_NEXT', 'q1']);
check('SAVE & NEXT on a marked question removes the mark', r.questions.q1.status === 'ANSWERED' && r.questions.q1.marked === false);

r = run([0, 'VISIT', 'q1'], [1000, 'SAVE_MARK', 'q1']);
check('SAVE & MARK FOR REVIEW with nothing chosen gives Marked', r.questions.q1.status === 'MARKED' && r.questions.q1.answer === null);

/* --- 3. Clear response ------------------------------------------------------ */

r = run([0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [1] }], [1500, 'SAVE_NEXT', 'q1'], [2000, 'VISIT', 'q1'], [2500, 'CLEAR', 'q1']);
check('CLEAR removes a saved answer', r.questions.q1.answer === null && r.questions.q1.status === 'NOT_ANSWERED');
check('CLEAR also removes the draft', r.questions.q1.draft === null);

r = run([0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [1] }], [1500, 'SAVE_MARK', 'q1'], [2000, 'CLEAR', 'q1']);
check('CLEAR on Answered & Marked leaves it Marked', r.questions.q1.status === 'MARKED' && r.questions.q1.marked === true);

/* --- 4. Not visited vs not answered ---------------------------------------- */

r = run([0, 'VISIT', 'q1'], [1000, 'VISIT', 'q2']);
check('a question never opened is Not Visited', r.questions.q3.status === 'NOT_VISITED' && r.questions.q4.status === 'NOT_VISITED');
check('a question opened and left is Not Answered', r.questions.q1.status === 'NOT_ANSWERED');
check('the current question is the last one opened', r.currentQuestionId === 'q2');

/* --- 5. Clicking options ---------------------------------------------------- */

check('single choice: clicking an option selects it', same(applyChoiceClick('SINGLE_CHOICE', null, 1), [1]));
check('single choice: clicking another option replaces it', same(applyChoiceClick('SINGLE_CHOICE', [1], 3), [3]));
check('single choice: clicking the chosen option again deselects it', same(applyChoiceClick('SINGLE_CHOICE', [3], 3), []));
check('multiple choice: clicks toggle and stay sorted', same(applyChoiceClick('MULTI_CHOICE', [2], 0), [0, 2]));
check('multiple choice: clicking a chosen option removes it', same(applyChoiceClick('MULTI_CHOICE', [0, 2], 2), [0]));

r = run([0, 'VISIT', 'q2'], [1000, 'SELECT', 'q2', { choice: [0, 3] }], [2000, 'SAVE_NEXT', 'q2']);
check('multiple choice: SAVE stores the exact set', same(r.questions.q2.answer, { choice: [0, 3] }));

r = run(
  [0, 'VISIT', 'q2'], [1000, 'SELECT', 'q2', { choice: [0] }], [1500, 'SAVE_NEXT', 'q2'],
  [2000, 'VISIT', 'q2'], [2500, 'SELECT', 'q2', { choice: [] }], [3000, 'SAVE_NEXT', 'q2'],
);
check('saving an emptied selection removes the answer', r.questions.q2.answer === null && r.questions.q2.status === 'NOT_ANSWERED');

r = run([0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [1] }], [1500, 'SAVE_NEXT', 'q1'], [2000, 'VISIT', 'q1'], [3000, 'SAVE_NEXT', 'q1']);
check('SAVE & NEXT without touching a saved answer keeps it', same(r.questions.q1.answer, { choice: [1] }));

/* --- 6. Numerical answers --------------------------------------------------- */

check('numeric: "-0.5" is -0.5', parseNumericAnswer('-0.5') === -0.5);
check('numeric: "12." is 12', parseNumericAnswer('12.') === 12);
check('numeric: ".5" is 0.5', parseNumericAnswer('.5') === 0.5);
check('numeric: spaces around are ignored', parseNumericAnswer('  7 ') === 7);
check('numeric: empty is no answer', parseNumericAnswer('') === null);
check('numeric: letters are no answer', parseNumericAnswer('12a') === null && parseNumericAnswer('abc') === null);
check('numeric: exponent notation is not accepted', parseNumericAnswer('1e3') === null);
check('numeric: a lone minus or dot is no answer', parseNumericAnswer('-') === null && parseNumericAnswer('.') === null);

r = run([0, 'VISIT', 'q3'], [1000, 'SELECT', 'q3', { text: '9.81' }], [2000, 'SAVE_NEXT', 'q3']);
check('numeric: SAVE stores the parsed value', same(r.questions.q3.answer, { value: 9.81 }) && r.questions.q3.status === 'ANSWERED');
r = run([0, 'VISIT', 'q3'], [1000, 'SELECT', 'q3', { text: '' }], [2000, 'SAVE_NEXT', 'q3']);
check('numeric: saving an empty box is Not Answered', r.questions.q3.answer === null && r.questions.q3.status === 'NOT_ANSWERED');
r = run([0, 'VISIT', 'q3'], [1000, 'SELECT', 'q3', { text: '4-' }], [2000, 'SAVE_NEXT', 'q3']);
check('numeric: saving an invalid number is Not Answered', r.questions.q3.answer === null);

/* --- 7. Time --------------------------------------------------------------- */

r = run(
  [0, 'VISIT', 'q1'], [30_000, 'VISIT', 'q2'], [50_000, 'VISIT', 'q1'], [60_000, 'VISIT', 'q4'],
  [100_000, 'SUBMIT', undefined, { reason: 'MANUAL' }],
);
check('each visit is recorded with enter and leave times',
  same(r.questions.q1.visits.map((v) => [v.enterMs, v.leaveMs]), [[0, 30_000], [50_000, 60_000]]));
check('time on a question is the sum of its visits', r.questions.q1.timeMs === 40_000 && r.questions.q2.timeMs === 20_000);
check('a visit still open at submit ends at the submit time', r.questions.q4.timeMs === 40_000);
check('first seen is the first visit', r.questions.q1.firstSeenMs === 0 && r.questions.q4.firstSeenMs === 60_000);
check('an unseen question has no time and no first-seen', r.questions.q3.timeMs === 0 && r.questions.q3.firstSeenMs === null);
check('the solving flow lists visits in order', same(r.visitOrder, ['q1', 'q2', 'q1', 'q4']));
check('submission is recorded', r.submitted === true && r.submitReason === 'MANUAL' && r.submitMs === 100_000);

r = run([0, 'VISIT', 'q1'], [1000, 'VISIT', 'q1'], [2000, 'VISIT', 'q2']);
check('re-opening the same question does not add a flow step', same(r.visitOrder, ['q1', 'q2']));

r = run([0, 'VISIT', 'q1'], [10_000, 'HIDDEN'], [15_000, 'VISIBLE'], [20_000, 'VISIT', 'q2'], [25_000, 'SUBMIT', undefined, { reason: 'AUTO_TIME' }]);
check('time with the page hidden still counts', r.questions.q1.timeMs === 20_000);
check('...and is reported separately', r.questions.q1.hiddenMs === 5_000);

r = run(
  [0, 'VISIT', 'q1'], [4_000, 'SELECT', 'q1', { choice: [0] }], [5_000, 'SAVE_NEXT', 'q1'],
  [6_000, 'VISIT', 'q1'], [7_000, 'SELECT', 'q1', { choice: [2] }], [8_000, 'SAVE_NEXT', 'q1'],
  [9_000, 'VISIT', 'q1'], [9_500, 'SELECT', 'q1', { choice: [2] }], [9_800, 'SAVE_NEXT', 'q1'],
);
check('first answered time is the first commit', r.questions.q1.firstAnsweredMs === 5_000);
check('changing a saved answer counts one change; saving the same answer again does not', r.questions.q1.answerChanges === 1);

/* --- 8. Order, duplicates, after submit ------------------------------------ */

const shuffled = stream([0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [1] }], [2000, 'SAVE_NEXT', 'q1']).reverse();
r = replayAttempt(paper, shuffled);
check('events are applied in seq order even if they arrive shuffled', same(r.questions.q1.answer, { choice: [1] }));

const dup = stream([0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [1] }], [2000, 'SAVE_NEXT', 'q1']);
dup.push({ ...dup[1], data: { choice: [3] } }); // same seq resent with different content: the first one wins
r = replayAttempt(paper, dup);
check('a repeated seq is applied once (first copy wins)', same(r.questions.q1.answer, { choice: [1] }));

r = run([0, 'VISIT', 'q1'], [1000, 'SUBMIT', undefined, { reason: 'MANUAL' }], [2000, 'SELECT', 'q1', { choice: [1] }], [3000, 'SAVE_NEXT', 'q1']);
check('nothing after submit changes the answers', r.questions.q1.answer === null);

/* --- 9. Navigation ---------------------------------------------------------- */

check('NEXT goes to the next question in the same section', nextQuestionId(paper, 'q1') === 'q2');
check('NEXT on a section\'s last question goes to the next section\'s first', nextQuestionId(paper, 'q2') === 'q3');
check('NEXT on the paper\'s last question wraps to the first', nextQuestionId(paper, 'q4') === 'q1');
check('BACK goes to the previous question across sections', prevQuestionId(paper, 'q3') === 'q2');
check('BACK on the first question stays put', prevQuestionId(paper, 'q1') === null);
check('a section tab opens its first question', firstQuestionOfSection(paper, 'chemA') === 'q4');
check('an unknown section has no first question', firstQuestionOfSection(paper, 'nope') === null);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
