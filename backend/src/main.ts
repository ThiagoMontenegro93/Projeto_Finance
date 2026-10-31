import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';

export function configure(app: NestExpressApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: true, transformOptions: { enableImplicitConversion: true } }));
  app.useGlobalFilters(new PrismaExceptionFilter());
  app.enableCors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true });
  return app;
}

async function bootstrap() {
  const app = configure(await NestFactory.create<NestExpressApplication>(AppModule));
  // Serve o painel web compilado (web/dist) no mesmo servidor
  const web = process.env.WEB_DIST ?? join(__dirname, '..', '..', 'web', 'dist');
  if (existsSync(web)) {
    app.useStaticAssets(web);
    app.use((req: any, res: any, next: any) =>
      req.method === 'GET' && !req.path.startsWith('/api') ? res.sendFile(join(web, 'index.html')) : next(),
    );
  }
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`LendControl API em http://localhost:${port}/api`);
}

if (require.main === module) bootstrap();
