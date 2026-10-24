import test from "node:test";
import assert from "node:assert/strict";
import { createLibraryStore } from "../lib/storage.js";
import { metadataForStorage } from "../lib/app-model.js";

class MemoryStorage {
  constructor(values = {}) {
    this.values = new Map(Object.entries(values));
    this.writes = [];
    this.failKey = null;
    this.failRead = false;
  }
  getItem(key) {
    if (this.failRead) throw new Error("Storage disabled");
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    if (
      this.failKey === "*" ||
      this.failKey === key ||
      (this.failKey === "recovery" && key.includes(".recovery."))
    )
      throw new Error("Quota exceeded");
    this.writes.push({ key, value });
    this.values.set(key, String(value));
  }
}

const movie = (id = 1, changes = {}) => ({
  id,
  title: `Movie ${id}`,
  mediaType: "movie",
  ...changes,
});
const saved = (watchlist = [], watched = [], extras = {}) =>
  JSON.stringify({ watchlist, watched, ...extras });

test("loads legacy records and hidden IDs without rewriting original storage", () => {
  const original = saved(
    [
      {
        id: "15",
        title: "Spirited Away",
        addedDate: "2020-01-02T12:00:00.000Z",
        externalIds: { imdb_id: "tt0245429" },
        genres: [{ id: 16, name: "Animation" }],
      },
    ],
    [
      {
        id: 20,
        name: "A show",
        mediaType: "tv",
        rating: "8.5",
        review: "A favorite",
        watchedDate: "2025-01-03T20:30:00.000Z",
      },
    ],
  );
  const storage = new MemoryStorage({
    movieTrackerData: original,
    hiddenItems: '["movie-2","tv-2","movie-2"]',
  });
  const result = createLibraryStore(storage).load();
  assert.equal(result.version, 2);
  assert.equal(result.watchlist[0].id, 15);
  assert.equal(result.watchlist[0].mediaType, "movie");
  assert.equal(result.watchlist[0].addedAt, "2020-01-02T12:00:00.000Z");
  assert.deepEqual(result.watchlist[0].externalIds, { imdb_id: "tt0245429" });
  assert.equal(result.watched[0].title, "A show");
  assert.equal(result.watched[0].notes, "A favorite");
  assert.equal(result.watched[0].watchedDate, "2025-01-03");
  assert.equal(result.watched[0].rating, 8.5);
  assert.deepEqual(result.hiddenItems, ["movie-2", "tv-2"]);
  assert.equal(storage.getItem("movieTrackerData"), original);
  assert.equal(storage.writes.length, 0);
});

test("deduplicates by media type and lets watched records win without losing notes", () => {
  const storage = new MemoryStorage({
    movieTrackerData: saved(
      [
        movie(1, { notes: "Keep me", rating: 8 }),
        movie(1, { title: "Latest metadata" }),
        movie(1, { mediaType: "tv" }),
      ],
      [movie(1, { title: "Watched metadata", rating: 0 })],
    ),
  });
  const result = createLibraryStore(storage).load();
  assert.equal(result.watchlist.length, 1);
  assert.equal(result.watchlist[0].mediaType, "tv");
  assert.equal(result.watched.length, 1);
  assert.equal(result.watched[0].title, "Watched metadata");
  assert.equal(result.watched[0].notes, "Keep me");
  assert.equal(result.watched[0].rating, 8);
});

test("preserves personal records through moves, metadata refreshes, and repeated saves", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.saveItem(movie(), "watchlist", { notes: "Try with family" });
  const addedAt = store.getSnapshot().watchlist[0].addedAt;
  store.saveItem(movie(), "watched", {
    rating: 9.5,
    watchedDate: "2026-10-20",
  });
  store.saveItem(
    movie(1, {
      title: "Updated title",
      rating: 0,
      notes: "",
      addedAt: "2099-01-01",
    }),
    "watched",
  );
  const repeated = store.getSnapshot();
  assert.equal(repeated.watchlist.length, 0);
  assert.equal(repeated.watched.length, 1);
  assert.equal(repeated.watched[0].rating, 9.5);
  assert.equal(repeated.watched[0].notes, "Try with family");
  assert.equal(repeated.watched[0].addedAt, addedAt);
  assert.equal(repeated.watched[0].watchedDate, "2026-10-20");
  store.saveItem({ id: 1 }, "watchlist");
  assert.equal(store.getSnapshot().watchlist[0].title, "Updated title");
  store.saveItem({ id: 1 }, "watched");
  assert.equal(store.getSnapshot().watched[0].rating, 9.5);
  assert.equal(store.getSnapshot().watched[0].watchedDate, "2026-10-20");
  store.updateItem(1, "movie", { rating: 0, notes: "", watchedDate: "" });
  assert.equal(store.getSnapshot().watched[0].notes, "");
  assert.equal(store.getSnapshot().watched[0].rating, 0);
  assert.equal(store.getSnapshot().watched[0].watchedDate, "");
});

test("repeated callbacks cannot duplicate a title or reorder existing saves", () => {
  const store = createLibraryStore(new MemoryStorage());
  store.saveItem(movie(1), "watchlist");
  store.saveItem(movie(2), "watchlist");
  for (let count = 0; count < 5; count++) store.saveItem(movie(1), "watchlist");
  assert.deepEqual(
    store.getSnapshot().watchlist.map((item) => item.id),
    [1, 2],
  );
  store.saveItem(movie(1, { mediaType: "tv" }), "watchlist");
  assert.equal(store.getSnapshot().watchlist.length, 3);
});

test("failed writes leave memory, persistent data, undo, and subscribers consistent", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.load();
  store.saveItem(movie(1), "watchlist");
  const before = store.getSnapshot();
  const rawBefore = storage.getItem("movieTrackerData");
  let publications = 0;
  store.subscribe(() => publications++);
  storage.failKey = "movieTrackerData";
  assert.throws(
    () => store.saveItem(movie(2), "watched"),
    /could not be saved/,
  );
  assert.deepEqual(store.getSnapshot(), before);
  assert.equal(storage.getItem("movieTrackerData"), rawBefore);
  assert.equal(publications, 0);
  storage.failKey = null;
  store.undo();
  assert.equal(store.getSnapshot().watchlist.length, 0);
});

test("subscriber sees durable data and receives its own isolated snapshot", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.load();
  let calls = 0;
  const unsubscribe = store.subscribe((snapshot) => {
    calls++;
    assert.equal(
      JSON.parse(storage.getItem("movieTrackerData")).watchlist[0].title,
      snapshot.watchlist[0].title,
    );
    snapshot.watchlist[0].title = "Changed by view";
  });
  store.saveItem(movie(1), "watchlist");
  assert.equal(calls, 1);
  assert.equal(store.getSnapshot().watchlist[0].title, "Movie 1");
  const snapshot = store.getSnapshot();
  snapshot.watchlist.splice(0);
  assert.equal(store.getSnapshot().watchlist.length, 1);
  unsubscribe();
  store.saveItem(movie(2), "watchlist");
  assert.equal(calls, 1);
});

test("malformed originals are preserved and backed up before the first change", () => {
  const original = "{broken";
  const storage = new MemoryStorage({ movieTrackerData: original });
  const store = createLibraryStore(storage);
  assert.match(store.load().warning, /original data is kept/);
  assert.equal(storage.getItem("movieTrackerData"), original);
  assert.equal(storage.writes.length, 0);
  store.saveItem(movie(), "watchlist");
  const backup = storage.writes.find((write) =>
    write.key.startsWith("movieTrackerData.recovery."),
  );
  assert.equal(backup.value, original);
  assert.ok(
    storage.writes.indexOf(backup) <
      storage.writes.findIndex((write) => write.key === "movieTrackerData"),
  );
  assert.equal(store.getSnapshot().warning, undefined);
});

test("cannot overwrite damaged data when a recovery copy cannot be saved", () => {
  const storage = new MemoryStorage({ movieTrackerData: "damaged" });
  const store = createLibraryStore(storage);
  const before = store.load();
  storage.failKey = "recovery";
  assert.throws(
    () => store.saveItem(movie(), "watchlist"),
    /previous library is still intact/,
  );
  assert.equal(storage.getItem("movieTrackerData"), "damaged");
  assert.deepEqual(store.getSnapshot(), before);
});

test("salvages valid stored titles and preserves the raw data with invalid records", () => {
  const original = saved(
    [movie(), { id: -10 }, movie(3, { rating: 42, genres: "bad" })],
    [],
  );
  const storage = new MemoryStorage({ movieTrackerData: original });
  const result = createLibraryStore(storage).load();
  assert.deepEqual(
    result.watchlist.map((item) => item.id),
    [1, 3],
  );
  assert.equal(result.watchlist[1].rating, 0);
  assert.deepEqual(result.watchlist[1].genres, []);
  assert.match(result.warning, /original data is kept/);
  assert.equal(storage.getItem("movieTrackerData"), original);
});

test("canonical hidden titles override the legacy mirror, whose write failure is recoverable", () => {
  const storage = new MemoryStorage({
    movieTrackerData: saved([], [], { version: 2, hiddenItems: ["tv-9"] }),
    hiddenItems: '["movie-8"]',
  });
  const store = createLibraryStore(storage);
  assert.deepEqual(store.load().hiddenItems, ["tv-9"]);
  storage.failKey = "hiddenItems";
  const result = store.setHidden(8, "movie", true);
  assert.match(result.warning, /library is saved/);
  assert.deepEqual(
    JSON.parse(storage.getItem("movieTrackerData")).hiddenItems,
    ["tv-9", "movie-8"],
  );
  assert.deepEqual(createLibraryStore(storage).load().hiddenItems, [
    "tv-9",
    "movie-8",
  ]);
});

test("imports merge without destroying current notes, ratings, other titles, or media types", () => {
  const store = createLibraryStore(new MemoryStorage());
  store.saveItem(movie(1), "watched", {
    rating: 9,
    notes: "My existing review",
    watchedDate: "2025-01-01",
  });
  store.saveItem(movie(2), "watchlist");
  store.setHidden(30, "movie", true);
  store.importData(
    saved(
      [movie(1), movie(1, { mediaType: "tv" })],
      [movie(3), movie(1, { rating: 5, notes: "Imported review" })],
      { version: 2, hiddenItems: ["tv-30"] },
    ),
  );
  const result = store.getSnapshot();
  assert.deepEqual(
    result.watchlist.map((item) => `${item.mediaType}-${item.id}`).sort(),
    ["movie-2", "tv-1"],
  );
  assert.deepEqual(result.watched.map((item) => item.id).sort(), [1, 3]);
  const existing = result.watched.find((item) => item.id === 1);
  assert.equal(existing.notes, "My existing review");
  assert.equal(existing.rating, 9);
  assert.equal(existing.watchedDate, "2025-01-01");
  assert.deepEqual(result.hiddenItems, ["movie-30", "tv-30"]);
});

test("legacy import upgrades watchlist to watched and fills missing personal records", () => {
  const store = createLibraryStore(new MemoryStorage());
  store.saveItem(movie(1), "watchlist");
  store.importData(
    saved(
      [],
      [
        movie(1, {
          rating: 7.5,
          review: "From old backup",
          watchedDate: "2024-12-20",
        }),
      ],
    ),
  );
  const result = store.getSnapshot();
  assert.equal(result.watchlist.length, 0);
  assert.equal(result.watched.length, 1);
  assert.equal(result.watched[0].rating, 7.5);
  assert.equal(result.watched[0].notes, "From old backup");
  assert.equal(result.watched[0].watchedDate, "2024-12-20");
});

test("rejects an entire malformed import before changing data", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.saveItem(movie(1), "watchlist");
  const before = store.getSnapshot();
  const writesBefore = storage.writes.length;
  const invalid = [
    "not json",
    "[]",
    "{}",
    saved([movie(5), { title: "Missing identifier" }]),
    saved([movie(5)], [], { version: 99 }),
    saved([movie(5, { rating: 0.5 })]),
    saved([movie(5, { rating: true })]),
    saved([movie(5, { rating: 11 })]),
    saved([movie(5, { rating: 8.3 })]),
    saved([movie(5, { watchedDate: "2026-02-31" })]),
    saved([movie(5, { addedAt: "2026-02-31" })]),
    saved([movie(5, { notes: { invalid: true } })]),
    saved([movie(5, { mediaType: "person" })]),
    saved([movie(5)], [], { hiddenItems: ["person-1"] }),
    '{"watchlist":[{"id":5,"__proto__":{"polluted":true}}],"watched":[]}',
    '{"watchlist":[{"id":5,"metadata":{"constructor":{"prototype":{"polluted":true}}}}],"watched":[]}',
  ];
  for (const text of invalid) {
    assert.throws(() => store.importData(text), Error, text);
    assert.deepEqual(store.getSnapshot(), before);
    assert.equal(storage.writes.length, writesBefore);
  }
  assert.equal({}.polluted, undefined);
});

test("exports versioned data that can round-trip and includes hidden titles", () => {
  const store = createLibraryStore(new MemoryStorage());
  store.saveItem(
    movie(1, { externalIds: { imdb_id: "tt00001" }, vote_average: 8.4 }),
    "watched",
    { notes: "A film", rating: 8.5, watchedDate: "2026-10-23" },
  );
  store.setHidden(9, "tv", true);
  const other = createLibraryStore(new MemoryStorage());
  other.importData(store.exportData());
  assert.deepEqual(other.getSnapshot(), store.getSnapshot());
});

test("hiding, restoring, removal, and undo are durable compound-key changes", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.saveItem(movie(1), "watchlist");
  store.saveItem(movie(1, { mediaType: "tv" }), "watched");
  store.setHidden(1, "movie", true);
  store.setHidden(1, "movie", true);
  assert.deepEqual(store.getSnapshot().hiddenItems, ["movie-1"]);
  store.setHidden(1, "tv", true);
  store.restoreHidden();
  assert.deepEqual(store.getSnapshot().hiddenItems, []);
  store.undo();
  assert.deepEqual(store.getSnapshot().hiddenItems, ["movie-1", "tv-1"]);
  assert.throws(() => store.undo(), /no saved change/);
  store.removeItem(1, "movie");
  assert.equal(store.getSnapshot().watchlist.length, 0);
  assert.equal(store.getSnapshot().watched.length, 1);
  store.undo();
  assert.equal(createLibraryStore(storage).load().watchlist.length, 1);
});

test("detects external edits before writes and reload refreshes subscribers", () => {
  const storage = new MemoryStorage();
  const first = createLibraryStore(storage);
  const second = createLibraryStore(storage);
  first.load();
  second.load();
  first.saveItem(movie(1), "watchlist");
  assert.throws(() => second.saveItem(movie(2), "watchlist"), /another tab/);
  assert.equal(second.getSnapshot().watchlist.length, 0);
  let publications = 0;
  second.subscribe(() => publications++);
  second.load();
  assert.equal(publications, 1);
  second.saveItem(movie(2), "watchlist");
  assert.deepEqual(
    second.getSnapshot().watchlist.map((item) => item.id),
    [1, 2],
  );
});

test("storage access errors are recoverable and never start with an apparent successful empty save", () => {
  const storage = new MemoryStorage({ movieTrackerData: saved([movie(1)]) });
  storage.failRead = true;
  const store = createLibraryStore(storage);
  assert.match(store.load().warning, /cannot be accessed/);
  assert.throws(
    () => store.saveItem(movie(2), "watchlist"),
    /cannot be accessed/,
  );
  assert.equal(storage.writes.length, 0);
  storage.failRead = false;
  assert.equal(store.load().watchlist.length, 1);
  store.saveItem(movie(2), "watchlist");
  assert.equal(store.getSnapshot().watchlist.length, 2);
});

test("rejects malformed genre and person entries before importing any title", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.saveItem(movie(1), "watchlist", { notes: "Keep this record" });
  const before = store.getSnapshot();
  const writesBefore = storage.writes.length;
  const malformedMetadata = [
    { genres: [null] },
    { genres: [{ id: 16, name: null }] },
    { genres: [{ id: 0, name: "Animation" }] },
    { genres: [{ id: 16, name: " " }] },
    { genres: ["Animation"] },
    { cast: [null] },
    { cast: [{ name: 23 }] },
    { cast: [{ name: "Actor", id: -1 }] },
    { cast: [{ name: "Actor", character: {} }] },
    { cast: [{ name: "Actor", profile_path: 2 }] },
    { crew: [null] },
    { crew: [{ job: "Director" }] },
    { crew: [{ name: "Director", job: [] }] },
    { credits: { cast: [null] } },
    { credits: { crew: "invalid" } },
    { genre_ids: "invalid" },
    { genre_ids: [16, null] },
  ];
  for (const metadata of malformedMetadata) {
    assert.throws(
      () => store.importData(saved([movie(2), movie(3, metadata)])),
      Error,
      JSON.stringify(metadata),
    );
    assert.deepEqual(store.getSnapshot(), before);
    assert.equal(storage.writes.length, writesBefore);
  }
});

test("lenient load drops malformed metadata entries while preserving valid titles and original data", () => {
  const original = saved([
    movie(1, {
      genres: [null, { id: 16, name: "Animation" }, { id: 5, name: null }],
      cast: [
        null,
        { name: "Legacy actor" },
        { name: "Broken actor", character: {} },
      ],
      crew: [null, { name: "Director", job: "Director" }, { name: null }],
      credits: {
        cast: [null, { name: "Another actor" }],
        crew: [{ name: "Writer", job: "Writer" }],
      },
      genre_ids: [null, 16, -1],
    }),
  ]);
  const storage = new MemoryStorage({ movieTrackerData: original });
  const store = createLibraryStore(storage);
  const snapshot = store.load();
  const item = snapshot.watchlist[0];
  assert.deepEqual(item.genres, [{ id: 16, name: "Animation" }]);
  assert.deepEqual(item.cast, [{ name: "Legacy actor" }]);
  assert.deepEqual(item.crew, [{ name: "Director", job: "Director" }]);
  assert.deepEqual(item.credits.cast, [{ name: "Another actor" }]);
  assert.deepEqual(item.genre_ids, [16]);
  assert.match(snapshot.warning, /original data is kept/);
  assert.equal(storage.getItem("movieTrackerData"), original);
  store.updateItem(1, "movie", { notes: "Safe to browse" });
  assert.ok(
    storage.writes.some(
      (write) =>
        write.key.startsWith("movieTrackerData.recovery.") &&
        write.value === original,
    ),
  );
});

test("accepts complete TMDB credits and legacy name-only cast or crew", () => {
  const store = createLibraryStore(new MemoryStorage());
  const cast = [
    { name: "Legacy actor" },
    {
      id: "12",
      name: "TMDB actor",
      original_name: "Actor",
      character: "Lead",
      gender: 0,
      order: 0,
      popularity: 0,
      profile_path: null,
      adult: false,
    },
  ];
  const crew = [
    { name: "Legacy director" },
    {
      id: 30,
      name: "Director",
      job: "Director",
      department: "Directing",
      credit_id: "abc",
    },
  ];
  store.importData(
    saved([
      movie(5, { genres: [{ id: "16", name: "Animation" }], cast, crew }),
    ]),
  );
  const item = store.getSnapshot().watchlist[0];
  assert.equal(item.genres[0].id, 16);
  assert.equal(item.cast[1].id, 12);
  assert.equal(item.cast[1].character, "Lead");
  assert.deepEqual(item.cast[0], { name: "Legacy actor" });
  assert.deepEqual(item.crew, crew);
});

test("legacy watched records gain one stable viewing without inventing watchlist events", () => {
  const storage = new MemoryStorage({
    movieTrackerData: saved(
      [movie(2)],
      [
        movie(1, {
          watchedDate: "2020-01-02",
          rating: 8.5,
          notes: "Original review",
        }),
      ],
    ),
  });
  const store = createLibraryStore(storage);
  const migrated = store.load();
  assert.deepEqual(migrated.watchlist[0].logs, []);
  assert.deepEqual(migrated.watched[0].logs, [
    {
      id: "legacy:movie:1",
      date: "2020-01-02",
      rating: 8.5,
      notes: "Original review",
    },
  ]);
  assert.deepEqual(store.load().watched[0].logs, migrated.watched[0].logs);
  store.updateItem(1, "movie", { tags: [" Favorite ", "favorite", "Family"] });
  assert.deepEqual(store.getSnapshot().watched[0].tags, ["Favorite", "Family"]);
  assert.equal(createLibraryStore(storage).load().watched[0].logs.length, 1);
  store.importData(store.exportData());
  assert.equal(store.getSnapshot().watched[0].logs.length, 1);
});

test("organizing and TV progress fields survive metadata refresh and status moves", () => {
  const store = createLibraryStore(new MemoryStorage());
  const show = movie(1, { mediaType: "tv" });
  const progress = {
    watchedEpisodes: 3,
    totalEpisodes: 8,
    status: "paused",
    currentSeason: 1,
    currentEpisode: 3,
  };
  store.saveItem(show, "watchlist", {
    tags: [" With Sam "],
    favorite: true,
    priority: "high",
    progress,
  });
  store.saveItem(
    {
      ...show,
      tags: [],
      favorite: false,
      priority: "low",
      progress: { watchedEpisodes: 0, totalEpisodes: 0, status: "planned" },
    },
    "watchlist",
  );
  assert.deepEqual(store.getSnapshot().watchlist[0].progress, progress);
  assert.equal(store.getSnapshot().watchlist[0].favorite, true);
  assert.deepEqual(store.getSnapshot().watchlist[0].tags, ["With Sam"]);
  assert.equal(store.getSnapshot().watchlist[0].priority, "high");
  store.updateItem(1, "tv", {
    progress: { ...progress, watchedEpisodes: 4, status: "watching" },
  });
  assert.equal(store.getSnapshot().watchlist.length, 1);
  assert.equal(store.getSnapshot().watched.length, 0);
  store.saveItem(show, "watched");
  assert.equal(store.getSnapshot().watched[0].logs.length, 1);
  store.saveItem(show, "watchlist");
  store.saveItem(show, "watched");
  assert.equal(store.getSnapshot().watched[0].logs.length, 1);
  assert.equal(store.getSnapshot().watched[0].progress.watchedEpisodes, 4);
});

test("logging a first watch and rewatches atomically preserves personal notes and event identities", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.saveItem(movie(1), "watchlist", {
    notes: "Watch with family",
    tags: ["Family"],
    priority: "high",
  });
  let calls = 0;
  store.subscribe(() => calls++);
  store.logWatch(
    movie(1, { notes: "API cannot replace personal notes", tags: [] }),
    { date: "2026-05-02", rating: 8.5, notes: "First screening" },
    { favorite: true },
  );
  assert.equal(calls, 1);
  const first = store.getSnapshot().watched[0];
  assert.equal(store.getSnapshot().watchlist.length, 0);
  assert.equal(first.notes, "Watch with family");
  assert.deepEqual(first.tags, ["Family"]);
  assert.equal(first.favorite, true);
  assert.equal(first.rating, 8.5);
  assert.equal(first.logs.length, 1);
  assert.equal(first.logs[0].notes, "First screening");
  store.logWatch(movie(1), {
    date: "2025-01-01",
    rating: 0,
    notes: "Earlier viewing",
  });
  const result = store.getSnapshot().watched[0];
  assert.equal(result.logs.length, 2);
  assert.equal(new Set(result.logs.map((log) => log.id)).size, 2);
  assert.equal(result.watchedDate, "2026-05-02");
  assert.equal(result.rating, 8.5);
  assert.equal(result.notes, "Watch with family");
  store.undo();
  assert.deepEqual(store.getSnapshot().watched[0], first);
});

test("viewing journal edits preserve overall rating and notes, and empty journals remain empty", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.logWatch(
    movie(1),
    { date: "2026-01-01", rating: 7, notes: "Event one" },
    { notes: "Overall notes", rating: 9 },
  );
  store.logWatch(movie(1), {
    date: "2026-03-01",
    rating: 0,
    notes: "Event two",
  });
  const [first, second] = store.getSnapshot().watched[0].logs;
  store.updateLog(1, "movie", first.id, {
    date: "2026-04-01",
    rating: 8,
    notes: "Edited event",
  });
  let item = store.getSnapshot().watched[0];
  assert.equal(item.watchedDate, "2026-04-01");
  assert.equal(item.rating, 9);
  assert.equal(item.notes, "Overall notes");
  store.removeLog(1, "movie", first.id);
  assert.equal(store.getSnapshot().watched[0].watchedDate, "2026-03-01");
  store.removeLog(1, "movie", second.id);
  item = createLibraryStore(storage).load().watched[0];
  assert.deepEqual(item.logs, []);
  assert.equal(item.watchedDate, "");
  assert.equal(item.rating, 9);
  assert.equal(item.notes, "Overall notes");
  store.updateItem(1, "movie", { rating: 6, notes: "Changed overall" });
  assert.deepEqual(store.getSnapshot().watched[0].logs, []);
  assert.throws(
    () => store.updateLog(1, "movie", first.id, { notes: "Lost" }),
    /no longer/,
  );
});

test("journal writes fail atomically and reject invalid event changes", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.logWatch(movie(1), { date: "", rating: 5 });
  const before = store.getSnapshot();
  for (const event of [
    { date: "2026-02-31" },
    { rating: 0.5 },
    { notes: {} },
  ]) {
    assert.throws(() => store.logWatch(movie(1), event));
    assert.deepEqual(store.getSnapshot(), before);
  }
  storage.failKey = "movieTrackerData";
  assert.throws(
    () => store.logWatch(movie(1), { date: "2026-01-01" }),
    /could not be saved/,
  );
  assert.deepEqual(store.getSnapshot(), before);
  storage.failKey = null;
  store.undo();
  assert.equal(store.getSnapshot().watched.length, 0);
});

test("imports reject any malformed personal fields and keep the whole existing library intact", () => {
  const store = createLibraryStore(new MemoryStorage());
  store.saveItem(movie(1), "watchlist");
  const before = store.getSnapshot();
  const log = {
    id: "one",
    date: "2026-01-01",
    rating: 7.5,
    notes: "A viewing",
  };
  const progress = { watchedEpisodes: 1, totalEpisodes: 8, status: "watching" };
  for (const fields of [
    { tags: "A list" },
    { tags: [null] },
    { tags: [""] },
    { tags: ["x".repeat(61)] },
    { tags: Array.from({ length: 21 }, (_, index) => `Tag ${index}`) },
    { favorite: "true" },
    { priority: "urgent" },
    { logs: {} },
    { logs: [null] },
    { logs: [{ ...log, id: "" }] },
    { logs: [log, log] },
    { logs: [{ ...log, date: "2026-02-31" }] },
    { logs: [{ ...log, rating: 8.3 }] },
    { logs: [{ ...log, notes: {} }] },
    { progress: [] },
    { progress: { ...progress, watchedEpisodes: -1 } },
    { progress: { ...progress, totalEpisodes: 0.5 } },
    { progress: { ...progress, watchedEpisodes: 9 } },
    { progress: { ...progress, status: "unknown" } },
    { progress: { ...progress, currentSeason: -1 } },
    { progress: { ...progress, watchedEpisodes: 100001, totalEpisodes: 0 } },
    { progress: { ...progress, totalEpisodes: 100001 } },
    { progress: { ...progress, currentSeason: 10001 } },
    { progress: { ...progress, currentEpisode: 100001 } },
  ]) {
    assert.throws(
      () => store.importData(saved([movie(2), movie(3, fields)])),
      Error,
      JSON.stringify(fields),
    );
    assert.deepEqual(store.getSnapshot(), before);
  }
});

test("lenient recovery salvages new personal fields and protects their invalid originals", () => {
  const original = saved([
    movie(1, {
      tags: [" Family ", null, "family"],
      favorite: "true",
      priority: "urgent",
      logs: [
        { id: "one", date: "2026-02-31", rating: 12, notes: "Keep notes" },
        null,
      ],
      progress: {
        watchedEpisodes: 10,
        totalEpisodes: 8,
        status: "watching",
        currentEpisode: -1,
      },
    }),
  ]);
  const storage = new MemoryStorage({ movieTrackerData: original });
  const store = createLibraryStore(storage);
  const result = store.load();
  assert.deepEqual(result.watchlist[0].tags, ["Family"]);
  assert.equal(result.watchlist[0].logs[0].notes, "Keep notes");
  assert.equal(result.watchlist[0].logs[0].date, "");
  assert.equal(result.watchlist[0].progress.watchedEpisodes, 10);
  assert.equal(result.watchlist[0].progress.totalEpisodes, 10);
  assert.match(result.warning, /original data is kept/);
  assert.equal(storage.getItem("movieTrackerData"), original);
  store.updateItem(1, "movie", { notes: "Safe change" });
  assert.ok(
    storage.writes.some(
      (write) => write.key.includes(".recovery.") && write.value === original,
    ),
  );
});

test("metadata refresh preserves organizing fields and the user's previous undo action", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.saveItem(movie(1), "watchlist", {
    notes: "Original notes",
    favorite: true,
    tags: ["Family"],
    priority: "high",
  });
  store.saveItem(movie(2), "watchlist");
  store.updateMetadata(1, "movie", {
    id: 99,
    mediaType: "tv",
    title: "Better title",
    runtime: 100,
    notes: "API notes",
    favorite: false,
    tags: [],
    priority: "low",
    logs: [],
    rating: 10,
  });
  let item = store.getSnapshot().watchlist[0];
  assert.equal(item.id, 1);
  assert.equal(item.mediaType, "movie");
  assert.equal(item.title, "Better title");
  assert.equal(item.notes, "Original notes");
  assert.equal(item.favorite, true);
  assert.equal(item.priority, "high");
  assert.deepEqual(item.tags, ["Family"]);
  store.undo();
  assert.deepEqual(
    store.getSnapshot().watchlist.map((entry) => entry.id),
    [1],
  );
  item = store.getSnapshot().watchlist[0];
  assert.equal(item.title, "Better title");
  assert.equal(item.runtime, 100);
  assert.equal(item.notes, "Original notes");
  assert.throws(() => store.undo(), /no saved change/);
});

test("failed metadata refresh preserves both current data and undo", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.saveItem(movie(1), "watchlist");
  storage.failKey = "movieTrackerData";
  assert.throws(
    () => store.updateMetadata(1, "movie", { title: "Changed" }),
    /could not be saved/,
  );
  assert.equal(store.getSnapshot().watchlist[0].title, "Movie 1");
  storage.failKey = null;
  store.undo();
  assert.equal(store.getSnapshot().watchlist.length, 0);
});

test("canonical movie and TV metadata passes strict storage validation and round trips with personal fields", () => {
  const store = createLibraryStore(new MemoryStorage());
  for (const mediaType of ["movie", "tv"]) {
    const metadata = metadataForStorage({
      id: 42,
      mediaType,
      title: "Canonical title",
      name: "Canonical title",
      release_date: "2020-01-01",
      first_air_date: "2020-01-01",
      poster_path: null,
      backdrop_path: "/backdrop.jpg",
      overview: "Synopsis",
      runtime: 90,
      vote_average: 7.8,
      vote_count: 100,
      tagline: "A tagline",
      number_of_episodes: 8,
      number_of_seasons: 1,
      status: "Released",
      original_language: "en",
      genres: [{ id: 18, name: "Drama" }],
      cast: [
        {
          id: 1,
          name: "Actor",
          original_name: "Actor",
          character: "Lead",
          profile_path: null,
          order: 0,
        },
      ],
      crew: [
        {
          id: 2,
          name: "Director",
          original_name: "Director",
          job: "Director",
          department: "Directing",
          profile_path: null,
        },
      ],
      externalIds: { imdb_id: "tt1234567", tvdb_id: 42, wikidata_id: null },
      watchProviders: {
        link: "https://www.themoviedb.org/movie/42/watch",
        flatrate: [
          {
            provider_id: 8,
            provider_name: "Netflix",
            logo_path: null,
            display_priority: 0,
          },
        ],
      },
      belongs_to_collection: {
        id: 12,
        name: "Collection",
        poster_path: null,
        backdrop_path: null,
      },
    });
    store.saveItem(metadata, "watchlist", {
      tags: ["Family"],
      favorite: true,
      notes: "Personal notes",
    });
    store.logWatch(metadata, {
      date: "2026-01-01",
      rating: 8.5,
      notes: "Screening notes",
    });
    store.updateMetadata(42, mediaType, {
      ...metadata,
      title: "Refreshed title",
    });
    const item = store
      .getSnapshot()
      .watched.find((entry) => entry.mediaType === mediaType);
    assert.equal(item.title, "Refreshed title");
    assert.equal(item.notes, "Personal notes");
    assert.deepEqual(item.tags, ["Family"]);
    assert.equal(item.logs[0].notes, "Screening notes");
    assert.equal(item.watchProviders.flatrate[0].display_priority, 0);
  }
  const restored = createLibraryStore(new MemoryStorage());
  restored.importData(store.exportData());
  assert.deepEqual(restored.getSnapshot(), store.getSnapshot());
});

test("unknown viewing dates stay unknown through record edits, favorite toggles, moves, and reloads", () => {
  const storage = new MemoryStorage();
  const store = createLibraryStore(storage);
  store.logWatch(movie(1), { date: "", rating: 8 });
  store.saveItem(movie(1), "watched", {
    favorite: true,
    notes: "An unrelated edit",
  });
  assert.equal(store.getSnapshot().watched[0].watchedDate, "");
  assert.equal(store.getSnapshot().watched[0].logs[0].date, "");
  store.saveItem(movie(1), "watchlist");
  store.saveItem(movie(1), "watched");
  assert.equal(store.getSnapshot().watched[0].watchedDate, "");
  assert.equal(store.getSnapshot().watched[0].logs.length, 1);
  const loaded = createLibraryStore(storage).load();
  assert.equal(loaded.watched[0].watchedDate, "");
  assert.equal(loaded.watched[0].logs[0].date, "");

  const legacy = createLibraryStore(
    new MemoryStorage({ movieTrackerData: saved([], [movie(2)]) }),
  );
  legacy.load();
  legacy.updateItem(2, "movie", { notes: "Still unknown" });
  assert.equal(legacy.getSnapshot().watched[0].watchedDate, "");
  assert.equal(legacy.getSnapshot().watched[0].logs[0].date, "");
});

test("initial status transitions can default a viewing date without changing deliberate unknown dates", () => {
  const store = createLibraryStore(new MemoryStorage());
  store.saveItem(movie(1), "watchlist");
  store.saveItem(movie(1), "watched");
  assert.match(
    store.getSnapshot().watched[0].logs[0].date,
    /^\d{4}-\d{2}-\d{2}$/,
  );
  store.saveItem(movie(2), "watched", { watchedDate: "" });
  store.updateItem(2, "movie", { favorite: true });
  assert.equal(
    store.getSnapshot().watched.find((item) => item.id === 2).watchedDate,
    "",
  );
});

test("import preserves every current ongoing TV state against older completed backups", () => {
  for (const progressStatus of ["watching", "paused", "dropped", "planned"]) {
    const store = createLibraryStore(new MemoryStorage());
    const show = movie(1, { mediaType: "tv" });
    const progress = {
      watchedEpisodes: 3,
      totalEpisodes: 8,
      status: progressStatus,
      currentSeason: 1,
      currentEpisode: 3,
    };
    store.saveItem(show, "watchlist", {
      progress,
      rating: 0,
      notes: "Current plans",
      favorite: false,
      priority: "normal",
    });
    store.importData(
      saved(
        [],
        [
          {
            ...show,
            rating: 9,
            notes: "Old completion",
            favorite: true,
            priority: "high",
            watchedDate: "2020-01-01",
            progress: {
              watchedEpisodes: 8,
              totalEpisodes: 8,
              status: "completed",
            },
          },
        ],
      ),
    );
    const result = store.getSnapshot();
    assert.equal(result.watched.length, 0, progressStatus);
    assert.equal(result.watchlist.length, 1, progressStatus);
    assert.deepEqual(result.watchlist[0].progress, progress, progressStatus);
    assert.equal(result.watchlist[0].rating, 0);
    assert.equal(result.watchlist[0].notes, "Current plans");
    assert.equal(result.watchlist[0].favorite, false);
    assert.equal(result.watchlist[0].priority, "normal");
    assert.equal(result.watchlist[0].logs[0].notes, "Old completion");
  }
});

test("import preserves a planned movie rewatch and merges its viewing history without changing current personal records", () => {
  const store = createLibraryStore(new MemoryStorage());
  store.logWatch(
    movie(1),
    { date: "2026-01-01", rating: 8, notes: "Recent viewing" },
    { notes: "Watch again with family" },
  );
  store.saveItem(movie(1), "watchlist", {
    rating: 0,
    favorite: false,
    priority: "normal",
  });
  const originalId = store.getSnapshot().watchlist[0].logs[0].id;
  const backup = saved(
    [],
    [
      movie(1, {
        rating: 10,
        notes: "Old notes",
        watchedDate: "2020-01-01",
        favorite: true,
        priority: "high",
      }),
    ],
  );
  store.importData(backup);
  store.importData(backup);
  const result = store.getSnapshot();
  assert.equal(result.watched.length, 0);
  const item = result.watchlist[0];
  assert.equal(item.rating, 0);
  assert.equal(item.notes, "Watch again with family");
  assert.equal(item.favorite, false);
  assert.equal(item.priority, "normal");
  assert.equal(item.logs.length, 2);
  assert.ok(item.logs.some((log) => log.id === originalId));
  assert.equal(item.watchedDate, "2026-01-01");
});

test("current favorite false and priority normal win while newly imported records restore their preferences", () => {
  const store = createLibraryStore(new MemoryStorage());
  store.saveItem(movie(1), "watchlist", {
    favorite: false,
    priority: "normal",
  });
  store.importData(
    saved([
      movie(1, { favorite: true, priority: "high" }),
      movie(2, { favorite: true, priority: "high" }),
    ]),
  );
  const [current, restored] = store.getSnapshot().watchlist;
  assert.equal(current.favorite, false);
  assert.equal(current.priority, "normal");
  assert.equal(restored.favorite, true);
  assert.equal(restored.priority, "high");
});

test("current edited journal entries and cleared main fields win over the same imported event ID", () => {
  const store = createLibraryStore(new MemoryStorage());
  store.logWatch(
    movie(1),
    { date: "2026-01-01", rating: 9, notes: "Old event notes" },
    { notes: "Old main notes" },
  );
  const id = store.getSnapshot().watched[0].logs[0].id;
  const olderBackup = store.exportData();
  store.updateLog(1, "movie", id, {
    date: "",
    rating: 0,
    notes: "Edited event notes",
  });
  store.updateItem(1, "movie", { rating: 0, notes: "" });
  store.importData(olderBackup);
  const item = store.getSnapshot().watched[0];
  assert.equal(item.logs.length, 1);
  assert.deepEqual(item.logs[0], {
    id,
    date: "",
    rating: 0,
    notes: "Edited event notes",
  });
  assert.equal(item.watchedDate, "");
  assert.equal(item.rating, 0);
  assert.equal(item.notes, "");
  assert.equal(item.review, "");
});

test("imports calculate the latest known date from merged events and preserve undated-only history", () => {
  const store = createLibraryStore(new MemoryStorage());
  store.logWatch(movie(1), { date: "2026-01-01", notes: "Current" });
  const imported = movie(1, {
    watchedDate: "2099-01-01",
    logs: [
      {
        id: "imported-newer",
        date: "2026-02-01",
        rating: 0,
        notes: "Another viewing",
      },
      { id: "imported-unknown", date: "", rating: 0, notes: "Unknown date" },
    ],
  });
  store.importData(
    saved(
      [],
      [
        imported,
        movie(2, {
          watchedDate: "2099-01-01",
          logs: [{ id: "unknown", date: "", rating: 0, notes: "Unknown" }],
        }),
      ],
    ),
  );
  const result = store.getSnapshot();
  assert.equal(
    result.watched.find((item) => item.id === 1).watchedDate,
    "2026-02-01",
  );
  assert.equal(result.watched.find((item) => item.id === 1).logs.length, 3);
  assert.equal(result.watched.find((item) => item.id === 2).watchedDate, "");
});
