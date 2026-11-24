import 'reflect-metadata';
import { DataSource, EntitySchema } from 'typeorm';

const id = { type: 'int', primary: true, generated: 'increment' };
const varchar = (length, nullable = false) => ({ type: 'varchar', length, nullable });
const parent = (target, name, inverseSide) => ({
  type: 'many-to-one', target, inverseSide, joinColumn: { name }, nullable: false, onDelete: 'RESTRICT'
});
const children = (target, inverseSide) => ({ type: 'one-to-many', target, inverseSide });

export const entities = [
  new EntitySchema({
    name: 'Users', tableName: 'Users',
    columns: {
      userId: id, fullName: varchar(100), email: { ...varchar(150), unique: true },
      passwordHash: { ...varchar(255), select: false },
      role: { type: 'enum', enum: ['Admin', 'Staff'] },
      authVersion: { type: 'int', default: 0, select: false }
    },
    relations: { movies: children('Movies', 'creator'), reports: children('Reports', 'author') }
  }),
  new EntitySchema({
    name: 'Movies', tableName: 'Movies',
    columns: {
      movieId: id, createdByUserId: { type: 'int' }, title: varchar(150),
      durationMinutes: { type: 'int' }, ageRating: varchar(20),
      status: { type: 'enum', enum: ['Showing', 'Upcoming', 'Archived'] }, posterPath: varchar(255, true)
    },
    relations: { creator: parent('Users', 'createdByUserId', 'movies'), genres: children('MovieGenres', 'movie') }
  }),
  new EntitySchema({
    name: 'Genres', tableName: 'Genres',
    columns: { genreId: id, genreName: { ...varchar(50), unique: true } },
    relations: { movies: children('MovieGenres', 'genre') }
  }),
  new EntitySchema({
    name: 'MovieGenres', tableName: 'MovieGenres',
    columns: { movieGenreId: id, movieId: { type: 'int' }, genreId: { type: 'int' } },
    uniques: [{ columns: ['movieId', 'genreId'] }],
    relations: { movie: parent('Movies', 'movieId', 'genres'), genre: parent('Genres', 'genreId', 'movies') }
  }),
  new EntitySchema({
    name: 'Reports', tableName: 'Reports',
    columns: {
      reportId: id, generatedByUserId: { type: 'int' }, reportName: varchar(100),
      createdAt: { type: 'datetime', precision: 3, default: () => 'CURRENT_TIMESTAMP(3)' }
    },
    relations: { author: parent('Users', 'generatedByUserId', 'reports') }
  })
];

export async function openDatabase(env) {
  const source = new DataSource({
    type: 'mysql',
    host: env.DB_HOST || '127.0.0.1',
    port: Number(env.DB_PORT || 3306),
    username: env.DB_USER || 'root',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'movietrack',
    timezone: 'Z',
    charset: 'utf8mb4',
    entities,
    synchronize: false
  });
  await source.initialize();
  return {
    repository: table => source.getRepository(table),
    all: (sql, ...params) => source.query(sql, params),
    one: async (sql, ...params) => (await source.query(sql, params))[0],
    run: (sql, ...params) => source.query(sql, params),
    close: () => source.destroy()
  };
}
