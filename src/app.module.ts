import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver } from '@nestjs/apollo';
import { ThrottlerModule } from '@nestjs/throttler';
import GraphQLJSON from 'graphql-type-json';
import { join } from 'path';

import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { QuestionBankModule } from './modules/question-bank/question-bank.module';
import { QuestionImportModule } from './modules/question-bank/import/question-import.module';
import { TestsModule } from './modules/tests/tests.module';
import { GqlThrottlerGuard } from './common/guards/gql-throttler.guard';
import { GqlAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';

const getPositiveNumberConfig = (
  config: ConfigService,
  key: string,
  fallback: number,
) => {
  const parsed = Number(config.get(key));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          name: 'default',
          ttl: getPositiveNumberConfig(config, 'RATE_LIMIT_TTL_MS', 60_000),
          limit: getPositiveNumberConfig(config, 'RATE_LIMIT_MAX', 120),
          blockDuration: getPositiveNumberConfig(
            config,
            'RATE_LIMIT_BLOCK_MS',
            60_000,
          ),
        },
      ],
    }),
    PrismaModule,
    AuthModule,
    GraphQLModule.forRoot({
      driver: ApolloDriver,
      autoSchemaFile:
        process.env.NODE_ENV === 'production' || process.env.DOCKER === 'true'
          ? true
          : join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      buildSchemaOptions: {
        scalarsMap: [{ type: () => GraphQLJSON, scalar: GraphQLJSON }],
      },
      fieldResolverEnhancers: ['guards', 'interceptors', 'filters'],
      playground: {
        settings: { 'request.credentials': 'include' },
      },
      context: ({ req, res }) => ({ req, res }),
    }),
    QuestionBankModule,
    QuestionImportModule,
    TestsModule,
  ],
  providers: [
    // Order matters: global guards run in this order. Authentication must have
    // set req.user before PermissionsGuard reads it.
    //
    // PermissionsGuard is global here on purpose. In the main backend it is not,
    // and the question-bank resolvers only apply GqlAuthGuard -- so their
    // @RequirePermissions decorators are never checked and any signed-in user,
    // students included, can reach the answer key. Here every
    // @RequirePermissions is enforced.
    { provide: APP_GUARD, useClass: GqlThrottlerGuard },
    { provide: APP_GUARD, useClass: GqlAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
