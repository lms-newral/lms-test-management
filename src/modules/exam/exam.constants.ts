export const EXAM_FINALIZE_QUEUE = 'exam-finalize';
export const ANALYTICS_QUEUE = 'test-analytics';
export const ANALYTICS_COMPUTE_JOB = 'compute';
export const ANALYTICS_SWEEP_JOB = 'analytics-sweep';
export const FINALIZE_JOB = 'finalize';
export const SWEEP_JOB = 'sweep';

/** How long after the deadline the server waits for the device before auto-submitting. */
export const SUBMIT_GRACE_MS = 2 * 60_000;
/** Allowed clock drift on event times. */
export const EVENT_SKEW_MS = 2_000;
/** Largest batch the browser may send. */
export const MAX_BATCH_EVENTS = 500;

export const EVENT_TYPES = new Set([
  'START', 'RESUME', 'VISIT', 'SELECT', 'SAVE_NEXT', 'SAVE_MARK', 'MARK_NEXT', 'CLEAR',
  'SECTION', 'PALETTE_JUMP', 'NAV', 'SCROLL', 'HIDDEN', 'VISIBLE', 'VIOLATION',
  'OFFLINE', 'ONLINE', 'BOOKMARK', 'REPORT', 'SUBMIT',
  'ACTIVE', 'FULLSCREEN', 'DEVICE', 'COPY', 'PALETTE',
]);
