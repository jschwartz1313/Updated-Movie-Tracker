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

// Track current browse/search state for re-rendering
let currentBrowseState = {
    mode: 'browse', // 'browse' or 'search'
    results: [],
    mediaType: 'movie',
    query: '',
    year: null
};

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

    // Sort and Filters
    document.getElementById('watchlist-sort').addEventListener('change', renderWatchlist);
    document.getElementById('watched-sort').addEventListener('change', renderWatched);

    // Watchlist filters and search
    document.getElementById('watchlist-type-filter').addEventListener('change', renderWatchlist);
    document.getElementById('watchlist-genre-filter').addEventListener('change', renderWatchlist);
    document.getElementById('watchlist-search').addEventListener('input', renderWatchlist);

    // Watched filters and search
    document.getElementById('watched-type-filter').addEventListener('change', renderWatched);
    document.getElementById('watched-genre-filter').addEventListener('change', renderWatched);
    document.getElementById('watched-rating-filter').addEventListener('change', renderWatched);
    document.getElementById('watched-search').addEventListener('input', renderWatched);

    // Recommendations filter
    document.getElementById('rec-type-filter').addEventListener('change', renderRecommendationsGrid);

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
        case 'recommendations':
            loadRecommendations();
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
            // Re-render from stored state (no API call needed)
            if (currentBrowseState.results.length > 0) {
                if (currentBrowseState.mode === 'search') {
                    renderSearchGrid(
                        currentBrowseState.results,
                        currentBrowseState.query,
                        currentBrowseState.collections || []
                    );
                } else if (currentBrowseState.mode === 'collection') {
                    // Re-load collection to refresh button states
                    loadCollection(currentBrowseState.collectionId);
                } else {
                    renderBrowseGrid(
                        currentBrowseState.results,
                        currentBrowseState.mediaType,
                        currentBrowseState.query,
                        currentBrowseState.year
                    );
                }
            }
            break;
        case 'watchlist':
            renderWatchlist();
            break;
        case 'watched':
            renderWatched();
            break;
        case 'recommendations':
            renderRecommendationsGrid();
            break;
        case 'stats':
            updateStats();
            break;
    }
}

// ============= TMDB API Integration =============

// Franchise keyword mapping - search these additional terms for better collection results
const FRANCHISE_KEYWORDS = {
    'marvel': ['Avengers', 'Iron Man', 'Thor', 'Captain America', 'Spider-Man', 'Guardians of the Galaxy', 'Black Panther', 'Ant-Man', 'Doctor Strange', 'X-Men', 'Deadpool', 'Hulk', 'Black Widow', 'Hawkeye', 'Loki', 'Eternals', 'Shang-Chi'],
    'mcu': ['Avengers', 'Iron Man', 'Thor', 'Captain America', 'Spider-Man', 'Guardians of the Galaxy', 'Black Panther', 'Ant-Man', 'Doctor Strange', 'Eternals', 'Shang-Chi'],
    'star wars': ['Star Wars', 'Mandalorian', 'Obi-Wan', 'Boba Fett', 'Andor', 'Ahsoka', 'Clone Wars', 'Bad Batch', 'Rogue One', 'Solo'],
    'starwars': ['Star Wars', 'Mandalorian', 'Obi-Wan', 'Boba Fett', 'Andor', 'Ahsoka', 'Clone Wars', 'Bad Batch'],
    'dc': ['Batman', 'Superman', 'Wonder Woman', 'Justice League', 'Aquaman', 'The Flash', 'Suicide Squad', 'Shazam', 'Black Adam', 'Joker', 'Harley Quinn', 'Peacemaker'],
    'dceu': ['Batman', 'Superman', 'Wonder Woman', 'Justice League', 'Aquaman', 'Shazam', 'Black Adam'],
    'pixar': ['Toy Story', 'Finding Nemo', 'Finding Dory', 'The Incredibles', 'Cars', 'Monsters, Inc', 'Monsters University', 'Up', 'Wall-E', 'Coco', 'Inside Out', 'Soul', 'Luca', 'Turning Red', 'Elemental', 'Ratatouille', 'Brave'],
    'disney': ['Frozen', 'Moana', 'Tangled', 'Encanto', 'Zootopia', 'Big Hero 6', 'Wreck-It Ralph', 'Lion King', 'Aladdin', 'Little Mermaid', 'Beauty and the Beast'],
    'harry potter': ['Harry Potter', 'Fantastic Beasts', 'Hogwarts'],
    'wizarding world': ['Harry Potter', 'Fantastic Beasts'],
    'lord of the rings': ['Lord of the Rings', 'The Hobbit', 'Rings of Power'],
    'lotr': ['Lord of the Rings', 'The Hobbit', 'Rings of Power'],
    'tolkien': ['Lord of the Rings', 'The Hobbit', 'Rings of Power'],
    'fast and furious': ['Fast & Furious', 'Fast and Furious', 'Furious'],
    'fast & furious': ['Fast & Furious', 'Fast and Furious', 'Furious'],
    'jurassic': ['Jurassic Park', 'Jurassic World'],
    'jurassic park': ['Jurassic Park', 'Jurassic World'],
    'transformers': ['Transformers', 'Bumblebee'],
    'mission impossible': ['Mission: Impossible', 'Mission Impossible'],
    'james bond': ['James Bond', '007'],
    'bond': ['James Bond', '007'],
    '007': ['James Bond', '007'],
    'john wick': ['John Wick'],
    'matrix': ['The Matrix', 'Matrix'],
    'indiana jones': ['Indiana Jones'],
    'pirates': ['Pirates of the Caribbean'],
    'pirates of the caribbean': ['Pirates of the Caribbean'],
    'shrek': ['Shrek', 'Puss in Boots'],
    'dreamworks': ['Shrek', 'How to Train Your Dragon', 'Kung Fu Panda', 'Madagascar', 'Trolls', 'Boss Baby'],
    'despicable me': ['Despicable Me', 'Minions'],
    'minions': ['Despicable Me', 'Minions'],
    'kung fu panda': ['Kung Fu Panda'],
    'how to train your dragon': ['How to Train Your Dragon'],
    'planet of the apes': ['Planet of the Apes', 'Apes'],
    'alien': ['Alien', 'Aliens', 'Prometheus', 'Covenant'],
    'predator': ['Predator', 'Prey'],
    'terminator': ['Terminator'],
    'rocky': ['Rocky', 'Creed'],
    'creed': ['Rocky', 'Creed'],
    'godzilla': ['Godzilla', 'Kong', 'Monsterverse'],
    'monsterverse': ['Godzilla', 'Kong'],
    'conjuring': ['Conjuring', 'Annabelle', 'Nun'],
    'horror': ['Conjuring', 'Insidious', 'Paranormal Activity', 'Scream', 'Halloween'],
    'scream': ['Scream'],
    'halloween': ['Halloween', 'Michael Myers'],
    'nightmare': ['Nightmare on Elm Street', 'Freddy'],
    'friday the 13th': ['Friday the 13th', 'Jason'],
    'saw': ['Saw', 'Jigsaw'],
    'purge': ['Purge'],
    'trek': ['Star Trek'],
    'star trek': ['Star Trek'],
    'avatar': ['Avatar'],
    'hunger games': ['Hunger Games', 'Mockingjay', 'Catching Fire'],
    'twilight': ['Twilight', 'Breaking Dawn', 'New Moon', 'Eclipse'],
    'maze runner': ['Maze Runner'],
    'divergent': ['Divergent', 'Insurgent', 'Allegiant']
};

async function searchMovies() {
    const query = document.getElementById('search-input').value.trim();
    const mediaTypeFilter = document.getElementById('media-type-filter').value;
    const resultsContainer = document.getElementById('browse-results');

    if (!query) {
        showToast('Please enter a search term');
        return;
    }

    if (!TMDB_API_KEY) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔑</div>
                <div class="empty-state-text">
                    Please add your TMDB API key to search.<br><br>
                    Get a free API key at: <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org</a><br>
                    Then add it to the TMDB_API_KEY variable in app.js
                </div>
            </div>
        `;
        return;
    }

    resultsContainer.innerHTML = `<div class="loading"><div class="spinner"></div>Searching...</div>`;

    try {
        // Check if query matches a franchise keyword
        const queryLower = query.toLowerCase();
        const franchiseTerms = FRANCHISE_KEYWORDS[queryLower] || [];
        const isFranchiseSearch = franchiseTerms.length > 0;

        // Build collection search promises - use franchise terms for comprehensive collection finding
        const collectionSearchTerms = [query, ...franchiseTerms];
        const uniqueCollectionTerms = [...new Set(collectionSearchTerms)];

        const collectionPromises = uniqueCollectionTerms.map(term =>
            fetch(`${TMDB_BASE_URL}/search/collection?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(term)}&page=1`)
                .then(r => r.json())
        );

        // For movie/TV search, only search the original query (multiple pages for better coverage)
        const searchPromises = [];
        const pagesToFetch = isFranchiseSearch ? 3 : 2;
        for (let page = 1; page <= pagesToFetch; page++) {
            searchPromises.push(
                fetch(`${TMDB_BASE_URL}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=${page}`)
                    .then(r => r.json())
            );
        }

        // Fetch all searches and collections in parallel
        const [collectionResults, searchResults] = await Promise.all([
            Promise.all(collectionPromises),
            Promise.all(searchPromises)
        ]);

        // Merge all collection results and remove duplicates
        const allCollections = [];
        const seenCollectionIds = new Set();
        collectionResults.forEach(data => {
            (data.results || []).forEach(collection => {
                if (!seenCollectionIds.has(collection.id)) {
                    seenCollectionIds.add(collection.id);
                    allCollections.push(collection);
                }
            });
        });

        // Merge search results and remove duplicates
        const seenIds = new Set();
        let allResults = [];
        searchResults.forEach(data => {
            (data.results || []).forEach(item => {
                const uniqueKey = `${item.media_type}-${item.id}`;
                if (!seenIds.has(uniqueKey) && item.media_type !== 'person') {
                    seenIds.add(uniqueKey);
                    allResults.push(item);
                }
            });
        });

        // Filter results based on media type selection
        let results = allResults.filter(item => {
            if (mediaTypeFilter === 'movie') return item.media_type === 'movie';
            if (mediaTypeFilter === 'tv') return item.media_type === 'tv';
            return true;
        });

        // Add media_type to each result if not present
        results = results.map(item => ({
            ...item,
            mediaType: item.media_type || 'movie'
        }));

        // Sort results by popularity for better ordering
        results.sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

        if (results.length > 0 || allCollections.length > 0) {
            renderSearchResults(results, mediaTypeFilter, query, allCollections);
        } else {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-text">No results found for "${query}"</div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <div class="empty-state-text">Error searching. Please try again.</div>
            </div>
        `;
        showToast('Error searching');
    }
}

function renderSearchResults(results, mediaType = 'movie', query = '', collections = []) {
    // Store current state for re-rendering
    currentBrowseState = {
        mode: 'search',
        results: results,
        mediaType: mediaType,
        query: query,
        year: null,
        collections: collections
    };

    renderSearchGrid(results, query, collections);
}

function renderSearchGrid(results, query, collections = []) {
    const container = document.getElementById('browse-results');

    let html = `<div style="margin-bottom: 20px; color: var(--text-secondary);">
        Search results for "${query}" - ${results.length} items found
    </div>`;

    // Show collections if any
    if (collections.length > 0) {
        html += `
            <div class="collections-section" style="margin-bottom: 30px;">
                <h3 style="margin-bottom: 15px; color: var(--text-primary);">Collections & Franchises</h3>
                <div class="collections-grid" style="display: flex; gap: 15px; flex-wrap: wrap;">
                    ${collections.slice(0, 20).map(collection => `
                        <div class="collection-card" onclick="loadCollection(${collection.id})" style="
                            cursor: pointer;
                            background: var(--bg-card);
                            border: 1px solid var(--border);
                            border-radius: 12px;
                            padding: 15px;
                            display: flex;
                            align-items: center;
                            gap: 12px;
                            transition: all 0.2s;
                            min-width: 250px;
                        ">
                            ${collection.poster_path ?
                                `<img src="${TMDB_IMAGE_BASE.replace('w500', 'w92')}${collection.poster_path}"
                                    alt="${collection.name}"
                                    style="width: 50px; height: 75px; object-fit: cover; border-radius: 6px;">` :
                                `<div style="width: 50px; height: 75px; background: var(--bg-secondary); border-radius: 6px; display: flex; align-items: center; justify-content: center;">🎬</div>`
                            }
                            <div>
                                <div style="font-weight: 600; color: var(--text-primary);">${collection.name}</div>
                                <div style="font-size: 12px; color: var(--accent);">View all movies →</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    html += '<div class="movie-grid"></div>';
    container.innerHTML = html;

    const grid = container.querySelector('.movie-grid');

    results.slice(0, 60).forEach(item => {
        const mediaType = item.media_type || item.mediaType || 'movie';
        const title = item.title || item.name;
        const releaseDate = item.release_date || item.first_air_date;
        const isInWatchlist = movies.watchlist.some(m => m.id === item.id && (m.mediaType || 'movie') === mediaType);
        const isWatched = movies.watched.some(m => m.id === item.id && (m.mediaType || 'movie') === mediaType);

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
                <div class="movie-year">${releaseDate ? releaseDate.split('-')[0] : 'N/A'} ${mediaType === 'tv' ? '• TV' : ''}</div>
                ${item.vote_average ? `<div style="margin: 5px 0; font-size: 13px; color: var(--text-secondary);">⭐ ${item.vote_average.toFixed(1)}/10</div>` : ''}
                <div class="movie-actions">
                    ${!isInWatchlist && !isWatched ?
                        `<button class="btn btn-primary btn-small" onclick="event.stopPropagation(); addToWatchlist(${item.id}, '${mediaType}')">+ Watchlist</button>` :
                        ''}
                    ${!isWatched ?
                        `<button class="btn btn-secondary btn-small" onclick="event.stopPropagation(); addToWatched(${item.id}, '${mediaType}')">✓ Watched</button>` :
                        '<span style="color: var(--success); font-size: 12px;">✓ In Collection</span>'}
                </div>
                <button class="btn btn-small streaming-btn" onclick="event.stopPropagation(); showStreamingInfo(${item.id}, '${mediaType}')" style="margin-top: 8px; width: 100%; background: var(--bg-secondary); border: 1px solid var(--border);">
                    📺 Where to Watch
                </button>
            </div>
        `;

        card.querySelector('.movie-poster').addEventListener('click', () => showMediaDetail(item.id, null, mediaType));
        grid.appendChild(card);
    });
}

function renderBrowseGrid(results, mediaType, query = null, year = null) {
    const container = document.getElementById('browse-results');
    const mediaLabel = mediaType === 'tv' ? 'TV shows' : 'movies';

    let headerHTML = '';
    if (query) {
        headerHTML = `<div style="margin-bottom: 20px; color: var(--text-secondary);">
            Search results for "${query}" - ${results.length} ${mediaLabel} found
        </div>`;
    } else if (year) {
        headerHTML = `<div style="margin-bottom: 20px; color: var(--text-secondary);">
            Showing top ${results.length} ${mediaLabel} from ${year}
        </div>`;
    }

    container.innerHTML = headerHTML + '<div class="movie-grid"></div>';
    const grid = container.querySelector('.movie-grid');

    const displayResults = (year || query) ? results : results.slice(0, 20);

    displayResults.forEach(item => {
        const title = item.title || item.name;
        const releaseDate = item.release_date || item.first_air_date;
        const isInWatchlist = movies.watchlist.some(m => m.id === item.id && (m.mediaType || 'movie') === mediaType);
        const isWatched = movies.watched.some(m => m.id === item.id && (m.mediaType || 'movie') === mediaType);

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
                ${item.vote_average ? `<div style="margin: 5px 0; font-size: 13px; color: var(--text-secondary);">⭐ ${item.vote_average.toFixed(1)}/10</div>` : ''}
                <div class="movie-actions">
                    ${!isInWatchlist && !isWatched ?
                        `<button class="btn btn-primary btn-small" onclick="event.stopPropagation(); addToWatchlist(${item.id}, '${mediaType}')">+ Watchlist</button>` :
                        ''}
                    ${!isWatched ?
                        `<button class="btn btn-secondary btn-small" onclick="event.stopPropagation(); addToWatched(${item.id}, '${mediaType}')">✓ Watched</button>` :
                        '<span style="color: var(--success); font-size: 12px;">✓ In Collection</span>'}
                </div>
                <button class="btn btn-small streaming-btn" onclick="event.stopPropagation(); showStreamingInfo(${item.id}, '${mediaType}')" style="margin-top: 8px; width: 100%; background: var(--bg-secondary); border: 1px solid var(--border);">
                    📺 Where to Watch
                </button>
            </div>
        `;

        card.querySelector('.movie-poster').addEventListener('click', () => showMediaDetail(item.id, null, mediaType));
        grid.appendChild(card);
    });
}

// Show streaming info in a popup
async function showStreamingInfo(mediaId, mediaType) {
    showToast('Loading streaming info...');

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/${mediaType}/${mediaId}/watch/providers?api_key=${TMDB_API_KEY}`
        );
        const data = await response.json();
        const usProviders = data.results?.US;

        if (!usProviders) {
            showToast('No streaming info available for US');
            return;
        }

        const providers = [];
        if (usProviders.flatrate) providers.push(...usProviders.flatrate.map(p => ({ ...p, type: 'Stream' })));
        if (usProviders.rent) providers.push(...usProviders.rent.map(p => ({ ...p, type: 'Rent' })));
        if (usProviders.buy) providers.push(...usProviders.buy.map(p => ({ ...p, type: 'Buy' })));

        // Remove duplicates
        const uniqueProviders = [...new Map(providers.map(p => [p.provider_id, p])).values()];

        if (uniqueProviders.length === 0) {
            showToast('No streaming options available');
            return;
        }

        // Show in a modal-like overlay
        showStreamingModal(uniqueProviders, usProviders.link);
    } catch (error) {
        console.error('Error fetching streaming info:', error);
        showToast('Error loading streaming info');
    }
}

function showStreamingModal(providers, justWatchLink) {
    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'streaming-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1001;
    `;

    const streamProviders = providers.filter(p => p.type === 'Stream');
    const rentProviders = providers.filter(p => p.type === 'Rent');
    const buyProviders = providers.filter(p => p.type === 'Buy');

    // Helper to create provider item (non-clickable, just displays the provider)
    const createProviderItem = (p) => {
        return `
            <div style="text-align: center;">
                <img src="${TMDB_IMAGE_BASE.replace('w500', 'w92')}${p.logo_path}"
                    alt="${p.provider_name}"
                    title="${p.provider_name}"
                    style="width: 50px; height: 50px; border-radius: 10px; border: 2px solid var(--border);">
                <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${p.provider_name}</div>
            </div>
        `;
    };

    overlay.innerHTML = `
        <div style="
            background: var(--bg-card);
            border-radius: 16px;
            padding: 25px;
            max-width: 500px;
            width: 90%;
            max-height: 80vh;
            overflow-y: auto;
        ">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                <h3 style="color: var(--text-primary); margin: 0;">Where to Watch (US)</h3>
                <button onclick="this.closest('.streaming-overlay').remove()" style="
                    background: none;
                    border: none;
                    font-size: 24px;
                    cursor: pointer;
                    color: var(--text-secondary);
                ">&times;</button>
            </div>

            ${streamProviders.length > 0 ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="color: var(--text-secondary); font-size: 14px; margin-bottom: 10px;">Stream</h4>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        ${streamProviders.map(p => createProviderItem(p)).join('')}
                    </div>
                </div>
            ` : ''}

            ${rentProviders.length > 0 ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="color: var(--text-secondary); font-size: 14px; margin-bottom: 10px;">Rent</h4>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        ${rentProviders.slice(0, 6).map(p => createProviderItem(p)).join('')}
                    </div>
                </div>
            ` : ''}

            ${buyProviders.length > 0 ? `
                <div style="margin-bottom: 20px;">
                    <h4 style="color: var(--text-secondary); font-size: 14px; margin-bottom: 10px;">Buy</h4>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                        ${buyProviders.slice(0, 6).map(p => createProviderItem(p)).join('')}
                    </div>
                </div>
            ` : ''}

            ${justWatchLink ? `
                <a href="${justWatchLink}" target="_blank" class="btn btn-primary" style="width: 100%; text-align: center; display: block; text-decoration: none;">
                    🔗 Open on JustWatch to Watch
                </a>
                <p style="font-size: 11px; color: var(--text-secondary); margin-top: 10px; text-align: center;">
                    JustWatch will link you directly to the streaming service
                </p>
            ` : ''}
        </div>
    `;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}

async function loadCollection(collectionId) {
    const resultsContainer = document.getElementById('browse-results');
    resultsContainer.innerHTML = `<div class="loading"><div class="spinner"></div>Loading collection...</div>`;

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/collection/${collectionId}?api_key=${TMDB_API_KEY}`
        );
        const collection = await response.json();

        if (collection.parts && collection.parts.length > 0) {
            // Sort by release date
            const sortedParts = collection.parts.sort((a, b) =>
                (a.release_date || '').localeCompare(b.release_date || '')
            );

            // Store state for re-rendering
            currentBrowseState = {
                mode: 'collection',
                results: sortedParts,
                mediaType: 'movie',
                query: collection.name,
                year: null,
                collections: [],
                collectionId: collectionId
            };

            // Render with collection header
            let html = `
                <div style="margin-bottom: 20px;">
                    <button class="btn btn-secondary btn-small" onclick="searchMovies()" style="margin-bottom: 15px;">← Back to search</button>
                    <h3 style="color: var(--text-primary);">${collection.name}</h3>
                    <p style="color: var(--text-secondary);">${collection.parts.length} movies in this collection</p>
                </div>
            `;
            html += '<div class="movie-grid"></div>';
            resultsContainer.innerHTML = html;

            const grid = resultsContainer.querySelector('.movie-grid');
            sortedParts.forEach(item => {
                const isInWatchlist = movies.watchlist.some(m => m.id === item.id && (m.mediaType || 'movie') === 'movie');
                const isWatched = movies.watched.some(m => m.id === item.id && (m.mediaType || 'movie') === 'movie');

                const card = document.createElement('div');
                card.className = 'movie-card';
                card.innerHTML = `
                    <img
                        src="${item.poster_path ? TMDB_IMAGE_BASE + item.poster_path : 'https://via.placeholder.com/500x750?text=No+Poster'}"
                        alt="${item.title}"
                        class="movie-poster"
                    />
                    <div class="movie-info">
                        <div class="movie-title">${item.title}</div>
                        <div class="movie-year">${item.release_date ? item.release_date.split('-')[0] : 'N/A'}</div>
                        ${item.vote_average ? `<div style="margin: 5px 0; font-size: 13px; color: var(--text-secondary);">⭐ ${item.vote_average.toFixed(1)}/10</div>` : ''}
                        <div class="movie-actions">
                            ${!isInWatchlist && !isWatched ?
                                `<button class="btn btn-primary btn-small" onclick="event.stopPropagation(); addToWatchlist(${item.id}, 'movie')">+ Watchlist</button>` :
                                ''}
                            ${!isWatched ?
                                `<button class="btn btn-secondary btn-small" onclick="event.stopPropagation(); addToWatched(${item.id}, 'movie')">✓ Watched</button>` :
                                '<span style="color: var(--success); font-size: 12px;">✓ In Collection</span>'}
                        </div>
                        <button class="btn btn-small streaming-btn" onclick="event.stopPropagation(); showStreamingInfo(${item.id}, 'movie')" style="margin-top: 8px; width: 100%; background: var(--bg-secondary); border: 1px solid var(--border);">
                            📺 Where to Watch
                        </button>
                    </div>
                `;

                card.querySelector('.movie-poster').addEventListener('click', () => showMediaDetail(item.id, null, 'movie'));
                grid.appendChild(card);
            });
        }
    } catch (error) {
        console.error('Error loading collection:', error);
        showToast('Error loading collection');
    }
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
    // Store current state for re-rendering
    currentBrowseState = {
        mode: 'browse',
        results: results,
        mediaType: mediaType,
        query: null,
        year: year
    };

    renderBrowseGrid(results, mediaType, null, year);
}

// ============= Movie Management =============

async function addToWatchlist(mediaId, mediaType = 'movie') {
    if (movies.watchlist.some(m => m.id === mediaId && (m.mediaType || 'movie') === mediaType)) {
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
    movies.watchlist = movies.watchlist.filter(m => !(m.id === mediaId && (m.mediaType || 'movie') === mediaType));

    if (movies.watched.some(m => m.id === mediaId && (m.mediaType || 'movie') === mediaType)) {
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
    // Use fallback comparison to handle items without mediaType
    const movie = movies.watchlist.find(m => m.id === movieId && (m.mediaType || 'movie') === mediaType);
    if (!movie) {
        console.log('Movie not found in watchlist:', movieId, mediaType);
        return;
    }

    movies.watchlist = movies.watchlist.filter(m => !(m.id === movieId && (m.mediaType || 'movie') === mediaType));
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
    const movie = movies.watchlist.find(m => m.id === movieId && (m.mediaType || 'movie') === mediaType);
    if (!movie) return;

    // Confirm before removing
    if (!confirm(`Remove "${movie.title}" from watchlist?`)) {
        return;
    }

    movies.watchlist = movies.watchlist.filter(m => !(m.id === movieId && (m.mediaType || 'movie') === mediaType));
    saveMoviesToStorage();
    updateCounts();
    renderWatchlist();
    showToast(`Removed "${movie.title}" from watchlist`);
}

function removeFromWatched(movieId, mediaType = 'movie') {
    const movie = movies.watched.find(m => m.id === movieId && (m.mediaType || 'movie') === mediaType);
    if (!movie) return;

    // Confirm before removing
    if (!confirm(`Remove "${movie.title}" from watched list? This will also delete your rating.`)) {
        return;
    }

    movies.watched = movies.watched.filter(m => !(m.id === movieId && (m.mediaType || 'movie') === mediaType));
    saveMoviesToStorage();
    updateCounts();
    updateStats();
    renderWatched();
    showToast(`Removed "${movie.title}" from watched list`);
}

function rateMovie(movieId, rating, mediaType = 'movie') {
    const movie = movies.watched.find(m => m.id === movieId && (m.mediaType || 'movie') === mediaType);
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
    const typeFilter = document.getElementById('watchlist-type-filter').value;
    const genreFilter = document.getElementById('watchlist-genre-filter').value;
    const searchQuery = document.getElementById('watchlist-search').value.trim().toLowerCase();
    const clearBtn = document.getElementById('clear-watchlist-btn');

    // Populate genre filter dropdown based on items in watchlist
    populateGenreFilter('watchlist-genre-filter', movies.watchlist);

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

    // Apply filters
    let filtered = [...movies.watchlist];

    // Search filter
    if (searchQuery) {
        filtered = filtered.filter(m => {
            const title = (m.title || '').toLowerCase();
            const director = getDirector(m).toLowerCase();
            const cast = (m.cast || []).map(c => c.name.toLowerCase()).join(' ');
            const genres = (m.genres || []).map(g => g.name.toLowerCase()).join(' ');
            return title.includes(searchQuery) ||
                   director.includes(searchQuery) ||
                   cast.includes(searchQuery) ||
                   genres.includes(searchQuery);
        });
    }

    // Type filter
    if (typeFilter !== 'all') {
        filtered = filtered.filter(m => m.mediaType === typeFilter);
    }

    // Genre filter
    if (genreFilter) {
        filtered = filtered.filter(m =>
            m.genres && m.genres.some(g => g.id.toString() === genreFilter)
        );
    }

    // Sort movies
    const sorted = filtered.sort((a, b) => {
        switch(sortBy) {
            case 'title':
                return a.title.localeCompare(b.title);
            case 'year':
                return (b.release_date || '').localeCompare(a.release_date || '');
            case 'director':
                const directorA = getDirector(a);
                const directorB = getDirector(b);
                return directorA.localeCompare(directorB);
            case 'added':
            default:
                return new Date(b.addedDate) - new Date(a.addedDate);
        }
    });

    if (sorted.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <div class="empty-state-text">No items match your filters</div>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    sorted.forEach(movie => {
        const card = createMovieCard(movie, 'watchlist');
        container.appendChild(card);
    });
}

// Helper function to get director name from crew
function getDirector(movie) {
    if (!movie.crew || movie.crew.length === 0) return 'Unknown';
    const director = movie.crew.find(c => c.job === 'Director');
    return director ? director.name : 'Unknown';
}

// Helper function to populate genre filter dropdown based on items in a list
function populateGenreFilter(selectId, items) {
    const select = document.getElementById(selectId);
    const currentValue = select.value;

    // Collect all unique genres from the items
    const genreMap = new Map();
    items.forEach(item => {
        if (item.genres) {
            item.genres.forEach(genre => {
                if (!genreMap.has(genre.id)) {
                    genreMap.set(genre.id, genre.name);
                }
            });
        }
    });

    // Sort genres alphabetically
    const sortedGenres = [...genreMap.entries()].sort((a, b) => a[1].localeCompare(b[1]));

    // Clear existing options except first one
    while (select.options.length > 1) {
        select.remove(1);
    }

    // Add genre options
    sortedGenres.forEach(([id, name]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        select.appendChild(option);
    });

    // Restore previously selected value if it still exists
    if (currentValue && genreMap.has(parseInt(currentValue))) {
        select.value = currentValue;
    }
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
    const typeFilter = document.getElementById('watched-type-filter').value;
    const genreFilter = document.getElementById('watched-genre-filter').value;
    const ratingFilter = document.getElementById('watched-rating-filter').value;
    const searchQuery = document.getElementById('watched-search').value.trim().toLowerCase();

    // Populate genre filter dropdown based on items in watched list
    populateGenreFilter('watched-genre-filter', movies.watched);

    if (movies.watched.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎬</div>
                <div class="empty-state-text">No watched items yet. Start tracking your journey!</div>
            </div>
        `;
        return;
    }

    // Apply filters
    let filtered = [...movies.watched];

    // Search filter
    if (searchQuery) {
        filtered = filtered.filter(m => {
            const title = (m.title || '').toLowerCase();
            const director = getDirector(m).toLowerCase();
            const cast = (m.cast || []).map(c => c.name.toLowerCase()).join(' ');
            const genres = (m.genres || []).map(g => g.name.toLowerCase()).join(' ');
            return title.includes(searchQuery) ||
                   director.includes(searchQuery) ||
                   cast.includes(searchQuery) ||
                   genres.includes(searchQuery);
        });
    }

    // Type filter
    if (typeFilter !== 'all') {
        filtered = filtered.filter(m => m.mediaType === typeFilter);
    }

    // Genre filter
    if (genreFilter) {
        filtered = filtered.filter(m =>
            m.genres && m.genres.some(g => g.id.toString() === genreFilter)
        );
    }

    // Rating filter
    if (ratingFilter) {
        if (ratingFilter === 'unrated') {
            filtered = filtered.filter(m => !m.rating || m.rating === 0);
        } else {
            const minRating = parseInt(ratingFilter);
            filtered = filtered.filter(m => m.rating && m.rating >= minRating);
        }
    }

    // Sort movies
    const sorted = filtered.sort((a, b) => {
        switch(sortBy) {
            case 'rating':
                return (b.rating || 0) - (a.rating || 0);
            case 'title':
                return a.title.localeCompare(b.title);
            case 'year':
                return (b.release_date || '').localeCompare(a.release_date || '');
            case 'director':
                const directorA = getDirector(a);
                const directorB = getDirector(b);
                return directorA.localeCompare(directorB);
            case 'date':
            default:
                return new Date(b.watchedDate) - new Date(a.watchedDate);
        }
    });

    if (sorted.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔍</div>
                <div class="empty-state-text">No items match your filters</div>
            </div>
        `;
        return;
    }

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
                    <button class="btn btn-secondary btn-small" onclick="event.stopPropagation(); moveToWatched(${movie.id}, '${mediaType}')">✓ Watched</button>
                    <button class="btn btn-danger btn-small" onclick="event.stopPropagation(); removeFromWatchlist(${movie.id}, '${mediaType}')">Remove</button>
                ` : `
                    <button class="btn btn-primary btn-small" onclick="event.stopPropagation(); openRatingModal(${movie.id}, '${mediaType}')">Rate</button>
                    <button class="btn btn-danger btn-small" onclick="event.stopPropagation(); removeFromWatched(${movie.id}, '${mediaType}')">Remove</button>
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
        item = movies.watchlist.find(m => m.id === mediaId && (m.mediaType || 'movie') === mediaType);
    } else if (listType === 'watched') {
        item = movies.watched.find(m => m.id === mediaId && (m.mediaType || 'movie') === mediaType);
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

// ============= Recommendations =============

let cachedRecommendations = [];

async function loadRecommendations() {
    const container = document.getElementById('recommendations-grid');
    const description = document.getElementById('rec-description');

    // Need watched items to make recommendations
    if (movies.watched.length === 0 && movies.watchlist.length === 0) {
        description.textContent = '';
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎯</div>
                <div class="empty-state-text">Add movies and TV shows to your watched list to get personalized recommendations!</div>
            </div>
        `;
        return;
    }

    container.innerHTML = `<div class="loading"><div class="spinner"></div>Finding recommendations for you...</div>`;

    try {
        // 1. Analyze user's preferences
        const topRated = [...movies.watched]
            .filter(m => m.rating && m.rating >= 7)
            .sort((a, b) => b.rating - a.rating)
            .slice(0, 8);

        const recentWatched = [...movies.watched]
            .sort((a, b) => new Date(b.watchedDate) - new Date(a.watchedDate))
            .slice(0, 5);

        // Combine top rated + recent, deduplicate
        const seedItems = [];
        const seenSeedIds = new Set();
        [...topRated, ...recentWatched].forEach(item => {
            const key = `${item.mediaType}-${item.id}`;
            if (!seenSeedIds.has(key)) {
                seenSeedIds.add(key);
                seedItems.push(item);
            }
        });

        // If no rated items, use watchlist + whatever is in watched
        if (seedItems.length === 0) {
            const fallback = [...movies.watched, ...movies.watchlist].slice(0, 6);
            fallback.forEach(item => {
                const key = `${item.mediaType}-${item.id}`;
                if (!seenSeedIds.has(key)) {
                    seenSeedIds.add(key);
                    seedItems.push(item);
                }
            });
        }

        // 2. Get user's favorite genres (weighted by rating)
        const genreScores = {};
        movies.watched.forEach(m => {
            if (m.genres) {
                const weight = m.rating ? m.rating / 10 : 0.5;
                m.genres.forEach(g => {
                    genreScores[g.id] = (genreScores[g.id] || 0) + weight;
                });
            }
        });
        const topGenreIds = Object.entries(genreScores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([id]) => id);

        // 3. Build all existing IDs to exclude (watchlist + watched)
        const existingIds = new Set();
        movies.watchlist.forEach(m => existingIds.add(`${m.mediaType || 'movie'}-${m.id}`));
        movies.watched.forEach(m => existingIds.add(`${m.mediaType || 'movie'}-${m.id}`));

        // 4. Fetch recommendations from TMDB for seed items
        const recPromises = seedItems.slice(0, 6).map(item => {
            const mt = item.mediaType || 'movie';
            return fetch(`${TMDB_BASE_URL}/${mt}/${item.id}/recommendations?api_key=${TMDB_API_KEY}&page=1`)
                .then(r => r.json())
                .then(data => (data.results || []).map(r => ({ ...r, mediaType: mt, source: item.title })))
                .catch(() => []);
        });

        // 5. Also fetch "similar" for top 3 highest rated
        const simPromises = seedItems.slice(0, 3).map(item => {
            const mt = item.mediaType || 'movie';
            return fetch(`${TMDB_BASE_URL}/${mt}/${item.id}/similar?api_key=${TMDB_API_KEY}&page=1`)
                .then(r => r.json())
                .then(data => (data.results || []).map(r => ({ ...r, mediaType: mt, source: item.title })))
                .catch(() => []);
        });

        // 6. Also fetch discover based on top genres
        const discoverPromises = [];
        if (topGenreIds.length > 0) {
            const genreStr = topGenreIds.join(',');
            // Discover highly rated movies in user's fav genres
            discoverPromises.push(
                fetch(`${TMDB_BASE_URL}/discover/movie?api_key=${TMDB_API_KEY}&sort_by=vote_average.desc&vote_count.gte=500&vote_average.gte=7.0&with_genres=${genreStr}&page=1`)
                    .then(r => r.json())
                    .then(data => (data.results || []).map(r => ({ ...r, mediaType: 'movie', source: 'Your Genres' })))
                    .catch(() => [])
            );
            discoverPromises.push(
                fetch(`${TMDB_BASE_URL}/discover/tv?api_key=${TMDB_API_KEY}&sort_by=vote_average.desc&vote_count.gte=200&vote_average.gte=7.5&with_genres=${genreStr}&page=1`)
                    .then(r => r.json())
                    .then(data => (data.results || []).map(r => ({ ...r, mediaType: 'tv', source: 'Your Genres' })))
                    .catch(() => [])
            );
        }

        // 7. Fetch all in parallel
        const [recResults, simResults, discoverResults] = await Promise.all([
            Promise.all(recPromises),
            Promise.all(simPromises),
            Promise.all(discoverPromises)
        ]);

        // 8. Merge, deduplicate, and exclude already seen
        const allRecs = [];
        const seenRecIds = new Set();

        const addRecs = (items, priority) => {
            items.forEach(batch => {
                batch.forEach(item => {
                    const key = `${item.mediaType}-${item.id}`;
                    if (!seenRecIds.has(key) && !existingIds.has(key)) {
                        seenRecIds.add(key);
                        allRecs.push({ ...item, priority });
                    }
                });
            });
        };

        // Recommendations from top rated get highest priority
        addRecs(recResults, 3);
        // Similar movies get medium priority
        addRecs(simResults, 2);
        // Genre-based discover gets lower priority
        addRecs(discoverResults, 1);

        // 9. Sort: priority first, then by vote average
        allRecs.sort((a, b) => {
            if (b.priority !== a.priority) return b.priority - a.priority;
            return (b.vote_average || 0) - (a.vote_average || 0);
        });

        // Cache for re-rendering without API calls
        cachedRecommendations = allRecs;

        // 10. Build description
        const seedTitles = seedItems.slice(0, 3).map(s => s.title).join(', ');
        description.textContent = `Based on ${seedTitles}${seedItems.length > 3 ? ` and ${seedItems.length - 3} more` : ''} from your collection`;

        renderRecommendationsGrid();

    } catch (error) {
        console.error('Recommendations error:', error);
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <div class="empty-state-text">Error loading recommendations. Try again.</div>
            </div>
        `;
    }
}

function renderRecommendationsGrid() {
    const container = document.getElementById('recommendations-grid');
    const typeFilter = document.getElementById('rec-type-filter').value;

    let recs = [...cachedRecommendations];

    // Re-check existing IDs (in case user added something since loading)
    const existingIds = new Set();
    movies.watchlist.forEach(m => existingIds.add(`${m.mediaType || 'movie'}-${m.id}`));
    movies.watched.forEach(m => existingIds.add(`${m.mediaType || 'movie'}-${m.id}`));
    recs = recs.filter(item => !existingIds.has(`${item.mediaType}-${item.id}`));

    // Type filter
    if (typeFilter !== 'all') {
        recs = recs.filter(r => r.mediaType === typeFilter);
    }

    if (recs.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎯</div>
                <div class="empty-state-text">No recommendations found. Rate more movies to improve suggestions!</div>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    recs.slice(0, 40).forEach(item => {
        const mediaType = item.mediaType || 'movie';
        const title = item.title || item.name;
        const releaseDate = item.release_date || item.first_air_date;
        const isInWatchlist = movies.watchlist.some(m => m.id === item.id && (m.mediaType || 'movie') === mediaType);
        const isWatched = movies.watched.some(m => m.id === item.id && (m.mediaType || 'movie') === mediaType);

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
                <div class="movie-year">${releaseDate ? releaseDate.split('-')[0] : 'N/A'} ${mediaType === 'tv' ? '• TV' : ''}</div>
                ${item.vote_average ? `<div style="margin: 5px 0; font-size: 13px; color: var(--text-secondary);">⭐ ${item.vote_average.toFixed(1)}/10</div>` : ''}
                ${item.source ? `<div style="font-size: 11px; color: var(--accent); margin-bottom: 5px;">Because you liked: ${item.source}</div>` : ''}
                <div class="movie-actions">
                    ${!isInWatchlist && !isWatched ?
                        `<button class="btn btn-primary btn-small" onclick="event.stopPropagation(); addToWatchlist(${item.id}, '${mediaType}')">+ Watchlist</button>` :
                        ''}
                    ${!isWatched ?
                        `<button class="btn btn-secondary btn-small" onclick="event.stopPropagation(); addToWatched(${item.id}, '${mediaType}')">✓ Watched</button>` :
                        '<span style="color: var(--success); font-size: 12px;">✓ In Collection</span>'}
                </div>
                <button class="btn btn-small streaming-btn" onclick="event.stopPropagation(); showStreamingInfo(${item.id}, '${mediaType}')" style="margin-top: 8px; width: 100%; background: var(--bg-secondary); border: 1px solid var(--border);">
                    📺 Where to Watch
                </button>
            </div>
        `;

        card.querySelector('.movie-poster').addEventListener('click', () => showMediaDetail(item.id, null, mediaType));
        container.appendChild(card);
    });
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

        // Normalize data: ensure all items have mediaType set (for backwards compatibility)
        movies.watchlist = movies.watchlist.map(m => ({
            ...m,
            mediaType: m.mediaType || 'movie'
        }));
        movies.watched = movies.watched.map(m => ({
            ...m,
            mediaType: m.mediaType || 'movie'
        }));

        // Save the normalized data back
        saveMoviesToStorage();
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
