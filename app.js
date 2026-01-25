// TMDB API Configuration
const TMDB_API_KEY = 'd954579ffe639c8a36b86cb2849c2ed1'; // Get your free API key from https://www.themoviedb.org/settings/api
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// App State
let movies = {
    watchlist: [],
    watched: []
};

// Track media type for each item
const MEDIA_TYPE_MOVIE = 'movie';
const MEDIA_TYPE_TV = 'tv';

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    loadMoviesFromStorage();
    initializeEventListeners();
    updateCounts();
    updateStats();
    loadTheme();

    // Initialize the default browse view
    initializeBrowse();

    // Show API key reminder if not set
    if (!TMDB_API_KEY) {
        showToast('⚠️ Please add your TMDB API key in app.js to search for movies!');
    }
});

// ============= Event Listeners =============

function initializeEventListeners() {
    // Navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Search
    document.getElementById('search-btn').addEventListener('click', searchMovies);
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            searchMovies();
        }
    });

    // Sort
    document.getElementById('watchlist-sort').addEventListener('change', renderWatchlist);
    document.getElementById('watched-sort').addEventListener('change', renderWatched);

    // Browse filters
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Show/hide year filter
            const yearFilter = document.getElementById('year-filter');
            if (btn.dataset.filter === 'by_year') {
                yearFilter.style.display = 'block';
            } else {
                yearFilter.style.display = 'none';
            }

            loadBrowseMovies(btn.dataset.filter);
        });
    });
    document.getElementById('genre-filter').addEventListener('change', () => loadBrowseMovies());
    document.getElementById('year-filter').addEventListener('change', () => loadBrowseMovies());
    document.getElementById('media-type-filter').addEventListener('change', async () => {
        await updateGenresForMediaType();
        loadBrowseMovies();
    });

    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

    // Modal
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('movie-modal').addEventListener('click', (e) => {
        if (e.target.id === 'movie-modal') closeModal();
    });
}

// ============= View Management =============

function switchView(viewName) {
    // Update active nav button
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    // Update active view
    document.querySelectorAll('.view').forEach(view => {
        view.classList.toggle('active', view.id === `${viewName}-view`);
    });

    // Render appropriate content
    switch(viewName) {
        case 'browse':
            initializeBrowse();
            break;
        case 'watchlist':
            renderWatchlist();
            break;
        case 'watched':
            renderWatched();
            break;
        case 'stats':
            updateStats();
            break;
    }
}

function refreshCurrentView() {
    const activeNav = document.querySelector('.nav-btn.active');
    if (!activeNav) return;

    const currentView = activeNav.dataset.view;
    switch(currentView) {
        case 'browse':
            // Check if we have search results or browse results
            const browseResults = document.getElementById('browse-results');
            if (browseResults.querySelector('.movie-grid')) {
                // Results exist - check if it's a search or browse view
                // For now, we'll just update button states by re-rendering
                // This will be handled naturally by the next search/browse
            }
            break;
        case 'watchlist':
            renderWatchlist();
            break;
        case 'watched':
            renderWatched();
            break;
        case 'stats':
            updateStats();
            break;
    }
}

// ============= TMDB API Integration =============

async function searchMovies() {
    const query = document.getElementById('search-input').value.trim();
    const mediaType = document.getElementById('media-type-filter').value;
    const resultsContainer = document.getElementById('browse-results');
    const mediaLabel = mediaType === 'tv' ? 'TV shows' : 'movies';

    if (!query) {
        showToast(`Please enter a ${mediaType === 'tv' ? 'TV show' : 'movie'} title`);
        return;
    }

    if (!TMDB_API_KEY) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔑</div>
                <div class="empty-state-text">
                    Please add your TMDB API key to search for ${mediaLabel}.<br><br>
                    Get a free API key at: <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org</a><br>
                    Then add it to the TMDB_API_KEY variable in app.js
                </div>
            </div>
        `;
        return;
    }

    resultsContainer.innerHTML = `<div class="loading"><div class="spinner"></div>Searching ${mediaLabel}...</div>`;

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/search/${mediaType}?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=1`
        );
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            renderSearchResults(data.results, mediaType, query);
        } else {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-text">No ${mediaLabel} found for "${query}"</div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <div class="empty-state-text">Error searching ${mediaLabel}. Please try again.</div>
            </div>
        `;
        showToast(`Error searching ${mediaLabel}`);
    }
}

function renderSearchResults(results, mediaType = 'movie', query = '') {
    const container = document.getElementById('browse-results');
    const mediaLabel = mediaType === 'tv' ? 'TV shows' : 'movies';

    let headerHTML = `<div style="margin-bottom: 20px; color: var(--text-secondary);">
        Search results for "${query}" - ${results.length} ${mediaLabel} found
    </div>`;

    container.innerHTML = headerHTML + '<div class="movie-grid"></div>';
    const grid = container.querySelector('.movie-grid');

    results.slice(0, 20).forEach(item => {
        const title = item.title || item.name;
        const releaseDate = item.release_date || item.first_air_date;
        const isInWatchlist = movies.watchlist.some(m => m.id === item.id && m.mediaType === mediaType);
        const isWatched = movies.watched.some(m => m.id === item.id && m.mediaType === mediaType);

        const card = document.createElement('div');
        card.className = 'movie-card';
        card.innerHTML = `
            <img
                src="${item.poster_path ? TMDB_IMAGE_BASE + item.poster_path : 'https://via.placeholder.com/500x750?text=No+Poster'}"
                alt="${title}"
                class="movie-poster"
            />
            <div class="movie-info">
                <div class="movie-title">${title}</div>
                <div class="movie-year">${releaseDate ? releaseDate.split('-')[0] : 'N/A'}</div>
                <div class="movie-actions">
                    ${!isInWatchlist && !isWatched ?
                        `<button class="btn btn-primary btn-small" onclick="addToWatchlist(${item.id}, '${mediaType}')">+ Watchlist</button>` :
                        ''}
                    ${!isWatched ?
                        `<button class="btn btn-secondary btn-small" onclick="addToWatched(${item.id}, '${mediaType}')">✓ Watched</button>` :
                        '<span style="color: var(--success); font-size: 12px;">✓ In Collection</span>'}
                </div>
            </div>
        `;

        card.querySelector('.movie-poster').addEventListener('click', () => showMediaDetail(item.id, null, mediaType));
        grid.appendChild(card);
    });
}

async function getMovieDetails(movieId) {
    if (!TMDB_API_KEY) return null;

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/movie/${movieId}?api_key=${TMDB_API_KEY}&append_to_response=credits,watch/providers,external_ids`
        );
        return await response.json();
    } catch (error) {
        console.error('Error fetching movie details:', error);
        return null;
    }
}

async function getTVDetails(tvId) {
    if (!TMDB_API_KEY) return null;

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/tv/${tvId}?api_key=${TMDB_API_KEY}&append_to_response=credits,watch/providers,external_ids`
        );
        return await response.json();
    } catch (error) {
        console.error('Error fetching TV show details:', error);
        return null;
    }
}

async function getMediaDetails(mediaId, mediaType) {
    return mediaType === 'tv' ? getTVDetails(mediaId) : getMovieDetails(mediaId);
}

// ============= Browse Movies & TV Shows =============

let movieGenresCache = null;
let tvGenresCache = null;

async function fetchGenres(mediaType = 'movie') {
    const cache = mediaType === 'tv' ? tvGenresCache : movieGenresCache;
    if (cache) return cache;

    if (!TMDB_API_KEY) return [];

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/genre/${mediaType}/list?api_key=${TMDB_API_KEY}`
        );
        const data = await response.json();
        const genres = data.genres || [];

        if (mediaType === 'tv') {
            tvGenresCache = genres;
        } else {
            movieGenresCache = genres;
        }

        return genres;
    } catch (error) {
        console.error('Error fetching genres:', error);
        return [];
    }
}

async function updateGenresForMediaType() {
    const mediaType = document.getElementById('media-type-filter').value;
    const genreFilter = document.getElementById('genre-filter');

    // Clear current options except "All Genres"
    genreFilter.innerHTML = '<option value="">All Genres</option>';

    // Load genres for the selected media type
    const genres = await fetchGenres(mediaType);
    genres.forEach(genre => {
        const option = document.createElement('option');
        option.value = genre.id;
        option.textContent = genre.name;
        genreFilter.appendChild(option);
    });
}

async function initializeBrowse() {
    // Load genres into dropdown
    const genreFilter = document.getElementById('genre-filter');

    if (genreFilter.options.length === 1) { // Only has "All Genres"
        const genres = await fetchGenres('movie'); // Default to movies
        genres.forEach(genre => {
            const option = document.createElement('option');
            option.value = genre.id;
            option.textContent = genre.name;
            genreFilter.appendChild(option);
        });
    }

    // Load years into dropdown (last 25 years)
    const yearFilter = document.getElementById('year-filter');
    if (yearFilter.options.length === 1) { // Only has "Select Year"
        const currentYear = new Date().getFullYear();
        for (let year = currentYear; year >= currentYear - 24; year--) {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            yearFilter.appendChild(option);
        }
    }

    // Load default content (popular movies)
    loadBrowseMovies('popular');
}

async function loadBrowseMovies(filter) {
    const resultsContainer = document.getElementById('browse-results');
    const activeFilter = filter || document.querySelector('.filter-btn.active').dataset.filter;
    const genreId = document.getElementById('genre-filter').value;
    const selectedYear = document.getElementById('year-filter').value;
    const mediaType = document.getElementById('media-type-filter').value;

    const mediaLabel = mediaType === 'tv' ? 'TV shows' : 'movies';

    if (!TMDB_API_KEY) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔑</div>
                <div class="empty-state-text">Please add your TMDB API key to browse ${mediaLabel}.</div>
            </div>
        `;
        return;
    }

    resultsContainer.innerHTML = `<div class="loading"><div class="spinner"></div>Loading ${mediaLabel}...</div>`;

    try {
        let results = [];

        switch(activeFilter) {
            case 'trending':
                // Trending supports both movies and TV
                const trendingUrl = `${TMDB_BASE_URL}/trending/${mediaType}/week?api_key=${TMDB_API_KEY}`;
                const trendingResponse = await fetch(trendingUrl);
                const trendingData = await trendingResponse.json();
                results = trendingData.results || [];

                // Filter by genre client-side if needed
                if (genreId) {
                    results = results.filter(item =>
                        item.genre_ids && item.genre_ids.includes(parseInt(genreId))
                    );
                }
                break;

            case 'by_year':
                if (!selectedYear) {
                    resultsContainer.innerHTML = `
                        <div class="empty-state">
                            <div class="empty-state-icon">📅</div>
                            <div class="empty-state-text">Please select a year to browse top-rated ${mediaLabel}</div>
                        </div>
                    `;
                    return;
                }

                // Fetch top 100 from the selected year with quality filtering
                // Fetch multiple pages to get top 100
                for (let page = 1; page <= 5; page++) {
                    let discoverUrl = `${TMDB_BASE_URL}/discover/${mediaType}?api_key=${TMDB_API_KEY}`;

                    // Different date fields for movies vs TV
                    if (mediaType === 'tv') {
                        discoverUrl += `&first_air_date_year=${selectedYear}`;
                        discoverUrl += `&vote_count.gte=50`; // TV shows typically have fewer votes
                    } else {
                        discoverUrl += `&primary_release_year=${selectedYear}`;
                        discoverUrl += `&vote_count.gte=200`; // Higher threshold for movies to ensure quality
                    }

                    discoverUrl += `&sort_by=vote_average.desc`;
                    discoverUrl += `&vote_average.gte=6.0`; // Only items rated 6.0 or higher
                    if (genreId) discoverUrl += `&with_genres=${genreId}`;
                    discoverUrl += `&page=${page}`;

                    const response = await fetch(discoverUrl);
                    const data = await response.json();
                    results = results.concat(data.results || []);

                    if (results.length >= 100) break;
                }
                results = results.slice(0, 100); // Take top 100
                break;

            case 'top_rated':
                // Use discover for better filtering
                let topRatedUrl = `${TMDB_BASE_URL}/discover/${mediaType}?api_key=${TMDB_API_KEY}`;
                topRatedUrl += `&sort_by=vote_average.desc`;
                topRatedUrl += mediaType === 'tv' ? `&vote_count.gte=500` : `&vote_count.gte=1000`;
                topRatedUrl += `&vote_average.gte=7.0`; // Only highly rated content
                if (genreId) topRatedUrl += `&with_genres=${genreId}`;

                const topRatedResponse = await fetch(topRatedUrl);
                const topRatedData = await topRatedResponse.json();
                results = topRatedData.results || [];
                break;

            case 'popular':
            default:
                // Use discover for consistent filtering
                let popularUrl = `${TMDB_BASE_URL}/discover/${mediaType}?api_key=${TMDB_API_KEY}`;
                popularUrl += `&sort_by=popularity.desc`;
                if (genreId) popularUrl += `&with_genres=${genreId}`;

                const popularResponse = await fetch(popularUrl);
                const popularData = await popularResponse.json();
                results = popularData.results || [];
                break;
        }

        if (results.length > 0) {
            renderBrowseResults(results, activeFilter === 'by_year' ? selectedYear : null, mediaType);
        } else {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🎬</div>
                    <div class="empty-state-text">No ${mediaLabel} found</div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Browse error:', error);
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <div class="empty-state-text">Error loading ${mediaLabel}. Please try again.</div>
            </div>
        `;
        showToast(`Error loading ${mediaLabel}`);
    }
}

function renderBrowseResults(results, year = null, mediaType = 'movie') {
    const container = document.getElementById('browse-results');
    const mediaLabel = mediaType === 'tv' ? 'TV shows' : 'movies';

    // Add header showing count and year if applicable
    let headerHTML = '';
    if (year) {
        headerHTML = `<div style="margin-bottom: 20px; color: var(--text-secondary);">
            Showing top ${results.length} ${mediaLabel} from ${year}
        </div>`;
    }

    container.innerHTML = headerHTML + '<div class="movie-grid"></div>';
    const grid = container.querySelector('.movie-grid');

    // Show all results for by_year (up to 100), otherwise limit to 20
    const displayResults = year ? results : results.slice(0, 20);

    displayResults.forEach(item => {
        // Handle both movies and TV shows (different field names)
        const title = item.title || item.name;
        const releaseDate = item.release_date || item.first_air_date;
        const isInWatchlist = movies.watchlist.some(m => m.id === item.id && m.mediaType === mediaType);
        const isWatched = movies.watched.some(m => m.id === item.id && m.mediaType === mediaType);

        const card = document.createElement('div');
        card.className = 'movie-card';
        card.innerHTML = `
            <img
                src="${item.poster_path ? TMDB_IMAGE_BASE + item.poster_path : 'https://via.placeholder.com/500x750?text=No+Poster'}"
                alt="${title}"
                class="movie-poster"
            />
            <div class="movie-info">
                <div class="movie-title">${title}</div>
                <div class="movie-year">${releaseDate ? releaseDate.split('-')[0] : 'N/A'}</div>
                <div style="margin: 5px 0; font-size: 13px; color: var(--text-secondary);">
                    ⭐ ${item.vote_average ? item.vote_average.toFixed(1) : 'N/A'}/10
                </div>
                <div class="movie-actions">
                    ${!isInWatchlist && !isWatched ?
                        `<button class="btn btn-primary btn-small" onclick="addToWatchlist(${item.id}, '${mediaType}')">+ Watchlist</button>` :
                        ''}
                    ${!isWatched ?
                        `<button class="btn btn-secondary btn-small" onclick="addToWatched(${item.id}, '${mediaType}')">✓ Watched</button>` :
                        '<span style="color: var(--success); font-size: 12px;">✓ In Collection</span>'}
                </div>
            </div>
        `;

        card.querySelector('.movie-poster').addEventListener('click', () => showMediaDetail(item.id, null, mediaType));
        grid.appendChild(card);
    });
}

// ============= Movie Management =============

async function addToWatchlist(mediaId, mediaType = 'movie') {
    if (movies.watchlist.some(m => m.id === mediaId && m.mediaType === mediaType)) {
        showToast('Already in watchlist');
        return;
    }

    // Show loading state
    showToast(`Adding to watchlist...`);

    const details = await getMediaDetails(mediaId, mediaType);
    if (!details) {
        showToast(`Error adding ${mediaType === 'tv' ? 'show' : 'movie'}`);
        return;
    }

    const item = {
        id: details.id,
        mediaType: mediaType,
        title: details.title || details.name,
        poster_path: details.poster_path,
        backdrop_path: details.backdrop_path,
        release_date: details.release_date || details.first_air_date,
        overview: details.overview,
        genres: details.genres,
        runtime: details.runtime || details.episode_run_time?.[0],
        vote_average: details.vote_average,
        tagline: details.tagline,
        cast: details.credits?.cast?.slice(0, 10) || [],
        crew: details.credits?.crew?.filter(c => c.job === 'Director' || c.job === 'Writer' || c.job === 'Producer' || c.job === 'Creator').slice(0, 5) || [],
        watchProviders: details['watch/providers']?.results?.US,
        externalIds: details.external_ids,
        addedDate: new Date().toISOString()
    };

    movies.watchlist.push(item);
    saveMoviesToStorage();
    updateCounts();
    showToast(`Added "${item.title}" to watchlist`);

    // Refresh the current view to update button states
    refreshCurrentView();
}

async function addToWatched(mediaId, mediaType = 'movie') {
    // Remove from watchlist if present
    movies.watchlist = movies.watchlist.filter(m => !(m.id === mediaId && m.mediaType === mediaType));

    if (movies.watched.some(m => m.id === mediaId && m.mediaType === mediaType)) {
        showToast('Already in watched list');
        return;
    }

    // Show loading state
    showToast(`Adding to watched list...`);

    const details = await getMediaDetails(mediaId, mediaType);
    if (!details) {
        showToast(`Error adding ${mediaType === 'tv' ? 'show' : 'movie'}`);
        return;
    }

    const item = {
        id: details.id,
        mediaType: mediaType,
        title: details.title || details.name,
        poster_path: details.poster_path,
        backdrop_path: details.backdrop_path,
        release_date: details.release_date || details.first_air_date,
        overview: details.overview,
        genres: details.genres,
        runtime: details.runtime || details.episode_run_time?.[0],
        vote_average: details.vote_average,
        tagline: details.tagline,
        cast: details.credits?.cast?.slice(0, 10) || [],
        crew: details.credits?.crew?.filter(c => c.job === 'Director' || c.job === 'Writer' || c.job === 'Producer' || c.job === 'Creator').slice(0, 5) || [],
        watchProviders: details['watch/providers']?.results?.US,
        externalIds: details.external_ids,
        watchedDate: new Date().toISOString(),
        rating: 0,
        review: ''
    };

    movies.watched.push(item);
    saveMoviesToStorage();
    updateCounts();
    updateStats();
    showToast(`Marked "${item.title}" as watched`);

    // Refresh the current view to update button states
    refreshCurrentView();
}

function moveToWatched(movieId, mediaType = 'movie') {
    const movie = movies.watchlist.find(m => m.id === movieId && m.mediaType === mediaType);
    if (!movie) return;

    movies.watchlist = movies.watchlist.filter(m => !(m.id === movieId && m.mediaType === mediaType));
    movie.watchedDate = new Date().toISOString();
    movie.rating = 0;
    movie.review = '';
    movies.watched.push(movie);

    saveMoviesToStorage();
    updateCounts();
    updateStats();
    renderWatchlist();
    showToast(`Marked "${movie.title}" as watched`);
}

function removeFromWatchlist(movieId, mediaType = 'movie') {
    const movie = movies.watchlist.find(m => m.id === movieId && m.mediaType === mediaType);
    if (!movie) return;

    // Confirm before removing
    if (!confirm(`Remove "${movie.title}" from watchlist?`)) {
        return;
    }

    movies.watchlist = movies.watchlist.filter(m => !(m.id === movieId && m.mediaType === mediaType));
    saveMoviesToStorage();
    updateCounts();
    renderWatchlist();
    showToast(`Removed "${movie.title}" from watchlist`);
}

function removeFromWatched(movieId, mediaType = 'movie') {
    const movie = movies.watched.find(m => m.id === movieId && m.mediaType === mediaType);
    if (!movie) return;

    // Confirm before removing
    if (!confirm(`Remove "${movie.title}" from watched list? This will also delete your rating.`)) {
        return;
    }

    movies.watched = movies.watched.filter(m => !(m.id === movieId && m.mediaType === mediaType));
    saveMoviesToStorage();
    updateCounts();
    updateStats();
    renderWatched();
    showToast(`Removed "${movie.title}" from watched list`);
}

function rateMovie(movieId, rating, mediaType = 'movie') {
    const movie = movies.watched.find(m => m.id === movieId && m.mediaType === mediaType);
    if (!movie) return;

    movie.rating = rating;
    saveMoviesToStorage();
    updateStats();
    showToast(`Rated "${movie.title}" ${rating}/10`);

    // Update the modal display to show the new rating immediately
    const modalRating = document.getElementById('modal-rating');
    if (modalRating) {
        // Update star display in modal
        modalRating.innerHTML = [1,2,3,4,5,6,7,8,9,10].map(i =>
            `<span class="star ${i <= rating ? 'active' : ''}" onclick="rateMovie(${movieId}, ${i}, '${mediaType}')">★</span>`
        ).join('');

        // Update rating text
        const ratingText = modalRating.parentElement.querySelector('.rating-text');
        if (ratingText) {
            ratingText.textContent = `${rating}/10`;
        }
    }

    // Refresh the watched list if we're on that view
    const activeView = document.querySelector('.nav-btn.active')?.dataset.view;
    if (activeView === 'watched') {
        renderWatched();
    }
}

// ============= Rendering Functions =============

function renderWatchlist() {
    const container = document.getElementById('watchlist-grid');
    const sortBy = document.getElementById('watchlist-sort').value;
    const clearBtn = document.getElementById('clear-watchlist-btn');

    if (movies.watchlist.length === 0) {
        clearBtn.style.display = 'none';
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <div class="empty-state-text">Your watchlist is empty. Search for movies to add!</div>
            </div>
        `;
        return;
    }

    // Show clear button when there are items
    clearBtn.style.display = 'block';

    // Sort movies
    const sorted = [...movies.watchlist].sort((a, b) => {
        switch(sortBy) {
            case 'title':
                return a.title.localeCompare(b.title);
            case 'year':
                return (b.release_date || '').localeCompare(a.release_date || '');
            case 'added':
            default:
                return new Date(b.addedDate) - new Date(a.addedDate);
        }
    });

    container.innerHTML = '';
    sorted.forEach(movie => {
        const card = createMovieCard(movie, 'watchlist');
        container.appendChild(card);
    });
}

function clearWatchlist() {
    if (movies.watchlist.length === 0) return;

    // Confirm before clearing
    if (!confirm(`Clear all ${movies.watchlist.length} items from your watchlist?`)) {
        return;
    }

    movies.watchlist = [];
    saveMoviesToStorage();
    updateCounts();
    renderWatchlist();
    showToast('Watchlist cleared');
}

function renderWatched() {
    const container = document.getElementById('watched-grid');
    const sortBy = document.getElementById('watched-sort').value;

    if (movies.watched.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎬</div>
                <div class="empty-state-text">No watched items yet. Start tracking your journey!</div>
            </div>
        `;
        return;
    }

    // Sort movies
    const sorted = [...movies.watched].sort((a, b) => {
        switch(sortBy) {
            case 'rating':
                return (b.rating || 0) - (a.rating || 0);
            case 'title':
                return a.title.localeCompare(b.title);
            case 'year':
                return (b.release_date || '').localeCompare(a.release_date || '');
            case 'date':
            default:
                return new Date(b.watchedDate) - new Date(a.watchedDate);
        }
    });

    container.innerHTML = '';
    sorted.forEach(movie => {
        const card = createMovieCard(movie, 'watched');
        container.appendChild(card);
    });
}

function createMovieCard(movie, listType) {
    const card = document.createElement('div');
    card.className = 'movie-card';

    const year = movie.release_date ? movie.release_date.split('-')[0] : 'N/A';
    const mediaType = movie.mediaType || 'movie';
    const mediaLabel = mediaType === 'tv' ? 'TV' : '';

    card.innerHTML = `
        <img
            src="${movie.poster_path ? TMDB_IMAGE_BASE + movie.poster_path : 'https://via.placeholder.com/500x750?text=No+Poster'}"
            alt="${movie.title}"
            class="movie-poster"
        />
        <div class="movie-info">
            <div class="movie-title" title="${movie.title}">${movie.title}</div>
            <div class="movie-year">${year} ${mediaLabel}</div>

            ${listType === 'watched' ? `
                <div class="rating-display">
                    ${createStarDisplay(movie.rating || 0)}
                    <span style="font-size: 13px; color: var(--text-secondary);">
                        ${movie.rating ? movie.rating.toFixed(1) : 'Not rated'}
                    </span>
                </div>
            ` : ''}

            <div class="movie-actions">
                ${listType === 'watchlist' ? `
                    <button class="btn btn-secondary btn-small" onclick="moveToWatched(${movie.id}, '${mediaType}')">✓ Watched</button>
                    <button class="btn btn-danger btn-small" onclick="removeFromWatchlist(${movie.id}, '${mediaType}')">Remove</button>
                ` : `
                    <button class="btn btn-primary btn-small" onclick="openRatingModal(${movie.id}, '${mediaType}')">Rate</button>
                    <button class="btn btn-danger btn-small" onclick="removeFromWatched(${movie.id}, '${mediaType}')">Remove</button>
                `}
            </div>
        </div>
    `;

    card.querySelector('.movie-poster').addEventListener('click', () => showMediaDetail(movie.id, listType, mediaType));
    return card;
}

function createStarDisplay(rating) {
    const fullStars = Math.floor(rating / 2);
    const halfStar = rating % 2 >= 1;
    let html = '';

    for (let i = 0; i < 5; i++) {
        if (i < fullStars) {
            html += '<span class="star active">★</span>';
        } else if (i === fullStars && halfStar) {
            html += '<span class="star active">★</span>';
        } else {
            html += '<span class="star">☆</span>';
        }
    }

    return html;
}

// ============= Movie Detail Modal =============

function showMediaDetail(mediaId, listType = null, mediaType = 'movie') {
    let item;

    if (listType === 'watchlist') {
        item = movies.watchlist.find(m => m.id === mediaId && m.mediaType === mediaType);
    } else if (listType === 'watched') {
        item = movies.watched.find(m => m.id === mediaId && m.mediaType === mediaType);
    }

    // If item not in lists, fetch from API
    if (!item) {
        getMediaDetails(mediaId, mediaType).then(details => {
            if (details) {
                // Add mediaType to the details object
                details.mediaType = mediaType;
                displayMovieModal(details, listType);
            }
        });
        return;
    }

    displayMovieModal(item, listType);
}

// Keep old function for backwards compatibility
function showMovieDetail(movieId, listType = null) {
    showMediaDetail(movieId, listType, 'movie');
}

function displayMovieModal(movie, listType) {
    const modalBody = document.getElementById('modal-body');
    const mediaType = movie.mediaType || 'movie';
    const title = movie.title || movie.name;
    const year = (movie.release_date || movie.first_air_date) ? (movie.release_date || movie.first_air_date).split('-')[0] : 'N/A';
    const runtime = movie.runtime ? `${movie.runtime} min` : 'N/A';

    // Build external links
    const tmdbLink = `https://www.themoviedb.org/${mediaType}/${movie.id}`;
    const imdbLink = movie.externalIds?.imdb_id ? `https://www.imdb.com/title/${movie.externalIds.imdb_id}` : null;

    // Build streaming providers HTML
    let streamingHTML = '';
    if (movie.watchProviders) {
        const providers = [];
        if (movie.watchProviders.flatrate) providers.push(...movie.watchProviders.flatrate);
        if (movie.watchProviders.buy) providers.push(...movie.watchProviders.buy);
        if (movie.watchProviders.rent) providers.push(...movie.watchProviders.rent);

        // Remove duplicates
        const uniqueProviders = [...new Map(providers.map(p => [p.provider_id, p])).values()];

        if (uniqueProviders.length > 0) {
            streamingHTML = `
                <div class="modal-section">
                    <strong>Where to Watch (US):</strong>
                    <div class="streaming-providers">
                        ${uniqueProviders.map(provider => `
                            <div class="provider-item" title="${provider.provider_name}">
                                <img
                                    src="${TMDB_IMAGE_BASE.replace('w500', 'w92')}${provider.logo_path}"
                                    alt="${provider.provider_name}"
                                    class="provider-logo"
                                />
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
    }

    modalBody.innerHTML = `
        <div class="modal-header">
            <img
                src="${movie.poster_path ? TMDB_IMAGE_BASE + movie.poster_path : 'https://via.placeholder.com/500x750?text=No+Poster'}"
                alt="${title}"
                class="modal-poster"
            />
            <div class="modal-info">
                <h2 class="modal-title">${title}</h2>
                <div class="modal-meta">
                    ${year} • ${runtime} ${movie.vote_average ? `• ⭐ ${movie.vote_average.toFixed(1)}/10 TMDB` : ''}
                </div>

                <div class="external-links">
                    <a href="${tmdbLink}" target="_blank" class="external-link" title="View on TMDB">
                        🎬 TMDB
                    </a>
                    ${imdbLink ? `
                        <a href="${imdbLink}" target="_blank" class="external-link" title="View on IMDb">
                            ⭐ IMDb
                        </a>
                    ` : ''}
                </div>

                ${movie.genres && movie.genres.length > 0 ? `
                    <div class="modal-genres">
                        ${movie.genres.map(g => `<span class="genre-tag">${g.name}</span>`).join('')}
                    </div>
                ` : ''}

                ${listType === 'watched' ? `
                    <div>
                        <strong>Your Rating:</strong>
                        <div class="star-rating" id="modal-rating">
                            ${[1,2,3,4,5,6,7,8,9,10].map(i =>
                                `<span class="star ${i <= (movie.rating || 0) ? 'active' : ''}" onclick="rateMovie(${movie.id}, ${i}, '${mediaType}')">★</span>`
                            ).join('')}
                        </div>
                        <div class="rating-text" style="margin-top: 5px; font-size: 14px; color: var(--text-secondary);">
                            ${movie.rating ? `${movie.rating}/10` : 'Not rated yet'}
                        </div>
                    </div>
                ` : ''}
            </div>
        </div>

        ${movie.tagline ? `
            <div class="modal-tagline">
                <em>"${movie.tagline}"</em>
            </div>
        ` : ''}

        <div class="modal-overview">
            <strong>Overview:</strong><br>
            ${movie.overview || 'No overview available.'}
        </div>

        ${streamingHTML}

        ${movie.crew && movie.crew.length > 0 ? `
            <div class="modal-section">
                <strong>Crew:</strong>
                <div class="crew-list">
                    ${movie.crew.map(person => `
                        <div class="crew-item">
                            <span class="crew-name">${person.name}</span>
                            <span class="crew-role">${person.job}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}

        ${movie.cast && movie.cast.length > 0 ? `
            <div class="modal-section">
                <strong>Cast:</strong>
                <div class="cast-list">
                    ${movie.cast.map(actor => `
                        <div class="cast-item">
                            ${actor.profile_path ? `
                                <img
                                    src="${TMDB_IMAGE_BASE.replace('w500', 'w185')}${actor.profile_path}"
                                    alt="${actor.name}"
                                    class="cast-photo"
                                />
                            ` : `<div class="cast-photo-placeholder">👤</div>`}
                            <div class="cast-info">
                                <div class="cast-name">${actor.name}</div>
                                <div class="cast-character">${actor.character || 'Unknown'}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}
    `;

    const modal = document.getElementById('movie-modal');
    modal.classList.add('active');

    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
}

function openRatingModal(movieId, mediaType = 'movie') {
    showMediaDetail(movieId, 'watched', mediaType);
}

function closeModal() {
    document.getElementById('movie-modal').classList.remove('active');

    // Restore body scroll
    document.body.style.overflow = '';

    // Refresh the current view to show updated ratings
    const activeView = document.querySelector('.nav-btn.active').dataset.view;
    if (activeView === 'watched') renderWatched();
}

// ============= Statistics =============

function updateStats() {
    const totalMovies = movies.watchlist.length + movies.watched.length;
    const totalWatched = movies.watched.length;

    // Calculate average rating
    const ratedMovies = movies.watched.filter(m => m.rating > 0);
    const avgRating = ratedMovies.length > 0
        ? (ratedMovies.reduce((sum, m) => sum + m.rating, 0) / ratedMovies.length).toFixed(1)
        : '0';

    // Calculate total hours
    const totalMinutes = movies.watched.reduce((sum, m) => sum + (m.runtime || 0), 0);
    const totalHours = Math.round(totalMinutes / 60);

    // Update stat cards
    document.getElementById('total-movies').textContent = totalMovies;
    document.getElementById('total-watched').textContent = totalWatched;
    document.getElementById('avg-rating').textContent = avgRating;
    document.getElementById('total-hours').textContent = totalHours;

    // Top rated movies
    renderTopRated();

    // Genre statistics
    renderGenreStats();
}

function renderTopRated() {
    const container = document.getElementById('top-rated-list');
    const topMovies = [...movies.watched]
        .filter(m => m.rating > 0)
        .sort((a, b) => b.rating - a.rating)
        .slice(0, 5);

    if (topMovies.length === 0) {
        container.innerHTML = '<div class="empty-state-text">No rated items yet</div>';
        return;
    }

    container.innerHTML = topMovies.map(movie => `
        <div class="top-movie-item">
            <span class="top-movie-title">${movie.title}</span>
            <span style="color: #fbbf24; font-weight: 600;">${movie.rating}/10 ★</span>
        </div>
    `).join('');
}

function renderGenreStats() {
    const container = document.getElementById('genre-list');
    const genreCount = {};

    movies.watched.forEach(movie => {
        if (movie.genres) {
            movie.genres.forEach(genre => {
                genreCount[genre.name] = (genreCount[genre.name] || 0) + 1;
            });
        }
    });

    if (Object.keys(genreCount).length === 0) {
        container.innerHTML = '<div class="empty-state-text">No genre data yet</div>';
        return;
    }

    const sortedGenres = Object.entries(genreCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const maxCount = sortedGenres[0][1];

    container.innerHTML = sortedGenres.map(([genre, count]) => `
        <div class="genre-item">
            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                <strong>${genre}</strong>
                <span>${count} ${count === 1 ? 'item' : 'items'}</span>
            </div>
            <div class="genre-bar">
                <div class="genre-bar-fill" style="width: ${(count / maxCount) * 100}%"></div>
            </div>
        </div>
    `).join('');
}

// ============= Local Storage =============

function saveMoviesToStorage() {
    localStorage.setItem('movieTrackerData', JSON.stringify(movies));
}

function loadMoviesFromStorage() {
    const stored = localStorage.getItem('movieTrackerData');
    if (stored) {
        movies = JSON.parse(stored);
    }
}

function updateCounts() {
    document.getElementById('watchlist-count').textContent = movies.watchlist.length;
    document.getElementById('watched-count').textContent = movies.watched.length;
}

// ============= Theme =============

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);

    const icon = document.querySelector('.theme-icon');
    icon.textContent = newTheme === 'dark' ? '☀️' : '🌙';
}

function loadTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const icon = document.querySelector('.theme-icon');
    icon.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
}

// ============= Toast Notifications =============

function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
