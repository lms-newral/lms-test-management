import { Module } from '@nestjs/common';
import { S3Service } from 'src/common/services/s3.service';
import { QuestionBankModule } from '../question-bank/question-bank.module';
import { TestFormatsService } from './test-formats.service';
import { TestFormatsResolver } from './test-formats.resolver';
import { TestsService } from './tests.service';
import { TestsResolver } from './tests.resolver';
import { TestSeriesService } from './test-series.service';
import { TestSeriesResolver } from './test-series.resolver';

// PrismaModule and AuthModule are @Global, so they are not imported here.
@Module({
  imports: [QuestionBankModule],
  providers: [
    TestFormatsService,
    TestFormatsResolver,
    TestsService,
    TestsResolver,
    TestSeriesService,
    TestSeriesResolver,
    S3Service,
  ],
})
export class TestsModule {}
