// SPEC (written before the code): Redis keys are namespaced per environment.
//
// Under load we lost 2,769 of 8,866 events because a second service on the same Redis joined the
// same consumer group, read entries for attempts it had never heard of, and acked them away. Every
// stream, hash and group name must therefore carry an environment prefix, and two prefixes must
// never be able to collide.
//
// The default prefix has to reproduce today's names exactly, or a deploy would orphan events that
// are already in flight.
//
// Module under test: src/modules/exam/exam-keys.logic.ts
//   examKeys(prefix?) -> { stream(shard), persisted, rejected, deadLetter, group, bullPrefix }
const { examKeys } = require('../../dist/src/modules/exam/exam-keys.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

/* --- 1. The default keeps today's names ---------------------------------- */

const base = examKeys();
check('default stream key is unchanged', base.stream(0) === 'exam:events:0');
check('default stream key shards', base.stream(3) === 'exam:events:3');
check('default persisted hash is unchanged', base.persisted === 'exam:persisted');
check('default rejected hash is unchanged', base.rejected === 'exam:rejected');
check('default consumer group is unchanged', base.group === 'exam-ingest');
check('an empty or blank prefix falls back to the default', examKeys('').stream(0) === 'exam:events:0' && examKeys('   ').group === 'exam-ingest');

/* --- 2. A prefix moves every name ---------------------------------------- */

const staging = examKeys('staging');
check('the stream is namespaced', staging.stream(0) === 'staging:exam:events:0');
check('the persisted hash is namespaced', staging.persisted === 'staging:exam:persisted');
check('the rejected hash is namespaced', staging.rejected === 'staging:exam:rejected');
check('the consumer group is namespaced', staging.group === 'staging:exam-ingest');
check('BullMQ queues are namespaced too', staging.bullPrefix === 'staging:bull');
check('there is a dead-letter stream', staging.deadLetter === 'staging:exam:deadletter' && base.deadLetter === 'exam:deadletter');

/* --- 3. Two environments can never collide ------------------------------- */

const a = examKeys('prod');
const b = examKeys('dev');
const namesOf = (k) => [k.persisted, k.rejected, k.deadLetter, k.group, k.bullPrefix, ...[0, 1, 2, 3, 7].map((s) => k.stream(s))];
const shared = namesOf(a).filter((name) => namesOf(b).includes(name));
check('no key or group is shared between two prefixes', shared.length === 0, shared.join(', '));
check('the default shares nothing with a named prefix', namesOf(base).filter((n) => namesOf(a).includes(n)).length === 0);

/* --- 4. A prefix cannot smuggle in separators ---------------------------- */

check('a prefix is trimmed', examKeys('  staging  ').group === 'staging:exam-ingest');
check('trailing colons do not double up', examKeys('staging:').stream(1) === 'staging:exam:events:1');

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
