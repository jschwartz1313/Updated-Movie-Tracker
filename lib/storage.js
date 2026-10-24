const LIBRARY_KEY = "movieTrackerData";
const HIDDEN_KEY = "hiddenItems";
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const PERSONAL_FIELDS = [
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
  "progress",
];

const emptyLibrary = () => ({
  version: 2,
  watchlist: [],
  watched: [],
  hiddenItems: [],
});
const keyOf = (item) => `${item.mediaType}-${item.id}`;
const copy = (value) => JSON.parse(JSON.stringify(value));

function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Everything persisted is JSON data. Reject dangerous property names before any merge.
function cleanJSON(value, path = "item", seen = new Set()) {
  if (value === null || ["string", "boolean"].includes(typeof value))
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || seen.has(value))
    throw new Error(`${path} must contain ordinary JSON data.`);
  seen.add(value);
  const result = Array.isArray(value) ? [] : {};
  for (const name of Object.keys(value)) {
    if (UNSAFE_KEYS.has(name))
      throw new Error(`${path} contains an unsafe property name.`);
    if (value[name] !== undefined)
      result[name] = cleanJSON(value[name], `${path}.${name}`, seen);
  }
  seen.delete(value);
  return result;
}

function identity(id, mediaType = "movie") {
  const number = typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id;
  if (!Number.isSafeInteger(number) || number < 1)
    throw new Error("Each title needs a valid movie or TV identifier.");
  if (!["movie", "tv"].includes(mediaType))
    throw new Error("The media type must be movie or tv.");
  return { id: number, mediaType };
}

function dateOnly(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(value))
    throw new Error("The watched date must use YYYY-MM-DD.");
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error("Choose a valid watched date.");
  }
  return day;
}

function positiveID(value) {
  const number =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function ratingValue(value, recover, message) {
  const rating =
    value === undefined || value === null || value === ""
      ? 0
      : ["number", "string"].includes(typeof value)
        ? Number(value)
        : NaN;
  return Number.isFinite(rating) &&
    (rating === 0 ||
      (rating >= 1 && rating <= 10 && Number.isInteger(rating * 2)))
    ? rating
    : recover(message, 0);
}

function normalizeTags(raw, recover, title) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw))
    return recover(`The tags for “${title}” must be a list.`, []);
  const tags = new Map();
  for (const value of raw) {
    if (
      typeof value !== "string" ||
      !value.trim() ||
      value.trim().length > 60
    ) {
      recover(`Each tag for “${title}” must contain 1 to 60 characters.`, null);
      continue;
    }
    const tag = value.trim();
    if (!tags.has(tag.toLocaleLowerCase()))
      tags.set(tag.toLocaleLowerCase(), tag);
  }
  if (tags.size > 20) recover(`A title can have at most 20 tags.`, null);
  return [...tags.values()].slice(0, 20);
}

function normalizeLogs(raw, item, status, recover) {
  // An absent field belongs to the old single-viewing schema. An explicitly
  // empty journal is intentional, including after its last entry is deleted.
  if (raw === undefined)
    return status === "watched"
      ? [
          {
            id: `legacy:${item.mediaType}:${item.id}`,
            date: item.watchedDate,
            rating: item.rating,
            notes: item.notes,
          },
        ]
      : [];
  if (!Array.isArray(raw))
    return recover(
      `The viewing journal for “${item.title}” must be a list.`,
      [],
    );
  const logs = [];
  const ids = new Set();
  for (const entry of raw) {
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      typeof entry.id !== "string" ||
      !entry.id.trim() ||
      entry.id.length > 200
    ) {
      recover(
        `Each viewing for “${item.title}” needs a valid identifier.`,
        null,
      );
      continue;
    }
    if (ids.has(entry.id)) {
      recover(
        `The viewing journal for “${item.title}” contains duplicate identifiers.`,
        null,
      );
      continue;
    }
    let date = "";
    try {
      date = dateOnly(entry.date);
    } catch (error) {
      date = recover(error.message, "");
    }
    const rating = ratingValue(
      entry.rating,
      recover,
      `A viewing rating must be 0 or a score from 1 to 10 in half-point steps.`,
    );
    const notes =
      entry.notes === undefined
        ? ""
        : typeof entry.notes === "string"
          ? entry.notes
          : recover(`Viewing notes for “${item.title}” must be text.`, "");
    ids.add(entry.id);
    logs.push({ id: entry.id, date, rating, notes });
  }
  return logs;
}

function normalizeProgress(raw, item, status, recover) {
  if (raw === undefined) {
    if (item.mediaType !== "tv") return undefined;
    return {
      watchedEpisodes: 0,
      totalEpisodes: 0,
      status: status === "watched" ? "completed" : "planned",
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return recover(`The TV progress for “${item.title}” must be an object.`, {
      watchedEpisodes: 0,
      totalEpisodes: 0,
      status: "planned",
    });
  }
  const progress = {};
  for (const name of ["watchedEpisodes", "totalEpisodes"]) {
    progress[name] =
      Number.isSafeInteger(raw[name]) && raw[name] >= 0 && raw[name] <= 100000
        ? raw[name]
        : recover(
            `TV episode counts must be whole numbers from 0 to 100000.`,
            Number.isSafeInteger(raw[name]) && raw[name] > 100000 ? 100000 : 0,
          );
  }
  if (
    progress.totalEpisodes > 0 &&
    progress.watchedEpisodes > progress.totalEpisodes
  ) {
    recover(`Watched episodes cannot exceed the total episode count.`, null);
    progress.totalEpisodes = progress.watchedEpisodes;
  }
  progress.status = [
    "watching",
    "completed",
    "paused",
    "dropped",
    "planned",
  ].includes(raw.status)
    ? raw.status
    : recover(`Choose a valid TV progress status.`, "planned");
  for (const name of ["currentSeason", "currentEpisode"]) {
    const maximum = name === "currentSeason" ? 10000 : 100000;
    if (raw[name] !== undefined)
      progress[name] =
        Number.isSafeInteger(raw[name]) &&
        raw[name] >= 0 &&
        raw[name] <= maximum
          ? raw[name]
          : recover(
              `The ${name === "currentSeason" ? "season" : "episode"} marker must be a whole number from 0 to ${maximum}.`,
              Number.isSafeInteger(raw[name]) && raw[name] > maximum
                ? maximum
                : 0,
            );
  }
  return progress;
}

function normalizeCredits(list, property, recover, title) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list))
    return recover(`The ${property} for “${title}” must be a list.`, []);
  const result = [];
  for (const entry of list) {
    let valid =
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof entry.name === "string" &&
      entry.name.trim();
    if (valid && property === "genres") valid = positiveID(entry.id) !== null;
    if (valid && property !== "genres") {
      if (
        entry.id !== undefined &&
        entry.id !== null &&
        positiveID(entry.id) === null
      )
        valid = false;
      for (const field of [
        "original_name",
        "character",
        "job",
        "department",
        "known_for_department",
        "profile_path",
        "credit_id",
      ]) {
        if (
          entry[field] !== undefined &&
          entry[field] !== null &&
          typeof entry[field] !== "string"
        )
          valid = false;
      }
      for (const field of ["gender", "cast_id", "order"]) {
        if (
          entry[field] !== undefined &&
          entry[field] !== null &&
          (!Number.isSafeInteger(entry[field]) || entry[field] < 0)
        )
          valid = false;
      }
      if (
        entry.popularity !== undefined &&
        entry.popularity !== null &&
        (typeof entry.popularity !== "number" || entry.popularity < 0)
      )
        valid = false;
      if (
        entry.adult !== undefined &&
        entry.adult !== null &&
        typeof entry.adult !== "boolean"
      )
        valid = false;
    }
    if (!valid) {
      recover(
        `The ${property} for “${title}” contains an invalid entry. Each entry needs a name${property === "genres" ? " and a valid genre identifier" : ""}.`,
        null,
      );
      continue;
    }
    result.push(
      entry.id === undefined || entry.id === null
        ? entry
        : { ...entry, id: positiveID(entry.id) },
    );
  }
  return result;
}

function normalizeItem(raw, status, { strict = true, warn = () => {} } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Each saved title must be an object.");
  const item = cleanJSON(raw);
  Object.assign(
    item,
    identity(item.id, item.mediaType ?? item.media_type ?? "movie"),
  );
  const recover = (message, fallback) => {
    if (strict) throw new Error(message);
    warn(message);
    return fallback;
  };
  item.title =
    typeof item.title === "string" && item.title.trim()
      ? item.title
      : typeof item.name === "string" && item.name.trim()
        ? item.name
        : "Untitled";
  for (const property of ["genres", "cast", "crew"]) {
    item[property] = normalizeCredits(
      item[property],
      property,
      recover,
      item.title,
    );
  }
  if (item.credits !== undefined && item.credits !== null) {
    if (typeof item.credits !== "object" || Array.isArray(item.credits))
      item.credits = recover(
        `The credits for “${item.title}” must be an object.`,
        {},
      );
    for (const property of ["cast", "crew"]) {
      if (Object.hasOwn(item.credits, property))
        item.credits[property] = normalizeCredits(
          item.credits[property],
          property,
          recover,
          item.title,
        );
    }
  }
  if (item.genre_ids !== undefined && item.genre_ids !== null) {
    if (!Array.isArray(item.genre_ids))
      item.genre_ids = recover(
        `The genre identifiers for “${item.title}” must be a list.`,
        [],
      );
    item.genre_ids = item.genre_ids.flatMap((value) => {
      const id = positiveID(value);
      if (id !== null) return [id];
      recover(
        `The genre identifiers for “${item.title}” contain an invalid identifier.`,
        null,
      );
      return [];
    });
  }
  item.rating = ratingValue(
    item.rating,
    recover,
    `The rating for “${item.title}” must be 0 or a score from 1 to 10 in half-point steps.`,
  );
  const notes = item.notes ?? item.review ?? "";
  item.notes =
    typeof notes === "string"
      ? notes
      : recover(`The notes for “${item.title}” must be text.`, "");
  item.review = item.notes;
  try {
    item.watchedDate = dateOnly(item.watchedDate);
  } catch (error) {
    item.watchedDate = recover(error.message, "");
  }
  item.tags = normalizeTags(item.tags, recover, item.title);
  item.favorite =
    item.favorite === undefined
      ? false
      : typeof item.favorite === "boolean"
        ? item.favorite
        : recover(
            `The favorite flag for “${item.title}” must be true or false.`,
            false,
          );
  item.priority =
    item.priority === undefined
      ? "normal"
      : ["high", "normal", "low"].includes(item.priority)
        ? item.priority
        : recover(`Choose high, normal, or low priority.`, "normal");
  item.logs = normalizeLogs(item.logs, item, status, recover);
  const progress = normalizeProgress(item.progress, item, status, recover);
  if (progress !== undefined) item.progress = progress;
  const added = item.addedAt || item.addedDate || item.watchedDate;
  let validAdded =
    !added || (typeof added === "string" && Number.isFinite(Date.parse(added)));
  if (added && validAdded && /^\d{4}-\d{2}-\d{2}/.test(added)) {
    try {
      dateOnly(added);
    } catch {
      validAdded = false;
    }
  }
  if (!validAdded) {
    item.addedAt = recover(
      `The added date for “${item.title}” is invalid.`,
      new Date().toISOString(),
    );
  } else
    item.addedAt = added
      ? new Date(added).toISOString()
      : new Date().toISOString();
  return item;
}

function normalizeHidden(raw, strict, warn) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    if (strict) throw new Error("Hidden titles must be a list.");
    warn("The saved hidden-title list could not be read.");
    return [];
  }
  const hidden = new Set();
  for (const value of raw) {
    if (
      typeof value !== "string" ||
      !/^(movie|tv)-[1-9]\d*$/.test(value) ||
      !Number.isSafeInteger(Number(value.split("-")[1]))
    ) {
      if (strict) throw new Error("A hidden title has an invalid identifier.");
      warn("Some hidden-title identifiers could not be read.");
      continue;
    }
    hidden.add(value);
  }
  return [...hidden];
}

// Prefer meaningful personal records and keep the first date a title was added.
function mergeRecords(
  primary,
  secondary,
  {
    preferCurrent = false,
    preserveMain = false,
    syntheticPrimary = null,
    syntheticSecondary = null,
  } = {},
) {
  const result = { ...secondary, ...primary };
  for (const [name, value] of Object.entries(secondary)) {
    if (
      result[name] === null ||
      result[name] === "" ||
      (Array.isArray(result[name]) && !result[name].length)
    )
      result[name] = value;
  }
  result.rating = preserveMain
    ? primary.rating
    : primary.rating || secondary.rating || 0;
  result.notes = preserveMain
    ? primary.notes
    : primary.notes || secondary.notes || "";
  result.review = result.notes;
  result.tags = normalizeTags(
    [...(primary.tags || []), ...(secondary.tags || [])],
    (_message, fallback) => fallback,
    result.title,
  );
  result.favorite = preferCurrent
    ? primary.favorite
    : primary.favorite || secondary.favorite || false;
  result.priority = preferCurrent
    ? primary.priority
    : primary.priority !== "normal"
      ? primary.priority
      : secondary.priority || "normal";
  if (preferCurrent && primary.progress !== undefined)
    result.progress = primary.progress;
  const logs = new Map((secondary.logs || []).map((log) => [log.id, log]));
  for (const log of primary.logs || []) {
    const previous = logs.get(log.id);
    if (previous && syntheticPrimary?.has(log.id)) {
      // Only generated legacy entries use meaningful-field fallback. An
      // explicit journal entry can intentionally clear any of these fields.
      if (!syntheticSecondary?.has(log.id)) continue;
      logs.set(log.id, {
        ...log,
        date: log.date || previous.date,
        rating: log.rating || previous.rating,
        notes: log.notes || previous.notes,
      });
    } else logs.set(log.id, log);
  }
  result.logs = [...logs.values()];
  result.watchedDate =
    result.logs
      .map((log) => log.date)
      .filter(Boolean)
      .sort()
      .at(-1) || "";
  result.addedAt = [primary.addedAt, secondary.addedAt]
    .filter(Boolean)
    .sort()[0];
  return result;
}

function normalizeLibrary(raw, { strict = true, warn = () => {} } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("The backup must contain watchlist and watched lists.");
  if (raw.version !== undefined && ![1, 2].includes(raw.version))
    throw new Error("This backup uses an unsupported version.");
  for (const name of Object.keys(raw))
    if (UNSAFE_KEYS.has(name))
      throw new Error("The backup contains an unsafe property name.");
  const records = new Map();
  for (const status of ["watchlist", "watched"]) {
    const list = raw[status];
    if (!Array.isArray(list)) {
      if (strict)
        throw new Error(`The backup must contain a valid ${status} list.`);
      warn(`The saved ${status} list could not be read.`);
      continue;
    }
    for (const rawItem of list) {
      try {
        const item = normalizeItem(rawItem, status, { strict, warn });
        const previous = records.get(keyOf(item));
        const syntheticLogIds = new Set(
          status === "watched" && rawItem.logs === undefined
            ? item.logs.map((log) => log.id)
            : [],
        );
        const mergedSyntheticIds = new Set([
          ...syntheticLogIds,
          ...(previous?.syntheticLogIds || []),
        ]);
        // Keep migration provenance in memory only. Once either duplicate has
        // an explicit journal entry, later synthetic duplicates cannot replace it.
        for (const entry of [
          { item, syntheticLogIds },
          ...(previous ? [previous] : []),
        ]) {
          for (const log of entry.item.logs)
            if (!entry.syntheticLogIds.has(log.id))
              mergedSyntheticIds.delete(log.id);
        }
        records.set(keyOf(item), {
          status,
          item: previous
            ? mergeRecords(item, previous.item, {
                syntheticPrimary: syntheticLogIds,
                syntheticSecondary: previous.syntheticLogIds,
              })
            : item,
          syntheticLogIds: mergedSyntheticIds,
        });
      } catch (error) {
        if (strict) throw error;
        warn(`Some saved titles could not be read: ${error.message}`);
      }
    }
  }
  const result = emptyLibrary();
  for (const { status, item } of records.values()) result[status].push(item);
  result.hiddenItems = normalizeHidden(raw.hiddenItems, strict, warn);
  return result;
}

/**
 * A synchronous, browser-local library. movieTrackerData is the atomic source of
 * truth; hiddenItems is a compatibility mirror for the previous application.
 * Call load() after a browser storage event to refresh another tab's changes.
 */
export function createLibraryStore(storage = globalThis.localStorage) {
  let state = emptyLibrary();
  let loaded = false;
  let warning = "";
  let previousState = null;
  let expectedRaw;
  let pendingRecovery = new Map();
  const listeners = new Set();

  function getSnapshot() {
    const snapshot = copy(state);
    if (warning) snapshot.warning = warning;
    return snapshot;
  }

  function publish() {
    for (const listener of [...listeners]) {
      // A failing view must never undo an already durable change.
      try {
        listener(getSnapshot());
      } catch (error) {
        console.error("A library listener failed:", error);
      }
    }
  }

  function read(key) {
    try {
      return storage.getItem(key);
    } catch {
      throw new Error(
        "Your saved library cannot be accessed. Allow browser storage and try again.",
      );
    }
  }

  function load() {
    const warnings = new Set();
    const recover = (key, raw, message) => {
      warnings.add(message);
      if (raw !== null) pendingRecovery.set(key, raw);
    };
    let raw;
    let hiddenRaw;
    try {
      raw = read(LIBRARY_KEY);
      hiddenRaw = read(HIDDEN_KEY);
    } catch (error) {
      warning = error.message;
      publish();
      return getSnapshot();
    }
    pendingRecovery = new Map();
    let next = emptyLibrary();
    let hasCanonicalHidden = false;
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw);
        hasCanonicalHidden = parsed && Object.hasOwn(parsed, "hiddenItems");
        next = normalizeLibrary(parsed, {
          strict: false,
          warn: (message) => recover(LIBRARY_KEY, raw, message),
        });
      } catch (error) {
        recover(
          LIBRARY_KEY,
          raw,
          `Your saved library could not be fully read. ${error.message}`,
        );
      }
    }
    if (!hasCanonicalHidden && hiddenRaw !== null) {
      try {
        next.hiddenItems = normalizeHidden(
          JSON.parse(hiddenRaw),
          false,
          (message) => recover(HIDDEN_KEY, hiddenRaw, message),
        );
      } catch {
        recover(
          HIDDEN_KEY,
          hiddenRaw,
          "Your hidden-title list could not be read.",
        );
      }
    }
    state = next;
    expectedRaw = raw;
    loaded = true;
    previousState = null;
    warning = warnings.size
      ? `${[...warnings].join(" ")} The original data is kept; a recovery copy will be saved before any changes.`
      : "";
    publish();
    return getSnapshot();
  }

  function ensureLoaded() {
    if (!loaded) {
      load();
      if (!loaded)
        throw new Error(warning || "Your saved library cannot be accessed.");
    }
  }

  function persist(
    next,
    { undoing = false, preserveUndo = false, nextUndo = previousState } = {},
  ) {
    ensureLoaded();
    // Refuse to overwrite another tab. The caller can reload and repeat the action.
    if (read(LIBRARY_KEY) !== expectedRaw)
      throw new Error(
        "Your library changed in another tab. Refresh the library and try again.",
      );
    if (JSON.stringify(next) === JSON.stringify(state)) return getSnapshot();
    try {
      for (const [key, original] of pendingRecovery) {
        let backupKey = `${key}.recovery.${Date.now()}`;
        let suffix = 0;
        while (storage.getItem(backupKey) !== null)
          backupKey = `${key}.recovery.${Date.now()}.${++suffix}`;
        storage.setItem(backupKey, original);
        pendingRecovery.delete(key);
      }
      const serialized = JSON.stringify(next);
      storage.setItem(LIBRARY_KEY, serialized);
      expectedRaw = serialized;
    } catch {
      throw new Error(
        "Your changes could not be saved. Browser storage may be full or unavailable. Your previous library is still intact.",
      );
    }
    const oldState = state;
    state = next;
    previousState = undoing ? null : preserveUndo ? nextUndo : copy(oldState);
    pendingRecovery.clear();
    warning = "";
    try {
      storage.setItem(HIDDEN_KEY, JSON.stringify(state.hiddenItems));
    } catch {
      warning =
        "Your library is saved, but the compatibility copy of hidden titles could not be updated.";
    }
    publish();
    return getSnapshot();
  }

  function find(id, mediaType) {
    const match = identity(id, mediaType);
    const key = keyOf(match);
    for (const status of ["watched", "watchlist"]) {
      const item = state[status].find((candidate) => keyOf(candidate) === key);
      if (item) return { item, status, key };
    }
    return { key, item: undefined };
  }

  function saveItem(rawItem, status, changes = {}) {
    ensureLoaded();
    if (!["watchlist", "watched"].includes(status))
      throw new Error("Choose watchlist or watched for this title.");
    if (!rawItem || typeof rawItem !== "object" || Array.isArray(rawItem))
      throw new Error("Each saved title must be an object.");
    const incoming = cleanJSON(rawItem);
    Object.assign(
      incoming,
      identity(
        incoming.id,
        incoming.mediaType ?? incoming.media_type ?? "movie",
      ),
    );
    const record = find(incoming.id, incoming.mediaType);
    const existing = record.item;
    const combined = { ...existing, ...incoming };
    // A repeated network response must never clear a user's rating or notes.
    if (existing)
      for (const name of PERSONAL_FIELDS)
        if (Object.hasOwn(existing, name)) combined[name] = existing[name];
    const patch = cleanJSON(changes, "changes");
    if (!patch || Array.isArray(patch) || typeof patch !== "object")
      throw new Error("Title changes must be an object.");
    Object.assign(combined, patch, {
      id: incoming.id,
      mediaType: incoming.mediaType,
    });
    if (Object.hasOwn(patch, "review") && !Object.hasOwn(patch, "notes"))
      combined.notes = patch.review;
    if (
      status === "watched" &&
      !combined.watchedDate &&
      !Object.hasOwn(patch, "watchedDate") &&
      record.status !== "watched" &&
      !(combined.logs || []).length
    )
      combined.watchedDate = today();
    if (
      status === "watched" &&
      record.status === "watchlist" &&
      !(combined.logs || []).length &&
      !Object.hasOwn(patch, "logs")
    ) {
      delete combined.logs;
    }
    const item = normalizeItem(combined, status);
    const next = copy(state);
    if (record.status === status)
      next[status] = next[status].map((candidate) =>
        keyOf(candidate) === keyOf(item) ? item : candidate,
      );
    else {
      for (const list of ["watchlist", "watched"])
        next[list] = next[list].filter(
          (candidate) => keyOf(candidate) !== keyOf(item),
        );
      next[status].push(item);
    }
    return persist(next);
  }

  function updateItem(id, mediaType, changes) {
    ensureLoaded();
    const record = find(id, mediaType);
    if (!record.item)
      throw new Error("This title is no longer in your library.");
    return saveItem(record.item, record.status, changes);
  }

  function updateMetadata(id, mediaType, metadata) {
    ensureLoaded();
    const record = find(id, mediaType);
    if (!record.item)
      throw new Error("This title is no longer in your library.");
    const incoming = cleanJSON(metadata, "metadata");
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
      throw new Error("Title metadata must be an object.");
    const refresh = (item, status) => {
      const combined = {
        ...item,
        ...incoming,
        id: item.id,
        mediaType: item.mediaType,
      };
      for (const name of PERSONAL_FIELDS) {
        if (Object.hasOwn(item, name)) combined[name] = item[name];
        else delete combined[name];
      }
      return normalizeItem(combined, status);
    };
    const next = copy(state);
    next[record.status] = next[record.status].map((item) =>
      keyOf(item) === record.key ? refresh(item, record.status) : item,
    );
    const nextUndo = previousState ? copy(previousState) : null;
    if (nextUndo)
      for (const status of ["watchlist", "watched"]) {
        nextUndo[status] = nextUndo[status].map((item) =>
          keyOf(item) === record.key ? refresh(item, status) : item,
        );
      }
    return persist(next, { preserveUndo: true, nextUndo });
  }

  function logWatch(rawItem, event = {}, changes = {}) {
    ensureLoaded();
    const incoming = cleanJSON(rawItem);
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming))
      throw new Error("Each saved title must be an object.");
    const match = identity(
      incoming.id,
      incoming.mediaType ?? incoming.media_type ?? "movie",
    );
    const record = find(match.id, match.mediaType);
    const patch = cleanJSON(changes, "changes");
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw new Error("Title changes must be an object.");
    const detail = cleanJSON(event, "viewing");
    if (!detail || typeof detail !== "object" || Array.isArray(detail))
      throw new Error("A viewing must be an object.");
    const combined = { ...record.item, ...incoming };
    if (record.item)
      for (const name of PERSONAL_FIELDS) {
        if (Object.hasOwn(record.item, name))
          combined[name] = record.item[name];
      }
    Object.assign(combined, patch, match);
    if (Object.hasOwn(patch, "review") && !Object.hasOwn(patch, "notes"))
      combined.notes = patch.review;
    // The event has its own notes. Logging a rewatch never replaces title notes.
    const id = `watch:${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`}`;
    const log = {
      id,
      date: detail.date === undefined ? today() : detail.date,
      rating: detail.rating ?? 0,
      notes: detail.notes ?? "",
    };
    combined.logs = [...(record.item?.logs || []), log];
    combined.watchedDate =
      combined.logs
        .map((entry) => entry.date)
        .filter(Boolean)
        .sort()
        .at(-1) || "";
    if (Number(log.rating) > 0 && !Object.hasOwn(patch, "rating"))
      combined.rating = log.rating;
    const item = normalizeItem(combined, "watched");
    const next = copy(state);
    next.watchlist = next.watchlist.filter(
      (entry) => keyOf(entry) !== record.key,
    );
    if (record.status === "watched")
      next.watched = next.watched.map((entry) =>
        keyOf(entry) === record.key ? item : entry,
      );
    else next.watched.push(item);
    return persist(next);
  }

  function changeLog(id, mediaType, logId, changes, removing = false) {
    ensureLoaded();
    const record = find(id, mediaType);
    if (!record.item)
      throw new Error("This title is no longer in your library.");
    if (
      typeof logId !== "string" ||
      !record.item.logs.some((log) => log.id === logId)
    )
      throw new Error("This viewing is no longer in your journal.");
    const patch = removing ? {} : cleanJSON(changes, "viewing changes");
    if (!patch || typeof patch !== "object" || Array.isArray(patch))
      throw new Error("Viewing changes must be an object.");
    const logs = removing
      ? record.item.logs.filter((log) => log.id !== logId)
      : record.item.logs.map((log) =>
          log.id === logId ? { ...log, ...patch, id: log.id } : log,
        );
    const watchedDate =
      logs
        .map((log) => log.date)
        .filter(Boolean)
        .sort()
        .at(-1) || "";
    return saveItem(record.item, record.status, { logs, watchedDate });
  }

  function updateLog(id, mediaType, logId, changes) {
    return changeLog(id, mediaType, logId, changes);
  }

  function removeLog(id, mediaType, logId) {
    return changeLog(id, mediaType, logId, {}, true);
  }

  function removeItem(id, mediaType = "movie") {
    ensureLoaded();
    const { key } = find(id, mediaType);
    const next = copy(state);
    for (const status of ["watchlist", "watched"])
      next[status] = next[status].filter((item) => keyOf(item) !== key);
    return persist(next);
  }

  function setHidden(id, mediaType = "movie", hidden = true) {
    ensureLoaded();
    const key = keyOf(identity(id, mediaType));
    const next = copy(state);
    const items = new Set(next.hiddenItems);
    hidden ? items.add(key) : items.delete(key);
    next.hiddenItems = [...items];
    return persist(next);
  }

  function restoreHidden() {
    ensureLoaded();
    return persist({ ...copy(state), hiddenItems: [] });
  }

  function importData(text) {
    let parsed;
    if (typeof text !== "string")
      throw new Error("Choose a JSON library backup to import.");
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        "This file is not valid JSON. Choose a movie-tracker backup.",
      );
    }
    // Validate the entire file before touching either memory or storage.
    const imported = normalizeLibrary(cleanJSON(parsed, "backup"));
    ensureLoaded();
    const records = new Map();
    for (const [library, isCurrent] of [
      [imported, false],
      [state, true],
    ]) {
      for (const status of ["watchlist", "watched"]) {
        for (const item of library[status]) {
          const previous = records.get(keyOf(item));
          // An existing ongoing series or a movie deliberately moved back for a
          // rewatch must not become completed because an older backup says so.
          const keepCurrentWatchlist =
            isCurrent &&
            status === "watchlist" &&
            (item.mediaType === "tv" || item.logs.length > 0);
          const targetStatus = keepCurrentWatchlist
            ? "watchlist"
            : status === "watched" || previous?.status === "watched"
              ? "watched"
              : "watchlist";
          records.set(keyOf(item), {
            status: targetStatus,
            item: previous
              ? mergeRecords(
                  isCurrent ? item : previous.item,
                  isCurrent ? previous.item : item,
                  {
                    preferCurrent: isCurrent,
                    preserveMain:
                      isCurrent &&
                      (status === "watched" ||
                        item.logs.length > 0 ||
                        item.mediaType === "tv"),
                  },
                )
              : item,
          });
        }
      }
    }
    const next = emptyLibrary();
    for (const { status, item } of records.values())
      next[status].push({
        ...item,
        watchedDate:
          item.logs
            .map((log) => log.date)
            .filter(Boolean)
            .sort()
            .at(-1) || "",
      });
    next.hiddenItems = [
      ...new Set([...state.hiddenItems, ...imported.hiddenItems]),
    ];
    return persist(next);
  }

  function exportData() {
    ensureLoaded();
    return JSON.stringify(state, null, 2);
  }

  function undo() {
    ensureLoaded();
    if (!previousState) throw new Error("There is no saved change to undo.");
    return persist(copy(previousState), { undoing: true });
  }

  function subscribe(listener) {
    if (typeof listener !== "function")
      throw new Error("A library listener must be a function.");
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return {
    load,
    getSnapshot,
    saveItem,
    updateItem,
    updateMetadata,
    logWatch,
    updateLog,
    removeLog,
    removeItem,
    setHidden,
    restoreHidden,
    importData,
    exportData,
    undo,
    subscribe,
  };
}
