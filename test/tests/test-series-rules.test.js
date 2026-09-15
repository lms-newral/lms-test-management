// Offline checks for test series rules -- no DB.
//
// A series is sold and scheduled: a result shown before a test closes, a test
// open outside the series window or a discount above the price would all reach
// paying students, so these are checked before anything is saved or published.
const {
  moveProblem,
  pricingProblems,
  scheduleProblems,
  seriesPublishProblems,
  startedEditProblem,
  subtreeIds,
  windowProblems,
} = require('../../dist/src/modules/tests/test-series.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const d = (day, hour = 10) => new Date(Date.UTC(2027, 0, day, hour));
const has = (list, text) => list.some((p) => p.includes(text));

const window = { startAt: d(1), endAt: d(31) };
const sched = (over = {}) => ({ availableFrom: d(5), availableTo: d(6), resultAt: d(7), ...over });

/* --- 1. Schedule ------------------------------------------------------------ */

check('a test that opens, closes, then shows results passes', scheduleProblems(sched(), window, 'T').length === 0);
check('results may be shown the moment it closes', scheduleProblems(sched({ resultAt: d(6) }), window, 'T').length === 0);
check('closing before opening is refused', has(scheduleProblems(sched({ availableTo: d(4) }), window, 'T'), 'close after it opens'));
check('results before the test opens are refused', has(scheduleProblems(sched({ resultAt: d(4) }), window, 'T'), 'before the test opens'));
check('results while the test is open are refused', has(scheduleProblems(sched({ availableTo: d(8), resultAt: d(7) }), window, 'T'), 'still open'));
check('opening before the series starts is refused', has(scheduleProblems(sched({ availableFrom: d(1, 9) }), window, 'T'), 'before the series starts'));
check('closing after the series ends is refused', has(scheduleProblems(sched({ availableTo: d(31, 11), resultAt: d(31, 12) }), window, 'T'), 'close by the time'));
check('results after the series ends are refused', has(scheduleProblems(sched({ resultAt: d(31, 11) }), window, 'T'), 'results must be shown by'));
check('a missing time is named', has(scheduleProblems(sched({ resultAt: null }), window, 'T'), 'when results are shown'));

/* --- 2. Window and price ---------------------------------------------------- */

check('a window ending before it starts is refused', has(windowProblems({ startAt: d(5), endAt: d(4) }, false), 'end after it starts'));
check('a draft may leave the window empty', windowProblems({ startAt: null, endAt: null }, false).length === 0);
check('publishing needs both dates', windowProblems({ startAt: null, endAt: null }, true).length === 2);
check('a free series ignores prices', pricingProblems(false, null, 50, true).length === 0);
check('a paid series needs a price to publish', has(pricingProblems(true, null, null, true), 'Set a price'));
check('a discount above the price is refused', has(pricingProblems(true, 999, 1200, false), 'cannot be more than the price'));
check('a discount equal to the price is allowed', pricingProblems(true, 999, 999, true).length === 0);
check('a zero price is refused', has(pricingProblems(true, 0, null, false), 'more than 0'));
check('prices beyond paise are refused', has(pricingProblems(true, 99.999, null, false), '2 decimal'));

/* --- 3. Published series keep their past ------------------------------------ */

const now = d(5, 12);
check('an unopened test can be rescheduled freely', startedEditProblem(sched({ availableFrom: d(6) }), sched({ availableFrom: d(9) }), now) === null);
check('an opened test keeps its opening time', has([startedEditProblem(sched(), sched({ availableFrom: d(5, 11) }), now) ?? ''], 'opening time'));
check('an opened test may close later', startedEditProblem(sched(), sched({ availableTo: d(6, 12), resultAt: d(7) }), now) === null);
// Agreed with the user (15 Sep 2026): an opened test may close early. Students already writing keep
// the deadline fixed when they started, so closing early only stops new starts — but never into the past.
check('an opened test may close earlier, if still in the future', startedEditProblem(sched(), sched({ availableTo: d(5, 13), resultAt: d(5, 14) }), now) === null);
check('an opened test may not close in the past', has([startedEditProblem(sched(), sched({ availableTo: d(5, 11), resultAt: d(5, 14) }), now) ?? ''], 'already passed'));
check('an opened test may not lose its closing time', has([startedEditProblem(sched(), sched({ availableTo: null }), now) ?? ''], 'closing time'));
check('an opened test may show results earlier', startedEditProblem(sched(), sched({ resultAt: d(6, 11) }), now) === null);
check('an opened test may not show results in the past', has([startedEditProblem(sched(), sched({ availableTo: d(5, 13), resultAt: d(5, 11) }), now) ?? ''], 'already passed'));

/* --- 4. Publishing ---------------------------------------------------------- */

const details = (over = {}) => ({
  name: 'JEE 2027 Mock Series', classLevel: 'Class 12', examType: 'JEE Main', targetYear: 2027,
  descriptionHtml: '<p>10 full mocks</p>', isPaid: true, price: 1999, discountedPrice: 999, ...window, ...over,
});
const item = (over = {}) => ({ testName: 'Mock 1', testPublished: true, schedule: sched(), ...over });

check('a complete series publishes', seriesPublishProblems(details(), [item()]).length === 0);
check('a series without tests cannot publish', has(seriesPublishProblems(details(), []), 'at least one test'));
check('a draft test blocks publishing', has(seriesPublishProblems(details(), [item({ testPublished: false })]), 'not published'));
check('an unscheduled test blocks publishing', has(seriesPublishProblems(details(), [item({ schedule: sched({ availableFrom: null }) })]), 'when it opens'));
check('missing class and exam type are named', (() => {
  const p = seriesPublishProblems(details({ classLevel: '', examType: null }), [item()]);
  return has(p, 'class') && has(p, 'exam type');
})());

/* --- 5. Folder tree --------------------------------------------------------- */

const nodes = [
  { id: 'f1', parentId: null, kind: 'FOLDER' },
  { id: 'f2', parentId: 'f1', kind: 'FOLDER' },
  { id: 't1', parentId: 'f2', kind: 'TEST' },
];
check('a test can move into a folder', moveProblem(nodes, 't1', 'f1') === null);
check('anything can move to the top level', moveProblem(nodes, 'f2', null) === null);
check('a folder cannot move inside itself', has([moveProblem(nodes, 'f1', 'f1') ?? ''], 'inside itself'));
check('a folder cannot move inside its own child', has([moveProblem(nodes, 'f1', 'f2') ?? ''], 'inside itself'));
check('nothing can go inside a test', has([moveProblem(nodes, 'f2', 't1') ?? ''], 'inside a folder'));
check('removing a folder takes everything under it', subtreeIds(nodes, 'f1').sort().join() === 'f1,f2,t1');

/* --- 6. Students ------------------------------------------------------------ */

const { seriesVisible, seriesReadable, testState, enrollProblem, payableOf } = require('../../dist/src/modules/tests/test-series.logic');
const pub = (over = {}) => ({ status: 'PUBLISHED', startAt: d(1), endAt: d(31), isPaid: false, ...over });
check('a published series inside its window is visible', seriesVisible(pub(), d(10)));
check('a draft series is hidden', !seriesVisible(pub({ status: 'DRAFT' }), d(10)));
check('a series is hidden before it starts', !seriesVisible(pub(), d(1, 9)));
check('a series is hidden after it ends', !seriesVisible(pub(), d(31, 11)));

// Looking back is different from buying: results, solutions and notes must outlive the sale window.
check('a visible series is readable to everyone', seriesReadable(pub({ publishedAt: d(1) }), d(10), false));
check('an enrolled student keeps a series after it ends', seriesReadable(pub({ publishedAt: d(1) }), d(31, 11), true));
check('anyone else loses it when it ends', !seriesReadable(pub({ publishedAt: d(1) }), d(31, 11), false));
check('a series that was never published is never readable', !seriesReadable(pub({ status: 'DRAFT', publishedAt: null }), d(31, 11), true));
check('an unscheduled test is NOT_SCHEDULED', testState(sched({ resultAt: null }), d(5)) === 'NOT_SCHEDULED');
check('before opening a test is UPCOMING', testState(sched(), d(4)) === 'UPCOMING');
check('the moment it opens it is LIVE', testState(sched(), d(5)) === 'LIVE');
check('after closing and before results it is AWAITING_RESULT', testState(sched(), d(6, 12)) === 'AWAITING_RESULT');
check('from the result time it is RESULT_OUT', testState(sched(), d(7)) === 'RESULT_OUT');
check('a free visible series can be joined', enrollProblem(pub(), d(10), false) === null);
check('a paid series cannot be joined for free', (enrollProblem(pub({ isPaid: true }), d(10), false) ?? '').includes('paid'));
check('joining twice is refused', (enrollProblem(pub(), d(10), true) ?? '').includes('already'));
check('a hidden series cannot be joined', (enrollProblem(pub({ status: 'UNPUBLISHED' }), d(10), false) ?? '').includes('not available'));
check('students pay the discounted price', payableOf({ isPaid: true, price: 1999, discountedPrice: 999 }) === 999);
check('a free series costs nothing', payableOf({ isPaid: false, price: 1999, discountedPrice: null }) === 0);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
