/** Seeds the throwaway database with a paper and N attempts, and writes attempts.json for k6. */
const fs = require('fs');
const path = require('path');
const { prisma, seedPaper, createAttempts } = require('./lib');

async function main() {
  const count = Number(process.argv[2] ?? 2000);
  const db = prisma();
  console.log('Seeding paper…');
  const paper = await seedPaper(db);
  console.log(`  test ${paper.testId} with ${paper.questions.length} questions`);
  console.log(`Creating ${count} attempts…`);
  const attempts = await createAttempts(db, paper, count, 'load');
  fs.writeFileSync(path.join(__dirname, 'paper.json'), JSON.stringify(paper, null, 2));
  fs.writeFileSync(path.join(__dirname, 'attempts.json'), JSON.stringify(attempts));
  console.log(`  wrote attempts.json (${attempts.length})`);
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
