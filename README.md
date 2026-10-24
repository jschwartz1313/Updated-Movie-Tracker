# Movie Tracker

A buildless movie and TV tracker with TMDB discovery and a browser-local viewing journal.

**Live:** [Movie Tracker](https://jschwartz1313.github.io/Updated-Movie-Tracker/)

## Find something to watch

Type a title or an explicit discovery request, for example:

- `top 50 animated movies since 2000`
- `best 25 sci-fi movies between 2000 and 2010`
- `best sci-fi movies of the 2010s`
- `top rated TV shows since 2015`

Requests are translated into the visible type, genre, inclusive year range, ranking, vote threshold, and result count. Adjust any filter directly. Unsupported phrases stay title searches; the app does not invent filters or recommendations with an AI model.

Highest-rated discovery uses TMDB's global `vote_average.desc` order, with a default minimum of 500 votes, and retrieves additional pages to fill the requested count (up to 200). “Top” means TMDB community rating under the displayed filters; it is not a critic ranking. Popularity and weekly trending use TMDB's own rankings. Future-dated releases are excluded. Hidden titles are skipped and backfilled from later pages.

Title search follows TMDB relevance and honors media type, genre, and date filters. Votes and sorting apply to ranked discovery, so those controls are disabled during title searches. A scan is limited to 25 pages; incomplete results are clearly labeled. Results and filters can be bookmarked or shared through the URL.

## Keep a reliable record

- Save a watchlist, log watched movies and TV series, and edit personal ratings (1–10, in half-point steps), date watched, and notes.
- Changing status preserves your personal record. Movies and TV series with the same numeric TMDB identifier remain separate.
- Filter or search your own collection, explore official movie collections, and check US streaming/rental/purchase availability via JustWatch through TMDB.
- See suggestions based on watched titles you rated at least 7, or have not rated. Titles already saved or hidden are excluded.
- Insights distinguish your personal ratings from TMDB community ratings. Film hours count known movie runtimes once and exclude TV-series runtimes.
- Export a JSON backup under **Your data**. Import merges records, preserving existing ratings and notes. Removal and hiding offer one-step Undo.

## Storage and compatibility

The app keeps the original `movieTrackerData`, `hiddenItems`, and `theme` localStorage keys. Existing valid records are loaded without rewriting them. Legacy `review`, `addedDate`, and ISO watched dates are supported. New records use the version 2 schema, with hidden IDs included in the same atomic library write.

The app confirms saves only after the canonical data is written successfully. Invalid imports are rejected before any changes. Damaged existing data is salvaged where possible, with a warning, and the original text is copied to a recovery key before a later edit replaces it. Storage failures and conflicting changes from another tab are reported without erasing the previous library.

**Data stays in this browser on this device. There is no account or automatic cross-device synchronization.** Export backups before clearing site data or switching browsers. Private browsing may discard records when its window closes. Metadata searches and availability checks contact TMDB; notes and ratings are not uploaded. The existing public TMDB API key is retained for compatibility with static GitHub Pages hosting.

## Run locally

Serve the directory over HTTP; ES modules require a web server rather than opening `index.html` directly:

```sh
python3 -m http.server 4173 --bind 127.0.0.1
```

Open `http://127.0.0.1:4173/`. No dependencies or build step are needed. The API key is configured in `lib/discovery.js`.

## Verify changes

Requires Node.js 22 or later for the built-in test runner:

```sh
npm test
npm run check
```

Tests cover query parsing, API filter parameters and pagination, hidden-title backfilling, HTTP errors, partial results, timeouts, cancellation, legacy migration, status changes, duplicates, quota failure, recovery, import validation, export, undo, and cross-tab conflicts. GitHub Actions runs these checks for pushes and pull requests.

Browser checks should cover title and natural-language searches, quick consecutive searches, movie/TV switching, watchlist → watched → rating/notes/date → reload, status changes, backup round-trip, collections, providers, keyboard dismissal, and mobile layout.

## Structure

- `index.html` — accessible app structure and forms
- `style.css` — responsive light and dark themes
- `app.js` — UI, request ordering, records, details, recommendations and insights
- `lib/discovery.js` — TMDB client, explicit query parsing and ranked pagination
- `lib/storage.js` — durable library, migration, validation, backup and recovery
- `tests/` — dependency-free regression tests

## Credits

Data and images are provided by [TMDB](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB. Availability data is supplied by JustWatch via TMDB.
