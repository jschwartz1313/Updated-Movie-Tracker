import test from "node:test";
import assert from "node:assert/strict";
import { filterLibrary, libraryStats } from "../lib/library.js";

const film = (id, changes = {}) => ({
  id,
  mediaType: "movie",
  title: `Film ${id}`,
  tags: [],
  logs: [],
  ...changes,
});

test("personal search finds accents, people, tags, notes, genres, and viewing notes together", () => {
  const items = [
    film(1, {
      title: "Amélie",
      original_title: "Le Fabuleux Destin",
      notes: "With Zoë",
      tags: ["Family"],
      genres: [{ id: 35, name: "Comedy" }],
      cast: [{ name: "Audrey Tautou" }],
      credits: { crew: [{ name: "Jean-Pierre Jeunet", job: "Director" }] },
      logs: [
        { id: "one", date: "2026-01-01", rating: 8, notes: "Paris evening" },
      ],
    }),
    film(2, { title: "Another film" }),
  ];
  for (const query of [
    "amelie",
    "zoe",
    "audrey family",
    "jeunet paris",
    "comedy destin",
  ]) {
    assert.deepEqual(
      filterLibrary(items, { query }).map((item) => item.id),
      [1],
    );
  }
  assert.deepEqual(filterLibrary(items, { query: "Amelie missing" }), []);
});

test("library filters combine media, genres, rating, tags, favorites, priority, years, and TV progress", () => {
  const items = [
    film(1, {
      rating: 9,
      favorite: true,
      priority: "high",
      tags: ["Family", "Friday"],
      genre_ids: [16],
      release_date: "2001-01-01",
    }),
    film(2, {
      rating: 6,
      tags: ["Family"],
      genres: [{ id: 16, name: "Animation" }],
      release_date: "1999-01-01",
    }),
    film(3, {
      mediaType: "tv",
      rating: 8,
      favorite: true,
      tags: ["Family"],
      progress: { status: "watching" },
    }),
  ];
  assert.deepEqual(
    filterLibrary(items, {
      type: "movie",
      genreId: 16,
      minRating: 8,
      tag: "family",
      tags: ["friday"],
      favoriteOnly: true,
      priority: "high",
      yearFrom: 2000,
      yearTo: 2020,
    }).map((item) => item.id),
    [1],
  );
  assert.deepEqual(
    filterLibrary(items, { type: "tv", progressStatus: "watching" }).map(
      (item) => item.id,
    ),
    [3],
  );
  assert.deepEqual(filterLibrary(items, { tags: ["Family", "Unknown"] }), []);
  assert.deepEqual(
    filterLibrary(items, { yearTo: 2000 }).map((item) => item.id),
    [2],
  );
});

test("sorts use personal ratings, runtime, dates and priority without mutating the input", () => {
  const items = [
    film(1, {
      title: "Zebra",
      rating: 8,
      runtime: 120,
      priority: "low",
      release_date: "2020-01-01",
      addedAt: "2025-01-01",
    }),
    film(2, {
      title: "Alpha",
      rating: 9.5,
      runtime: 80,
      priority: "high",
      release_date: "2000-01-01",
      addedAt: "2024-01-01",
      logs: [{ date: "2026-05-01" }],
    }),
    film(3, { title: "Bravo" }),
  ];
  const ids = (sort) => filterLibrary(items, { sort }).map((item) => item.id);
  assert.deepEqual(ids("title"), [2, 3, 1]);
  assert.deepEqual(ids("rating"), [2, 1, 3]);
  assert.deepEqual(ids("year"), [1, 2, 3]);
  assert.deepEqual(ids("runtime"), [2, 1, 3]);
  assert.deepEqual(ids("runtime-desc"), [1, 2, 3]);
  assert.deepEqual(ids("recent"), [2, 1, 3]);
  assert.deepEqual(ids("added"), [1, 2, 3]);
  assert.deepEqual(ids("priority"), [2, 3, 1]);
  assert.deepEqual(
    items.map((item) => item.id),
    [1, 2, 3],
  );
});

test("unrated filter excludes personal scores and treats missing legacy scores as unrated", () => {
  const items = [
    film(1, { rating: 0 }),
    film(2, { rating: 8.5 }),
    film(3),
    film(4, { rating: "7" }),
  ];
  assert.deepEqual(
    filterLibrary(items, { minRating: "unrated", sort: "title" }).map(
      (item) => item.id,
    ),
    [1, 3],
  );
  assert.deepEqual(
    filterLibrary(items, { minRating: "7", sort: "title" }).map(
      (item) => item.id,
    ),
    [2, 4],
  );
});

test("statistics count repeats and history on watchlist, distinguish TV, and explain missing metadata", () => {
  const snapshot = {
    watchlist: [
      film(1, {
        runtime: 100,
        rating: 8,
        favorite: true,
        tags: ["Family", "Friday"],
        logs: [
          { id: "a", date: "2026-01-01" },
          { id: "b", date: "2026-02-01" },
        ],
      }),
      film(4, { tags: ["family"] }),
      film(5, { mediaType: "tv", progress: { status: "watching" } }),
    ],
    watched: [
      film(2, { rating: 6, tags: ["Family"], logs: [{ id: "c", date: "" }] }),
      film(3, {
        mediaType: "tv",
        rating: 10,
        runtime: 60,
        logs: [{ id: "d", date: "2026-02-02" }],
      }),
    ],
  };
  const result = libraryStats(snapshot);
  assert.equal(result.totalTitles, 5);
  assert.equal(result.watchedMovies, 2);
  assert.equal(result.watchedShows, 1);
  assert.equal(result.totalViewings, 4);
  assert.equal(result.movieViewings, 3);
  assert.equal(result.showViewings, 1);
  assert.equal(result.movieMinutes, 200);
  assert.equal(result.unknownRuntimeViewings, 1);
  assert.equal(result.unknownDateViewings, 1);
  assert.equal(result.avgRating, 8);
  assert.equal(result.ratedTitles, 3);
  assert.equal(result.favorites, 1);
  assert.equal(result.activeShows, 1);
  assert.deepEqual(result.monthlyCounts, [
    { month: "2026-01", count: 1, movies: 1, shows: 0 },
    { month: "2026-02", count: 2, movies: 1, shows: 1 },
  ]);
  assert.deepEqual(result.topTags, [
    { tag: "Family", count: 3 },
    { tag: "Friday", count: 1 },
  ]);
});

test("statistics preserve explicit empty journals and support records before legacy normalization", () => {
  const result = libraryStats({
    watchlist: [],
    watched: [
      film(1),
      {
        id: 2,
        title: "Legacy",
        rating: 9,
        runtime: 90,
        watchedDate: "2025-01-01",
      },
    ],
  });
  assert.equal(result.watchedMovies, 2);
  assert.equal(result.totalViewings, 1);
  assert.equal(result.movieMinutes, 90);
  assert.equal(libraryStats().avgRating, 0);
  assert.equal(libraryStats().totalViewings, 0);
});
