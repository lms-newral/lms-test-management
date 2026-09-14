import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { markDeleted, notDeleted } from 'src/prisma/soft-delete';
import { SolutionKind, SolutionVisibility } from '../question-bank.enums';
import { UpsertSolutionInput } from '../dto/question-bank.inputs';
import { QuestionSolutionEntity } from '../entities/question-bank.entities';

@Injectable()
export class SolutionsService {
  private readonly logger = new Logger(SolutionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async upsert(
    questionId: string,
    input: UpsertSolutionInput,
    userId: string,
    tenantId: string,
  ): Promise<QuestionSolutionEntity> {
    const question = await this.prisma.question.findFirst({
      where: { id: questionId, tenantId, ...notDeleted() },
      select: { id: true },
    });
    if (!question) {
      throw new NotFoundException(`Question not found: ${questionId}`);
    }

    this.assertCoherent(input);

    const data = {
      kind: input.kind,
      contentHtml: input.contentHtml ?? null,
      videoProvider: input.videoProvider ?? null,
      videoUrl: input.videoUrl ?? null,
      durationSec: input.durationSec ?? null,
      language: input.language ?? null,
      visibility: input.visibility ?? SolutionVisibility.AFTER_SUBMIT,
      orderIndex: input.orderIndex ?? 0,
    };

    if (input.id) {
      const existing = await this.prisma.questionSolution.findFirst({
        where: { id: input.id, questionId, tenantId, ...notDeleted() },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException(`Solution not found: ${input.id}`);
      }
      const row = await this.prisma.questionSolution.update({
        where: { id: input.id },
        data,
      });
      return this.toEntity(row);
    }

    const row = await this.prisma.questionSolution.create({
      data: { ...data, tenantId, questionId, createdById: userId },
    });
    this.logger.log(`Added ${input.kind} solution to question ${questionId}`);
    return this.toEntity(row);
  }

  async remove(id: string, userId: string, tenantId: string): Promise<boolean> {
    const row = await this.prisma.questionSolution.findFirst({
      where: { id, tenantId, ...notDeleted() },
      select: { id: true },
    });
    if (!row) throw new NotFoundException(`Solution not found: ${id}`);

    await this.prisma.questionSolution.update({
      where: { id },
      data: markDeleted(userId),
    });
    return true;
  }

  /**
   * A solution block must actually carry what its kind promises. Without this a
   * VIDEO block with no URL renders as an empty player after the student has
   * already submitted and is looking for the explanation.
   */
  private assertCoherent(input: UpsertSolutionInput): void {
    if (input.kind === SolutionKind.VIDEO) {
      if (!input.videoUrl) {
        throw new BadRequestException('A video solution needs a videoUrl.');
      }
      if (!input.videoProvider) {
        throw new BadRequestException(
          'A video solution needs a videoProvider.',
        );
      }
      return;
    }

    if (!input.contentHtml?.trim()) {
      throw new BadRequestException(
        `A ${input.kind.toLowerCase()} solution needs contentHtml.`,
      );
    }
  }

  private toEntity(r: {
    id: string;
    kind: SolutionKind;
    contentHtml: string | null;
    videoProvider: QuestionSolutionEntity['videoProvider'] | null;
    videoUrl: string | null;
    durationSec: number | null;
    language: string | null;
    visibility: SolutionVisibility;
    orderIndex: number;
    createdAt: Date;
    updatedAt: Date;
  }): QuestionSolutionEntity {
    return {
      id: r.id,
      kind: r.kind,
      contentHtml: r.contentHtml ?? undefined,
      videoProvider: r.videoProvider ?? undefined,
      videoUrl: r.videoUrl ?? undefined,
      durationSec: r.durationSec ?? undefined,
      language: r.language ?? undefined,
      visibility: r.visibility,
      orderIndex: r.orderIndex,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
