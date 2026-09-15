// SPEC (written before the code): scoring additions for NTA practice and analytics.
// The original scoring spec (attempt-scoring.test.js) stays unchanged; these are additions.
//
//   key.dropped = true        -> NTA dropped question: full marks to every candidate, answered or not
//   several isCorrect options on a single-correct question -> any of them is accepted (NTA "bonus")
//   scoreAttempt(...).sections -> totals per sectionId (sheet rows may carry sectionId)
//   scoreAttempt(...).questions[id] also has maxMarks and negativeMarks
//   historyInsight(key, marking, history)  -> { results: [{ t, result }], changedCorrectToWrong, changedWrongToCorrect }
//   draftResult(key, marking, draft)       -> the result the unsaved draft would have scored (UNANSWERED if none)
const {
  scoreQuestion,
  scoreAttempt,
  historyInsight,
  draftResult,
} = require('../../dist/src/modules/exam/attempt-scoring.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const T = { isCorrect: true };
const F = { isCorrect: false };
const scq = { kernel: 'SINGLE_CHOICE', options: [F, T, F, F], answerConfig: null };
const nat = { kernel: 'NUMERIC', options: null, answerConfig: { value: 5, tolerance: 0 } };
const main = { marks: 4, negativeMarks: 1, partialMarking: false };
const row = (questionId, orderIndex, key, extra = {}) => ({
  questionId, subjectName: 'Physics', sectionId: 'A', orderIndex, key, marking: { ...main, attemptLimit: null, rowId: 'r1' }, ...extra,
});

/* --- 1. Dropped and bonus questions (NTA) ---------------------------------- */

const dropped = { ...scq, dropped: true };
check('a dropped question gives full marks when answered wrong', JSON.stringify(scoreQuestion(dropped, main, { choice: [0] })) === JSON.stringify({ result: 'DROPPED', marks: 4 }));
check('a dropped question gives full marks when not answered', scoreQuestion(dropped, main, null).marks === 4 && scoreQuestion(dropped, main, null).result === 'DROPPED');
const bonus = { kernel: 'SINGLE_CHOICE', options: [T, T, F, F], answerConfig: null };
check('a single-correct question with two accepted options accepts either', scoreQuestion(bonus, main, { choice: [0] }).result === 'CORRECT' && scoreQuestion(bonus, main, { choice: [1] }).result === 'CORRECT');
check('...but not both at once', scoreQuestion(bonus, main, { choice: [0, 1] }).result === 'INCORRECT');

const withDrop = scoreAttempt([row('a', 0, dropped), row('b', 1, scq)], { a: { status: 'NOT_VISITED', answer: null }, b: { status: 'ANSWERED', answer: { choice: [1] } } });
check('a dropped question adds its marks even if never seen', withDrop.total === 8 && withDrop.questions.a.result === 'DROPPED');
check('dropped questions are counted on their own', withDrop.dropped === 1 && withDrop.subjects.Physics.dropped === 1);
check('a dropped question is neither attempted nor not-seen', withDrop.attempted === 1 && withDrop.notSeen === 0);

/* --- 2. Section totals and per-question marks ------------------------------- */

const twoSections = scoreAttempt(
  [row('a1', 0, scq), row('a2', 1, scq), row('b1', 2, nat, { sectionId: 'B', marking: { ...main, negativeMarks: 0, attemptLimit: null, rowId: 'r2' } })],
  { a1: { status: 'ANSWERED', answer: { choice: [1] } }, a2: { status: 'ANSWERED', answer: { choice: [2] } }, b1: { status: 'ANSWERED', answer: { value: 5 } } },
);
check('totals are kept per section', twoSections.sections.A.total === 3 && twoSections.sections.B.total === 4, JSON.stringify(twoSections.sections));
check('section maximum marks are kept', twoSections.sections.A.maxMarks === 8 && twoSections.sections.B.maxMarks === 4);
check('each question reports its marking', twoSections.questions.a1.maxMarks === 4 && twoSections.questions.a1.negativeMarks === 1 && twoSections.questions.b1.negativeMarks === 0);

/* --- 3. How the answer changed ---------------------------------------------- */

let h = historyInsight(scq, main, [{ t: 10, answer: { choice: [1] } }, { t: 20, answer: { choice: [3] } }]);
check('each saved answer gets its result', JSON.stringify(h.results) === JSON.stringify([{ t: 10, result: 'CORRECT' }, { t: 20, result: 'INCORRECT' }]));
check('correct changed to wrong is detected', h.changedCorrectToWrong === true && h.changedWrongToCorrect === false);
h = historyInsight(scq, main, [{ t: 10, answer: { choice: [0] } }, { t: 20, answer: null }, { t: 30, answer: { choice: [1] } }]);
check('wrong changed to correct is detected, a clear in between is ignored', h.changedWrongToCorrect === true && h.changedCorrectToWrong === false);
check('a clear is recorded as unanswered', h.results[1].result === 'UNANSWERED');
h = historyInsight(scq, main, []);
check('no history, no change', h.results.length === 0 && !h.changedCorrectToWrong && !h.changedWrongToCorrect);

/* --- 4. The right answer selected but never saved --------------------------- */

check('an unsaved correct selection is detected', draftResult(scq, main, { choice: [1] }) === 'CORRECT');
check('an unsaved wrong selection is detected as wrong', draftResult(scq, main, { choice: [2] }) === 'INCORRECT');
check('a typed numeric draft is parsed before judging', draftResult(nat, main, { text: '5' }) === 'CORRECT' && draftResult(nat, main, { text: '5.' }) === 'CORRECT');
check('no draft is unanswered', draftResult(scq, main, null) === 'UNANSWERED' && draftResult(nat, main, { text: '' }) === 'UNANSWERED');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
