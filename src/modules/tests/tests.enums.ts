import { registerEnumType } from '@nestjs/graphql';
import {
  TestFormatStatus,
  TestSeriesNodeKind,
  TestSeriesStatus,
  TestStatus,
} from '@prisma/client';

export { TestFormatStatus, TestSeriesNodeKind, TestSeriesStatus, TestStatus };

registerEnumType(TestFormatStatus, {
  name: 'TestFormatStatus',
  description:
    'DRAFT can be saved incomplete and cannot build tests. ACTIVE builds tests. ' +
    'ARCHIVED is hidden from new tests. A format used by any test is locked.',
});

registerEnumType(TestStatus, {
  name: 'TestStatus',
  description:
    'DRAFT is editable. PUBLISHED freezes its questions. ARCHIVED is retired.',
});

registerEnumType(TestSeriesStatus, {
  name: 'TestSeriesStatus',
  description:
    'DRAFT is being built. PUBLISHED is visible to students inside its window. ' +
    'UNPUBLISHED was published and is hidden again.',
});

registerEnumType(TestSeriesNodeKind, { name: 'TestSeriesNodeKind' });
