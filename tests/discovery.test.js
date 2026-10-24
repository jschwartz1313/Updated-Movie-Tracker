import test from "node:test";
import assert from "node:assert/strict";
import {
  createMovieClient,
  describeFilters,
  normalizeFilters,
  parseDiscoveryQuery,
} from "../lib/discovery.js";

const TODAY = "2026-10-23";
const now = () => new Date(`${TODAY}T12:00:00Z`);
const movie = (id, extra = {}) => ({
  id,
  title: `Movie ${id}`,
  release_date: "2005-04-12",
  genre_ids: [16],
  vote_average: 8,
  vote_count: 1000,
  ...extra,
});
const response = (body, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});
const page = (
  results,
  pageNumber = 1,
  totalPages = 1,
  totalResults = results.length,
) => ({
  results,
  page: pageNumber,
  total_pages: totalPages,
  total_results: totalResults,
});
const client = (fetchImpl, options = {}) =>
  createMovieClient({ fetchImpl, now, retries: 0, ...options });

test("the requested top 50 animated movies since 2000 becomes explicit discover filters", () => {
  assert.deepEqual(parseDiscoveryQuery("top 50 animated movies since 2000"), {
    mode: "discover",
    query: "",
    mediaType: "movie",
    genreId: "16",
    yearFrom: "2000",
    yearTo: String(new Date().getFullYear()),
    sort: "rating",
    minVotes: 500,
    minRating: 0,
    runtimeMin: "",
    runtimeMax: "",
    originalLanguage: "",
    watchProviderId: "",
    watchProviderName: "",
    watchRegion: "US",
    personId: "",
    personName: "",
    personRole: "cast",
    includeUpcoming: false,
    limit: 50,
    recognized: true,
  });
});

test("natural language supports precise ranges, genre aliases, media and counts", () => {
  const f = parseDiscoveryQuery("best 25 sci-fi movies between 2000 and 2010");
  assert.equal(f.genreId, "878");
  assert.equal(f.yearFrom, "2000");
  assert.equal(f.yearTo, "2010");
  assert.equal(f.limit, 25);
  assert.equal(f.sort, "rating");
  assert.equal(f.recognized, true);
  const tv = parseDiscoveryQuery(
    "show me the most popular animated TV shows from 2010 to 2020",
  );
  assert.equal(tv.mediaType, "tv");
  assert.equal(tv.genreId, "16");
  assert.equal(tv.sort, "popular");
  assert.equal(tv.yearFrom, "2010");
  assert.equal(tv.yearTo, "2020");
});

test("year words have explicit inclusive and exclusive meanings", () => {
  assert.equal(parseDiscoveryQuery("movies after 2000").yearFrom, "2001");
  assert.equal(parseDiscoveryQuery("movies before 2010").yearTo, "2009");
  assert.equal(parseDiscoveryQuery("movies through 2010").yearTo, "2010");
  const exact = parseDiscoveryQuery("movies released in 2005");
  assert.equal(exact.yearFrom, "2005");
  assert.equal(exact.yearTo, "2005");
});

test("common hyphen ranges, release years and complete decades are recognized", () => {
  for (const text of [
    "top 50 animated movies from 2000-2020",
    "top 50 animated movies between 2000–2020",
    "top 50 animated movies 2000 — 2020",
  ]) {
    const f = parseDiscoveryQuery(text);
    assert.equal(f.recognized, true, text);
    assert.equal(f.yearFrom, "2000", text);
    assert.equal(f.yearTo, "2020", text);
    assert.equal(f.genreId, "16", text);
  }
  const releaseYear = parseDiscoveryQuery("best animated movies of 2020");
  assert.equal(releaseYear.recognized, true);
  assert.equal(releaseYear.yearFrom, "2020");
  assert.equal(releaseYear.yearTo, "2020");
  for (const text of [
    "best sci-fi movies of the 2010s",
    "best sci-fi movies from the 2010s",
    "best sci-fi movies during the 2010s",
  ]) {
    const decade = parseDiscoveryQuery(text);
    assert.equal(decade.recognized, true, text);
    assert.equal(decade.genreId, "878", text);
    assert.equal(decade.yearFrom, "2010", text);
    assert.equal(decade.yearTo, "2019", text);
  }
});

test("future open ranges retain their future start instead of swapping into current releases", () => {
  const future = String(new Date().getFullYear() + 20);
  const f = parseDiscoveryQuery(`best animated movies since ${future}`);
  assert.equal(f.recognized, true);
  assert.equal(f.yearFrom, future);
  assert.equal(f.yearTo, "");
});

test("numbers and ranking words in real titles stay title searches", () => {
  for (const title of [
    "Blade Runner 2049",
    "2001 A Space Odyssey",
    "Top Gun",
    "Se7en",
    "best in show",
    "The Animation Show",
    "Action Jackson",
    "The Sound of Music",
  ]) {
    const result = parseDiscoveryQuery(title);
    assert.equal(result.mode, "search", title);
    assert.equal(result.query, title, title);
    assert.equal(result.recognized, false, title);
    assert.equal(result.yearFrom, "", title);
  }
});

test("unsupported extra words do not become invented discovery filters", () => {
  const query = "top 50 animated movies since 2000 that won Oscars";
  assert.equal(parseDiscoveryQuery(query).mode, "search");
  assert.equal(parseDiscoveryQuery(query).query, query);
});

test("structured filters survive title searches and invalid filters normalize predictably", () => {
  const f = parseDiscoveryQuery("Spirited Away", {
    genreId: "16",
    yearFrom: 2000,
    yearTo: 2010,
    limit: 25,
  });
  assert.equal(f.mode, "search");
  assert.equal(f.genreId, "16");
  assert.equal(f.yearFrom, "2000");
  assert.equal(f.limit, 25);
  assert.deepEqual(
    normalizeFilters({
      mediaType: "unknown",
      genreId: "9999",
      yearFrom: "NaN",
      limit: 10000,
      minVotes: -10,
    }).genreId,
    "",
  );
  assert.equal(normalizeFilters({ limit: 10000 }).limit, 200);
  assert.equal(normalizeFilters({ minVotes: -10 }).minVotes, 0);
  assert.equal(
    normalizeFilters({ yearFrom: 2010, yearTo: 2000 }).yearFrom,
    "2000",
  );
});

test("filter descriptions disclose the ranking basis and title relevance", () => {
  const description = describeFilters(
    parseDiscoveryQuery("top 50 animated movies since 2000"),
  );
  assert.match(description, /Animation movies/);
  assert.match(description, /Highest TMDB rating/);
  assert.match(description, /500 votes/);
  assert.match(description, /Released through today/);
  const titleDescription = describeFilters(parseDiscoveryQuery("Dune"));
  assert.match(titleDescription, /Title relevance/);
  assert.doesNotMatch(titleDescription, /500 votes|Highest TMDB rating/);
});

test("global rating discovery sends API filters and loads all 50 results in API order", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    urls.push(u);
    const p = Number(u.searchParams.get("page"));
    const start = (p - 1) * 20;
    return response(
      page(
        Array.from({ length: 20 }, (_, index) =>
          movie(start + index + 1, {
            vote_average: 10 - (start + index) / 100,
          }),
        ),
        p,
        10,
        200,
      ),
    );
  };
  const result = await client(fetchImpl).discover({
    genreId: "16",
    yearFrom: "2000",
    sort: "rating",
    limit: 50,
  });
  assert.equal(result.results.length, 50);
  assert.deepEqual(
    result.results.map((item) => item.id),
    Array.from({ length: 50 }, (_, i) => i + 1),
  );
  assert.equal(result.results[0].mediaType, "movie");
  assert.equal(result.results[0].media_type, "movie");
  assert.equal(urls.length, 3);
  assert.equal(urls[0].pathname, "/3/discover/movie");
  assert.equal(urls[0].searchParams.get("with_genres"), "16");
  assert.equal(
    urls[0].searchParams.get("primary_release_date.gte"),
    "2000-01-01",
  );
  assert.equal(urls[0].searchParams.get("primary_release_date.lte"), TODAY);
  assert.equal(urls[0].searchParams.get("sort_by"), "vote_average.desc");
  assert.equal(urls[0].searchParams.get("vote_count.gte"), "500");
  assert.equal(urls[0].searchParams.get("include_video"), "false");
  assert.equal(result.partial, false);
  assert.equal(result.totalResultsExact, true);
});

test("TV discovery uses first air dates, not movie parameters", async () => {
  let called;
  const result = await client(async (url) => {
    called = new URL(url);
    return response(
      page([
        {
          id: 1,
          name: "Show",
          first_air_date: "2015-01-01",
          genre_ids: [16],
          vote_count: 10,
        },
      ]),
    );
  }).discover({
    mediaType: "tv",
    sort: "newest",
    yearFrom: "2010",
    yearTo: "2020",
  });
  assert.equal(called.pathname, "/3/discover/tv");
  assert.equal(called.searchParams.get("sort_by"), "first_air_date.desc");
  assert.equal(called.searchParams.get("first_air_date.gte"), "2010-01-01");
  assert.equal(called.searchParams.get("first_air_date.lte"), "2020-12-31");
  assert.equal(
    called.searchParams.get("include_null_first_air_dates"),
    "false",
  );
  assert.equal(called.searchParams.has("vote_count.gte"), false);
  assert.equal(result.results[0].mediaType, "tv");
});

test("future releases and insufficient votes cannot slip through discovery", async () => {
  const result = await client(async () =>
    response(
      page([
        movie(1),
        movie(2, { release_date: "2027-01-01" }),
        movie(3, { vote_count: 12 }),
        movie(4, { genre_ids: [28] }),
        movie(5, { release_date: "" }),
        movie(6, { release_date: "1999-12-31" }),
      ]),
    ),
  ).discover({ genreId: "16", yearFrom: "2000", yearTo: "2030" });
  assert.deepEqual(
    result.results.map((item) => item.id),
    [1],
  );
});

test("a future-only release range returns exact zero matches without requesting an impossible range", async () => {
  const api = client(async () =>
    assert.fail("No fetch should be made for future-only dates"),
  );
  const result = await api.discover({ yearFrom: "2090" });
  assert.deepEqual(result.results, []);
  assert.equal(result.totalResults, 0);
  assert.equal(result.totalResultsExact, true);
  assert.equal(result.partial, false);
  const titleResult = await api.search({
    query: "Dune",
    yearFrom: "2090",
    yearTo: "2099",
    includeUpcoming: false,
  });
  assert.equal(titleResult.totalResults, 0);
});

test("deduplication and hidden library items trigger more pages to fill the requested count", async () => {
  const urls = [];
  const result = await client(async (url) => {
    const p = Number(new URL(url).searchParams.get("page"));
    urls.push(p);
    return response(
      page(
        p === 1 ? [movie(1), movie(2)] : [movie(2), movie(3), movie(4)],
        p,
        2,
        5,
      ),
    );
  }).discover({ limit: 2 }, { excludeKeys: ["movie:1", "tv:3"] });
  assert.deepEqual(urls, [1, 2]);
  assert.deepEqual(
    result.results.map((item) => item.id),
    [2, 3],
  );
  assert.equal(result.totalResultsExact, false);
});

test("title searches inspect more pages for genre/date matches and keep obscure titles", async () => {
  const urls = [];
  const result = await client(async (url) => {
    const u = new URL(url);
    urls.push(u);
    const p = Number(u.searchParams.get("page"));
    return response(
      page(
        p === 1
          ? [
              movie(1, { release_date: "1998-01-01" }),
              movie(2, { genre_ids: [28] }),
            ]
          : [
              movie(3, { vote_count: 0 }),
              movie(4, { release_date: "2028-01-01" }),
            ],
        p,
        2,
        4,
      ),
    );
  }).search({
    query: "A rare title",
    genreId: "16",
    yearFrom: "2000",
    yearTo: "2010",
    limit: 1,
  });
  assert.equal(urls.length, 2);
  assert.equal(urls[0].pathname, "/3/search/movie");
  assert.equal(urls[0].searchParams.get("query"), "A rare title");
  assert.equal(urls[0].searchParams.has("with_genres"), false);
  assert.equal(urls[0].searchParams.has("vote_count.gte"), false);
  assert.deepEqual(
    result.results.map((item) => item.id),
    [3],
  );
  assert.equal(result.totalResultsExact, false);
  assert.equal(result.partial, false);
});

test("a specific TV year is sent to its supported search API parameter", async () => {
  let called;
  await client(async (url) => {
    called = new URL(url);
    return response(page([]));
  }).search({
    query: "Show",
    mediaType: "tv",
    yearFrom: "2010",
    yearTo: "2010",
  });
  assert.equal(called.searchParams.get("first_air_date_year"), "2010");
  assert.equal(called.pathname, "/3/search/tv");
});

test("search caps are visible and are not reported as complete catalogues", async () => {
  const result = await client(
    async () => response(page([movie(1, { genre_ids: [28] })], 1, 50, 1000)),
    { maxPages: 1 },
  ).search({ query: "Movie", genreId: "16" });
  assert.deepEqual(result.results, []);
  assert.equal(result.partial, true);
  assert.match(result.warning, /checked 1 page/);
  assert.equal(result.totalResultsExact, false);
});

test("an empty successful search is complete and distinguishes itself from failure", async () => {
  const result = await client(async () => response(page([], 1, 0, 0))).search({
    query: "No such movie",
  });
  assert.deepEqual(result.results, []);
  assert.equal(result.partial, false);
  assert.equal(result.warning, "");
});

test("first-page HTTP errors reject and authentication errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(
    client(
      async () => {
        calls++;
        return response({ status_message: "Invalid key" }, 401);
      },
      { retries: 3 },
    ).discover(),
    /rejected access \(401\)/,
  );
  assert.equal(calls, 1);
});

test("bounded transient retries can recover a request", async () => {
  let calls = 0;
  const result = await client(
    async () => {
      calls++;
      return calls === 1 ? response({}, 503) : response(page([movie(1)]));
    },
    { retries: 1, retryDelayMs: 0 },
  ).discover();
  assert.equal(calls, 2);
  assert.equal(result.results.length, 1);
});

test("network errors do not become empty result lists", async () => {
  await assert.rejects(
    client(async () => {
      throw new TypeError("Network failed");
    }).search({ query: "Dune" }),
    /Could not connect/,
  );
});

test("a later-page failure preserves results and explicitly reports a partial result", async () => {
  const result = await client(async (url) => {
    const p = Number(new URL(url).searchParams.get("page"));
    return p === 1 ? response(page([movie(1)], 1, 4, 80)) : response({}, 503);
  }).discover();
  assert.equal(result.results.length, 1);
  assert.equal(result.partial, true);
  assert.match(result.warning, /Only part.*503/);
});

test("malformed API pages fail clearly instead of producing false empty states", async () => {
  await assert.rejects(
    client(async () =>
      response({ results: "broken", total_pages: 1, total_results: 1 }),
    ).discover(),
    /invalid results page/,
  );
  await assert.rejects(
    client(async () => response(page([movie(1)], 8))).discover(),
    /invalid results page/,
  );
});

test("cancellation wins even if a fetch implementation ignores the signal", async () => {
  const controller = new AbortController();
  let resolveFetch;
  let calls = 0;
  const pending = client(
    () => {
      calls++;
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
    { timeoutMs: 1000 },
  ).discover({}, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 1);
  // The late response must not resurrect a cancelled request.
  resolveFetch(response(page([movie(1)])));
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(
    client(async () => {
      assert.fail("Fetch must not be called");
    }).discover({}, { signal: alreadyAborted.signal }),
    { name: "AbortError" },
  );
});

test("cancellation during pagination never returns a partial stale result", async () => {
  const controller = new AbortController();
  await assert.rejects(
    client(async (url) => {
      const p = Number(new URL(url).searchParams.get("page"));
      if (p === 2) controller.abort();
      return response(page([movie(p)], p, 5, 100));
    }).discover({}, { signal: controller.signal }),
    { name: "AbortError" },
  );
});

test("timeouts also work when fetch never settles", async () => {
  await assert.rejects(
    client(() => new Promise(() => {}), { timeoutMs: 10 }).discover(),
    { name: "TimeoutError" },
  );
});

test("trending uses the official feed in its returned order", async () => {
  let called;
  const result = await client(async (url) => {
    called = new URL(url);
    return response(
      page([
        movie(2, { vote_average: 6, vote_count: 2 }),
        movie(1, { vote_average: 9 }),
      ]),
    );
  }).discover({ sort: "trending" });
  assert.equal(called.pathname, "/3/trending/movie/week");
  assert.deepEqual(
    result.results.map((item) => item.id),
    [2, 1],
  );
  assert.equal(result.totalResultsExact, false);
});

test("details, collections, providers and recommendations preserve their API shapes", async () => {
  const requests = [];
  const api = client(async (url) => {
    const path = new URL(url).pathname;
    requests.push(path);
    if (path.endsWith("/watch/providers"))
      return response({
        id: 7,
        results: { US: { link: "https://example.org", flatrate: [] } },
      });
    if (path.endsWith("/recommendations")) return response(page([movie(8)]));
    if (path.includes("/collection/"))
      return response({ id: 9, name: "A collection", parts: [movie(10)] });
    return response({
      id: 7,
      name: "A show",
      genres: [{ id: 16, name: "Animation" }],
    });
  });
  assert.equal((await api.details(7, "tv")).mediaType, "tv");
  assert.equal((await api.collection(9)).parts[0].media_type, "movie");
  assert.equal(
    (await api.providers(7, "tv")).results.US.link,
    "https://example.org",
  );
  assert.equal(
    (await api.recommendations(7, "movie")).results[0].mediaType,
    "movie",
  );
  assert.deepEqual(requests, [
    "/3/tv/7",
    "/3/collection/9",
    "/3/tv/7/watch/providers",
    "/3/movie/7/recommendations",
  ]);
  await assert.rejects(
    api.details("../oops", "tv"),
    /valid movie or TV show ID/,
  );
});

test("advanced filters normalize into valid bounds, IDs, language and region", () => {
  const f = normalizeFilters({
    runtimeMin: "150",
    runtimeMax: "90",
    minRating: "7.56",
    originalLanguage: " JA ",
    watchProviderId: "8",
    watchRegion: "gb",
    personId: 525,
    personRole: "crew",
    personName: " Christopher Nolan ",
    watchProviderName: " Netflix ",
  });
  assert.equal(f.runtimeMin, 90);
  assert.equal(f.runtimeMax, 150);
  assert.equal(f.minRating, 7.6);
  assert.equal(f.originalLanguage, "ja");
  assert.equal(f.watchProviderId, "8");
  assert.equal(f.watchProviderName, "Netflix");
  assert.equal(f.watchRegion, "GB");
  assert.equal(f.personId, "525");
  assert.equal(f.personName, "Christopher Nolan");
  assert.equal(f.personRole, "crew");
  const invalid = normalizeFilters({
    originalLanguage: "not a language",
    watchProviderId: "8|9",
    personId: "../1",
    watchRegion: "invalid",
    runtimeMin: "NaN",
    minRating: 12,
  });
  assert.equal(invalid.originalLanguage, "");
  assert.equal(invalid.watchProviderId, "");
  assert.equal(invalid.personId, "");
  assert.equal(invalid.watchRegion, "US");
  assert.equal(invalid.runtimeMin, "");
  assert.equal(invalid.minRating, 10);
  assert.equal(normalizeFilters({ runtimeMax: 0 }).runtimeMax, "");
});

test("movie discovery applies advanced filters to TMDB's full catalogue", async () => {
  const urls = [];
  const api = client(async (url) => {
    urls.push(new URL(url));
    return response(page([movie(1, { original_language: "ja" })]));
  });
  await api.discover({
    sort: "popular",
    runtimeMin: 80,
    runtimeMax: 120,
    minRating: 7.5,
    originalLanguage: "ja",
    watchProviderId: "8",
    watchRegion: "GB",
    personId: "525",
    personRole: "crew",
  });
  const params = urls[0].searchParams;
  assert.equal(params.get("with_runtime.gte"), "80");
  assert.equal(params.get("with_runtime.lte"), "120");
  assert.equal(params.get("vote_average.gte"), "7.5");
  assert.equal(params.get("with_original_language"), "ja");
  assert.equal(params.get("with_watch_providers"), "8");
  assert.equal(params.get("watch_region"), "GB");
  assert.equal(params.get("with_crew"), "525");
  assert.equal(params.has("with_cast"), false);
  await api.discover({ personId: 287, personRole: "cast" });
  assert.equal(urls[1].searchParams.get("with_cast"), "287");
});

test("minimum rating and original language also filter search and trending results", async () => {
  const api = client(async () =>
    response(
      page([
        movie(1, { original_language: "ja", vote_average: 8 }),
        movie(2, { original_language: "ja", vote_average: 7 }),
        movie(3, { original_language: "en", vote_average: 9 }),
      ]),
    ),
  );
  for (const result of [
    await api.search({
      query: "Movie",
      minRating: 7.5,
      originalLanguage: "ja",
    }),
    await api.discover({
      sort: "trending",
      minRating: 7.5,
      originalLanguage: "ja",
    }),
  ]) {
    assert.deepEqual(
      result.results.map((item) => item.id),
      [1],
    );
    assert.equal(result.totalResultsExact, false);
  }
});

test("unsupported endpoint filters fail clearly instead of silently broadening results", async () => {
  const api = client(async () =>
    assert.fail("An unsupported filter must not reach TMDB"),
  );
  for (const filter of [
    { runtimeMax: 100 },
    { personId: 525 },
    { watchProviderId: 8 },
  ]) {
    await assert.rejects(
      api.search({ query: "Movie", ...filter }),
      /Use Explore/,
    );
    await assert.rejects(
      api.discover({ sort: "trending", ...filter }),
      /ranked Explore sort/,
    );
  }
  await assert.rejects(
    api.discover({ mediaType: "all" }),
    /Choose movies or TV shows/,
  );
  await assert.rejects(
    api.discover({ mediaType: "tv", personId: 525 }),
    /does not support.*TV/,
  );
  await assert.rejects(
    api.discover({ mediaType: "tv", runtimeMax: 100 }),
    /TV episode lengths/,
  );
});

test("title searches include announced and undated titles and can explicitly require released titles", async () => {
  const api = client(async () =>
    response(
      page([
        movie(1),
        movie(2, { release_date: "2030-01-01" }),
        movie(3, { release_date: "" }),
      ]),
    ),
  );
  assert.equal(normalizeFilters({ mode: "search" }).includeUpcoming, true);
  assert.equal(parseDiscoveryQuery("Dune").includeUpcoming, true);
  assert.equal(normalizeFilters().includeUpcoming, false);
  assert.deepEqual(
    (await api.search({ query: "Movie" })).results.map((item) => item.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    (await api.search({ query: "Movie", includeUpcoming: false })).results.map(
      (item) => item.id,
    ),
    [1],
  );
  assert.deepEqual(
    (
      await api.search({ query: "Movie", yearFrom: "2030", yearTo: "2030" })
    ).results.map((item) => item.id),
    [2],
  );
});

test("combined title search keeps movie and TV identities separate and excludes people", async () => {
  let called;
  const result = await client(async (url) => {
    called = new URL(url);
    return response(
      page([
        movie(7, { media_type: "movie", genre_ids: [35] }),
        {
          id: 7,
          name: "Show 7",
          media_type: "tv",
          first_air_date: "2010-01-01",
          genre_ids: [35],
        },
        { id: 8, name: "A Person", media_type: "person" },
        movie(7, { media_type: "movie", genre_ids: [35] }),
        movie(8, { media_type: "movie", genre_ids: [28] }),
      ]),
    );
  }).search({
    query: "Something",
    mediaType: "all",
    genreId: 35,
    yearFrom: 2000,
    yearTo: 2020,
  });
  assert.equal(called.pathname, "/3/search/multi");
  assert.equal(called.searchParams.has("first_air_date_year"), false);
  assert.deepEqual(
    result.results.map((item) => `${item.mediaType}:${item.id}`),
    ["movie:7", "tv:7"],
  );
  assert.equal(result.totalResultsExact, false);
});

test("load more preserves unused page items, order, duplicate protection and newly hidden titles", async () => {
  const calls = [];
  const api = client(async (url) => {
    const p = Number(new URL(url).searchParams.get("page"));
    calls.push(p);
    return response(
      page(
        p === 1
          ? [movie(1), movie(2), movie(3)]
          : [movie(2), movie(4), movie(5)],
        p,
        2,
        6,
      ),
    );
  });
  const filters = { limit: 2 };
  const first = await api.discover(filters);
  assert.deepEqual(
    first.results.map((item) => item.id),
    [1, 2],
  );
  assert.equal(first.hasMore, true);
  const next = await api.discover(filters, {
    cursor: first.nextCursor,
    excludeKeys: ["movie:4"],
  });
  assert.deepEqual(
    next.results.map((item) => item.id),
    [3, 5],
  );
  assert.deepEqual(calls, [1, 2]);
  assert.equal(next.hasMore, false);
  assert.equal(next.nextCursor, null);
});

test("load more can use the rest of a fetched page without making another request", async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return response(page([movie(1), movie(2)]));
  });
  const first = await api.search({ query: "Movie", limit: 1 });
  const second = await api.search(
    { query: "Movie", limit: 1 },
    { cursor: first.nextCursor },
  );
  assert.deepEqual(
    second.results.map((item) => item.id),
    [2],
  );
  assert.equal(second.fetchedPages, 0);
  assert.equal(second.hasMore, false);
  assert.equal(calls, 1);
  await assert.rejects(
    api.search({ query: "Other", limit: 1 }, { cursor: first.nextCursor }),
    /filters changed/,
  );
  await assert.rejects(
    api.discover({ limit: 1 }, { cursor: first.nextCursor }),
    /filters changed/,
  );
});

test("load more resumes after a scan cap or a later-page failure", async () => {
  const calls = [];
  const api = client(
    async (url) => {
      const p = Number(new URL(url).searchParams.get("page"));
      calls.push(p);
      return response(
        page([movie(p, { genre_ids: p === 1 ? [28] : [16] })], p, 2, 2),
      );
    },
    { maxPages: 1 },
  );
  const filters = { query: "Movie", genreId: "16", limit: 1 };
  const first = await api.search(filters);
  assert.equal(first.partial, true);
  assert.equal(first.hasMore, true);
  const next = await api.search(filters, { cursor: first.nextCursor });
  assert.deepEqual(
    next.results.map((item) => item.id),
    [2],
  );
  assert.equal(next.partial, false);
  assert.deepEqual(calls, [1, 2]);

  let failed = false;
  const retryCalls = [];
  const retryApi = client(async (url) => {
    const p = Number(new URL(url).searchParams.get("page"));
    retryCalls.push(p);
    if (p === 2 && !failed) {
      failed = true;
      return response({}, 503);
    }
    return response(page([movie(p)], p, 2, 2));
  });
  const partial = await retryApi.discover({ limit: 2 });
  assert.equal(partial.partial, true);
  const recovered = await retryApi.discover(
    { limit: 2 },
    { cursor: partial.nextCursor },
  );
  assert.deepEqual(
    recovered.results.map((item) => item.id),
    [2],
  );
  assert.deepEqual(retryCalls, [1, 2, 2]);
});

test("person search returns named real people and provider catalogues are region-aware and sorted", async () => {
  const urls = [];
  const api = client(async (url) => {
    const u = new URL(url);
    urls.push(u);
    return u.pathname.endsWith("/search/person")
      ? response(
          page([
            { id: 525, name: "Christopher Nolan" },
            { id: 525, name: "Duplicate" },
            { id: -1, name: "Invalid" },
            { id: 7, name: "" },
          ]),
        )
      : response({
          results: [
            { provider_id: 8, provider_name: "Netflix" },
            { provider_id: 350, provider_name: "Apple TV" },
            { provider_id: 8, provider_name: "Duplicate" },
            { provider_id: 9 },
          ],
        });
  });
  const people = await api.people(" Christopher Nolan ");
  assert.deepEqual(
    people.results.map((item) => item.id),
    [525],
  );
  assert.equal(urls[0].searchParams.get("query"), "Christopher Nolan");
  assert.equal(urls[0].searchParams.get("include_adult"), "false");
  const providers = await api.watchProviders("tv", { region: "gb" });
  assert.deepEqual(
    providers.map((item) => item.provider_name),
    ["Apple TV", "Netflix"],
  );
  assert.equal(urls[1].pathname, "/3/watch/providers/tv");
  assert.equal(urls[1].searchParams.get("watch_region"), "GB");
  assert.deepEqual((await api.people(" ")).results, []);
  assert.equal(urls.length, 2);
  await assert.rejects(api.watchProviders("all"), /Choose movies or TV shows/);
});

test("advanced filter summaries show readable people, availability, bounds and future-search behavior", () => {
  const text = describeFilters({
    runtimeMax: 100,
    minRating: 7,
    originalLanguage: "ko",
    personId: 525,
    personName: "Christopher Nolan",
    personRole: "crew",
    watchProviderId: 8,
    watchProviderName: "Netflix",
    watchRegion: "GB",
  });
  for (const pattern of [
    /Up to 100 minutes/,
    /TMDB rating 7\+/,
    /Original language: KO/,
    /Crew: Christopher Nolan/,
    /Available via Netflix \(GB\)/,
  ])
    assert.match(text, pattern);
  assert.match(
    describeFilters({ mode: "search", query: "Dune", mediaType: "all" }),
    /movies & TV shows.*Including upcoming titles/,
  );
});
