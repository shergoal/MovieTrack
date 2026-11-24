# MovieTrack backend

MovieTrack is a cinema movie management API built with Node.js 24, NestJS, TypeORM, MySQL 8, and JWT authentication. It provides 23 resource endpoints and three authentication endpoints.

## Run locally

1. Start MySQL 8. In MySQL Workbench, open and run `schema.sql` using an account allowed to create the database. In the MySQL CLI, the equivalent is `SOURCE C:/path/to/MovieTrack/schema.sql`.
2. Run `npm.cmd ci` and `Copy-Item .env.example .env` in PowerShell. Set the database connection values in `.env` using a MySQL account with SELECT, INSERT, UPDATE, and DELETE access to `movietrack`.
3. Generate a signing secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and set `JWT_SECRET` in `.env`.
4. Set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in `.env`. The server creates the first Admin if none exists. Use at least 12 characters for passwords and quote values containing spaces or `#`.
5. Run `npm.cmd run build` to check the JavaScript and `npm.cmd run start:dev` to launch NestJS. The default API address is `http://127.0.0.1:3000/api/v1`.

Send `POST /api/v1/auth/login` with JSON such as `{"email":"admin@example.com","password":"your-admin-password"}`. Use the returned token in the `Authorization: Bearer <token>` header for protected requests. Send `Content-Type: application/json` with JSON bodies. Use HTTPS at the reverse proxy when serving the API over a network.

## API

All paths below use the `/api/v1` prefix. Admin and Staff can use authenticated endpoints. HTTP responses use 200 for reads and updates, 201 for creates, and 204 for deletes and logout.

| Paths | Admin and Staff | Admin only |
| --- | --- | --- |
| `/users`, `/users/{id}` | | GET collection and item, POST, PATCH, DELETE |
| `/movies`, `/movies/{id}` | GET collection and item, POST, PUT, PATCH | DELETE |
| `/genres`, `/genres/{id}` | GET collection and item | POST, PATCH, DELETE |
| `/movie-genres`, `/movie-genres/{id}` | GET collection, POST, DELETE | |
| `/reports`, `/reports/{id}` | GET collection and item, POST | DELETE |

- **Users** accept `fullName`, `email`, `role` (`Admin` or `Staff`), and `password`. Account creation uses an initial password to complete the secure setup step left open by Lab 5. PATCH accepts individual fields, including an Admin-set password reset. Credentials are hashed on the server and excluded from responses. Deleting an account referenced by movies or reports returns 409.
- **Movies** accept `title`, `durationMinutes`, `ageRating`, `status` (`Showing`, `Upcoming`, or `Archived`), and optional `posterPath`. The server gets `createdByUserId` from the signed-in user. PUT replaces editable details and defaults an omitted poster to null. PATCH accepts individual fields. Filter the list by `title`, `status`, or `genreId`.
- **Genres** accept `genreName`. Movie–genre assignments accept `movieId` and `genreId`, return a `movieGenreId`, and can be filtered by movie or genre. Deleting a linked movie or genre returns 409 until its assignments are removed.
- **Reports** accept `reportName`. The server records `generatedByUserId` and `createdAt`. `GET /reports/{id}` returns the saved record. Send `Accept: text/csv` on the same route to export the current movie catalog with genres.
- **Collection queries** support `page` and `limit` (default 25, maximum 100), plus `sort` and `order` (`asc` or `desc`). Users can be filtered by `role`.
- **Authentication** also provides `GET /auth/me` and `POST /auth/logout`. Tokens expire after one hour. Logout invalidates all current tokens for that account. Login attempts are rate-limited per IP.

Errors use the Lab 5 structure with `success`, `statusCode`, `message`, `errors`, and `timestamp`. Missing or invalid authentication returns 401. A signed-in user without the required permission receives 403.

Successful creation of a user, movie, genre, or report returns a `Location` header with its item URL. Requests handled by the application return an `X-Request-Id` header. The server writes the matching ID, method, route pattern, status, elapsed time, and verified user ID to its log. Request bodies, query strings, and bearer tokens stay out of request logs.

## Architecture and security

MovieTrack runs as one NestJS application. A request goes from Postman to a resource controller registered in `movietrack.controller.mjs`, through its handler in `movietrack.service.mjs`, and to a TypeORM repository backed by MySQL. `database.mjs` configures TypeORM and defines the five entities. `server.mjs` configures NestJS, the JWT guard, and the shared exception filter. `auth.mjs` handles passwords and JWTs, and `reports.mjs` generates CSV.

The API checks the JWT signature, issuer, audience, timestamps, and current account state before handling a protected request. JWTs issued before the audience check was added require a fresh login. Catalog and report records are shared between Admin and Staff according to Lab 6. Account-management endpoints are Admin-only, and `/auth/me` reads the signed-in account.

The API limits JSON bodies to 32 KiB, caps collection pages at 100 rows, and applies HTTP header and request timeouts. A login rate-limit response is `429` with a `Retry-After` header. Deploy behind an HTTPS reverse proxy for network use.

## Lab alignment

| Lab | Backend application |
| --- | --- |
| 1 | Applies the integration concepts studied through Airbnb. MovieTrack connects its browser client to the API, relational database, authentication, and reporting components. |
| 2 | Applies the JSONPlaceholder exercise on REST, HTTP methods, JSON, and API documentation to MovieTrack's own resources. |
| 3 | Implements the MovieTrack client–server design with movie CRUD, authentication, a relational database, and movie reporting. |
| 4 | Uses the five MovieTrack entities, their documented fields and relationships, and unique movie–genre pairs. |
| 5 | Implements the 23 versioned resource endpoints, camelCase JSON, filtering, pagination, and the standard error structure. |
| 6 | Implements the three authentication endpoints and the Admin/Staff access matrix, with password hashing, signed expiring JWTs, server-side validation, and login rate limiting. |

## Postman and demonstration

Import `MovieTrack.postman_collection.json`. Set the local values `adminEmail`, `adminPassword`, `staffEmail`, and `staffPassword`. Choose an unused demo Staff email and a password of at least 12 characters. Run the collection in order. It captures tokens and IDs, checks response codes, and removes the rows it creates.

For the recording, show `npm.cmd run start:dev`, sign in through Postman, and demonstrate a full Movie CRUD sequence. Trace `POST /api/v1/movies` from the controller to the service's input validation and `createdByUserId` assignment, then to the TypeORM repository and the MySQL `Movies` table. Show a request without a token returning 401 and show the affected table in MySQL Workbench. The rubric requires the student's own narration and a shareable link.

The MySQL implementation starts from `schema.sql`. Earlier local SQLite files are left in place and are not imported automatically.
