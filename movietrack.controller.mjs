import {
  Controller, Delete, Get, HttpCode, Patch, Post, Put, Req, Res
} from '@nestjs/common';
import { HttpError } from './movietrack.service.mjs';

const methods = { GET: Get, POST: Post, PUT: Put, PATCH: Patch, DELETE: Delete };
const controllerNames = {
  auth: 'AuthController', users: 'UsersController', movies: 'MoviesController',
  genres: 'GenresController', 'movie-genres': 'MovieGenresController', reports: 'ReportsController'
};

export function createControllers(routes) {
  return Object.entries(controllerNames).map(([resource, name]) => {
    class ResourceController {}
    Object.defineProperty(ResourceController, 'name', { value: name });
    Controller(resource)(ResourceController);
    const prototype = ResourceController.prototype;
    for (const route of routes.filter(entry => entry.path.split('/')[1] === resource)) {
      const path = route.path.split('/').slice(2).join('/');
      const action = route.method.toLowerCase() + (path === ':id' ? 'ById' : path ? '_' + path : '');
      Object.defineProperty(prototype, action, {
        value(req, res) {
          const rawId = req.params.id;
          const id = rawId === undefined ? undefined : Number(rawId);
          if (rawId !== undefined && (!/^\d+$/.test(rawId) || !Number.isSafeInteger(id) || id < 1)) {
            throw new HttpError(400, 'id must be a positive integer.');
          }
          const query = new URL(req.originalUrl, 'http://localhost').searchParams;
          return route.handler({ req, res, query, id, user: req.user });
        }
      });
      const descriptor = Object.getOwnPropertyDescriptor(prototype, action);
      methods[route.method](path)(prototype, action, descriptor);
      HttpCode(route.status)(prototype, action, descriptor);
      Req()(prototype, action, 0);
      Res({ passthrough: true })(prototype, action, 1);
      Reflect.defineMetadata('movietrack:access', route.access, descriptor.value);
    }
    return ResourceController;
  });
}
