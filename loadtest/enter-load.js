/**
 * k6: the gate opening — every student pressing PROCEED at once.
 *
 * This is the path the ingest test deliberately avoids: `enterExam` runs the
 * full auth check (the main backend's `me`, cached per session window) and
 * signs the paper download. It is the likeliest place a 100,000-student start
 * falls over, so it is measured separately.
 *
 *   k6 run -e MODE=spike -e NODE_ID=<seriesNodeId> -e API=https://staging…/graphql loadtest/enter-load.js
 *   k6 run -e MODE=rate -e ENTRIES_PER_SEC=330 -e DURATION=5m … loadtest/enter-load.js
 *
 * Never point this at production: entering creates real attempts, and every
 * re-entry for the same student counts as a refresh (six auto-submit them), so
 * each student in students.json is used exactly once.
 *
 * students.json is produced by seed-students.js — see loadtest/README.md.
 */
import http from 'k6/http';
import exec from 'k6/execution';
import { check } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { SharedArray } from 'k6/data';

const API = __ENV.API || 'http://localhost:5757/graphql';
const NODE_ID = __ENV.NODE_ID;
const MODE = __ENV.MODE || 'spike';
const VUS = Number(__ENV.VUS || 100);
const ENTRIES_PER_SEC = Number(__ENV.ENTRIES_PER_SEC || 330);
const DURATION = __ENV.DURATION || '2m';

const students = new SharedArray('students', () => JSON.parse(open('./students.json')));

const enterLatency = new Trend('exam_enter_latency', true);
const skipped = new Counter('exam_students_exhausted');

export const options =
  MODE === 'rate'
    ? {
        scenarios: {
          gate: {
            executor: 'ramping-arrival-rate',
            startRate: 10,
            timeUnit: '1s',
            preAllocatedVUs: 200,
            maxVUs: 2000,
            stages: [
              { target: ENTRIES_PER_SEC, duration: '30s' }, // doors open
              { target: ENTRIES_PER_SEC, duration: DURATION },
            ],
          },
        },
        thresholds: {
          http_req_failed: ['rate<0.001'],
          'http_req_duration{expected_response:true}': ['p(95)<1000'],
        },
      }
    : {
        scenarios: {
          rush: { executor: 'shared-iterations', vus: VUS, iterations: students.length, maxDuration: '10m' },
        },
        thresholds: { http_req_failed: ['rate<0.001'], 'http_req_duration{expected_response:true}': ['p(95)<1000'] },
      };

const ENTER = `mutation EnterExam($nodeId: ID!) {
  enterExam(nodeId: $nodeId) { attemptId status deadline serverTime paperUrl refreshes action { type message } }
}`;

export default function () {
  // One student enters once: a second entry would count as a refresh against them.
  const index = exec.scenario.iterationInTest;
  if (index >= students.length) {
    skipped.add(1);
    return;
  }
  const student = students[index];

  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${student.token}`,
  };
  if (student.subdomain) headers['x-tenant-subdomain'] = student.subdomain;
  if (student.deviceId) headers['x-device-id'] = student.deviceId;

  const res = http.post(API, JSON.stringify({ query: ENTER, variables: { nodeId: NODE_ID } }), { headers, tags: { name: 'enterExam' } });

  enterLatency.add(res.timings.duration);
  check(res, {
    'http 200': (r) => r.status === 200,
    'attempt returned': (r) => {
      try {
        const body = JSON.parse(r.body);
        if (body.errors) console.error(`enterExam: ${body.errors[0]?.message}`);
        return !!body.data?.enterExam?.attemptId;
      } catch {
        return false;
      }
    },
    'paper handed over': (r) => {
      try {
        return !!JSON.parse(r.body).data?.enterExam?.paperUrl;
      } catch {
        return false;
      }
    },
  });
}
