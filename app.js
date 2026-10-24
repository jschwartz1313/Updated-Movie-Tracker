import {
  GENRES,
  parseDiscoveryQuery,
  normalizeFilters,
  describeFilters,
  createMovieClient,
} from "./lib/discovery.js";
import { createLibraryStore } from "./lib/storage.js";

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
  results: [],
  resultInfo: null,
  recommendations: [],
  recommendationsReady: false,
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
function toast(message, undo = false) {
  clearTimeout(toastTimer);
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
    action();
    toast(message, undo);
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}
function readFilters() {
  return normalizeFilters({
    mode: state.filters.mode,
    query: state.filters.query,
    mediaType: $("media-type-filter").value,
    genreId: $("genre-filter").value,
    yearFrom: $("year-from").value,
    yearTo: $("year-to").value,
    sort: $("sort-filter").value,
    minVotes: Number($("min-votes").value),
    limit: Number($("result-limit").value),
  });
}
function setSelect(id, value, label = value) {
  const el = $(id);
  if (![...el.options].some((o) => o.value === String(value)))
    el.add(new Option(String(label), String(value)));
  el.value = String(value);
}
function populateGenres(mediaType = "movie", selected = "") {
  $("genre-filter").innerHTML =
    '<option value="">All genres</option>' +
    (GENRES[mediaType] || [])
      .map(
        (g) => `<option value="${Number(g.id)}">${escapeHTML(g.name)}</option>`,
      )
      .join("");
  $("genre-filter").value = selected;
}
function syncFilters(f) {
  $("media-type-filter").value = f.mediaType;
  populateGenres(f.mediaType, f.genreId);
  $("year-from").value = f.yearFrom || "";
  $("year-to").value = f.yearTo || "";
  $("sort-filter").value = f.sort;
  setSelect("min-votes", f.minVotes, `${number(f.minVotes)}+ votes`);
  setSelect("result-limit", f.limit, `${f.limit} titles`);
  $("sort-filter").disabled = f.mode === "search";
  $("min-votes").disabled = f.mode === "search" || f.sort !== "rating";
  $("filter-help").textContent =
    f.mode === "search"
      ? "Title results use TMDB relevance, your type, genre and date filters. Clear the search to return to ranked discovery."
      : "Ratings are TMDB community scores. Minimum votes applies to highest-rated rankings. Released titles only.";
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
  history.replaceState(
    null,
    "",
    `${location.pathname}${params.size ? "?" + params : ""}#${state.view}`,
  );
}
function resultTitle(f) {
  if (f.mode === "search") return `Results for “${f.query}”`;
  const genre = (GENRES[f.mediaType] || []).find(
    (g) => String(g.id) === String(f.genreId),
  )?.name;
  const media = f.mediaType === "tv" ? "TV shows" : "movies";
  return `${{ rating: `Top ${f.limit}`, popular: "Popular", newest: "Newest", trending: "Trending" }[f.sort] || "Explore"} ${genre ? genre.toLowerCase() + " " : ""}${media}${f.yearFrom ? ` · ${f.yearFrom}${f.yearTo && f.yearTo !== f.yearFrom ? "–" + f.yearTo : f.yearTo === f.yearFrom ? "" : " onward"}` : f.yearTo ? " · through " + f.yearTo : ""}`;
}
async function runDiscovery({ parse = false } = {}) {
  state.discoveryController?.abort();
  const controller = new AbortController();
  state.discoveryController = controller;
  try {
    let filters = readFilters();
    if (parse) {
      const input = $("search-input").value.trim();
      filters = input
        ? parseDiscoveryQuery(input, filters)
        : { ...filters, mode: "discover", query: "" };
      state.queryRecognized = Boolean(filters.recognized);
    }
    filters = normalizeFilters(filters);
    state.filters = filters;
    syncFilters(filters);
    saveLocation();
    state.busy = true;
    state.results = [];
    state.resultInfo = null;
    $("results-title").textContent = resultTitle(filters);
    $("results-kicker").textContent =
      filters.mode === "search"
        ? "TITLE SEARCH"
        : filters.sort === "rating"
          ? "COMMUNITY FAVORITES"
          : "THE NEXT WATCH";
    $("results-count").textContent = "Finding titles…";
    $("query-summary").hidden = false;
    $("query-summary").textContent = describeFilters(filters);
    $("discover-message").innerHTML =
      '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Searching the catalog…</div>';
    $("discover-grid").setAttribute("aria-busy", "true");
    $("discover-grid").innerHTML =
      '<div class="skeleton" aria-hidden="true"></div>'.repeat(5);
    const data = await client[
      filters.mode === "search" ? "search" : "discover"
    ](filters, {
      signal: controller.signal,
      excludeKeys: hiddenKeys().map((key) => key.replace("-", ":")),
    });
    if (controller !== state.discoveryController || controller.signal.aborted)
      return;
    state.results = data.results;
    state.resultInfo = data;
    state.busy = false;
    renderDiscovery();
  } catch (error) {
    if (controller !== state.discoveryController || controller.signal.aborted)
      return;
    state.busy = false;
    $("discover-grid").removeAttribute("aria-busy");
    $("discover-grid").innerHTML = "";
    $("results-count").textContent = "Search needs attention";
    $("discover-message").innerHTML =
      `<div class="notice warning" role="alert">${escapeHTML(error.message || "The catalog could not be reached. Please try again.")} <button class="text-btn" data-action="retry-discovery">Try again</button></div>`;
  }
}
function renderDiscovery() {
  if (state.busy) return;
  $("discover-grid").removeAttribute("aria-busy");
  const visible = state.results.filter((x) => !hiddenKeys().includes(keyOf(x)));
  const info = state.resultInfo;
  $("results-count").textContent = info
    ? `${visible.length} shown${info.totalResultsExact && info.totalResults > visible.length ? " of " + number(info.totalResults) : ""}`
    : "";
  $("discover-message").innerHTML = info?.warning
    ? `<div class="notice warning">${escapeHTML(info.warning)} <button class="text-btn" data-action="retry-discovery">Try again</button></div>`
    : "";
  if (state.results.length && visible.length < state.results.length)
    $("discover-message").innerHTML +=
      '<div class="notice">Hidden titles are excluded from these results. Restore them in Your data, or increase the result count.</div>';
  renderCards($("discover-grid"), visible, {
    rank: state.filters.sort === "rating" && state.filters.mode !== "search",
  });
  if (!visible.length)
    $("discover-grid").innerHTML = empty(
      "No titles found.",
      "Try a wider year range, a different title or fewer filters.",
      '<button class="btn secondary" data-action="reset-discovery">Reset search</button>',
    );
}
function empty(title, text, action = "") {
  return `<div class="empty"><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p>${action}</div>`;
}
function renderCards(container, items, { rank = false } = {}) {
  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    itemCache.set(keyOf(item), item);
    const status = getStatus(item),
      saved = getSaved(item),
      key = keyOf(item);
    const image = imageURL(item.poster_path);
    const card = document.createElement("article");
    card.className = "movie-card";
    card.dataset.key = key;
    const rating = Number(item.vote_average);
    card.innerHTML = `<button class="poster-button" data-action="details" data-key="${key}" aria-label="Details for ${escapeHTML(titleOf(item))}">${image ? `<img class="movie-poster" src="${image}" alt="" loading="lazy" decoding="async" width="342" height="513">` : `<span class="poster-placeholder">${escapeHTML(titleOf(item))}</span>`}${rank ? `<span class="rank-badge">${index + 1}</span>` : ""}${status ? '<span class="saved-badge" aria-label="In your collection">✓</span>' : ""}${rating > 0 ? `<span class="score-badge" title="TMDB community rating · ${number(item.vote_count)} votes">★ ${rating.toFixed(1)}</span>` : ""}</button><div class="movie-info"><button class="title-button" data-action="details" data-key="${key}">${escapeHTML(titleOf(item))}</button><div class="movie-meta"><span>${escapeHTML(yearOf(item) || "Year unknown")}${saved?.rating && status === "watched" ? ` · Your rating ${saved.rating}/10` : ""}</span><span class="type">${typeOf(item) === "tv" ? "TV SERIES" : "FILM"}</span></div><div class="card-actions">${status === "watched" ? `<button class="saved" data-action="details" data-key="${key}">✓ Watched · Edit log</button>` : `<button class="${status === "watchlist" ? "saved" : ""}" data-action="${status === "watchlist" ? "details" : "save-watchlist"}" data-key="${key}">${status === "watchlist" ? "✓ Watchlist" : "+ Watchlist"}</button><button data-action="save-watched" data-key="${key}">Log watched</button>`}</div>${item._recommendationReason ? `<p class="card-note">Because you watched ${escapeHTML(item._recommendationReason)}</p>` : ""}</div>`;
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
  });
  container.replaceChildren(fragment);
}
function navigate(view, { focus = false } = {}) {
  if (
    !["discover", "watchlist", "watched", "recommendations", "stats"].includes(
      view,
    )
  )
    view = "discover";
  if (view !== state.view) {
    $("library-search").value = "";
    $("library-genre").value = "";
    $("library-rating").value = "";
  }
  state.view = view;
  document.querySelectorAll(".view").forEach((el) => {
    el.hidden =
      el.id !==
      (["watchlist", "watched"].includes(view)
        ? "library-view"
        : `${view}-view`);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
  if (["watchlist", "watched"].includes(view)) renderLibrary();
  if (view === "stats") renderStats();
  if (view === "recommendations") loadRecommendations();
  saveLocation();
  if (focus) $("main").focus({ preventScroll: true });
}
function renderLibrary() {
  const watched = state.view === "watched";
  const source = watched ? library.watched : library.watchlist;
  $("library-title").textContent = watched
    ? "Your viewing journal."
    : "The watchlist.";
  $("library-description").textContent = watched
    ? "Every watch, every rating, every thought worth keeping."
    : "Good finds, ready for the right night.";
  $("library-rating-label").hidden = !watched;
  const previousGenre = $("library-genre").value;
  const genreMap = new Map(
    source
      .flatMap((item) => item.genres || [])
      .map((g) => [String(g.id), g.name]),
  );
  $("library-genre").innerHTML =
    '<option value="">All genres</option>' +
    [...genreMap]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(
        ([id, name]) =>
          `<option value="${escapeHTML(id)}">${escapeHTML(name)}</option>`,
      )
      .join("");
  $("library-genre").value = genreMap.has(previousGenre) ? previousGenre : "";
  const query = $("library-search").value.trim().toLocaleLowerCase(),
    type = $("library-type").value,
    genre = $("library-genre").value,
    rating = $("library-rating").value;
  let items = source.filter(
    (item) =>
      (type === "all" || typeOf(item) === type) &&
      (!genre || (item.genres || []).some((g) => String(g.id) === genre)) &&
      (!watched ||
        !rating ||
        (rating === "unrated"
          ? !item.rating
          : Number(item.rating) >= Number(rating))) &&
      (!query ||
        [
          titleOf(item),
          item.notes,
          item.review,
          ...(item.crew || []).map((p) => p.name),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)),
  );
  const sort = $("library-sort").value;
  items = [...items].sort((a, b) =>
    sort === "title"
      ? titleOf(a).localeCompare(titleOf(b))
      : sort === "year"
        ? (yearOf(b) || "").localeCompare(yearOf(a) || "")
        : sort === "rating"
          ? (Number(b.rating) || 0) - (Number(a.rating) || 0)
          : String(
              watched ? b.watchedDate || "" : b.addedAt || b.addedDate || "",
            ).localeCompare(
              String(
                watched ? a.watchedDate || "" : a.addedAt || a.addedDate || "",
              ),
            ),
  );
  $("library-result-title").textContent = watched
    ? "Logged titles"
    : "Saved for later";
  $("library-count").textContent = `${items.length} of ${source.length} titles`;
  renderCards($("library-grid"), items);
  if (!items.length)
    $("library-grid").innerHTML = empty(
      source.length
        ? "Nothing matches these filters."
        : watched
          ? "The opening scene."
          : "Make a night of it.",
      source.length
        ? "Clear your search or adjust the collection filters."
        : watched
          ? "Log your first movie or show to start your viewing journal."
          : "Save a few movies and shows to build your next-watch shortlist.",
      `<button class="btn primary" data-action="${source.length ? "reset-library" : "go-discover"}">${source.length ? "Clear filters" : "Explore titles ↗"}</button>`,
    );
}
function updateLibrary() {
  library = store.getSnapshot();
  reportStorageWarning(library.warning || "");
  $("watchlist-count").textContent = library.watchlist.length;
  $("watched-count").textContent = library.watched.length;
  if (state.view === "discover") renderDiscovery();
  if (["watchlist", "watched"].includes(state.view)) renderLibrary();
  if (state.view === "stats") renderStats();
  if (state.view === "recommendations") renderRecommendationCards();
  updateHiddenCount();
}
function saveCard(item, status) {
  const data = normalizeItem({ ...item, ...detailCache.get(keyOf(item)) });
  if (
    safeMutation(
      () => store.saveItem(data, status),
      status === "watched"
        ? `Logged “${titleOf(item)}” as watched.`
        : `Added “${titleOf(item)}” to your watchlist.`,
    )
  ) {
    if (status === "watched") openDetails({ ...data, ...getSaved(data) });
  }
}
function detailMarkup(item, warning = "") {
  const saved = getSaved(item),
    status = getStatus(item),
    combined = normalizeItem({
      ...saved,
      ...item,
      ...Object.fromEntries(
        ["rating", "notes", "review", "watchedDate"]
          .filter((k) => saved && Object.hasOwn(saved, k))
          .map((k) => [k, saved[k]]),
      ),
    });
  const image = imageURL(combined.poster_path),
    rating = Number(combined.vote_average),
    mt = typeOf(item);
  const imdb = combined.externalIds?.imdb_id;
  return `<div class="detail-header">${image ? `<img class="detail-poster" src="${image}" alt="Poster for ${escapeHTML(titleOf(item))}">` : '<div class="detail-poster"></div>'}<div><h2 id="detail-title">${escapeHTML(titleOf(item))}</h2><div class="movie-meta"><span>${escapeHTML(yearOf(combined) || "Year unknown")}</span><span>${mt === "tv" ? "TV series" : "Movie"}</span>${combined.runtime ? `<span>${Number(combined.runtime)} min${mt === "tv" ? " / episode" : ""}</span>` : ""}${rating ? `<span>★ ${rating.toFixed(1)} TMDB</span>` : ""}</div><div class="detail-genres">${(combined.genres || []).map((g) => `<span>${escapeHTML(g.name)}</span>`).join("")}</div><div class="detail-links"><a href="https://www.themoviedb.org/${mt}/${Number(item.id)}" target="_blank" rel="noopener noreferrer">View on TMDB ↗</a>${/^tt\d+$/.test(imdb) ? `<a href="https://www.imdb.com/title/${imdb}/" target="_blank" rel="noopener noreferrer">IMDb ↗</a>` : ""}</div></div></div><div id="detail-live-status">${warning ? `<div class="notice">${escapeHTML(warning)}</div>` : ""}</div><p class="detail-overview">${escapeHTML(combined.overview || "No overview is available for this title.")}</p><form id="record-form" class="record-panel"><h3>Your record</h3><div class="record-fields"><label>Status<select id="record-status"><option value="watchlist"${status === "watchlist" || !status ? " selected" : ""}>On my watchlist</option><option value="watched"${status === "watched" ? " selected" : ""}>Watched</option></select></label><label id="record-rating-label">Your rating<select id="record-rating"><option value="0">Not rated</option>${Array.from(
    { length: 19 },
    (_, i) => 1 + i / 2,
  )
    .map(
      (n) =>
        `<option value="${n}"${Number(combined.rating) === n ? " selected" : ""}>${n} / 10</option>`,
    )
    .join(
      "",
    )}</select></label><label id="record-date-label">Date watched<input type="date" id="record-date" max="${today()}" value="${escapeHTML((combined.watchedDate || today()).slice(0, 10))}"></label></div><label class="record-notes">Your notes<textarea id="record-notes" maxlength="20000" placeholder="What did you think? Who did you watch it with?">${escapeHTML(combined.notes || combined.review || "")}</textarea></label><div class="record-footer"><p>Your rating and notes stay with this title when you change its status.</p><button class="btn primary" type="submit">Save record</button></div><div id="record-message" class="form-error" role="alert"></div></form><div class="detail-section"><h3>Where to watch <span class="small muted">· United States</span></h3><div id="providers-content"><button class="btn secondary" data-action="providers">Check availability</button><p class="small muted">Availability provided by JustWatch via TMDB.</p></div></div>${combined.belongs_to_collection ? `<div class="detail-section"><button class="btn secondary" data-action="collection" data-id="${Number(combined.belongs_to_collection.id)}">Explore ${escapeHTML(combined.belongs_to_collection.name)} ↗</button></div>` : ""}${combined.crew?.length ? `<div class="detail-section"><h3>Behind the camera</h3><p>${combined.crew.map((p) => `${escapeHTML(p.name)}${p.job ? " · " + escapeHTML(p.job) : ""}`).join(" &nbsp; / &nbsp; ")}</p></div>` : ""}${combined.cast?.length ? `<div class="detail-section"><h3>Cast</h3><p>${combined.cast.map((p) => escapeHTML(p.name)).join(" · ")}</p></div>` : ""}<div class="detail-actions">${status ? '<button class="text-btn danger" data-action="remove-record">Remove from collection</button>' : "<span></span>"}<button class="text-btn" data-action="hide-title">Hide from discovery</button></div>`;
}
function renderDetail(item, warning = "") {
  ++state.detailPresentation;
  state.detailItem = item;
  recordDirty = false;
  $("detail-content").innerHTML = detailMarkup(item, warning);
  syncRecordFields();
  $("record-form").addEventListener("input", () => {
    recordDirty = true;
  });
  $("record-status").addEventListener("change", syncRecordFields);
  $("record-form").addEventListener("submit", saveRecord);
}
async function openDetails(item) {
  if (!item) return;
  state.detailController?.abort();
  const controller = new AbortController();
  state.detailController = controller;
  const sequence = ++state.detailSequence;
  const cached = detailCache.get(keyOf(item));
  state.detailItem = normalizeItem({ ...item, ...cached });
  const dialog = $("movie-dialog");
  if (!dialog.open) dialog.showModal();
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
    if (sequence !== state.detailSequence || controller.signal.aborted) return;
    if ($("detail-live-status"))
      $("detail-live-status").textContent =
        "Live details could not be loaded. You can still save and edit this record. " +
        error.message;
  }
}
function syncRecordFields() {
  const watched = $("record-status")?.value === "watched";
  if (!$("record-rating-label")) return;
  $("record-rating-label").hidden = !watched;
  $("record-date-label").hidden = !watched;
  $("record-date").required = watched;
}
function saveRecord(event) {
  event.preventDefault();
  const item = state.detailItem;
  if (!item) return;
  const status = $("record-status").value;
  const date = $("record-date").value;
  if (status === "watched" && (!date || date > today())) {
    $("record-message").textContent =
      "Choose a valid date watched, up to today.";
    return;
  }
  const changes = { notes: $("record-notes").value };
  if (status === "watched") {
    changes.rating = Number($("record-rating").value);
    changes.watchedDate = date;
  }
  try {
    store.saveItem(normalizeItem(item), status, changes);
    recordDirty = false;
    closeDialog($("movie-dialog"));
    toast("Your record is saved.", true);
  } catch (error) {
    $("record-message").textContent = error.message;
  }
}
function closeDialog(dialog) {
  if (
    dialog.id === "movie-dialog" &&
    recordDirty &&
    !confirm("Discard your unsaved record changes?")
  )
    return false;
  if (dialog.id === "movie-dialog") {
    recordDirty = false;
    state.detailController?.abort();
    ++state.detailSequence;
  }
  dialog.close();
  return true;
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
    const us = data.results?.US;
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
      `<div class="providers">${html || "<p>No US availability is listed for this title.</p>"}${link ? `<a class="text-btn" href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer">See watch options ↗</a>` : ""}<p class="small muted">Availability may change. Data provided by JustWatch via TMDB.</p></div>`;
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
async function loadRecommendations() {
  state.recommendationController?.abort();
  state.recommendationsReady = false;
  const controller = new AbortController();
  state.recommendationController = controller;
  const seeds = [...library.watched]
    .filter((x) => !x.rating || x.rating >= 7)
    .sort(
      (a, b) =>
        (b.rating || 0) - (a.rating || 0) ||
        String(b.watchedDate || "").localeCompare(a.watchedDate || ""),
    )
    .slice(0, 5);
  if (!seeds.length) {
    state.recommendations = [];
    $("recommendations-message").innerHTML = empty(
      "Start with something you love.",
      "Log a few titles and rate the ones you enjoyed to get personal suggestions.",
      '<button class="btn primary" data-action="go-discover">Find a title ↗</button>',
    );
    $("recommendations-grid").innerHTML = "";
    return;
  }
  $("recommendations-message").innerHTML =
    '<div class="loading"><span class="spinner"></span>Following your taste…</div>';
  $("recommendations-grid").innerHTML = "";
  const responses = await Promise.allSettled(
    seeds.map(async (seed) => ({
      seed,
      data: await client.recommendations(seed.id, typeOf(seed), {
        signal: controller.signal,
      }),
    })),
  );
  if (controller.signal.aborted) return;
  const candidates = new Map();
  const errors = [];
  for (const response of responses) {
    if (response.status === "rejected") {
      errors.push(
        response.reason?.message || "Some suggestions could not be loaded.",
      );
      continue;
    }
    const { seed, data } = response.value;
    if (data.warning) errors.push(data.warning);
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
        !x.adult &&
        (!yearOf(x) || (x.release_date || x.first_air_date || "") <= today()),
    )
    .sort((a, b) => a._recommendationRank - b._recommendationRank)
    .slice(0, 100);
  $("recommendations-message").innerHTML = errors.length
    ? `<div class="notice warning">${escapeHTML(errors[0])} <button class="text-btn" data-action="retry-recommendations">Try again</button></div>`
    : '<p class="small muted">Based on ' +
      seeds.map((s) => escapeHTML(titleOf(s))).join(", ") +
      ". Titles already in your collection are excluded.</p>";
  state.recommendationsReady = true;
  renderRecommendationCards();
}
function renderRecommendationCards() {
  const excluded = new Set(
    [...library.watchlist, ...library.watched].map(keyOf).concat(hiddenKeys()),
  );
  const items = state.recommendations
    .filter((x) => !excluded.has(keyOf(x)))
    .slice(0, 50);
  renderCards($("recommendations-grid"), items);
  if (!items.length && state.recommendationsReady)
    $("recommendations-grid").innerHTML = empty(
      "You’re all caught up.",
      "Log more titles or refresh suggestions to find something different.",
    );
}
function renderStats() {
  const watched = library.watched,
    rated = watched.filter((x) => Number(x.rating) > 0),
    films = watched.filter((x) => typeOf(x) === "movie");
  const timed = films.filter((x) => Number(x.runtime) > 0),
    minutes = timed.reduce((sum, x) => sum + Number(x.runtime), 0);
  const genres = new Map();
  watched.forEach((item) =>
    (item.genres || []).forEach((g) =>
      genres.set(g.name, (genres.get(g.name) || 0) + 1),
    ),
  );
  const sortedGenres = [...genres].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const top = [...rated].sort((a, b) => b.rating - a.rating).slice(0, 8);
  top.forEach((item) => itemCache.set(keyOf(item), item));
  $("stats-content").innerHTML =
    `<div class="stats-grid"><div class="stat"><strong>${number(library.watchlist.length)}</strong><span>On your watchlist</span></div><div class="stat"><strong>${number(watched.length)}</strong><span>${films.length} films · ${watched.length - films.length} TV shows watched</span></div><div class="stat"><strong>${rated.length ? (rated.reduce((sum, x) => sum + Number(x.rating), 0) / rated.length).toFixed(1) : "—"}</strong><span>Your average rating · ${rated.length} rated</span></div><div class="stat"><strong>${(minutes / 60).toFixed(1)}<small class="small"> h</small></strong><span>Film time · ${timed.length} known runtimes</span></div></div><p class="small muted" style="margin-top:16px">Film time excludes TV series and films without a known runtime. It counts each logged film once.</p><div class="stats-detail"><div class="stats-panel"><h3>Your favorites</h3>${top.length ? top.map((item) => `<div class="stat-line"><button class="title-button" data-action="details" data-key="${keyOf(item)}">${escapeHTML(titleOf(item))}</button><span>${Number(item.rating)} / 10</span></div>`).join("") : '<p class="small muted">Your highest-rated watches will appear here.</p>'}</div><div class="stats-panel"><h3>Your favorite genres</h3>${sortedGenres.length ? sortedGenres.map(([name, count]) => `<div class="stat-line"><span>${escapeHTML(name)}</span><span>${count} ${count === 1 ? "title" : "titles"}</span></div><div class="genre-bar"><span style="width:${(count / sortedGenres[0][1]) * 100}%"></span></div>`).join("") : '<p class="small muted">Log titles to discover your most-watched genres.</p>'}</div></div>`;
}
function updateHiddenCount() {
  $("hidden-count").textContent =
    `${hiddenKeys().length} ${hiddenKeys().length === 1 ? "title is" : "titles are"} hidden from discovery and suggestions.`;
  $("restore-hidden").disabled = !hiddenKeys().length;
}
function openData() {
  updateHiddenCount();
  $("import-message").textContent = "";
  $("data-dialog").showModal();
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
    store.importData(text);
    $("import-message").textContent =
      `Import complete. Your collection now has ${library.watchlist.length} watchlist titles and ${library.watched.length} watched titles.`;
    toast("Backup merged with your collection.", true);
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
].forEach((id) =>
  $(id).addEventListener("change", () => {
    if ($("discover-form").reportValidity()) runDiscovery();
  }),
);
$("media-type-filter").addEventListener("change", () => {
  populateGenres($("media-type-filter").value);
  runDiscovery();
});
$("reset-filters").addEventListener("click", resetDiscovery);
$("search-input").addEventListener("search", () => {
  if (!$("search-input").value) runDiscovery({ parse: true });
});
function resetDiscovery() {
  state.filters = { ...defaults };
  $("search-input").value = "";
  syncFilters(state.filters);
  runDiscovery();
}
function runPreset(preset) {
  const f = { ...defaults };
  let text = "";
  if (preset === "animation") {
    Object.assign(f, {
      genreId: "16",
      yearFrom: "2000",
      yearTo: String(new Date().getFullYear()),
      sort: "rating",
    });
    text = "top 50 animated movies since 2000";
  }
  if (preset === "scifi") {
    Object.assign(f, {
      genreId: "878",
      yearFrom: "2010",
      yearTo: "2019",
      sort: "rating",
    });
    text = "best 50 sci-fi movies between 2010 and 2019";
  }
  state.filters = f;
  syncFilters(f);
  $("search-input").value = text;
  runDiscovery();
}
[
  "library-search",
  "library-type",
  "library-genre",
  "library-sort",
  "library-rating",
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
    runDiscovery();
});
$("undo-button").addEventListener("click", () => {
  try {
    store.undo();
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
$("refresh-recommendations").addEventListener("click", loadRecommendations);
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
window.addEventListener("hashchange", () => {
  if (location.hash !== "#main") navigate(location.hash.slice(1) || "discover");
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
  const action = button.dataset.action;
  if (!action) return;
  const item = button.dataset.key
    ? getSaved(itemCache.get(button.dataset.key) || {}) ||
      itemCache.get(button.dataset.key)
    : state.detailItem;
  switch (action) {
    case "details":
      if (recordDirty && !confirm("Discard your unsaved record changes?"))
        return;
      recordDirty = false;
      openDetails(item);
      break;
    case "save-watchlist":
      saveCard(item, "watchlist");
      break;
    case "save-watched":
      saveCard(item, "watched");
      break;
    case "retry-discovery":
      runDiscovery();
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
      renderDetail(state.detailItem);
      break;
    case "remove-record":
      if (
        recordDirty &&
        !confirm("Discard your unsaved record changes and remove this title?")
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
      if (recordDirty && !confirm("Discard your unsaved record changes?"))
        return;
      if (
        safeMutation(
          () => store.setHidden(item.id, typeOf(item), true),
          "Title hidden from discovery.",
        )
      ) {
        recordDirty = false;
        closeDialog($("movie-dialog"));
        if (state.view === "discover") runDiscovery();
      }
      break;
    case "retry-recommendations":
      loadRecommendations();
      break;
    case "reset-library":
      ["library-search", "library-genre", "library-rating"].forEach(
        (id) => ($(id).value = ""),
      );
      $("library-type").value = "all";
      renderLibrary();
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
  const params = Object.fromEntries(new URLSearchParams(location.search));
  try {
    state.filters = normalizeFilters({ ...defaults, ...params });
  } catch {
    state.filters = { ...defaults };
  }
  syncFilters(state.filters);
  $("search-input").value =
    state.filters.mode === "search" ? state.filters.query : "";
  updateLibrary();
  navigate(location.hash.slice(1) || "discover");
  runDiscovery();
} catch (error) {
  reportStorageWarning(
    error.message ||
      "The tracker could not initialize. Please reload the page.",
  );
}
