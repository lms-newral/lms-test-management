import { registerEnumType } from '@nestjs/graphql';
import {
  AnswerKernel,
  FieldRole,
  FieldType,
  QuestionStatus,
  SolutionKind,
  SolutionVisibility,
  TaxonomyKind,
  UsageType,
  VideoProvider,
} from '@prisma/client';

// Re-exported so the rest of the module imports its enums from one place rather
// than reaching into @prisma/client everywhere.
export {
  AnswerKernel,
  FieldRole,
  FieldType,
  QuestionStatus,
  SolutionKind,
  SolutionVisibility,
  TaxonomyKind,
  UsageType,
  VideoProvider,
};

registerEnumType(TaxonomyKind, {
  name: 'TaxonomyKind',
  description: 'Level in the subject tree.',
});

registerEnumType(AnswerKernel, {
  name: 'AnswerKernel',
  description:
    'How the system stores, grades and renders an answer. Fixed set: admins ' +
    'create unlimited question types on top of these, so a new label costs ' +
    'nothing while a genuinely new behaviour needs a grader and a widget.',
});

registerEnumType(FieldType, { name: 'FieldType' });

registerEnumType(FieldRole, {
  name: 'FieldRole',
  description:
    'Gives an admin-defined field a meaning the system understands, so ' +
    'blueprint generation can ask for "10 Easy" without difficulty being a ' +
    'hardcoded column. At most one active field per tenant may hold each role.',
});

registerEnumType(QuestionStatus, { name: 'QuestionStatus' });
registerEnumType(UsageType, { name: 'UsageType' });
registerEnumType(SolutionKind, { name: 'SolutionKind' });

registerEnumType(SolutionVisibility, {
  name: 'SolutionVisibility',
  description:
    'When a solution may be revealed. A security control, not a preference: ' +
    'without it a student sitting a live test can fetch the answer.',
});

registerEnumType(VideoProvider, { name: 'VideoProvider' });
