import { normalizeFilters, parseDiscoveryQuery } from "./discovery.js";

/** Title lookup must not inherit restrictions from a previous browse. */
export function planSearch(
  text,
  { exploreFilters = {}, searchType = "all" } = {},
) {
  const query = String(text ?? "").trim();
  if (!query)
    return normalizeFilters({ ...exploreFilters, mode: "discover", query: "" });
  const parsed = parseDiscoveryQuery(query, exploreFilters);
  if (parsed.recognized && parsed.mode === "discover") return parsed;
  return normalizeFilters({
    mode: "search",
    query,
    mediaType: searchType,
    includeUpcoming: true,
    limit: 30,
    genreId: "",
    yearFrom: "",
    yearTo: "",
    sort: "popular",
    minVotes: 0,
  });
}

const identityKey = (item) =>
  `${item.mediaType || item.media_type || "movie"}-${Number(item.id)}`;
const recordDate = (item) =>
  String(item.watchedDate || item.addedAt || item.addedDate || "");
const validIdentity = (item) =>
  item && Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0;

/** Automatic suggestions use evidence of enjoyment; a deliberate seed can be any saved title. */
export function recommendationSeeds(
  snapshot = {},
  { seedKey = "", offset = 0, limit = 4 } = {},
) {
  const watched = Array.isArray(snapshot.watched) ? snapshot.watched : [];
  const watchlist = Array.isArray(snapshot.watchlist) ? snapshot.watchlist : [];
  const count = Number.isFinite(Number(limit))
    ? Math.max(0, Math.trunc(Number(limit)))
    : 4;
  if (!count) return [];
  const selectedKey = String(seedKey).replace(":", "-");
  if (selectedKey) {
    const selected = [...watched, ...watchlist].find(
      (item) => validIdentity(item) && identityKey(item) === selectedKey,
    );
    if (selected) return [selected];
  }
  const pool = new Map();
  for (const item of [
    ...watched.filter((item) => Number(item?.rating) >= 7),
    ...watched.filter((item) => item?.favorite === true),
    ...watchlist.filter((item) => item?.favorite === true),
  ]) {
    if (validIdentity(item) && !pool.has(identityKey(item)))
      pool.set(identityKey(item), item);
  }
  const candidates = [...pool.values()].sort(
    (a, b) =>
      (Number(b.rating) || 0) - (Number(a.rating) || 0) ||
      recordDate(b).localeCompare(recordDate(a)) ||
      identityKey(a).localeCompare(identityKey(b)),
  );
  if (!candidates.length) return [];
  const amount = Number.isFinite(Number(offset))
    ? Math.trunc(Number(offset))
    : 0;
  const start =
    ((amount % candidates.length) + candidates.length) % candidates.length;
  return [...candidates.slice(start), ...candidates.slice(0, start)].slice(
    0,
    count,
  );
}

function pickScalars(value, properties) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value))
    return result;
  for (const name of properties) {
    const field = value[name];
    if (
      field === null ||
      typeof field === "string" ||
      typeof field === "boolean" ||
      (typeof field === "number" && Number.isFinite(field))
    )
      result[name] = field;
  }
  return result;
}

function namedEntries(entries, properties, limit) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter(
      (entry) => entry && typeof entry.name === "string" && entry.name.trim(),
    )
    .slice(0, limit)
    .map((entry) => pickScalars(entry, properties));
}

function providerMetadata(value) {
  const result = pickScalars(value, ["link"]);
  for (const group of ["flatrate", "free", "ads", "rent", "buy"]) {
    if (Array.isArray(value?.[group]))
      result[group] = value[group]
        .filter(
          (provider) => provider && typeof provider.provider_name === "string",
        )
        .map((provider) =>
          pickScalars(provider, [
            "provider_id",
            "provider_name",
            "logo_path",
            "display_priority",
          ]),
        );
  }
  return result;
}

/** Persist catalog details, never an API's bulky response or a copy of personal records. */
export function metadataForStorage(item = {}) {
  const result = pickScalars(item, [
    "id",
    "title",
    "name",
    "poster_path",
    "backdrop_path",
    "release_date",
    "first_air_date",
    "overview",
    "runtime",
    "vote_average",
    "vote_count",
    "tagline",
    "number_of_episodes",
    "number_of_seasons",
    "status",
    "original_language",
  ]);
  result.mediaType =
    item.mediaType === "tv" || item.media_type === "tv" ? "tv" : "movie";
  if (Array.isArray(item.genres))
    result.genres = namedEntries(item.genres, ["id", "name"], 100);
  if (Array.isArray(item.cast))
    result.cast = namedEntries(
      item.cast,
      ["id", "name", "original_name", "character", "profile_path", "order"],
      12,
    );
  if (Array.isArray(item.crew))
    result.crew = namedEntries(
      item.crew,
      ["id", "name", "original_name", "job", "department", "profile_path"],
      12,
    );
  if (item.externalIds)
    result.externalIds = pickScalars(item.externalIds, [
      "imdb_id",
      "wikidata_id",
      "facebook_id",
      "instagram_id",
      "twitter_id",
      "tvdb_id",
      "tvrage_id",
    ]);
  if (item.watchProviders)
    result.watchProviders = providerMetadata(item.watchProviders);
  if (item.belongs_to_collection)
    result.belongs_to_collection = pickScalars(item.belongs_to_collection, [
      "id",
      "name",
      "poster_path",
      "backdrop_path",
    ]);
  return result;
}

const PERSONAL_EDIT_FIELDS = new Set([
  "rating",
  "notes",
  "review",
  "watchedDate",
  "addedAt",
  "addedDate",
  "tags",
  "favorite",
  "priority",
  "logs",
  "date",
]);
const PROGRESS_EDIT_FIELDS = new Set([
  "progress.watchedEpisodes",
  "progress.totalEpisodes",
  "progress.currentSeason",
  "progress.currentEpisode",
  "progress.status",
]);
const copyEditValue = (value) =>
  value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function sameEditValue(left, right) {
  if (left === right) return true;
  if (
    !left ||
    !right ||
    typeof left !== "object" ||
    typeof right !== "object" ||
    Array.isArray(left) !== Array.isArray(right)
  )
    return false;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) && sameEditValue(left[key], right[key]),
    )
  );
}

/** Keep external changes to untouched fields, and flag concurrent edits to the same field. */
export function mergePersonalEdits(base = {}, current = {}, edits = {}) {
  if (!edits || typeof edits !== "object" || Array.isArray(edits))
    throw new Error("Personal edits must be an object.");
  const changes = {},
    conflicts = [];
  for (const [key, value] of Object.entries(edits)) {
    const progressField = PROGRESS_EDIT_FIELDS.has(key)
      ? key.slice("progress.".length)
      : "";
    if (!progressField && !PERSONAL_EDIT_FIELDS.has(key))
      throw new Error(`Unsupported personal field: ${key}`);
    const originalValue = progressField
      ? base?.progress?.[progressField]
      : base?.[key];
    const currentValue = progressField
      ? current?.progress?.[progressField]
      : current?.[key];
    if (
      !sameEditValue(originalValue, currentValue) &&
      !sameEditValue(value, currentValue)
    )
      conflicts.push(key);
    if (progressField) {
      if (!changes.progress)
        changes.progress = copyEditValue(current?.progress || {});
      changes.progress[progressField] = copyEditValue(value);
    } else changes[key] = copyEditValue(value);
  }
  return { changes, conflicts };
}
