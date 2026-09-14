import { normaliseCode } from '../config/difficulty.service';
import type { Issue } from './docx-parser';

/**
 * Turns the names an author typed in Word into bank ids.
 *
 * PURE, like the parser: it is handed plain arrays of the tenant's taxonomy,
 * question types and difficulty levels, and returns ids and issues. The service
 * does the loading. That keeps every matching rule below testable without a
 * database, which is worth it because these rules decide whether a 500-question
 * document imports or is rejected.
 *
 * THE ONE RULE THAT IS NOT NEGOTIABLE: nothing here ever creates a taxonomy
 * node. An unresolved name is a BLOCKING row that a human fixes in review. Auto-
 * creating would mean one typo in one document permanently adds "Kinemtaics" to
 * the tree -- and the tree is what every later phase filters on, so that node
 * would then quietly split a topic's questions in two forever.
 */

export type LevelKey = 'subject' | 'chapter' | 'topic' | 'subtopic';

export const LEVEL_ORDER: LevelKey[] = [
  'subject',
  'chapter',
  'topic',
  'subtopic',
];

const KIND_FOR: Record<LevelKey, string> = {
  subject: 'SUBJECT',
  chapter: 'CHAPTER',
  topic: 'TOPIC',
  subtopic: 'SUBTOPIC',
};

export interface TaxonomyNodeLite {
  id: string;
  kind: string;
  name: string;
  code: string | null;
  parentId: string | null;
}

export interface NamedDef {
  id: string;
  code: string;
  label: string;
  aliases: string[];
}

export interface ResolvedTaxonomy {
  subjectId?: string;
  chapterId?: string;
  topicId?: string;
  subtopicId?: string;
  issues: Issue[];
  /** Names that resolved to nothing, so review can offer to create them. */
  missing: { level: LevelKey; name: string }[];
}

/** Names match on their visible spelling; case and spacing are noise. */
function normaliseName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Splits a path cell into its segments.
 *
 * Authors write "Physics / Mechanics / Kinematics" in one column rather than
 * filling four, and both spellings have to work. A single name comes back as a
 * one-element array.
 */
export function splitPath(raw: string): string[] {
  return raw
    .split(/\s*(?:\/|>|»|::|\|)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export class ResolutionIndex {
  private readonly byKind = new Map<string, TaxonomyNodeLite[]>();
  private readonly byId = new Map<string, TaxonomyNodeLite>();

  constructor(
    nodes: TaxonomyNodeLite[],
    private readonly types: NamedDef[],
    private readonly difficulties: NamedDef[],
  ) {
    for (const n of nodes) {
      this.byId.set(n.id, n);
      const list = this.byKind.get(n.kind) ?? [];
      list.push(n);
      this.byKind.set(n.kind, list);
    }
  }

  /** Walks up from a node collecting ancestor ids, itself included. */
  private ancestry(id: string): Set<string> {
    const out = new Set<string>();
    let cursor: TaxonomyNodeLite | undefined = this.byId.get(id);
    // The tree is four deep; the bound is a guard against a cycle introduced
    // by bad data rather than an expected case.
    let guard = 0;
    while (cursor && guard++ < 16) {
      out.add(cursor.id);
      cursor = cursor.parentId ? this.byId.get(cursor.parentId) : undefined;
    }
    return out;
  }

  private candidates(
    level: LevelKey,
    name: string,
    parentId?: string,
  ): TaxonomyNodeLite[] {
    const wanted = normaliseName(name);
    const wantedCode = normaliseCode(name);
    return (this.byKind.get(KIND_FOR[level]) ?? []).filter((n) => {
      if (parentId && n.parentId !== parentId) return false;
      if (normaliseName(n.name) === wanted) return true;
      return Boolean(n.code) && normaliseCode(n.code as string) === wantedCode;
    });
  }

  /**
   * Resolves the four taxonomy cells of one row.
   *
   * Works top-down so each level is looked up among the children of the level
   * above. That is what makes two subjects with a "Mechanics" chapter each
   * unambiguous -- without the parent constraint, the name alone is not enough
   * and both would be candidates.
   */
  resolvePath(cells: Partial<Record<LevelKey, string>>): ResolvedTaxonomy {
    const issues: Issue[] = [];
    const missing: { level: LevelKey; name: string }[] = [];

    // A path in one cell fills the levels above it. "Physics / Mechanics" in
    // the Chapter column means subject Physics, chapter Mechanics.
    const wanted: Partial<Record<LevelKey, string>> = {};
    for (const [i, level] of LEVEL_ORDER.entries()) {
      const cell = cells[level];
      if (!cell) continue;
      const segments = splitPath(cell);
      const start = i - segments.length + 1;
      if (start < 0) {
        issues.push({
          code: 'TAXONOMY_PATH_TOO_DEEP',
          severity: 'BLOCKING',
          message:
            `"${cell}" in the ${level} column names ${segments.length} levels, ` +
            `but only ${i + 1} exist above and including it.`,
        });
        continue;
      }
      segments.forEach((segment, k) => {
        const target = LEVEL_ORDER[start + k];
        const existing = wanted[target];
        if (existing && normaliseName(existing) !== normaliseName(segment)) {
          issues.push({
            code: 'TAXONOMY_CONFLICT',
            severity: 'BLOCKING',
            message:
              `The ${target} is given as both "${existing}" and "${segment}".`,
          });
          return;
        }
        wanted[target] = segment;
      });
    }

    const resolved: Partial<Record<LevelKey, string>> = {};
    let parentId: string | undefined;
    let parentLevel: LevelKey | undefined;

    for (const level of LEVEL_ORDER) {
      const name = wanted[level];
      if (!name) {
        // A gap is allowed -- the level is optional. The next level down then
        // has no parent to constrain it, which the ambiguity check below
        // handles.
        continue;
      }

      // Constrain by the parent only when it is the level immediately above,
      // otherwise a skipped level would wrongly demand a direct child.
      const directParent =
        parentLevel &&
        LEVEL_ORDER.indexOf(level) - LEVEL_ORDER.indexOf(parentLevel) === 1
          ? parentId
          : undefined;

      let found = this.candidates(level, name, directParent);

      // No direct-parent constraint (a level was skipped): fall back to any
      // node of this kind that sits under whatever we did resolve.
      if (found.length !== 1 && !directParent && parentId) {
        const under = this.candidates(level, name).filter((n) =>
          this.ancestry(n.id).has(parentId as string),
        );
        if (under.length) found = under;
      }

      if (found.length === 0) {
        missing.push({ level, name });
        issues.push({
          code: 'TAXONOMY_NOT_FOUND',
          severity: 'BLOCKING',
          message:
            `No ${level} called "${name}" exists in this bank` +
            (parentId ? ' under the levels above it' : '') +
            '. Create it, or correct the document.',
        });
        // Stop constraining deeper levels by a parent we never found.
        parentId = undefined;
        parentLevel = undefined;
        continue;
      }

      if (found.length > 1) {
        issues.push({
          code: 'TAXONOMY_AMBIGUOUS',
          severity: 'BLOCKING',
          message:
            `"${name}" matches ${found.length} ${level}s. Name the levels ` +
            `above it, or write the full path.`,
        });
        parentId = undefined;
        parentLevel = undefined;
        continue;
      }

      resolved[level] = found[0].id;
      parentId = found[0].id;
      parentLevel = level;
    }

    // Everything resolved independently must still be one real path. The same
    // check runs again server-side on commit; doing it here means the reviewer
    // sees the problem against the row rather than as a failed commit.
    const deepest = [...LEVEL_ORDER].reverse().find((l) => resolved[l]);
    if (deepest) {
      const chain = this.ancestry(resolved[deepest] as string);
      for (const level of LEVEL_ORDER) {
        const id = resolved[level];
        if (id && !chain.has(id)) {
          issues.push({
            code: 'TAXONOMY_INCOHERENT',
            severity: 'BLOCKING',
            message:
              `The ${deepest} does not sit under the ${level} named in the ` +
              `same row.`,
          });
        }
      }
    }

    return {
      subjectId: resolved.subject,
      chapterId: resolved.chapter,
      topicId: resolved.topic,
      subtopicId: resolved.subtopic,
      issues,
      missing,
    };
  }

  /**
   * Matches a question-type cell against code, label, then aliases.
   *
   * Aliases are the whole reason "reject a file naming a type we do not have"
   * is workable rather than infuriating: one document says "Numerical", the next
   * says "Integer Type", and the tenant records both against NAT once instead
   * of editing every document.
   */
  resolveType(raw?: string): { id?: string; issues: Issue[] } {
    return this.resolveDef(raw, this.types, 'question type', 'TYPE');
  }

  resolveDifficulty(raw?: string): { id?: string; issues: Issue[] } {
    return this.resolveDef(raw, this.difficulties, 'difficulty', 'DIFFICULTY');
  }

  private resolveDef(
    raw: string | undefined,
    defs: NamedDef[],
    label: string,
    codePrefix: string,
  ): { id?: string; issues: Issue[] } {
    if (!raw?.trim()) return { issues: [] };

    const wantedName = normaliseName(raw);
    const wantedCode = normaliseCode(raw);

    const hit = defs.find(
      (d) =>
        normaliseCode(d.code) === wantedCode ||
        normaliseName(d.label) === wantedName ||
        d.aliases.some((a) => normaliseCode(a) === wantedCode),
    );

    if (hit) return { id: hit.id, issues: [] };

    return {
      issues: [
        {
          code: `${codePrefix}_NOT_FOUND`,
          severity: 'BLOCKING',
          message:
            `No ${label} called "${raw.trim()}" is configured. Add it, or add ` +
            `"${raw.trim()}" as an alias of an existing one.`,
        },
      ],
    };
  }
}
