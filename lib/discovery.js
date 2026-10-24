// This public TMDB key was already shipped by the original static application.
const DEFAULT_API_KEY = "d954579ffe639c8a36b86cb2849c2ed1";
const API_BASE = "https://api.themoviedb.org/3";

export const GENRES = {
  movie: [
    { id: 28, name: "Action" },
    { id: 12, name: "Adventure" },
    { id: 16, name: "Animation" },
    { id: 35, name: "Comedy" },
    { id: 80, name: "Crime" },
    { id: 99, name: "Documentary" },
    { id: 18, name: "Drama" },
    { id: 10751, name: "Family" },
    { id: 14, name: "Fantasy" },
    { id: 36, name: "History" },
    { id: 27, name: "Horror" },
    { id: 10402, name: "Music" },
    { id: 9648, name: "Mystery" },
    { id: 10749, name: "Romance" },
    { id: 878, name: "Science Fiction" },
    { id: 10770, name: "TV Movie" },
    { id: 53, name: "Thriller" },
    { id: 10752, name: "War" },
    { id: 37, name: "Western" },
  ],
  tv: [
    { id: 10759, name: "Action & Adventure" },
    { id: 16, name: "Animation" },
    { id: 35, name: "Comedy" },
    { id: 80, name: "Crime" },
    { id: 99, name: "Documentary" },
    { id: 18, name: "Drama" },
    { id: 10751, name: "Family" },
    { id: 10762, name: "Kids" },
    { id: 9648, name: "Mystery" },
    { id: 10763, name: "News" },
    { id: 10764, name: "Reality" },
    { id: 10765, name: "Sci-Fi & Fantasy" },
    { id: 10766, name: "Soap" },
    { id: 10767, name: "Talk" },
    { id: 10768, name: "War & Politics" },
    { id: 37, name: "Western" },
  ],
};

const GENRE_ALIASES = [
  ["science fiction", 878, 10765],
  ["sci fi", 878, 10765],
  ["sci-fi", 878, 10765],
  ["scifi", 878, 10765],
  ["action and adventure", 28, 10759],
  ["sci-fi and fantasy", 878, 10765],
  ["war and politics", 10752, 10768],
  ["documentaries", 99, 99],
  ["documentary", 99, 99],
  ["animated", 16, 16],
  ["animation", 16, 16],
  ["adventure", 12, 10759],
  ["action", 28, 10759],
  ["comedies", 35, 35],
  ["comedy", 35, 35],
  ["crime", 80, 80],
  ["dramas", 18, 18],
  ["drama", 18, 18],
  ["family", 10751, 10751],
  ["fantasy", 14, 10765],
  ["history", 36, null],
  ["historical", 36, null],
  ["horror", 27, null],
  ["music", 10402, null],
  ["mysteries", 9648, 9648],
  ["mystery", 9648, 9648],
  ["romance", 10749, null],
  ["romantic", 10749, null],
  ["thrillers", 53, null],
  ["thriller", 53, null],
  ["war", 10752, 10768],
  ["westerns", 37, 37],
  ["western", 37, 37],
  ["kids", 10751, 10762],
  ["reality", null, 10764],
  ["news", null, 10763],
  ["soap", null, 10766],
  ["talk", null, 10767],
].sort((a, b) => b[0].length - a[0].length);

function boundedInteger(value, fallback, min, max) {
  if (value === "" || value === null || value === undefined) return fallback;
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(max, Math.max(min, Math.trunc(number)))
    : fallback;
}

function year(value) {
  return /^\d{4}$/.test(String(value ?? "")) && Number(value) >= 1000
    ? String(value)
    : "";
}

function optionalInteger(value, min = 1, max = 1000) {
  if (
    value === "" ||
    value === null ||
    value === undefined ||
    Number(value) === 0
  )
    return "";
  return Number.isFinite(Number(value))
    ? boundedInteger(value, "", min, max)
    : "";
}

function optionalId(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? String(number) : "";
}

function genresFor(mediaType) {
  return mediaType === "all"
    ? [...GENRES.movie, ...GENRES.tv]
    : GENRES[mediaType];
}

export function normalizeFilters(filters = {}) {
  const mode = filters.mode === "search" ? "search" : "discover";
  const mediaType = ["tv", "all"].includes(filters.mediaType)
    ? filters.mediaType
    : "movie";
  const genreId = String(filters.genreId ?? "");
  let yearFrom = year(filters.yearFrom);
  let yearTo = year(filters.yearTo);
  if (yearFrom && yearTo && Number(yearFrom) > Number(yearTo))
    [yearFrom, yearTo] = [yearTo, yearFrom];
  let runtimeMin = optionalInteger(filters.runtimeMin);
  let runtimeMax = optionalInteger(filters.runtimeMax);
  if (runtimeMin && runtimeMax && runtimeMin > runtimeMax)
    [runtimeMin, runtimeMax] = [runtimeMax, runtimeMin];
  const originalLanguage = String(filters.originalLanguage ?? "")
    .trim()
    .toLowerCase();
  const watchRegion = String(filters.watchRegion ?? "US")
    .trim()
    .toUpperCase();
  const watchProviderId = optionalId(filters.watchProviderId);
  const personId = optionalId(filters.personId);
  return {
    mode,
    query: String(filters.query ?? "").trim(),
    mediaType,
    genreId: genresFor(mediaType).some((genre) => String(genre.id) === genreId)
      ? genreId
      : "",
    yearFrom,
    yearTo,
    sort: ["rating", "popular", "newest", "trending"].includes(filters.sort)
      ? filters.sort
      : "rating",
    minVotes: boundedInteger(filters.minVotes, 500, 0, 1000000),
    minRating:
      Math.round(
        Math.min(10, Math.max(0, Number(filters.minRating) || 0)) * 10,
      ) / 10,
    runtimeMin,
    runtimeMax,
    originalLanguage: /^[a-z]{2,3}$/.test(originalLanguage)
      ? originalLanguage
      : "",
    watchProviderId,
    watchProviderName: watchProviderId
      ? String(filters.watchProviderName ?? "")
          .trim()
          .slice(0, 160)
      : "",
    watchRegion: /^[A-Z]{2}$/.test(watchRegion) ? watchRegion : "US",
    personId,
    personName: personId
      ? String(filters.personName ?? "")
          .trim()
          .slice(0, 160)
      : "",
    personRole: filters.personRole === "crew" ? "crew" : "cast",
    includeUpcoming:
      filters.includeUpcoming === true ||
      filters.includeUpcoming === "true" ||
      (mode === "search" &&
        filters.includeUpcoming !== false &&
        filters.includeUpcoming !== "false"),
    limit: boundedInteger(filters.limit, 50, 1, 200),
    recognized: filters.recognized === true,
  };
}

/**
 * Recognize complete, explicit filter phrases. Any unconsumed words keep the
 * whole input as a title search: numbers and words such as "Top" are titles too.
 */
export function parseDiscoveryQuery(text, base = {}) {
  const original = String(text ?? "").trim();
  const initial = normalizeFilters(base);
  if (!original)
    return normalizeFilters({
      ...initial,
      mode: "discover",
      query: "",
      recognized: false,
    });
  let remaining = original
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ");
  const parsed = {
    ...initial,
    mode: "discover",
    query: "",
    recognized: true,
    includeUpcoming: base.includeUpcoming ?? false,
  };
  let hasFacet = false;
  remaining = remaining.replace(
    /^(?:please\s+)?(?:show me|find me|give me|find|list|what are)(?:\s+the)?\s+/,
    "",
  );
  const ranking = remaining.match(
    /^(?:the\s+)?(highest[ -]rated|top[ -]rated|most popular|top|best|popular|newest|latest|trending)(?:\s+(\d{1,3}))?\b/,
  );
  if (ranking) {
    const word = ranking[1];
    parsed.sort = /popular/.test(word)
      ? "popular"
      : /newest|latest/.test(word)
        ? "newest"
        : word === "trending"
          ? "trending"
          : "rating";
    if (ranking[2]) parsed.limit = Number(ranking[2]);
    remaining = remaining.slice(ranking[0].length).trim();
    hasFacet = true;
  } else {
    const count = remaining.match(/^(\d{1,3})\s+/);
    if (count) {
      parsed.limit = Number(count[1]);
      remaining = remaining.slice(count[0].length);
      hasFacet = true;
    }
  }

  const range = remaining.match(
    /\b(?:released\s+)?(?:(?:between|from)\s+)?(\d{4})\s*(?:[-–—]|\b(?:and|to|through)\b)\s*(\d{4})\b/,
  );
  const decade = remaining.match(
    /\b(?:released\s+)?(?:(?:in|of|from|during)\s+(?:the\s+)?)?(\d{3}0)'?s\b/,
  );
  if (range) {
    parsed.yearFrom = range[1];
    parsed.yearTo = range[2];
    remaining = remaining.replace(range[0], " ");
    hasFacet = true;
  } else if (decade) {
    parsed.yearFrom = decade[1];
    parsed.yearTo = String(Number(decade[1]) + 9);
    remaining = remaining.replace(decade[0], " ");
    hasFacet = true;
  } else {
    const date = remaining.match(
      /\b(?:released\s+)?(since|after|from|before|until|through|in|of)\s+(\d{4})\b/,
    );
    if (date) {
      const value = Number(date[2]);
      if (["since", "after", "from"].includes(date[1])) {
        parsed.yearFrom = String(value + (date[1] === "after" ? 1 : 0));
        const currentYear = new Date().getFullYear();
        parsed.yearTo =
          Number(parsed.yearFrom) <= currentYear ? String(currentYear) : "";
      } else if (["before", "until", "through"].includes(date[1])) {
        parsed.yearFrom = "";
        parsed.yearTo = String(value - (date[1] === "before" ? 1 : 0));
      } else parsed.yearFrom = parsed.yearTo = date[2];
      remaining = remaining.replace(date[0], " ");
      hasFacet = true;
    }
  }

  const media = remaining.match(
    /\b(tv shows?|television shows?|tv series|television series|movies?|films?|shows?|series|tv)\b/,
  );
  if (media) {
    parsed.mediaType = /movie|film/.test(media[0]) ? "movie" : "tv";
    remaining = remaining.replace(media[0], " ");
    hasFacet = true;
  }
  for (const [alias, movieId, tvId] of GENRE_ALIASES) {
    const matcher = new RegExp(
      `\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
    );
    const id = parsed.mediaType === "tv" ? tvId : movieId;
    if (id && matcher.test(remaining)) {
      parsed.genreId = String(id);
      remaining = remaining.replace(matcher, " ");
      hasFacet = true;
      break;
    }
  }
  const votes = remaining.match(
    /\b(?:with\s+)?(?:at least|minimum|min)\s+(\d+)\s+votes\b/,
  );
  if (votes) {
    parsed.minVotes = Number(votes[1]);
    remaining = remaining.replace(votes[0], " ");
    hasFacet = true;
  }
  remaining = remaining.replace(/[.,!?]/g, " ").trim();
  if (hasFacet && !remaining)
    return normalizeFilters({
      ...parsed,
      mediaType: parsed.mediaType === "all" ? "movie" : parsed.mediaType,
    });
  return normalizeFilters({
    ...initial,
    mode: "search",
    query: original,
    includeUpcoming: base.includeUpcoming ?? true,
    recognized: false,
  });
}

export function describeFilters(filters) {
  const f = normalizeFilters(filters);
  const genre = genresFor(f.mediaType).find(
    (item) => String(item.id) === f.genreId,
  )?.name;
  const type =
    f.mediaType === "all"
      ? "movies & TV shows"
      : f.mediaType === "tv"
        ? "TV shows"
        : "movies";
  const parts = [
    f.mode === "search" ? `Title: “${f.query}”` : `Up to ${f.limit}`,
    `${genre ? `${genre} ` : ""}${type}`,
  ];
  if (f.yearFrom && f.yearTo)
    parts.push(
      f.yearFrom === f.yearTo ? f.yearFrom : `${f.yearFrom}–${f.yearTo}`,
    );
  else if (f.yearFrom) parts.push(`Since ${f.yearFrom}`);
  else if (f.yearTo) parts.push(`Through ${f.yearTo}`);
  if (f.mode === "search") parts.push("Title relevance");
  else {
    parts.push(
      {
        rating: "Highest TMDB rating",
        popular: "Most popular on TMDB",
        newest: "Newest first",
        trending: "Trending this week",
      }[f.sort],
    );
    if (f.sort === "rating")
      parts.push(`At least ${f.minVotes.toLocaleString("en-US")} votes`);
  }
  if (f.minRating) parts.push(`TMDB rating ${f.minRating}+`);
  if (f.runtimeMin && f.runtimeMax)
    parts.push(`${f.runtimeMin}–${f.runtimeMax} minutes`);
  else if (f.runtimeMin) parts.push(`At least ${f.runtimeMin} minutes`);
  else if (f.runtimeMax) parts.push(`Up to ${f.runtimeMax} minutes`);
  if (f.originalLanguage)
    parts.push(`Original language: ${f.originalLanguage.toUpperCase()}`);
  if (f.personId)
    parts.push(
      `${f.personRole === "crew" ? "Crew" : "Cast"}: ${f.personName || `person ${f.personId}`}`,
    );
  if (f.watchProviderId)
    parts.push(
      `Available via ${f.watchProviderName || `provider ${f.watchProviderId}`} (${f.watchRegion})`,
    );
  parts.push(
    f.includeUpcoming ? "Including upcoming titles" : "Released through today",
  );
  return parts.join(" · ");
}

export class MovieApiError extends Error {
  constructor(message, { status, retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = "MovieApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

function abortError() {
  const error = new Error("This request was cancelled.");
  error.name = "AbortError";
  return error;
}

function checkAbort(signal) {
  if (signal?.aborted) throw abortError();
}

function pause(milliseconds, signal) {
  checkAbort(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const cancelled = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    };
    const cleanup = () => signal?.removeEventListener("abort", cancelled);
    signal?.addEventListener("abort", cancelled, { once: true });
  });
}

function normalizedItem(item, mediaType) {
  return { ...item, mediaType, media_type: mediaType };
}

function mediaId(id) {
  if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0)
    throw new MovieApiError("A valid movie or TV show ID is required.");
  return Number(id);
}

/**
 * Discover sorting is performed by TMDB over its whole filtered catalogue.
 * Title search retains TMDB relevance order; it never ranks a small sample as
 * though that sample represented every matching movie.
 */
export function createMovieClient({
  fetchImpl = globalThis.fetch,
  apiKey = DEFAULT_API_KEY,
  baseUrl = API_BASE,
  language = "en-US",
  timeoutMs = 12000,
  retries = 1,
  retryDelayMs = 300,
  maxPages = 25,
  now = () => new Date(),
} = {}) {
  if (typeof fetchImpl !== "function")
    throw new MovieApiError(
      "Your browser does not support loading movie data.",
    );
  const pageLimit = boundedInteger(maxPages, 25, 1, 500);
  const retryLimit = boundedInteger(retries, 1, 0, 3);
  const timeout = boundedInteger(timeoutMs, 12000, 1, 60000);

  async function request(path, parameters = {}, { signal } = {}) {
    if (!String(apiKey ?? "").trim())
      throw new MovieApiError("A TMDB API key is required to load movie data.");
    const url = new URL(
      `${baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`,
    );
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("language", language);
    for (const [key, value] of Object.entries(parameters)) {
      if (value !== "" && value !== undefined && value !== null)
        url.searchParams.set(key, String(value));
    }
    for (let attempt = 0; ; attempt++) {
      checkAbort(signal);
      const controller = new AbortController();
      let timeoutError;
      const cancel = () => controller.abort();
      signal?.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => {
        timeoutError = new MovieApiError(
          "Movie data took too long to load. Please try again.",
          { retryable: true },
        );
        timeoutError.name = "TimeoutError";
        controller.abort();
      }, timeout);
      let removeAbortListener = () => {};
      try {
        const cancelled = new Promise((_, reject) => {
          const handleAbort = () => reject(timeoutError || abortError());
          controller.signal.addEventListener("abort", handleAbort, {
            once: true,
          });
          removeAbortListener = () =>
            controller.signal.removeEventListener("abort", handleAbort);
        });
        const load = (async () => {
          let response;
          try {
            response = await fetchImpl(url.toString(), {
              signal: controller.signal,
              headers: { Accept: "application/json" },
            });
          } catch (error) {
            if (controller.signal.aborted) throw timeoutError || abortError();
            throw new MovieApiError(
              "Could not connect to TMDB. Check your connection and try again.",
              { retryable: true, cause: error },
            );
          }
          let body;
          try {
            body = await response.json();
          } catch (error) {
            if (controller.signal.aborted) throw timeoutError || abortError();
            throw new MovieApiError(
              "TMDB returned an unreadable response. Please try again.",
              {
                status: response.status,
                retryable: response.status >= 500,
                cause: error,
              },
            );
          }
          if (!response.ok || body?.success === false) {
            const status = response.status;
            const message =
              status === 401 || status === 403
                ? `TMDB rejected access (${status}). The movie data API key may need to be updated.`
                : status === 404
                  ? "That movie or TV show could not be found on TMDB."
                  : status === 429
                    ? "TMDB is busy. Please wait a moment and try again."
                    : `TMDB could not load this data (${status}). Please try again.`;
            throw new MovieApiError(message, {
              status,
              retryable: [408, 425, 429, 500, 502, 503, 504].includes(status),
            });
          }
          if (!body || typeof body !== "object" || Array.isArray(body))
            throw new MovieApiError(
              "TMDB returned an invalid response. Please try again.",
            );
          return body;
        })();
        const body = await Promise.race([load, cancelled]);
        checkAbort(signal);
        return body;
      } catch (error) {
        if (signal?.aborted) throw abortError();
        if (
          error.name === "AbortError" ||
          !error.retryable ||
          attempt >= retryLimit
        )
          throw error;
      } finally {
        clearTimeout(timer);
        removeAbortListener();
        signal?.removeEventListener("abort", cancel);
      }
      await pause(
        Math.min(2000, Math.max(0, retryDelayMs) * 2 ** attempt),
        signal,
      );
    }
  }

  function dateBounds(filters) {
    const date = now();
    // Use the browser's local calendar day, including around midnight UTC.
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return {
      from: filters.yearFrom ? `${filters.yearFrom}-01-01` : "",
      to: filters.includeUpcoming
        ? filters.yearTo
          ? `${filters.yearTo}-12-31`
          : ""
        : filters.yearTo
          ? [`${filters.yearTo}-12-31`, today].sort()[0]
          : today,
    };
  }

  function matches(
    item,
    filters,
    bounds,
    { titleSearch = false, mediaType = filters.mediaType } = {},
  ) {
    const date = mediaType === "tv" ? item.first_air_date : item.release_date;
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      if (
        (bounds.to && date > bounds.to) ||
        (bounds.from && date < bounds.from)
      )
        return false;
    } else if (
      !titleSearch ||
      !filters.includeUpcoming ||
      filters.yearFrom ||
      filters.yearTo
    )
      return false;
    const genreIds =
      item.genre_ids || item.genres?.map((genre) => genre.id) || [];
    if (
      filters.genreId &&
      !genreIds.some((id) => String(id) === filters.genreId)
    )
      return false;
    if (
      !titleSearch &&
      filters.sort === "rating" &&
      Number(item.vote_count || 0) < filters.minVotes
    )
      return false;
    if (filters.minRating && Number(item.vote_average || 0) < filters.minRating)
      return false;
    if (
      filters.originalLanguage &&
      item.original_language !== filters.originalLanguage
    )
      return false;
    return !item.adult && item.video !== true;
  }

  async function paginated(
    path,
    parameters,
    filters,
    {
      signal,
      excludeKeys = [],
      titleSearch = false,
      localFiltering = false,
      cursor,
    } = {},
  ) {
    checkAbort(signal);
    const results = [];
    const signature = JSON.stringify({ path, parameters, filters });
    if (
      cursor &&
      (cursor.signature !== signature ||
        !Number.isInteger(cursor.page) ||
        cursor.page < 1 ||
        cursor.page > 501 ||
        !Array.isArray(cursor.pendingResults) ||
        !Array.isArray(cursor.seenKeys) ||
        !Number.isInteger(cursor.totalPages) ||
        cursor.totalPages < 0 ||
        !Number.isFinite(cursor.totalResults) ||
        cursor.totalResults < 0)
    )
      throw new MovieApiError(
        "The search filters changed. Run the search again before loading more.",
      );
    const seen = new Set([...(cursor?.seenKeys || []), ...excludeKeys]);
    const bounds = dateBounds(filters);
    if (bounds.from && bounds.to && bounds.from > bounds.to) {
      return {
        results: [],
        totalResults: 0,
        totalPages: 0,
        totalResultsExact: true,
        fetchedPages: 0,
        partial: false,
        warning: "",
        hasMore: false,
        nextCursor: null,
      };
    }
    let totalResults = cursor?.totalResults || 0;
    let totalPages = cursor?.totalPages || 0;
    let nextPage = cursor?.page || 1;
    let pendingResults = [...(cursor?.pendingResults || [])];
    let pagesKnown = Boolean(cursor);
    let fetchedPages = 0;
    let warning = "";
    while (results.length < filters.limit) {
      checkAbort(signal);
      if (!pendingResults.length) {
        if (pagesKnown && nextPage > totalPages) break;
        if (fetchedPages >= pageLimit || nextPage > 500) {
          warning = `Search checked ${fetchedPages} ${fetchedPages === 1 ? "page" : "pages"} and found ${results.length} matching titles. Narrow the filters or load more to search the remaining results.`;
          break;
        }
        let data;
        try {
          data = await request(
            path,
            { ...parameters, page: nextPage },
            { signal },
          );
          if (
            !Array.isArray(data.results) ||
            !Number.isInteger(data.total_pages) ||
            data.total_pages < 0 ||
            !Number.isFinite(data.total_results) ||
            data.total_results < 0 ||
            (data.page !== undefined && data.page !== nextPage)
          ) {
            throw new MovieApiError(
              "TMDB returned an invalid results page. Please try again.",
            );
          }
        } catch (error) {
          if (
            signal?.aborted ||
            error.name === "AbortError" ||
            (!fetchedPages && !results.length)
          )
            throw error;
          warning = `Only part of the results could be loaded. ${error.message}`;
          break;
        }
        fetchedPages++;
        nextPage++;
        totalResults = data.total_results;
        totalPages = data.total_pages;
        pagesKnown = true;
        pendingResults = [...data.results];
        if (!pendingResults.length) continue;
      }
      const item = pendingResults.shift();
      if (!item || !Number.isSafeInteger(item.id) || item.id <= 0) continue;
      const mediaType =
        filters.mediaType === "all" ? item.media_type : filters.mediaType;
      if (mediaType !== "movie" && mediaType !== "tv") continue;
      const key = `${mediaType}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (matches(item, filters, bounds, { titleSearch, mediaType }))
        results.push(normalizedItem(item, mediaType));
    }
    const hasMore =
      pendingResults.length > 0 || nextPage <= Math.min(500, totalPages);
    if (!hasMore && totalPages > 500 && nextPage > 500)
      warning =
        "TMDB allows access to the first 500 pages of a search. Narrow the filters to find more titles.";
    const hasLocalConstraints = localFiltering || excludeKeys.length > 0;
    return {
      results,
      totalResults,
      totalPages,
      totalResultsExact: !hasLocalConstraints,
      fetchedPages,
      partial: Boolean(warning),
      warning,
      hasMore,
      nextCursor: hasMore
        ? {
            signature,
            page: nextPage,
            pendingResults,
            seenKeys: [...seen],
            totalResults,
            totalPages,
          }
        : null,
    };
  }

  async function discover(filters = {}, options = {}) {
    const f = normalizeFilters({ ...filters, mode: "discover" });
    if (f.mediaType === "all")
      throw new MovieApiError(
        "Choose movies or TV shows to explore ranked results. Title search can search both together.",
      );
    if (f.mediaType === "tv" && f.personId)
      throw new MovieApiError(
        "Cast and crew filters are available for movies. TMDB does not support filtering TV discovery by person.",
      );
    if (f.mediaType === "tv" && (f.runtimeMin || f.runtimeMax))
      throw new MovieApiError(
        "Runtime filters are available for movies. TV episode lengths can vary.",
      );
    const bounds = dateBounds(f);
    if (f.sort === "trending") {
      if (f.runtimeMin || f.runtimeMax || f.personId || f.watchProviderId)
        throw new MovieApiError(
          "Streaming service, runtime, and person filters require a ranked Explore sort such as highest rated, popular, or newest.",
        );
      return paginated(`trending/${f.mediaType}/week`, {}, f, {
        ...options,
        localFiltering: true,
      });
    }
    const dateKey =
      f.mediaType === "tv" ? "first_air_date" : "primary_release_date";
    const params = {
      include_adult: false,
      [f.mediaType === "tv" ? "include_null_first_air_dates" : "include_video"]:
        false,
      sort_by:
        f.sort === "rating"
          ? "vote_average.desc"
          : f.sort === "newest"
            ? `${dateKey}.desc`
            : "popularity.desc",
      with_genres: f.genreId,
      [`${dateKey}.gte`]: bounds.from,
      [`${dateKey}.lte`]: bounds.to,
      "vote_count.gte": f.sort === "rating" ? f.minVotes : undefined,
      "vote_average.gte": f.minRating || undefined,
      "with_runtime.gte": f.runtimeMin,
      "with_runtime.lte": f.runtimeMax,
      with_original_language: f.originalLanguage,
      with_watch_providers: f.watchProviderId,
      watch_region: f.watchProviderId ? f.watchRegion : undefined,
      [f.personRole === "crew" ? "with_crew" : "with_cast"]: f.personId,
    };
    return paginated(`discover/${f.mediaType}`, params, f, options);
  }

  async function search(filters = {}, options = {}) {
    const f = normalizeFilters({ ...filters, mode: "search" });
    if (!f.query)
      throw new MovieApiError("Enter a movie or TV show title to search.");
    if (f.runtimeMin || f.runtimeMax || f.personId || f.watchProviderId)
      throw new MovieApiError(
        "Use Explore to filter by streaming service, runtime, or person. Title search cannot apply those filters reliably.",
      );
    const params = { query: f.query, include_adult: false };
    if (f.mediaType !== "all" && f.yearFrom && f.yearFrom === f.yearTo)
      params[
        f.mediaType === "tv" ? "first_air_date_year" : "primary_release_year"
      ] = f.yearFrom;
    // Search endpoints do not support genres or date ranges. Inspect successive
    // relevance-ordered pages instead of pretending unsupported params work.
    return paginated(
      `search/${f.mediaType === "all" ? "multi" : f.mediaType}`,
      params,
      f,
      {
        ...options,
        titleSearch: true,
        localFiltering: true,
      },
    );
  }

  async function people(query, { signal } = {}) {
    checkAbort(signal);
    const text = String(query ?? "").trim();
    if (!text)
      return { results: [], page: 1, total_pages: 0, total_results: 0 };
    const data = await request(
      "search/person",
      { query: text, include_adult: false, page: 1 },
      { signal },
    );
    if (!Array.isArray(data.results))
      throw new MovieApiError(
        "TMDB returned an invalid list of people. Please try again.",
      );
    const seen = new Set();
    return {
      ...data,
      results: data.results.filter((person) => {
        if (
          !person ||
          !Number.isSafeInteger(person.id) ||
          person.id <= 0 ||
          typeof person.name !== "string" ||
          !person.name.trim() ||
          person.adult ||
          seen.has(person.id)
        )
          return false;
        seen.add(person.id);
        return true;
      }),
    };
  }

  async function watchProviders(
    mediaType = "movie",
    { region = "US", signal } = {},
  ) {
    if (mediaType !== "movie" && mediaType !== "tv")
      throw new MovieApiError(
        "Choose movies or TV shows to list streaming services.",
      );
    const watchRegion = normalizeFilters({ watchRegion: region }).watchRegion;
    const data = await request(
      `watch/providers/${mediaType}`,
      { watch_region: watchRegion },
      { signal },
    );
    if (!Array.isArray(data.results))
      throw new MovieApiError(
        "TMDB returned an invalid list of streaming services. Please try again.",
      );
    const seen = new Set();
    return data.results
      .filter((provider) => {
        if (
          !provider ||
          !Number.isSafeInteger(provider.provider_id) ||
          provider.provider_id <= 0 ||
          typeof provider.provider_name !== "string" ||
          !provider.provider_name.trim() ||
          seen.has(provider.provider_id)
        )
          return false;
        seen.add(provider.provider_id);
        return true;
      })
      .sort((a, b) =>
        a.provider_name.localeCompare(b.provider_name, "en", {
          sensitivity: "base",
        }),
      );
  }

  async function details(id, mediaType = "movie", options = {}) {
    const type = mediaType === "tv" ? "tv" : "movie";
    const data = await request(
      `${type}/${mediaId(id)}`,
      { append_to_response: "credits,videos,external_ids" },
      options,
    );
    if (!data.id)
      throw new MovieApiError(
        "TMDB returned invalid title details. Please try again.",
      );
    return normalizedItem(data, type);
  }

  async function collection(id, options = {}) {
    const data = await request(`collection/${mediaId(id)}`, {}, options);
    if (!Array.isArray(data.parts))
      throw new MovieApiError(
        "TMDB returned an invalid movie collection. Please try again.",
      );
    return {
      ...data,
      parts: data.parts
        .filter((item) => item && Number.isSafeInteger(item.id) && item.id > 0)
        .map((item) => normalizedItem(item, "movie")),
    };
  }

  async function recommendations(id, mediaType = "movie", options = {}) {
    const f = normalizeFilters({ mediaType, sort: "popular", limit: 20 });
    return paginated(`${f.mediaType}/${mediaId(id)}/recommendations`, {}, f, {
      ...options,
      localFiltering: true,
    });
  }

  async function providers(id, mediaType = "movie", options = {}) {
    const type = mediaType === "tv" ? "tv" : "movie";
    const data = await request(
      `${type}/${mediaId(id)}/watch/providers`,
      {},
      options,
    );
    if (
      !data.results ||
      typeof data.results !== "object" ||
      Array.isArray(data.results)
    )
      throw new MovieApiError(
        "TMDB returned invalid streaming availability. Please try again.",
      );
    return data;
  }

  return {
    discover,
    search,
    people,
    watchProviders,
    details,
    collection,
    recommendations,
    providers,
  };
}
