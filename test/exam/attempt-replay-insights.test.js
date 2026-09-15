// SPEC (written before the code): the extra facts the analytics need from a replay.
// The original replay spec (attempt-replay.test.js) stays unchanged; these are additions.
//
// replayAttempt(paper, events, options?) — options.endMs: when there is no SUBMIT (the server
// auto-submitted), open visits, offline and outside-full-screen periods close at endMs.
// Per question, in addition to the original fields:
//   lastAnsweredMs, answerHistory [{ t, answer }], selections, finalDraft, activeMs, idleMs,
//   bookmarked, reported, maxScrollPct
// Per attempt: endMs, offlineMs, outsideFullscreenMs, instructionsMs, copyAttempts, paletteToggles,
//   device, activeMs
// Activity: every interaction event (VISIT, SELECT, SAVE_NEXT, SAVE_MARK, MARK_NEXT, CLEAR, SCROLL,
// BOOKMARK, REPORT, PALETTE, ACTIVE) at time t means the student was active during (t - 30 s, t].
// Active time on a question is its visit time covered by those windows, minus hidden time;
// idle time = time - hidden - active.
const { replayAttempt } = require('../../dist/src/modules/exam/attempt-replay.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const paper = {
  sections: [{ id: 's1', subjectName: 'Physics', name: 'Section A' }],
  questions: [
    { id: 'q1', sectionId: 's1', kernel: 'SINGLE_CHOICE', optionCount: 4 },
    { id: 'q2', sectionId: 's1', kernel: 'NUMERIC', optionCount: 0 },
    { id: 'q3', sectionId: 's1', kernel: 'SINGLE_CHOICE', optionCount: 4 },
  ],
};
const stream = (...items) => items.map(([t, type, q, data], i) => ({ seq: i + 1, t, type, q, data }));
const run = (items, options) => replayAttempt(paper, stream(...items), options);

/* --- 1. Answer history ------------------------------------------------------ */

let r = run([
  [0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [0] }], [2000, 'SAVE_NEXT', 'q1'],
  [3000, 'VISIT', 'q1'], [4000, 'SELECT', 'q1', { choice: [2] }], [5000, 'SAVE_MARK', 'q1'],
  [6000, 'CLEAR', 'q1'], [7000, 'SELECT', 'q1', { choice: [3] }], [8000, 'SAVE_NEXT', 'q1'],
]);
check('every commit and clear is kept in order', same(r.questions.q1.answerHistory, [
  { t: 2000, answer: { choice: [0] } }, { t: 5000, answer: { choice: [2] } }, { t: 6000, answer: null }, { t: 8000, answer: { choice: [3] } },
]), JSON.stringify(r.questions.q1.answerHistory));
check('last answered time is the final saving commit', r.questions.q1.lastAnsweredMs === 8000);
check('selections count every option change, saved or not', r.questions.q1.selections === 3);

r = run([[0, 'VISIT', 'q1'], [1000, 'SAVE_NEXT', 'q1']]);
check('saving with nothing chosen adds no history', same(r.questions.q1.answerHistory, []) && r.questions.q1.lastAnsweredMs === null);

/* --- 2. The draft left unsaved at the end ---------------------------------- */

r = run([[0, 'VISIT', 'q1'], [1000, 'SELECT', 'q1', { choice: [1] }], [2000, 'SUBMIT', undefined, { reason: 'AUTO_TIME' }]]);
check('a selection still unsaved at submit is kept as the final draft', same(r.questions.q1.finalDraft, { choice: [1] }));
check('...and it is still not the answer', r.questions.q1.answer === null);
r = run([[0, 'VISIT', 'q2'], [1000, 'SELECT', 'q2', { text: '9.8' }], [2000, 'VISIT', 'q1'], [3000, 'SUBMIT', undefined, { reason: 'MANUAL' }]]);
check('a draft discarded by moving away is not a final draft', r.questions.q2.finalDraft === null);

/* --- 3. Active, idle and hidden time --------------------------------------- */

r = run([[0, 'VISIT', 'q1'], [10_000, 'SELECT', 'q1', { choice: [0] }], [40_000, 'ACTIVE'], [100_000, 'VISIT', 'q2']]);
check('active time is the visit time covered by 30 s activity windows', r.questions.q1.activeMs === 40_000, String(r.questions.q1.activeMs));
check('idle time is the rest of the visit', r.questions.q1.idleMs === 60_000, String(r.questions.q1.idleMs));

r = run([[0, 'VISIT', 'q1'], [20_000, 'HIDDEN'], [30_000, 'VISIBLE'], [60_000, 'ACTIVE'], [60_000, 'VISIT', 'q2']]);
check('hidden time is not active time', r.questions.q1.hiddenMs === 10_000 && r.questions.q1.activeMs === 30_000, JSON.stringify([r.questions.q1.hiddenMs, r.questions.q1.activeMs]));
check('idle = time - hidden - active', r.questions.q1.idleMs === 20_000, String(r.questions.q1.idleMs));

// Events count for the question open when they happen; the click that opens q2 belongs to q2.
r = run([[0, 'VISIT', 'q1'], [5_000, 'ACTIVE'], [10_000, 'ACTIVE'], [20_000, 'VISIT', 'q2']]);
check('overlapping activity windows are not counted twice', r.questions.q1.activeMs === 10_000 && r.questions.q1.idleMs === 10_000, JSON.stringify([r.questions.q1.activeMs, r.questions.q1.idleMs]));
check('attempt active time adds up the questions', r.activeMs === r.questions.q1.activeMs + r.questions.q2.activeMs + r.questions.q3.activeMs);

/* --- 4. Ending without SUBMIT (server auto-submit) ------------------------- */

r = run([[0, 'VISIT', 'q1'], [5_000, 'VISIT', 'q2']], { endMs: 60_000 });
check('without SUBMIT the open visit closes at endMs', r.questions.q2.timeMs === 55_000 && r.endMs === 60_000);
check('...and the attempt is still not marked submitted', r.submitted === false && r.submitMs === null);
r = run([[0, 'VISIT', 'q1'], [5_000, 'SUBMIT', undefined, { reason: 'MANUAL' }]], { endMs: 60_000 });
check('a SUBMIT wins over endMs', r.endMs === 5_000 && r.questions.q1.timeMs === 5_000);
r = run([[0, 'VISIT', 'q1'], [7_000, 'VISIT', 'q2']]);
check('with neither, the attempt ends at the last event', r.endMs === 7_000);

/* --- 5. Offline and full screen -------------------------------------------- */

r = run([
  [0, 'VISIT', 'q1'], [10_000, 'OFFLINE'], [70_000, 'ONLINE'], [80_000, 'OFFLINE'],
  [90_000, 'SUBMIT', undefined, { reason: 'AUTO_TIME' }],
]);
check('offline time adds every offline period, an open one ends at submit', r.offlineMs === 70_000, String(r.offlineMs));

r = run([
  [0, 'VISIT', 'q1'], [10_000, 'FULLSCREEN', undefined, { inside: false }], [25_000, 'FULLSCREEN', undefined, { inside: true }],
  [50_000, 'FULLSCREEN', undefined, { inside: false }],
], { endMs: 60_000 });
check('time outside full screen adds every period, an open one ends at endMs', r.outsideFullscreenMs === 25_000, String(r.outsideFullscreenMs));

/* --- 6. Other signals ------------------------------------------------------- */

r = run([
  [0, 'START', undefined, { instructionsMs: 95_000 }],
  [0, 'DEVICE', undefined, { type: 'MOBILE', os: 'Android', browser: 'Chrome', screen: '412x915', timezone: 'Asia/Kolkata' }],
  [100, 'VISIT', 'q1'], [2_000, 'BOOKMARK', 'q1', { on: true }], [3_000, 'BOOKMARK', 'q3', { on: true }], [4_000, 'BOOKMARK', 'q3', { on: false }],
  [5_000, 'REPORT', 'q1', { reason: 'Option 2 repeats option 1' }],
  [6_000, 'SCROLL', 'q1', { pct: 40 }], [7_000, 'SCROLL', 'q1', { pct: 100 }], [8_000, 'SCROLL', 'q1', { pct: 60 }],
  [9_000, 'COPY'], [9_500, 'COPY'], [10_000, 'PALETTE', undefined, { open: false }],
]);
check('time on the instructions page is taken from START', r.instructionsMs === 95_000);
check('the device is taken from the DEVICE event', r.device && r.device.type === 'MOBILE' && r.device.timezone === 'Asia/Kolkata');
check('bookmarks keep their last state', r.questions.q1.bookmarked === true && r.questions.q3.bookmarked === false);
check('a reported question is flagged', r.questions.q1.reported === true && r.questions.q2.reported === false);
check('the deepest scroll on a question is kept', r.questions.q1.maxScrollPct === 100 && r.questions.q2.maxScrollPct === 0);
check('copy attempts and palette toggles are counted', r.copyAttempts === 2 && r.paletteToggles === 1);

r = run([[0, 'VISIT', 'q1']]);
check('without those events the extras have safe defaults',
  r.instructionsMs === null && r.device === null && r.offlineMs === 0 && r.outsideFullscreenMs === 0 && r.copyAttempts === 0 && r.questions.q1.bookmarked === false);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
