-- MySQL 8 schema export. The application creates the first Admin at startup.
CREATE DATABASE IF NOT EXISTS movietrack CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE movietrack;
SET SESSION time_zone = '+00:00';

CREATE TABLE IF NOT EXISTS Users (
  userId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  fullName VARCHAR(100) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  passwordHash VARCHAR(255) NOT NULL,
  role ENUM('Admin', 'Staff') NOT NULL,
  authVersion INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Movies (
  movieId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  createdByUserId INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  durationMinutes INT NOT NULL CHECK (durationMinutes > 0),
  ageRating VARCHAR(20) NOT NULL,
  status ENUM('Showing', 'Upcoming', 'Archived') NOT NULL,
  posterPath VARCHAR(255),
  CONSTRAINT fk_movies_creator FOREIGN KEY (createdByUserId) REFERENCES Users(userId) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Genres (
  genreId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  genreName VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS MovieGenres (
  movieGenreId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  movieId INT NOT NULL,
  genreId INT NOT NULL,
  CONSTRAINT uq_movie_genre UNIQUE (movieId, genreId),
  CONSTRAINT fk_movie_genres_movie FOREIGN KEY (movieId) REFERENCES Movies(movieId) ON DELETE RESTRICT,
  CONSTRAINT fk_movie_genres_genre FOREIGN KEY (genreId) REFERENCES Genres(genreId) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS Reports (
  reportId INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  generatedByUserId INT NOT NULL,
  reportName VARCHAR(100) NOT NULL,
  createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_reports_author FOREIGN KEY (generatedByUserId) REFERENCES Users(userId) ON DELETE RESTRICT
) ENGINE=InnoDB;
