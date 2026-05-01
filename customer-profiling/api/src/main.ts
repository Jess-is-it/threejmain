import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { API_BASE_PATH, MODULE_NAME, MODULE_VERSION, WEB_BASE_PATH } from './config/constants';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.use(new CorrelationIdMiddleware().use);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const normalizedApiBasePath = API_BASE_PATH.replace(/^\/+/, '');
  app.setGlobalPrefix(normalizedApiBasePath);

  const config = new DocumentBuilder()
    .setTitle('THREE3J Customer Profiling API')
    .setDescription('Customer identity, profile and service assignment module.')
    .setVersion(MODULE_VERSION)
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`${normalizedApiBasePath}/docs`, app, document, {
    jsonDocumentUrl: `/${normalizedApiBasePath}/docs-json`,
    swaggerOptions: { persistAuthorization: true },
  });

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      level: 'info',
      module: MODULE_NAME,
      version: MODULE_VERSION,
      webBasePath: WEB_BASE_PATH,
      apiBasePath: API_BASE_PATH,
      message: `API listening on ${port}`,
    }),
  );
}

void bootstrap();
