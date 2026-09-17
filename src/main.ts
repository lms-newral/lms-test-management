import 'dotenv/config';
import dns from 'dns';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { AppModule } from './app.module';

// Force IPv4 first to avoid IPv6 connection issues with external APIs
dns.setDefaultResultOrder('ipv4first');

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 1);

  app
    .getHttpAdapter()
    .getInstance()
    .set(
      'trust proxy',
      Number.isFinite(trustProxyHops) && trustProxyHops > 0
        ? trustProxyHops
        : 1,
    );

  // 🔥 Extremely early health check bypassing all NestJS middlewares and guards
  const expressApp = app.getHttpAdapter().getInstance() as express.Express;

  expressApp.get(['/health', '/healthz'], (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'synappses-test',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development',
    });
  });

  // 🔥 Cashfree webhook raw body
  // MUST be before other JSON middlewares if this service handles
  // /subscriptions/webhook/cashfree
  app.use(
    '/subscriptions/webhook/cashfree',
    express.json({
      verify: (req: any, res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // ✅ Normal JSON parser for all other routes
  app.use(express.json());
  app.use(cookieParser());

  const isProduction = process.env.NODE_ENV === 'production';

  app.enableCors({
    origin: isProduction
      ? [
          // Student domains
          /^https:\/\/.*\.upscaledu\.in$/,

          // Admin domains
          /^https:\/\/.*\.upscaledu-admin\.in$/,

          // Root domains
          'https://upscaledu.in',
          'https://upscaledu-admin.in',

          // Shatayuveda
          'https://shatayuveda.com',
          'https://api.shatayuveda.com',
          /^https:\/\/.*\.shatayuveda\.com$/,

          // API domains
          'https://api.upscaledu.in',
          'https://api.upscaledu-admin.in',

          // Local development
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:4000',
          'http://localhost:5173',
          'http://localhost:5174',
          'http://localhost:5175',
          'http://localhost:5176',

          // Axinom
          'https://tools.axinom.com',

          // Gole Computers
          'https://www.golecomputers.in',
          'https://golecomputers.in',

          // Synappses
          'https://synappses.in',
          'https://synappses.live',
          'https://bizz.social',
          'https://api.synappses.in',
          'https://api.synappses.live',
          'https://api.bizz.social',
          /^https:\/\/.*\.synappses\.in$/,
          /^https:\/\/.*\.synappses\.live$/,
          /^https:\/\/.*\.bizz\.social$/,

          // Synappses Admin
          'https://admin-synappses.in',
          'https://api.admin-synappses.in',
          /^https:\/\/.*\.admin-synappses\.in$/,

          // Synappses CMS
          'https://cms-synappses.in',
          'https://api.cms-synappses.in',
          /^https:\/\/.*\.cms-synappses\.in$/,

          // Kishori Heals
          'https://kishori-heals.com',
          'https://api.kishori-heals.com',
          /^https:\/\/.*\.kishori-heals\.com$/,

          // NeoTrack
          'https://neotrack.shop',
          'https://api.neotrack.shop',
          /^https:\/\/.*\.neotrack\.shop$/,
        ]
      : [
          // Allow any localhost port during development
          /^http:\/\/localhost:\d+$/,

          // Axinom
          'https://tools.axinom.com',
        ],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false,
      transform: true,
      forbidNonWhitelisted: false,
      skipMissingProperties: true,
    }),
  );

  const port = process.env.PORT || 5757;

  await app.listen(port);

  console.log(
    `synappses-test listening on http://localhost:${port}/graphql`,
  );
}

void bootstrap();