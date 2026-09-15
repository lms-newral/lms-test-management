// SPEC (written before the code): leaving the exam and refreshing.
//
// Agreed rules:
//   * tab switch, window blur or leaving full screen is a violation;
//     violations 1, 2 and 3 warn ("Warning N of 3"); the 4th submits the test;
//   * a blur and a visibility change that fire together are ONE violation;
//   * going offline is not a violation;
//   * refreshing is allowed 5 times, each followed by a notice with the count;
//     the 6th refresh submits the test;
//   * the full-screen exit a reload causes is not also a violation;
//   * counts are kept by the server; a client can never lower them.
//
// Module under test: src/modules/exam/attempt-proctor.logic.ts
//   MAX_WARNINGS (3), MAX_REFRESHES (5), VIOLATION_MERGE_MS (1500)
//   initialProctorState() -> { violations, refreshes, lastViolationT, submitted }
//   recordViolation(state, { kind, t, causedByReload? }) -> { state, action }
//   recordRefresh(state) -> { state, action }
//   mergeCounts(serverState, clientState) -> state
//   refreshNotice(count) -> string
// action: { type: 'NONE' } | { type: 'WARN', count, max } | { type: 'REFRESH_NOTICE', count, max }
//       | { type: 'AUTO_SUBMIT', reason: 'VIOLATIONS' | 'REFRESHES' }
const {
  MAX_WARNINGS,
  MAX_REFRESHES,
  VIOLATION_MERGE_MS,
  initialProctorState,
  recordViolation,
  recordRefresh,
  mergeCounts,
  refreshNotice,
} = require('../../dist/src/modules/exam/attempt-proctor.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

check('the limits are 3 warnings, 5 refreshes and a 1.5 s merge window', MAX_WARNINGS === 3 && MAX_REFRESHES === 5 && VIOLATION_MERGE_MS === 1500);

/* --- 1. Violations ---------------------------------------------------------- */

let s = initialProctorState();
check('a fresh attempt has no violations or refreshes', s.violations === 0 && s.refreshes === 0 && s.submitted === false);

let r = recordViolation(s, { kind: 'TAB_HIDDEN', t: 0 });
check('first tab switch warns 1 of 3', r.action.type === 'WARN' && r.action.count === 1 && r.action.max === 3);
s = r.state;

r = recordViolation(s, { kind: 'WINDOW_BLUR', t: 800 });
check('a blur fired together with the tab switch is not counted again', r.action.type === 'NONE' && r.state.violations === 1);
s = r.state;

r = recordViolation(s, { kind: 'WINDOW_BLUR', t: 1_500 });
check('exactly at the merge window it is still the same violation', r.action.type === 'NONE' && r.state.violations === 1);
s = r.state;

r = recordViolation(s, { kind: 'FULLSCREEN_EXIT', t: 20_000 });
check('leaving full screen later warns 2 of 3', r.action.type === 'WARN' && r.action.count === 2);
s = r.state;

r = recordViolation(s, { kind: 'OFFLINE', t: 30_000 });
check('going offline is not a violation', r.action.type === 'NONE' && r.state.violations === 2);
s = r.state;

r = recordViolation(s, { kind: 'TAB_HIDDEN', t: 40_000 });
check('third violation warns 3 of 3', r.action.type === 'WARN' && r.action.count === 3);
s = r.state;

r = recordViolation(s, { kind: 'WINDOW_BLUR', t: 60_000 });
check('the fourth violation submits the test', r.action.type === 'AUTO_SUBMIT' && r.action.reason === 'VIOLATIONS' && r.state.submitted === true);
s = r.state;

r = recordViolation(s, { kind: 'TAB_HIDDEN', t: 70_000 });
check('nothing is counted after the test is submitted', r.action.type === 'NONE' && r.state.violations === s.violations);

let two = recordViolation(initialProctorState(), { kind: 'TAB_HIDDEN', t: 0 }).state;
two = recordViolation(two, { kind: 'WINDOW_BLUR', t: 1_501 }).state;
check('events just outside the merge window are two violations', two.violations === 2);

/* --- 2. Refreshes ----------------------------------------------------------- */

s = initialProctorState();
let refreshActions = [];
for (let i = 1; i <= 5; i++) {
  r = recordRefresh(s);
  refreshActions.push(r.action);
  s = r.state;
}
check('refreshes 1 to 5 each show a notice with the count', refreshActions.every((a, i) => a.type === 'REFRESH_NOTICE' && a.count === i + 1 && a.max === 5));
check('five refreshes do not submit', s.submitted === false && s.refreshes === 5);
r = recordRefresh(s);
check('the sixth refresh submits the test', r.action.type === 'AUTO_SUBMIT' && r.action.reason === 'REFRESHES' && r.state.submitted === true);

s = recordRefresh(initialProctorState()).state;
r = recordViolation(s, { kind: 'FULLSCREEN_EXIT', t: 100, causedByReload: true });
check('the full-screen exit caused by a reload is not a violation', r.action.type === 'NONE' && r.state.violations === 0);

const notice = refreshNotice(3);
check('the refresh notice tells the student the count and the limit', notice.includes('3') && notice.includes('5'), notice);

/* --- 3. Counts cannot be reset --------------------------------------------- */

const server = { ...initialProctorState(), violations: 2, refreshes: 4 };
const clearedClient = { ...initialProctorState() };
const merged = mergeCounts(server, clearedClient);
check('a client with cleared storage cannot lower the counts', merged.violations === 2 && merged.refreshes === 4);
const offlineClient = { ...initialProctorState(), violations: 3, refreshes: 4 };
check('violations recorded offline on the device are kept when higher', mergeCounts(server, offlineClient).violations === 3);
check('submitted on either side stays submitted', mergeCounts({ ...server, submitted: true }, clearedClient).submitted === true);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
