import 'dotenv/config';
import { AnswerKernel, PrismaClient, TestFormatStatus } from '@prisma/client';
import {
  FORMAT_TEMPLATES,
  TEMPLATE_NOTE,
} from '../../src/modules/tests/test-format.presets';
import { validateFormat } from '../../src/modules/tests/test-format.logic';

// Seeds the platform test-format templates (tenantId NULL): JEE Main, JEE
// Advanced Paper 1 and 2, NEET UG. Institutes copy these into their own formats.
//
//   npm run seed:format-templates              # dry run
//   npm run seed:format-templates -- --apply
//
// Idempotent by name. Re-running replaces a template's structure, which is safe:
// tests are only ever built on an institute's copy, never on a template, so a
// template has nothing depending on it.

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? 'APPLYING\n' : 'DRY RUN -- re-run with --apply to write\n');

  for (const t of FORMAT_TEMPLATES) {
    const problems = validateFormat(t);
    if (problems.length) {
      console.error(`SKIP ${t.name}: does not add up\n  ${problems.join('\n  ')}`);
      process.exitCode = 1;
      continue;
    }

    const structure = {
      subjects: {
        create: t.subjects.map((s, si) => ({
          subjectId: null,
          subjectName: s.subjectName,
          totalQuestions: s.totalQuestions,
          totalMarks: s.totalMarks,
          orderIndex: si,
          sections: {
            create: s.sections.map((sec, xi) => ({
              name: sec.name,
              orderIndex: xi,
              rows: {
                create: sec.rows.map((r, ri) => ({
                  questionTypeId: null,
                  questionTypeCode: r.questionTypeCode,
                  kernel: r.kernel as AnswerKernel,
                  questionCount: r.questionCount,
                  attemptLimit: r.attemptLimit ?? null,
                  marksPerQuestion: r.marksPerQuestion,
                  negativeMarks: r.negativeMarks,
                  partialMarking: r.partialMarking,
                  orderIndex: ri,
                })),
              },
            })),
          },
        })),
      },
    };

    const existing = await prisma.testFormat.findFirst({
      where: { tenantId: null, name: t.name, deletedAt: null },
      select: { id: true },
    });
    console.log(`${existing ? 'UPDATE' : 'CREATE'}  ${t.name}`);
    if (!APPLY) continue;

    const fields = {
      instructionsHtml: t.instructionsHtml,
      durationMinutes: t.durationMinutes,
      templateNote: TEMPLATE_NOTE,
      status: TestFormatStatus.ACTIVE,
    };

    if (existing) {
      await prisma.$transaction([
        prisma.testFormatSubject.deleteMany({ where: { formatId: existing.id } }),
        prisma.testFormat.update({ where: { id: existing.id }, data: { ...fields, ...structure } }),
      ]);
    } else {
      await prisma.testFormat.create({
        data: { tenantId: null, name: t.name, ...fields, ...structure },
      });
    }
  }

  if (!APPLY) console.log('\nDRY RUN -- nothing was written.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
