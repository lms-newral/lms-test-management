// SPEC (written before the code): when an attempt may start and when it must end.
// The server clock is the only clock that matters; the device clock is only
// corrected by an offset, never trusted.
//
// Module under test: src/modules/exam/attempt-clock.logic.ts
//   canStart({ availableFrom, availableTo }, now) -> { ok: true } | { ok: false, reason: 'NOT_OPEN' | 'CLOSED' }
//   deadlineFor(startedAt, durationMinutes, availableTo) -> Date
//   remainingMs(deadline, now) -> number (never negative)
//   resumeState({ startedAt, deadline }, now) -> { deadline, remainingMs }
//   clockOffset(serverTime, deviceTimeAtReceipt) -> number (ms to add to the device clock)
//   correctedNow(deviceNow, offsetMs) -> number
//   eventInTime(tMs, allowedMs, skewMs?) -> boolean   (default skew 2000 ms)
const {
  canStart,
  deadlineFor,
  remainingMs,
  resumeState,
  clockOffset,
  correctedNow,
  eventInTime,
} = require('../../dist/src/modules/exam/attempt-clock.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};
const at = (hhmm, sec = 0) => new Date(`2027-01-10T${hhmm}:${String(sec).padStart(2, '0')}.000Z`);
const window = { availableFrom: at('10:00'), availableTo: at('13:00') };

/* --- 1. Starting ------------------------------------------------------------ */

check('cannot start before the test opens', JSON.stringify(canStart(window, at('09:59', 59))) === JSON.stringify({ ok: false, reason: 'NOT_OPEN' }));
check('can start the moment it opens', canStart(window, at('10:00')).ok === true);
check('can start while it is open', canStart(window, at('12:30')).ok === true);
check('cannot start the moment it closes', JSON.stringify(canStart(window, at('13:00'))) === JSON.stringify({ ok: false, reason: 'CLOSED' }));
check('cannot start after it closes', canStart(window, at('14:00')).reason === 'CLOSED');

/* --- 2. Deadline ------------------------------------------------------------ */

check('an early starter gets the full duration', deadlineFor(at('10:00'), 180, window.availableTo).getTime() === at('13:00').getTime());
check('a late starter never gets past the window close', deadlineFor(at('11:00'), 180, window.availableTo).getTime() === at('13:00').getTime());
check('a short test ends at start + duration', deadlineFor(at('10:15'), 60, window.availableTo).getTime() === at('11:15').getTime());

/* --- 3. Remaining time and resume ------------------------------------------ */

check('remaining time counts down', remainingMs(at('13:00'), at('12:59')) === 60_000);
check('remaining time is never negative', remainingMs(at('13:00'), at('13:05')) === 0);

const attempt = { startedAt: at('10:00'), deadline: at('13:00') };
const first = resumeState(attempt, at('11:00'));
const second = resumeState(attempt, at('11:30'));
check('resume keeps the original deadline', first.deadline.getTime() === at('13:00').getTime() && second.deadline.getTime() === at('13:00').getTime());
check('remaining time after a later resume is smaller, never reset', second.remainingMs < first.remainingMs && first.remainingMs === 2 * 3600_000);

/* --- 4. Device clock correction -------------------------------------------- */

const offset = clockOffset(at('10:00').toISOString(), at('09:59', 50).getTime());
check('a device 10 s slow gets a +10 s offset', offset === 10_000);
check('the corrected clock matches the server', correctedNow(at('09:59', 55).getTime(), offset) === at('10:00', 5).getTime());
check('a device ahead of the server gets a negative offset', clockOffset(at('10:00').toISOString(), at('10:00', 30).getTime()) === -30_000);

/* --- 5. Late-arriving events ----------------------------------------------- */

const allowed = 3 * 3600_000;
check('an event inside the allowed time is valid', eventInTime(allowed - 1, allowed));
check('an event within the 2 s skew allowance is valid', eventInTime(allowed + 2_000, allowed));
check('an event past the skew allowance is refused', !eventInTime(allowed + 2_001, allowed));
check('a negative time is refused', !eventInTime(-1, allowed));
check('a custom skew is honoured', eventInTime(allowed + 4_000, allowed, 5_000) && !eventInTime(allowed + 6_000, allowed, 5_000));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
