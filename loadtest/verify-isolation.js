/**
 * Proves the two fixes that came out of the load test, against a running service:
 *   1. every Redis name carries this environment's prefix, so two deployments
 *      cannot read each other's entries;
 *   2. events for an attempt this database has never heard of are PARKED in the
 *      dead-letter stream instead of being acked away — the path that silently
 *      ate 2,769 events.
 *
 *   REDIS_PORT=6380 REDIS_PREFIX=loadtest LOADTEST_API=http://localhost:5858 \
 *     node loadtest/verify-isolation.js
 */
const Redis = require('ioredis');
const { API, chain, secret } = require('./lib');
const { signAttemptToken } = require('../dist/src/modules/exam/attempt-ingest.logic');
const { examKeys } = require('../dist/src/modules/exam/exam-keys.logic');

const keys = examKeys(process.env.REDIS_PREFIX);
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

async function main() {
  const redis = new Redis({ host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379) });

  // A perfectly valid token for an attempt that does not exist here — exactly what
  // another environment's events look like to this worker.
  const attemptId = `ghost-${Date.now()}`;
  const token = signAttemptToken({ attemptId, userId: 'ghost-user', tenantId: 'loadtest-tenant', exp: Date.now() + 3600_000 }, secret());
  const events = chain('0'.repeat(64), [
    { seq: 1, t: 100, type: 'VISIT', q: 'loadtest-q-0000', data: { via: 'NEXT' } },
    { seq: 2, t: 200, type: 'SELECT', q: 'loadtest-q-0000', data: { choice: [1] } },
    { seq: 3, t: 300, type: 'SAVE_NEXT', q: 'loadtest-q-0000', data: null },
  ]);

  const before = Number(await redis.xlen(keys.deadLetter).catch(() => 0));
  const res = await fetch(`${API}/exam/attempts/${attemptId}/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-attempt-token': token },
    body: JSON.stringify({ events }),
  });
  check('the API accepts the batch', res.status === 200, `HTTP ${res.status}`);

  await new Promise((r) => setTimeout(r, 4000)); // let the worker read it

  const after = Number(await redis.xlen(keys.deadLetter));
  check('orphaned events are parked, not dropped', after === before + 1, `${keys.deadLetter}: ${before} -> ${after}`);

  if (after > before) {
    const [[, fields]] = await redis.xrevrange(keys.deadLetter, '+', '-', 'COUNT', 1);
    const map = {};
    for (let i = 0; i < fields.length; i += 2) map[fields[i]] = fields[i + 1];
    check('the parked entry names the attempt', map.a === attemptId, map.a);
    check('the parked entry says why', map.r === 'UNKNOWN_ATTEMPT', map.r);
    check('every event survived', JSON.parse(map.e).length === 3);
    check('the hash chain is intact', JSON.parse(map.e)[2].hash === events[2].hash);
  }

  const all = await redis.keys('*');
  const unprefixed = keys.persisted === 'exam:persisted' ? [] : all.filter((k) => /^exam:(events|persisted|rejected|deadletter)/.test(k));
  check('nothing is written under the old global names', unprefixed.length === 0, unprefixed.join(', '));
  check('the stream is namespaced', all.includes(keys.stream(0)) || all.some((k) => k.startsWith(keys.stream(0).slice(0, -1))), keys.stream(0));

  const groups = await redis.xinfo('GROUPS', keys.stream(0)).catch(() => []);
  const names = groups.map((g) => g[1]);
  check('the consumer group is namespaced', names.includes(keys.group), names.join(', ') || 'no groups');

  redis.disconnect();
  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
