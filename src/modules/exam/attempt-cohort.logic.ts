/**
 * Student details frozen on an attempt, so comparisons by class, target year,
 * city, state, course or batch and device stay possible even after the profile
 * changes. Spec: test/exam/attempt-cohort.test.js.
 */

export type DeviceType = 'MOBILE' | 'TABLET' | 'DESKTOP' | 'UNKNOWN';

export interface CohortSnapshot {
  classLevel: string | null;
  targetYear: number | null;
  city: string | null;
  state: string | null;
  courseIds: string[];
  deviceType: DeviceType;
}

export function deviceTypeFrom(userAgent?: string | null): DeviceType {
  if (!userAgent) return 'UNKNOWN';
  if (/iPad|Tablet/i.test(userAgent)) return 'TABLET';
  if (/Android/i.test(userAgent)) return /Mobile/i.test(userAgent) ? 'MOBILE' : 'TABLET';
  if (/iPhone|iPod|Mobi/i.test(userAgent)) return 'MOBILE';
  return 'DESKTOP';
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function year(v: unknown): number | null {
  const s = typeof v === 'number' ? String(v) : typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1900 && n <= 2100 ? n : null;
}

export function cohortSnapshot(
  profile: { classLevel?: unknown; targetYear?: unknown; city?: unknown; state?: unknown } | null,
  courseIds: string[],
  userAgent?: string | null,
): CohortSnapshot {
  return {
    classLevel: text(profile?.classLevel),
    targetYear: year(profile?.targetYear),
    city: text(profile?.city),
    state: text(profile?.state),
    courseIds: [...new Set(courseIds.filter(Boolean))].sort(),
    deviceType: deviceTypeFrom(userAgent),
  };
}
