// SPEC (written before the code): the leaderboard and the student's own note on a result.
//
// The leaderboard shows other students to each other, so it shows a short name — first name and
// the initial of the last — never a full name. The student always sees where they stand, even when
// they are not in the top ten.
//
// "Points to be Noted" is the student's own note to their future self: trimmed, capped, and an
// empty note clears it rather than saving blank space.
//
// Module under test: src/modules/exam/result-extras.logic.ts
//   displayName(name)                          -> 'Rahul S.' | 'Rahul' | 'Student'
//   leaderboard(attemptsByRank, youId, limit)  -> { rows, you }
//   NOTE_MAX                                   -> 2000
//   normaliseNote(text)                        -> { note: string | null } | { problem: string }
const { displayName, leaderboard, NOTE_MAX, normaliseNote } = require('../../dist/src/modules/exam/result-extras.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

/* --- 1. Short names ---------------------------------------------------------- */

check('first name and last initial', displayName('Rahul Kumar Sharma') === 'Rahul S.');
check('a single name stays as it is', displayName('Rahul') === 'Rahul');
check('extra spaces are ignored', displayName('  Priya   Nair  ') === 'Priya N.');
check('no name becomes Student', displayName(null) === 'Student' && displayName('   ') === 'Student');
check('an email is never shown', displayName('rahul.sharma@example.com') === 'Student');

/* --- 2. The leaderboard ------------------------------------------------------ */

const attempts = Array.from({ length: 14 }, (_, i) => ({
  id: `a${i + 1}`,
  rank: i < 2 ? 1 : i + 1, // the first two share rank 1
  score: 300 - i * 10,
  userName: `Student Number${i + 1}`,
}));

const top = leaderboard(attempts, 'a3', 10);
check('the top ten are listed', top.rows.length === 10);
check('ties keep their shared rank', top.rows[0].rank === 1 && top.rows[1].rank === 1);
check('names are shortened', top.rows[0].name === 'Student N.');
check('the student is marked in the list when they are in it', top.rows[2].isYou === true && top.rows.filter((r) => r.isYou).length === 1);
check('and is not repeated below', top.you === null);

const far = leaderboard(attempts, 'a13', 10);
check('a student outside the top ten is not squeezed into it', far.rows.every((r) => !r.isYou));
check('but still sees their own place', far.you !== null && far.you.rank === 13 && far.you.isYou === true);
check('their own row carries their score', far.you.score === 180);

const missing = leaderboard(attempts, 'nobody', 10);
check('someone not in the cohort sees no row of their own', missing.you === null);
check('an empty cohort has an empty board', leaderboard([], 'a1', 10).rows.length === 0);

/* --- 3. The note -------------------------------------------------------------- */

check('the cap is two thousand characters', NOTE_MAX === 2000);
check('a note is trimmed', normaliseNote('  I rushed the numericals.  ').note === 'I rushed the numericals.');
check('an empty note clears it', normaliseNote('   ').note === null && normaliseNote('').note === null);
check('a note at the cap is kept', normaliseNote('x'.repeat(2000)).note.length === 2000);
check('a note over the cap is refused, not cut', typeof normaliseNote('x'.repeat(2001)).problem === 'string');
check('the refusal says the limit', /2000|2,000/.test(normaliseNote('x'.repeat(2001)).problem));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
