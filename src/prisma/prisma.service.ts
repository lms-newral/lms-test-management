import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log: ['warn', 'error'],
    });
  }

  async onModuleInit() {
    const maxRetries = 10;
    const retryDelay = 3000; // 3 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.log(
          `Connecting to database... (Attempt ${attempt}/${maxRetries})`,
        );
        await this.$connect();
        this.logger.log('✅ Successfully connected to database');
        return;
      } catch (error) {
        if (attempt === maxRetries) {
          this.logger.error(
            '❌ Failed to connect to database after maximum retries',
          );
          throw error;
        }
        this.logger.warn(
          `Connection attempt ${attempt} failed. Retrying in ${retryDelay / 1000}s... (Database may be waking up)`,
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
