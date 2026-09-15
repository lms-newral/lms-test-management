/**
 * Leaving the exam and refreshing. Tab switch, window blur or leaving full
 * screen is a violation: 3 warnings, the 4th submits. Refresh is allowed 5
 * times with a notice each time; the 6th submits. The server keeps the counts.
 * Spec: test/exam/attempt-proctor.test.js.
 */

export const MAX_WARNINGS = 3;
export const MAX_REFRESHES = 5;
export const VIOLATION_MERGE_MS = 1_500;

export type ViolationKind = 'TAB_HIDDEN' | 'WINDOW_BLUR' | 'FULLSCREEN_EXIT' | 'OFFLINE';

export interface ProctorState {
  violations: number;
  refreshes: number;
  lastViolationT: number | null;
  submitted: boolean;
}

export type ProctorAction =
  | { type: 'NONE' }
  | { type: 'WARN'; count: number; max: number }
  | { type: 'REFRESH_NOTICE'; count: number; max: number }
  | { type: 'AUTO_SUBMIT'; reason: 'VIOLATIONS' | 'REFRESHES' };

const NONE: ProctorAction = { type: 'NONE' };

export function initialProctorState(): ProctorState {
  return { violations: 0, refreshes: 0, lastViolationT: null, submitted: false };
}

export function recordViolation(
  state: ProctorState,
  event: { kind: ViolationKind | string; t: number; causedByReload?: boolean },
): { state: ProctorState; action: ProctorAction } {
  if (state.submitted || event.kind === 'OFFLINE' || event.causedByReload) return { state, action: NONE };
  // A blur and a visibility change fire together for one switch: count it once.
  if (state.lastViolationT !== null && event.t - state.lastViolationT <= VIOLATION_MERGE_MS) {
    return { state, action: NONE };
  }
  const violations = state.violations + 1;
  if (violations > MAX_WARNINGS) {
    return {
      state: { ...state, violations, lastViolationT: event.t, submitted: true },
      action: { type: 'AUTO_SUBMIT', reason: 'VIOLATIONS' },
    };
  }
  return {
    state: { ...state, violations, lastViolationT: event.t },
    action: { type: 'WARN', count: violations, max: MAX_WARNINGS },
  };
}

export function recordRefresh(state: ProctorState): { state: ProctorState; action: ProctorAction } {
  if (state.submitted) return { state, action: NONE };
  const refreshes = state.refreshes + 1;
  if (refreshes > MAX_REFRESHES) {
    return { state: { ...state, refreshes, submitted: true }, action: { type: 'AUTO_SUBMIT', reason: 'REFRESHES' } };
  }
  return { state: { ...state, refreshes }, action: { type: 'REFRESH_NOTICE', count: refreshes, max: MAX_REFRESHES } };
}

/** Counts only ever go up: the higher of server and device wins. */
export function mergeCounts(server: ProctorState, client: ProctorState): ProctorState {
  const times = [server.lastViolationT, client.lastViolationT].filter((t): t is number => t !== null);
  return {
    violations: Math.max(server.violations, client.violations),
    refreshes: Math.max(server.refreshes, client.refreshes),
    lastViolationT: times.length ? Math.max(...times) : null,
    submitted: server.submitted || client.submitted,
  };
}

export function refreshNotice(count: number): string {
  return (
    `You have refreshed the test ${count} time${count === 1 ? '' : 's'}. ` +
    `After ${MAX_REFRESHES} refreshes, the test will be submitted automatically.`
  );
}
