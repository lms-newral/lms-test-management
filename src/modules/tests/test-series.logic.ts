/**
 * Test series rules. Pure: no database, no Nest -- tested offline in
 * test/tests/test-series-rules.test.js and copied to the admin as
 * src/utils/testSeriesRules.ts for instant feedback. Change both together.
 */

export interface SeriesWindow {
  startAt: Date | null;
  endAt: Date | null;
}

export interface Schedule {
  availableFrom: Date | null;
  availableTo: Date | null;
  resultAt: Date | null;
}

export interface SeriesDetails extends SeriesWindow {
  name: string;
  classLevel: string | null;
  examType: string | null;
  targetYear: number | null;
  descriptionHtml: string | null;
  isPaid: boolean;
  price: number | null;
  discountedPrice: number | null;
}

export interface SeriesTestItem {
  testName: string;
  testPublished: boolean;
  schedule: Schedule;
}

const visibleText = (html: string | null) =>
  (html ?? '')
    .replace(/<img\b[^>]*>/gi, ' image ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .trim();

const hasTwoDecimals = (n: number) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6;

/** The visibility window. `complete` also asks for both dates (for publishing). */
export function windowProblems(w: SeriesWindow, complete: boolean): string[] {
  const problems: string[] = [];
  if (complete && !w.startAt) problems.push('Set the date the series becomes visible.');
  if (complete && !w.endAt) problems.push('Set the date the series stops being visible.');
  if (w.startAt && w.endAt && w.endAt <= w.startAt) {
    problems.push('The series must end after it starts.');
  }
  return problems;
}

/** Price rules. `complete` also asks a paid series for its price (for publishing). */
export function pricingProblems(
  isPaid: boolean,
  price: number | null,
  discountedPrice: number | null,
  complete: boolean,
): string[] {
  if (!isPaid) return [];
  const problems: string[] = [];
  if (price === null) {
    if (complete) problems.push('Set a price for the paid series.');
  } else if (price <= 0) {
    problems.push('The price must be more than 0. Make the series free instead.');
  } else if (!hasTwoDecimals(price)) {
    problems.push('The price can have at most 2 decimal places.');
  }
  if (discountedPrice !== null) {
    if (discountedPrice <= 0) {
      problems.push('The discounted price must be more than 0. Make the series free instead.');
    } else if (!hasTwoDecimals(discountedPrice)) {
      problems.push('The discounted price can have at most 2 decimal places.');
    } else if (price !== null && discountedPrice > price) {
      problems.push('The discounted price cannot be more than the price.');
    }
  }
  return problems;
}

/**
 * One test's schedule inside the series window: it opens, closes, then shows
 * results -- never results before it opens or while it is still open.
 */
export function scheduleProblems(s: Schedule, w: SeriesWindow, label: string): string[] {
  const { availableFrom: from, availableTo: to, resultAt: result } = s;
  const problems: string[] = [];
  if (!from) problems.push(`${label}: set when it opens.`);
  if (!to) problems.push(`${label}: set when it closes.`);
  if (!result) problems.push(`${label}: set when results are shown.`);

  if (from && to && to <= from) problems.push(`${label}: it must close after it opens.`);
  if (result && from && result < from) {
    problems.push(`${label}: results cannot be shown before the test opens.`);
  } else if (result && to && result < to) {
    problems.push(`${label}: results cannot be shown while the test is still open. Pick a time after it closes.`);
  }

  if (from && w.startAt && from < w.startAt) problems.push(`${label}: it cannot open before the series starts.`);
  if (from && w.endAt && from >= w.endAt) problems.push(`${label}: it must open before the series ends.`);
  if (to && w.endAt && to > w.endAt) problems.push(`${label}: it must close by the time the series ends.`);
  if (result && w.endAt && result > w.endAt) {
    problems.push(`${label}: results must be shown by the time the series ends, while students can still see it.`);
  }
  return problems;
}

/** A test that has already opened in a published series keeps its past fixed. */
export function startedEditProblem(current: Schedule, next: Schedule, now: Date): string | null {
  if (!current.availableFrom || current.availableFrom > now) return null;
  if (!next.availableFrom || next.availableFrom.getTime() !== current.availableFrom.getTime()) {
    return 'This test has already opened for students, so its opening time cannot change.';
  }
  if (current.availableTo && (!next.availableTo || next.availableTo < current.availableTo)) {
    return 'This test has already opened, so its closing time can only move later.';
  }
  if (current.resultAt && (!next.resultAt || next.resultAt < current.resultAt)) {
    return 'This test has already opened, so its result time can only move later.';
  }
  return null;
}

/** Everything a series needs before it can be published. */
export function seriesPublishProblems(d: SeriesDetails, tests: SeriesTestItem[]): string[] {
  const problems: string[] = [];
  if (!d.name?.trim()) problems.push('Give the series a name.');
  if (!d.classLevel?.trim()) problems.push('Choose the class.');
  if (!d.examType?.trim()) problems.push('Choose the exam type.');
  if (!d.targetYear) problems.push('Set the target year.');
  if (!visibleText(d.descriptionHtml)) problems.push('Write a description.');
  problems.push(...windowProblems(d, true));
  problems.push(...pricingProblems(d.isPaid, d.price, d.discountedPrice, true));
  if (tests.length === 0) problems.push('Add at least one test.');
  for (const t of tests) {
    const label = `"${t.testName}"`;
    if (!t.testPublished) problems.push(`${label} is not published yet.`);
    problems.push(...scheduleProblems(t.schedule, d, label));
  }
  return problems;
}

export interface TreeNode {
  id: string;
  parentId: string | null;
  kind: 'FOLDER' | 'TEST';
}

/** Why a node cannot move under `parentId`, or null. Null parent is the top level. */
export function moveProblem(nodes: TreeNode[], nodeId: string, parentId: string | null): string | null {
  if (parentId === null) return null;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = byId.get(parentId);
  if (!parent) return 'That folder is not in this series.';
  if (parent.kind !== 'FOLDER') return 'Items can only go inside a folder.';
  for (let at: TreeNode | undefined = parent; at; at = at.parentId ? byId.get(at.parentId) : undefined) {
    if (at.id === nodeId) return 'A folder cannot go inside itself.';
  }
  return null;
}

/** Ids of a node and everything under it. */
export function subtreeIds(nodes: TreeNode[], rootId: string): string[] {
  const ids = [rootId];
  for (let i = 0; i < ids.length; i++) {
    for (const n of nodes) if (n.parentId === ids[i]) ids.push(n.id);
  }
  return ids;
}
