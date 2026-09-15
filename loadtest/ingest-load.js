/**
 * k6: the hot path during an exam — every student's device posting a batch of
 * hash-chained events. One VU owns one attempt, so its chain stays continuous.
 *
 *   k6 run -e MODE=rate -e STUDENTS=2000 loadtest/ingest-load.js
 *   k6 run -e MODE=max  -e VUS=200       loadtest/ingest-load.js
 *
 * rate: each student sends one batch every BATCH_SECONDS, like the real client.
 * max:  no pauses, to find the ceiling of one API process.
 */
import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const API = __ENV.API || 'http://localhost:5858';
const MODE = __ENV.MODE || 'rate';
const BATCH_SECONDS = Number(__ENV.BATCH_SECONDS || 15);
const STUDENTS = Number(__ENV.STUDENTS || 2000);
const VUS = Number(__ENV.VUS || 200);
const DURATION = __ENV.DURATION || '60s';

const attempts = new SharedArray('attempts', () => JSON.parse(open('./attempts.json')));

const eventsSent = new Counter('exam_events_sent');
const batchLatency = new Trend('exam_batch_latency', true);

export const options =
  MODE === 'rate'
    ? {
        scenarios: {
          students: {
            executor: 'constant-arrival-rate',
            rate: Math.ceil(STUDENTS / BATCH_SECONDS), // batches per second across the cohort
            timeUnit: '1s',
            duration: DURATION,
            preAllocatedVUs: Math.min(STUDENTS, 400),
            maxVUs: Math.min(STUDENTS, 1200),
          },
        },
        thresholds: {
          http_req_failed: ['rate<0.001'],
          'http_req_duration{expected_response:true}': ['p(95)<500', 'p(99)<1500'],
        },
      }
    : {
        scenarios: {
          ceiling: { executor: 'constant-vus', vus: VUS, duration: DURATION },
        },
        thresholds: { http_req_failed: ['rate<0.01'] },
      };

/** Same canonical form as the server: keys sorted, prevHash joined with a pipe. */
function hashEvent(prev, e) {
  const canonical = JSON.stringify({ data: e.data ?? null, q: e.q ?? null, seq: e.seq, t: e.t, type: e.type });
  return crypto.sha256(`${prev}|${canonical}`, 'hex');
}

// Per-VU chain state, keyed by the attempt this VU owns.
const state = {};

export default function () {
  const index = (__VU - 1) % attempts.length;
  const mine = attempts[index];
  let s = state[mine.attemptId];
  if (!s) s = state[mine.attemptId] = { seq: 0, prev: '0'.repeat(64), t: 0, q: 0 };

  // One batch = about 15 seconds of a student working: read, answer, move on.
  const raw = [];
  for (let i = 0; i < 4; i++) {
    const qid = `loadtest-q-${String(s.q % 90).padStart(4, '0')}`;
    s.t += 1200;
    raw.push({ seq: ++s.seq, t: s.t, type: 'VISIT', q: qid, data: { via: 'NEXT' } });
    s.t += 1500;
    raw.push({ seq: ++s.seq, t: s.t, type: 'SELECT', q: qid, data: { choice: [s.q % 4] } });
    s.t += 900;
    raw.push({ seq: ++s.seq, t: s.t, type: 'SAVE_NEXT', q: qid, data: null });
    s.q++;
  }
  s.t += 400;
  raw.push({ seq: ++s.seq, t: s.t, type: 'ACTIVE', q: null, data: null });

  const events = raw.map((e) => {
    const hash = hashEvent(s.prev, e);
    s.prev = hash;
    return { ...e, hash };
  });

  const res = http.post(`${API}/exam/attempts/${mine.attemptId}/events`, JSON.stringify({ events }), {
    headers: { 'content-type': 'application/json', 'x-attempt-token': mine.token },
    tags: { name: 'ingest' },
  });

  batchLatency.add(res.timings.duration);
  eventsSent.add(events.length);
  const ok = check(res, {
    'accepted': (r) => r.status === 200,
    'no rejection': (r) => {
      if (r.status !== 200) return false;
      try {
        return !JSON.parse(r.body).rejected;
      } catch {
        return false;
      }
    },
  });
  if (!ok && res.status !== 200) console.error(`HTTP ${res.status}: ${String(res.body).slice(0, 200)}`);

  if (MODE === 'rate') {
    // constant-arrival-rate paces the batches; no sleep needed.
  }
}
