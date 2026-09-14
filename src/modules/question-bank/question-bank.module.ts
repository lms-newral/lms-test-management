import { Module } from '@nestjs/common';
import { QuestionBankResolver } from './question-bank.resolver';
import { TaxonomyService } from './taxonomy/taxonomy.service';
import { QuestionTypesService } from './config/question-types.service';
import { DifficultyService } from './config/difficulty.service';
import { BankQuestionsService } from './questions/bank-questions.service';
import { SolutionsService } from './solutions/solutions.service';
import { QuestionValidationService } from './validation/question-validation.service';
import { BankDefaultsService } from './bank-defaults.service';

// PrismaModule is @Global, so it is not imported here.
@Module({
  providers: [
    QuestionBankResolver,
    TaxonomyService,
    QuestionTypesService,
    DifficultyService,
    BankQuestionsService,
    SolutionsService,
    QuestionValidationService,
    BankDefaultsService,
  ],
  exports: [BankQuestionsService, TaxonomyService, QuestionValidationService, BankDefaultsService],
})
export class QuestionBankModule {}
