# 🎬 Movie Tracker

A simple, interactive website to track movies you want to watch and have watched. Built with vanilla HTML, CSS, and JavaScript - no frameworks required!

## Features

- **Search Movies**: Search the TMDB database for movies with posters and details
- **Watchlist**: Keep track of movies you want to watch
- **Watched List**: Track movies you've already seen
- **Rating System**: Rate movies from 1-10 with an intuitive star interface
- **Statistics Dashboard**: View your watching habits, top-rated movies, and favorite genres
- **Dark/Light Theme**: Toggle between dark and light modes (preference saved)
- **Responsive Design**: Works great on desktop, tablet, and mobile devices
- **Local Storage**: All your data is saved locally in your browser

## Quick Start

1. **Get a TMDB API Key** (free):
   - Go to [themoviedb.org](https://www.themoviedb.org/)
   - Create a free account
   - Go to Settings > API and request an API key
   - Copy your API key

2. **Add Your API Key**:
   - Open `app.js`
   - Find the line `const TMDB_API_KEY = '';`
   - Paste your API key between the quotes: `const TMDB_API_KEY = 'your_key_here';`

3. **Open the App**:
   - Simply open `index.html` in your web browser
   - That's it! No installation or build process needed

## How to Use

### Searching for Movies
1. Click the "Search" tab
2. Type a movie title in the search box
3. Click "Search" or press Enter
4. Browse results with posters and release years

### Adding Movies
- **To Watchlist**: Click the "+ Watchlist" button on any movie
- **To Watched**: Click the "✓ Watched" button (automatically removes from watchlist if present)

### Rating Movies
1. Go to the "Watched" tab
2. Click "Rate" on any movie
3. Click the stars to rate from 1-10
4. Your rating is saved automatically

### Viewing Statistics
- Click the "Stats" tab to see:
  - Total movies in your collection
  - Number of watched movies
  - Your average rating
  - Total hours watched
  - Your top-rated movies
  - Favorite genres

### Theme Toggle
- Click the moon/sun icon in the header to switch between dark and light modes
- Your preference is automatically saved

## Technical Details

- **No Dependencies**: Pure HTML, CSS, and JavaScript
- **No Build Process**: Just open and run
- **Data Storage**: localStorage (stays in your browser)
- **API**: The Movie Database (TMDB) API for movie information
- **Responsive**: Mobile-friendly design

## Project Structure

```
Movie-Tracker/
├── index.html      # Main HTML file
├── style.css       # All styles and theming
├── app.js          # Application logic
└── README.md       # This file
```

## Browser Support

Works on all modern browsers:
- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile browsers

## Data Privacy

All your data is stored locally in your browser using localStorage. Nothing is sent to any server (except TMDB API calls for searching movies). Your watchlist, ratings, and preferences stay on your device.

## Future Enhancements

Want to add more features? Some ideas:
- Export/import data as JSON
- Movie recommendations based on your ratings
- Filter by genre
- Search within your collection
- Movie trailers
- Cast and crew information
- User reviews/notes

## Credits

- Movie data and images provided by [The Movie Database (TMDB)](https://www.themoviedb.org/)
- Built with ❤️ using vanilla JavaScript

## License

Free to use and modify as you like!

---

**Need help?** Make sure you've added your TMDB API key in `app.js`. If you're still having issues, check the browser console for error messages.