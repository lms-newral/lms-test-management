import 'dotenv/config';
import dns from 'dns';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import { AppModule } from './app.module';

dns.setDefaultResultOrder('ipv4first');

/**
 * Origins allowed to call this service with credentials.
 *
 * Production reads CORS_ORIGINS (comma-separated; an entry starting with ^ is a
 * regular expression) rather than repeating the main backend's hardcoded list.
 * Locally any localhost port is allowed, as in the main backend.
 */
function corsOrigins(): (string | RegExp)[] {
  if (process.env.NODE_ENV !== 'production') {
    return [/^http:\/\/localhost:\d+$/];
  }
  return (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => (o.startsWith('^') ? new RegExp(o) : o));
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const expressApp = app.getHttpAdapter().getInstance() as express.Express;

  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 1);
  expressApp.set(
    'trust proxy',
    Number.isFinite(trustProxyHops) && trustProxyHops > 0 ? trustProxyHops : 1,
  );

  // Before every Nest middleware and guard, so a health probe never needs a
  // session or a database.
  expressApp.get(['/health', '/healthz'], (_req, res) => {
    res.status(200).json({
      status: 'ok',
      service: 'synappses-test',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  app.use(express.json());
  app.use(cookieParser());
  app.enableCors({ origin: corsOrigins(), credentials: true });
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
  console.log(`synappses-test listening on http://localhost:${port}/graphql`);
}

void bootstrap();
