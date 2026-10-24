import test from "node:test";
import assert from "node:assert/strict";
import {
  planSearch,
  metadataForStorage,
  recommendationSeeds,
  mergePersonalEdits,
} from "../lib/app-model.js";

test("a title lookup clears previous discovery constraints and can find upcoming movies or TV", () => {
  const filters = planSearch("  Dune  ", {
    exploreFilters: {
      mediaType: "movie",
      genreId: "16",
      yearFrom: "2000",
      yearTo: "2005",
      minVotes: 5000,
      minRating: 9,
      runtimeMax: 90,
      originalLanguage: "ja",
      personId: "123",
      watchProviderId: "8",
      limit: 100,
      sort: "rating",
    },
  });
  assert.equal(filters.mode, "search");
  assert.equal(filters.query, "Dune");
  assert.equal(filters.mediaType, "all");
  assert.equal(filters.includeUpcoming, true);
  assert.equal(filters.limit, 30);
  for (const field of [
    "genreId",
    "yearFrom",
    "yearTo",
    "runtimeMin",
    "runtimeMax",
    "personId",
    "watchProviderId",
    "originalLanguage",
  ])
    assert.equal(filters[field], "", field);
  assert.equal(filters.minVotes, 0);
  assert.equal(filters.minRating, 0);
});

test("title numbers and common genre words do not turn titles into discovery filters", () => {
  for (const title of [
    "Blade Runner 2049",
    "2001 A Space Odyssey",
    "Top Gun",
    "Action Jackson",
  ]) {
    const result = planSearch(title, {
      exploreFilters: { genreId: "16", yearFrom: "2020" },
      searchType: "movie",
    });
    assert.equal(result.query, title);
    assert.equal(result.mode, "search");
    assert.equal(result.mediaType, "movie");
    assert.equal(result.yearFrom, "");
  }
});

test("recognized discovery requests retain explicit browsing controls", () => {
  const result = planSearch(
    "best 25 science fiction movies between 2000 and 2010",
    { exploreFilters: { minVotes: 1000, originalLanguage: "en" } },
  );
  assert.equal(result.mode, "discover");
  assert.equal(result.recognized, true);
  assert.equal(result.genreId, "878");
  assert.equal(result.yearFrom, "2000");
  assert.equal(result.yearTo, "2010");
  assert.equal(result.limit, 25);
  assert.equal(result.minVotes, 1000);
  assert.equal(result.originalLanguage, "en");
});

test("explicit title search treats real titles that overlap filter words literally", () => {
  for (const title of ["Popular", "Family", "War", "Comedy", "Western", "Best"]) {
    const result = planSearch(`  ${title}  `, {
      literalTitle: true,
      searchType: "tv",
      exploreFilters: {
        mediaType: "movie", genreId: "16", yearFrom: "2000", yearTo: "2010",
        sort: "rating", minVotes: 5000, minRating: 9, runtimeMax: 90,
        originalLanguage: "ja", personId: "525", watchProviderId: "8",
      },
    });
    assert.equal(result.mode, "search", title);
    assert.equal(result.query, title);
    assert.equal(result.mediaType, "tv");
    assert.equal(result.recognized, false);
    assert.equal(result.includeUpcoming, true);
    assert.equal(result.limit, 30);
    assert.equal(result.minVotes, 0);
    assert.equal(result.minRating, 0);
    for (const field of ["genreId", "yearFrom", "yearTo", "runtimeMax", "originalLanguage", "personId", "watchProviderId"])
      assert.equal(result[field], "", `${title}: ${field}`);
  }
});

test("natural filter phrases parse in Explore and remain literal in explicit title search", () => {
  const query = "best 25 science fiction movies between 2000 and 2010";
  const options = { searchType: "all", exploreFilters: { minVotes: 1000 } };
  const discovery = planSearch(query, options);
  assert.equal(discovery.mode, "discover");
  assert.equal(discovery.limit, 25);
  const literal = planSearch(query, { ...options, literalTitle: true });
  assert.equal(literal.mode, "search");
  assert.equal(literal.query, query);
  assert.equal(literal.mediaType, "all");
  assert.equal(literal.genreId, "");
  assert.equal(literal.yearFrom, "");
  assert.equal(literal.minVotes, 0);
  assert.equal(literal.limit, 30);
});

test("blank search resumes structured discovery and clears an old title query", () => {
  const result = planSearch(" ", {
    exploreFilters: {
      mode: "search",
      query: "old title",
      mediaType: "tv",
      genreId: "35",
      yearFrom: "2010",
    },
  });
  assert.equal(result.mode, "discover");
  assert.equal(result.query, "");
  assert.equal(result.mediaType, "tv");
  assert.equal(result.genreId, "35");
  assert.equal(result.yearFrom, "2010");
  assert.deepEqual(planSearch(" ", {
    literalTitle: true,
    exploreFilters: { mediaType: "tv", genreId: "35", yearFrom: "2010" },
  }), result);
});

test("saved metadata keeps useful canonical details while trimming API payloads and personal records", () => {
  const item = {
    id: 42,
    mediaType: "tv",
    title: "A show",
    name: "A show",
    first_air_date: "2020-01-02",
    poster_path: "/poster.jpg",
    backdrop_path: "/backdrop.jpg",
    overview: "Synopsis",
    runtime: 45,
    vote_average: 8.2,
    vote_count: 1500,
    tagline: "Hello",
    original_language: "en",
    number_of_episodes: 24,
    number_of_seasons: 2,
    status: "Returning Series",
    genres: [{ id: 18, name: "Drama" }],
    cast: Array.from({ length: 50 }, (_, id) => ({
      id: id + 1,
      name: `Actor ${id}`,
      character: "Role",
      huge: "x".repeat(10000),
    })),
    crew: Array.from({ length: 50 }, (_, id) => ({
      id: id + 1,
      name: `Director ${id}`,
      job: "Director",
      huge: "x".repeat(10000),
    })),
    externalIds: { imdb_id: "tt123", tvdb_id: 123, arbitrary: "extra" },
    watchProviders: {
      link: "https://www.themoviedb.org/tv/42/watch",
      flatrate: [
        { provider_id: 8, provider_name: "Netflix", logo_path: "/logo.jpg" },
      ],
    },
    belongs_to_collection: {
      id: 10,
      name: "Saga",
      poster_path: "/saga.jpg",
      parts: Array(1000).fill("extra"),
    },
    credits: { cast: Array(1000).fill("bulky") },
    videos: { results: Array(1000).fill("bulky") },
    rating: 9,
    notes: "Personal",
    favorite: true,
    tags: ["mine"],
    logs: [{ id: "one" }],
    progress: { status: "watching" },
    priority: "high",
  };
  const before = JSON.stringify(item);
  const stored = metadataForStorage(item);
  assert.equal(stored.mediaType, "tv");
  assert.equal(stored.number_of_episodes, 24);
  assert.equal(stored.cast.length, 12);
  assert.equal(stored.crew.length, 12);
  assert.deepEqual(stored.genres, [{ id: 18, name: "Drama" }]);
  assert.deepEqual(stored.externalIds, { imdb_id: "tt123", tvdb_id: 123 });
  assert.equal(stored.watchProviders.flatrate[0].provider_name, "Netflix");
  assert.equal(stored.belongs_to_collection.name, "Saga");
  for (const field of [
    "credits",
    "videos",
    "rating",
    "notes",
    "favorite",
    "tags",
    "logs",
    "progress",
    "priority",
  ])
    assert.equal(Object.hasOwn(stored, field), false, field);
  assert.equal(Object.hasOwn(stored.cast[0], "huge"), false);
  assert.ok(JSON.stringify(stored).length < 5000);
  assert.equal(
    JSON.stringify(item),
    before,
    "metadata extraction must not mutate source records",
  );
});

test("metadata does not synthesize absent details or retain malformed nested values", () => {
  const result = metadataForStorage({
    id: 1,
    media_type: "movie",
    title: "Film",
    runtime: NaN,
    cast: [null, { name: "Actor", id: 2, unexpected: { notes: "bad" } }],
  });
  assert.equal(result.mediaType, "movie");
  assert.equal(Object.hasOwn(result, "runtime"), false);
  assert.equal(Object.hasOwn(result, "genres"), false);
  assert.deepEqual(result.cast, [{ id: 2, name: "Actor" }]);
});

const snapshot = () => ({
  watched: [
    {
      id: 1,
      mediaType: "movie",
      title: "Unrated",
      rating: 0,
      watchedDate: "2026-10-01",
    },
    {
      id: 2,
      mediaType: "movie",
      title: "Disliked",
      rating: 3,
      watchedDate: "2026-10-02",
    },
    {
      id: 3,
      mediaType: "movie",
      title: "Loved",
      rating: 9,
      watchedDate: "2026-10-03",
    },
    {
      id: 4,
      mediaType: "movie",
      title: "Good older",
      rating: 8,
      watchedDate: "2026-09-01",
    },
    {
      id: 5,
      mediaType: "movie",
      title: "Good newer",
      rating: 8,
      watchedDate: "2026-10-01",
    },
    { id: 6, mediaType: "movie", title: "Favorite", rating: 0, favorite: true },
  ],
  watchlist: [
    { id: 3, mediaType: "tv", title: "Favorite show", favorite: true },
    { id: 7, mediaType: "movie", title: "Rated shortlist", rating: 9 },
  ],
});

test("automatic recommendation seeds use positive watches and explicit favorites with compound identity", () => {
  const data = snapshot();
  const before = JSON.stringify(data);
  const result = recommendationSeeds(data, { limit: 10 });
  assert.deepEqual(
    result.map((item) => `${item.mediaType}-${item.id}`),
    ["movie-3", "movie-5", "movie-4", "movie-6", "tv-3"],
  );
  assert.equal(JSON.stringify(data), before);
});

test("recommendation seed rotation advances through the eligible pool and wraps once", () => {
  assert.deepEqual(
    recommendationSeeds(snapshot(), { offset: 2, limit: 4 }).map(
      (item) => item.id,
    ),
    [4, 6, 3, 3],
  );
  assert.deepEqual(
    recommendationSeeds(snapshot(), { offset: 5, limit: 2 }).map(
      (item) => item.id,
    ),
    [3, 5],
  );
  assert.equal(
    recommendationSeeds({ watched: [{ id: 1, rating: 0 }] }).length,
    0,
  );
});

test("an explicit saved seed can use an unrated title and distinguishes a movie from TV with the same ID", () => {
  const data = snapshot();
  assert.deepEqual(recommendationSeeds(data, { seedKey: "movie-1" }), [
    data.watched[0],
  ]);
  assert.deepEqual(
    recommendationSeeds(data, { seedKey: "tv:3", offset: 100 }),
    [data.watchlist[0]],
  );
  assert.equal(
    recommendationSeeds(data, { seedKey: "movie-999" })[0].title,
    "Loved",
  );
});

test("saving notes preserves an external favorite and other unedited personal fields", () => {
  const base = {
    notes: "Before",
    favorite: false,
    tags: ["Weekend"],
    rating: 7,
  };
  const current = { ...base, favorite: true, rating: 9 };
  const result = mergePersonalEdits(base, current, { notes: "My draft" });
  assert.deepEqual(result, { changes: { notes: "My draft" }, conflicts: [] });
  assert.deepEqual(
    { ...current, ...result.changes },
    { notes: "My draft", favorite: true, tags: ["Weekend"], rating: 9 },
  );
});

test("editing one progress marker preserves externally updated episode counts and state", () => {
  const base = {
    progress: {
      status: "watching",
      watchedEpisodes: 4,
      totalEpisodes: 10,
      currentSeason: 1,
      currentEpisode: 4,
    },
  };
  const current = {
    progress: {
      ...base.progress,
      watchedEpisodes: 6,
      totalEpisodes: 12,
      status: "paused",
    },
  };
  const edits = { "progress.currentSeason": 2, "progress.currentEpisode": 1 };
  const before = JSON.stringify([base, current, edits]);
  const result = mergePersonalEdits(base, current, edits);
  assert.deepEqual(result, {
    changes: {
      progress: {
        status: "paused",
        watchedEpisodes: 6,
        totalEpisodes: 12,
        currentSeason: 2,
        currentEpisode: 1,
      },
    },
    conflicts: [],
  });
  result.changes.progress.totalEpisodes = 100;
  assert.equal(JSON.stringify([base, current, edits]), before);
});

test("concurrent changes to an edited scalar, array or progress field are conflicts", () => {
  const base = {
    notes: "Before",
    tags: ["A"],
    progress: { watchedEpisodes: 2 },
  };
  const current = {
    notes: "Other tab",
    tags: ["B"],
    progress: { watchedEpisodes: 4 },
  };
  const edits = {
    notes: "My draft",
    tags: ["C"],
    "progress.watchedEpisodes": 3,
  };
  const result = mergePersonalEdits(base, current, edits);
  assert.deepEqual(result.conflicts, [
    "notes",
    "tags",
    "progress.watchedEpisodes",
  ]);
  assert.deepEqual(result.changes, {
    notes: "My draft",
    tags: ["C"],
    progress: { watchedEpisodes: 3 },
  });
  result.changes.tags.push("New");
  assert.deepEqual(edits.tags, ["C"]);
});

test("an edit already equal to current data does not require resolving a conflict", () => {
  const base = {
    rating: 7,
    tags: ["Before"],
    progress: { status: "watching" },
  };
  const current = {
    rating: 9,
    tags: ["Now"],
    progress: { status: "paused", totalEpisodes: 12 },
  };
  const result = mergePersonalEdits(base, current, {
    rating: 9,
    tags: ["Now"],
    "progress.status": "paused",
  });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.changes.progress, {
    status: "paused",
    totalEpisodes: 12,
  });
});

test("viewing date edits merge with untouched viewing notes and ratings", () => {
  const base = { date: "2026-01-01", rating: 7, notes: "Cinema" };
  const current = { ...base, notes: "Cinema with a friend" };
  assert.deepEqual(mergePersonalEdits(base, current, { date: "" }), {
    changes: { date: "" },
    conflicts: [],
  });
  assert.deepEqual(mergePersonalEdits({}, {}, {}), {
    changes: {},
    conflicts: [],
  });
});

test("unsupported and prototype-related edit keys are rejected before use", () => {
  for (const edits of [
    { title: "Wrong field" },
    { "progress.__proto__": {} },
    JSON.parse('{"__proto__":{"polluted":true}}'),
    { constructor: {} },
  ]) {
    assert.throws(
      () => mergePersonalEdits({}, {}, edits),
      /Unsupported personal field/,
    );
  }
  assert.throws(() => mergePersonalEdits({}, {}, []), /must be an object/);
  assert.equal({}.polluted, undefined);
});
