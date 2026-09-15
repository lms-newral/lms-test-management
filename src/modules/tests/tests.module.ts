import { Module } from '@nestjs/common';
import { S3Service } from 'src/common/services/s3.service';
import { QuestionBankModule } from '../question-bank/question-bank.module';
import { TestFormatsService } from './test-formats.service';
import { TestFormatsResolver } from './test-formats.resolver';
import { TestsService } from './tests.service';
import { TestsResolver } from './tests.resolver';
import { TestSeriesService } from './test-series.service';
import { TestSeriesResolver } from './test-series.resolver';
import { StudentTestSeriesService } from './student-test-series.service';
import { StudentTestSeriesResolver } from './student-test-series.resolver';
import { InternalTestSeriesController } from './internal-test-series.controller';

// PrismaModule and AuthModule are @Global, so they are not imported here.
@Module({
  imports: [QuestionBankModule],
  controllers: [InternalTestSeriesController],
  providers: [
    TestFormatsService,
    TestFormatsResolver,
    TestsService,
    TestsResolver,
    TestSeriesService,
    TestSeriesResolver,
    StudentTestSeriesService,
    StudentTestSeriesResolver,
    S3Service,
  ],
})
export class TestsModule {}
