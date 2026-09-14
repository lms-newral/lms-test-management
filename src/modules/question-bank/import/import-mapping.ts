import { AnswerKernel } from '../question-bank.enums';
import {
  Issue,
  ParsedOption,
  ParsedRow,
  resolveChoiceAnswer,
} from './docx-parser';

/**
 * Turns a parsed Word row into the answer payload the bank stores.
 *
 * Pure, and separate from the service for the same reason the parser is: the
 * mapping from "what the author typed in the Answer column" to "what
 * `QuestionValidationService` expects" is fiddly per kernel and worth testing
 * on its own.
 *
 * The shapes produced here must match `validation/question-validation.service.ts`
 * exactly, because commit runs every row back through it. Producing something
 * it rejects would turn a reviewed, committed import into a wall of errors at
 * the very last step.
 */

export interface MappedAnswer {
  /** For the two choice kernels. */
  mcqOptions?: { text: string; isCorrect: boolean }[];
  /** For everything else. */
  answerConfig?: Record<string, unknown>;
  issues: Issue[];
}

/** Options are stored as HTML, but the bank compares and displays their text. */
function optionText(o: ParsedOption): string {
  return o.html;
}

export function mapAnswer(
  kernel: AnswerKernel,
  row: ParsedRow,
  typeConfig: Record<string, unknown> | null,
): MappedAnswer {
  const answerRaw = row.answerRaw ?? '';

  switch (kernel) {
    case AnswerKernel.SINGLE_CHOICE:
    case AnswerKernel.MULTI_CHOICE: {
      const issues: Issue[] = [];
      if (row.options.length < 2) {
        issues.push({
          code: 'TOO_FEW_OPTIONS',
          severity: 'BLOCKING',
          message:
            `A choice question needs at least two options; this row has ` +
            `${row.options.length}.`,
        });
        return { issues };
      }

      const { correct, issues: answerIssues } = resolveChoiceAnswer(
        answerRaw,
        row.options,
      );
      issues.push(...answerIssues);

      if (kernel === AnswerKernel.SINGLE_CHOICE && correct.size > 1) {
        issues.push({
          code: 'MULTIPLE_CORRECT_ON_SINGLE',
          severity: 'BLOCKING',
          message:
            `The answer names ${correct.size} options but this is a ` +
            `single-correct type. Change the Type column, or the answer.`,
        });
      }

      return {
        mcqOptions: row.options.map((o) => ({
          text: optionText(o),
          isCorrect: correct.has(o.letter),
        })),
        issues,
      };
    }

    case AnswerKernel.NUMERIC: {
      const value = Number(answerRaw.replace(/,/g, '').trim());
      if (!Number.isFinite(value)) {
        return {
          issues: [
            {
              code: 'ANSWER_NOT_NUMERIC',
              severity: 'BLOCKING',
              message: `"${answerRaw}" is not a number.`,
            },
          ],
        };
      }
      if (typeConfig?.integerOnly === true && !Number.isInteger(value)) {
        return {
          issues: [
            {
              code: 'ANSWER_NOT_INTEGER',
              severity: 'BLOCKING',
              message: `This type accepts integers only, but the answer is ${value}.`,
            },
          ],
        };
      }
      return {
        answerConfig: {
          value,
          tolerance: Number(typeConfig?.tolerance ?? 0),
          integerOnly: typeConfig?.integerOnly === true,
          unit: null,
        },
        issues: [],
      };
    }

    case AnswerKernel.SHORT_TEXT: {
      // "cell wall / cell membrane" in the Answer column means either is
      // accepted, which is how fill-in-the-blank keys are actually written.
      const accepted = answerRaw
        .split(/\s*(?:\/|\||;|\bor\b)\s*/i)
        .map((a) => a.trim())
        .filter(Boolean);
      if (accepted.length === 0) {
        return {
          issues: [
            {
              code: 'ANSWER_EMPTY',
              severity: 'BLOCKING',
              message: 'This row has no accepted answer.',
            },
          ],
        };
      }
      return {
        answerConfig: {
          acceptedAnswers: accepted,
          caseSensitive: false,
          trimWhitespace: true,
        },
        issues: [],
      };
    }

    case AnswerKernel.LONG_TEXT:
    case AnswerKernel.CODE:
      // Graded by a human or the code runner; the Answer cell becomes guidance
      // rather than a key, and the explanation column is where it belongs.
      return { answerConfig: {}, issues: [] };

    case AnswerKernel.MATCHING:
    case AnswerKernel.ORDERING:
      return {
        issues: [
          {
            code: 'KERNEL_NOT_IMPORTABLE',
            severity: 'BLOCKING',
            message:
              `${kernel} questions cannot be imported from Word yet -- a table ` +
              `cell cannot express the pairs. Author these in the editor.`,
          },
        ],
      };

    default: {
      const exhaustive: never = kernel;
      return {
        issues: [
          {
            code: 'UNKNOWN_KERNEL',
            severity: 'BLOCKING',
            message: `Unsupported question kernel: ${String(exhaustive)}.`,
          },
        ],
      };
    }
  }
}
