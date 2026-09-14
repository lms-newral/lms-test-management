import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DifficultyLevel, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { markDeleted, notDeleted } from 'src/prisma/soft-delete';

export interface DifficultyInput {
  code?: string;
  label?: string;
  aliases?: string[];
  color?: string;
  orderIndex?: number;
  isActive?: boolean;
}

/**
 * Normalises a code or alias for matching: upper-case, and spaces, hyphens and
 * underscores all collapse away.
 *
 * That is what lets one Word file say "Multiple Choice", the next say
 * "MULTIPLE_CHOICE" and a third say "multiple-choice", while the tenant only
 * ever lists the alias once.
 */
export function normaliseCode(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');
}

@Injectable()
export class DifficultyService {
  private readonly logger = new Logger(DifficultyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, includeInactive = false) {
    const rows = await this.prisma.difficultyLevel.findMany({
      where: {
        tenantId,
        ...notDeleted(),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ orderIndex: 'asc' }, { label: 'asc' }],
    });

    const counts = await this.prisma.question.groupBy({
      by: ['difficultyId'],
      where: { tenantId, ...notDeleted(), difficultyId: { not: null } },
      _count: { _all: true },
    });
    const countFor = new Map(
      counts.map((c) => [c.difficultyId as string, c._count._all]),
    );

    return rows.map((r) => this.toEntity(r, countFor.get(r.id) ?? 0));
  }

  async create(input: DifficultyInput, userId: string, tenantId: string) {
    const code = normaliseCode(input.code ?? '');
    if (!code) throw new ConflictException('A code is required.');

    await this.assertNoAliasClash(tenantId, code, input.aliases ?? [], null);

    try {
      const row = await this.prisma.difficultyLevel.create({
        data: {
          tenantId,
          code,
          label: (input.label ?? code).trim(),
          aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
          color: input.color ?? null,
          orderIndex: input.orderIndex ?? 0,
          createdById: userId,
        },
      });
      return this.toEntity(row, 0);
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `A difficulty with code "${code}" already exists.`,
        );
      }
      throw e;
    }
  }

  /**
   * `code` is immutable once questions reference the level, because a docx
   * column and a test format's marking rules are both matched against it.
   * Rename the label instead, or add an alias.
   */
  async update(id: string, input: DifficultyInput, tenantId: string) {
    const existing = await this.findOwned(id, tenantId);

    if (input.aliases) {
      await this.assertNoAliasClash(tenantId, existing.code, input.aliases, id);
    }

    const row = await this.prisma.difficultyLevel.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.aliases !== undefined
          ? { aliases: input.aliases.map((a) => a.trim()).filter(Boolean) }
          : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.orderIndex !== undefined
          ? { orderIndex: input.orderIndex }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    const count = await this.prisma.question.count({
      where: { tenantId, difficultyId: id, ...notDeleted() },
    });
    return this.toEntity(row, count);
  }

  async remove(id: string, userId: string, tenantId: string): Promise<boolean> {
    const row = await this.findOwned(id, tenantId);
    const inUse = await this.prisma.question.count({
      where: { tenantId, difficultyId: id, ...notDeleted() },
    });
    if (inUse > 0) {
      throw new ConflictException(
        `Cannot delete "${row.label}": ${inUse} question(s) use it. Deactivate it instead.`,
      );
    }
    await this.prisma.difficultyLevel.update({
      where: { id },
      data: { ...markDeleted(userId), isActive: false },
    });
    return true;
  }

  /**
   * Resolves a raw string from a Word file to a level id, or null.
   * Used by the importer to answer "do we have this difficulty?".
   */
  async resolve(raw: string, tenantId: string): Promise<string | null> {
    const needle = normaliseCode(raw);
    if (!needle) return null;

    const rows = await this.prisma.difficultyLevel.findMany({
      where: { tenantId, isActive: true, ...notDeleted() },
      select: { id: true, code: true, aliases: true },
    });

    for (const r of rows) {
      if (normaliseCode(r.code) === needle) return r.id;
      if (r.aliases.some((a) => normaliseCode(a) === needle)) return r.id;
    }
    return null;
  }

  /**
   * An alias that already belongs to another level would make import matching
   * ambiguous — the first row scanned would silently win — so it is rejected.
   */
  private async assertNoAliasClash(
    tenantId: string,
    code: string,
    aliases: string[],
    selfId: string | null,
  ): Promise<void> {
    const rows = await this.prisma.difficultyLevel.findMany({
      where: {
        tenantId,
        ...notDeleted(),
        ...(selfId ? { id: { not: selfId } } : {}),
      },
      select: { code: true, label: true, aliases: true },
    });

    const taken = new Map<string, string>();
    for (const r of rows) {
      taken.set(normaliseCode(r.code), r.label);
      for (const a of r.aliases) taken.set(normaliseCode(a), r.label);
    }

    for (const candidate of [code, ...aliases]) {
      const owner = taken.get(normaliseCode(candidate));
      if (owner) {
        throw new ConflictException(
          `"${candidate}" is already used by "${owner}". Import matching would be ambiguous.`,
        );
      }
    }
  }

  private async findOwned(
    id: string,
    tenantId: string,
  ): Promise<DifficultyLevel> {
    const row = await this.prisma.difficultyLevel.findFirst({
      where: { id, tenantId, ...notDeleted() },
    });
    if (!row) throw new NotFoundException(`Difficulty not found: ${id}`);
    return row;
  }

  private toEntity(r: DifficultyLevel, questionCount: number) {
    return {
      id: r.id,
      code: r.code,
      label: r.label,
      aliases: r.aliases,
      color: r.color ?? undefined,
      orderIndex: r.orderIndex,
      isActive: r.isActive,
      questionCount,
    };
  }
}
