import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Catch, HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { openDatabase } from './database.mjs';
import { createMovieTrackService, HttpError } from './movietrack.service.mjs';
import { createControllers } from './movietrack.controller.mjs';

const env = process.env;
if (Buffer.byteLength(env.JWT_SECRET ?? '') < 32) throw new Error('Set JWT_SECRET to at least 32 bytes.');
const database = await openDatabase(env);

class ApiExceptionFilter {
  catch(error, host) {
    const response = host.switchToHttp().getResponse();
    let status = 500;
    let message = 'An unexpected server error occurred.';
    if (error instanceof HttpError) {
      ({ status, message } = error);
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      if (status < 500) message = error.message;
    } else {
      const code = error.driverError?.code ?? error.code;
      if (['ER_DUP_ENTRY', 'ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(code)) {
        status = 409;
        message = code === 'ER_DUP_ENTRY' ? 'This record already exists.' : 'A related record prevents this change.';
      } else {
        console.error(JSON.stringify({
          requestId: response.getHeader('X-Request-Id'), errorType: error.name, errorCode: code ?? null
        }));
      }
    }
    if (status === 401) response.setHeader('WWW-Authenticate', 'Bearer');
    response.status(status).json({ success: false, statusCode: status, message, errors: [message], timestamp: new Date().toISOString() });
  }
}
Catch()(ApiExceptionFilter);

try {
  const service = await createMovieTrackService(database, env);
  const featureModules = createControllers(service.routes).map(controller => {
    class ResourceModule {}
    Object.defineProperty(ResourceModule, 'name', {
      value: controller.name.replace(/Controller$/, 'Module')
    });
    Module({ controllers: [controller] })(ResourceModule);
    return ResourceModule;
  });
  class MovieTrackModule {
    onApplicationShutdown() {
      return database.close();
    }
  }
  Module({ imports: featureModules })(MovieTrackModule);
  const app = await NestFactory.create(MovieTrackModule, { bodyParser: false, abortOnError: false });
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');
  app.use((req, res, next) => {
    const started = performance.now();
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.vary('Origin');
    res.once('finish', () => console.log(JSON.stringify({
      requestId, method: req.method, route: req.route?.path ?? null,
      status: res.statusCode, userId: req.user?.userId ?? null,
      durationMs: Math.round(performance.now() - started)
    })));
    next();
  });
  if (env.FRONTEND_ORIGIN) {
    app.enableCors({
      origin: env.FRONTEND_ORIGIN, allowedHeaders: ['Authorization', 'Content-Type'],
      exposedHeaders: ['X-Request-Id', 'Retry-After', 'Content-Disposition', 'Location']
    });
  }
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalGuards({
    async canActivate(context) {
      const access = Reflect.getMetadata('movietrack:access', context.getHandler());
      if (access === 'Public') return true;
      const req = context.switchToHttp().getRequest();
      req.user = await service.authenticate(req);
      if (access === 'Authenticated' || (access === 'Admin' && req.user.role === 'Admin')) return true;
      throw new HttpError(403, 'Access denied.');
    }
  });
  const httpServer = app.getHttpServer();
  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 10_000;
  await app.listen(Number(env.PORT ?? 3000), env.HOST ?? '127.0.0.1');
  console.log('MovieTrack API listening at ' + await app.getUrl());
} catch (error) {
  await database.close();
  throw error;
}
