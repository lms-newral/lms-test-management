/**
 * The leaderboard and the student's own note on a result.
 *
 * The leaderboard shows students to each other, so it only ever shows a short
 * name. The note is the student's message to their future self.
 *
 * Pure. Spec: test/exam/result-extras.test.js.
 */

export const NOTE_MAX = 2000;

/** "Rahul Kumar Sharma" -> "Rahul S.". Never an email, never a full name. */
export function displayName(name: string | null | undefined): string {
  const clean = (name ?? '').trim();
  if (!clean || clean.includes('@')) return 'Student';
  const parts = clean.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1].charAt(0).toUpperCase()}.`;
}

export interface RankedAttempt {
  id: string;
  rank: number | null;
  score: number | null;
  userName: string | null;
}

export interface LeaderboardRow {
  rank: number | null;
  name: string;
  score: number | null;
  isYou: boolean;
}

/** The top `limit` by rank, and the student's own row when they are not among them. */
export function leaderboard(
  attemptsByRank: RankedAttempt[],
  youId: string,
  limit: number,
): { rows: LeaderboardRow[]; you: LeaderboardRow | null } {
  const toRow = (a: RankedAttempt): LeaderboardRow => ({
    rank: a.rank,
    name: displayName(a.userName),
    score: a.score,
    isYou: a.id === youId,
  });
  const rows = attemptsByRank.slice(0, limit).map(toRow);
  if (rows.some((r) => r.isYou)) return { rows, you: null };
  const mine = attemptsByRank.slice(limit).find((a) => a.id === youId);
  return { rows, you: mine ? toRow(mine) : null };
}

export function normaliseNote(
  text: string | null | undefined,
): { note: string | null } | { problem: string } {
  const clean = (text ?? '').trim();
  if (clean.length > NOTE_MAX) {
    return {
      problem: `Keep your note under ${NOTE_MAX} characters (it is ${clean.length}).`,
    };
  }
  return { note: clean || null };
}
