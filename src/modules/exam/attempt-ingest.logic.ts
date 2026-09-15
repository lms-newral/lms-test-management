/**
 * Accepting event batches from the browser: no loss, no double counting, and no
 * rewriting of what the server already has (events are hash-chained), including
 * an offline tail that arrives after a server auto-submit.
 * Spec: test/exam/attempt-ingest.test.js. The browser computes the same hash.
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface ChainedEvent {
  seq: number;
  t: number;
  type: string;
  q?: string | null;
  data?: unknown;
  hash?: string;
}

export interface IngestState {
  lastSeq: number;
  chainHead: string;
  submittedBy: null | 'CLIENT' | 'SERVER';
  analyticsBuilt: boolean;
}

export type IngestResult =
  | {
      ok: true;
      accepted: ChainedEvent[];
      duplicates: number;
      state: IngestState;
      flags: { lateSync: boolean; needsRecompute: boolean };
    }
  | { ok: false; error: 'GAP' | 'BROKEN_CHAIN' | 'TOO_LATE' | 'AFTER_SUBMIT'; expectedSeq?: number };

const sortKeys = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v as object)
            .sort()
            .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
        )
      : v;

export function eventHash(prevHash: string, e: ChainedEvent): string {
  const canonical = JSON.stringify(
    sortKeys({ seq: e.seq, t: e.t, type: e.type, q: e.q ?? null, data: e.data ?? null }),
  );
  return createHash('sha256').update(`${prevHash}|${canonical}`).digest('hex');
}

export function chainEvents(prevHash: string, events: ChainedEvent[]): ChainedEvent[] {
  let prev = prevHash;
  return events.map((e) => {
    const hash = eventHash(prev, e);
    prev = hash;
    return { ...e, hash };
  });
}

export function acceptBatch(
  state: IngestState,
  events: ChainedEvent[],
  ctx: { allowedMs: number; skewMs: number },
): IngestResult {
  const seen = new Set<number>();
  const sorted = [...events]
    .sort((a, b) => a.seq - b.seq)
    .filter((e) => (seen.has(e.seq) ? false : (seen.add(e.seq), true)));
  const duplicates = sorted.filter((e) => e.seq <= state.lastSeq).length;
  const fresh = sorted.filter((e) => e.seq > state.lastSeq);
  const flags = { lateSync: false, needsRecompute: false };

  if (fresh.length === 0) return { ok: true, accepted: [], duplicates, state, flags };
  if (state.submittedBy === 'CLIENT') return { ok: false, error: 'AFTER_SUBMIT' };

  let prev = state.chainHead;
  let submitSeen = false;
  for (let i = 0; i < fresh.length; i++) {
    const e = fresh[i];
    const expectedSeq = state.lastSeq + 1 + i;
    if (e.seq !== expectedSeq) return { ok: false, error: 'GAP', expectedSeq };
    if (submitSeen) return { ok: false, error: 'AFTER_SUBMIT' };
    if (e.hash !== eventHash(prev, e)) return { ok: false, error: 'BROKEN_CHAIN' };
    if (!(e.t >= 0 && e.t <= ctx.allowedMs + ctx.skewMs)) return { ok: false, error: 'TOO_LATE' };
    if (e.type === 'SUBMIT') submitSeen = true;
    prev = e.hash;
  }

  const lateSync = state.submittedBy === 'SERVER';
  return {
    ok: true,
    accepted: fresh,
    duplicates,
    state: {
      ...state,
      lastSeq: fresh[fresh.length - 1].seq,
      chainHead: prev,
      submittedBy: state.submittedBy ?? (submitSeen ? 'CLIENT' : null),
    },
    flags: { lateSync, needsRecompute: lateSync && state.analyticsBuilt },
  };
}

// ─── Attempt token ───────────────────────────────────────────────────────────

export interface AttemptTokenPayload {
  attemptId: string;
  userId: string;
  tenantId: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
}

/**
 * What a worker may do with one stream entry. There is no third outcome: an
 * entry it cannot place is parked in the dead-letter stream, never dropped.
 * Spec: test/exam/ingest-entry.test.js.
 */
export function entryAction(entry: { attemptFound: boolean }): { action: 'PROCESS' | 'DEAD_LETTER'; reason?: string } {
  return entry.attemptFound ? { action: 'PROCESS' } : { action: 'DEAD_LETTER', reason: 'UNKNOWN_ATTEMPT' };
}

/** The parked entry, as flat XADD fields: who it belonged to, why, and every event. */
export function deadLetterFields(attemptId: string, reason: string, events: ChainedEvent[], at: number): string[] {
  return ['a', attemptId, 'r', reason, 'at', String(at), 'e', JSON.stringify(events)];
}

const sign = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest('base64url');

export function signAttemptToken(payload: AttemptTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function verifyAttemptToken(token: string, secret: string, nowMs: number): AttemptTokenPayload | null {
  try {
    const parts = (token ?? '').split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [body, signature] = parts;
    const given = Buffer.from(signature);
    const wanted = Buffer.from(sign(body, secret));
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as AttemptTokenPayload;
    if (typeof payload.exp !== 'number' || nowMs > payload.exp) return null;
    if (!payload.attemptId || !payload.userId || !payload.tenantId) return null;
    return payload;
  } catch {
    return null;
  }
}
