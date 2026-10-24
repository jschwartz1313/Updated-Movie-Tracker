// Personal library helpers are independent of the API and never mutate records.
const fold = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase();
const typeOf = (item) => item.mediaType ?? item.media_type ?? "movie";
const titleOf = (item) => item.title || item.name || "Untitled";
const yearOf = (item) =>
  Number(
    String(
      item.release_date ||
        item.first_air_date ||
        item.releaseDate ||
        item.year ||
        "",
    ).slice(0, 4),
  ) || 0;
const runtimeOf = (item) => {
  const value = Number(item.runtime ?? item.episode_run_time?.[0] ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
};
const titleCompare = (left, right) =>
  titleOf(left).localeCompare(titleOf(right), undefined, {
    sensitivity: "base",
    numeric: true,
  });
const priorityRank = { high: 3, normal: 2, low: 1 };
const latestDate = (item) =>
  [
    item.addedAt,
    item.addedDate,
    item.watchedDate,
    ...(item.logs || []).map((log) => log.date),
  ]
    .filter(
      (value) =>
        typeof value === "string" && Number.isFinite(Date.parse(value)),
    )
    .map((value) => Date.parse(value))
    .sort((a, b) => b - a)[0] || 0;

function searchable(item) {
  const people = [
    ...(Array.isArray(item.cast) ? item.cast : []),
    ...(Array.isArray(item.crew) ? item.crew : []),
    ...(Array.isArray(item.credits?.cast) ? item.credits.cast : []),
    ...(Array.isArray(item.credits?.crew) ? item.credits.crew : []),
  ];
  return fold(
    [
      titleOf(item),
      item.original_title,
      item.original_name,
      item.notes,
      item.review,
      ...(item.tags || []),
      ...(item.logs || []).map((log) => log.notes),
      ...people.map((person) => person?.name),
      item.director,
      ...(Array.isArray(item.genres)
        ? item.genres.map((genre) => genre?.name)
        : []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

/** Query words match anywhere across a title, people, genres, personal notes,
 * viewing notes, and tags. Multiple selected tags use AND matching. */
export function filterLibrary(items = [], filters = {}) {
  const {
    query = "",
    type = "all",
    genreId = "",
    minRating = 0,
    tag = "",
    tags = [],
    favoriteOnly = false,
    priority = "",
    progressStatus = "",
    sort = "recent",
    yearFrom = "",
    yearTo = "",
  } = filters;
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const selectedTags = [...(Array.isArray(tags) ? tags : [tags]), tag]
    .filter(Boolean)
    .map(fold);
  const result = items.filter((item) => {
    if (type && type !== "all" && typeOf(item) !== type) return false;
    if (
      genreId &&
      genreId !== "all" &&
      Number(genreId) !== 0 &&
      ![
        ...(item.genre_ids || []),
        ...(item.genres || []).map((genre) => genre.id),
      ].some((id) => Number(id) === Number(genreId))
    )
      return false;
    if (minRating === "unrated" && Number(item.rating) > 0) return false;
    if (Number(minRating) > 0 && Number(item.rating || 0) < Number(minRating))
      return false;
    if (favoriteOnly && !item.favorite) return false;
    if (
      priority &&
      priority !== "all" &&
      (item.priority || "normal") !== priority
    )
      return false;
    if (
      progressStatus &&
      progressStatus !== "all" &&
      item.progress?.status !== progressStatus
    )
      return false;
    const itemTags = (item.tags || []).map(fold);
    if (selectedTags.some((selected) => !itemTags.includes(selected)))
      return false;
    if (yearFrom && yearOf(item) < Number(yearFrom)) return false;
    if (yearTo && (!yearOf(item) || yearOf(item) > Number(yearTo)))
      return false;
    if (terms.length && !terms.every((term) => searchable(item).includes(term)))
      return false;
    return true;
  });
  const numeric =
    (getValue, direction = -1) =>
    (left, right) => {
      const a = getValue(left),
        b = getValue(right);
      // Missing dates, ratings, and runtimes follow known values in either order.
      if (!a && b) return 1;
      if (a && !b) return -1;
      return direction * (a - b) || titleCompare(left, right);
    };
  const comparators = {
    recent: numeric(latestDate),
    added: numeric((item) => Date.parse(item.addedAt || item.addedDate) || 0),
    title: titleCompare,
    "title-desc": (a, b) => -titleCompare(a, b),
    rating: numeric((item) => Number(item.rating) || 0),
    "rating-asc": numeric((item) => Number(item.rating) || 0, 1),
    year: numeric(yearOf),
    "year-asc": numeric(yearOf, 1),
    priority: numeric((item) => priorityRank[item.priority || "normal"] || 2),
    runtime: numeric(runtimeOf, 1),
    "runtime-desc": numeric(runtimeOf),
    watched: numeric((item) => Date.parse(item.watchedDate) || 0),
  };
  return result.sort(comparators[sort] || comparators.recent);
}

/** Counts viewing events across both lists so moving a film back to a watchlist
 * does not erase its history. Runtime totals count movies with a known runtime;
 * unknown runtimes and unknown viewing dates are returned explicitly. */
export function libraryStats(snapshot = {}) {
  const watchlist = snapshot.watchlist || [];
  const watched = snapshot.watched || [];
  const records = new Map();
  for (const [items, isWatched] of [
    [watchlist, false],
    [watched, true],
  ]) {
    for (const item of items)
      records.set(`${typeOf(item)}-${item.id}`, { item, isWatched });
  }
  const stats = {
    totalTitles: records.size,
    watchlistCount: watchlist.length,
    watchedCount: watched.length,
    watchedMovies: 0,
    watchedShows: 0,
    totalViewings: 0,
    movieViewings: 0,
    showViewings: 0,
    movieMinutes: 0,
    unknownRuntimeViewings: 0,
    unknownDateViewings: 0,
    avgRating: 0,
    ratedTitles: 0,
    favorites: 0,
    activeShows: 0,
    monthlyCounts: [],
    topTags: [],
  };
  const months = new Map(),
    tags = new Map();
  let ratingTotal = 0;
  for (const { item, isWatched } of records.values()) {
    const logs = Array.isArray(item.logs)
      ? item.logs
      : isWatched
        ? [{ date: item.watchedDate || "", rating: item.rating || 0 }]
        : [];
    const isMovie = typeOf(item) === "movie";
    if (isWatched || logs.length)
      stats[isMovie ? "watchedMovies" : "watchedShows"]++;
    stats.totalViewings += logs.length;
    stats[isMovie ? "movieViewings" : "showViewings"] += logs.length;
    if (isMovie) {
      const runtime = runtimeOf(item);
      if (runtime) stats.movieMinutes += runtime * logs.length;
      else stats.unknownRuntimeViewings += logs.length;
    }
    for (const log of logs) {
      if (
        typeof log.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(log.date)
      ) {
        stats.unknownDateViewings++;
        continue;
      }
      const month = log.date.slice(0, 7);
      const count = months.get(month) || {
        month,
        count: 0,
        movies: 0,
        shows: 0,
      };
      count.count++;
      count[isMovie ? "movies" : "shows"]++;
      months.set(month, count);
    }
    const rating = Number(item.rating);
    if (rating >= 1 && rating <= 10 && (isWatched || logs.length)) {
      ratingTotal += rating;
      stats.ratedTitles++;
    }
    if (item.favorite) stats.favorites++;
    if (!isMovie && item.progress?.status === "watching") stats.activeShows++;
    for (const tag of new Map(
      (item.tags || []).map((value) => [fold(value), value]),
    ).values()) {
      const key = fold(tag),
        count = tags.get(key) || { tag, count: 0 };
      count.count++;
      tags.set(key, count);
    }
  }
  stats.avgRating = stats.ratedTitles ? ratingTotal / stats.ratedTitles : 0;
  stats.monthlyCounts = [...months.values()].sort((a, b) =>
    a.month.localeCompare(b.month),
  );
  stats.topTags = [...tags.values()].sort(
    (a, b) => b.count - a.count || a.tag.localeCompare(b.tag),
  );
  return stats;
}
