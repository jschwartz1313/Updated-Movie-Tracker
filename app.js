// TMDB API Configuration
const TMDB_API_KEY = 'd954579ffe639c8a36b86cb2849c2ed1'; // Get your free API key from https://www.themoviedb.org/settings/api
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// App State
let movies = {
    watchlist: [],
    watched: []
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    loadMoviesFromStorage();
    initializeEventListeners();
    updateCounts();
    updateStats();
    loadTheme();

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
        if (e.key === 'Enter') searchMovies();
    });

    // Sort
    document.getElementById('watchlist-sort').addEventListener('change', renderWatchlist);
    document.getElementById('watched-sort').addEventListener('change', renderWatched);

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
    const resultsContainer = document.getElementById('search-results');

    if (!query) {
        showToast('Please enter a movie title');
        return;
    }

    if (!TMDB_API_KEY) {
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔑</div>
                <div class="empty-state-text">
                    Please add your TMDB API key to search for movies.<br><br>
                    Get a free API key at: <a href="https://www.themoviedb.org/settings/api" target="_blank">themoviedb.org</a><br>
                    Then add it to the TMDB_API_KEY variable in app.js
                </div>
            </div>
        `;
        return;
    }

    resultsContainer.innerHTML = '<div class="loading"><div class="spinner"></div>Searching...</div>';

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&page=1`
        );
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            renderSearchResults(data.results);
        } else {
            resultsContainer.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <div class="empty-state-text">No movies found for "${query}"</div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Search error:', error);
        resultsContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">❌</div>
                <div class="empty-state-text">Error searching movies. Please try again.</div>
            </div>
        `;
        showToast('Error searching movies');
    }
}

function renderSearchResults(results) {
    const container = document.getElementById('search-results');
    container.innerHTML = '<div class="movie-grid"></div>';
    const grid = container.querySelector('.movie-grid');

    results.slice(0, 20).forEach(movie => {
        const isInWatchlist = movies.watchlist.some(m => m.id === movie.id);
        const isWatched = movies.watched.some(m => m.id === movie.id);

        const card = document.createElement('div');
        card.className = 'movie-card';
        card.innerHTML = `
            <img
                src="${movie.poster_path ? TMDB_IMAGE_BASE + movie.poster_path : 'https://via.placeholder.com/500x750?text=No+Poster'}"
                alt="${movie.title}"
                class="movie-poster"
            />
            <div class="movie-info">
                <div class="movie-title">${movie.title}</div>
                <div class="movie-year">${movie.release_date ? movie.release_date.split('-')[0] : 'N/A'}</div>
                <div class="movie-actions">
                    ${!isInWatchlist && !isWatched ?
                        `<button class="btn btn-primary btn-small" onclick="addToWatchlist(${movie.id})">+ Watchlist</button>` :
                        ''}
                    ${!isWatched ?
                        `<button class="btn btn-secondary btn-small" onclick="addToWatched(${movie.id})">✓ Watched</button>` :
                        '<span style="color: var(--success); font-size: 12px;">✓ In Collection</span>'}
                </div>
            </div>
        `;

        card.querySelector('.movie-poster').addEventListener('click', () => showMovieDetail(movie.id));
        grid.appendChild(card);
    });
}

async function getMovieDetails(movieId) {
    if (!TMDB_API_KEY) return null;

    try {
        const response = await fetch(
            `${TMDB_BASE_URL}/movie/${movieId}?api_key=${TMDB_API_KEY}&append_to_response=credits`
        );
        return await response.json();
    } catch (error) {
        console.error('Error fetching movie details:', error);
        return null;
    }
}

// ============= Movie Management =============

async function addToWatchlist(movieId) {
    if (movies.watchlist.some(m => m.id === movieId)) {
        showToast('Already in watchlist');
        return;
    }

    const movieDetails = await getMovieDetails(movieId);
    if (!movieDetails) {
        showToast('Error adding movie');
        return;
    }

    const movie = {
        id: movieDetails.id,
        title: movieDetails.title,
        poster_path: movieDetails.poster_path,
        backdrop_path: movieDetails.backdrop_path,
        release_date: movieDetails.release_date,
        overview: movieDetails.overview,
        genres: movieDetails.genres,
        runtime: movieDetails.runtime,
        vote_average: movieDetails.vote_average,
        tagline: movieDetails.tagline,
        cast: movieDetails.credits?.cast?.slice(0, 10) || [],
        crew: movieDetails.credits?.crew?.filter(c => c.job === 'Director' || c.job === 'Writer' || c.job === 'Producer').slice(0, 5) || [],
        addedDate: new Date().toISOString()
    };

    movies.watchlist.push(movie);
    saveMoviesToStorage();
    updateCounts();
    showToast(`Added "${movie.title}" to watchlist`);
}

async function addToWatched(movieId) {
    // Remove from watchlist if present
    movies.watchlist = movies.watchlist.filter(m => m.id !== movieId);

    if (movies.watched.some(m => m.id === movieId)) {
        showToast('Already in watched list');
        return;
    }

    const movieDetails = await getMovieDetails(movieId);
    if (!movieDetails) {
        showToast('Error adding movie');
        return;
    }

    const movie = {
        id: movieDetails.id,
        title: movieDetails.title,
        poster_path: movieDetails.poster_path,
        backdrop_path: movieDetails.backdrop_path,
        release_date: movieDetails.release_date,
        overview: movieDetails.overview,
        genres: movieDetails.genres,
        runtime: movieDetails.runtime,
        vote_average: movieDetails.vote_average,
        tagline: movieDetails.tagline,
        cast: movieDetails.credits?.cast?.slice(0, 10) || [],
        crew: movieDetails.credits?.crew?.filter(c => c.job === 'Director' || c.job === 'Writer' || c.job === 'Producer').slice(0, 5) || [],
        watchedDate: new Date().toISOString(),
        rating: 0,
        review: ''
    };

    movies.watched.push(movie);
    saveMoviesToStorage();
    updateCounts();
    updateStats();
    showToast(`Marked "${movie.title}" as watched`);
}

function moveToWatched(movieId) {
    const movie = movies.watchlist.find(m => m.id === movieId);
    if (!movie) return;

    movies.watchlist = movies.watchlist.filter(m => m.id !== movieId);
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

function removeFromWatchlist(movieId) {
    const movie = movies.watchlist.find(m => m.id === movieId);
    if (!movie) return;

    movies.watchlist = movies.watchlist.filter(m => m.id !== movieId);
    saveMoviesToStorage();
    updateCounts();
    renderWatchlist();
    showToast(`Removed "${movie.title}" from watchlist`);
}

function removeFromWatched(movieId) {
    const movie = movies.watched.find(m => m.id === movieId);
    if (!movie) return;

    movies.watched = movies.watched.filter(m => m.id !== movieId);
    saveMoviesToStorage();
    updateCounts();
    updateStats();
    renderWatched();
    showToast(`Removed "${movie.title}" from watched list`);
}

function rateMovie(movieId, rating) {
    const movie = movies.watched.find(m => m.id === movieId);
    if (!movie) return;

    movie.rating = rating;
    saveMoviesToStorage();
    updateStats();
    showToast(`Rated "${movie.title}" ${rating}/10`);
}

// ============= Rendering Functions =============

function renderWatchlist() {
    const container = document.getElementById('watchlist-grid');
    const sortBy = document.getElementById('watchlist-sort').value;

    if (movies.watchlist.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📝</div>
                <div class="empty-state-text">Your watchlist is empty. Search for movies to add!</div>
            </div>
        `;
        return;
    }

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

function renderWatched() {
    const container = document.getElementById('watched-grid');
    const sortBy = document.getElementById('watched-sort').value;

    if (movies.watched.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎬</div>
                <div class="empty-state-text">No watched movies yet. Start tracking your movie journey!</div>
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

    card.innerHTML = `
        <img
            src="${movie.poster_path ? TMDB_IMAGE_BASE + movie.poster_path : 'https://via.placeholder.com/500x750?text=No+Poster'}"
            alt="${movie.title}"
            class="movie-poster"
        />
        <div class="movie-info">
            <div class="movie-title" title="${movie.title}">${movie.title}</div>
            <div class="movie-year">${year}</div>

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
                    <button class="btn btn-secondary btn-small" onclick="moveToWatched(${movie.id})">✓ Watched</button>
                    <button class="btn btn-danger btn-small" onclick="removeFromWatchlist(${movie.id})">Remove</button>
                ` : `
                    <button class="btn btn-primary btn-small" onclick="openRatingModal(${movie.id})">Rate</button>
                    <button class="btn btn-danger btn-small" onclick="removeFromWatched(${movie.id})">Remove</button>
                `}
            </div>
        </div>
    `;

    card.querySelector('.movie-poster').addEventListener('click', () => showMovieDetail(movie.id, listType));
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

function showMovieDetail(movieId, listType = null) {
    let movie;

    if (listType === 'watchlist') {
        movie = movies.watchlist.find(m => m.id === movieId);
    } else if (listType === 'watched') {
        movie = movies.watched.find(m => m.id === movieId);
    }

    // If movie not in lists, fetch from search results
    if (!movie) {
        getMovieDetails(movieId).then(movieDetails => {
            if (movieDetails) {
                displayMovieModal(movieDetails, listType);
            }
        });
        return;
    }

    displayMovieModal(movie, listType);
}

function displayMovieModal(movie, listType) {
    const modalBody = document.getElementById('modal-body');
    const year = movie.release_date ? movie.release_date.split('-')[0] : 'N/A';
    const runtime = movie.runtime ? `${movie.runtime} min` : 'N/A';

    modalBody.innerHTML = `
        <div class="modal-header">
            <img
                src="${movie.poster_path ? TMDB_IMAGE_BASE + movie.poster_path : 'https://via.placeholder.com/500x750?text=No+Poster'}"
                alt="${movie.title}"
                class="modal-poster"
            />
            <div class="modal-info">
                <h2 class="modal-title">${movie.title}</h2>
                <div class="modal-meta">
                    ${year} • ${runtime} ${movie.vote_average ? `• ⭐ ${movie.vote_average.toFixed(1)}/10 TMDB` : ''}
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
                                `<span class="star ${i <= (movie.rating || 0) ? 'active' : ''}" onclick="rateMovie(${movie.id}, ${i})">★</span>`
                            ).join('')}
                        </div>
                        <div style="margin-top: 5px; font-size: 14px; color: var(--text-secondary);">
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

    document.getElementById('movie-modal').classList.add('active');
}

function openRatingModal(movieId) {
    showMovieDetail(movieId, 'watched');
}

function closeModal() {
    document.getElementById('movie-modal').classList.remove('active');
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
        container.innerHTML = '<div class="empty-state-text">No rated movies yet</div>';
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
                <span>${count} movies</span>
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
