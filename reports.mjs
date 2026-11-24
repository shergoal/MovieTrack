function csvCell(value) {
  const text = String(value ?? '');
  const safe = /^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

export async function movieReportCsv(database) {
  const movies = await database.all(`
    SELECT m.movieId, m.title, m.durationMinutes, m.ageRating, m.status,
      COALESCE((
        SELECT GROUP_CONCAT(g.genreName ORDER BY g.genreName SEPARATOR ', ')
        FROM MovieGenres mg JOIN Genres g ON g.genreId = mg.genreId
        WHERE mg.movieId = m.movieId
      ), '') AS genres
    FROM Movies m
    ORDER BY m.title, m.movieId
  `);
  const header = ['Movie ID', 'Title', 'Duration Minutes', 'Age Rating', 'Status', 'Genres'];
  return [header, ...movies.map(Object.values)].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
