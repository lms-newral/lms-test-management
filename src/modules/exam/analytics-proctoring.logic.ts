/**
 * The integrity panel an admin sees beside a student's analytics.
 *
 * Every number here was captured during the exam; this turns them into plain
 * sentences. It keeps apart what the student did (switched away, tried to copy)
 * from what merely happened to them (the connection dropped) — an offline
 * stretch is not misconduct and is never phrased as though it were.
 *
 * Pure. Spec: test/exam/analytics-proctoring.test.js.
 */
import { MAX_REFRESHES, MAX_WARNINGS } from './attempt-proctor.logic';

export type FlagLevel = 'ALERT' | 'WARN' | 'INFO';

export interface ProctoringFlag {
  level: FlagLevel;
  code: string;
  message: string;
}

export interface ProctoringAttempt {
  violations: number;
  lastViolationT: number | null;
  refreshes: number;
  copyAttempts: number | null;
  offlineMs: number | null;
  outsideFullscreenMs: number | null;
  instructionsMs: number | null;
  timeUsedMs: number | null;
  activeMs: number | null;
  device: unknown;
  lateSync: boolean;
  rejectedBatches: number;
  submittedBy: string | null;
  submitReason: string | null;
}

export interface ProctoringSummary {
  violations: { count: number; max: number; lastAtMs: number | null };
  refreshes: { count: number; max: number };
  copyAttempts: number;
  offlineMs: number;
  outsideFullscreenMs: number;
  instructionsMs: number;
  timeUsedMs: number;
  activeMs: number;
  idleMs: number;
  device: Record<string, unknown> | null;
  lateSync: boolean;
  rejectedBatches: number;
  submittedBy: string | null;
  submitReason: string | null;
  flags: ProctoringFlag[];
}

/** Anything shorter than this is a blink, not a habit. */
const NOTICEABLE_MS = 60_000;
const LEVEL_ORDER: Record<FlagLevel, number> = { ALERT: 0, WARN: 1, INFO: 2 };
const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));
const n = (v: number | null | undefined) => v ?? 0;

export function proctoringSummary(attempt: ProctoringAttempt): ProctoringSummary {
  const timeUsedMs = n(attempt.timeUsedMs);
  const activeMs = n(attempt.activeMs);
  const flags: ProctoringFlag[] = [];
  const add = (level: FlagLevel, code: string, message: string) => flags.push({ level, code, message });

  if (attempt.submittedBy === 'SERVER' && attempt.submitReason === 'VIOLATIONS') {
    add('ALERT', 'AUTO_SUBMIT_VIOLATIONS', `Submitted automatically: left the exam ${attempt.violations} times, past the limit of ${MAX_WARNINGS} warnings.`);
  } else if (attempt.violations > 0) {
    add('WARN', 'VIOLATIONS', `Left the exam window ${attempt.violations} time(s) — a tab switch or leaving full screen.`);
  }

  if (attempt.submittedBy === 'SERVER' && attempt.submitReason === 'REFRESHES') {
    add('ALERT', 'AUTO_SUBMIT_REFRESHES', `Submitted automatically: reloaded the page more than ${MAX_REFRESHES} times.`);
  } else if (attempt.refreshes > 0) {
    add('WARN', 'REFRESHES', `Reloaded the exam page ${attempt.refreshes} time(s).`);
  }

  if (n(attempt.copyAttempts) > 0) {
    add('WARN', 'COPY', `Tried to copy from the question ${attempt.copyAttempts} time(s).`);
  }
  if (n(attempt.outsideFullscreenMs) >= NOTICEABLE_MS) {
    add('WARN', 'OUTSIDE_FULLSCREEN', `Spent about ${minutes(n(attempt.outsideFullscreenMs))} minute(s) outside full screen.`);
  }
  if (attempt.rejectedBatches > 0) {
    add('WARN', 'REJECTED', `${attempt.rejectedBatches} upload(s) from this device were refused and had to be re-sent.`);
  }

  // Not misconduct: things that happened to the student.
  if (attempt.submittedBy === 'SERVER' && attempt.submitReason === 'AUTO_TIME') {
    add('INFO', 'AUTO_SUBMIT_TIME', 'Submitted automatically when the time ran out.');
  }
  if (n(attempt.offlineMs) >= NOTICEABLE_MS) {
    add('INFO', 'OFFLINE', `Was offline for about ${minutes(n(attempt.offlineMs))} minute(s). The answers were saved on the device and synced afterwards.`);
  }
  if (attempt.lateSync) {
    add('INFO', 'LATE_SYNC', 'Some answers reached the server after the test closed, from the copy saved on the device.');
  }

  return {
    violations: { count: attempt.violations, max: MAX_WARNINGS, lastAtMs: attempt.lastViolationT },
    refreshes: { count: attempt.refreshes, max: MAX_REFRESHES },
    copyAttempts: n(attempt.copyAttempts),
    offlineMs: n(attempt.offlineMs),
    outsideFullscreenMs: n(attempt.outsideFullscreenMs),
    instructionsMs: n(attempt.instructionsMs),
    timeUsedMs,
    activeMs,
    idleMs: Math.max(0, timeUsedMs - activeMs),
    device: (attempt.device ?? null) as Record<string, unknown> | null,
    lateSync: attempt.lateSync,
    rejectedBatches: attempt.rejectedBatches,
    submittedBy: attempt.submittedBy,
    submitReason: attempt.submitReason,
    flags: flags.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]),
  };
}
