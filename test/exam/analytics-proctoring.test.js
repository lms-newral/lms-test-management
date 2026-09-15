// SPEC (written before the code): the integrity panel an admin sees next to a student's analytics.
//
// Every number here was already captured during the exam. The job of this module is to say what
// they mean in plain words, and to separate what the student did (switched away, tried to copy)
// from what merely happened to them (the Wi-Fi dropped) — an offline stretch is not misconduct and
// must never be shown as though it were.
//
// Module under test: src/modules/exam/analytics-proctoring.logic.ts
//   proctoringSummary(attempt) -> { ...counts, idleMs, flags }
const { proctoringSummary } = require('../../dist/src/modules/exam/analytics-proctoring.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const clean = {
  violations: 0, lastViolationT: null, refreshes: 0, copyAttempts: 0,
  offlineMs: 0, outsideFullscreenMs: 0, instructionsMs: 45_000,
  timeUsedMs: 10_800_000, activeMs: 10_000_000,
  device: { deviceType: 'DESKTOP' }, lateSync: false, rejectedBatches: 0,
  submittedBy: 'CLIENT', submitReason: 'MANUAL',
};
const codes = (a) => proctoringSummary(a).flags.map((f) => f.code);
const flag = (a, code) => proctoringSummary(a).flags.find((f) => f.code === code);

/* --- 1. A clean attempt ----------------------------------------------------- */

const quiet = proctoringSummary(clean);
check('a clean attempt raises nothing', quiet.flags.length === 0, codes(clean).join(', '));
check('the counts still come through', quiet.violations.count === 0 && quiet.refreshes.count === 0);
check('idle time is what was not active', quiet.idleMs === 800_000);
check('idle time never goes negative', proctoringSummary({ ...clean, activeMs: 11_000_000 }).idleMs === 0);
check('the device is carried', quiet.device.deviceType === 'DESKTOP');
check('how long they sat on the instructions is kept', quiet.instructionsMs === 45_000);

/* --- 2. Leaving the exam ---------------------------------------------------- */

const warned = { ...clean, violations: 2, lastViolationT: 3_600_000 };
check('tab switches are reported', flag(warned, 'VIOLATIONS').level === 'WARN');
check('and counted in the message', flag(warned, 'VIOLATIONS').message.includes('2'));
check('the last one keeps its time', proctoringSummary(warned).violations.lastAtMs === 3_600_000);

const kicked = { ...clean, violations: 4, submittedBy: 'SERVER', submitReason: 'VIOLATIONS' };
check('being auto-submitted for leaving is the most serious flag', flag(kicked, 'AUTO_SUBMIT_VIOLATIONS').level === 'ALERT');
check('and it is listed first', codes(kicked)[0] === 'AUTO_SUBMIT_VIOLATIONS');

/* --- 3. Refreshing and copying ---------------------------------------------- */

check('refreshes are reported', flag({ ...clean, refreshes: 3 }, 'REFRESHES').level === 'WARN');
check('being auto-submitted for refreshing is an alert', flag({ ...clean, refreshes: 6, submittedBy: 'SERVER', submitReason: 'REFRESHES' }, 'AUTO_SUBMIT_REFRESHES').level === 'ALERT');
check('copy attempts are reported', flag({ ...clean, copyAttempts: 5 }, 'COPY').level === 'WARN');
check('and say how many times', flag({ ...clean, copyAttempts: 5 }, 'COPY').message.includes('5'));
check('a long stretch outside full screen is reported', flag({ ...clean, outsideFullscreenMs: 300_000 }, 'OUTSIDE_FULLSCREEN').level === 'WARN');
check('a blink outside full screen is not', !flag({ ...clean, outsideFullscreenMs: 900 }, 'OUTSIDE_FULLSCREEN'));

/* --- 4. What merely happened to them ---------------------------------------- */
// None of these are misconduct, so none of them may read as an accusation.

const offline = { ...clean, offlineMs: 420_000 };
check('a long offline stretch is noted, not accused', flag(offline, 'OFFLINE').level === 'INFO');
check('and says the answers were safe', /saved|kept|device/i.test(flag(offline, 'OFFLINE').message), flag(offline, 'OFFLINE').message);
check('a late sync is noted as information', flag({ ...clean, lateSync: true }, 'LATE_SYNC').level === 'INFO');
check('running out of time is normal, not an alert', flag({ ...clean, submittedBy: 'SERVER', submitReason: 'AUTO_TIME' }, 'AUTO_SUBMIT_TIME').level === 'INFO');
check('refused uploads are worth a look', flag({ ...clean, rejectedBatches: 2 }, 'REJECTED').level === 'WARN');

/* --- 5. Order and completeness ---------------------------------------------- */

const messy = { ...clean, violations: 4, refreshes: 3, copyAttempts: 2, offlineMs: 300_000, lateSync: true, submittedBy: 'SERVER', submitReason: 'VIOLATIONS' };
const levels = proctoringSummary(messy).flags.map((f) => f.level);
check('the worst news comes first', levels.indexOf('ALERT') === 0 && levels.lastIndexOf('INFO') === levels.length - 1, levels.join(','));
check('nothing is dropped', proctoringSummary(messy).flags.length >= 5, String(proctoringSummary(messy).flags.length));
check('every flag can be read by a human', proctoringSummary(messy).flags.every((f) => typeof f.message === 'string' && f.message.length > 10));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
