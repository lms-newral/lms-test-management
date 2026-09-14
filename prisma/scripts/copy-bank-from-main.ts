import 'dotenv/config';
import { Prisma, PrismaClient } from '@prisma/client';
import { Client } from 'pg';

/**
 * Copies the question bank out of the main backend's database into this one.
 *
 *   MAIN_DATABASE_URL=<main db> npm run copy:bank                        # dry run
 *   MAIN_DATABASE_URL=<main db> npm run copy:bank -- --apply
 *   MAIN_DATABASE_URL=<main db> npm run copy:bank -- --tenant=<id> --apply
 *
 * MAIN_DATABASE_URL is given on the command line, never stored in this
 * service's .env: it is live production, and keeping it out of config means
 * nothing here can reach it by accident. The source side also runs inside a
 * READ ONLY transaction, so this script cannot write to it even by mistake.
 *
 * Idempotent: rows keep their original ids and are inserted with
 * skipDuplicates, so a re-run copies only what is new. Nothing is updated or
 * deleted on either side.
 */

const APPLY = process.argv.includes('--apply');
const TENANT = process.argv
  .find((a) => a.startsWith('--tenant='))
  ?.split('=')[1];

const tenantScope = TENANT ? `"tenantId" = $1` : 'TRUE';
/** Bank questions only. Old test-engine questions (testId set) stay behind. */
const bankQuestions = `SELECT id FROM "Question" WHERE "testId" IS NULL AND ${tenantScope}`;

/** Parents before children, so every foreign key already has its target. */
const TABLES: { model: Prisma.ModelName; where: string; orderBy?: string }[] = [
  {
    model: 'Taxonomy',
    where: tenantScope,
    // A child's parent is always one level up, so copying level by level keeps
    // the self-referencing parentId valid.
    orderBy: `ORDER BY array_position(ARRAY['SUBJECT','CHAPTER','TOPIC','SUBTOPIC'], kind::text)`,
  },
  { model: 'QuestionTypeDef', where: tenantScope },
  { model: 'DifficultyLevel', where: tenantScope },
  { model: 'QuestionFieldDef', where: tenantScope },
  {
    model: 'QuestionFieldOption',
    where: `"defId" IN (SELECT id FROM "QuestionFieldDef" WHERE ${tenantScope})`,
  },
  { model: 'QuestionGroup', where: tenantScope },
  { model: 'Question', where: `"testId" IS NULL AND ${tenantScope}` },
  { model: 'QuestionVersion', where: `"questionId" IN (${bankQuestions})` },
  { model: 'QuestionSolution', where: `"questionId" IN (${bankQuestions})` },
  { model: 'QuestionUsage', where: `"questionId" IN (${bankQuestions})` },
  { model: 'TestBlueprint', where: tenantScope },
  { model: 'QuestionImportJob', where: tenantScope },
  {
    model: 'QuestionImportRow',
    where: `"jobId" IN (SELECT id FROM "QuestionImportJob" WHERE ${tenantScope})`,
  },
];

const CHUNK = 500;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  const source = process.env.MAIN_DATABASE_URL;
  if (!source) {
    fail(
      'MAIN_DATABASE_URL is required -- the main backend database to copy from.\n' +
        '  MAIN_DATABASE_URL=<url> npm run copy:bank [-- --apply] [-- --tenant=<id>]',
    );
  }
  if (source === process.env.DATABASE_URL || source === process.env.DIRECT_URL) {
    fail('MAIN_DATABASE_URL is this service\'s own database. Refusing.');
  }

  console.log(APPLY ? 'Mode: APPLY' : 'Mode: dry run (pass --apply to write)');
  console.log(TENANT ? `Tenant: ${TENANT}\n` : 'Tenant: all\n');

  // Prisma rejects a plain null for a Json column in createMany; it needs
  // DbNull. Other nullable columns must keep their null rather than be omitted,
  // or a column with a default (Question.difficulty = "medium") would change.
  const jsonFields = new Map(
    Prisma.dmmf.datamodel.models.map((m) => [
      m.name,
      m.fields.filter((f) => f.type === 'Json').map((f) => f.name),
    ]),
  );
  // Prisma list columns (String[]) cannot be null, but older main-database rows
  // hold NULL in them (Question.tags) -- the column itself is nullable in SQL.
  // Copy those as an empty list rather than fail the whole batch.
  const listFields = new Map(
    Prisma.dmmf.datamodel.models.map((m) => [
      m.name,
      m.fields.filter((f) => f.kind === 'scalar' && f.isList).map((f) => f.name),
    ]),
  );

  const main = new Client({ connectionString: source });
  await main.connect();
  await main.query('BEGIN TRANSACTION READ ONLY');
  const target = new PrismaClient();

  try {
    for (const { model, where, orderBy } of TABLES) {
      const { rows } = await main.query<Record<string, unknown>>(
        `SELECT * FROM "${model}" WHERE ${where} ${orderBy ?? ''}`,
        TENANT ? [TENANT] : [],
      );

      if (!APPLY || rows.length === 0) {
        console.log(`${model.padEnd(20)} ${rows.length} to copy`);
        continue;
      }

      const json = jsonFields.get(model) ?? [];
      const lists = listFields.get(model) ?? [];
      const delegate = (target as unknown as Record<
        string,
        { createMany(args: unknown): Promise<{ count: number }> }
      >)[model.charAt(0).toLowerCase() + model.slice(1)];

      let inserted = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const data = rows.slice(i, i + CHUNK).map((row) => {
          const copy = { ...row };
          for (const field of json) {
            if (copy[field] === null) copy[field] = Prisma.DbNull;
          }
          for (const field of lists) {
            if (copy[field] === null) copy[field] = [];
          }
          return copy;
        });
        const result = await delegate.createMany({ data, skipDuplicates: true });
        inserted += result.count;
      }
      console.log(
        `${model.padEnd(20)} ${rows.length} read, ${inserted} inserted, ${rows.length - inserted} already present`,
      );
    }
  } finally {
    await main.query('ROLLBACK').catch(() => undefined);
    await main.end();
    await target.$disconnect();
  }

  if (!APPLY) console.log('\nDry run -- nothing was written.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
