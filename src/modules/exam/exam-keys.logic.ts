/**
 * Every Redis name the exam engine uses, namespaced per environment.
 *
 * Two services on one Redis used to share the stream keys and the consumer
 * group, so one would read the other's entries, find no such attempt in its own
 * database and ack them away — 2,769 events disappeared that way during the
 * load test. A prefix per environment makes that impossible.
 *
 * The default reproduces the original names exactly, so a deploy does not
 * orphan events that are already in flight.
 *
 * Pure. Spec: test/exam/exam-keys.test.js.
 */

export interface ExamKeys {
  stream(shard: number): string;
  persisted: string;
  rejected: string;
  deadLetter: string;
  group: string;
  bullPrefix: string;
}

export function examKeys(prefix?: string | null): ExamKeys {
  const clean = (prefix ?? '').trim().replace(/:+$/, '');
  const at = clean ? `${clean}:` : '';
  return {
    stream: (shard: number) => `${at}exam:events:${shard}`,
    persisted: `${at}exam:persisted`,
    rejected: `${at}exam:rejected`,
    deadLetter: `${at}exam:deadletter`,
    group: `${at}exam-ingest`,
    bullPrefix: `${at}bull`,
  };
}
