import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Taxonomy } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { markDeleted, notDeleted } from 'src/prisma/soft-delete';
import { TaxonomyKind } from '../question-bank.enums';
import {
  CreateTaxonomyInput,
  UpdateTaxonomyInput,
} from '../dto/question-bank.inputs';
import { TaxonomyNode } from '../entities/question-bank.entities';

/**
 * The level a node's parent must be. SUBJECT sits at the root, so it has none.
 * Adding a level later (CLASS, EXAM) is an entry here plus an enum value.
 */
const REQUIRED_PARENT_KIND: Record<TaxonomyKind, TaxonomyKind | null> = {
  [TaxonomyKind.SUBJECT]: null,
  [TaxonomyKind.CHAPTER]: TaxonomyKind.SUBJECT,
  [TaxonomyKind.TOPIC]: TaxonomyKind.CHAPTER,
  [TaxonomyKind.SUBTOPIC]: TaxonomyKind.TOPIC,
};

@Injectable()
export class TaxonomyService {
  private readonly logger = new Logger(TaxonomyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async tree(
    tenantId: string,
    includeInactive = false,
  ): Promise<TaxonomyNode[]> {
    const rows = await this.prisma.taxonomy.findMany({
      where: {
        tenantId,
        ...notDeleted(),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ orderIndex: 'asc' }, { name: 'asc' }],
    });

    // One grouped count instead of a query per node.
    const counts = await this.questionCounts(tenantId);

    const nodes = new Map<string, TaxonomyNode>();
    for (const r of rows) {
      nodes.set(r.id, {
        id: r.id,
        kind: r.kind,
        name: r.name,
        code: r.code ?? undefined,
        parentId: r.parentId ?? undefined,
        orderIndex: r.orderIndex,
        isActive: r.isActive,
        questionCount: counts.get(r.id) ?? 0,
        children: [],
      });
    }

    const roots: TaxonomyNode[] = [];
    for (const node of nodes.values()) {
      // A node whose parent is inactive or deleted is surfaced at the root
      // rather than dropped, so it can never become invisible and unfixable.
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children!.push(node);
      else roots.push(node);
    }

    return roots;
  }

  private async questionCounts(tenantId: string): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const bump = (id: string | null) => {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    };

    const rows = await this.prisma.question.findMany({
      where: { tenantId, ...notDeleted() },
      select: {
        subjectId: true,
        chapterId: true,
        topicId: true,
        subtopicId: true,
      },
    });

    for (const r of rows) {
      bump(r.subjectId);
      bump(r.chapterId);
      bump(r.topicId);
      bump(r.subtopicId);
    }
    return counts;
  }

  async create(
    input: CreateTaxonomyInput,
    userId: string,
    tenantId: string,
  ): Promise<Taxonomy> {
    await this.assertValidParent(input.kind, input.parentId, tenantId);

    try {
      return await this.prisma.taxonomy.create({
        data: {
          tenantId,
          kind: input.kind,
          name: input.name.trim(),
          code: input.code?.trim() || null,
          parentId: input.parentId ?? null,
          orderIndex: input.orderIndex ?? 0,
          createdById: userId,
        },
      });
    } catch (e) {
      throw this.translateUnique(e, input.name);
    }
  }

  async update(
    id: string,
    input: UpdateTaxonomyInput,
    tenantId: string,
  ): Promise<Taxonomy> {
    const existing = await this.findOwned(id, tenantId);

    try {
      return await this.prisma.taxonomy.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name.trim() } : {}),
          ...(input.code !== undefined
            ? { code: input.code?.trim() || null }
            : {}),
          ...(input.orderIndex !== undefined
            ? { orderIndex: input.orderIndex }
            : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
    } catch (e) {
      throw this.translateUnique(e, input.name ?? existing.name);
    }
  }

  /**
   * Soft-deletes the node and everything beneath it.
   *
   * Refuses while live questions still reference any node in that subtree —
   * silently orphaning them would leave questions filed under a subject that no
   * longer appears in any filter, which is very hard to notice and worse to fix.
   */
  async remove(id: string, userId: string, tenantId: string): Promise<boolean> {
    const node = await this.findOwned(id, tenantId);
    const subtree = await this.subtreeIds(node.id, tenantId);

    const inUse = await this.prisma.question.count({
      where: {
        tenantId,
        ...notDeleted(),
        OR: [
          { subjectId: { in: subtree } },
          { chapterId: { in: subtree } },
          { topicId: { in: subtree } },
          { subtopicId: { in: subtree } },
        ],
      },
    });

    if (inUse > 0) {
      throw new ConflictException(
        `Cannot delete "${node.name}": ${inUse} question(s) still reference it ` +
          `or something beneath it. Move or retire those questions first.`,
      );
    }

    await this.prisma.taxonomy.updateMany({
      where: { id: { in: subtree }, tenantId },
      data: markDeleted(userId),
    });

    this.logger.log(
      `Soft-deleted taxonomy ${node.id} and ${subtree.length - 1} descendant(s)`,
    );
    return true;
  }

  /** Breadth-first walk; returns the node's id plus every descendant's. */
  private async subtreeIds(
    rootId: string,
    tenantId: string,
  ): Promise<string[]> {
    const all = await this.prisma.taxonomy.findMany({
      where: { tenantId, ...notDeleted() },
      select: { id: true, parentId: true },
    });

    const childrenOf = new Map<string, string[]>();
    for (const r of all) {
      if (!r.parentId) continue;
      const list = childrenOf.get(r.parentId) ?? [];
      list.push(r.id);
      childrenOf.set(r.parentId, list);
    }

    const out: string[] = [];
    const queue = [rootId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      out.push(id);
      queue.push(...(childrenOf.get(id) ?? []));
    }
    return out;
  }

  private async assertValidParent(
    kind: TaxonomyKind,
    parentId: string | undefined,
    tenantId: string,
  ): Promise<void> {
    const required = REQUIRED_PARENT_KIND[kind];

    if (required === null) {
      if (parentId) {
        throw new BadRequestException(
          `A ${kind} sits at the root and cannot have a parent.`,
        );
      }
      return;
    }

    if (!parentId) {
      throw new BadRequestException(`A ${kind} requires a ${required} parent.`);
    }

    const parent = await this.prisma.taxonomy.findFirst({
      where: { id: parentId, tenantId, ...notDeleted() },
      select: { kind: true },
    });

    if (!parent) throw new NotFoundException(`Parent not found: ${parentId}`);

    if (parent.kind !== required) {
      throw new BadRequestException(
        `A ${kind} must hang off a ${required}, but the given parent is a ${parent.kind}.`,
      );
    }
  }

  private async findOwned(id: string, tenantId: string): Promise<Taxonomy> {
    const row = await this.prisma.taxonomy.findFirst({
      where: { id, tenantId, ...notDeleted() },
    });
    if (!row) throw new NotFoundException(`Taxonomy not found: ${id}`);
    return row;
  }

  /**
   * The uniqueness rule is enforced by two partial indexes rather than a Prisma
   * @@unique, so Prisma reports it as a bare P2002 with no field list. Translate
   * it into something an admin can act on.
   */
  private translateUnique(e: unknown, name: string): Error {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      return new ConflictException(
        `"${name}" already exists at this level. Names must be unique among siblings.`,
      );
    }
    return e as Error;
  }
}
