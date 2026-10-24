import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { normalizeFilters } from "../lib/discovery.js";
import { recommendationSeeds } from "../lib/app-model.js";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

function appFunction(name) {
  const start = appSource.search(new RegExp(`^function ${name}\\(`, "m"));
  assert.notEqual(start, -1, `App function ${name} exists`);
  const rest = appSource.slice(start);
  const next = rest.search(/\n(?:async )?function \w+\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

// Run the actual navigation/history functions; rendering and network loading
// are boundary spies, and the DOM only supplies controls used by navigation.
function navigationHarness() {
  const location = new URL("https://example.test/tracker/#discover");
  const entries = [location.href];
  let entry = 0;
  const historyCalls = [];
  const history = {
    pushState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
      entries.splice(++entry, entries.length, location.href);
      historyCalls.push("push");
    },
    replaceState(_state, _title, url) {
      location.href = new URL(url, location.href).href;
      entries[entry] = location.href;
      historyCalls.push("replace");
    },
  };
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", focus() {} });
    return elements.get(id);
  };
  const views = ["discover", "library", "recommendations", "stats"]
    .map((name) => ({ id: `${name}-view`, hidden: name !== "discover" }));
  const nav = ["discover", "watchlist", "watching", "watched", "recommendations", "stats"]
    .map((view) => ({
      dataset: { view }, classList: { toggle() {} },
      setAttribute() {}, removeAttribute() {},
    }));
  const calls = { discovery: [], sync: [], resets: 0, recommendationRenders: 0 };
  const library = { watchlist: [], watched: [] };
  const state = {
    view: "discover", filters: null, recommendationContext: "",
    recommendationsReady: false, recommendationsHaveSeeds: false,
  };
  let functions;
  const globals = {
    URLSearchParams, normalizeFilters, recommendationSeeds, location, history,
    $,
    document: { querySelectorAll: (selector) => selector === ".view" ? views : nav },
    state, library, preferences: { watchRegion: "GB" },
    restoringLocation: false, appliedLocation: location.href,
    syncFilters: (filters) => calls.sync.push(filters),
    runDiscovery: ({ filters }) => calls.discovery.push(filters),
    renderLibrary() {}, renderStats() {}, populateRecommendationSeeds() {},
    allRecords: () => [...library.watchlist, ...library.watched],
    typeOf: (item) => item.mediaType || "movie",
    keyOf: (item) => `${item.mediaType || "movie"}-${item.id}`,
    resetRecommendations() {
      calls.resets++;
      state.recommendationContext = functions.recommendationContext();
      state.recommendationsReady = true;
      state.recommendationsHaveSeeds = recommendationSeeds(library).length > 0;
    },
    renderRecommendationCards: () => calls.recommendationRenders++,
  };
  $("rec-type").value = "all";
  const names = ["saveLocation", "locationFilters", "restoreLocation", "navigate", "recommendationLibrary", "recommendationContext"];
  const defaultsStart = appSource.indexOf("const defaults = {");
  const defaultsEnd = appSource.indexOf("const client =", defaultsStart);
  functions = vm.runInNewContext(
    `${appSource.slice(defaultsStart, defaultsEnd)}\n${names.map(appFunction).join("\n")}\n({defaults,${names.join(",")}})`,
    globals,
  );
  state.filters = normalizeFilters(functions.defaults);
  return {
    functions, state, library, globals, calls, historyCalls, entries, location, $, views,
    back() {
      assert.ok(entry > 0, "A prior history entry exists");
      location.href = entries[--entry];
      functions.restoreLocation();
    },
  };
}

test("search and view changes add history once and Back restores filters, input, and view", () => {
  const h = navigationHarness();
  const { functions, state } = h;
  functions.saveLocation();
  assert.deepEqual(h.historyCalls, []);
  const titleFilters = (query) => normalizeFilters({
    ...functions.defaults, mode: "search", mediaType: "all", query,
    includeUpcoming: true, limit: 30, minVotes: 0,
  });
  state.filters = titleFilters("Dune");
  functions.navigate("discover");
  const duneUrl = h.location.href;
  functions.saveLocation();
  assert.deepEqual(h.historyCalls, ["push"]);
  state.filters = titleFilters("Alien");
  functions.navigate("discover");
  functions.navigate("watchlist");
  assert.equal(state.view, "watchlist");
  assert.deepEqual(h.historyCalls, ["push", "push", "push"]);

  h.back();
  assert.equal(state.view, "discover");
  assert.equal(state.filters.query, "Alien");
  assert.equal(h.$("search-input").value, "Alien");
  assert.equal(h.calls.discovery.length, 0, "Changing only the view preserves loaded search results");
  h.back();
  assert.equal(h.location.href, duneUrl);
  assert.equal(state.filters.query, "Dune");
  assert.equal(state.filters.mediaType, "all");
  assert.equal(state.filters.includeUpcoming, true);
  assert.equal(h.$("search-input").value, "Dune");
  assert.equal(h.calls.discovery.length, 1);
  assert.equal(h.calls.discovery[0].query, "Dune");
  assert.equal(h.views.find((view) => view.id === "discover-view").hidden, false);
  assert.deepEqual(h.historyCalls, ["push", "push", "push"], "Restoring history does not append or replace entries");
  const syncCount = h.calls.sync.length;
  functions.restoreLocation();
  assert.equal(h.calls.sync.length, syncCount, "A second browser event for the same URL is ignored");
});

test("history URLs use their own region and the main skip link does not restore a different view", () => {
  const h = navigationHarness();
  assert.equal(h.functions.locationFilters().watchRegion, "US", "Saved region preferences do not reinterpret an existing URL");
  h.location.search = "?watchRegion=CA";
  assert.equal(h.functions.locationFilters().watchRegion, "CA");
  h.state.view = "watchlist";
  h.$("search-input").value = "Unsubmitted title";
  h.location.hash = "#main";
  h.functions.restoreLocation();
  assert.equal(h.state.view, "watchlist");
  assert.equal(h.$("search-input").value, "Unsubmitted title");
  assert.deepEqual(h.historyCalls, []);
  assert.equal(h.calls.sync.length, 0);
  assert.equal(h.calls.discovery.length, 0);
});

test("recommendation navigation reuses results until the eligible seeds, chosen seed, or type changes", () => {
  const h = navigationHarness();
  h.library.watched.push({ id: 1, mediaType: "movie", title: "Film", rating: 8 });
  h.functions.navigate("recommendations");
  assert.equal(h.calls.resets, 1);
  h.functions.navigate("watchlist");
  h.functions.navigate("recommendations");
  assert.equal(h.calls.resets, 1);
  assert.equal(h.calls.recommendationRenders, 1);
  h.library.watchlist.push({ id: 2, mediaType: "movie", title: "Unrated" });
  h.functions.navigate("watchlist");
  h.functions.navigate("recommendations");
  assert.equal(h.calls.resets, 1, "An unrelated saved title does not invalidate suggestions");
  h.library.watched.push({ id: 3, mediaType: "movie", title: "New favorite", rating: 9 });
  h.functions.navigate("watchlist");
  h.functions.navigate("recommendations");
  assert.equal(h.calls.resets, 2);
  h.$("rec-seed").value = "movie-1";
  h.functions.navigate("recommendations");
  assert.equal(h.calls.resets, 3);
  h.$("rec-type").value = "movie";
  h.functions.navigate("recommendations");
  assert.equal(h.calls.resets, 4);
});

test("returning to seedless or still-loading recommendations preserves their current state", () => {
  const h = navigationHarness();
  h.functions.navigate("recommendations");
  h.functions.navigate("watchlist");
  h.functions.navigate("recommendations");
  assert.equal(h.calls.resets, 1);
  assert.equal(h.calls.recommendationRenders, 0, "The no-seed prompt is not replaced by a generic empty result");
  const loading = navigationHarness();
  loading.library.watched.push({ id: 1, mediaType: "movie", title: "Film", rating: 8 });
  loading.functions.navigate("recommendations");
  loading.state.recommendationsReady = false;
  loading.functions.navigate("watchlist");
  loading.functions.navigate("recommendations");
  assert.equal(loading.calls.resets, 1, "Revisiting does not restart an in-flight load");
  assert.equal(loading.calls.recommendationRenders, 0);
});
