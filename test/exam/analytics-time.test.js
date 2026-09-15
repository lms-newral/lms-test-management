// SPEC (written before the code): Time Management and the Difficulty Breakup.
//
// Where the three hours went: by subject, by what the time bought (right, wrong, nothing), and
// across the paper from first quarter to last — which is how a student sees that they spent the
// last forty minutes on six questions.
//
// The journey is built from the real visit spans, so a visit that straddles two quarters is split
// between them rather than counted in whichever one it started in.
//
// Modules under test:
//   src/modules/exam/analytics-time.logic.ts
//     timeBySubject(rows) | timeByOutcome(rows) | timeJourney(rows, endMs, buckets?)
//   src/modules/exam/analytics-difficulty.logic.ts
//     difficultyBreakup(rows, classStats)
const { timeBySubject, timeByOutcome, timeJourney } = require('../../dist/src/modules/exam/analytics-time.logic');
const { difficultyBreakup } = require('../../dist/src/modules/exam/analytics-difficulty.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const END = 400_000; // a four-minute "paper", so each quarter is 100 seconds

const rows = [
  {
    questionId: 'q1', subjectName: 'Physics', difficulty: 'EASY', result: 'CORRECT', marks: 4, maxMarks: 4,
    timeMs: 50_000, visits: 1, lastAnsweredMs: 40_000, visitTimeline: [{ enterMs: 0, leaveMs: 50_000, hiddenMs: 0 }],
  },
  {
    questionId: 'q2', subjectName: 'Physics', difficulty: 'HARD', result: 'INCORRECT', marks: -1, maxMarks: 4,
    timeMs: 100_000, visits: 1, lastAnsweredMs: 140_000, visitTimeline: [{ enterMs: 50_000, leaveMs: 150_000, hiddenMs: 0 }],
  },
  {
    questionId: 'q3', subjectName: 'Maths', difficulty: 'HARD', result: 'UNANSWERED', marks: 0, maxMarks: 4,
    timeMs: 110_000, visits: 1, lastAnsweredMs: null, visitTimeline: [{ enterMs: 150_000, leaveMs: 260_000, hiddenMs: 0 }],
  },
  {
    questionId: 'q4', subjectName: 'Maths', difficulty: 'EASY', result: 'CORRECT', marks: 4, maxMarks: 4,
    timeMs: 100_000, visits: 1, lastAnsweredMs: 380_000, visitTimeline: [{ enterMs: 300_000, leaveMs: null, hiddenMs: 0 }],
  },
  {
    questionId: 'q5', subjectName: 'Maths', difficulty: 'MEDIUM', result: 'UNANSWERED', marks: 0, maxMarks: 4,
    timeMs: 0, visits: 0, lastAnsweredMs: null, visitTimeline: [],
  },
];

/* --- 1. By subject ---------------------------------------------------------- */

const subjects = timeBySubject(rows);
const physics = subjects.find((s) => s.subject === 'Physics');
const maths = subjects.find((s) => s.subject === 'Maths');

check('every subject appears once', subjects.length === 2);
check('Physics time is the sum of its questions', physics.timeMs === 150_000);
check('Maths time is the sum of its questions', maths.timeMs === 210_000);
check('the shares add up to a hundred', Math.round(physics.share + maths.share) === 100, `${physics.share} + ${maths.share}`);
check('accuracy counts only what was answered', physics.accuracy === 50 && maths.accuracy === 100);
check('subjects are ordered by time spent', subjects[0].subject === 'Maths');
check('unopened questions are counted in the total', maths.questions === 3);

/* --- 2. What the time bought ----------------------------------------------- */

const outcome = timeByOutcome(rows);
check('time on correct answers', outcome.correctMs === 150_000);
check('time on wrong answers', outcome.incorrectMs === 100_000);
check('time on questions left blank', outcome.unansweredMs === 110_000);
check('questions never opened cost nothing', outcome.notSeenMs === 0);
check('the parts add up to the whole', outcome.correctMs + outcome.incorrectMs + outcome.unansweredMs === outcome.totalMs);

/* --- 3. The journey through the paper --------------------------------------- */
// A visit that crosses a quarter boundary is split, not dumped in one bucket.

const journey = timeJourney(rows, END);
check('four quarters by default', journey.length === 4);
check('the first quarter holds both early visits', journey[0].timeMs === 100_000, String(journey[0].timeMs));
check('the straddling visit is split across the boundary', journey[1].timeMs === 100_000, String(journey[1].timeMs));
check('the third quarter holds only the tail of that visit', journey[2].timeMs === 60_000, String(journey[2].timeMs));
check('a visit still open at the end closes at the end', journey[3].timeMs === 100_000, String(journey[3].timeMs));
check('the journey accounts for every millisecond spent', journey.reduce((n, q) => n + q.timeMs, 0) === 360_000);
check('each quarter knows its window', journey[0].fromMs === 0 && journey[0].toMs === 100_000 && journey[3].toMs === END);
check('answers land in the quarter they were committed in', journey[0].answered === 1 && journey[1].answered === 1 && journey[3].answered === 1);
check('and so do the marks they earned', journey[0].marks === 4 && journey[1].marks === -1 && journey[3].marks === 4);
check('a quarter with no answers is honest about it', journey[2].answered === 0 && journey[2].marks === 0);

// Answered early, then cleared before submitting: the answer is gone, so the quarter must not
// claim one. Otherwise a student reads "1 answered, 0 marks" and thinks the marking is broken.
const cleared = timeJourney(
  [{
    questionId: 'z', subjectName: 'Physics', difficulty: 'EASY', result: 'UNANSWERED', marks: 0, maxMarks: 4,
    timeMs: 20_000, visits: 2, lastAnsweredMs: 10_000,
    visitTimeline: [{ enterMs: 0, leaveMs: 20_000, hiddenMs: 0 }],
  }],
  END,
);
check('a question answered and then cleared counts as no answer', cleared[0].answered === 0 && cleared[0].marks === 0);
check('but the time it took still counts', cleared[0].timeMs === 20_000);

/* --- 4. By difficulty ------------------------------------------------------- */

const classStats = {
  EASY: { attempts: 900, accuracy: 82, avgTimeMs: 45_000 },
  HARD: { attempts: 900, accuracy: 31, avgTimeMs: 95_000 },
};
const breakup = difficultyBreakup(rows, classStats);
const hard = breakup.find((d) => d.difficulty === 'HARD');
const easy = breakup.find((d) => d.difficulty === 'EASY');
const medium = breakup.find((d) => d.difficulty === 'MEDIUM');

check('one row per difficulty present in the paper', breakup.length === 3);
check('the hard questions are counted', hard.total === 2 && hard.incorrect === 1 && hard.unanswered === 1);
check('accuracy on hard questions counts only what was answered', hard.accuracy === 0);
check('the easy ones were all correct', easy.total === 2 && easy.correct === 2 && easy.accuracy === 100);
check('time by difficulty is summed', easy.timeMs === 150_000 && hard.timeMs === 210_000);
check('the class accuracy sits alongside', easy.classAccuracy === 82 && hard.classAccuracy === 31);
check('a difficulty the class has no figures for is null, not zero', medium.classAccuracy === null);
check('a difficulty nobody answered has no accuracy', medium.accuracy === null && medium.total === 1);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
