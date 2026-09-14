// Offline checks for question picking and publish readiness -- no DB.
//
// Publishing freezes a paper that students will be scored against, so a test
// must never publish short, with a question of the wrong type or subject, or
// with the same question twice.
const {
  detailProblems,
  pickProblem,
  publishProblems,
} = require('../../dist/src/modules/tests/test-format.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const slot = (over = {}) => ({
  rowId: 'r1',
  label: 'Physics › Section A › SCQ',
  subjectId: 'phy',
  questionTypeId: 'scq',
  questionCount: 2,
  ...over,
});
const q = (id, over = {}) => ({
  questionId: id,
  subjectId: 'phy',
  questionTypeId: 'scq',
  deleted: false,
  ...over,
});
const placed = (id, over = {}) => ({ rowId: 'r1', ...q(id, over) });

/* --- 1. Picking ------------------------------------------------------------- */

check('a matching question can be picked', pickProblem(slot(), 0, q('a'), false) === null);
check('a question from another subject is refused',
  (pickProblem(slot(), 0, q('a', { subjectId: 'chem' }), false) ?? '').includes('subject'));
check('a question of another type is refused',
  (pickProblem(slot(), 0, q('a', { questionTypeId: 'mcq' }), false) ?? '').includes('type'));
check('a deleted question is refused',
  (pickProblem(slot(), 0, q('a', { deleted: true }), false) ?? '').includes('deleted'));
check('a question already in the test is refused',
  (pickProblem(slot(), 0, q('a'), true) ?? '').includes('already in the test'));
check('a full row refuses another question',
  (pickProblem(slot(), 2, q('a'), false) ?? '').includes('already has all'));
check('draft and in-review questions are pickable (no status rule)',
  pickProblem(slot(), 0, q('a'), false) === null);

/* --- 2. Publishing ---------------------------------------------------------- */

check('a full, matching draft can be published',
  publishProblems('DRAFT', [slot()], [placed('a'), placed('b')]).length === 0);
check('a short row blocks publishing and says how short',
  publishProblems('DRAFT', [slot()], [placed('a')]).some((p) => p.includes('1 of 2')));
check('an empty second row is reported too',
  publishProblems('DRAFT', [slot(), slot({ rowId: 'r2', label: 'Physics › Section B › NAT', questionTypeId: 'nat' })],
    [placed('a'), placed('b')]).some((p) => p.includes('0 of 2')));
check('a question deleted after picking blocks publishing',
  publishProblems('DRAFT', [slot()], [placed('a'), placed('b', { deleted: true })]).some((p) => p.includes('deleted')));
check('a question whose type changed after picking blocks publishing',
  publishProblems('DRAFT', [slot()], [placed('a'), placed('b', { questionTypeId: 'mcq' })]).some((p) => p.includes('changed')));
check('the same question placed twice blocks publishing',
  publishProblems('DRAFT', [slot({ questionCount: 2 })], [placed('a'), placed('a')]).some((p) => p.includes('twice')));
check('an already published test cannot be published again',
  publishProblems('PUBLISHED', [slot()], [placed('a'), placed('b')]).some((p) => p.includes('Only a draft')));

/* --- 3. Details and syllabus ------------------------------------------------ */

const details = (over = {}) => ({
  name: 'Mock 1',
  year: 2027,
  descriptionHtml: '<p>Full syllabus mock</p>',
  syllabi: [{ subjectName: 'Physics', syllabusHtml: '<p>Mechanics</p>' }],
  ...over,
});
check('complete details and syllabus pass', detailProblems(details()).length === 0);
check('a missing year blocks publishing', detailProblems(details({ year: null })).some((p) => p.includes('year')));
check('an empty editor paragraph is not a description', detailProblems(details({ descriptionHtml: '<p></p>' })).some((p) => p.includes('description')));
check('a blank syllabus for a subject is named', detailProblems(details({ syllabi: [{ subjectName: 'Physics', syllabusHtml: '<p>&nbsp;</p>' }] })).some((p) => p.includes('Physics')));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
