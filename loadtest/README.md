# Exam engine load and accuracy runs

Everything here runs against a **throwaway** Postgres and Redis. `lib.js` refuses to start if
`LOADTEST_DATABASE_URL` looks like the real (Supabase) database — a load run writes millions of rows.

## Why a separate Redis

The ingest workers share one consumer group (`exam-ingest`) per stream. If a second service instance is
connected to the same Redis, it reads entries for attempts that do not exist in *its* database and acks
them away, so the events never reach anyone's Postgres. Give each environment its own Redis.

## One-time setup

```bash
docker run -d --name synappses-loadtest-pg -e POSTGRES_PASSWORD=loadtest -e POSTGRES_USER=loadtest \
  -e POSTGRES_DB=examload -p 55432:5432 postgres:16-alpine \
  -c max_connections=400 -c shared_buffers=256MB -c synchronous_commit=off
docker run -d --name synappses-loadtest-redis -p 6380:6379 redis:alpine --save "" --appendonly no

DATABASE_URL="postgresql://loadtest:loadtest@localhost:55432/examload" \
DIRECT_URL="postgresql://loadtest:loadtest@localhost:55432/examload" npx prisma migrate deploy
```

## The service under test

```bash
npm run build
DATABASE_URL="postgresql://loadtest:loadtest@localhost:55432/examload" \
DIRECT_URL="postgresql://loadtest:loadtest@localhost:55432/examload" \
PORT=5858 EXAM_INGEST_WORKER=true REDIS_PORT=6380 node dist/src/main.js
```

## Runs

```bash
# Are the analytics right? Students follow a plan whose outcome is decided from the NTA rules,
# the events go through the real pipeline, and every stored value is compared with the plan.
REDIS_PORT=6380 node loadtest/accuracy.js 200

# Seed attempts for k6, then load.
node loadtest/seed.js 3000
k6 run -e MODE=max  -e VUS=100        -e DURATION=45s -e API=http://localhost:5858 loadtest/ingest-load.js
k6 run -e MODE=rate -e STUDENTS=15000 -e DURATION=60s -e API=http://localhost:5858 loadtest/ingest-load.js

# Did the workers keep up, and did anything get lost?
REDIS_PORT=6380 node loadtest/drain.js 90
```

`drain.js` prints the Redis backlog, unacked entries, stored events and the drain rate each second.
Events stored must equal events sent; `rejectedBatches` must stay 0.

## The start spike (`enterExam`) — run on staging, never production

The one hot path the ingest runs do not cover. Entering creates a real attempt and every re-entry
counts as a refresh against that student (six auto-submit them), so each student is used exactly once
and the token list must be at least as long as the run.

Tokens have to come from the target environment's own login — a locally minted JWT is rejected by the
main backend, so a run with fake tokens would only measure the rejection path. Put one access token
per line in `tokens.txt`, then:

```bash
NODE_ID=<seriesNodeId> LOADTEST_GRAPHQL=https://staging.example/graphql \
  node loadtest/seed-students.js tokens.txt <subdomain>      # checks each token, writes students.json

k6 run -e MODE=spike -e NODE_ID=<seriesNodeId> -e API=https://staging.example/graphql loadtest/enter-load.js
k6 run -e MODE=rate -e ENTRIES_PER_SEC=330 -e DURATION=5m -e NODE_ID=… -e API=… loadtest/enter-load.js
```

Judge it against: p95 under 1 s at 330 entries/s, no 5xx, and the main backend staying healthy — 330/s
is 100,000 students entering over five minutes. If p95 climbs, the session cache
(`SESSION_CACHE_SECONDS`, now shared through Redis) and a staggered gate are the two levers.

## Teardown

```bash
docker rm -f synappses-loadtest-pg synappses-loadtest-redis
```
