// SPEC (written before the code): the student details frozen on an attempt, so comparisons by
// class / target year / city / state / course or batch / device stay possible forever.
//
// Module under test: src/modules/exam/attempt-cohort.logic.ts
//   deviceTypeFrom(userAgent) -> 'MOBILE' | 'TABLET' | 'DESKTOP' | 'UNKNOWN'
//   cohortSnapshot(profile, courseIds, userAgent) -> { classLevel, targetYear, city, state, courseIds, deviceType }
//     strings trimmed, empty -> null; targetYear a 4-digit year or null; courseIds unique and sorted
const { deviceTypeFrom, cohortSnapshot } = require('../../dist/src/modules/exam/attempt-cohort.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const UA = {
  androidPhone: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  androidTablet: 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
};

check('an Android phone is MOBILE', deviceTypeFrom(UA.androidPhone) === 'MOBILE');
check('an iPhone is MOBILE', deviceTypeFrom(UA.iphone) === 'MOBILE');
check('an iPad is TABLET', deviceTypeFrom(UA.ipad) === 'TABLET');
check('an Android device without "Mobile" is TABLET', deviceTypeFrom(UA.androidTablet) === 'TABLET');
check('Windows and Mac are DESKTOP', deviceTypeFrom(UA.windows) === 'DESKTOP' && deviceTypeFrom(UA.mac) === 'DESKTOP');
check('a missing user agent is UNKNOWN', deviceTypeFrom('') === 'UNKNOWN' && deviceTypeFrom(undefined) === 'UNKNOWN');

const snap = cohortSnapshot({ classLevel: ' Class 12 ', targetYear: '2027', city: 'Pune', state: '  ' }, ['c2', 'c1', 'c2'], UA.windows);
check('values are trimmed and empty ones become null', snap.classLevel === 'Class 12' && snap.city === 'Pune' && snap.state === null);
check('the target year becomes a number', snap.targetYear === 2027);
check('course ids are unique and sorted', JSON.stringify(snap.courseIds) === JSON.stringify(['c1', 'c2']));
check('the device type is included', snap.deviceType === 'DESKTOP');
const empty = cohortSnapshot(null, [], '');
check('no profile gives an all-empty snapshot', empty.classLevel === null && empty.targetYear === null && empty.courseIds.length === 0 && empty.deviceType === 'UNKNOWN');
check('a target year that is not a real year is dropped', cohortSnapshot({ targetYear: '27' }, [], '').targetYear === null && cohortSnapshot({ targetYear: 2031 }, [], '').targetYear === 2031);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
