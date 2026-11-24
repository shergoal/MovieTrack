import { randomBytes } from 'node:crypto';
import { hashPassword, verifyPassword, jwt } from './auth.mjs';
import { movieReportCsv } from './reports.mjs';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new HttpError(status, message);
}

const roles = ['Admin', 'Staff'];
const statuses = ['Showing', 'Upcoming', 'Archived'];
const prefix = '/api/v1';
export async function createMovieTrackService(database, env) {
  const tokens = jwt(env.JWT_SECRET);
  const { one, all, run, repository } = database;
  const publicUserFields = 'userId, fullName, email, role';

  function text(value, field, max, min = 1) {
    if (typeof value !== 'string' || value.length > max || value.trim().length < min) {
      fail(400, field + ' must contain ' + min + ' to ' + max + ' characters.');
    }
    return value.trim();
  }

  function email(value) {
    const address = text(value, 'email', 150).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) fail(400, 'Enter a valid email.');
    return address;
  }

  function password(value, min = 12) {
    if (typeof value !== 'string' || value.length < min || value.length > 128) {
      fail(400, 'Password must contain ' + min + ' to 128 characters.');
    }
    return value;
  }

  function choice(value, field, allowed) {
    if (!allowed.includes(value)) fail(400, field + ' must be one of ' + allowed.join(', ') + '.');
    return value;
  }

  function integer(value, field, max = Number.MAX_SAFE_INTEGER) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) {
      fail(400, field + ' must be a positive integer up to ' + max + '.');
    }
    return value;
  }

  function queryInteger(value, field, max) {
    if (!/^\d+$/.test(value)) fail(400, field + ' must be a positive integer.');
    return integer(Number(value), field, max);
  }

  function validate(body, fields, { partial = false, defaults = {} } = {}) {
    const keys = Object.keys(body);
    if (!keys.length || keys.some(key => !Object.hasOwn(fields, key))) {
      fail(400, 'Supply only the supported fields for this request.');
    }
    const values = {};
    for (const [key, check] of Object.entries(fields)) {
      if (Object.hasOwn(body, key)) values[key] = check(body[key]);
      else if (!partial) {
        if (!Object.hasOwn(defaults, key)) fail(400, key + ' is required.');
        values[key] = defaults[key];
      }
    }
    return values;
  }

  async function jsonBody(req) {
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      fail(415, 'Use Content-Type application/json.');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 32_768) {
        req.resume();
        fail(413, 'Request body exceeds 32 KiB.');
      }
      chunks.push(chunk);
    }
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      fail(400, 'Request body must contain valid JSON.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Expected a JSON object.');
    return body;
  }

  async function find(table, idField, id, fields = '*') {
    const repo = repository(table);
    const options = { where: { [idField]: id } };
    if (fields !== '*') options.select = fields.split(', ');
    const record = await repo.findOne(options);
    if (!record) fail(404, 'Record not found.');
    return record;
  }

  async function insert(table, values) {
    const result = await repository(table).insert(values);
    return Number(Object.values(result.identifiers[0])[0]);
  }

  async function update(table, idField, id, values) {
    await repository(table).update({ [idField]: id }, values);
  }

  function list(table, idField, query, { filters = [], fields = '*', sortFields = [idField] } = {}) {
    const conditions = [];
    const values = [];
    for (const [key, sql, parse] of filters) {
      if (query.has(key)) {
        conditions.push(sql);
        values.push(parse(query.get(key)));
      }
    }
    const sort = choice(query.get('sort') ?? idField, 'sort', sortFields);
    const order = choice(query.get('order') ?? 'asc', 'order', ['asc', 'desc']);
    const page = queryInteger(query.get('page') ?? '1', 'page', 1_000_000);
    const limit = queryInteger(query.get('limit') ?? '25', 'limit', 100);
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    return all(`SELECT ${fields} FROM ${table} ${where} ORDER BY ${sort} ${order}, ${idField} LIMIT ? OFFSET ?`,
      ...values, limit, (page - 1) * limit);
  }

  const fullName = value => text(value, 'fullName', 100);
  const userFields = { fullName, email, role: value => choice(value, 'role', roles), password };
  const movieFields = {
    title: value => text(value, 'title', 150),
    durationMinutes: value => integer(value, 'durationMinutes', 2_147_483_647),
    ageRating: value => text(value, 'ageRating', 20),
    status: value => choice(value, 'status', statuses),
    posterPath: value => value === null ? null : text(value, 'posterPath', 255)
  };
  const genreFields = { genreName: value => text(value, 'genreName', 50) };
  const reportFields = { reportName: value => text(value, 'reportName', 100) };

  if (!await one("SELECT 1 FROM Users WHERE role = 'Admin'")) {
    const admin = {
      fullName: fullName(env.ADMIN_NAME ?? 'MovieTrack Admin'),
      email: email(env.ADMIN_EMAIL),
      passwordHash: await hashPassword(password(env.ADMIN_PASSWORD)),
      role: 'Admin'
    };
    await run(`INSERT INTO Users (fullName, email, passwordHash, role)
      SELECT ?, ?, ?, ? FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM Users WHERE role = 'Admin')`,
      ...Object.values(admin));
  }

  const routes = [];
  function route(method, path, access, handler, status = 200) {
    if (!['Public', 'Authenticated', 'Admin'].includes(access)) {
      throw new Error('Invalid access policy for ' + method + ' ' + path);
    }
    routes.push({ method, path, access, handler, status });
  }

  const loginAttempts = new Map();
  const windowMs = 15 * 60 * 1000;
  setInterval(() => {
    for (const [ip, attempt] of loginAttempts) {
      if (attempt.until <= Date.now()) loginAttempts.delete(ip);
    }
  }, 60_000).unref();
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));

  route('POST', '/auth/login', 'Public', async ({ req, res }) => {
    const ip = req.socket.remoteAddress;
    let attempt = loginAttempts.get(ip);
    if (!attempt || attempt.until <= Date.now()) {
      attempt = { count: 0, until: Date.now() + windowMs };
      loginAttempts.set(ip, attempt);
    }
    if (attempt.count >= 10) {
      res.setHeader('Retry-After', Math.ceil((attempt.until - Date.now()) / 1000));
      fail(429, 'Too many login attempts. Try again later.');
    }
    attempt.count++;
    const credentials = validate(await jsonBody(req), { email, password: value => password(value, 1) });
    const user = await repository('Users').findOne({ where: { email: credentials.email }, select: ['userId', 'fullName', 'email', 'role', 'passwordHash', 'authVersion'] });
    const valid = await verifyPassword(credentials.password, user?.passwordHash ?? dummyHash);
    if (!valid || !user) fail(401, 'Invalid email or password.');
    if (loginAttempts.get(ip) === attempt) loginAttempts.delete(ip);
    return { ...tokens.issue(user), tokenType: 'Bearer',
      user: { userId: user.userId, fullName: user.fullName, email: user.email, role: user.role } };
  });

  route('GET', '/auth/me', 'Authenticated', ({ user }) => find('Users', 'userId', user.userId, publicUserFields));
  route('POST', '/auth/logout', 'Authenticated', async ({ user }) => {
    await run('UPDATE Users SET authVersion = authVersion + 1 WHERE userId = ?', user.userId);
  }, 204);

  route('GET', '/users', 'Admin', ({ query }) => list('Users', 'userId', query, {
    fields: publicUserFields,
    filters: [['role', 'role = ?', value => choice(value, 'role', roles)]],
    sortFields: ['userId', 'fullName', 'email', 'role']
  }));
  route('GET', '/users/:id', 'Admin', ({ id }) => find('Users', 'userId', id, publicUserFields));
  route('POST', '/users', 'Admin', async ({ req, res }) => {
    const { password: rawPassword, ...values } = validate(await jsonBody(req), userFields);
    const id = await insert('Users', { ...values, passwordHash: await hashPassword(rawPassword) });
    res.setHeader('Location', prefix + '/users/' + id);
    return find('Users', 'userId', id, publicUserFields);
  }, 201);
  route('PATCH', '/users/:id', 'Admin', async ({ req, id, user }) => {
    const { password: rawPassword, ...values } = validate(await jsonBody(req), userFields, { partial: true });
    if (rawPassword !== undefined) values.passwordHash = await hashPassword(rawPassword);
    const current = await find('Users', 'userId', id);
    if (id === user.userId && values.role === 'Staff') fail(409, 'You cannot remove your own Admin role.');
    if (rawPassword !== undefined || (values.role && values.role !== current.role)) {
      values.authVersion = () => 'authVersion + 1';
    }
    await update('Users', 'userId', id, values);
    return find('Users', 'userId', id, publicUserFields);
  });
  route('DELETE', '/users/:id', 'Admin', async ({ id, user }) => {
    if (id === user.userId) fail(409, 'You cannot delete your own account.');
    await find('Users', 'userId', id);
    await run('DELETE FROM Users WHERE userId = ?', id);
  }, 204);

  route('GET', '/movies', 'Authenticated', ({ query }) => list('Movies', 'movieId', query, {
    filters: [
      ['status', 'status = ?', movieFields.status],
      ['genreId', 'movieId IN (SELECT movieId FROM MovieGenres WHERE genreId = ?)',
        value => queryInteger(value, 'genreId')],
      ['title', 'instr(lower(title), lower(?)) > 0', movieFields.title]
    ],
    sortFields: ['movieId', 'title', 'durationMinutes', 'status']
  }));
  route('GET', '/movies/:id', 'Authenticated', ({ id }) => find('Movies', 'movieId', id));
  route('POST', '/movies', 'Authenticated', async ({ req, res, user }) => {
    const values = validate(await jsonBody(req), movieFields, { defaults: { posterPath: null } });
    const id = await insert('Movies', { ...values, createdByUserId: user.userId });
    res.setHeader('Location', prefix + '/movies/' + id);
    return find('Movies', 'movieId', id);
  }, 201);
  for (const method of ['PUT', 'PATCH']) {
    route(method, '/movies/:id', 'Authenticated', async ({ req, id }) => {
      const values = validate(await jsonBody(req), movieFields, {
        partial: method === 'PATCH',
        defaults: { posterPath: null }
      });
      await find('Movies', 'movieId', id);
      await update('Movies', 'movieId', id, values);
      return find('Movies', 'movieId', id);
    });
  }
  route('DELETE', '/movies/:id', 'Admin', async ({ id }) => {
    await find('Movies', 'movieId', id);
    await run('DELETE FROM Movies WHERE movieId = ?', id);
  }, 204);

  route('GET', '/genres', 'Authenticated', ({ query }) => list('Genres', 'genreId', query, {
    sortFields: ['genreId', 'genreName']
  }));
  route('GET', '/genres/:id', 'Authenticated', ({ id }) => find('Genres', 'genreId', id));
  route('POST', '/genres', 'Admin', async ({ req, res }) => {
    const id = await insert('Genres', validate(await jsonBody(req), genreFields));
    res.setHeader('Location', prefix + '/genres/' + id);
    return find('Genres', 'genreId', id);
  }, 201);
  route('PATCH', '/genres/:id', 'Admin', async ({ req, id }) => {
    const values = validate(await jsonBody(req), genreFields);
    await find('Genres', 'genreId', id);
    await update('Genres', 'genreId', id, values);
    return find('Genres', 'genreId', id);
  });
  route('DELETE', '/genres/:id', 'Admin', async ({ id }) => {
    await find('Genres', 'genreId', id);
    await run('DELETE FROM Genres WHERE genreId = ?', id);
  }, 204);

  route('GET', '/movie-genres', 'Authenticated', ({ query }) => list('MovieGenres', 'movieGenreId', query, {
    filters: [
      ['movieId', 'movieId = ?', value => queryInteger(value, 'movieId')],
      ['genreId', 'genreId = ?', value => queryInteger(value, 'genreId')]
    ],
    sortFields: ['movieGenreId', 'movieId', 'genreId']
  }));
  route('POST', '/movie-genres', 'Authenticated', async ({ req }) => {
    const values = validate(await jsonBody(req), {
      movieId: value => integer(value, 'movieId'),
      genreId: value => integer(value, 'genreId')
    });
    await find('Movies', 'movieId', values.movieId);
    await find('Genres', 'genreId', values.genreId);
    return find('MovieGenres', 'movieGenreId', await insert('MovieGenres', values));
  }, 201);
  route('DELETE', '/movie-genres/:id', 'Authenticated', async ({ id }) => {
    const result = await run('DELETE FROM MovieGenres WHERE movieGenreId = ?', id);
    if (!result.affectedRows) fail(404, 'Movie genre assignment not found.');
  }, 204);

  route('GET', '/reports', 'Authenticated', ({ query }) => list('Reports', 'reportId', query, {
    sortFields: ['reportId', 'reportName', 'createdAt']
  }));
  route('GET', '/reports/:id', 'Authenticated', async ({ id, req, res }) => {
    const report = await find('Reports', 'reportId', id);
    res.setHeader('Vary', 'Origin, Accept');
    if (req.headers.accept?.trim().toLowerCase() === 'text/csv') {
      const csv = await movieReportCsv(database);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="movie-report-${id}.csv"`);
      return csv;
    }
    return report;
  });
  route('POST', '/reports', 'Authenticated', async ({ req, res, user }) => {
    const values = validate(await jsonBody(req), reportFields);
    const id = await insert('Reports', { ...values, generatedByUserId: user.userId });
    res.setHeader('Location', prefix + '/reports/' + id);
    return find('Reports', 'reportId', id);
  }, 201);
  route('DELETE', '/reports/:id', 'Admin', async ({ id }) => {
    await find('Reports', 'reportId', id);
    await run('DELETE FROM Reports WHERE reportId = ?', id);
  }, 204);

  async function authenticate(req) {
    const bearer = req.headers.authorization?.match(/^Bearer ([^ ]+)$/i);
    const claims = tokens.verify(bearer?.[1]);
    const user = claims && await one(`SELECT ${publicUserFields}, authVersion FROM Users WHERE userId = ?`, Number(claims.sub));
    if (!user || user.authVersion !== claims.ver || user.role !== claims.role) {
      fail(401, 'Login token is missing, invalid, or expired.');
    }
    return user;
  }

  return { routes, authenticate, queryInteger };
}
