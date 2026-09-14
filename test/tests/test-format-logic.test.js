// Offline checks for test-format rules and the shipped templates -- no DB.
//
// A format is the contract every score and analytic is computed against, so the
// arithmetic here has to be exact: a wrong total here is a wrong percentile for
// every student who sits a test built on it.
const {
  validateFormat,
  validateBands,
  formatTotals,
  subjectTotals,
  rowMaxMarks,
  predictPercentile,
  formatLockReason,
  publishedEditProblem,
  round2,
} = require('../../dist/src/modules/tests/test-format.logic');
const { FORMAT_TEMPLATES } = require('../../dist/src/modules/tests/test-format.presets');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const row = (over = {}) => ({
  questionTypeCode: 'SCQ',
  kernel: 'SINGLE_CHOICE',
  questionCount: 10,
  marksPerQuestion: 1,
  negativeMarks: 0,
  partialMarking: false,
  ...over,
});
/** Maths: 10 questions for 10 marks, one section, one row -- the user's own example. */
const format = (over = {}) => ({
  name: 'Mock',
  durationMinutes: 60,
  subjects: [
    {
      subjectId: 'maths',
      subjectName: 'Mathematics',
      totalQuestions: 10,
      totalMarks: 10,
      sections: [{ name: 'Section A', rows: [row()] }],
    },
  ],
  bands: [],
  ...over,
});
const withRows = (rows, totals = {}) =>
  format({
    subjects: [
      {
        subjectId: 'maths',
        subjectName: 'Mathematics',
        totalQuestions: 10,
        totalMarks: 10,
        ...totals,
        sections: [{ name: 'Section A', rows }],
      },
    ],
  });
const has = (problems, text) => problems.some((p) => p.includes(text));

/* --- 1. Totals ------------------------------------------------------------- */

check('a 10-question, 10-mark subject that adds up is valid', validateFormat(format()).length === 0,
  JSON.stringify(validateFormat(format())));
check('5 SCQ + 5 MCQ adding up to 10 is valid',
  validateFormat(withRows([row({ questionCount: 5 }), row({ questionTypeCode: 'MCQ', kernel: 'MULTI_CHOICE', questionCount: 5 })])).length === 0);
check('rows short of the subject question total are rejected',
  has(validateFormat(withRows([row({ questionCount: 8 })], { totalMarks: 8 })), 'rows add up to 8 questions'));
check('rows short of the subject marks total are rejected',
  has(validateFormat(withRows([row({ marksPerQuestion: 0.5 })])), 'rows add up to 5 marks'));
check('marks with decimals total exactly (0.25 × 40 = 10)',
  validateFormat(withRows([row({ questionCount: 40, marksPerQuestion: 0.25 })], { totalQuestions: 40 })).length === 0);

/* --- 2. Optional questions -------------------------------------------------- */

const optional = withRows([row({ questionCount: 10, attemptLimit: 5, marksPerQuestion: 2 })]);
check('"attempt 5 of 10" counts 10 questions but only 5 × marks',
  subjectTotals(optional.subjects[0]).questions === 10 && subjectTotals(optional.subjects[0]).marks === 10);
check('an optional row that adds up is valid', validateFormat(optional).length === 0,
  JSON.stringify(validateFormat(optional)));
check('attempt limit above the question count is rejected',
  has(validateFormat(withRows([row({ attemptLimit: 11 })])), 'attempt at most'));
check('attempt limit of 0 is rejected',
  has(validateFormat(withRows([row({ attemptLimit: 0 })])), 'attempt at most'));

/* --- 3. Marking ------------------------------------------------------------- */

check('negative marks above marks per question are rejected',
  has(validateFormat(withRows([row({ negativeMarks: 2 })])), 'cannot be more than marks per question'));
check('negative marks equal to marks are allowed',
  validateFormat(withRows([row({ negativeMarks: 1 })])).length === 0);
check('partial marking on single-correct is rejected',
  has(validateFormat(withRows([row({ partialMarking: true })])), 'partial marking only applies'));
check('partial marking on multiple-correct is allowed',
  validateFormat(withRows([row({ kernel: 'MULTI_CHOICE', questionTypeCode: 'MCQ', partialMarking: true })])).length === 0);
check('three-decimal marks are rejected',
  has(validateFormat(withRows([row({ marksPerQuestion: 0.333 })])), 'at most 2 decimals'));
check('zero questions in a row is rejected',
  has(validateFormat(withRows([row({ questionCount: 0 })])), 'at least 1'));
check('the lowest possible score counts every answerable question wrong',
  formatTotals(withRows([row({ questionCount: 10, attemptLimit: 5, negativeMarks: 1 })])).minScore === -5);

/* --- 4. Structure ----------------------------------------------------------- */

check('a format with no subjects is rejected', has(validateFormat(format({ subjects: [] })), 'at least one subject'));
check('a section with no rows is rejected',
  has(validateFormat(withRows([])), 'at least one question row'));
check('the same subject twice is rejected',
  has(validateFormat(format({ subjects: [format().subjects[0], format().subjects[0]] })), 'more than once'));
check('duration over a day is rejected', has(validateFormat(format({ durationMinutes: 1441 })), 'Duration'));
check('duration of 0 is rejected', has(validateFormat(format({ durationMinutes: 0 })), 'Duration'));

/* --- 5. Percentile bands ---------------------------------------------------- */

const bands = (list) => format({ bands: list });
check('non-overlapping rising bands are valid',
  validateBands(bands([{ minScore: 0, maxScore: 4, percentile: 50 }, { minScore: 5, maxScore: 10, percentile: 99 }])).length === 0);
check('gaps between bands are allowed',
  validateBands(bands([{ minScore: 0, maxScore: 2, percentile: 40 }, { minScore: 8, maxScore: 10, percentile: 99 }])).length === 0);
check('overlapping bands are rejected (inclusive edges)',
  has(validateBands(bands([{ minScore: 0, maxScore: 5, percentile: 50 }, { minScore: 5, maxScore: 10, percentile: 99 }])), 'overlaps'));
check('a higher score with a lower percentile is rejected',
  has(validateBands(bands([{ minScore: 0, maxScore: 4, percentile: 90 }, { minScore: 5, maxScore: 10, percentile: 80 }])), 'lower percentile'));
check('a band above the maximum score is rejected',
  has(validateBands(bands([{ minScore: 5, maxScore: 11, percentile: 99 }])), 'between'));
check('a band below the lowest possible score is rejected',
  has(validateBands(bands([{ minScore: -1, maxScore: 3, percentile: 10 }])), 'between'));
check('negative band scores are allowed when negative marking makes them reachable',
  validateBands(withRows([row({ negativeMarks: 1 })]).subjects && { ...withRows([row({ negativeMarks: 1 })]), bands: [{ minScore: -10, maxScore: 0, percentile: 1 }] }).length === 0);
check('percentile above 100 is rejected',
  has(validateBands(bands([{ minScore: 0, maxScore: 10, percentile: 101 }])), 'between 0 and 100'));
check('a score inside a band predicts its percentile',
  predictPercentile([{ minScore: 5, maxScore: 10, percentile: 99 }], 7) === 99);
check('a score in a gap predicts nothing',
  predictPercentile([{ minScore: 5, maxScore: 10, percentile: 99 }], 3) === null);

/* --- 6. Locks --------------------------------------------------------------- */

check('an unused format is editable', formatLockReason(0) === null);
check('a format used by one draft test is locked', formatLockReason(1) !== null);
check('a published test may rename itself and change its description', publishedEditProblem(['name', 'descriptionHtml']) === null);
check('a published test may not change its duration', publishedEditProblem(['durationMinutes']) !== null);

/* --- 7. The shipped templates ----------------------------------------------- */

const byName = Object.fromEntries(FORMAT_TEMPLATES.map((t) => [t.name, t]));
check('four templates ship', FORMAT_TEMPLATES.length === 4, FORMAT_TEMPLATES.map((t) => t.name).join(', '));
for (const t of FORMAT_TEMPLATES) {
  const problems = validateFormat(t);
  check(`template "${t.name}" is valid`, problems.length === 0, problems.join(' | '));
}
const totals = (name) => formatTotals(byName[name]);
check('JEE Main totals 75 questions / 300 marks', totals('JEE Main').questions === 75 && totals('JEE Main').marks === 300);
check('NEET UG totals 180 questions / 720 marks', totals('NEET UG').questions === 180 && totals('NEET UG').marks === 720);
check('JEE Advanced papers total 51 questions / 180 marks each',
  ['JEE Advanced Paper 1', 'JEE Advanced Paper 2'].every((n) => totals(n).questions === 51 && totals(n).marks === 180));
check('only JEE Advanced multiple-correct rows use partial marking',
  FORMAT_TEMPLATES.every((t) => t.subjects.every((s) => s.sections.every((sec) => sec.rows.every((r) => r.partialMarking === (r.kernel === 'MULTI_CHOICE'))))));
check('rowMaxMarks and round2 agree on a simple row', rowMaxMarks(row({ questionCount: 3, marksPerQuestion: 0.1 })) === round2(0.3));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
