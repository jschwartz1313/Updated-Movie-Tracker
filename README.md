# Movie Tracker

A movie and TV discovery tool, personal watchlist, series tracker, and viewing journal. Static HTML, CSS and JavaScript; no dependencies or build step.

**Live:** [Movie Tracker](https://jschwartz1313.github.io/Updated-Movie-Tracker/)

## Find titles in different ways

**Title search** treats the entered title literally and starts fresh across movies and TV shows, without inheriting unrelated Explore filters. It includes upcoming and announced titles by default, so they can be saved before release. Narrow to movies or TV, and turn upcoming titles off when desired. Results use TMDB relevance.

**Explore** combines genre, an inclusive year range, popularity/rating/date ranking, minimum rating, original language, movie runtime, streaming service and region, and movie cast/crew filters. Person lookup shows real people and their known work so users can choose the right actor or filmmaker. Availability includes streaming, rental and purchase listings.

In Explore, explicit requests such as `best sci-fi movies since 2010`, `top 50 animated movies since 2000`, or `best TV shows` translate into visible filters. Unsupported wording remains a title search; the app does not invent filters. Incompatible movie-only filters are cleared when switching to TV. Weekly trending uses TMDB's own feed and does not offer service, runtime or person filtering. Browser Back and Forward restore views and submitted searches.

Highest-rated discovery uses TMDB's global rating order with a visible minimum-vote threshold. Explore shows released titles. Load more continues through subsequent results, retaining order and avoiding duplicates. Hidden titles and the optional Hide watched setting are excluded with backfilling. Partial results and request failures are clearly labeled.

## Organize a personal collection

- Save a watchlist and set **High, Normal, or Low priority**.
- Add **Favorites** and personal list names such as `Weekend picks`, `With family`, or `TV Night`. A title can be in multiple lists.
- Search titles, cast, filmmakers, personal notes, viewing notes and list names. Search is accent-insensitive and supports multiple words.
- Filter by type, genre, personal list, priority, rating, favorite status and TV progress. Use posters or a compact list, and sort by recent activity, title, rating, release year, priority or runtime.
- Saved metadata refreshes in the background without replacing personal fields or losing Undo. Stored records use compact metadata rather than bulky raw API responses.

## Track shows and log watches

TV shows support **Want to watch, Watching, Paused, Dropped, and Completed**, plus episodes watched, a total episode count, and optional season/episode markers. Progress is manually recorded; the app does not infer watched episodes or automatically mark an ongoing series complete. A known TMDB total can be copied into the record explicitly.

**Log watched** opens a draft. Nothing is recorded until Save; Cancel leaves the library unchanged. Ratings, dates, notes and personal organization can be edited in the record.

Repeat watches create separate viewing events. Each event has its own optional date, rating and notes, while the title retains overall personal notes and rating. Dates can be unknown. Viewing events can be edited or removed with Undo. Moving a title back to a watchlist preserves its history.

The Watched section offers a chronological **Viewing history**. Insights count viewing events, including rewatches, and use known movie runtimes for film hours. They exclude TV hours, disclose unknown runtimes/dates, and show viewing activity and personal lists.

## Useful suggestions and details

For you uses watched titles rated at least 7 or explicitly favorited titles. Unrated watches are not automatically treated as positive preferences. Users can choose any saved title as an explicit seed and filter suggestions by movie/TV. Suggestions stay in place when navigating between views; Find different suggestions rotates seeds and continues through recommendation pages. Already-saved and hidden titles are excluded; Not for me is reversible.

Title details include synopsis, cast/crew, genres, community rating/vote count, trailer and external links when available, official movie collections, and regional watch options from JustWatch via TMDB.

## Reliability and backups

Data stays **in this browser on this device**. There is no account or automatic cross-device sync. Export a JSON backup under **Your data** before clearing site data or moving browsers. Export includes lists, favorites, progress and viewing history; the app displays the last export date. Private browsing can discard records when its window closes.

The app preserves the original `movieTrackerData`, `hiddenItems`, and `theme` keys. The additive version 2 library schema supports older records, reviews, and ISO dates. Legacy watched records migrate to one deterministic viewing event; repeated loads do not duplicate it.

Saves are confirmed only after canonical storage succeeds. Failed writes preserve the previous library. Invalid imports are rejected in full. Damaged existing data is salvaged where possible and its original text is protected by a recovery copy before later writes. Imports merge history by event ID, preserve current personal edits and ongoing TV states, and retain planned rewatches.

Forms save only edited fields so unrelated changes from another tab are retained. Editing the same field concurrently requires an explicit choice. Removed records and viewings are not silently recreated by stale drafts.

Requests have bounded retries, timeouts, cancellation, and safeguards against stale responses. Details do not replace a form while the user is editing. Removal, hiding, imports and record changes support one-step Undo; metadata hydration does not consume it.

Searches and metadata/availability checks contact TMDB. Personal ratings, notes, lists and progress are not uploaded. The original public TMDB key is retained for compatibility with GitHub Pages hosting.

## Run locally

ES modules require an HTTP server rather than opening `index.html` as a file:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`. The API key is configured in `lib/discovery.js`.

Release assets and browser module imports carry a shared version query. Bump it together on releases so an already-open browser does not mix old scripts with a new interface.

## Verify changes

Node.js 22 or later:

```sh
npm test
npm run check
```

The dependency-free regression suite covers query planning, filters, multi-media identity, upcoming titles, cursor pagination, request failures and cancellation, legacy migration, storage/quota failures, journals, progress, import/export, Undo, cross-tab conflicts, metadata size, personal-field merges and recommendation seeds. GitHub Actions runs the checks for pushes and pull requests.

Browser verification should include plain title search after filtered exploration, mixed upcoming results, combined service/language/runtime filters, person lookup, continued results, canceled drafts, status changes, unknown dates, repeat-viewing edits, TV progress reload, list/favorite filters, recommendations, backup round-trip and invalid imports, concurrent-tab edits, keyboard dismissal and responsive layout.

## Structure

- `index.html` — app structure, modes, filters, and dialogs
- `style.css` — responsive light/dark layouts
- `app.js` — user flows, request ordering, forms, recommendations and insights
- `lib/discovery.js` — TMDB API client, filters, parsing and continuation
- `lib/storage.js` — durable library, schema, migration, journals and recovery
- `lib/library.js` — library search/filter/sort and viewing statistics
- `lib/app-model.js` — query planning, compact metadata, recommendation seeds and sparse edit merging
- `tests/` — regression coverage

## Credits

Data and images: [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB. Availability data is supplied by JustWatch via TMDB.
