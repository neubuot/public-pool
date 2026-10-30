import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import * as bitcoinjs from 'bitcoinjs-lib';
import { useContainer } from 'class-validator';
import { readFileSync } from 'fs';
import * as ecc from 'tiny-secp256k1';

import { AppModule } from './app.module';
import { RateLimiter, registerRateLimits } from './utils/rate-limit';

async function bootstrap() {

  if (process.env.API_PORT == null) {
    console.error('It appears your environment is not configured, create and populate an .env file.');
    return;
  }

  let options = {};
  const secure = process.env.API_SECURE?.toLowerCase() == 'true';
  if (secure) {
    const currentDirectory = process.cwd();
    options = {
      https: {
        key: readFileSync(`${currentDirectory}/secrets/key.pem`),
        cert: readFileSync(`${currentDirectory}/secrets/cert.pem`),
      }
    };
  }

  // behind the Caddy reverse proxy (TRUST_PROXY=true) the client address comes from X-Forwarded-For
  const trustProxy = process.env.TRUST_PROXY?.toLowerCase() === 'true';
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ ...options, trustProxy }));
  app.setGlobalPrefix('api')

  // public, unauthenticated endpoints that cost node or mempool.space calls: per client address and minute
  registerRateLimits(app.getHttpAdapter().getInstance(), [
    { prefix: '/api/explorer/', limiter: new RateLimiter(90, 1.5), expensive: [{ contains: '/address/', cost: 6 }, { contains: '/btc/', cost: 2 }] },
    { prefix: '/api/share/', limiter: new RateLimiter(30, 0.5) },
    { prefix: '/api/s/', limiter: new RateLimiter(30, 0.5) },
    { prefix: '/api/validate/', limiter: new RateLimiter(60, 1) },
    { prefix: '/api/miner/', limiter: new RateLimiter(120, 2) },
  ]);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      //forbidNonWhitelisted: true,
      //forbidUnknownValues: true
    }),
  );

  process.on('SIGINT', () => {
    console.log(`Stopping services`);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log(`Stopping services`);
    process.exit(0);
  });

  app.enableCors();
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  //Taproot
  bitcoinjs.initEccLib(ecc);

  await app.listen(process.env.API_PORT, '0.0.0.0', (err, address) => {
    console.log(`API listening on ${address}`);
  });

}

bootstrap();
