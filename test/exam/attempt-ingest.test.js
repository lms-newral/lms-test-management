// SPEC (written before the code): accepting event batches from the browser.
//
// No event may be lost, none counted twice, and nothing the server already has
// may be rewritten later -- including an offline "tail" that arrives after the
// deadline.
//
// Module under test: src/modules/exam/attempt-ingest.logic.ts
//   GENESIS_HASH                     64 zeros
//   eventHash(prevHash, event) -> hex sha256 of `${prevHash}|${canonical({ seq, t, type, q, data })}`
//                                   canonical = JSON with object keys sorted, missing q/data as null
//   chainEvents(prevHash, events) -> events with .hash filled in (the browser does the same)
//   acceptBatch(state, events, { allowedMs, skewMs }) ->
//       { ok: true, accepted, duplicates, state, flags: { lateSync, needsRecompute } }
//     | { ok: false, error: 'GAP' | 'BROKEN_CHAIN' | 'TOO_LATE' | 'AFTER_SUBMIT', expectedSeq? }
//     state: { lastSeq, chainHead, submittedBy: null | 'CLIENT' | 'SERVER', analyticsBuilt }
//   signAttemptToken(payload, secret) -> string
//   verifyAttemptToken(token, secret, nowMs) -> payload | null   (payload.exp in ms)
const crypto = require('crypto');
const {
  GENESIS_HASH,
  eventHash,
  chainEvents,
  acceptBatch,
  signAttemptToken,
  verifyAttemptToken,
} = require('../../dist/src/modules/exam/attempt-ingest.logic');

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

const ctx = { allowedMs: 3 * 3600_000, skewMs: 2_000 };
const fresh = () => ({ lastSeq: 0, chainHead: GENESIS_HASH, submittedBy: null, analyticsBuilt: false });
const raw = (from, to, extra = {}) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ seq: from + i, t: (from + i) * 1000, type: 'VISIT', q: 'q1', ...extra }));

/* --- 1. The hash rule (browser and server must agree) ---------------------- */

const sortKeys = (v) =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
const expected = crypto
  .createHash('sha256')
  .update(`${'0'.repeat(64)}|${JSON.stringify(sortKeys({ seq: 1, t: 5, type: 'SELECT', q: 'q1', data: { choice: [2] } }))}`)
  .digest('hex');
check('genesis hash is 64 zeros', GENESIS_HASH === '0'.repeat(64));
check('event hash follows the documented rule exactly', eventHash(GENESIS_HASH, { seq: 1, t: 5, type: 'SELECT', q: 'q1', data: { choice: [2] } }) === expected);
check('key order inside data does not change the hash',
  eventHash(GENESIS_HASH, { seq: 1, t: 1, type: 'X', q: null, data: { a: 1, b: 2 } }) ===
  eventHash(GENESIS_HASH, { seq: 1, t: 1, type: 'X', q: null, data: { b: 2, a: 1 } }));
check('missing q and data hash the same as null', eventHash(GENESIS_HASH, { seq: 1, t: 1, type: 'SUBMIT' }) === eventHash(GENESIS_HASH, { seq: 1, t: 1, type: 'SUBMIT', q: null, data: null }));
check('a different previous hash gives a different hash', eventHash('1'.repeat(64), { seq: 1, t: 1, type: 'X' }) !== eventHash(GENESIS_HASH, { seq: 1, t: 1, type: 'X' }));

/* --- 2. Sequence ------------------------------------------------------------ */

const all = chainEvents(GENESIS_HASH, raw(1, 9));
let r = acceptBatch(fresh(), all.slice(0, 3), ctx);
check('the first batch starting at seq 1 is accepted', r.ok && r.accepted.length === 3 && r.state.lastSeq === 3);
check('the chain head moves to the last accepted event', r.ok && r.state.chainHead === all[2].hash);
let state = r.state;

r = acceptBatch(fresh(), all.slice(1, 3), ctx);
check('a first batch that does not start at 1 is a gap', !r.ok && r.error === 'GAP' && r.expectedSeq === 1);

r = acceptBatch(state, all.slice(3, 6), ctx);
check('a contiguous batch is accepted', r.ok && r.state.lastSeq === 6);
state = r.state;

r = acceptBatch(state, all.slice(0, 6), ctx);
check('a fully resent batch is accepted as duplicates only', r.ok && r.accepted.length === 0 && r.duplicates === 6 && r.state.lastSeq === 6);

r = acceptBatch(state, all.slice(3, 8), ctx);
check('an overlapping batch keeps only the new tail', r.ok && r.accepted.map((e) => e.seq).join() === '7,8' && r.duplicates === 3);

r = acceptBatch(state, all.slice(7, 9), ctx);
check('a batch that skips seq 7 is a gap asking for 7', !r.ok && r.error === 'GAP' && r.expectedSeq === 7);

r = acceptBatch(state, [all[6], all[8]], ctx);
check('a hole inside a batch is a gap', !r.ok && r.error === 'GAP' && r.expectedSeq === 8);

r = acceptBatch(state, [all[7], all[6]], ctx);
check('events inside a batch may arrive in any order', r.ok && r.state.lastSeq === 8);

/* --- 3. Tampering ----------------------------------------------------------- */

const tampered = all.slice(6, 8).map((e) => ({ ...e }));
tampered[0].q = 'q9';
r = acceptBatch(state, tampered, ctx);
check('an event changed after hashing is refused', !r.ok && r.error === 'BROKEN_CHAIN');

const restarted = chainEvents(GENESIS_HASH, raw(7, 8));
r = acceptBatch(state, restarted, ctx);
check('a batch that does not continue the committed chain is refused', !r.ok && r.error === 'BROKEN_CHAIN');

/* --- 4. Time ---------------------------------------------------------------- */

const late = chainEvents(state.chainHead, [{ seq: 7, t: ctx.allowedMs + 2_001, type: 'SAVE_NEXT', q: 'q1' }]);
r = acceptBatch(state, late, ctx);
check('an event stamped after the allowed time (plus skew) is refused', !r.ok && r.error === 'TOO_LATE');

const edge = chainEvents(state.chainHead, [{ seq: 7, t: ctx.allowedMs + 2_000, type: 'SAVE_NEXT', q: 'q1' }]);
check('an event exactly at the skew allowance is accepted', acceptBatch(state, edge, ctx).ok);

/* --- 5. Submit and the offline tail ---------------------------------------- */

const submitBatch = chainEvents(state.chainHead, [
  { seq: 7, t: 7_000, type: 'SAVE_NEXT', q: 'q1' },
  { seq: 8, t: 8_000, type: 'SUBMIT', data: { reason: 'MANUAL' } },
]);
r = acceptBatch(state, submitBatch, ctx);
check('a batch with SUBMIT is accepted and marks the attempt submitted by the client', r.ok && r.state.submittedBy === 'CLIENT');
const submitted = r.state;

const afterSubmit = chainEvents(submitted.chainHead, [{ seq: 9, t: 9_000, type: 'SAVE_NEXT', q: 'q2' }]);
r = acceptBatch(submitted, afterSubmit, ctx);
check('events after the client submitted are refused', !r.ok && r.error === 'AFTER_SUBMIT');

r = acceptBatch(submitted, submitBatch, ctx);
check('resending the submit batch is harmless', r.ok && r.accepted.length === 0 && r.duplicates === 2);

// The student was offline at the deadline: the server auto-submitted with what it had (seq 1..6).
const autoSubmitted = { ...state, submittedBy: 'SERVER' };
const offlineTail = chainEvents(state.chainHead, [
  { seq: 7, t: 10_700_000, type: 'SAVE_NEXT', q: 'q2' },
  { seq: 8, t: 10_800_000, type: 'SUBMIT', data: { reason: 'AUTO_TIME' } },
]);
r = acceptBatch(autoSubmitted, offlineTail, ctx);
check('an offline tail made before the deadline is accepted after a server auto-submit', r.ok && r.accepted.length === 2);
check('...and flagged as a late sync', r.ok && r.flags.lateSync === true && r.flags.needsRecompute === false);

r = acceptBatch({ ...autoSubmitted, analyticsBuilt: true }, offlineTail, ctx);
check('a tail arriving after analytics were built asks for a recompute', r.ok && r.flags.needsRecompute === true);

const forgedTail = chainEvents(GENESIS_HASH, raw(7, 8));
r = acceptBatch(autoSubmitted, forgedTail, ctx);
check('an offline tail that does not extend what the server has is refused', !r.ok && r.error === 'BROKEN_CHAIN');

r = acceptBatch(fresh(), all.slice(0, 3), ctx);
check('a normal batch is not flagged', r.ok && r.flags.lateSync === false && r.flags.needsRecompute === false);

/* --- 6. Attempt token ------------------------------------------------------- */

const now = Date.parse('2027-01-10T10:00:00Z');
const payload = { attemptId: 'a1', userId: 'u1', tenantId: 't1', exp: now + 3600_000 };
const token = signAttemptToken(payload, 'secret-1');
const back = verifyAttemptToken(token, 'secret-1', now);
check('a valid token returns its payload', back && back.attemptId === 'a1' && back.userId === 'u1' && back.tenantId === 't1');
check('a token signed with another secret is refused', verifyAttemptToken(token, 'secret-2', now) === null);
const [body, sig] = token.split('.');
const forgedBody = Buffer.from(JSON.stringify({ ...payload, attemptId: 'a2' })).toString('base64url');
check('a token whose payload was edited is refused', verifyAttemptToken(`${forgedBody}.${sig}`, 'secret-1', now) === null);
check('an expired token is refused', verifyAttemptToken(token, 'secret-1', now + 3600_001) === null);
check('garbage is refused without throwing', verifyAttemptToken('not-a-token', 'secret-1', now) === null && verifyAttemptToken('', 'secret-1', now) === null);
check('the token body is not plain JSON a student could read and edit unnoticed', !body.includes('{'));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
