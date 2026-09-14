import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QuestionTypeDef } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { markDeleted, notDeleted } from 'src/prisma/soft-delete';
import { normaliseCode } from './difficulty.service';
import {
  CreateQuestionTypeInput,
  UpdateQuestionTypeInput,
} from '../dto/question-bank.inputs';
import { QuestionTypeDefEntity } from '../entities/question-bank.entities';

@Injectable()
export class QuestionTypesService {
  private readonly logger = new Logger(QuestionTypesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async list(
    tenantId: string,
    includeInactive = false,
  ): Promise<QuestionTypeDefEntity[]> {
    const rows = await this.prisma.questionTypeDef.findMany({
      where: {
        tenantId,
        ...notDeleted(),
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: [{ orderIndex: 'asc' }, { label: 'asc' }],
    });

    const counts = await this.prisma.question.groupBy({
      by: ['questionTypeId'],
      where: { tenantId, ...notDeleted(), questionTypeId: { not: null } },
      _count: { _all: true },
    });

    const countFor = new Map(
      counts.map((c) => [c.questionTypeId as string, c._count._all]),
    );

    return rows.map((r) => this.toEntity(r, countFor.get(r.id) ?? 0));
  }

  async create(
    input: CreateQuestionTypeInput,
    userId: string,
    tenantId: string,
  ): Promise<QuestionTypeDefEntity> {
    try {
      const row = await this.prisma.questionTypeDef.create({
        data: {
          tenantId,
          code: input.code.trim().toUpperCase(),
          label: input.label.trim(),
          kernel: input.kernel,
          aliases: (input.aliases ?? []).map((a) => a.trim()).filter(Boolean),
          config: (input.config ?? null) as Prisma.InputJsonValue,
          layoutHint: input.layoutHint ?? null,
          icon: input.icon ?? null,
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
          `A question type with code "${input.code}" already exists.`,
        );
      }
      throw e;
    }
  }

  /**
   * `kernel` is deliberately not updatable. Changing it would reinterpret the
   * stored answers of every existing question of that type — a silent
   * corruption of the answer key. Create a new type instead.
   */
  async update(
    id: string,
    input: UpdateQuestionTypeInput,
    tenantId: string,
  ): Promise<QuestionTypeDefEntity> {
    await this.findOwned(id, tenantId);

    const row = await this.prisma.questionTypeDef.update({
      where: { id },
      data: {
        ...(input.label !== undefined ? { label: input.label.trim() } : {}),
        ...(input.aliases !== undefined
          ? { aliases: input.aliases.map((a) => a.trim()).filter(Boolean) }
          : {}),
        ...(input.config !== undefined
          ? { config: input.config as Prisma.InputJsonValue }
          : {}),
        ...(input.layoutHint !== undefined
          ? { layoutHint: input.layoutHint }
          : {}),
        ...(input.icon !== undefined ? { icon: input.icon } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.orderIndex !== undefined
          ? { orderIndex: input.orderIndex }
          : {}),
      },
    });

    const count = await this.prisma.question.count({
      where: { tenantId, questionTypeId: id, ...notDeleted() },
    });
    return this.toEntity(row, count);
  }

  /**
   * Soft delete, refused while questions still use the type.
   *
   * Deactivating (`isActive: false`) is the right move for a type you want
   * retired but whose existing questions must keep rendering — it hides it from
   * the authoring picker without touching the data.
   */
  async remove(id: string, userId: string, tenantId: string): Promise<boolean> {
    const row = await this.findOwned(id, tenantId);

    const inUse = await this.prisma.question.count({
      where: { tenantId, questionTypeId: id, ...notDeleted() },
    });

    if (inUse > 0) {
      throw new ConflictException(
        `Cannot delete "${row.label}": ${inUse} question(s) use it. ` +
          `Deactivate it instead to hide it from the authoring picker.`,
      );
    }

    await this.prisma.questionTypeDef.update({
      where: { id },
      data: { ...markDeleted(userId), isActive: false },
    });
    this.logger.log(`Soft-deleted question type ${id}`);
    return true;
  }

  /**
   * Resolves a raw string from a Word file to a type id, or null. Matching is
   * case-insensitive and ignores spaces/underscores, and checks aliases as
   * well as the code.
   */
  async resolve(raw: string, tenantId: string): Promise<string | null> {
    const needle = normaliseCode(raw);
    if (!needle) return null;
    const rows = await this.prisma.questionTypeDef.findMany({
      where: { tenantId, isActive: true, ...notDeleted() },
      select: { id: true, code: true, aliases: true },
    });
    for (const r of rows) {
      if (normaliseCode(r.code) === needle) return r.id;
      if (r.aliases.some((a) => normaliseCode(a) === needle)) return r.id;
    }
    return null;
  }

  async findOwned(id: string, tenantId: string): Promise<QuestionTypeDef> {
    const row = await this.prisma.questionTypeDef.findFirst({
      where: { id, tenantId, ...notDeleted() },
    });
    if (!row) throw new NotFoundException(`Question type not found: ${id}`);
    return row;
  }

  private toEntity(
    r: QuestionTypeDef,
    questionCount: number,
  ): QuestionTypeDefEntity {
    return {
      id: r.id,
      code: r.code,
      label: r.label,
      kernel: r.kernel,
      config: r.config ?? undefined,
      layoutHint: r.layoutHint ?? undefined,
      icon: r.icon ?? undefined,
      color: r.color ?? undefined,
      aliases: r.aliases,
      isActive: r.isActive,
      orderIndex: r.orderIndex,
      questionCount,
    };
  }
}
