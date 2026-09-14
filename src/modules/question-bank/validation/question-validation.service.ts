import { BadRequestException, Injectable } from '@nestjs/common';
import { QuestionFieldDef, QuestionFieldOption } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { notDeleted } from 'src/prisma/soft-delete';
import { AnswerKernel, FieldType } from '../question-bank.enums';
import { BankMCQOptionInput } from '../dto/question-bank.inputs';

type FieldWithOptions = QuestionFieldDef & { options: QuestionFieldOption[] };

export interface ValidatedAnswer {
  mcqOptions: unknown;
  answerConfig: unknown;
}

/**
 * Enforces the two contracts a bank question must satisfy: its answer payload
 * matches its type's kernel, and its custom field values match the tenant's
 * field definitions.
 *
 * Both run server-side on every write. The admin UI does the same checks for
 * responsiveness, but the UI is not the authority — a malformed answer key is
 * only discovered when students are already sitting the paper.
 */
@Injectable()
export class QuestionValidationService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Answer payload ────────────────────────────────────────────────────────

  validateAnswer(
    kernel: AnswerKernel,
    config: Record<string, unknown> | null,
    mcqOptions?: BankMCQOptionInput[],
    answerConfig?: Record<string, unknown>,
  ): ValidatedAnswer {
    switch (kernel) {
      case AnswerKernel.SINGLE_CHOICE:
      case AnswerKernel.MULTI_CHOICE:
        return {
          mcqOptions: this.validateChoice(kernel, config, mcqOptions),
          answerConfig: null,
        };

      case AnswerKernel.NUMERIC:
        return {
          mcqOptions: null,
          answerConfig: this.validateNumeric(config, answerConfig),
        };

      case AnswerKernel.SHORT_TEXT:
        return {
          mcqOptions: null,
          answerConfig: this.validateShortText(answerConfig),
        };

      case AnswerKernel.MATCHING:
        return {
          mcqOptions: null,
          answerConfig: this.validateMatching(answerConfig),
        };

      case AnswerKernel.ORDERING:
        return {
          mcqOptions: null,
          answerConfig: this.validateOrdering(answerConfig),
        };

      case AnswerKernel.LONG_TEXT:
      case AnswerKernel.CODE:
        // Graded by a human or by the code runner; there is no key to validate.
        return { mcqOptions: null, answerConfig: answerConfig ?? null };

      default: {
        const exhaustive: never = kernel;
        throw new BadRequestException(
          `Unsupported kernel: ${String(exhaustive)}`,
        );
      }
    }
  }

  private validateChoice(
    kernel: AnswerKernel,
    config: Record<string, unknown> | null,
    options?: BankMCQOptionInput[],
  ): unknown {
    if (!options || options.length < 2) {
      throw new BadRequestException(
        'A choice question needs at least two options.',
      );
    }

    const min = this.num(config?.minOptions) ?? 2;
    const max = this.num(config?.maxOptions) ?? 26;
    if (options.length < min || options.length > max) {
      throw new BadRequestException(
        `This question type expects between ${min} and ${max} options; got ${options.length}.`,
      );
    }

    const fixed = config?.fixedOptions;
    if (Array.isArray(fixed) && fixed.length > 0) {
      const given = options.map((o) => o.text.trim());
      const expected = fixed.map((f) => String(f).trim());
      const same =
        given.length === expected.length &&
        given.every((g, i) => g === expected[i]);
      if (!same) {
        throw new BadRequestException(
          `This question type has fixed options: ${expected.join(', ')}.`,
        );
      }
    }

    const correct = options.filter((o) => o.isCorrect);
    if (correct.length === 0) {
      throw new BadRequestException('Mark at least one option as correct.');
    }
    if (kernel === AnswerKernel.SINGLE_CHOICE && correct.length > 1) {
      throw new BadRequestException(
        `This is a single-correct type but ${correct.length} options are marked correct.`,
      );
    }

    const texts = options.map((o) => o.text.trim().toLowerCase());
    if (new Set(texts).size !== texts.length) {
      throw new BadRequestException('Two options have the same text.');
    }
    if (texts.some((t) => t.length === 0)) {
      throw new BadRequestException('An option is empty.');
    }

    return {
      options: options.map((o, i) => ({
        id: o.id ?? `opt_${i}`,
        text: o.text,
        isCorrect: o.isCorrect,
        orderIndex: i,
      })),
    };
  }

  private validateNumeric(
    config: Record<string, unknown> | null,
    answer?: Record<string, unknown>,
  ): unknown {
    const value = this.num(answer?.value);
    if (value === undefined) {
      throw new BadRequestException(
        'A numeric question needs answerConfig.value.',
      );
    }

    const integerOnly = config?.integerOnly === true;
    if (integerOnly && !Number.isInteger(value)) {
      throw new BadRequestException(
        'This question type accepts integer answers only.',
      );
    }

    const tolerance =
      this.num(answer?.tolerance) ?? this.num(config?.tolerance) ?? 0;
    if (tolerance < 0) {
      throw new BadRequestException('Tolerance cannot be negative.');
    }

    const unit = this.str(answer?.unit) || null;
    return { value, tolerance, integerOnly, unit };
  }

  private validateShortText(answer?: Record<string, unknown>): unknown {
    const raw = answer?.acceptedAnswers;
    const accepted = Array.isArray(raw)
      ? raw.map((a) => String(a).trim()).filter((a) => a.length > 0)
      : [];

    if (accepted.length === 0) {
      throw new BadRequestException(
        'A fill-in-the-blank question needs at least one accepted answer.',
      );
    }

    return {
      acceptedAnswers: accepted,
      caseSensitive: answer?.caseSensitive === true,
      trimWhitespace: answer?.trimWhitespace !== false,
    };
  }

  private validateMatching(answer?: Record<string, unknown>): unknown {
    const raw = answer?.pairs;
    if (!Array.isArray(raw) || raw.length < 2) {
      throw new BadRequestException(
        'A matching question needs at least two pairs.',
      );
    }

    const pairs = raw.map((p, i) => {
      const o = p as Record<string, unknown>;
      const left = this.str(o.left).trim();
      const right = this.str(o.right).trim();
      if (!left || !right) {
        throw new BadRequestException(`Pair ${i + 1} is missing a side.`);
      }
      return { left, right, orderIndex: i };
    });

    // Distractors on the right are legitimate — more right-hand entries than
    // pairs is a normal exam pattern — but a duplicated LEFT makes the question
    // unanswerable, since two prompts would accept the same target.
    const lefts = pairs.map((p) => p.left.toLowerCase());
    if (new Set(lefts).size !== lefts.length) {
      throw new BadRequestException('Two left-hand items are identical.');
    }

    const extras = Array.isArray(answer?.extraRight)
      ? (answer.extraRight as unknown[])
          .map((e) => String(e).trim())
          .filter(Boolean)
      : [];

    return { pairs, extraRight: extras };
  }

  private validateOrdering(answer?: Record<string, unknown>): unknown {
    const raw = answer?.sequence;
    if (!Array.isArray(raw) || raw.length < 2) {
      throw new BadRequestException(
        'An ordering question needs at least two items.',
      );
    }
    const items = raw.map((i) => String(i).trim()).filter((i) => i.length > 0);
    if (items.length !== raw.length) {
      throw new BadRequestException('An ordering item is empty.');
    }
    if (new Set(items.map((i) => i.toLowerCase())).size !== items.length) {
      throw new BadRequestException('Two ordering items are identical.');
    }
    return { sequence: items };
  }

  // ─── Custom fields ─────────────────────────────────────────────────────────

  /**
   * Validates values against the tenant's field definitions and returns a
   * cleaned object containing only known keys.
   *
   * Unknown keys are rejected rather than silently dropped: a typo in a field
   * key would otherwise look like it saved and then never appear in a filter.
   */
  async validateCustomFields(
    values: Record<string, unknown> | undefined | null,
    tenantId: string,
  ): Promise<Record<string, unknown> | null> {
    const defs = (await this.prisma.questionFieldDef.findMany({
      where: { tenantId, isActive: true, ...notDeleted() },
      include: { options: { where: { isActive: true } } },
    })) as FieldWithOptions[];

    const byKey = new Map(defs.map((d) => [d.key, d]));
    const input = values ?? {};

    const unknown = Object.keys(input).filter((k) => !byKey.has(k));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown field(s): ${unknown.join(', ')}. ` +
          `Define them under Custom Fields first.`,
      );
    }

    const out: Record<string, unknown> = {};

    for (const def of defs) {
      const raw = input[def.key];
      const missing = raw === undefined || raw === null || raw === '';

      if (missing) {
        if (def.required) {
          throw new BadRequestException(`"${def.label}" is required.`);
        }
        continue;
      }

      out[def.key] = this.coerceFieldValue(def, raw);
    }

    return Object.keys(out).length > 0 ? out : null;
  }

  private coerceFieldValue(def: FieldWithOptions, raw: unknown): unknown {
    switch (def.type) {
      case FieldType.TEXT:
        return String(raw);

      case FieldType.NUMBER: {
        const n = this.num(raw);
        if (n === undefined) {
          throw new BadRequestException(`"${def.label}" must be a number.`);
        }
        return n;
      }

      case FieldType.BOOLEAN:
        return raw === true || raw === 'true';

      case FieldType.DATE: {
        const d = new Date(String(raw));
        if (Number.isNaN(d.getTime())) {
          throw new BadRequestException(`"${def.label}" must be a valid date.`);
        }
        return d.toISOString();
      }

      case FieldType.SELECT: {
        const v = String(raw);
        this.assertOption(def, v);
        return v;
      }

      case FieldType.MULTI_SELECT: {
        if (!Array.isArray(raw)) {
          throw new BadRequestException(`"${def.label}" must be a list.`);
        }
        const vals = raw.map((v) => String(v));
        for (const v of vals) this.assertOption(def, v);
        return [...new Set(vals)];
      }

      default: {
        const exhaustive: never = def.type;
        throw new BadRequestException(
          `Unsupported field type: ${String(exhaustive)}`,
        );
      }
    }
  }

  private assertOption(def: FieldWithOptions, value: string): void {
    if (!def.options.some((o) => o.value === value)) {
      const allowed = def.options.map((o) => o.value).join(', ');
      throw new BadRequestException(
        `"${value}" is not a valid ${def.label}. Allowed: ${allowed || '(none defined)'}.`,
      );
    }
  }

  /**
   * Coerces a primitive to a string. Objects and arrays become '' rather than
   * "[object Object]", so a malformed payload fails validation loudly instead
   * of being stored as garbage that only surfaces in front of students.
   */
  private str(v: unknown): string {
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return '';
  }

  private num(v: unknown): number | undefined {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  }
}
