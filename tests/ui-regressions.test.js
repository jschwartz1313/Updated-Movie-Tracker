import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createLibraryStore } from "../lib/storage.js";
import { mergePersonalEdits, metadataForStorage } from "../lib/app-model.js";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

// Execute the actual app functions without starting the page or its API calls.
function appFunctions(names, globals) {
  const declarations = names.map((name) => {
    const start = appSource.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
    assert.notEqual(start, -1, `App function ${name} exists`);
    const rest = appSource.slice(start);
    const next = rest.search(/\n(?:async )?function \w+\(/);
    return next === -1 ? rest : rest.slice(0, next);
  });
  return vm.runInNewContext(`${declarations.join("\n")}\n({${names.join(",")}})`, globals);
}

test("saving notes respects another tab's watchlist move despite a stale watched select", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const store = createLibraryStore(storage);
  const item = { id: 1, mediaType: "movie", title: "Film" };
  store.saveItem(item, "watched", { logs: [], watchedDate: "", notes: "Original" });
  const draftBase = store.getSnapshot().watched[0];

  const otherTab = createLibraryStore(storage);
  otherTab.load();
  otherTab.saveItem(item, "watchlist", { favorite: true });
  store.load(); // The browser's storage event refreshes current saved data.

  const elements = {
    "record-status": { value: "watched" },
    "record-date": { value: "2026-10-24" },
    "record-notes": { value: "Only changed notes" },
    "record-rating": { value: "0" },
    "record-tags": { value: "" },
    "record-favorite": { checked: false },
    "record-priority": { value: "normal" },
    "record-log-notes": { value: "" },
    "record-message": { textContent: "" },
    "movie-dialog": {},
  };
  const getSaved = () => {
    const snapshot = store.getSnapshot();
    return snapshot.watched[0] || snapshot.watchlist[0];
  };
  const getStatus = () => store.getSnapshot().watched.length ? "watched" : "watchlist";
  const { saveRecord } = appFunctions(["needsNewLog", "saveRecord"], {
    $: (id) => elements[id],
    state: { detailItem: item, detailDraft: null },
    store, draftBase, draftBaseStatus: "watched", recordDirty: true,
    dirtyFields: new Set(["record-notes"]),
    getSaved, getStatus, trackedState: getStatus,
    typeOf: () => "movie", today: () => "2026-10-24",
    metadataForStorage, mergePersonalEdits,
    closeDialog() {}, toast() {}, hydrateSaved() {},
    confirm() { assert.fail("Unchanged status and notes have no conflict"); },
  });
  saveRecord({ preventDefault() {} });

  const saved = store.getSnapshot();
  assert.equal(elements["record-message"].textContent, "");
  assert.equal(saved.watched.length, 0);
  assert.equal(saved.watchlist[0].notes, "Only changed notes");
  assert.equal(saved.watchlist[0].favorite, true);
  assert.deepEqual(saved.watchlist[0].logs, []);
  assert.equal(saved.watchlist[0].watchedDate, "");
});

class SelectStub {
  options = [];
  selected = "";
  get value() { return this.selected; }
  set value(value) {
    this.selected = this.options.some((option) => option.value === value) ? value : "";
  }
  get selectedOptions() { return this.options.filter((option) => option.value === this.value); }
  set innerHTML(html) {
    this.options = [...html.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)]
      .map(([, value, textContent]) => ({ value, textContent }));
    this.selected = this.options[0]?.value || "";
  }
  add(option) { this.options.push(option); }
}

test("provider loading preserves a service selected while its request is pending", async () => {
  let resolveProviders;
  const response = new Promise((resolve) => { resolveProviders = resolve; });
  const select = new SelectStub();
  select.innerHTML = '<option value="">Any service</option><option value="8">Netflix</option><option value="15">Hulu</option>';
  select.value = "8";
  const elements = {
    "watch-provider": select,
    "media-type-filter": { value: "movie" },
    "watch-region": { value: "US" },
  };
  const { loadProviderOptions } = appFunctions(["setSelect", "loadProviderOptions"], {
    $: (id) => elements[id], providerRequest: 0, providerCache: new Map(),
    client: { watchProviders: () => response }, escapeHTML: String,
    Option: class { constructor(textContent, value) { this.textContent = textContent; this.value = value; } },
    toast(message) { assert.fail(message); },
  });
  const pending = loadProviderOptions();
  select.value = "15";
  // A missing provider must retain the latest selected label as a fallback.
  resolveProviders([{ provider_id: 8, provider_name: "Netflix" }]);
  await pending;

  assert.equal(select.value, "15");
  assert.equal(select.selectedOptions[0].textContent, "Hulu");
  assert.equal(select.options.filter((option) => option.value === "15").length, 1);
});
