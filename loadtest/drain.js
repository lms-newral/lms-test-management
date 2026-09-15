/**
 * Watches the pipeline while (and after) a load run: how much is waiting in the
 * Redis streams, how fast the workers move it into Postgres, and how far behind
 * the database is. Prints a line a second until the streams are empty.
 *
 *   node loadtest/drain.js [seconds]
 */
const Redis = require('ioredis');
const { prisma } = require('./lib');

const SHARDS = Number(process.env.EXAM_STREAM_SHARDS || 4);
const SECONDS = Number(process.argv[2] ?? 120);

async function main() {
  const redis = new Redis({ host: process.env.REDIS_HOST || 'localhost', port: Number(process.env.REDIS_PORT || 6379) });
  const db = prisma();
  let lastEvents = null;
  let lastAt = Date.now();
  const rates = [];

  for (let i = 0; i < SECONDS; i++) {
    const lengths = [];
    let pending = 0;
    for (let s = 0; s < SHARDS; s++) {
      const key = `exam:events:${s}`;
      lengths.push(await redis.xlen(key));
      const p = await redis.xpending(key, 'exam-ingest').catch(() => [0]);
      pending += Array.isArray(p) ? Number(p[0] ?? 0) : 0;
    }
    const waiting = lengths.reduce((a, b) => a + b, 0);
    const [batches, attempts] = await Promise.all([
      db.examEventBatch.count(),
      db.examAttempt.aggregate({ _sum: { lastSeq: true } }),
    ]);
    const events = Number(attempts._sum.lastSeq ?? 0);
    const now = Date.now();
    const rate = lastEvents === null ? 0 : Math.round(((events - lastEvents) * 1000) / (now - lastAt));
    if (rate > 0) rates.push(rate);
    lastEvents = events;
    lastAt = now;
    console.log(
      `t+${String(i).padStart(3)}s  stream waiting ${String(waiting).padStart(7)}  unacked ${String(pending).padStart(6)}  ` +
        `stored events ${String(events).padStart(9)}  batches ${String(batches).padStart(7)}  drain ${String(rate).padStart(6)} events/s`,
    );
    if (i > 3 && waiting === 0 && pending === 0 && rate === 0) break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  if (rates.length) {
    const sorted = [...rates].sort((a, b) => a - b);
    console.log(
      `\nDrain rate: median ${sorted[Math.floor(sorted.length / 2)]} events/s, peak ${sorted[sorted.length - 1]} events/s (${rates.length} samples)`,
    );
  }
  await db.$disconnect();
  redis.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
