import {
  GENRES,
  parseDiscoveryQuery,
  normalizeFilters,
  describeFilters,
  createMovieClient,
} from "./lib/discovery.js?v=3.0.1";
import { createLibraryStore } from "./lib/storage.js?v=3.0.1";
import { filterLibrary, libraryStats } from "./lib/library.js?v=3.0.1";
import {
  planSearch,
  metadataForStorage,
  recommendationSeeds,
  mergePersonalEdits,
} from "./lib/app-model.js?v=3.0.1";

const $ = (id) => document.getElementById(id);
const escapeHTML = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const imageURL = (path, size = "w342") =>
  typeof path === "string" && /^\/[\w./-]+$/.test(path)
    ? `https://image.tmdb.org/t/p/${size}${path}`
    : "";
const typeOf = (item) => item.mediaType || item.media_type || "movie";
const keyOf = (item) => `${typeOf(item)}-${Number(item.id)}`;
const titleOf = (item) => item.title || item.name || "Untitled";
const yearOf = (item) =>
  String(item.release_date || item.first_air_date || "").slice(0, 4);
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const number = (n) => Number(n || 0).toLocaleString();
const plural = (n, word) => `${number(n)} ${word}${n === 1 ? "" : "s"}`;
const defaults = {
  mode: "discover",
  query: "",
  mediaType: "movie",
  genreId: "",
  yearFrom: "",
  yearTo: "",
  sort: "popular",
  minVotes: 500,
  limit: 50,
  runtimeMin: "",
  runtimeMax: "",
  minRating: 0,
  originalLanguage: "",
  watchProviderId: "",
  watchProviderName: "",
  watchRegion: "US",
  personId: "",
  personName: "",
  personRole: "cast",
  includeUpcoming: false,
};
const client = createMovieClient();
let storage;
try {
  storage = window.localStorage;
} catch {
  storage = {
    getItem() {
      throw Error("Browser storage is unavailable.");
    },
    setItem() {
      throw Error("Browser storage is unavailable.");
    },
  };
}
const store = createLibraryStore(storage);
let library = { watchlist: [], watched: [], hiddenItems: [] };
const state = {
  view: "discover",
  filters: { ...defaults },
  exploreFilters: { ...defaults },
  uiMode: "discover",
  display: "grid",
  detailDraft: null,
  recOffset: 0,
  selectedPerson: null,
  results: [],
  resultInfo: null,
  recommendations: [],
  recommendationsReady: false,
  recommendationContext: "",
  recommendationsHaveSeeds: false,
  discoveryController: null,
  recommendationController: null,
  detailController: null,
  detailItem: null,
  detailSequence: 0,
  detailPresentation: 0,
  queryRecognized: false,
  busy: false,
};
const itemCache = new Map();
const detailCache = new Map();
let toastTimer;
let recordDirty = false;
let dirtyFields = new Set();
let draftBase = null;
let draftBaseStatus = "";
let preferences = {};
try {
  preferences =
    JSON.parse(storage.getItem("movieTrackerPreferences") || "{}") || {};
} catch {}
const pendingMetadata = new Set();
const providerCache = new Map();
const peopleCache = new Map();
const recommendationCursors = new Map();
const seenRecommendations = new Set();
let providerRequest = 0;
let peopleRequest = 0;
let restoringLocation = true;
let appliedLocation = location.href;
function savePreferences(patch) {
  preferences = { ...preferences, ...patch };
  try {
    storage.setItem("movieTrackerPreferences", JSON.stringify(preferences));
  } catch {}
}
function allRecords() {
  return [...library.watchlist, ...library.watched];
}
function hasHistory(item) {
  const saved = getSaved(item) || item;
  return (saved.logs || []).length > 0 || getStatus(saved) === "watched";
}
function trackedState(item) {
  const saved = getSaved(item);
  if (!saved) return "";
  if (getStatus(saved) === "watched") return "watched";
  return typeOf(saved) === "tv" &&
    saved.progress?.status &&
    saved.progress.status !== "planned"
    ? saved.progress.status
    : "watchlist";
}

function getSaved(item) {
  const key = keyOf(item);
  return (
    library.watched.find((x) => keyOf(x) === key) ||
    library.watchlist.find((x) => keyOf(x) === key)
  );
}
function getStatus(item) {
  const key = keyOf(item);
  return library.watched.some((x) => keyOf(x) === key)
    ? "watched"
    : library.watchlist.some((x) => keyOf(x) === key)
      ? "watchlist"
      : "";
}
function hiddenKeys() {
  return library.hiddenItems || [];
}
function normalizeItem(item) {
  const mt = typeOf(item);
  const genres =
    Array.isArray(item.genres) && item.genres.length
      ? item.genres
      : (Array.isArray(item.genre_ids) ? item.genre_ids : [])
          .map((id) =>
            (GENRES[mt] || []).find((g) => Number(g.id) === Number(id)),
          )
          .filter(Boolean);
  return {
    ...item,
    mediaType: mt,
    title: titleOf(item),
    release_date: item.release_date || item.first_air_date || "",
    genres,
    runtime: item.runtime || item.episode_run_time?.[0] || null,
    cast: (Array.isArray(item.credits?.cast)
      ? item.credits.cast
      : Array.isArray(item.cast)
        ? item.cast
        : []
    )
      .filter((p) => p && typeof p.name === "string")
      .slice(0, 12),
    crew: (Array.isArray(item.credits?.crew)
      ? item.credits.crew
      : Array.isArray(item.crew)
        ? item.crew
        : []
    )
      .filter(
        (p) =>
          p &&
          typeof p.name === "string" &&
          (!p.job || ["Director", "Writer", "Creator"].includes(p.job)),
      )
      .slice(0, 12),
    externalIds: item.external_ids || item.externalIds || {},
    watchProviders: item["watch/providers"]?.results?.US || item.watchProviders,
  };
}
function mountToast() {
  // Native dialogs make outside controls inert. Keep Undo inside the open dialog.
  const host = document.querySelector("dialog[open]") || document.body;
  if ($("toast").parentElement !== host) host.append($("toast"));
}
function toast(message, undo = false) {
  clearTimeout(toastTimer);
  mountToast();
  $("toast-text").textContent = message;
  $("undo-button").hidden = !undo;
  $("toast").hidden = false;
  toastTimer = setTimeout(
    () => {
      $("toast").hidden = true;
    },
    undo ? 12000 : 6500,
  );
}
function reportStorageWarning(message = "") {
  $("storage-warning").textContent = message;
  $("storage-warning").hidden = !message;
}
function safeMutation(action, message, undo = true) {
  try {
    const before = JSON.stringify(store.getSnapshot());
    action();
    toast(message, undo && before !== JSON.stringify(store.getSnapshot()));
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}
function readFilters() {
  return normalizeFilters({
    mode: "discover",
    query: "",
    mediaType: $("media-type-filter").value,
    genreId: $("genre-filter").value,
    yearFrom: $("year-from").value,
    yearTo: $("year-to").value,
    sort: $("sort-filter").value,
    minVotes: Number($("min-votes").value),
    limit: Number($("result-limit").value),
    minRating: Number($("min-rating").value),
    runtimeMax: $("runtime-max").value || "",
    originalLanguage: $("original-language").value,
    watchRegion: $("watch-region").value,
    watchProviderId: $("watch-provider").value,
    watchProviderName:
      $("watch-provider").selectedOptions[0]?.textContent || "",
    personId: state.selectedPerson?.id || "",
    personName: state.selectedPerson?.name || "",
    personRole: $("person-role").value,
  });
}
function setSelect(id, value, label = value) {
  const el = $(id);
  const normalized = value === undefined || value === null ? "" : String(value);
  if (![...el.options].some((o) => o.value === normalized))
    el.add(new Option(String(label), normalized));
  el.value = normalized;
}
function populateGenres(mediaType = "movie", selected = "") {
  $("genre-filter").innerHTML =
    '<option value="">All genres</option>' +
    (GENRES[mediaType] || [])
      .map((g) => `<option value="${g.id}">${escapeHTML(g.name)}</option>`)
      .join("");
  $("genre-filter").value = selected;
}
function setMode(mode) {
  state.uiMode = mode;
  $("search-input").placeholder =
    mode === "search"
      ? "Enter a movie or TV title"
      : "Try: top 50 animated movies since 2000";
  $("explore-controls").hidden = mode === "search";
  $("search-controls").hidden = mode !== "search";
  $("explore-controls")
    .querySelectorAll("input,select,button")
    .forEach((el) => {
      el.disabled = mode === "search";
    });
  document
    .querySelectorAll("[data-mode]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.mode === mode)),
    );
}
function syncFilters(f) {
  setMode(f.mode);
  if (f.mode === "search") {
    $("search-type").value = f.mediaType;
    $("search-upcoming").checked = f.includeUpcoming;
    return;
  }
  state.exploreFilters = { ...f };
  $("media-type-filter").value = f.mediaType;
  populateGenres(f.mediaType, f.genreId);
  $("year-from").value = f.yearFrom || "";
  $("year-to").value = f.yearTo || "";
  $("sort-filter").value = f.sort;
  setSelect("min-votes", f.minVotes, `${number(f.minVotes)}+ votes`);
  setSelect("result-limit", f.limit, `${f.limit} titles`);
  setSelect("min-rating", f.minRating, `${f.minRating}+`);
  setSelect("runtime-max", f.runtimeMax || "0", `${f.runtimeMax} minutes`);
  setSelect("original-language", f.originalLanguage || "");
  setSelect("watch-region", f.watchRegion);
  setSelect(
    "watch-provider",
    f.watchProviderId || "",
    f.watchProviderName || f.watchProviderId || "Any service",
  );
  $("person-role").value = f.personRole;
  state.selectedPerson = f.personId
    ? { id: f.personId, name: f.personName || "Selected person" }
    : null;
  $("selected-person").innerHTML = state.selectedPerson
    ? `<span class="filter-chip">${escapeHTML(state.selectedPerson.name)} <button type="button" data-action="clear-person" aria-label="Remove person filter">×</button></span>`
    : "";
  const noAdvanced = f.sort === "trending",
    tv = f.mediaType === "tv";
  $("runtime-max").disabled = noAdvanced || tv;
  $("watch-provider").disabled = noAdvanced;
  $("find-person").disabled = noAdvanced || tv;
  $("person-query").disabled = noAdvanced || tv;
  $("person-role").disabled = noAdvanced || tv;
  $("min-votes").disabled = f.sort !== "rating";
  if ($("advanced-filters").open) loadProviderOptions();
}
function renderActiveFilters() {
  const f = state.filters;
  if (f.mode === "search") {
    $("active-filters").innerHTML = "";
    return;
  }
  const genre = (GENRES[f.mediaType] || []).find(
    (g) => String(g.id) === String(f.genreId),
  )?.name;
  const chips = [];
  if (genre) chips.push(["genreId", genre]);
  if (f.yearFrom || f.yearTo)
    chips.push(["years", `${f.yearFrom || "Any year"}–${f.yearTo || "today"}`]);
  if (f.minRating) chips.push(["minRating", `TMDB ${f.minRating}+`]);
  if (f.runtimeMax) chips.push(["runtimeMax", `Under ${f.runtimeMax} min`]);
  if (f.originalLanguage)
    chips.push(["originalLanguage", f.originalLanguage.toUpperCase()]);
  if (f.watchProviderId)
    chips.push(["watchProviderId", f.watchProviderName || "Selected service"]);
  if (f.personId)
    chips.push([
      "personId",
      `${f.personRole === "cast" ? "Cast" : "Crew"}: ${f.personName}`,
    ]);
  $("active-filters").innerHTML = chips
    .map(
      ([key, label]) =>
        `<button class="filter-chip" data-clear-filter="${key}">${escapeHTML(label)} <span aria-hidden="true">×</span><span class="visually-hidden">Remove filter</span></button>`,
    )
    .join("");
}
async function loadProviderOptions() {
  const request = ++providerRequest,
    mt = $("media-type-filter").value,
    region = $("watch-region").value,
    key = mt + region;
  try {
    const providers =
      providerCache.get(key) || (await client.watchProviders(mt, { region }));
    if (
      request !== providerRequest ||
      mt !== $("media-type-filter").value ||
      region !== $("watch-region").value
    ) return;
    providerCache.set(key, providers);
    const selected = $("watch-provider").value,
      selectedName = $("watch-provider").selectedOptions[0]?.textContent;
    $("watch-provider").innerHTML =
      '<option value="">Any service</option>' +
      providers
        .map(
          (p) =>
            `<option value="${Number(p.provider_id)}">${escapeHTML(p.provider_name)}</option>`,
        )
        .join("");
    setSelect("watch-provider", selected, selectedName);
  } catch (error) {
    if (request === providerRequest)
      toast("Service list could not load. " + error.message);
  }
}
async function findPerson() {
  const query = $("person-query").value.trim();
  if (!query) return;
  const request = ++peopleRequest;
  $("person-results").textContent = "Finding people…";
  try {
    const data = await client.people(query);
    if (request !== peopleRequest) return;
    (data.results || []).forEach((p) => peopleCache.set(String(p.id), p));
    $("person-results").innerHTML =
      (data.results || [])
        .slice(0, 8)
        .map(
          (p) =>
            `<button type="button" class="person-option" data-person-id="${Number(p.id)}"><strong>${escapeHTML(p.name)}</strong><span>${escapeHTML(p.known_for_department || "")}${p.known_for?.length ? " · " + escapeHTML(p.known_for.slice(0, 2).map(titleOf).join(", ")) : ""}</span></button>`,
        )
        .join("") ||
      '<p class="small muted">No matching people. Try a fuller name.</p>';
  } catch (error) {
    if (request === peopleRequest)
      $("person-results").textContent = error.message;
  }
}
function saveLocation() {
  const f = state.filters;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(f))
    if (
      Object.hasOwn(defaults, key) &&
      String(value) !== String(defaults[key]) &&
      value !== ""
    )
      params.set(key, value);
  const url = `${location.pathname}${params.size ? "?" + params : ""}#${state.view}`;
  if (url !== location.pathname + location.search + location.hash)
    history[restoringLocation ? "replaceState" : "pushState"](null, "", url);
  appliedLocation = location.href;
}
function locationFilters() {
  return normalizeFilters({
    ...defaults,
    ...Object.fromEntries(new URLSearchParams(location.search)),
  });
}
function restoreLocation() {
  if (location.hash === "#main" || location.href === appliedLocation) return;
  restoringLocation = true;
  try {
    const filters = locationFilters();
    const changed = JSON.stringify(filters) !== JSON.stringify(state.filters);
    state.filters = filters;
    syncFilters(filters);
    $("search-input").value = filters.mode === "search" ? filters.query : "";
    navigate(location.hash.slice(1) || "discover");
    if (changed) runDiscovery({ filters });
  } finally {
    restoringLocation = false;
  }
}
function resultTitle(f) {
  if (f.mode === "search") return `Results for “${f.query}”`;
  const genre = (GENRES[f.mediaType] || []).find(
    (g) => String(g.id) === String(f.genreId),
  )?.name;
  const media = f.mediaType === "tv" ? "TV shows" : "movies";
  return `${{ rating: `Top ${f.limit}`, popular: "Popular", newest: "Newest", trending: "Trending" }[f.sort] || "Explore"} ${genre ? genre.toLowerCase() + " " : ""}${media}${f.yearFrom ? ` · ${f.yearFrom}${f.yearTo && f.yearTo !== f.yearFrom ? "–" + f.yearTo : f.yearTo === f.yearFrom ? "" : " onward"}` : f.yearTo ? " · through " + f.yearTo : ""}`;
}
async function runDiscovery({
  parse = false,
  append = false,
  filters: submitted,
} = {}) {
  const cursor = append ? state.resultInfo?.nextCursor : null;
  if (append && !cursor) return;
  state.discoveryController?.abort();
  const controller = new AbortController();
  state.discoveryController = controller;
  try {
    let filters =
      submitted ||
      (append
        ? state.filters
        : state.uiMode === "search" && state.filters.mode === "search"
          ? {
              ...state.filters,
              mediaType: $("search-type").value,
              includeUpcoming: $("search-upcoming").checked,
            }
          : readFilters());
    if (parse) {
      filters = planSearch($("search-input").value, {
        exploreFilters: readFilters(),
        searchType: $("search-type").value,
        literalTitle: state.uiMode === "search",
      });
      if (filters.mode === "search")
        filters.includeUpcoming = $("search-upcoming").checked;
    }
    filters = normalizeFilters(filters);
    // Parser metadata is not part of a saved search or its pagination identity.
    filters.recognized = false;
    if (filters.mode === "discover" && filters.mediaType === "tv") {
      filters.personId = "";
      filters.personName = "";
      filters.runtimeMin = "";
      filters.runtimeMax = "";
    }
    if (filters.mode === "discover" && filters.sort === "trending") {
      filters.personId = "";
      filters.personName = "";
      filters.runtimeMin = "";
      filters.runtimeMax = "";
      filters.watchProviderId = "";
      filters.watchProviderName = "";
    }
    if (filters.mode === "search" && !filters.query) {
      clearTitleSearch(filters);
      return;
    }
    state.filters = filters;
    syncFilters(filters);
    saveLocation();
    renderActiveFilters();
    state.busy = true;
    if (!append) {
      state.results = [];
      state.resultInfo = null;
      $("discover-grid").innerHTML =
        '<div class="skeleton" aria-hidden="true"></div>'.repeat(5);
    }
    $("results-title").textContent = resultTitle(filters);
    $("results-kicker").textContent =
      filters.mode === "search"
        ? "TITLE SEARCH"
        : filters.sort === "rating"
          ? "COMMUNITY FAVORITES"
          : "THE NEXT WATCH";
    $("results-count").textContent = append
      ? `${state.results.length} shown · loading more…`
      : "Finding titles…";
    $("query-summary").hidden = false;
    $("query-summary").textContent = describeFilters(filters);
    $("discover-message").innerHTML =
      '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>' +
      (append ? "Loading more titles…" : "Searching the catalog…") +
      "</div>";
    $("discover-grid").setAttribute("aria-busy", "true");
    $("load-more").disabled = true;
    const exclude = [
      ...hiddenKeys(),
      ...($("hide-watched").checked
        ? allRecords().filter(hasHistory).map(keyOf)
        : []),
    ].map((k) => k.replace("-", ":"));
    const data = await client[
      filters.mode === "search" ? "search" : "discover"
    ](filters, {
      signal: controller.signal,
      excludeKeys: exclude,
      ...(cursor ? { cursor } : {}),
    });
    if (controller !== state.discoveryController || controller.signal.aborted)
      return;
    state.results = append ? [...state.results, ...data.results] : data.results;
    state.resultInfo = data;
    state.busy = false;
    renderDiscovery();
  } catch (error) {
    if (controller !== state.discoveryController || controller.signal.aborted)
      return;
    state.busy = false;
    $("discover-grid").removeAttribute("aria-busy");
    $("load-more").disabled = false;
    if (!append) $("discover-grid").innerHTML = "";
    $("results-count").textContent = append
      ? `${state.results.length} shown`
      : "Search needs attention";
    $("discover-message").innerHTML =
      `<div class="notice warning" role="alert">${escapeHTML(error.message || "The catalog could not be reached.")} <button class="text-btn" data-action="${append ? "load-more" : "retry-discovery"}">Try again</button></div>`;
  }
}
function renderDiscovery() {
  if (state.busy) return;
  $("discover-grid").removeAttribute("aria-busy");
  const visible = state.results.filter(
    (x) =>
      !hiddenKeys().includes(keyOf(x)) &&
      (!$("hide-watched").checked || !hasHistory(x)),
  );
  const info = state.resultInfo;
  $("results-count").textContent = info
    ? `${visible.length} shown${info.totalResultsExact && info.totalResults > visible.length ? " of " + number(info.totalResults) : ""}`
    : "";
  $("discover-message").innerHTML = info?.warning
    ? `<div class="notice warning">${escapeHTML(info.warning)} <button class="text-btn" data-action="${info.hasMore ? "load-more" : "retry-discovery"}">Try again</button></div>`
    : "";
  renderCards($("discover-grid"), visible, {
    rank: state.filters.sort === "rating" && state.filters.mode !== "search",
  });
  $("load-more").hidden = !info?.hasMore;
  $("load-more").disabled = false;
  if (!visible.length)
    $("discover-grid").innerHTML = empty(
      "No titles found.",
      state.filters.mode === "search"
        ? "Try a different title or switch between movies and TV."
        : "Try fewer filters, a wider date range, or a different streaming service.",
      '<button class="btn secondary" data-action="reset-discovery">Reset search</button>',
    );
}
function empty(title, text, action = "") {
  return `<div class="empty"><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p>${action}</div>`;
}
function renderCards(container, items, { rank = false } = {}) {
  const fragment = document.createDocumentFragment();
  for (const [index, item] of items.entries()) {
    itemCache.set(keyOf(item), item);
    const saved = getSaved(item),
      status = getStatus(item),
      tracking = trackedState(item),
      key = keyOf(item),
      display = saved || item;
    const image = imageURL(item.poster_path || saved?.poster_path),
      rating = Number(item.vote_average || saved?.vote_average),
      tv = typeOf(item) === "tv";
    const card = document.createElement("article");
    card.className = "movie-card";
    card.dataset.key = key;
    const progress = saved?.progress,
      progressText =
        tv && progress && progress.status !== "planned"
          ? `${progress.watchedEpisodes}${progress.totalEpisodes ? " / " + progress.totalEpisodes : ""} episodes${progress.currentSeason ? " · S" + progress.currentSeason + (progress.currentEpisode ? " E" + progress.currentEpisode : "") : ""}`
          : "";
    const tracked =
      tracking === "watchlist"
        ? "Watchlist"
        : tracking === "watched"
          ? tv
            ? "Completed"
            : "Watched"
          : tracking
            ? tracking[0].toUpperCase() + tracking.slice(1)
            : "";
    card.innerHTML = `<div class="poster-frame"><button class="poster-button" data-action="details" data-key="${key}" aria-label="Details for ${escapeHTML(titleOf(item))}">${image ? `<img class="movie-poster" src="${image}" alt="" loading="lazy" decoding="async" width="342" height="513">` : `<span class="poster-placeholder">${escapeHTML(titleOf(item))}</span>`}${rank ? `<span class="rank-badge">${index + 1}</span>` : ""}${rating > 0 ? `<span class="score-badge" title="TMDB community rating · ${number(item.vote_count || saved?.vote_count)} votes">★ ${rating.toFixed(1)}</span>` : ""}</button><button class="favorite-button ${saved?.favorite ? "is-favorite" : ""}" data-action="favorite" data-key="${key}" aria-label="${saved?.favorite ? "Remove" : "Add"} ${escapeHTML(titleOf(item))} ${saved?.favorite ? "from" : "to"} favorites" aria-pressed="${!!saved?.favorite}">${saved?.favorite ? "♥" : "♡"}</button></div><div class="movie-info"><button class="title-button" data-action="details" data-key="${key}">${escapeHTML(titleOf(item))}</button><div class="movie-meta"><span>${escapeHTML(yearOf(item) || "Date not announced")}${String(item.release_date || item.first_air_date || "") > today() ? " · Upcoming" : ""}${saved?.rating ? ` · Your rating ${saved.rating}/10` : ""}${Number(display.runtime) > 0 ? ` · ${Number(display.runtime)} min` : ""}</span><span class="type">${tv ? "TV SERIES" : "FILM"}</span></div>${saved?.priority === "high" && status !== "watched" ? '<span class="priority-label">↑ High priority</span>' : ""}${progressText ? `<div class="progress-copy">${escapeHTML(progressText)}</div><div class="watch-progress"><span style="width:${progress.totalEpisodes ? Math.min(100, (progress.watchedEpisodes / progress.totalEpisodes) * 100) : 0}%"></span></div>` : ""}<div class="card-actions">${status === "watched" ? `<button class="saved" data-action="details" data-key="${key}">✓ ${tv ? "Completed" : "Watched"} · Edit</button><button data-action="log-again" data-key="${key}">Watch again</button>` : `<button class="${status ? "saved" : ""}" data-action="${status ? "details" : "save-watchlist"}" data-key="${key}">${status ? "✓ " + tracked : "+ Watchlist"}</button><button data-action="${tv ? "track-tv" : "draft-watched"}" data-key="${key}">${tv ? (tracking && tracking !== "watchlist" ? "Update progress" : "Track series") : "Log watched"}</button>`}</div>${saved?.logs?.length ? `<p class="card-note">${saved.logs.length} ${saved.logs.length === 1 ? "viewing" : "viewings"}${saved.watchedDate ? " · Last " + escapeHTML(saved.watchedDate) : " · Date unknown"}</p>` : ""}${
      saved?.tags?.length
        ? `<div class="card-tags">${saved.tags
            .slice(0, 3)
            .map((tag) => `<span>${escapeHTML(tag)}</span>`)
            .join("")}</div>`
        : ""
    }${saved?.notes ? `<p class="list-note">${escapeHTML(saved.notes)}</p>` : ""}${item._recommendationReason ? `<p class="card-note">Because you chose ${escapeHTML(item._recommendationReason)}</p>` : ""}</div>`;
    const img = card.querySelector("img");
    img?.addEventListener(
      "error",
      () => {
        img.hidden = true;
        const fallback = document.createElement("span");
        fallback.className = "poster-placeholder";
        fallback.textContent = titleOf(item);
        img.after(fallback);
      },
      { once: true },
    );
    fragment.append(card);
  }
  container.replaceChildren(fragment);
}
function navigate(view, { focus = false } = {}) {
  if (
    ![
      "discover",
      "watchlist",
      "watching",
      "watched",
      "recommendations",
      "stats",
    ].includes(view)
  )
    view = "discover";
  if (view !== state.view) {
    if (state.view === "watching") $("library-type").value = "all";
    $("library-search").value = "";
    $("library-genre").value = "";
    $("library-rating").value = "";
    $("library-tag").value = "";
    $("library-progress").value = "";
    $("library-priority").value = "";
  }
  state.view = view;
  document.querySelectorAll(".view").forEach((el) => {
    el.hidden =
      el.id !==
      (["watchlist", "watching", "watched"].includes(view)
        ? "library-view"
        : `${view}-view`);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  if (["watchlist", "watching", "watched"].includes(view)) renderLibrary();
  if (view === "stats") renderStats();
  if (view === "recommendations") {
    populateRecommendationSeeds();
    if (recommendationContext() !== state.recommendationContext)
      resetRecommendations();
    else if (state.recommendationsReady && state.recommendationsHaveSeeds)
      renderRecommendationCards();
  }
  saveLocation();
  if (focus) $("main").focus({ preventScroll: true });
}
function renderLibrary() {
  const watched = state.view === "watched",
    watching = state.view === "watching";
  const source = watched
    ? allRecords().filter(hasHistory)
    : watching
      ? allRecords().filter(
          (x) =>
            typeOf(x) === "tv" &&
            ["watching", "paused", "dropped"].includes(x.progress?.status),
        )
      : library.watchlist;
  $("library-title").textContent = watched
    ? "Your viewing journal."
    : watching
      ? "Pick up where you left off."
      : "The watchlist.";
  $("library-description").textContent = watched
    ? "The first watch, the rewatch, and everything worth remembering."
    : watching
      ? "Keep your place in the series you’re following."
      : "Organize the good finds into a shortlist that works for you.";
  $("history-display").hidden = !watched;
  $("library-rating-label").hidden = false;
  $("library-type").disabled = watching;
  if (watching) $("library-type").value = "tv";
  const previousGenre = $("library-genre").value,
    previousTag = $("library-tag").value;
  const genres = new Map(
    source.flatMap((x) => x.genres || []).map((g) => [String(g.id), g.name]),
  );
  $("library-genre").innerHTML =
    '<option value="">All genres</option>' +
    [...genres]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(
        ([id, name]) =>
          `<option value="${escapeHTML(id)}">${escapeHTML(name)}</option>`,
      )
      .join("");
  $("library-genre").value = genres.has(previousGenre) ? previousGenre : "";
  const tags = [...new Set(allRecords().flatMap((x) => x.tags || []))].sort(
    (a, b) => a.localeCompare(b),
  );
  $("library-tag").innerHTML =
    '<option value="">All lists</option>' +
    tags
      .map(
        (tag) =>
          `<option value="${escapeHTML(tag)}">${escapeHTML(tag)}</option>`,
      )
      .join("");
  $("library-tag").value = tags.includes(previousTag) ? previousTag : "";
  const items = filterLibrary(source, {
    query: $("library-search").value,
    type: watching ? "tv" : $("library-type").value,
    genreId: $("library-genre").value,
    minRating: $("library-rating").value,
    tag: $("library-tag").value,
    favoriteOnly: $("library-favorites").checked,
    priority: $("library-priority").value,
    progressStatus: $("library-progress").value,
    sort: $("library-sort").value,
  });
  $("library-result-title").textContent = watched
    ? "Your watched titles"
    : watching
      ? "Series in progress"
      : "Saved for later";
  const display =
    state.display === "history" && !watched ? "grid" : state.display;
  document
    .querySelectorAll("[data-display]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.display === display)),
    );
  $("library-grid").classList.toggle("list-layout", display === "list");
  $("library-grid").classList.toggle("history-layout", display === "history");
  $("library-count").textContent = `${items.length} of ${source.length} titles`;
  if (display === "history") renderHistory(items);
  else renderCards($("library-grid"), items);
  if (!items.length)
    $("library-grid").innerHTML = empty(
      source.length
        ? "Nothing matches these filters."
        : watched
          ? "Your next story starts here."
          : watching
            ? "Ready for the next episode?"
            : "Make a night of it.",
      source.length
        ? "Clear your search or adjust the collection filters."
        : watched
          ? "Log a movie or series to start your viewing journal."
          : watching
            ? "Choose Track series on a TV show and save its progress."
            : "Save titles, set priorities, and add your own lists.",
      `<button class="btn primary" data-action="${source.length ? "reset-library" : "go-discover"}">${source.length ? "Clear filters" : "Find titles ↗"}</button>`,
    );
}
function renderHistory(items) {
  const entries = items
    .flatMap((item) => (item.logs || []).map((log) => ({ item, log })))
    .sort(
      (a, b) =>
        String(b.log.date || "").localeCompare(a.log.date || "") ||
        String(b.log.id).localeCompare(a.log.id),
    );
  $("library-count").textContent =
    `${plural(entries.length, "viewing")} · ${plural(items.length, "title")}`;
  $("library-grid").innerHTML =
    entries
      .map(
        ({ item, log }) =>
          `<article class="history-row"><div><span class="history-date">${escapeHTML(log.date || "Date unknown")}</span><button class="title-button" data-action="details" data-key="${keyOf(item)}">${escapeHTML(titleOf(item))}</button><p>${typeOf(item) === "tv" ? "TV series" : "Movie"}${log.rating ? " · " + log.rating + "/10" : ""}${log.notes ? " · " + escapeHTML(log.notes) : ""}</p></div><button class="btn secondary" data-action="edit-log" data-key="${keyOf(item)}" data-log-id="${escapeHTML(log.id)}">Edit viewing</button></article>`,
      )
      .join("") ||
    empty(
      "No viewings match.",
      "A logged watch will appear here, including rewatches.",
    );
}
function updateLibrary() {
  library = store.getSnapshot();
  reportStorageWarning(library.warning || "");
  $("watchlist-count").textContent = library.watchlist.length;
  $("watching-count").textContent = allRecords().filter(
    (x) => typeOf(x) === "tv" && x.progress?.status === "watching",
  ).length;
  $("watched-count").textContent = allRecords().filter(hasHistory).length;
  if (state.view === "discover") renderDiscovery();
  if (["watchlist", "watching", "watched"].includes(state.view))
    renderLibrary();
  if (state.view === "stats") renderStats();
  if (
    state.view === "recommendations" &&
    state.recommendationsReady &&
    state.recommendationsHaveSeeds
  )
    renderRecommendationCards();
  updateHiddenCount();
}
async function hydrateSaved(item) {
  const key = keyOf(item);
  if (pendingMetadata.has(key) || !getSaved(item)) return;
  pendingMetadata.add(key);
  try {
    const details = normalizeItem(
      detailCache.get(key) || (await client.details(item.id, typeOf(item))),
    );
    detailCache.set(key, details);
    if (getSaved(item))
      store.updateMetadata(item.id, typeOf(item), metadataForStorage(details));
  } catch {
  } finally {
    pendingMetadata.delete(key);
  }
}
function saveCard(item, status = "watchlist") {
  if (!item) return;
  if (status === "watched") {
    openDetails(item, { status: "watched", newLog: true });
    return;
  }
  const data = normalizeItem({ ...item, ...detailCache.get(keyOf(item)) });
  if (
    safeMutation(
      () => store.saveItem(metadataForStorage(data), "watchlist"),
      `Added “${titleOf(item)}” to your watchlist.`,
    )
  )
    hydrateSaved(data);
}
function toggleFavorite(item) {
  const saved = getSaved(item),
    data = normalizeItem({ ...item, ...detailCache.get(keyOf(item)) }),
    favorite = !saved?.favorite;
  if (
    safeMutation(
      () =>
        store.saveItem(
          metadataForStorage(data),
          getStatus(item) || "watchlist",
          { favorite },
        ),
      favorite ? "Added to favorites." : "Removed from favorites.",
    )
  )
    hydrateSaved(data);
}
function ratingOptions(value = 0) {
  return (
    '<option value="0">Not rated</option>' +
    Array.from({ length: 19 }, (_, i) => 1 + i / 2)
      .map(
        (n) =>
          `<option value="${n}"${Number(value) === n ? " selected" : ""}>${n} / 10</option>`,
      )
      .join("")
  );
}
function detailMarkup(item, warning = "") {
  const saved = getSaved(item),
    combined = normalizeItem({
      ...saved,
      ...item,
      ...Object.fromEntries(
        [
          "rating",
          "notes",
          "review",
          "watchedDate",
          "tags",
          "favorite",
          "priority",
          "progress",
          "logs",
        ]
          .filter((k) => saved && Object.hasOwn(saved, k))
          .map((k) => [k, saved[k]]),
      ),
    });
  const status = state.detailDraft?.status || trackedState(item) || "watchlist",
    tv = typeOf(item) === "tv";
  const image = imageURL(combined.poster_path),
    rating = Number(combined.vote_average),
    imdb = combined.externalIds?.imdb_id;
  const progress = combined.progress || {},
    logs = combined.logs || [];
  const trailer = item.videos?.results?.find(
    (v) =>
      v.site === "YouTube" &&
      v.type === "Trailer" &&
      /^[\w-]{6,50}$/.test(v.key),
  );
  const currentDate = state.detailDraft?.newLog
    ? today()
    : !logs.length
      ? today()
      : "";
  const statuses = tv
    ? [
        ["watchlist", "Want to watch"],
        ["watching", "Watching"],
        ["paused", "Paused"],
        ["dropped", "Dropped"],
        ["watched", "Completed"],
      ]
    : [
        ["watchlist", "Want to watch"],
        ["watched", "Watched"],
      ];
  return `<div class="detail-header">${image ? `<img class="detail-poster" src="${image}" alt="Poster for ${escapeHTML(titleOf(item))}">` : '<div class="detail-poster"></div>'}<div><h2 id="detail-title">${escapeHTML(titleOf(item))}</h2><div class="movie-meta"><span>${escapeHTML(yearOf(combined) || "Date not announced")}</span><span>${tv ? "TV series" : "Movie"}</span>${Number(combined.runtime) > 0 ? `<span>${Number(combined.runtime)} min${tv ? " / episode" : ""}</span>` : ""}${rating > 0 ? `<span>★ ${rating.toFixed(1)} TMDB · ${number(combined.vote_count)} votes</span>` : ""}</div><div class="detail-genres">${(combined.genres || []).map((g) => `<span>${escapeHTML(g.name)}</span>`).join("")}</div><div class="detail-links"><a href="https://www.themoviedb.org/${typeOf(item)}/${Number(item.id)}" target="_blank" rel="noopener noreferrer">TMDB ↗</a>${/^tt\d+$/.test(imdb) ? `<a href="https://www.imdb.com/title/${imdb}/" target="_blank" rel="noopener noreferrer">IMDb ↗</a>` : ""}${trailer ? `<a href="https://www.youtube.com/watch?v=${trailer.key}" target="_blank" rel="noopener noreferrer">Watch trailer ↗</a>` : ""}</div></div></div><div id="detail-live-status">${warning ? `<div class="notice">${escapeHTML(warning)}</div>` : ""}</div><p class="detail-overview">${escapeHTML(combined.overview || "No overview is available for this title.")}</p>
  <form id="record-form" class="record-panel"><div class="record-heading"><h3>${state.detailDraft?.newLog ? "Log a viewing" : "Your record"}</h3><span id="record-save-state" class="small muted">${saved ? "Saved record" : "New record"} · Save to keep changes</span></div>
  <div class="record-fields"><label>Status<select id="record-status">${statuses.map(([value, label]) => `<option value="${value}"${status === value ? " selected" : ""}>${label}</option>`).join("")}</select></label><label>Your overall rating<select id="record-rating">${ratingOptions(combined.rating)}</select></label><label id="record-priority-label">Watchlist priority<select id="record-priority"><option value="normal">Normal</option><option value="high"${combined.priority === "high" ? " selected" : ""}>High</option><option value="low"${combined.priority === "low" ? " selected" : ""}>Low</option></select></label></div>
  ${tv ? `<div id="record-progress-panel" class="tv-progress-fields"><h4>Your place in the series</h4><div class="record-fields"><label>Episodes watched<input id="record-progress" type="number" min="0" max="100000" value="${Number(progress.watchedEpisodes) || 0}" inputmode="numeric"></label><label>Total episodes <span class="muted">· 0 if unknown</span><input id="record-total" type="number" min="0" max="100000" value="${Number(progress.totalEpisodes ?? combined.number_of_episodes ?? 0) || 0}" inputmode="numeric"></label><label>Current season <span class="muted">· optional</span><input id="record-season" type="number" min="0" max="10000" value="${progress.currentSeason ?? ""}" inputmode="numeric"></label><label>Episode in season <span class="muted">· optional</span><input id="record-episode" type="number" min="0" max="100000" value="${progress.currentEpisode ?? ""}" inputmode="numeric"></label></div>${Number(combined.number_of_episodes) > 0 ? `<button type="button" class="text-btn" data-action="episode-total" data-count="${Number(combined.number_of_episodes)}">Use TMDB total: ${Number(combined.number_of_episodes)} episodes</button>` : ""}<p class="small muted">Progress is your own marker. Add episodes as you watch; mark Completed when you’re finished.</p></div>` : ""}
  <div id="record-log-fields" class="new-viewing-fields" hidden><h4>This viewing</h4><label>Date watched <span class="muted">· leave blank if unknown</span><input type="date" id="record-date" max="${today()}" value="${currentDate}"></label><label>Viewing notes <span class="muted">· optional</span><input id="record-log-notes" maxlength="20000" placeholder="Who you watched with, the cinema, a rewatch…"></label><p class="small muted">This adds one entry to your viewing history.</p></div>
  <div class="record-organization"><label>Personal lists <span class="muted">· separate with commas</span><input id="record-tags" maxlength="1000" placeholder="Weekend picks, With family, Favorites to rewatch" value="${escapeHTML((combined.tags || []).join(", "))}"></label><label class="check-label"><input id="record-favorite" type="checkbox"${combined.favorite ? " checked" : ""}> Add to favorites</label></div>
  <label class="record-notes">Your personal notes<textarea id="record-notes" maxlength="20000" placeholder="Thoughts, a recommendation from a friend, anything worth keeping…">${escapeHTML(combined.notes || combined.review || "")}</textarea></label>
  <div class="record-footer"><p>Personal notes, lists and history stay with this title when you change its status.</p><div class="inline-controls"><button class="btn secondary" type="button" data-action="close-dialog">Cancel</button><button class="btn primary" type="submit">${state.detailDraft?.newLog ? "Save viewing" : "Save record"}</button></div></div><div id="record-message" class="form-error" role="alert"></div></form>
  <section class="viewing-history"><div class="record-heading"><h3>Viewing history <span class="small muted">${logs.length ? `· ${logs.length} ${logs.length === 1 ? "viewing" : "viewings"}` : ""}</span></h3>${saved ? '<button class="text-btn" data-action="log-again">Log another watch +</button>' : ""}</div>${
    logs.length
      ? logs
          .slice()
          .sort((a, b) => String(b.date || "").localeCompare(a.date || ""))
          .map(
            (log) =>
              `<div class="detail-log"><div><strong>${escapeHTML(log.date || "Date unknown")}</strong><span>${log.rating ? " · " + log.rating + "/10" : ""}</span>${log.notes ? `<p>${escapeHTML(log.notes)}</p>` : ""}</div><button class="text-btn" data-action="edit-log" data-log-id="${escapeHTML(log.id)}">Edit</button></div>`,
          )
          .join("")
      : '<p class="small muted">No viewings logged yet. A date can be left unknown.</p>'
  }</section>
  <div class="detail-section"><h3>Where to watch <span class="small muted">· ${escapeHTML($("watch-region").selectedOptions[0]?.textContent || "United States")}</span></h3><div id="providers-content"><button class="btn secondary" data-action="providers">Check availability</button><p class="small muted">Streaming, rental and purchase options from JustWatch via TMDB.</p></div></div>
  ${combined.belongs_to_collection ? `<div class="detail-section"><button class="btn secondary" data-action="collection" data-id="${Number(combined.belongs_to_collection.id)}">Explore ${escapeHTML(combined.belongs_to_collection.name)} ↗</button></div>` : ""}
  ${combined.crew?.length ? `<div class="detail-section"><h3>Behind the camera</h3><p>${combined.crew.map((p) => `${escapeHTML(p.name)}${p.job ? " · " + escapeHTML(p.job) : ""}`).join(" &nbsp; / &nbsp; ")}</p></div>` : ""}${combined.cast?.length ? `<div class="detail-section"><h3>Cast</h3><p>${combined.cast.map((p) => escapeHTML(p.name)).join(" · ")}</p></div>` : ""}<div class="detail-actions">${saved ? '<button class="text-btn danger" data-action="remove-record">Remove from collection</button>' : "<span></span>"}<button class="text-btn" data-action="hide-title">Hide from discovery</button></div>`;
}
function markDirty(event) {
  recordDirty = true;
  const field = typeof event === "string" ? event : event?.target?.id;
  if (field) dirtyFields.add(field);
  if ($("record-save-state"))
    $("record-save-state").textContent = "Unsaved changes";
}
function renderDetail(item, warning = "") {
  ++state.detailPresentation;
  state.detailItem = item;
  recordDirty = false;
  dirtyFields = new Set();
  draftBase = getSaved(item)
    ? JSON.parse(JSON.stringify(getSaved(item)))
    : null;
  draftBaseStatus = trackedState(item);
  $("detail-content").innerHTML = detailMarkup(item, warning);
  syncRecordFields();
  $("record-form").addEventListener("input", markDirty);
  $("record-form").addEventListener("change", markDirty);
  $("record-status").addEventListener("change", syncRecordFields);
  $("record-form").addEventListener("submit", saveRecord);
}
async function openDetails(item, draft = null) {
  if (!item) return;
  state.detailDraft = draft;
  state.detailController?.abort();
  const controller = new AbortController();
  state.detailController = controller;
  const sequence = ++state.detailSequence,
    cached = detailCache.get(keyOf(item));
  state.detailItem = normalizeItem({ ...item, ...cached });
  if (!$("movie-dialog").open) $("movie-dialog").showModal();
  mountToast();
  if (cached) {
    renderDetail(cached);
    return;
  }
  renderDetail(state.detailItem);
  $("detail-live-status").innerHTML =
    '<p class="small muted">Updating title details… You can edit your record now.</p>';
  const presentation = state.detailPresentation;
  try {
    const details = normalizeItem(
      await client.details(item.id, typeOf(item), {
        signal: controller.signal,
      }),
    );
    if (sequence !== state.detailSequence || controller.signal.aborted) return;
    detailCache.set(keyOf(details), details);
    if (getSaved(item)) {
      try {
        store.updateMetadata(
          item.id,
          typeOf(item),
          metadataForStorage(details),
        );
      } catch {}
    }
    if (
      presentation === state.detailPresentation &&
      !recordDirty &&
      !document.activeElement?.closest("#record-form")
    )
      renderDetail(details);
    else {
      state.detailItem = details;
      if ($("detail-live-status")) $("detail-live-status").textContent = "";
    }
  } catch (error) {
    if (
      sequence === state.detailSequence &&
      !controller.signal.aborted &&
      $("detail-live-status")
    )
      $("detail-live-status").textContent =
        "Live details could not load. Your personal record can still be edited. " +
        error.message;
  }
}
function needsNewLog(status = $("record-status")?.value) {
  const saved = getSaved(state.detailItem);
  return (
    status === "watched" &&
    (!!state.detailDraft?.newLog ||
      ((!saved || getStatus(saved) !== "watched") &&
        !(saved?.logs || []).length))
  );
}
function syncRecordFields() {
  if (!$("record-status")) return;
  const status = $("record-status").value;
  $("record-log-fields").hidden = !needsNewLog();
  $("record-priority-label").hidden = status === "watched";
  if ($("record-progress-panel"))
    $("record-progress-panel").hidden = status === "watchlist";
}
function saveRecord(event) {
  event.preventDefault();
  const item = state.detailItem;
  if (!item) return;
  const current = getSaved(item),
    existing = !!draftBase;
  if (existing && !current) {
    $("record-message").textContent =
      "This title was removed in another tab. Your edits are kept here; cancel and reopen the title before saving.";
    return;
  }
  const chosen = $("record-status").value,
    statusEdited =
      !existing ||
      dirtyFields.has("record-status") ||
      !!state.detailDraft?.status;
  const status = statusEdited ? chosen : trackedState(item) || chosen,
    date = $("record-date").value,
    newLog = needsNewLog(status);
  if (newLog && date && date > today()) {
    $("record-message").textContent =
      "Choose a date up to today, or leave it blank if unknown.";
    return;
  }
  const values = {
    "record-notes": ["notes", $("record-notes").value],
    "record-rating": ["rating", Number($("record-rating").value)],
    "record-tags": [
      "tags",
      $("record-tags")
        .value.split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ],
    "record-favorite": ["favorite", $("record-favorite").checked],
    "record-priority": ["priority", $("record-priority").value],
  };
  if (typeOf(item) === "tv") {
    Object.assign(values, {
      "record-progress": [
        "progress.watchedEpisodes",
        Number($("record-progress").value),
      ],
      "record-total": [
        "progress.totalEpisodes",
        Number($("record-total").value),
      ],
    });
    values["record-season"] = [
      "progress.currentSeason",
      $("record-season").value === ""
        ? undefined
        : Number($("record-season").value),
    ];
    values["record-episode"] = [
      "progress.currentEpisode",
      $("record-episode").value === ""
        ? undefined
        : Number($("record-episode").value),
    ];
  }
  const edits = Object.fromEntries(
    Object.entries(values)
      .filter(([id]) => !existing || dirtyFields.has(id))
      .map(([, entry]) => entry),
  );
  if (typeOf(item) === "tv" && statusEdited)
    edits["progress.status"] =
      status === "watchlist"
        ? "planned"
        : status === "watched"
          ? "completed"
          : status;
  try {
    const { changes, conflicts } = mergePersonalEdits(
      draftBase || {},
      current || {},
      edits,
    );
    if (
      existing &&
      statusEdited &&
      draftBaseStatus !== trackedState(item) &&
      status !== trackedState(item)
    )
      conflicts.push("status");
    if (
      conflicts.length &&
      !confirm(
        "These fields changed in another tab: " +
          conflicts
            .map(
              (field) =>
                ({
                  notes: "personal notes",
                  rating: "rating",
                  tags: "personal lists",
                  priority: "priority",
                  favorite: "favorite",
                  date: "viewing date",
                  "progress.watchedEpisodes": "episodes watched",
                  "progress.totalEpisodes": "total episodes",
                  "progress.currentSeason": "season marker",
                  "progress.currentEpisode": "episode marker",
                  "progress.status": "tracking state",
                })[field] || field,
            )
            .join(", ") +
          ". Save your edits to those fields?",
      )
    )
      return;
    const before = JSON.stringify(store.getSnapshot());
    if (newLog) {
      if (existing && !dirtyFields.has("record-rating"))
        changes.rating = current.rating || 0;
      store.logWatch(
        metadataForStorage(item),
        {
          date: date || "",
          rating: Number($("record-rating").value),
          notes: $("record-log-notes").value,
        },
        changes,
      );
    } else
      store.saveItem(
        metadataForStorage(item),
        status === "watched" ? "watched" : "watchlist",
        changes,
      );
    const changed = before !== JSON.stringify(store.getSnapshot());
    recordDirty = false;
    closeDialog($("movie-dialog"));
    toast(changed ? "Your record is saved." : "No changes to save.", changed);
    hydrateSaved(item);
  } catch (error) {
    $("record-message").textContent = error.message;
  }
}
function closeDialog(dialog) {
  if (
    dialog.id === "movie-dialog" &&
    recordDirty &&
    !confirm("Discard your unsaved changes?")
  )
    return false;
  const key = state.detailItem ? keyOf(state.detailItem) : null;
  if (dialog.id === "movie-dialog") {
    recordDirty = false;
    state.detailDraft = null;
    state.detailController?.abort();
    ++state.detailSequence;
  }
  if (dialog.contains($("toast"))) document.body.append($("toast"));
  dialog.close();
  mountToast();
  if (document.activeElement === document.body && key)
    document.querySelector(`article[data-key="${key}"] .title-button`)?.focus();
  return true;
}
async function openLogEditor(item, logId) {
  if (recordDirty && !confirm("Discard your unsaved changes?")) return;
  const saved = getSaved(item),
    log = saved?.logs?.find((l) => l.id === logId);
  if (!log) return;
  state.detailController?.abort();
  state.detailController = new AbortController();
  ++state.detailSequence;
  ++state.detailPresentation;
  state.detailItem = normalizeItem({
    ...item,
    ...detailCache.get(keyOf(item)),
  });
  state.detailDraft = null;
  recordDirty = false;
  dirtyFields = new Set();
  const logBase = JSON.parse(JSON.stringify(log));
  if (!$("movie-dialog").open) $("movie-dialog").showModal();
  mountToast();
  $("detail-content").innerHTML =
    `<h2 id="detail-title">Edit a viewing</h2><p class="intro">${escapeHTML(titleOf(item))}</p><form id="edit-log-form" class="record-panel"><div class="record-fields"><label>Date watched <span class="muted">· optional</span><input id="edit-log-date" type="date" max="${today()}" value="${escapeHTML(log.date || "")}"></label><label>Rating for this viewing<select id="edit-log-rating">${ratingOptions(log.rating)}</select></label></div><label class="record-notes">Viewing notes<textarea id="edit-log-notes" maxlength="20000">${escapeHTML(log.notes || "")}</textarea></label><div class="record-footer"><button type="button" class="text-btn danger" data-action="remove-log" data-log-id="${escapeHTML(log.id)}">Delete this viewing</button><div class="inline-controls"><button type="button" class="btn secondary" data-action="back-detail">Cancel</button><button class="btn primary" type="submit">Save viewing</button></div></div><div id="record-message" class="form-error" role="alert"></div></form>`;
  $("edit-log-form").addEventListener("input", markDirty);
  $("edit-log-form").addEventListener("change", markDirty);
  $("edit-log-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const date = $("edit-log-date").value;
    if (date && date > today()) {
      $("record-message").textContent =
        "Choose a date up to today, or leave it blank.";
      return;
    }
    const current = getSaved(item)?.logs?.find((l) => l.id === log.id);
    if (!current) {
      $("record-message").textContent =
        "This viewing was removed in another tab. Your edits remain here; cancel to review the current history.";
      return;
    }
    const fields = {
      "edit-log-date": ["date", date],
      "edit-log-rating": ["rating", Number($("edit-log-rating").value)],
      "edit-log-notes": ["notes", $("edit-log-notes").value],
    };
    const edits = Object.fromEntries(
      Object.entries(fields)
        .filter(([id]) => dirtyFields.has(id))
        .map(([, entry]) => entry),
    );
    try {
      const { changes, conflicts } = mergePersonalEdits(
        logBase,
        current,
        edits,
      );
      if (
        conflicts.length &&
        !confirm(
          "This viewing changed in another tab (" +
            conflicts
              .map(
                (field) =>
                  ({
                    notes: "personal notes",
                    rating: "rating",
                    tags: "personal lists",
                    priority: "priority",
                    favorite: "favorite",
                    date: "viewing date",
                    "progress.watchedEpisodes": "episodes watched",
                    "progress.totalEpisodes": "total episodes",
                    "progress.currentSeason": "season marker",
                    "progress.currentEpisode": "episode marker",
                    "progress.status": "tracking state",
                  })[field] || field,
              )
              .join(", ") +
            "). Save your edits to those fields?",
        )
      )
        return;
      const before = JSON.stringify(store.getSnapshot());
      store.updateLog(item.id, typeOf(item), log.id, changes);
      const changed = before !== JSON.stringify(store.getSnapshot());
      recordDirty = false;
      renderDetail(state.detailItem);
      toast(changed ? "Viewing updated." : "No changes to save.", changed);
    } catch (error) {
      $("record-message").textContent = error.message;
    }
  });
}
async function loadProviders() {
  ++state.detailPresentation;
  const item = state.detailItem;
  if (!item) return;
  const key = keyOf(item),
    sequence = state.detailSequence,
    target = $("providers-content");
  if (!target) return;
  target.innerHTML =
    '<div class="loading"><span class="spinner"></span>Checking availability…</div>';
  try {
    const data = await client.providers(item.id, typeOf(item), {
      signal: state.detailController?.signal,
    });
    if (
      sequence !== state.detailSequence ||
      key !== keyOf(state.detailItem) ||
      !target.isConnected
    )
      return;
    const us = data.results?.[$("watch-region").value || "US"];
    const groups = [
      ["flatrate", "Stream"],
      ["free", "Free"],
      ["ads", "With ads"],
      ["rent", "Rent"],
      ["buy", "Buy"],
    ];
    const html = groups
      .filter(([k]) => us?.[k]?.length)
      .map(
        ([k, label]) =>
          `<p><strong>${label}:</strong> ${us[k].map((p) => escapeHTML(p.provider_name)).join(", ")}</p>`,
      )
      .join("");
    const link =
      typeof us?.link === "string" &&
      us.link.startsWith("https://www.themoviedb.org/")
        ? us.link
        : "";
    $("providers-content").innerHTML =
      `<div class="providers">${html || "<p>No availability is listed for this title in the selected region.</p>"}${link ? `<a class="text-btn" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">See watch options ↗</a>` : ""}<p class="small muted">Availability may change. Data provided by JustWatch via TMDB.</p></div>`;
  } catch (error) {
    if (sequence === state.detailSequence && target.isConnected)
      target.innerHTML = `<p class="form-error">${escapeHTML(error.message)}</p><button class="text-btn" data-action="providers">Try again</button>`;
  }
}
async function loadCollection(id) {
  if (
    recordDirty &&
    !confirm("Discard your unsaved record changes to explore this collection?")
  )
    return;
  ++state.detailPresentation;
  const item = state.detailItem,
    sequence = state.detailSequence;
  const container = $("detail-content");
  container.innerHTML =
    '<h2 id="detail-title">Movie collection</h2><div class="loading"><span class="spinner"></span>Loading collection…</div>';
  recordDirty = false;
  try {
    const data = await client.collection(id, {
      signal: state.detailController?.signal,
    });
    if (sequence !== state.detailSequence) return;
    const parts = (data.parts || []).sort((a, b) =>
      (a.release_date || "9999").localeCompare(b.release_date || "9999"),
    );
    parts.forEach((part) => itemCache.set(keyOf(part), part));
    container.innerHTML = `<h2 id="detail-title">${escapeHTML(data.name)}</h2><p class="detail-overview">${escapeHTML(data.overview || "")}</p><div class="collection-list">${parts.map((part) => `<button data-action="details" data-key="${keyOf(part)}">${escapeHTML(titleOf(part))}<span class="year">${escapeHTML(yearOf(part) || "TBA")}</span></button>`).join("")}</div><p style="margin-top:20px"><button class="text-btn" data-action="back-detail">← Back to ${escapeHTML(titleOf(item))}</button></p>`;
  } catch (error) {
    if (sequence === state.detailSequence) {
      renderDetail(item, error.message);
    }
  }
}
function populateRecommendationSeeds() {
  const selected = $("rec-seed").value,
    type = $("rec-type").value;
  const seeds = allRecords()
    .filter((x) => type === "all" || typeOf(x) === type)
    .sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
  $("rec-seed").innerHTML =
    '<option value="">My favorites & titles rated 7+</option>' +
    seeds
      .map(
        (x) =>
          `<option value="${keyOf(x)}">${escapeHTML(titleOf(x))}${typeOf(x) === "tv" ? " · TV" : ""}</option>`,
      )
      .join("");
  $("rec-seed").value = seeds.some((x) => keyOf(x) === selected)
    ? selected
    : "";
}
function recommendationLibrary() {
  const type = $("rec-type").value;
  return {
    watchlist: library.watchlist.filter(
      (x) => type === "all" || typeOf(x) === type,
    ),
    watched: library.watched.filter(
      (x) => type === "all" || typeOf(x) === type,
    ),
  };
}
function recommendationContext() {
  return JSON.stringify([
    $("rec-type").value,
    $("rec-seed").value,
    recommendationSeeds(recommendationLibrary(), {
      seedKey: $("rec-seed").value,
      limit: allRecords().length,
    })
      .map(keyOf)
      .sort(),
  ]);
}
async function loadRecommendations() {
  state.recommendationController?.abort();
  state.recommendationsReady = false;
  state.recommendationContext = recommendationContext();
  const controller = new AbortController();
  state.recommendationController = controller;
  const type = $("rec-type").value,
    filtered = recommendationLibrary();
  const seeds = recommendationSeeds(filtered, {
    seedKey: $("rec-seed").value,
    offset: state.recOffset,
    limit: 4,
  });
  state.recommendationsHaveSeeds = seeds.length > 0;
  if (!seeds.length) {
    state.recommendationsReady = true;
    state.recommendations = [];
    $("recommendations-message").innerHTML = empty(
      "Start with something you love.",
      allRecords().length
        ? "Choose any saved title in “Based on”, favorite a title, or rate a watch 7 or higher."
        : "Save a favorite or rate a watch to start getting personal suggestions.",
      '<button class="btn primary" data-action="go-discover">Find titles ↗</button>',
    );
    $("recommendations-grid").innerHTML = "";
    return;
  }
  $("recommendations-message").innerHTML =
    '<div class="loading"><span class="spinner"></span>Finding your next watch…</div>';
  $("recommendations-grid").innerHTML = "";
  const responses = await Promise.allSettled(
    seeds.map(async (seed) => ({
      seed,
      data: await client.recommendations(seed.id, typeOf(seed), {
        signal: controller.signal,
        ...(recommendationCursors.get(keyOf(seed))
          ? { cursor: recommendationCursors.get(keyOf(seed)) }
          : {}),
      }),
    })),
  );
  if (controller.signal.aborted) return;
  const candidates = new Map(),
    errors = [];
  for (const response of responses) {
    if (response.status === "rejected") {
      errors.push(
        response.reason?.message || "Some suggestions could not load.",
      );
      continue;
    }
    const { seed, data } = response.value;
    if (data.warning) errors.push(data.warning);
    if (data.nextCursor)
      recommendationCursors.set(keyOf(seed), data.nextCursor);
    else recommendationCursors.delete(keyOf(seed));
    data.results.forEach((item, index) => {
      const key = keyOf(item);
      if (!candidates.has(key))
        candidates.set(key, {
          ...item,
          _recommendationReason: titleOf(seed),
          _recommendationRank: index,
        });
    });
  }
  state.recommendations = [...candidates.values()]
    .filter(
      (x) =>
        !seenRecommendations.has(keyOf(x)) &&
        (type === "all" || typeOf(x) === type),
    )
    .sort((a, b) => a._recommendationRank - b._recommendationRank);
  $("recommendations-message").innerHTML =
    (errors.length
      ? `<div class="notice warning">${escapeHTML(errors[0])} <button class="text-btn" data-action="retry-recommendations">Try again</button></div>`
      : "") +
    '<p class="small muted">Based on ' +
    seeds.map((s) => escapeHTML(titleOf(s))).join(", ") +
    ". Your collection and hidden titles are excluded.</p>";
  state.recommendationsReady = true;
  renderRecommendationCards();
}
function renderRecommendationCards() {
  const excluded = new Set(allRecords().map(keyOf).concat(hiddenKeys()));
  const items = state.recommendations
    .filter((x) => !excluded.has(keyOf(x)))
    .slice(0, 50);
  renderCards($("recommendations-grid"), items);
  for (const item of items) seenRecommendations.add(keyOf(item));
  $("recommendations-grid")
    .querySelectorAll(".movie-card")
    .forEach((card) => {
      const b = document.createElement("button");
      b.className = "text-btn dismiss-recommendation";
      b.dataset.action = "hide-recommendation";
      b.dataset.key = card.dataset.key;
      b.textContent = "Not for me";
      card.querySelector(".movie-info").append(b);
    });
  if (!items.length && state.recommendationsReady)
    $("recommendations-grid").innerHTML = empty(
      "No new suggestions right now.",
      "Choose another title, change the type, or revisit the suggestions you’ve already seen.",
      '<button class="btn secondary" data-action="reset-suggestions">Revisit suggestions</button>',
    );
}
function renderStats() {
  const stats = libraryStats(library),
    watched = allRecords().filter(hasHistory),
    rated = watched.filter((x) => Number(x.rating) > 0);
  const top = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 8),
    genres = new Map();
  watched.forEach((item) =>
    (item.genres || []).forEach((g) =>
      genres.set(g.name, (genres.get(g.name) || 0) + 1),
    ),
  );
  const sortedGenres = [...genres].sort((a, b) => b[1] - a[1]).slice(0, 6);
  top.forEach((item) => itemCache.set(keyOf(item), item));
  $("stats-content").innerHTML =
    `<div class="stats-grid"><div class="stat"><strong>${number(stats.watchlistCount)}</strong><span>On your watchlist · ${stats.activeShows} active series</span></div><div class="stat"><strong>${number(stats.totalViewings)}</strong><span>Logged viewings · ${plural(stats.watchedMovies, "film")} & ${plural(stats.watchedShows, "show")}</span></div><div class="stat"><strong>${stats.ratedTitles ? Number(stats.avgRating).toFixed(1) : "—"}</strong><span>Your average rating · ${plural(stats.ratedTitles, "rated title")}</span></div><div class="stat"><strong>${(stats.movieMinutes / 60).toFixed(1)}<small class="small"> h</small></strong><span>Film time · includes repeat watches</span></div></div><p class="small muted" style="margin-top:16px">Film time uses known movie runtimes for each logged viewing; TV hours are excluded.${stats.unknownRuntimeViewings ? " " + plural(stats.unknownRuntimeViewings, "film viewing") + (stats.unknownRuntimeViewings === 1 ? " has an unknown runtime." : " have unknown runtimes.") : ""}${stats.unknownDateViewings ? " " + plural(stats.unknownDateViewings, "viewing") + (stats.unknownDateViewings === 1 ? " has an unknown date." : " have unknown dates.") : ""}</p><div class="stats-detail"><div class="stats-panel"><h3>Your highest rated</h3>${top.length ? top.map((item) => `<div class="stat-line"><button class="title-button" data-action="details" data-key="${keyOf(item)}">${escapeHTML(titleOf(item))}</button><span>${item.rating} / 10</span></div>`).join("") : '<p class="small muted">Your highest-rated watches will appear here.</p>'}</div><div class="stats-panel"><h3>Your favorite genres</h3>${sortedGenres.length ? sortedGenres.map(([name, count]) => `<div class="stat-line"><span>${escapeHTML(name)}</span><span>${count} ${count === 1 ? "title" : "titles"}</span></div><div class="genre-bar"><span style="width:${(count / sortedGenres[0][1]) * 100}%"></span></div>`).join("") : '<p class="small muted">Log titles to discover your most-watched genres.</p>'}</div><div class="stats-panel"><h3>Recent viewing activity</h3>${
      stats.monthlyCounts.length
        ? stats.monthlyCounts
            .slice(-8)
            .map(
              (month) =>
                `<div class="stat-line"><span>${escapeHTML(month.month)}</span><span>${month.count} ${month.count === 1 ? "viewing" : "viewings"}</span></div>`,
            )
            .join("")
        : '<p class="small muted">Dated viewings will appear here.</p>'
    }</div><div class="stats-panel"><h3>Your personal lists</h3>${
      stats.topTags.length
        ? stats.topTags
            .slice(0, 8)
            .map(
              (tag) =>
                `<div class="stat-line"><span>${escapeHTML(tag.tag)}</span><span>${tag.count} ${tag.count === 1 ? "title" : "titles"}</span></div>`,
            )
            .join("")
        : '<p class="small muted">Add list names to a record, such as Weekend picks or With family.</p>'
    }</div></div>`;
}
function updateHiddenCount() {
  $("hidden-count").textContent =
    `${hiddenKeys().length} ${hiddenKeys().length === 1 ? "title is" : "titles are"} hidden from discovery and suggestions.`;
  $("restore-hidden").disabled = !hiddenKeys().length;
  $("hidden-list").innerHTML = hiddenKeys()
    .slice(0, 50)
    .map((key) => {
      const item =
        itemCache.get(key) || allRecords().find((x) => keyOf(x) === key);
      return `<div><span>${escapeHTML(item ? titleOf(item) : key.replace("movie-", "Movie #").replace("tv-", "TV #"))}</span><button class="text-btn" data-restore-key="${escapeHTML(key)}">Restore</button></div>`;
    })
    .join("");
  $("backup-status").textContent = preferences.lastBackup
    ? `Last backup exported: ${new Date(preferences.lastBackup).toLocaleString()}`
    : "No backup has been exported from this browser yet.";
}
function openData() {
  updateHiddenCount();
  $("import-message").textContent = "";
  $("data-dialog").showModal();
  mountToast();
}
function exportData() {
  try {
    const data = store.exportData();
    const blob = new Blob(
      [typeof data === "string" ? data : JSON.stringify(data, null, 2)],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `movie-tracker-backup-${today()}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    savePreferences({ lastBackup: new Date().toISOString() });
    updateHiddenCount();
    toast("Backup exported. Keep it somewhere safe.");
  } catch (error) {
    toast(error.message);
  }
}
async function importData(file) {
  if (!file) return;
  if (file.size > 20 * 1024 * 1024) {
    $("import-message").textContent =
      "This backup is too large. Choose a JSON backup under 20 MB.";
    return;
  }
  try {
    const text = await file.text();
    const before = JSON.stringify(store.getSnapshot());
    store.importData(text);
    $("import-message").textContent =
      `Import complete. Your collection now has ${plural(library.watchlist.length, "watchlist title")} and ${plural(library.watched.length, "watched title")}.`;
    toast(
      "Backup merged with your collection.",
      before !== JSON.stringify(store.getSnapshot()),
    );
  } catch (error) {
    $("import-message").textContent = error.message;
  } finally {
    $("import-file").value = "";
  }
}
function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("theme-toggle").setAttribute(
    "aria-label",
    `Switch to ${theme === "dark" ? "light" : "dark"} theme`,
  );
  document.querySelector('meta[name="theme-color"]').content =
    theme === "dark" ? "#101715" : "#f6f7f1";
}

function changeExplore() {
  if (!$("discover-form").reportValidity()) return;
  let f = readFilters();
  if (f.mediaType === "tv") {
    f.personId = "";
    f.personName = "";
    f.runtimeMin = "";
    f.runtimeMax = "";
  }
  if (f.sort === "trending") {
    f.personId = "";
    f.personName = "";
    f.runtimeMin = "";
    f.runtimeMax = "";
    f.watchProviderId = "";
    f.watchProviderName = "";
  }
  $("search-input").value = "";
  runDiscovery({ filters: f });
}
function resetDiscovery() {
  state.filters = { ...defaults, watchRegion: preferences.watchRegion || "US" };
  state.selectedPerson = null;
  $("search-input").value = "";
  $("person-query").value = "";
  $("person-results").innerHTML = "";
  syncFilters(state.filters);
  runDiscovery({ filters: state.filters });
}
function runPreset(preset) {
  const f = { ...defaults, watchRegion: preferences.watchRegion || "US" };
  if (preset === "tv") Object.assign(f, { mediaType: "tv", sort: "rating" });
  if (preset === "short") Object.assign(f, { runtimeMax: 120, minRating: 7 });
  if (preset === "recent")
    Object.assign(f, {
      yearFrom: String(new Date().getFullYear() - 1),
      sort: "popular",
    });
  $("search-input").value = "";
  syncFilters(f);
  runDiscovery({ filters: f });
}
function clearLibraryFilters() {
  [
    "library-search",
    "library-genre",
    "library-rating",
    "library-tag",
    "library-priority",
    "library-progress",
  ].forEach((id) => ($(id).value = ""));
  $("library-type").value = "all";
  $("library-favorites").checked = false;
  renderLibrary();
}
function resetRecommendations() {
  state.recOffset = 0;
  seenRecommendations.clear();
  recommendationCursors.clear();
  populateRecommendationSeeds();
  loadRecommendations();
}
function itemForKey(key) {
  return allRecords().find((x) => keyOf(x) === key) || itemCache.get(key);
}

$("discover-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runDiscovery({ parse: true });
});
[
  "genre-filter",
  "year-from",
  "year-to",
  "sort-filter",
  "min-votes",
  "result-limit",
  "min-rating",
  "runtime-max",
  "original-language",
  "watch-provider",
  "person-role",
].forEach((id) => $(id).addEventListener("change", changeExplore));
$("media-type-filter").addEventListener("change", () => {
  populateGenres($("media-type-filter").value);
  $("watch-provider").value = "";
  changeExplore();
});
$("watch-region").addEventListener("change", () => {
  savePreferences({ watchRegion: $("watch-region").value });
  $("watch-provider").value = "";
  changeExplore();
});
$("advanced-filters").addEventListener("toggle", () => {
  if ($("advanced-filters").open) loadProviderOptions();
});
$("find-person").addEventListener("click", findPerson);
$("person-query").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    findPerson();
  }
});
function clearTitleSearch(filters = {}) {
  state.discoveryController?.abort();
  state.busy = false;
  state.results = [];
  state.resultInfo = null;
  state.filters = normalizeFilters({
    ...filters,
    mode: "search",
    query: "",
    mediaType: $("search-type").value,
    includeUpcoming: $("search-upcoming").checked,
    limit: 30,
  });
  setMode("search");
  $("results-title").textContent = "Search movies & TV shows";
  $("results-count").textContent = "";
  $("results-kicker").textContent = "TITLE SEARCH";
  $("query-summary").hidden = true;
  $("active-filters").innerHTML = "";
  $("discover-grid").removeAttribute("aria-busy");
  $("discover-grid").innerHTML = empty(
    "What are you looking for?",
    "Search a title across movies and TV, including upcoming releases.",
  );
  $("discover-message").innerHTML = "";
  $("load-more").hidden = true;
  saveLocation();
}
$("search-input").addEventListener("search", () => {
  if (!$("search-input").value && state.uiMode === "search") clearTitleSearch();
});
["search-type", "search-upcoming"].forEach((id) =>
  $(id).addEventListener("change", () => {
    if (state.uiMode === "search") {
      if (!$("search-input").value.trim()) {
        clearTitleSearch();
        return;
      }
      runDiscovery({ parse: true });
    }
  }),
);
$("reset-filters").addEventListener("click", resetDiscovery);
$("hide-watched").addEventListener("change", () => {
  savePreferences({ hideWatched: $("hide-watched").checked });
  runDiscovery({ filters: state.filters });
});
$("load-more").addEventListener("click", () => runDiscovery({ append: true }));
[
  "library-search",
  "library-type",
  "library-genre",
  "library-sort",
  "library-rating",
  "library-tag",
  "library-priority",
  "library-progress",
  "library-favorites",
].forEach((id) =>
  $(id).addEventListener(
    id === "library-search" ? "input" : "change",
    renderLibrary,
  ),
);
$("data-button").addEventListener("click", openData);
$("footer-data").addEventListener("click", openData);
$("export-data").addEventListener("click", exportData);
$("import-data").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", (event) =>
  importData(event.target.files[0]),
);
$("restore-hidden").addEventListener("click", () => {
  if (
    safeMutation(() => store.restoreHidden(), "Hidden titles restored.") &&
    state.view === "discover"
  )
    runDiscovery({ filters: state.filters });
});
$("undo-button").addEventListener("click", () => {
  try {
    const hiddenBefore = JSON.stringify(hiddenKeys());
    store.undo();
    if ($("movie-dialog").open && !recordDirty && $("record-form"))
      renderDetail(state.detailItem);
    if (
      state.view === "discover" &&
      hiddenBefore !== JSON.stringify(hiddenKeys())
    )
      runDiscovery({ filters: state.filters });
    toast("Last change undone.");
  } catch (error) {
    toast(error.message);
  }
});
$("dismiss-toast").addEventListener("click", () => {
  $("toast").hidden = true;
});
$("theme-toggle").addEventListener("click", () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  setTheme(theme);
  try {
    storage.setItem("theme", theme);
  } catch {
    toast("Theme changed for this visit. Browser storage is unavailable.");
  }
});
$("refresh-recommendations").addEventListener("click", () => {
  state.recOffset += 4;
  loadRecommendations();
});
$("rec-type").addEventListener("change", resetRecommendations);
$("rec-seed").addEventListener("change", resetRecommendations);
for (const dialog of [$("movie-dialog"), $("data-dialog")]) {
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeDialog(dialog);
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom
      )
        closeDialog(dialog);
    }
  });
}
window.addEventListener("beforeunload", (event) => {
  if (recordDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("hashchange", restoreLocation);
window.addEventListener("popstate", restoreLocation);
document.querySelector(".brand").addEventListener("click", (event) => {
  event.preventDefault();
  navigate("discover", { focus: true });
});
window.addEventListener("storage", (event) => {
  if (
    event.key === null ||
    ["movieTrackerData", "hiddenItems"].includes(event.key)
  ) {
    try {
      const loaded = store.load();
      reportStorageWarning(loaded.warning || "");
      updateLibrary();
      if (recordDirty && $("record-message"))
        $("record-message").textContent =
          "Your collection changed in another tab. Saving will apply your current edits.";
      toast("Collection updated from another tab.");
    } catch (error) {
      reportStorageWarning(error.message);
    }
  }
});
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) {
    navigate(button.dataset.view, { focus: true });
    return;
  }
  if (button.dataset.preset) {
    runPreset(button.dataset.preset);
    return;
  }
  if (button.dataset.mode) {
    if (button.dataset.mode === "discover") {
      $("search-input").value = "";
      syncFilters(state.exploreFilters);
      runDiscovery({ filters: state.exploreFilters });
    } else {
      const query = state.filters.mode === "search" ? state.filters.query : "";
      $("search-type").value = "all";
      $("search-input").value = query;
      if (query) {
        setMode("search");
      } else clearTitleSearch();
      $("search-input").focus();
    }
    return;
  }
  if (button.dataset.display) {
    state.display = button.dataset.display;
    savePreferences({ libraryDisplay: state.display });
    renderLibrary();
    return;
  }
  if (button.dataset.personId) {
    const person = peopleCache.get(button.dataset.personId);
    if (!person) return;
    state.selectedPerson = person;
    $("person-results").innerHTML = "";
    changeExplore();
    return;
  }
  if (button.dataset.clearFilter) {
    const f = { ...state.filters },
      key = button.dataset.clearFilter;
    if (key === "years") {
      f.yearFrom = "";
      f.yearTo = "";
    } else if (key === "personId") {
      f.personId = "";
      f.personName = "";
    } else if (key === "watchProviderId") {
      f.watchProviderId = "";
      f.watchProviderName = "";
    } else f[key] = key === "minRating" ? 0 : "";
    syncFilters(f);
    runDiscovery({ filters: f });
    return;
  }
  if (button.dataset.restoreKey) {
    const [type, id] = button.dataset.restoreKey.split("-");
    if (
      safeMutation(
        () => store.setHidden(Number(id), type, false),
        "Title restored.",
      ) &&
      state.view === "discover"
    )
      runDiscovery({ filters: state.filters });
    return;
  }
  const action = button.dataset.action;
  if (!action) return;
  const item = button.dataset.key
    ? itemForKey(button.dataset.key)
    : state.detailItem;
  switch (action) {
    case "details":
      if (recordDirty && !confirm("Discard your unsaved changes?")) return;
      recordDirty = false;
      openDetails(item);
      break;
    case "save-watchlist":
      saveCard(item);
      break;
    case "draft-watched":
      saveCard(item, "watched");
      break;
    case "track-tv":
      openDetails(
        item,
        !getSaved(item) ||
          !getSaved(item).progress ||
          getSaved(item).progress.status === "planned"
          ? { status: "watching" }
          : null,
      );
      break;
    case "favorite":
      toggleFavorite(item);
      break;
    case "episode-total":
      $("record-total").value = button.dataset.count;
      markDirty("record-total");
      break;
    case "log-again":
      if (recordDirty && !confirm("Discard your unsaved changes?")) return;
      recordDirty = false;
      openDetails(item, { status: "watched", newLog: true });
      break;
    case "edit-log":
      openLogEditor(item, button.dataset.logId);
      break;
    case "remove-log":
      if (
        safeMutation(
          () => store.removeLog(item.id, typeOf(item), button.dataset.logId),
          "Viewing removed from history.",
        )
      ) {
        recordDirty = false;
        renderDetail(state.detailItem);
      }
      break;
    case "retry-discovery":
      runDiscovery({ filters: state.filters });
      break;
    case "load-more":
      runDiscovery({ append: true });
      break;
    case "reset-discovery":
      resetDiscovery();
      break;
    case "go-discover":
      navigate("discover", { focus: true });
      break;
    case "close-dialog":
      closeDialog(button.closest("dialog"));
      break;
    case "providers":
      loadProviders();
      break;
    case "collection":
      loadCollection(Number(button.dataset.id));
      break;
    case "back-detail":
      if (recordDirty && !confirm("Discard your unsaved changes?")) return;
      recordDirty = false;
      state.detailDraft = null;
      renderDetail(state.detailItem);
      break;
    case "remove-record":
      if (
        recordDirty &&
        !confirm("Discard your unsaved changes and remove this title?")
      )
        return;
      if (
        safeMutation(
          () => store.removeItem(item.id, typeOf(item)),
          "Title removed from your collection.",
        )
      ) {
        recordDirty = false;
        closeDialog($("movie-dialog"));
      }
      break;
    case "hide-title":
      if (recordDirty && !confirm("Discard your unsaved changes?")) return;
      if (
        safeMutation(
          () => store.setHidden(item.id, typeOf(item), true),
          "Title hidden from discovery.",
        )
      ) {
        recordDirty = false;
        closeDialog($("movie-dialog"));
        if (state.view === "discover") runDiscovery({ filters: state.filters });
      }
      break;
    case "hide-recommendation":
      safeMutation(
        () => store.setHidden(item.id, typeOf(item), true),
        "Suggestion hidden.",
      );
      break;
    case "retry-recommendations":
      loadRecommendations();
      break;
    case "reset-suggestions":
      resetRecommendations();
      break;
    case "reset-library":
      clearLibraryFilters();
      break;
    case "clear-person":
      state.selectedPerson = null;
      changeExplore();
      break;
  }
});

try {
  const loaded = store.load();
  library = store.getSnapshot();
  reportStorageWarning(loaded.warning || "");
  store.subscribe(updateLibrary);
  try {
    setTheme(storage.getItem("theme") || "dark");
  } catch {
    setTheme("dark");
  }
  state.display = ["grid", "list", "history"].includes(
    preferences.libraryDisplay,
  )
    ? preferences.libraryDisplay
    : "grid";
  $("hide-watched").checked = !!preferences.hideWatched;
  state.filters = locationFilters();
  if (!location.search && !location.hash)
    state.filters.watchRegion = preferences.watchRegion || "US";
  syncFilters(state.filters);
  $("search-input").value =
    state.filters.mode === "search" ? state.filters.query : "";
  updateLibrary();
  navigate(location.hash.slice(1) || "discover");
  runDiscovery({ filters: state.filters });
  restoringLocation = false;
} catch (error) {
  reportStorageWarning(
    error.message ||
      "The tracker could not initialize. Please reload the page.",
  );
}
