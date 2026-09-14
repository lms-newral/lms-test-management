// Offline check of BankQuestionsService.assertTaxonomyCoherent -- no DB.
//
// The method is private, so it is reached through create(), which calls it
// before it touches Prisma. Every stub below therefore only needs to answer the
// taxonomy reads; a create() that gets past validation throws on the first
// unstubbed call, which the tests treat as "accepted".
const {
  BankQuestionsService,
} = require('../../dist/src/modules/question-bank/questions/bank-questions.service');

const TENANT = 't1';

// Physics > Mechanics > Kinematics > Projectiles, plus a Chemistry branch to
// build mismatched chains out of.
const TREE = {
  phy: { id: 'phy', kind: 'SUBJECT', parentId: null, name: 'Physics' },
  mech: { id: 'mech', kind: 'CHAPTER', parentId: 'phy', name: 'Mechanics' },
  kin: { id: 'kin', kind: 'TOPIC', parentId: 'mech', name: 'Kinematics' },
  proj: { id: 'proj', kind: 'SUBTOPIC', parentId: 'kin', name: 'Projectiles' },
  chem: { id: 'chem', kind: 'SUBJECT', parentId: null, name: 'Chemistry' },
  org: { id: 'org', kind: 'CHAPTER', parentId: 'chem', name: 'Organic' },
  alk: { id: 'alk', kind: 'TOPIC', parentId: 'org', name: 'Alkanes' },
};

const ACCEPTED = '__ACCEPTED__';

function makeService() {
  const prisma = {
    taxonomy: {
      findMany: async ({ where }) =>
        (where.id.in || []).map((id) => TREE[id]).filter(Boolean),
      findFirst: async ({ where }) => TREE[where.id] || null,
    },
    // Reached only once validation has passed. Throwing a sentinel keeps the
    // test honest: it proves the code got past the checks rather than failing
    // for some unrelated reason.
    question: {
      create: async () => {
        throw new Error(ACCEPTED);
      },
    },
  };

  const validation = {
    validateAnswer: () => ({ mcqOptions: { options: [] }, answerConfig: null }),
    validateCustomFields: () => ({}),
  };

  const svc = new BankQuestionsService(prisma, validation);

  // create() resolves the type def before the taxonomy check.
  prisma.questionTypeDef = {
    findFirst: async () => ({
      id: 'type-scq',
      code: 'SCQ',
      kernel: 'SINGLE_CHOICE',
      config: {},
      tenantId: TENANT,
      deletedAt: null,
    }),
  };
  return svc;
}

/** Returns null when the taxonomy was accepted, else the rejection message. */
async function attempt(taxonomy) {
  const svc = makeService();
  try {
    await svc.create(
      {
        questionText: 'A body is thrown at 30 degrees to the horizontal.',
        questionTypeId: 'type-scq',
        mcqOptions: [
          { text: 'A', isCorrect: true },
          { text: 'B', isCorrect: false },
        ],
        ...taxonomy,
      },
      'user-1',
      TENANT,
    );
    return null;
  } catch (e) {
    const msg = e.message || String(e);
    return msg === ACCEPTED ? null : msg;
  }
}

/**
 * Runs update() against a stubbed Prisma and returns the `data` it would write.
 *
 * The existing row is fully classified, so any field the input does not mention
 * must be absent from the write -- that is what proves a field is genuinely
 * carried through rather than just happening to match what was already there.
 */
async function captureUpdate(input) {
  const EXISTING = {
    id: 'q1',
    tenantId: TENANT,
    questionText: 'A body is thrown at 30 degrees to the horizontal.',
    marks: 1,
    questionTypeId: 'type-scq',
    typeDef: {
      id: 'type-scq',
      code: 'SCQ',
      kernel: 'SINGLE_CHOICE',
      config: {},
      tenantId: TENANT,
      deletedAt: null,
    },
    mcqOptions: { options: [] },
    answerConfig: null,
    difficultyId: null,
    subjectId: 'phy',
    chapterId: 'mech',
    topicId: 'kin',
    subtopicId: null,
    explanation: null,
    mediaUrl: null,
    groupId: null,
    status: 'DRAFT',
    currentVersion: 1,
  };

  let captured = null;
  const tx = {
    questionVersion: { create: async () => ({}) },
    question: {
      update: async ({ data }) => {
        captured = data;
        return { ...EXISTING, currentVersion: 2 };
      },
    },
  };

  const prisma = {
    question: {
      findFirst: async () => EXISTING,
      findMany: async () => [],
    },
    taxonomy: {
      findMany: async ({ where }) =>
        (where.id.in || []).map((id) => TREE[id]).filter(Boolean),
      findFirst: async ({ where }) => TREE[where.id] || null,
    },
    questionTypeDef: { findFirst: async () => EXISTING.typeDef },
    $transaction: async (fn) => fn(tx),
  };

  const validation = {
    validateAnswer: () => ({ mcqOptions: { options: [] }, answerConfig: null }),
    validateCustomFields: () => ({}),
  };

  const svc = new BankQuestionsService(prisma, validation);
  // toEntity() runs after the write and needs the full DETAIL_INCLUDE relation
  // graph, which is well past what these tests care about. The write has
  // already happened by then, so a failure there is irrelevant -- the assertion
  // is on `captured`, and a null `captured` means the write never ran at all.
  try {
    await svc.update('q1', input, 'user-1', TENANT);
  } catch {
    /* ignore -- see above */
  }
  return captured || {};
}

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) failures++;
};

(async () => {
  // --- 1. Whole valid chains, at every depth ---
  check('no taxonomy at all is accepted', (await attempt({})) === null);
  check(
    'subject only is accepted',
    (await attempt({ subjectId: 'phy' })) === null,
  );
  check(
    'subject + chapter is accepted',
    (await attempt({ subjectId: 'phy', chapterId: 'mech' })) === null,
  );
  check(
    'subject + chapter + topic is accepted',
    (await attempt({ subjectId: 'phy', chapterId: 'mech', topicId: 'kin' })) ===
      null,
  );
  check(
    'full four-level chain is accepted',
    (await attempt({
      subjectId: 'phy',
      chapterId: 'mech',
      topicId: 'kin',
      subtopicId: 'proj',
    })) === null,
  );

  // --- 2. Gapped chains. These are the regression: the old pairwise check
  // compared adjacent levels only, so a blank level in the middle meant the
  // levels either side were never compared to each other at all. ---
  let msg = await attempt({ subjectId: 'phy', topicId: 'kin' });
  check('subject + topic with no chapter is accepted when it really lines up',
    msg === null, String(msg));

  msg = await attempt({ subjectId: 'chem', topicId: 'kin' });
  check(
    'REGRESSION: Chemistry + a Physics topic (no chapter) is rejected',
    msg !== null && /does not sit under/.test(msg),
    String(msg),
  );

  msg = await attempt({ subjectId: 'phy', subtopicId: 'proj' });
  check('subject + subtopic, two levels skipped, lines up',
    msg === null, String(msg));

  msg = await attempt({ subjectId: 'chem', subtopicId: 'proj' });
  check(
    'REGRESSION: Chemistry + a Physics subtopic is rejected',
    msg !== null && /does not sit under/.test(msg),
    String(msg),
  );

  msg = await attempt({ chapterId: 'mech', subtopicId: 'proj' });
  check('chapter + subtopic with no topic lines up', msg === null, String(msg));

  msg = await attempt({ chapterId: 'org', subtopicId: 'proj' });
  check(
    'REGRESSION: an Organic chapter with a Projectiles subtopic is rejected',
    msg !== null && /does not sit under/.test(msg),
    String(msg),
  );

  // --- 3. Adjacent mismatches, which the old check did catch ---
  msg = await attempt({ subjectId: 'phy', chapterId: 'org' });
  check(
    'Physics + an Organic chapter is rejected',
    msg !== null && /does not sit under/.test(msg),
    String(msg),
  );
  msg = await attempt({ chapterId: 'mech', topicId: 'alk' });
  check(
    'Mechanics + an Alkanes topic is rejected',
    msg !== null && /does not sit under/.test(msg),
    String(msg),
  );

  // --- 4. Right id, wrong slot. A chapter id passed as topicId used to be
  // filed one level off in silence. ---
  msg = await attempt({ subjectId: 'phy', topicId: 'mech' });
  check(
    'a chapter id handed in as topicId is rejected',
    msg !== null && /is a chapter, not a topic/.test(msg),
    String(msg),
  );
  msg = await attempt({ subtopicId: 'kin' });
  check(
    'a topic id handed in as subtopicId is rejected',
    msg !== null && /is a topic, not a subtopic/.test(msg),
    String(msg),
  );

  // --- 5. Unknown ids ---
  msg = await attempt({ subjectId: 'nope' });
  check(
    'an id that does not exist in the tenant is rejected',
    msg !== null && /Taxonomy not found/.test(msg),
    String(msg),
  );

  // --- 6. What update() actually writes ---
  //
  // assertTaxonomyCoherent validates subtopicId on update, but the write block
  // did not include it -- so re-filing a question to a different subtopic was
  // accepted and then silently discarded. These capture the data handed to
  // Prisma rather than the return value, because the bug was invisible from
  // outside: update() resolved happily, it just wrote nothing.
  const written = await captureUpdate({ subtopicId: 'proj' });
  check(
    'REGRESSION: update writes subtopicId',
    written.subtopicId === 'proj',
    JSON.stringify(written),
  );

  const marksWritten = await captureUpdate({ marks: 4 });
  check('update writes marks', marksWritten.marks === 4);

  const untouched = await captureUpdate({ explanation: 'why' });
  check(
    'a field not supplied is left out of the write entirely',
    !('subtopicId' in untouched) && !('marks' in untouched),
    JSON.stringify(untouched),
  );

  console.log(
    failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();
