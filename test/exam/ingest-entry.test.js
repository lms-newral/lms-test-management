// SPEC (written before the code): an ingest worker never destroys events it cannot place.
//
// Today an entry whose attempt is missing from this database is acknowledged and deleted, so the
// events vanish with nothing recording that they existed — that is how the load test lost 2,769
// events. The only two outcomes allowed for an entry are: process it, or park it in the
// dead-letter stream. Never discard.
//
// Module under test: src/modules/exam/attempt-ingest.logic.ts
//   entryAction({ attemptFound })      -> { action: 'PROCESS' | 'DEAD_LETTER', reason?: string }
//   deadLetterFields(attemptId, reason, events, at) -> flat field array for XADD
const { entryAction, deadLetterFields } = require('../../dist/src/modules/exam/attempt-ingest.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

/* --- 1. What may happen to an entry -------------------------------------- */

const known = entryAction({ attemptFound: true });
const unknown = entryAction({ attemptFound: false });

check('an entry for a known attempt is processed', known.action === 'PROCESS');
check('an entry for an unknown attempt is parked, not deleted', unknown.action === 'DEAD_LETTER');
check('the parked entry says why', unknown.reason === 'UNKNOWN_ATTEMPT');
check('there is no third outcome that loses events', [known.action, unknown.action].every((a) => a === 'PROCESS' || a === 'DEAD_LETTER'));

/* --- 2. What gets parked -------------------------------------------------- */

const events = [
  { seq: 1, t: 10, type: 'VISIT', q: 'q1', data: null, hash: 'a'.repeat(64) },
  { seq: 2, t: 20, type: 'SAVE_NEXT', q: 'q1', data: null, hash: 'b'.repeat(64) },
];
const fields = deadLetterFields('attempt-7', 'UNKNOWN_ATTEMPT', events, 1789000000000);
const map = {};
for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];

check('the fields are flat pairs for XADD', Array.isArray(fields) && fields.length % 2 === 0);
check('the attempt is recorded', map.a === 'attempt-7');
check('the reason is recorded', map.r === 'UNKNOWN_ATTEMPT');
check('the time is recorded', map.at === '1789000000000');
check('every event survives, unchanged', JSON.parse(map.e).length === 2 && JSON.parse(map.e)[1].seq === 2);
check('every value is a string, as Redis requires', fields.every((f) => typeof f === 'string'));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
