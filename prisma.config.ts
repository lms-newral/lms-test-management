import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  engine: 'classic',
  datasource: {
    url: env('DATABASE_URL'),
    // Neon: DATABASE_URL is the pooled string the app uses; migrations need the
    // direct (non-pooled) one here. Other hosts can set both to the same URL.
    directUrl: env('DIRECT_URL'),
  },
});
