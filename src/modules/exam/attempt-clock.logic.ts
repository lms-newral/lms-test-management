/**
 * When an attempt may start and when it must end. The server clock decides;
 * the device clock is only corrected by an offset. Spec: test/exam/attempt-clock.test.js.
 */

export const DEFAULT_SKEW_MS = 2_000;

export function canStart(
  schedule: { availableFrom: Date; availableTo: Date },
  now: Date,
): { ok: true } | { ok: false; reason: 'NOT_OPEN' | 'CLOSED' } {
  if (now.getTime() < schedule.availableFrom.getTime()) return { ok: false, reason: 'NOT_OPEN' };
  if (now.getTime() >= schedule.availableTo.getTime()) return { ok: false, reason: 'CLOSED' };
  return { ok: true };
}

/** Full duration from the start, but never past the window closing. */
export function deadlineFor(startedAt: Date, durationMinutes: number, availableTo: Date): Date {
  return new Date(Math.min(startedAt.getTime() + durationMinutes * 60_000, availableTo.getTime()));
}

export function remainingMs(deadline: Date, now: Date): number {
  return Math.max(0, deadline.getTime() - now.getTime());
}

export function resumeState(attempt: { startedAt: Date; deadline: Date }, now: Date) {
  const deadline = new Date(attempt.deadline.getTime());
  return { deadline, remainingMs: remainingMs(deadline, now) };
}

/** Milliseconds to add to the device clock so it reads server time. */
export function clockOffset(serverTime: string, deviceTimeAtReceipt: number): number {
  return Date.parse(serverTime) - deviceTimeAtReceipt;
}

export function correctedNow(deviceNow: number, offsetMs: number): number {
  return deviceNow + offsetMs;
}

/** An event's time (ms since the attempt started) is valid if inside the allowed time plus skew. */
export function eventInTime(tMs: number, allowedMs: number, skewMs: number = DEFAULT_SKEW_MS): boolean {
  return tMs >= 0 && tMs <= allowedMs + skewMs;
}
