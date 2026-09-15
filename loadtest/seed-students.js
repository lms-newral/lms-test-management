/**
 * Prepares students.json for enter-load.js, and — more usefully — checks the
 * tokens before a run, so a spike test does not just measure 100,000 rejections.
 *
 * Tokens have to come from the target environment's own login: the main backend
 * rejects a token whose session it does not know, which is exactly the check the
 * spike test needs to exercise. Supply them as one access token per line:
 *
 *   node loadtest/seed-students.js tokens.txt [subdomain]
 *
 * Each token is tried once against `myExamAttempt`, a cheap authenticated query,
 * and only the ones that answer are written to students.json.
 */
const fs = require('fs');
const path = require('path');

const API = process.env.LOADTEST_GRAPHQL || 'http://localhost:5757/graphql';
const CHECK = `query Check($nodeId: ID!) { myExamAttempt(nodeId: $nodeId) { attemptId status } }`;

async function usable(token, subdomain, nodeId) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  if (subdomain) headers['x-tenant-subdomain'] = subdomain;
  try {
    const res = await fetch(API, { method: 'POST', headers, body: JSON.stringify({ query: CHECK, variables: { nodeId } }) });
    const body = await res.json();
    // A null attempt is fine — it means the student simply has not started yet.
    const denied = (body.errors ?? []).some((e) => /sign in|session|forbidden|permission/i.test(e.message ?? ''));
    return { ok: res.ok && !denied, reason: denied ? body.errors[0].message : res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

async function main() {
  const [file, subdomain] = process.argv.slice(2);
  const nodeId = process.env.NODE_ID;
  if (!file) throw new Error('Usage: node loadtest/seed-students.js <tokens.txt> [subdomain]   (NODE_ID=<seriesNodeId>)');
  if (!nodeId) throw new Error('Set NODE_ID to the series node the spike test will enter.');

  const tokens = fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  console.log(`Checking ${tokens.length} token(s) against ${API}…`);

  const students = [];
  const reasons = new Map();
  for (let i = 0; i < tokens.length; i += 20) {
    const batch = await Promise.all(tokens.slice(i, i + 20).map((token) => usable(token, subdomain, nodeId).then((r) => ({ token, ...r }))));
    for (const r of batch) {
      if (r.ok) students.push({ token: r.token, subdomain: subdomain ?? null, deviceId: `loadtest-${students.length}` });
      else reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
    }
    process.stdout.write(`\r  checked ${Math.min(i + 20, tokens.length)}/${tokens.length}`);
  }

  fs.writeFileSync(path.join(__dirname, 'students.json'), JSON.stringify(students));
  console.log(`\n  ${students.length} usable, ${tokens.length - students.length} rejected`);
  for (const [reason, count] of reasons) console.log(`    ${count} × ${reason}`);
  if (students.length === 0) throw new Error('No usable tokens: the spike test would measure nothing.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
