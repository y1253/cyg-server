import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { MulterExceptionFilter } from './communications/multer-exception.filter.js';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));

  // Only catches MulterError; everything else keeps Nest's default handling.
  app.useGlobalFilters(new MulterExceptionFilter());

  await app.listen(process.env.PORT ?? 3000);
  console.log('Server running on http://localhost:3000');
}
bootstrap();
