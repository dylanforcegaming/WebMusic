const express = require('express');
const fs = require('fs');
const path = require('path');
const mm = require('music-metadata');

const app = express();
const PORT = 3000;

// Path target for Android Emulated Internal Storage
const MUSIC_DIR = '/storage/emulated/0/Music/SpotiFLAC';
const SUPPORTED_EXTS = ['.flac', '.mp3', '.m4a', '.ogg', '.wav'];

function getAllAudioFiles(dirPath, arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) {
    console.log(`[Warning] Directory does not exist: ${dirPath}`);
    return arrayOfFiles;
  }

  let files;
  try {
    files = fs.readdirSync(dirPath);
  } catch (err) {
    console.error(`[Error] Cannot read directory ${dirPath}:`, err.message);
    return arrayOfFiles;
  }

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        getAllAudioFiles(fullPath, arrayOfFiles);
      } else {
        const ext = path.extname(file).toLowerCase();
        if (SUPPORTED_EXTS.includes(ext)) {
          const relativePath = path.relative(MUSIC_DIR, fullPath).split(path.sep).join('/');
          arrayOfFiles.push(relativePath);
        }
      }
    } catch (e) {}
  });

  return arrayOfFiles;
}

function resolveSystemPath(relPath) {
  if (!relPath) return null;
  const decodedPath = decodeURIComponent(relPath);
  const safePath = path.normalize(decodedPath).replace(/^(\.\.[\/\\])+/, '');
  return path.join(MUSIC_DIR, safePath);
}

app.get('/manifest.json', (req, res) => {
  res.json({
    name: "WebMusic",
    short_name: "WebMusic",
    start_url: "/",
    display: "standalone",
    background_color: "#141218",
    theme_color: "#141218",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }]
  });
});

app.get('/icon.png', (req, res) => {
  const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <rect width="512" height="512" rx="120" fill="#211F26"/>
    <circle cx="256" cy="256" r="180" fill="#4A4458"/>
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-size="220">🎵</text>
  </svg>`;
  res.set('Content-Type', 'image/svg+xml');
  res.send(svgIcon);
});

app.get('/', (req, res) => res.send(HTML_TEMPLATE));

app.get('/api/tracks', async (req, res) => {
  try {
    const relativeFiles = getAllAudioFiles(MUSIC_DIR);
    console.log(`[Info] Found ${relativeFiles.length} tracks in ${MUSIC_DIR}`);

    const tracks = await Promise.all(
      relativeFiles.map(async (relPath, index) => {
        const fullPath = resolveSystemPath(relPath);
        const defaultTitle = path.basename(relPath, path.extname(relPath));
        const defaultFormat = path.extname(relPath).toUpperCase().replace('.', '');

        try {
          const metadata = await mm.parseFile(fullPath, { skipCovers: false });
          const hasCover = Array.isArray(metadata.common.picture) && metadata.common.picture.length > 0;

          return {
            id: index,
            relPath: relPath,
            title: metadata.common.title || defaultTitle,
            artist: metadata.common.artist || 'Unknown Artist',
            album: metadata.common.album || 'Unknown Album',
            format: defaultFormat,
            hasCover: hasCover
          };
        } catch (e) {
          return {
            id: index,
            relPath: relPath,
            title: defaultTitle,
            artist: 'Unknown Artist',
            album: 'Unknown Album',
            format: defaultFormat,
            hasCover: false
          };
        }
      })
    );

    res.json(tracks);
  } catch (err) {
    console.error('[Error] Failed indexing track list:', err.message);
    res.status(500).json([]);
  }
});

app.get('/api/lyrics', async (req, res) => {
  const relPath = req.query.path;
  const fullPath = resolveSystemPath(relPath);

  if (!fullPath || !fs.existsSync(fullPath)) return res.status(404).json({ lyrics: null });

  try {
    const metadata = await mm.parseFile(fullPath);
    let extractedText = [];

    if (metadata.common.lyrics && metadata.common.lyrics.length > 0) {
      metadata.common.lyrics.forEach(entry => {
        if (typeof entry === 'string') {
          extractedText.push(entry);
        } else if (entry && typeof entry === 'object') {
          if (typeof entry.text === 'string') extractedText.push(entry.text);
          else if (typeof entry.description === 'string') extractedText.push(entry.description);
        }
      });
    }

    if (extractedText.length === 0 && metadata.native && metadata.native['ID3v2.3']) {
      const uslt = metadata.native['ID3v2.3'].find(tag => tag.id === 'USLT');
      if (uslt && uslt.value) {
        if (typeof uslt.value === 'string') {
          extractedText.push(uslt.value);
        } else if (typeof uslt.value === 'object' && uslt.value.text) {
          extractedText.push(uslt.value.text);
        }
      }
    }

    let rawLyrics = extractedText.join('\n').trim();

    if (rawLyrics) {
      const cleanLyrics = rawLyrics.replace(/\[\d+:\d+(?:\.\d+)?\]/g, '').trim();
      return res.json({ lyrics: cleanLyrics });
    }

    res.status(404).json({ lyrics: 'No embedded ID3 lyrics found for this track.' });
  } catch {
    res.status(500).json({ lyrics: 'Error reading metadata' });
  }
});

app.get('/api/cover', async (req, res) => {
  const relPath = req.query.path;
  const fullPath = resolveSystemPath(relPath);

  if (!fullPath || !fs.existsSync(fullPath)) return res.status(404).send('File not found');

  try {
    const metadata = await mm.parseFile(fullPath, { skipCovers: false });
    const picture = metadata.common.picture && metadata.common.picture[0];

    if (picture && picture.data) {
      let mimeType = picture.format || 'image/jpeg';
      
      if (mimeType.includes('jpg') || mimeType.includes('jpeg')) {
        mimeType = 'image/jpeg';
      } else if (mimeType.includes('png')) {
        mimeType = 'image/png';
      }

      res.set('Content-Type', mimeType);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.send(picture.data);
    }
    
    res.status(404).send('No cover art');
  } catch (err) {
    console.error(`[Cover Error] ${fullPath}:`, err.message);
    res.status(500).send('Error extracting cover art');
  }
});

app.get('/api/stream', (req, res) => {
  const relPath = req.query.path;
  const fullPath = resolveSystemPath(relPath);

  if (!fullPath || !fs.existsSync(fullPath)) return res.status(404).send('File not found');

  const stat = fs.statSync(fullPath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const ext = path.extname(fullPath).toLowerCase();

  const mimeTypes = {
    '.flac': 'audio/flac',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav'
  };

  const contentType = mimeTypes[ext] || 'audio/mpeg';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(fullPath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': contentType
    });
    file.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType
    });
    fs.createReadStream(fullPath).pipe(res);
  }
});

app.get('/api/download', (req, res) => {
  const relPath = req.query.path;
  const fullPath = resolveSystemPath(relPath);

  if (!fullPath || !fs.existsSync(fullPath)) return res.status(404).send('File not found');
  res.download(fullPath, path.basename(fullPath));
});

const HTML_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WebMusic</title>
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#141218">
  <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&family=Roboto:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --m3-bg: #141218;
      --m3-surface: #211F26;
      --m3-surface-variant: #2B2930;
      --m3-primary: #D0BCFF;
      --m3-primary-container: #4A4458;
      --m3-on-surface: #E6E0E9;
      --m3-outline: #938F96;
    }
    * { box-sizing: border-box; }
    
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: var(--m3-bg); }
    ::-webkit-scrollbar-thumb { background: var(--m3-surface-variant); border-radius: 4px; }

    body {
      font-family: 'Google Sans', 'Roboto', sans-serif;
      background-color: var(--m3-bg);
      color: var(--m3-on-surface);
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }

    header {
      padding: 16px 24px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      background-color: var(--m3-surface);
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .header-left { display: flex; align-items: baseline; gap: 12px; }
    h1 { font-size: 22px; font-weight: 700; color: var(--m3-primary); margin: 0; }
    .love-tagline { font-size: 13px; color: var(--m3-primary); opacity: 0.9; }
    .header-clock {
      font-size: 14px;
      font-weight: 500;
      color: var(--m3-outline);
      background: var(--m3-surface-variant);
      padding: 6px 14px;
      border-radius: 20px;
    }

    .app-layout { display: flex; flex: 1; overflow: hidden; }

    .sidebar {
      width: 340px;
      background-color: var(--m3-surface);
      border-right: 1px solid rgba(255,255,255,0.08);
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      align-items: center;
      text-align: center;
      overflow-y: auto;
      flex-shrink: 0;
    }
    .sidebar-title {
      width: 100%;
      text-align: center;
      font-size: 14px;
      font-weight: 700;
      color: var(--m3-primary);
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 8px;
    }
    
    .now-display-container {
      width: 100%;
      max-width: 240px;
      aspect-ratio: 1 / 1;
      position: relative;
      border-radius: 20px;
      overflow: hidden;
    }

    .now-cover {
      width: 100%;
      height: 100%;
      border-radius: 20px;
      background-color: var(--m3-surface-variant);
      object-fit: cover;
      box-shadow: 0 12px 28px rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      color: var(--m3-outline);
      transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1);
    }

    /* Shimmer effect overlay for the main cover */
    .now-display-container::after {
      content: '';
      position: absolute;
      top: 0; left: -150%;
      width: 100%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.25), transparent);
      transform: skewX(-20deg);
      pointer-events: none;
      opacity: 0;
    }

    .now-display-container.transitioning .now-cover {
      opacity: 0.3;
      transform: scale(0.94);
    }

    .now-display-container.transitioning::after {
      opacity: 1;
      animation: coverShimmer 0.5s ease-in-out forwards;
    }

    @keyframes coverShimmer {
      0% { left: -150%; }
      100% { left: 150%; }
    }

    .lyrics-panel {
      display: none;
      width: 100%;
      height: 100%;
      background: var(--m3-surface-variant);
      border-radius: 20px;
      padding: 16px;
      overflow-y: auto;
      text-align: center;
      box-shadow: 0 12px 28px rgba(0,0,0,0.6);
      white-space: pre-wrap;
      font-family: Arial, sans-serif;
      font-size: 14px;
      font-weight: bold;
      line-height: 1.6;
      color: var(--m3-on-surface);
    }

    .now-title { font-size: 18px; font-weight: 700; margin-top: 6px; word-break: break-word; }
    .now-meta { font-size: 13px; color: var(--m3-outline); word-break: break-word; margin-bottom: 4px; }

    .lyrics-toggle-btn {
      background: rgba(208, 188, 255, 0.1);
      border: 1px solid var(--m3-primary);
      color: var(--m3-primary);
      padding: 6px 14px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      margin-bottom: 8px;
    }

    .player-controls { width: 100%; display: flex; flex-direction: column; gap: 12px; margin-top: auto; }
    .time-bar-container { display: flex; flex-direction: column; gap: 6px; }
    
    .progress-slider {
      width: 100%;
      height: 6px;
      -webkit-appearance: none;
      appearance: none;
      background: linear-gradient(to right, var(--m3-primary) 0%, var(--m3-surface-variant) 0%);
      border-radius: 3px;
      outline: none;
      cursor: pointer;
    }
    .progress-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: var(--m3-primary);
      cursor: pointer;
    }
    
    .time-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--m3-outline); font-weight: 500; }
    .control-buttons { display: flex; align-items: center; justify-content: center; gap: 16px; }
    .btn-circle {
      background: var(--m3-surface-variant);
      border: none;
      color: var(--m3-on-surface);
      width: 44px;
      height: 44px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .btn-circle svg { width: 20px; height: 20px; fill: currentColor; }
    .btn-circle.play-btn { width: 56px; height: 56px; background: var(--m3-primary); color: #141218; }
    .btn-circle.play-btn svg { width: 26px; height: 26px; fill: #141218; }

    .main-content { flex: 1; padding: 24px; display: flex; flex-direction: column; overflow-y: auto; }
    .catalog-header-row { display: flex; align-items: baseline; gap: 12px; margin-bottom: 16px; }
    .catalog-header { font-size: 24px; font-weight: 700; color: var(--m3-on-surface); margin: 0; }
    .search-count { font-size: 13px; color: var(--m3-outline); }

    .search-input {
      width: 100%;
      padding: 14px 20px;
      border-radius: 28px;
      border: 1px solid rgba(255,255,255,0.1);
      background-color: var(--m3-surface);
      color: var(--m3-on-surface);
      font-size: 14px;
      outline: none;
      margin-bottom: 14px;
    }

    .filters-container { display: flex; gap: 10px; margin-bottom: 20px; align-items: center; }
    .filter-chip {
      background: var(--m3-surface);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: var(--m3-on-surface);
      padding: 8px 18px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
    }
    .filter-chip.active { background: var(--m3-primary); color: #141218; border-color: var(--m3-primary); }

    .track-list { display: flex; flex-direction: column; gap: 10px; }
    .track-card {
      position: relative;
      background-color: var(--m3-surface);
      border-radius: 16px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 16px;
      cursor: pointer;
      overflow: hidden;
      transition: transform 0.2s ease, background-color 0.2s ease;
    }
    
    /* Shimmer effect when hovering over a song */
    .track-card::after {
      content: '';
      position: absolute;
      top: 0; left: -150%;
      width: 100%; height: 100%;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.12), transparent);
      transform: skewX(-20deg);
      pointer-events: none;
    }

    .track-card:hover {
      transform: translateX(4px);
      background-color: var(--m3-surface-variant);
    }

    .track-card:hover::after {
      animation: cardShimmer 0.75s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes cardShimmer {
      0% { left: -150%; }
      100% { left: 150%; }
    }

    .track-card.active { background-color: var(--m3-primary-container); }
    .cover-art {
      width: 48px;
      height: 48px;
      border-radius: 10px;
      background-color: var(--m3-surface-variant);
      object-fit: cover;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }
    .track-info { display: flex; flex-direction: column; gap: 4px; flex-grow: 1; overflow: hidden; }
    .track-title { font-size: 15px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .track-artist { font-size: 13px; color: var(--m3-outline); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .card-actions { display: flex; align-items: center; gap: 10px; }
    .download-btn {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: var(--m3-primary);
      width: 36px;
      height: 36px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      z-index: 2;
    }
    .download-btn svg { width: 18px; height: 18px; fill: currentColor; }
    .badge { font-size: 11px; font-weight: 700; padding: 6px 10px; border-radius: 8px; background: var(--m3-surface-variant); color: var(--m3-primary); }

    @media (max-width: 768px) {
      .app-layout { flex-direction: column; overflow-y: auto; }
      .sidebar { width: 100%; border-right: none; }
      body { height: auto; overflow: auto; }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <h1>WebMusic</h1>
      <span class="love-tagline">Made with love ♡</span>
    </div>
    <div class="header-clock" id="header-clock">--:--:--</div>
  </header>

  <div class="app-layout">
    <div class="sidebar">
      <div class="sidebar-title">Playing Now</div>
      
      <div class="now-display-container" id="now-container">
        <img id="now-cover" class="now-cover" src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' fill='%23938F96'><rect width='240' height='240' fill='%23211F26'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='60'>🎵</text></svg>">
        <div id="lyrics-panel" class="lyrics-panel">No lyrics loaded.</div>
      </div>

      <div class="now-title" id="now-title">No track selected</div>
      <div class="now-meta" id="now-meta">Select a song from your catalog</div>
      <button class="lyrics-toggle-btn" id="lyrics-btn" onclick="toggleLyricsView()">Embedded ID3 Lyrics</button>

      <div class="player-controls">
        <div class="time-bar-container">
          <input type="range" id="seek-slider" class="progress-slider" value="0" min="0" max="100">
          <div class="time-labels">
            <span id="current-time">0:00</span>
            <span id="total-time">0:00</span>
          </div>
        </div>
        <div class="control-buttons">
          <button class="btn-circle" onclick="playPrev()">
            <svg viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button class="btn-circle play-btn" id="play-pause-btn" onclick="togglePlay()">
            <svg id="play-icon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
          </button>
          <button class="btn-circle" onclick="playNext()">
            <svg viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
        </div>
      </div>
      <audio id="audio-player"></audio>
    </div>

    <div class="main-content">
      <div class="catalog-header-row">
        <h2 class="catalog-header">Song Catalog</h2>
        <span class="search-count" id="search-count">how many found in search: 0</span>
      </div>

      <input type="text" id="search-input" class="search-input" placeholder="Search songs, artists, albums..." oninput="handleSearch()" />

      <div class="filters-container">
        <button class="filter-chip active" id="filter-all" onclick="setFilter('all')">All</button>
        <button class="filter-chip" id="filter-artist" onclick="setFilter('artist')">Artist</button>
        <button class="filter-chip" id="filter-album" onclick="setFilter('album')">Album</button>
        <button class="filter-chip" id="filter-songs" onclick="setFilter('songs')">Songs</button>
      </div>

      <div class="track-list" id="library"></div>
    </div>
  </div>

  <script>
    let allTracks = [];
    let currentTrackIndex = -1;
    let activeFilter = 'all';
    let showingLyrics = false;

    const player = document.getElementById('audio-player');
    const playBtn = document.getElementById('play-pause-btn');
    const seekSlider = document.getElementById('seek-slider');

    const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    const PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

    function updateClock() {
      const now = new Date();
      const options = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' };
      document.getElementById('header-clock').textContent = now.toLocaleDateString(undefined, options);
    }
    setInterval(updateClock, 1000);
    updateClock();

    async function fetchTracks() {
      try {
        const res = await fetch('/api/tracks');
        const tracks = await res.json();
        
        if (Array.isArray(tracks)) {
          allTracks = tracks;
          handleSearch();
        }
      } catch (err) {
        console.error('Failed to load catalog');
      }
    }

    function renderLibrary(tracks) {
      const libraryEl = document.getElementById('library');
      libraryEl.innerHTML = '';
      
      document.getElementById('search-count').textContent = \`how many found in search: \${tracks.length}\`;

      tracks.forEach((track) => {
        const index = allTracks.findIndex(t => t.relPath === track.relPath);
        const card = document.createElement('div');
        card.className = \`track-card \${currentTrackIndex === index ? 'active' : ''}\`;
        
        const coverUrl = track.hasCover ? '/api/cover?path=' + encodeURIComponent(track.relPath) : null;
        const downloadUrl = '/api/download?path=' + encodeURIComponent(track.relPath);
        
        card.innerHTML = \`
          \${coverUrl 
            ? \`<img class="cover-art" src="\${coverUrl}" loading="lazy" alt="art">\` 
            : \`<div class="cover-art">🎵</div>\`}
          <div class="track-info" onclick="playTrackByIndex(\${index})">
            <span class="track-title">\${escapeHtml(track.title)}</span>
            <span class="track-artist">\${escapeHtml(track.artist)} • \${escapeHtml(track.album)}</span>
          </div>
          <div class="card-actions">
            <span class="badge">\${track.format}</span>
            <a href="\${downloadUrl}" class="download-btn" title="Download Song" onclick="event.stopPropagation()">
              <svg viewBox="0 0 24 24"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            </a>
          </div>
        \`;
        libraryEl.appendChild(card);
      });
    }

    function setFilter(filterType) {
      activeFilter = filterType;
      document.querySelectorAll('.filter-chip').forEach(chip => chip.classList.remove('active'));
      document.getElementById('filter-' + filterType).classList.add('active');
      handleSearch();
    }

    function handleSearch() {
      const query = document.getElementById('search-input').value.toLowerCase().trim();

      const filtered = allTracks.filter(track => {
        const titleMatch = track.title && track.title.toLowerCase().includes(query);
        const artistMatch = track.artist && track.artist.toLowerCase().includes(query);
        const albumMatch = track.album && track.album.toLowerCase().includes(query);

        if (activeFilter === 'artist') return artistMatch;
        if (activeFilter === 'album') return albumMatch;
        if (activeFilter === 'songs') return titleMatch;

        return titleMatch || artistMatch || albumMatch || track.relPath.toLowerCase().includes(query);
      });

      renderLibrary(filtered);
    }

    async function fetchLyrics(relPath) {
      const lyricsPanel = document.getElementById('lyrics-panel');
      lyricsPanel.textContent = 'Loading lyrics...';

      try {
        const res = await fetch('/api/lyrics?path=' + encodeURIComponent(relPath));
        const data = await res.json();
        
        if (data && typeof data.lyrics === 'string') {
          lyricsPanel.textContent = data.lyrics;
        } else {
          lyricsPanel.textContent = 'No lyrics found.';
        }
      } catch {
        lyricsPanel.textContent = 'Failed to load lyrics.';
      }
    }

    function toggleLyricsView() {
      showingLyrics = !showingLyrics;
      const coverImg = document.getElementById('now-cover');
      const lyricsPanel = document.getElementById('lyrics-panel');
      const lyricsBtn = document.getElementById('lyrics-btn');

      if (showingLyrics) {
        coverImg.style.display = 'none';
        lyricsPanel.style.display = 'block';
        lyricsBtn.textContent = 'Show Album Artwork';
      } else {
        coverImg.style.display = 'flex';
        lyricsPanel.style.display = 'none';
        lyricsBtn.textContent = 'Embedded ID3 Lyrics';
      }
    }

    function playTrackByIndex(index) {
      if (index < 0 || index >= allTracks.length) return;
      currentTrackIndex = index;
      const track = allTracks[index];

      const coverUrl = track.hasCover ? '/api/cover?path=' + encodeURIComponent(track.relPath) : null;
      const defaultCover = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240' fill='%23938F96'><rect width='240' height='240' fill='%23211F26'/><text x='50%' y='50%' dominant-baseline='middle' text-anchor='middle' font-size='60'>🎵</text></svg>";

      const nowContainer = document.getElementById('now-container');
      const coverImg = document.getElementById('now-cover');

      // Trigger transition state and shimmer
      nowContainer.classList.add('transitioning');

      setTimeout(() => {
        document.getElementById('now-title').textContent = track.title;
        document.getElementById('now-meta').textContent = \`\${track.artist} — \${track.album}\`;
        coverImg.src = coverUrl || defaultCover;
        
        // Remove transition state to complete smooth swap
        setTimeout(() => {
          nowContainer.classList.remove('transitioning');
        }, 100);
      }, 250);

      fetchLyrics(track.relPath);

      player.src = '/api/stream?path=' + encodeURIComponent(track.relPath);
      player.play().then(() => {
        playBtn.innerHTML = PAUSE_SVG;
      }).catch(err => console.error("Playback error:", err));

      handleSearch();
    }

    function togglePlay() {
      if (!player.src) return;
      if (player.paused) {
        player.play();
        playBtn.innerHTML = PAUSE_SVG;
      } else {
        player.pause();
        playBtn.innerHTML = PLAY_SVG;
      }
    }

    function playNext() {
      if (allTracks.length === 0) return;
      let nextIndex = (currentTrackIndex + 1) % allTracks.length;
      playTrackByIndex(nextIndex);
    }

    function playPrev() {
      if (allTracks.length === 0) return;
      let prevIndex = (currentTrackIndex - 1 + allTracks.length) % allTracks.length;
      playTrackByIndex(prevIndex);
    }

    function updateSliderFill(pct) {
      seekSlider.style.background = \`linear-gradient(to right, var(--m3-primary) \${pct}%, var(--m3-surface-variant) \${pct}%)\`;
    }

    player.addEventListener('timeupdate', () => {
      if (!player.duration) return;

      const pct = (player.currentTime / player.duration) * 100;
      seekSlider.value = pct;
      updateSliderFill(pct);
      document.getElementById('current-time').textContent = formatTime(player.currentTime);
      document.getElementById('total-time').textContent = formatTime(player.duration);
    });

    player.addEventListener('ended', playNext);

    seekSlider.addEventListener('input', () => {
      if (!player.duration) return;
      const pct = seekSlider.value;
      updateSliderFill(pct);
      player.currentTime = (pct / 100) * player.duration;
    });

    function formatTime(seconds) {
      if (isNaN(seconds)) return '0:00';
      const min = Math.floor(seconds / 60);
      const sec = Math.floor(seconds % 60);
      return \`\${min}:\${sec < 10 ? '0' : ''}\${sec}\`;
    }

    function escapeHtml(str) {
      return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    fetchTracks();
  </script>
</body>
</html>
`;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
