/**
 * Quincy Dating Platform — Production Client Logic
 * Preference-based matching • Strict self-match guards
 * Intentional likes / prompt likes • Storage-event real-time messaging
 * Typing indicators • Read receipts • Offline-first localStorage
 * + Multi-device API bridge (when QUINCY_API is set in localStorage)
 */

/* ========== API BRIDGE (multi-device) ========== */
const API_BASE = (typeof localStorage !== 'undefined' && localStorage.getItem('QUINCY_API')) || '';
const USE_API = !!API_BASE;

async function api(path, options = {}) {
  if (!API_BASE) throw new Error('NO_API');
  const res = await fetch(API_BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (res.status === 401 && path !== '/api/auth/login' && path !== '/api/auth/register') {
    try {
      const r = await fetch(API_BASE + '/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (r.ok) return api(path, options);
    } catch (_) { /* ignore */ }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

let socket = null;
function connectSocket() {
  if (!API_BASE || typeof io === 'undefined') return;
  if (socket && socket.connected) return;
  try {
    socket = io(API_BASE, {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 20,
    });
    socket.on('connect', () => console.log('[Quincy] socket connected'));
    socket.on('message_received', (msg) => {
      if (typeof onSocketMessage === 'function') onSocketMessage(msg);
    });
    socket.on('typing_status', (s) => {
      if (typeof onSocketTyping === 'function') onSocketTyping(s);
    });
    socket.on('messages_read', (s) => {
      if (typeof onSocketRead === 'function') onSocketRead(s);
    });
    socket.on('new_match', () => {
      if (typeof updateMessagesBadge === 'function') updateMessagesBadge();
      if (typeof showToast === 'function') showToast('New Quincy match!');
    });
    socket.on('new_like', () => {
      if (typeof updateLikesBadge === 'function') updateLikesBadge();
    });
    setInterval(() => { if (socket && socket.connected) socket.emit('presence_heartbeat'); }, 30000);
  } catch (e) {
    console.warn('[Quincy] socket connect failed', e);
  }
}

function mapApiUserToProfile(u) {
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    age: u.age,
    occupation: u.occupation || '',
    intent: u.intent === 'long_term' ? 'long-term' : (u.intent || 'long-term'),
    verified: !!u.verified,
    avatar: u.avatar || (u.photos && u.photos[0]) || '',
    photos: u.photos && u.photos.length ? u.photos : (u.avatar ? [u.avatar] : []),
    interests: u.interests || [],
    basics: u.basics || [],
    promptTag: u.promptTag || 'Dating Intent',
    promptQuestion: u.promptQuestion || '',
    promptAnswer: u.promptAnswer || '',
    latitude: u.latitude ?? null,
    longitude: u.longitude ?? null,
    city: u.city || '',
    country: u.country || '',
    locationDisplay: [u.city, u.country].filter(Boolean).join(', ') || 'Location set',
    distanceNum: u.distanceMiles != null ? u.distanceMiles : null,
    distance: u.distanceMiles != null
      ? (u.distanceMiles < 10 ? u.distanceMiles.toFixed(1) : Math.round(u.distanceMiles)) + ' miles away'
      : 'Distance unknown',
    matchScore: '—',
    matchScoreNum: 0,
    isMock: false,
    isUser: true,
    createdAt: u.createdAt || new Date().toISOString(),
  };
}

/** Socket handlers used when USE_API is true */
function onSocketMessage(msg) {
  if (!msg || !msg.matchId) return;
  if (String(msg.matchId) !== String(activeChatMatchId)) {
    if (typeof updateMessagesBadge === 'function') updateMessagesBadge();
    return;
  }
  // Append into local cache shape used by renderChatThread
  const messages = loadFromStorage(STORAGE_MESSAGES, {});
  if (!messages[msg.matchId]) messages[msg.matchId] = [];
  if (!messages[msg.matchId].some(m => m.id === msg.id)) {
    messages[msg.matchId].push({
      id: msg.id,
      senderId: msg.senderId,
      senderName: '',
      text: msg.content || msg.text || '',
      timestamp: msg.createdAt || msg.timestamp || new Date().toISOString(),
      readAt: msg.readAt || null,
    });
    saveToStorage(STORAGE_MESSAGES, messages);
  }
  renderChatThread(msg.matchId);
  if (typeof markMessagesRead === 'function') markMessagesRead(msg.matchId);
  if (socket) socket.emit('mark_read', { matchId: msg.matchId });
}

function onSocketTyping(s) {
  if (!s || String(s.matchId) !== String(activeChatMatchId)) return;
  const el = document.getElementById('typingIndicator');
  if (!el) return;
  if (s.isTyping && currentUser && s.userId !== currentUser.id) el.classList.remove('hidden');
  else el.classList.add('hidden');
}

function onSocketRead(s) {
  if (!s || String(s.matchId) !== String(activeChatMatchId)) return;
  const messages = loadFromStorage(STORAGE_MESSAGES, {});
  const thread = messages[s.matchId] || [];
  thread.forEach(m => {
    if (currentUser && m.senderId === currentUser.id && !m.readAt) m.readAt = s.readAt;
  });
  messages[s.matchId] = thread;
  saveToStorage(STORAGE_MESSAGES, messages);
  renderChatThread(s.matchId);
}


document.addEventListener('DOMContentLoaded', () => {
  initAgeGate();
  initStatsCounter();
  initState();
  initHeroCard();
  initInteractiveSimulator();
  initMatchModal();
  initRegistration();
  initLogin();
  initFeatureModules();
  initLikesDrawer();
  initManageProfile();
  initMessages();
  initShareModule();
  initLocationFallback();
  initComments();
  initRealtimeSync();
  initPresenceHeartbeat();
  initPhotoUploadModule();
  updateUIForUser();
  if (USE_API) {
    connectSocket();
    // Load server feed after a short delay so geolocation / user state settle
    setTimeout(() => { if (typeof refreshFeedFromApi === 'function') refreshFeedFromApi(); }, 400);
  }
});

/* ==========================================================================
   STATE & STORAGE
   ========================================================================== */
const STORAGE_PROFILES = 'quincy_registered_profiles';
const STORAGE_LIKES = 'quincy_likes_received';
const STORAGE_CURRENT_USER = 'quincy_current_user';
const STORAGE_MATCHES = 'quincy_matches';
const STORAGE_MESSAGES = 'quincy_messages';
const STORAGE_SESSION = 'quincy_session_token';
const STORAGE_TYPING = 'quincy_typing';
const STORAGE_COMMENTS = 'quincy_profile_comments';
const STORAGE_PRESENCE = 'quincy_presence';
const ONLINE_THRESHOLD_MS = 3 * 60 * 1000; // active within last 3 minutes = "online"

const StorageAdapter = {
  async get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('StorageAdapter.set failed', e);
    }
  },
  async remove(key) {
    localStorage.removeItem(key);
  }
};

function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

let allProfiles = [];
let filteredProfiles = [];
let currentProfileIndex = 0;
let currentFilter = 'all';
let maxDistance = 25;
let currentUser = null;
let activeChatMatchId = null;
let preferredUnit = 'miles';
let chatPollTimer = null;
let typingClearTimer = null;
let searchQuery = '';
let ageMin = 18;
let ageMax = 99;
let activeCommentProfileId = null;
let heroProfile = null;
let heroStackedProfile = null;
let presenceHeartbeatTimer = null;
let heroRefreshTimer = null;

/** Fallback demo data shown only when no real (non-self) profiles exist yet */
const DEFAULT_HERO_PROFILE = {
  id: 'demo_sophia',
  name: 'Sophia',
  age: 27,
  occupation: 'Architect',
  avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
  photos: [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1488426862026-3ee34a7d66df?auto=format&fit=crop&w=800&q=80'
  ],
  promptTag: 'Dating Intent',
  promptQuestion: 'My non-negotiable Sunday ritual...',
  promptAnswer: 'Farmers market espresso run, design sketching in the park, and cooking pasta from scratch with someone who loves good conversation.',
  verified: true,
  locationDisplay: '2.4 miles away',
  matchScoreDisplay: '96% Match',
  interests: ['Architecture', 'Farmers Markets', 'Pasta', 'Design', 'Travel'],
  basics: ['🚭 Non-smoker', '🏋️ Sometimes', '🍸 Socially', '🐾 Love dogs'],
  intentLabel: 'Long-term',
  isDemoFallback: true
};
const DEFAULT_STACKED_PROFILE = {
  id: 'demo_julian',
  name: 'Julian',
  age: 29,
  occupation: 'Product Designer',
  avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
  photos: [
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=80',
    'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=800&q=80'
  ],
  locationDisplay: '1.8 miles away',
  interests: ['Product Design', 'Coffee', 'Hiking'],
  basics: ['🚭 Non-smoker'],
  isDemoFallback: true
};

/* Max photos per profile (media pipeline constraint) */
const MAX_PROFILE_PHOTOS = 8;

/** Normalize any profile to a photos[] array (backward compatible with single avatar). */
function getProfilePhotos(profile) {
  if (!profile) return [];
  if (Array.isArray(profile.photos) && profile.photos.length) {
    return profile.photos.filter(Boolean).slice(0, MAX_PROFILE_PHOTOS);
  }
  if (profile.avatar) return [profile.avatar];
  return ['https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80'];
}

function getPrimaryAvatar(profile) {
  const photos = getProfilePhotos(profile);
  return photos[0] || profile?.avatar || '';
}

/** Client-side image preload for adjacent carousel frames. */
const _preloadCache = new Set();
function preloadAdjacentPhotos(photos, index) {
  [index - 1, index + 1].forEach(i => {
    if (i < 0 || i >= photos.length) return;
    const url = photos[i];
    if (!url || _preloadCache.has(url)) return;
    const img = new Image();
    img.src = url;
    _preloadCache.add(url);
  });
}

/**
 * Build photo gallery DOM (story bars + images + tap zones + optional meta host).
 * Returns { root, setIndex, getIndex, destroy } controller.
 */
function createPhotoCarousel(photos, options = {}) {
  const {
    initialIndex = 0,
    showMeta = false,
    onIndexChange = null,
    className = ''
  } = options;
  const urls = (photos && photos.length) ? photos.slice(0, MAX_PROFILE_PHOTOS) : getProfilePhotos({});
  let index = Math.max(0, Math.min(initialIndex, urls.length - 1));

  const root = document.createElement('div');
  root.className = 'photo-gallery' + (className ? ' ' + className : '');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'Profile photos');

  const progress = document.createElement('div');
  progress.className = 'story-progress';
  urls.forEach((_, i) => {
    const seg = document.createElement('div');
    seg.className = 'story-segment' + (i < index ? ' filled' : (i === index ? ' active' : ''));
    if (i === index) {
      const fill = document.createElement('div');
      fill.className = 'story-fill';
      seg.appendChild(fill);
    }
    progress.appendChild(seg);
  });
  root.appendChild(progress);

  const imgEls = urls.map((url, i) => {
    const img = document.createElement('img');
    img.className = 'photo-gallery-img' + (i === index ? ' active' : '');
    img.src = url;
    img.alt = `Photo ${i + 1}`;
    img.loading = i === 0 ? 'eager' : 'lazy';
    img.draggable = false;
    root.appendChild(img);
    return img;
  });

  const leftZone = document.createElement('div');
  leftZone.className = 'gallery-tap-zone gallery-tap-left';
  leftZone.setAttribute('data-dir', 'prev');
  leftZone.setAttribute('aria-label', 'Previous photo');
  const rightZone = document.createElement('div');
  rightZone.className = 'gallery-tap-zone gallery-tap-right';
  rightZone.setAttribute('data-dir', 'next');
  rightZone.setAttribute('aria-label', 'Next photo');
  root.appendChild(leftZone);
  root.appendChild(rightZone);

  function syncUI() {
    imgEls.forEach((img, i) => img.classList.toggle('active', i === index));
    const segs = progress.querySelectorAll('.story-segment');
    segs.forEach((seg, i) => {
      seg.classList.remove('filled', 'active');
      seg.innerHTML = '';
      if (i < index) seg.classList.add('filled');
      else if (i === index) {
        seg.classList.add('active');
        const fill = document.createElement('div');
        fill.className = 'story-fill';
        seg.appendChild(fill);
      }
    });
    preloadAdjacentPhotos(urls, index);
    if (typeof onIndexChange === 'function') onIndexChange(index);
  }

  function setIndex(next) {
    if (!urls.length) return;
    index = ((next % urls.length) + urls.length) % urls.length;
    syncUI();
  }

  function next() { setIndex(index + 1); }
  function prev() { setIndex(index - 1); }

  leftZone.addEventListener('click', (e) => { e.stopPropagation(); prev(); });
  rightZone.addEventListener('click', (e) => { e.stopPropagation(); next(); });

  // Pointer / touch horizontal swipe
  let startX = 0, startY = 0, tracking = false;
  const onDown = (e) => {
    const pt = e.touches ? e.touches[0] : e;
    startX = pt.clientX;
    startY = pt.clientY;
    tracking = true;
  };
  const onUp = (e) => {
    if (!tracking) return;
    tracking = false;
    const pt = e.changedTouches ? e.changedTouches[0] : e;
    const dx = pt.clientX - startX;
    const dy = pt.clientY - startY;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    if (dx < 0) next();
    else prev();
  };
  root.addEventListener('touchstart', onDown, { passive: true });
  root.addEventListener('touchend', onUp, { passive: true });
  root.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    onDown(e);
  });
  root.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    onUp(e);
  });

  preloadAdjacentPhotos(urls, index);

  return {
    root,
    setIndex,
    getIndex: () => index,
    next,
    prev,
    destroy() {
      root.removeEventListener('touchstart', onDown);
      root.removeEventListener('touchend', onUp);
    }
  };
}

/** Intent display label helper */
function intentDisplayLabel(intent) {
  if (!intent) return 'Still figuring it out';
  const map = {
    marriage: 'Marriage',
    'long-term': 'Long-term',
    verified: 'Verified connections'
  };
  return map[intent] || String(intent);
}

function buildMetaChipsHtml(profile) {
  const chips = [];
  if (profile.verified) chips.push('<span class="meta-chip verified-chip">✓ Verified</span>');
  chips.push(`<span class="meta-chip intent">🎯 ${escapeHtml(intentDisplayLabel(profile.intent || profile.intentLabel))}</span>`);
  const interests = (profile.interests || []).slice(0, 4);
  interests.forEach(t => chips.push(`<span class="meta-chip">${escapeHtml(t)}</span>`));
  return chips.join('');
}

/* Undo stack for rewind (last passed profile) */
let undoStack = [];
const MAX_UNDO = 5;

function pushUndo(profile, action) {
  if (!profile || profile.isDemoFallback) return;
  undoStack.unshift({ profile, action, at: Date.now() });
  if (undoStack.length > MAX_UNDO) undoStack.length = MAX_UNDO;
}

function popUndo() {
  return undoStack.shift() || null;
}

/** Demo-only credential hash — replace with proper server-side auth in production */
function hashCredential(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return 'qh_' + Math.abs(h).toString(36) + btoa(unescape(encodeURIComponent(str))).slice(0, 12);
}

function generateSessionToken(userId) {
  return 'qs_' + userId + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ==========================================================================
   STRICT SELF-MATCH PREVENTION GUARD
   ========================================================================== */
/**
 * Returns true only when both profiles represent the exact same person.
 * Guards against ID collision, duplicate email, or identical metadata loops.
 */
function isSameUser(a, b) {
  if (!a || !b) return false;
  if (a.id && b.id && String(a.id) === String(b.id)) return true;
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) return true;
  // Extra metadata guard for edge-case self-registration loops
  if (
    a.name && b.name && a.age && b.age &&
    a.name.trim().toLowerCase() === b.name.trim().toLowerCase() &&
    Number(a.age) === Number(b.age) &&
    a.occupation && b.occupation &&
    a.occupation.trim().toLowerCase() === b.occupation.trim().toLowerCase()
  ) {
    return true;
  }
  return false;
}

function assertDistinctUsers(userA, userB, context = 'operation') {
  if (isSameUser(userA, userB)) {
    console.warn(`[Quincy Guard] Blocked self-${context}`);
    showToast('You cannot interact with your own profile.');
    return false;
  }
  return true;
}

/* ==========================================================================
   GEOLOCATION & HAVERSINE
   ========================================================================== */
function getDistanceHaversine(lat1, lon1, lat2, lon2, unit = 'miles') {
  if (
    lat1 == null || lon1 == null || lat2 == null || lon2 == null ||
    isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)
  ) {
    return null;
  }
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = unit === 'km' ? 6371 : 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.asin(Math.sqrt(a));
  return R * c;
}

function formatDistance(milesOrKm, unit = preferredUnit) {
  if (milesOrKm == null || isNaN(milesOrKm)) return 'Unknown distance';
  const val = milesOrKm < 10 ? milesOrKm.toFixed(1) : Math.round(milesOrKm);
  return unit === 'km' ? `${val} km away` : `${val} miles away`;
}

function requestGeolocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        });
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
    );
  });
}

async function reverseGeocode(lat, lon) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en', 'User-Agent': 'QuincyDating/1.0' }
    });
    if (!res.ok) throw new Error('geocode fail');
    const data = await res.json();
    const addr = data.address || {};
    const city = addr.city || addr.town || addr.village || addr.municipality || addr.county || '';
    const country = addr.country || '';
    return {
      city: city || 'Unknown',
      country: country || '',
      displayName: [city, country].filter(Boolean).join(', ') || `${lat.toFixed(3)}, ${lon.toFixed(3)}`
    };
  } catch {
    return {
      city: 'Unknown',
      country: '',
      displayName: `${lat.toFixed(3)}, ${lon.toFixed(3)}`
    };
  }
}

async function attachLocationToProfile(profile) {
  const coords = await requestGeolocation();
  if (coords) {
    profile.latitude = coords.latitude;
    profile.longitude = coords.longitude;
    const place = await reverseGeocode(coords.latitude, coords.longitude);
    profile.city = place.city;
    profile.country = place.country;
    profile.locationDisplay = place.displayName;
  } else {
    profile.latitude = null;
    profile.longitude = null;
    profile.city = '';
    profile.country = '';
    profile.locationDisplay = 'Location not set';
    setTimeout(() => openLocationFallbackModal(profile), 600);
  }
  return profile;
}

/* ==========================================================================
   COMPATIBILITY SCORING ENGINE
   ========================================================================== */
function calculateCompatibilityScore(userA, userB) {
  if (!userA || !userB || isSameUser(userA, userB)) return 0;

  let score = 55;

  // 1. Relationship Intent
  if (userA.intent && userB.intent) {
    if (userA.intent === userB.intent) {
      score += 22;
    } else if (
      (userA.intent === 'marriage' && userB.intent === 'long-term') ||
      (userA.intent === 'long-term' && userB.intent === 'marriage')
    ) {
      score += 14;
    } else {
      score += 4;
    }
  }

  // 2. Prompt / value alignment
  const tagA = (userA.promptTag || '').toLowerCase();
  const tagB = (userB.promptTag || '').toLowerCase();
  if (tagA && tagB) {
    if (tagA === tagB) score += 12;
    else if (
      (tagA.includes('relationship') && tagB.includes('relationship')) ||
      (tagA.includes('green') && tagB.includes('green')) ||
      (tagA.includes('sunday') && tagB.includes('sunday')) ||
      (tagA.includes('non-negotiable') && tagB.includes('non-negotiable'))
    ) {
      score += 8;
    } else {
      score += 3;
    }
  }

  // 3. Verification
  if (userA.verified && userB.verified) score += 8;
  else if (userA.verified || userB.verified) score += 3;

  // 4. Distance weight
  let distMiles = null;
  if (
    userA.latitude != null && userA.longitude != null &&
    userB.latitude != null && userB.longitude != null
  ) {
    distMiles = getDistanceHaversine(
      userA.latitude, userA.longitude,
      userB.latitude, userB.longitude,
      'miles'
    );
  }
  if (distMiles != null) {
    if (distMiles <= 5) score += 10;
    else if (distMiles <= 15) score += 6;
    else if (distMiles <= 30) score += 3;
    else if (distMiles <= 60) score += 1;
  } else {
    score += 2;
  }

  score = Math.max(62, Math.min(99, Math.round(score + (Math.random() * 4 - 2))));
  return score;
}

function enrichProfileForDisplay(profile) {
  const enriched = { ...profile };

  if (currentUser && currentUser.latitude != null && profile.latitude != null) {
    const miles = getDistanceHaversine(
      currentUser.latitude, currentUser.longitude,
      profile.latitude, profile.longitude,
      'miles'
    );
    const km = getDistanceHaversine(
      currentUser.latitude, currentUser.longitude,
      profile.latitude, profile.longitude,
      'km'
    );
    enriched.distanceNum = preferredUnit === 'km' ? km : miles;
    enriched.distance = formatDistance(enriched.distanceNum, preferredUnit);
  } else if (profile.distanceNum != null) {
    enriched.distance = formatDistance(profile.distanceNum, preferredUnit);
  } else {
    enriched.distanceNum = 99;
    enriched.distance = 'Distance unknown';
  }

  if (currentUser && !isSameUser(currentUser, profile)) {
    const pct = calculateCompatibilityScore(currentUser, profile);
    enriched.matchScore = `${pct}% Match`;
    enriched.matchScoreNum = pct;
  } else {
    enriched.matchScore = profile.matchScore || '—';
    enriched.matchScoreNum = 0;
  }

  return enriched;
}

/* ==========================================================================
   STATE INITIALISATION
   ========================================================================== */
function initState() {
  const registered = loadFromStorage(STORAGE_PROFILES, []);
  currentUser = loadFromStorage(STORAGE_CURRENT_USER, null);

  if (currentUser && !USE_API) {
    const session = loadFromStorage(STORAGE_SESSION, null);
    if (!session || session.userId !== currentUser.id || session.token !== currentUser.sessionToken) {
      currentUser = null;
      localStorage.removeItem(STORAGE_CURRENT_USER);
      localStorage.removeItem(STORAGE_SESSION);
    }
  }

  allProfiles = registered.filter(p => !p.isMock);
  applyFilters();

  // When API is configured, restore session from server cookies
  if (USE_API) {
    api('/api/users/me')
      .then((data) => {
        if (data && data.user) {
          currentUser = mapApiUserToProfile(data.user);
          saveToStorage(STORAGE_CURRENT_USER, currentUser);
          updateUIForUser();
          connectSocket();
          refreshFeedFromApi();
        }
      })
      .catch(() => {
        /* not logged in on server — keep local guest mode */
      });
  }
}

async function refreshFeedFromApi() {
  if (!USE_API) return;
  try {
    const lat = currentUser && currentUser.latitude != null ? currentUser.latitude : '';
    const lon = currentUser && currentUser.longitude != null ? currentUser.longitude : '';
    const params = new URLSearchParams({
      maxMiles: String(maxDistance || 25),
      ageMin: String(ageMin || 18),
      ageMax: String(ageMax || 99),
    });
    if (lat !== '' && lon !== '') {
      params.set('lat', String(lat));
      params.set('lon', String(lon));
    }
    if (currentFilter === 'marriage') params.set('intent', 'long-term');
    if (currentFilter === 'verified') params.set('verified', 'true');
    if (searchQuery) params.set('q', searchQuery);

    const data = await api('/api/discovery/feed?' + params.toString());
    const items = (data.items || []).map(mapApiUserToProfile).filter(Boolean);
    allProfiles = items;
    // Also merge into local cache for offline display helpers
    const registered = loadFromStorage(STORAGE_PROFILES, []);
    items.forEach((p) => {
      const idx = registered.findIndex((x) => String(x.id) === String(p.id));
      if (idx === -1) registered.push(p);
      else registered[idx] = { ...registered[idx], ...p };
    });
    saveToStorage(STORAGE_PROFILES, registered);
    applyFilters();
    renderCurrentCard();
    if (typeof renderHeroCard === 'function') renderHeroCard();
  } catch (e) {
    console.warn('[Quincy] feed load failed', e);
  }
}

function applyFilters() {
  const q = (searchQuery || '').trim().toLowerCase();
  const minA = Math.max(18, parseInt(ageMin, 10) || 18);
  const maxA = Math.min(99, parseInt(ageMax, 10) || 99);

  filteredProfiles = allProfiles
    .filter(p => {
      // CRITICAL: never show the current user to themselves
      if (currentUser && isSameUser(currentUser, p)) return false;

      // Age range
      const age = Number(p.age);
      if (!isNaN(age) && (age < minA || age > maxA)) return false;

      // Distance / proximity
      let dist = null;
      let hasRealCoords = false;
      if (
        currentUser &&
        currentUser.latitude != null && currentUser.longitude != null &&
        p.latitude != null && p.longitude != null
      ) {
        dist = getDistanceHaversine(
          currentUser.latitude, currentUser.longitude,
          p.latitude, p.longitude,
          preferredUnit === 'km' ? 'km' : 'miles'
        );
        hasRealCoords = true;
      }
      if (hasRealCoords && dist != null && dist > maxDistance) return false;

      // Intent / verification filters
      if (currentFilter === 'marriage') {
        if (!(p.intent === 'marriage' || p.intent === 'long-term')) return false;
      } else if (currentFilter === 'verified') {
        if (p.verified !== true) return false;
      }

      // Free-text search across occupation, prompt tag/question/answer, name, city
      if (q) {
        const hay = [
          p.occupation, p.promptTag, p.promptQuestion, p.promptAnswer,
          p.name, p.city, p.locationDisplay, p.intent
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    })
    .map(enrichProfileForDisplay)
    .sort((a, b) => {
      // Prioritize: verified > recent registration > compatibility > proximity
      const verDiff = (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
      if (verDiff !== 0) return verDiff;

      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (Math.abs(bTime - aTime) > 60000) return bTime - aTime; // newer first

      const scoreDiff = (b.matchScoreNum || 0) - (a.matchScoreNum || 0);
      if (Math.abs(scoreDiff) > 2) return scoreDiff;

      return (a.distanceNum || 99) - (b.distanceNum || 99);
    });

  currentProfileIndex = 0;
}

/* ==========================================================================
   PRESENCE (ONLINE / ACTIVE USER) TRACKING
   ========================================================================== */
function getPresenceMap() {
  return loadFromStorage(STORAGE_PRESENCE, {});
}

/** Marks the current logged-in user as active "right now". */
function touchPresence() {
  if (!currentUser) return;
  const presence = getPresenceMap();
  presence[currentUser.id] = Date.now();
  saveToStorage(STORAGE_PRESENCE, presence);
}

function isUserOnline(userId, presenceMap) {
  const map = presenceMap || getPresenceMap();
  const ts = map[userId];
  return !!ts && (Date.now() - ts) < ONLINE_THRESHOLD_MS;
}

function initPresenceHeartbeat() {
  touchPresence();
  clearInterval(presenceHeartbeatTimer);
  presenceHeartbeatTimer = setInterval(touchPresence, 20000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') touchPresence();
  });
  window.addEventListener('beforeunload', () => {
    // Best-effort: leave the timestamp as-is so the user "expires" out of
    // the online pool naturally rather than disappearing instantly.
  });
}

/* ==========================================================================
   AGE GATE
   ========================================================================== */
function initAgeGate() {
  const ageGateModal = document.getElementById('ageGateModal');
  const appContainer = document.getElementById('appContainer');
  const btnVerify = document.getElementById('btnAgeVerify');
  const btnDeny = document.getElementById('btnAgeDeny');
  const errorMsg = document.getElementById('ageErrorMessage');

  if (sessionStorage.getItem('quincy_age_verified') === 'true') {
    unlockPlatform();
  }

  btnVerify.addEventListener('click', () => {
    sessionStorage.setItem('quincy_age_verified', 'true');
    unlockPlatform();
  });

  btnDeny.addEventListener('click', () => {
    errorMsg.classList.remove('hidden');
  });

  function unlockPlatform() {
    ageGateModal.style.opacity = '0';
    ageGateModal.style.transition = 'opacity 300ms ease';
    setTimeout(() => {
      ageGateModal.classList.add('hidden');
      appContainer.classList.remove('content-blurred');
    }, 300);
  }
}

/* ==========================================================================
   HERO STATS
   ========================================================================== */
function initStatsCounter() {
  const statElements = document.querySelectorAll('.stat-value');
  let animated = false;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !animated) {
        animated = true;
        statElements.forEach(el => {
          const target = parseFloat(el.getAttribute('data-target'));
          animateValue(el, 0, target, 1500);
        });
      }
    });
  }, { threshold: 0.5 });

  const statsSection = document.querySelector('.hero-stats');
  if (statsSection) observer.observe(statsSection);

  function animateValue(obj, start, end, duration) {
    let startTimestamp = null;
    const isFloat = end % 1 !== 0;
    const step = (timestamp) => {
      if (!startTimestamp) startTimestamp = timestamp;
      const progress = Math.min((timestamp - startTimestamp) / duration, 1);
      const current = start + progress * (end - start);
      obj.innerHTML = isFloat ? current.toFixed(1) : Math.floor(current);
      if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }
}

/* ==========================================================================
   INTERACTIVE MATCHING PREVIEW
   ========================================================================== */
function initInteractiveSimulator() {
  const filters = document.querySelectorAll('.sim-filter');
  renderCurrentCard();
  updateSimLocationLabel();

  filters.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filters.forEach(f => f.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.getAttribute('data-filter');
      if (USE_API) refreshFeedFromApi();
      else { applyFilters(); renderCurrentCard(); }
      updateStatusText();
    });
  });

  const searchInput = document.getElementById('simSearchInput');
  if (searchInput) {
    let debounce;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        searchQuery = searchInput.value || '';
        if (USE_API) refreshFeedFromApi();
        else { applyFilters(); renderCurrentCard(); }
        updateStatusText();
      }, 220);
    });
  }

  const ageMinEl = document.getElementById('simAgeMin');
  const ageMaxEl = document.getElementById('simAgeMax');
  const onAgeChange = () => {
    ageMin = parseInt(ageMinEl?.value, 10) || 18;
    ageMax = parseInt(ageMaxEl?.value, 10) || 99;
    if (ageMin > ageMax) {
      const t = ageMin;
      ageMin = ageMax;
      ageMax = t;
    }
    if (USE_API) refreshFeedFromApi();
    else { applyFilters(); renderCurrentCard(); }
    updateStatusText();
  };
  if (ageMinEl) ageMinEl.addEventListener('change', onAgeChange);
  if (ageMaxEl) ageMaxEl.addEventListener('change', onAgeChange);
}

function updateSimLocationLabel() {
  const el = document.getElementById('simLocationLabel');
  if (!el) return;
  if (currentUser && currentUser.locationDisplay) {
    el.textContent = currentUser.locationDisplay;
  } else {
    el.textContent = 'Your area';
  }
}

function renderCurrentCard() {
  const cardStack = document.getElementById('simCardStack');
  const profile = filteredProfiles[currentProfileIndex];

  if (!profile) {
    const hasAnyRegistered = allProfiles.length > 0;
    cardStack.innerHTML = `
      <div class="sim-profile-card empty-state-card text-center" style="padding: 40px;">
        <div class="empty-state-icon" aria-hidden="true">♥</div>
        <h3>${hasAnyRegistered ? 'No matches in this radar' : 'No active profiles nearby yet'}</h3>
        <p style="color: var(--text-muted); margin: 12px 0 24px; line-height: 1.5;">
          ${hasAnyRegistered
            ? 'Try widening the proximity slider or switching filters. Or invite friends to join Quincy.'
            : 'Be the first intentional single in your area. Create a profile and start attracting real matches.'}
        </p>
        <div class="empty-state-actions">
          <button class="btn btn-primary btn-glow" onclick="document.getElementById('btnHeroRegister')?.click() || document.getElementById('btnOpenRegister')?.click()">
            ${currentUser ? 'Invite Others / Share' : 'Register Your Profile'}
          </button>
          ${currentUser ? `<button class="btn btn-outline" onclick="shareQuincyPlatform()">Share Quincy</button>` : ''}
          ${hasAnyRegistered ? `<button class="btn btn-outline" onclick="resetSimFilters()">Reset Filters & Distance</button>` : ''}
        </div>
      </div>
    `;
    updateStatusText(
      hasAnyRegistered
        ? 'No profiles match your current filters or distance. Adjust and try again.'
        : 'Be the first to register — your profile will appear here for others to discover.'
    );
    return;
  }

  // Final self-guard before render
  if (currentUser && isSameUser(currentUser, profile)) {
    advanceProfile();
    return;
  }

  const photos = getProfilePhotos(profile);
  const presence = getPresenceMap();
  const online = isUserOnline(profile.id, presence);
  const activityLabel = online ? 'Online now' : 'Recently active';
  const quote = profile.promptAnswer || profile.promptQuestion || '';
  const chipsHtml = buildMetaChipsHtml(profile);

  cardStack.innerHTML = `
    <div class="sim-profile-card" id="currentSimCard" data-profile-id="${escapeHtml(String(profile.id))}">
      <div id="simGalleryHost"></div>
      <div class="card-body-below">
        <div class="sim-prompt prompt-clickable" data-prompt-id="${profile.id}">
          <div class="sim-prompt-title">${escapeHtml(profile.promptTag || 'Prompt')}</div>
          <div class="sim-prompt-body">"${escapeHtml(profile.promptQuestion || '')}"</div>
          <button class="inline-like-btn" onclick="handleInlineLike('${profile.id}')">♥ Like Prompt</button>
        </div>
        <div class="floating-toolbar" id="simFloatingToolbar">
          <button type="button" class="ft-btn ft-rewind ${undoStack.length ? '' : 'disabled'}" onclick="handleSimRewind()" title="Rewind" aria-label="Rewind">↺</button>
          <button type="button" class="ft-btn ft-pass" onclick="handleSimAction('pass')" title="Pass" aria-label="Pass">✕</button>
          <button type="button" class="ft-btn ft-super" onclick="handleSimAction('super')" title="Super Like" aria-label="Super Like">★</button>
          <button type="button" class="ft-btn ft-like" onclick="handleSimAction('like')" title="Like" aria-label="Like">♥</button>
          <button type="button" class="ft-btn ft-boost" onclick="openCommentModal('${profile.id}')" title="Comment" aria-label="Comment">💬</button>
        </div>
      </div>
    </div>
  `;

  const host = document.getElementById('simGalleryHost');
  if (host) {
    const carousel = createPhotoCarousel(photos, { initialIndex: 0 });
    const meta = document.createElement('div');
    meta.className = 'gallery-meta-overlay';
    meta.innerHTML = `
      <div class="gallery-name-row">
        <span class="gallery-name">${escapeHtml(profile.name)}, ${profile.age}</span>
        ${profile.verified ? '<span class="verified-badge" title="ID Verified">✓</span>' : ''}
        <button type="button" class="gallery-expand-btn" onclick="openFullProfile('${profile.id}')" title="View full profile" aria-label="Expand">↑</button>
      </div>
      <div class="gallery-activity">
        <span class="activity-dot ${online ? '' : 'offline'}"></span>
        <span>${activityLabel}</span>
        <span style="opacity:0.7;margin-left:6px;">· ${escapeHtml(profile.matchScore || '')}</span>
      </div>
      <div class="gallery-distance">${escapeHtml(profile.occupation || '')} · ${escapeHtml(profile.distance || profile.locationDisplay || '')}</div>
      <div class="gallery-quote">${escapeHtml(quote)}</div>
      <div class="gallery-chips">${chipsHtml}</div>
    `;
    carousel.root.appendChild(meta);
    host.appendChild(carousel.root);
    host._carousel = carousel;
  }
  updateStatusText();
}

function handleSimAction(action) {
  const card = document.getElementById('currentSimCard');
  const currentProfile = filteredProfiles[currentProfileIndex];
  if (!currentProfile) return;

  if (currentUser && isSameUser(currentUser, currentProfile)) {
    showToast('You cannot interact with your own profile.');
    advanceProfile();
    return;
  }

  if (action === 'like' || action === 'super') {
    if (card) {
      card.classList.add('swipe-right');
      spawnHeartBurst(card);
    }
    if (action === 'super') {
      showToast(`★ Super Like sent to ${currentProfile.name}!`);
    }
    const isMutual = recordLike(currentProfile, false);
    pushUndo(currentProfile, action);
    setTimeout(() => {
      triggerMatchCelebration(currentProfile, isMutual);
    }, 280);
  } else if (action === 'pass') {
    if (card) card.classList.add('swipe-left');
    pushUndo(currentProfile, 'pass');
    setTimeout(() => advanceProfile(), 320);
  }
}

function handleSimRewind() {
  const item = popUndo();
  if (!item) {
    showToast('Nothing to rewind. Premium unlocks unlimited rewinds.');
    return;
  }
  // Re-insert profile into feed at current index
  const exists = filteredProfiles.some(p => String(p.id) === String(item.profile.id));
  if (!exists) {
    filteredProfiles.splice(currentProfileIndex, 0, enrichProfileForDisplay(item.profile));
  } else {
    currentProfileIndex = Math.max(0, filteredProfiles.findIndex(p => String(p.id) === String(item.profile.id)));
  }
  renderCurrentCard();
  showToast(`Rewound to ${item.profile.name}`);
}

function handleInlineLike(profileId) {
  const profile = allProfiles.find(p => String(p.id) === String(profileId));
  if (!profile) return;
  if (currentUser && isSameUser(currentUser, profile)) {
    showToast('You cannot like your own prompt.');
    return;
  }
  const btn = document.querySelector('.inline-like-btn');
  if (btn) {
    btn.classList.add('liked');
    btn.textContent = '♥ Liked';
  }
  const isMutual = recordLike(profile, true);
  if (isMutual) {
    showToast(`Mutual prompt connection with ${profile.name}! Messaging unlocked.`);
    triggerMatchCelebration(profile, true);
  } else {
    showToast(`You liked ${profile.name}'s prompt!`);
  }
}

function advanceProfile() {
  currentProfileIndex++;
  renderCurrentCard();
}

function resetSim() {
  currentProfileIndex = 0;
  applyFilters();
  renderCurrentCard();
}

function resetSimFilters() {
  currentFilter = 'all';
  maxDistance = 25;
  searchQuery = '';
  ageMin = 18;
  ageMax = 99;
  const slider = document.getElementById('proximitySlider');
  if (slider) {
    slider.value = 25;
    const valueLabel = document.getElementById('proximityValue');
    if (valueLabel) valueLabel.textContent = '25';
  }
  const searchInput = document.getElementById('simSearchInput');
  if (searchInput) searchInput.value = '';
  const ageMinEl = document.getElementById('simAgeMin');
  const ageMaxEl = document.getElementById('simAgeMax');
  if (ageMinEl) ageMinEl.value = 18;
  if (ageMaxEl) ageMaxEl.value = 99;
  document.querySelectorAll('.sim-filter').forEach(f => {
    f.classList.toggle('active', f.getAttribute('data-filter') === 'all');
  });
  applyFilters();
  renderCurrentCard();
  showToast('Filters, search and distance reset');
}

function updateStatusText(custom) {
  const el = document.getElementById('simStatusText');
  if (!el) return;
  if (custom) {
    el.textContent = custom;
    return;
  }
  const remaining = filteredProfiles.length - currentProfileIndex;
  el.textContent = remaining > 0
    ? `Click the heart to like a prompt, or pass to see the next verified profile. (${remaining} remaining)`
    : 'No more profiles match your current filters.';
}

/* ==========================================================================
   DYNAMIC HERO CARD ("Featured Member" — replaces hardcoded Sophia card)
   Priority: currently online/active user > most recently registered user >
   built-in demo fallback (only ever shown when zero real profiles exist).
   ========================================================================== */
function pickHeroProfile() {
  const pool = allProfiles.filter(p => !currentUser || !isSameUser(currentUser, p));
  if (!pool.length) return null;

  const presence = getPresenceMap();
  const online = pool
    .filter(p => isUserOnline(p.id, presence))
    .sort((a, b) => (presence[b.id] || 0) - (presence[a.id] || 0));
  if (online.length) return online[0];

  const byRecent = [...pool].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
  return byRecent[0];
}

function pickStackedProfile(excludeId) {
  const pool = allProfiles.filter(p =>
    (!currentUser || !isSameUser(currentUser, p)) && String(p.id) !== String(excludeId)
  );
  if (!pool.length) return null;

  const presence = getPresenceMap();
  const online = pool
    .filter(p => isUserOnline(p.id, presence))
    .sort((a, b) => (presence[b.id] || 0) - (presence[a.id] || 0));
  if (online.length) return online[0];

  const byRecent = [...pool].sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
  return byRecent[0];
}

function renderHeroCard() {
  const picked = pickHeroProfile();
  heroProfile = picked || DEFAULT_HERO_PROFILE;
  const isDemo = !!heroProfile.isDemoFallback;
  const enriched = isDemo ? null : enrichProfileForDisplay(heroProfile);

  const stackedPicked = picked ? pickStackedProfile(picked.id) : null;
  heroStackedProfile = stackedPicked || DEFAULT_STACKED_PROFILE;
  const stackedIsDemo = !!heroStackedProfile.isDemoFallback;

  const presence = getPresenceMap();
  const online = !isDemo && isUserOnline(heroProfile.id, presence);
  const photos = getProfilePhotos(heroProfile);

  // Rebuild hero photo gallery
  const wrap = document.getElementById('heroPhotoWrap');
  if (wrap) {
    wrap.innerHTML = '';
    const carousel = createPhotoCarousel(photos, { initialIndex: 0 });
    const meta = document.createElement('div');
    meta.className = 'gallery-meta-overlay';
    let locationText;
    if (isDemo) locationText = heroProfile.locationDisplay;
    else if (currentUser && enriched) locationText = enriched.distance;
    else locationText = heroProfile.locationDisplay || 'New member';
    const matchLabel = isDemo
      ? (heroProfile.matchScoreDisplay || '96% Match')
      : (currentUser && enriched ? `${enriched.matchScoreNum}% Match` : 'Featured Member');
    meta.innerHTML = `
      <div class="gallery-name-row">
        <span class="gallery-name" id="heroCardNameAge">${escapeHtml(heroProfile.name)}, ${heroProfile.age}</span>
        ${heroProfile.verified ? '<span class="verified-badge" id="heroCardVerifiedBadge" title="ID Verified">✓</span>' : '<span class="verified-badge hidden" id="heroCardVerifiedBadge">✓</span>'}
        <button type="button" class="gallery-expand-btn" id="heroExpandBtn" title="View full profile" aria-label="Expand">↑</button>
      </div>
      <div class="gallery-activity" id="heroActivityRow">
        <span class="activity-dot ${online || isDemo ? '' : 'offline'}" id="heroActivityDot"></span>
        <span id="heroLiveBadge">${isDemo ? 'Featured' : (online ? 'Online now' : 'Recently active')}</span>
        <span style="opacity:0.7;margin-left:6px;">· ${escapeHtml(matchLabel)}</span>
      </div>
      <div class="gallery-distance" id="heroCardSub">${escapeHtml(heroProfile.occupation || '')} · ${escapeHtml(locationText || '')}</div>
      <div class="gallery-quote" id="heroCardPromptAnswer">${escapeHtml(heroProfile.promptAnswer || '')}</div>
      <div class="gallery-chips" id="heroChips">${buildMetaChipsHtml(heroProfile)}</div>
    `;
    carousel.root.appendChild(meta);
    carousel.root.id = 'heroPhotoGallery';
    wrap.appendChild(carousel.root);
    wrap._carousel = carousel;

    document.getElementById('heroExpandBtn')?.addEventListener('click', () => {
      if (heroProfile && !heroProfile.isDemoFallback) openFullProfile(heroProfile.id);
      else if (heroProfile) openFullProfile('demo_sophia');
    });
  }

  // Legacy hidden pill for compatibility
  const pill = document.getElementById('heroCardMatchPill');
  if (pill) {
    if (isDemo) pill.textContent = heroProfile.matchScoreDisplay || '96% Match';
    else if (currentUser && enriched) pill.textContent = `${enriched.matchScoreNum}% Match`;
    else pill.textContent = 'Featured Member';
  }

  const promptBox = document.getElementById('heroCardPromptBox');
  if (promptBox) promptBox.setAttribute('data-prompt-id', String(heroProfile.id));

  const tag = document.getElementById('heroCardPromptTag');
  if (tag) tag.textContent = heroProfile.promptTag || 'Prompt';

  const q = document.getElementById('heroCardPromptQuestion');
  if (q) q.textContent = heroProfile.promptQuestion || '';

  const inlineLikeBtn = document.getElementById('heroInlineLikeBtn');
  if (inlineLikeBtn) {
    inlineLikeBtn.classList.remove('liked');
    inlineLikeBtn.textContent = '♥ Like Prompt';
  }

  // Stacked (background) card
  const stackAvatar = document.getElementById('heroStackedAvatar');
  if (stackAvatar) {
    stackAvatar.src = getPrimaryAvatar(heroStackedProfile);
    stackAvatar.alt = `${heroStackedProfile.name} Profile`;
  }
  const stackName = document.getElementById('heroStackedNameAge');
  if (stackName) stackName.textContent = `${heroStackedProfile.name}, ${heroStackedProfile.age}`;
  const stackSub = document.getElementById('heroStackedSub');
  if (stackSub) {
    let stackLocationText;
    if (stackedIsDemo) stackLocationText = heroStackedProfile.locationDisplay;
    else if (currentUser) stackLocationText = enrichProfileForDisplay(heroStackedProfile).distance;
    else stackLocationText = heroStackedProfile.locationDisplay || 'New member';
    stackSub.textContent = `${heroStackedProfile.occupation} • ${stackLocationText}`;
  }
}

function handleHeroAction(action) {
  if (!heroProfile) return;
  const card = document.getElementById('heroCardMain');

  if (heroProfile.isDemoFallback) {
    showToast(action === 'like'
      ? 'Register your profile to send real intentional likes!'
      : 'Register your profile to start discovering real members!');
    document.getElementById('btnHeroRegister')?.click();
    return;
  }
  if (currentUser && isSameUser(currentUser, heroProfile)) {
    showToast('You cannot interact with your own profile.');
    return;
  }

  if (action === 'like' || action === 'super') {
    if (card) {
      card.classList.add('swipe-right');
      spawnHeartBurst(card);
    }
    if (action === 'super') showToast(`★ Super Like sent to ${heroProfile.name}!`);
    const targetProfile = heroProfile;
    const isMutual = recordLike(targetProfile, false);
    setTimeout(() => {
      card?.classList.remove('swipe-right');
      renderHeroCard();
      triggerMatchCelebration(targetProfile, isMutual);
    }, 280);
  } else {
    if (card) card.classList.add('swipe-left');
    showToast(`Passed on ${heroProfile.name}.`);
    setTimeout(() => {
      card?.classList.remove('swipe-left');
      renderHeroCard();
    }, 320);
  }
}

function handleHeroInlineLike() {
  if (!heroProfile) return;
  if (heroProfile.isDemoFallback) {
    showToast('Register your profile to like real prompts and start matching.');
    document.getElementById('btnHeroRegister')?.click();
    return;
  }
  if (currentUser && isSameUser(currentUser, heroProfile)) {
    showToast('You cannot like your own prompt.');
    return;
  }

  const btn = document.getElementById('heroInlineLikeBtn');
  if (btn) {
    btn.classList.add('liked');
    btn.textContent = '♥ Liked';
  }
  const isMutual = recordLike(heroProfile, true);
  if (isMutual) {
    showToast(`Mutual prompt connection with ${heroProfile.name}! Messaging unlocked.`);
    triggerMatchCelebration(heroProfile, true);
  } else {
    showToast(`You liked ${heroProfile.name}'s prompt!`);
  }
}

function handleHeroComment() {
  if (!heroProfile) return;
  if (heroProfile.isDemoFallback) {
    showToast('Register your profile to comment on real members.');
    document.getElementById('btnHeroRegister')?.click();
    return;
  }
  openCommentModal(heroProfile.id);
}

function initHeroCard() {
  renderHeroCard();

  document.getElementById('heroBtnLike')?.addEventListener('click', () => handleHeroAction('like'));
  document.getElementById('heroBtnPass')?.addEventListener('click', () => handleHeroAction('pass'));
  document.getElementById('heroBtnSuper')?.addEventListener('click', () => handleHeroAction('super'));
  document.getElementById('heroBtnBoost')?.addEventListener('click', () => {
    if (heroProfile && !heroProfile.isDemoFallback) openCommentModal(heroProfile.id);
    else showToast('Register to message real members.');
  });
  document.getElementById('heroBtnRewind')?.addEventListener('click', () => {
    showToast('Rewind is available in the discovery feed. Premium unlocks unlimited rewinds.');
  });
  document.getElementById('heroInlineLikeBtn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    handleHeroInlineLike();
  });

  clearInterval(heroRefreshTimer);
  heroRefreshTimer = setInterval(renderHeroCard, 30000);

  initFullProfileDrawer();
}

/* ==========================================================================
   MATCH CELEBRATION
   ========================================================================== */
function initMatchModal() {
  const btnClose = document.getElementById('btnCloseMatchModal');
  const matchModal = document.getElementById('matchModal');
  const btnStartChat = document.getElementById('btnStartChatFromMatch');

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      matchModal.classList.add('hidden');
      document.getElementById('firstMoveIndicator')?.classList.add('hidden');
      advanceProfile();
    });
  }

  if (btnStartChat) {
    btnStartChat.addEventListener('click', () => {
      matchModal.classList.add('hidden');
      const matchId = btnStartChat.dataset.matchId;
      if (matchId) openChatWithMatch(matchId);
    });
  }
}

function triggerMatchCelebration(profile, isMutual = false) {
  if (currentUser && isSameUser(currentUser, profile)) return;

  const matchModal = document.getElementById('matchModal');
  const matchNameHeading = document.getElementById('matchNameHeading');
  const matchTargetAvatar = document.getElementById('matchTargetAvatar');
  const firstMove = document.getElementById('firstMoveIndicator');
  const userAvatar = document.getElementById('matchUserAvatar');
  const mutualBanner = document.getElementById('mutualMatchBanner');
  const btnStartChat = document.getElementById('btnStartChatFromMatch');

  if (matchNameHeading) matchNameHeading.innerText = `You & ${profile.name} Connected!`;
  if (matchTargetAvatar) matchTargetAvatar.src = getPrimaryAvatar(profile);
  if (currentUser && userAvatar) {
    userAvatar.src = getPrimaryAvatar(currentUser);
  } else if (userAvatar) {
    userAvatar.src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=200&q=80';
  }

  if (isMutual) {
    if (firstMove) firstMove.classList.add('hidden');
    if (mutualBanner) {
      mutualBanner.classList.remove('hidden');
      mutualBanner.textContent = 'Mutual Match! You can now message each other.';
    }
    if (btnStartChat) {
      btnStartChat.classList.remove('hidden');
      const matches = loadFromStorage(STORAGE_MATCHES, []);
      const match = matches.find(m =>
        (m.userA === currentUser?.id && m.userB === profile.id) ||
        (m.userB === currentUser?.id && m.userA === profile.id)
      );
      if (match) btnStartChat.dataset.matchId = match.id;
    }
  } else {
    if (firstMove) firstMove.classList.remove('hidden');
    if (mutualBanner) mutualBanner.classList.add('hidden');
    if (btnStartChat) btnStartChat.classList.add('hidden');
  }

  matchModal.classList.remove('hidden');
}

function spawnHeartBurst(container) {
  const burst = document.createElement('div');
  burst.className = 'heart-burst';
  burst.textContent = '♥';
  burst.style.left = '50%';
  burst.style.top = '40%';
  container.style.position = 'relative';
  container.appendChild(burst);
  setTimeout(() => burst.remove(), 900);
}

/* ==========================================================================
   REGISTRATION, LOGIN & PROFILE MANAGEMENT
   ========================================================================== */
function initRegistration() {
  const modal = document.getElementById('registerModal');
  const form = document.getElementById('registerForm');
  const btnOpen = document.getElementById('btnOpenRegister');
  const btnHero = document.getElementById('btnHeroRegister');
  const btnCancel = document.getElementById('btnCancelRegister');
  const switchToLogin = document.getElementById('switchToLogin');

  const open = () => {
    modal.classList.remove('hidden');
    document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
  };
  const close = () => modal.classList.add('hidden');

  if (btnOpen) btnOpen.addEventListener('click', () => {
    if (currentUser) openEditProfile();
    else open();
  });
  if (btnHero) btnHero.addEventListener('click', open);
  if (btnCancel) btnCancel.addEventListener('click', close);

  if (switchToLogin) {
    switchToLogin.addEventListener('click', (e) => {
      e.preventDefault();
      close();
      document.getElementById('loginModal')?.classList.remove('hidden');
    });
  }

  document.querySelectorAll('.avatar-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.avatar-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('regAvatar').value = btn.dataset.url;
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validateRegistrationForm()) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating…';
    }

    try {
      let profile = buildProfileFromForm();
      profile = await attachLocationToProfile(profile);

      if (USE_API) {
        const payload = {
          email: profile.email,
          password: document.getElementById('regPassword').value,
          name: profile.name,
          age: profile.age,
          occupation: profile.occupation,
          intent: profile.intent,
          verified: profile.verified,
          avatar: profile.avatar,
          photos: profile.photos || [],
          promptTag: profile.promptTag,
          promptQuestion: profile.promptQuestion,
          promptAnswer: profile.promptAnswer,
          latitude: profile.latitude,
          longitude: profile.longitude,
          city: profile.city,
          country: profile.country,
        };
        const data = await api('/api/auth/register', { method: 'POST', body: JSON.stringify(payload) });
        profile = mapApiUserToProfile(data.user);
        saveToStorage(STORAGE_CURRENT_USER, profile);
        currentUser = profile;
        connectSocket();
        await refreshFeedFromApi();
      } else {
        const registered = loadFromStorage(STORAGE_PROFILES, []);
        if (registered.some(p => p.email && p.email.toLowerCase() === profile.email.toLowerCase())) {
          const errEl = document.getElementById('errEmail');
          if (errEl) errEl.textContent = 'An account with this email already exists. Please log in.';
          return;
        }
        registered.push(profile);
        saveToStorage(STORAGE_PROFILES, registered);
        const token = generateSessionToken(profile.id);
        profile.sessionToken = token;
        saveToStorage(STORAGE_CURRENT_USER, profile);
        saveToStorage(STORAGE_SESSION, { userId: profile.id, token });
        currentUser = profile;
        allProfiles = registered.filter(p => !p.isMock);
        applyFilters();
        renderCurrentCard();
      }

      touchPresence();
      renderHeroCard();
      updateUIForUser();
      updateSimLocationLabel();
      pendingRegPhotos = [];
      renderRegPhotoGrid();
      close();
      showToast(`Welcome, ${profile.name}! Your profile is live and discoverable.`);
    } catch (err) {
      console.error(err);
      const errEl = document.getElementById('errEmail');
      if (errEl) errEl.textContent = err.message || 'Registration failed.';
      showToast(err.message || 'Registration failed.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Profile';
      }
    }
  });
}

function validateRegistrationForm() {
  let valid = true;
  const clear = (id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  };
  const err = (id, msg) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    valid = false;
  };

  ['errName','errAge','errOccupation','errIntent','errAvatar','errPromptQuestion','errPromptAnswer','errEmail','errPassword'].forEach(clear);

  const name = document.getElementById('regName').value.trim();
  const age = parseInt(document.getElementById('regAge').value, 10);
  const occupation = document.getElementById('regOccupation').value.trim();
  const intent = document.getElementById('regIntent').value;
  const avatar = document.getElementById('regAvatar').value.trim();
  const q = document.getElementById('regPromptQuestion').value.trim();
  const a = document.getElementById('regPromptAnswer').value.trim();
  const email = document.getElementById('regEmail')?.value.trim() || '';
  const password = document.getElementById('regPassword')?.value || '';

  document.querySelectorAll('#registerForm input, #registerForm select, #registerForm textarea').forEach(el => el.classList.remove('invalid'));

  if (!name || name.length < 2) {
    err('errName', 'Please enter a valid name (2+ characters).');
    document.getElementById('regName').classList.add('invalid');
  }
  if (isNaN(age) || age < 18 || age > 99) {
    err('errAge', 'Age must be between 18 and 99.');
    document.getElementById('regAge').classList.add('invalid');
  }
  if (!occupation) {
    err('errOccupation', 'Occupation is required.');
    document.getElementById('regOccupation').classList.add('invalid');
  }
  if (!intent) {
    err('errIntent', 'Please select a relationship intent.');
    document.getElementById('regIntent').classList.add('invalid');
  }
  if (avatar && !/^https?:\/\/.+/i.test(avatar)) {
    err('errAvatar', 'Please enter a valid image URL or leave blank.');
    document.getElementById('regAvatar').classList.add('invalid');
  }
  if (!q) {
    err('errPromptQuestion', 'Prompt question is required.');
    document.getElementById('regPromptQuestion').classList.add('invalid');
  }
  if (!a || a.length < 10) {
    err('errPromptAnswer', 'Please write a meaningful answer (10+ characters).');
    document.getElementById('regPromptAnswer').classList.add('invalid');
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    err('errEmail', 'Please enter a valid email address.');
    document.getElementById('regEmail')?.classList.add('invalid');
  }
  if (!password || password.length < 6) {
    err('errPassword', 'Password must be at least 6 characters.');
    document.getElementById('regPassword')?.classList.add('invalid');
  }

  return valid;
}

function buildProfileFromForm() {
  const name = document.getElementById('regName').value.trim();
  const age = parseInt(document.getElementById('regAge').value, 10);
  const occupation = document.getElementById('regOccupation').value.trim();
  const intent = document.getElementById('regIntent').value;
  const verified = document.getElementById('regVerified').checked;
  let avatar = document.getElementById('regAvatar').value.trim();
  if (!avatar) {
    avatar = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80';
  }
  const promptTag = document.getElementById('regPromptTag').value;
  const promptQuestion = document.getElementById('regPromptQuestion').value.trim();
  const promptAnswer = document.getElementById('regPromptAnswer').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPassword').value;

  const photos = pendingRegPhotos.length
    ? pendingRegPhotos.slice(0, MAX_PROFILE_PHOTOS)
    : [avatar];
  const primary = photos[0] || avatar;

  return {
    id: 'usr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    name,
    age,
    occupation,
    distance: 'Calculating…',
    distanceNum: null,
    matchScore: '—',
    intent,
    verified,
    avatar: primary,
    photos,
    interests: [],
    basics: [],
    promptTag,
    promptQuestion,
    promptAnswer,
    email,
    passwordHash: hashCredential(password),
    isUser: true,
    isMock: false,
    latitude: null,
    longitude: null,
    city: '',
    country: '',
    locationDisplay: '',
    createdAt: new Date().toISOString()
  };
}

function initLogin() {
  const modal = document.getElementById('loginModal');
  const form = document.getElementById('loginForm');
  const btnOpen = document.getElementById('btnOpenLogin');
  const btnCancel = document.getElementById('btnCancelLogin');
  const switchToRegister = document.getElementById('switchToRegister');

  if (btnOpen) btnOpen.addEventListener('click', () => modal?.classList.remove('hidden'));
  if (btnCancel) btnCancel.addEventListener('click', () => modal?.classList.add('hidden'));
  if (switchToRegister) {
    switchToRegister.addEventListener('click', (e) => {
      e.preventDefault();
      modal?.classList.add('hidden');
      document.getElementById('registerModal')?.classList.remove('hidden');
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value.trim().toLowerCase();
      const password = document.getElementById('loginPassword').value;
      const errEl = document.getElementById('loginError');

      if (!email || !password) {
        if (errEl) errEl.textContent = 'Email and password are required.';
        return;
      }

      try {
        let user = null;
        if (USE_API) {
          const data = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password }),
          });
          user = mapApiUserToProfile(data.user);
          if (user.latitude == null || user.longitude == null) {
            const updated = await attachLocationToProfile({ ...user });
            Object.assign(user, updated);
            try {
              await api('/api/users/me', {
                method: 'PATCH',
                body: JSON.stringify({
                  latitude: user.latitude,
                  longitude: user.longitude,
                  city: user.city,
                  country: user.country,
                }),
              });
            } catch (_) { /* optional */ }
          }
          saveToStorage(STORAGE_CURRENT_USER, user);
          currentUser = user;
          connectSocket();
          await refreshFeedFromApi();
        } else {
          const registered = loadFromStorage(STORAGE_PROFILES, []);
          user = registered.find(p => p.email === email);
          if (!user || user.passwordHash !== hashCredential(password)) {
            if (errEl) errEl.textContent = 'Invalid email or password.';
            return;
          }
          if (user.latitude == null || user.longitude == null) {
            const updated = await attachLocationToProfile({ ...user });
            Object.assign(user, updated);
            const idx = registered.findIndex(p => p.id === user.id);
            if (idx !== -1) {
              registered[idx] = user;
              saveToStorage(STORAGE_PROFILES, registered);
            }
          }
          const token = generateSessionToken(user.id);
          user.sessionToken = token;
          const idx = registered.findIndex(p => p.id === user.id);
          if (idx !== -1) {
            registered[idx] = user;
            saveToStorage(STORAGE_PROFILES, registered);
          }
          saveToStorage(STORAGE_CURRENT_USER, user);
          saveToStorage(STORAGE_SESSION, { userId: user.id, token });
          currentUser = user;
          allProfiles = registered.filter(p => !p.isMock);
          applyFilters();
          renderCurrentCard();
        }

        touchPresence();
        renderHeroCard();
        updateUIForUser();
        updateSimLocationLabel();
        modal.classList.add('hidden');
        showToast(`Welcome back, ${user.name}!`);
      } catch (err) {
        if (errEl) errEl.textContent = err.message || 'Invalid email or password.';
      }
    });
  }
}

function initManageProfile() {
  const eraseModal = document.getElementById('eraseConfirmModal');
  const btnConfirm = document.getElementById('btnConfirmErase');
  const btnCancel = document.getElementById('btnCancelErase');
  const btnLogout = document.getElementById('btnLogout');
  const btnEditProfile = document.getElementById('btnEditProfile');
  const btn = document.getElementById('btnManageProfile');

  if (btn) {
    btn.addEventListener('click', () => {
      const managePanel = document.getElementById('manageProfilePanel');
      if (managePanel) managePanel.classList.remove('hidden');
      else eraseModal.classList.remove('hidden');
    });
  }

  if (btnEditProfile) {
    btnEditProfile.addEventListener('click', () => {
      document.getElementById('manageProfilePanel')?.classList.add('hidden');
      openEditProfile();
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      logoutUser();
      document.getElementById('manageProfilePanel')?.classList.add('hidden');
    });
  }

  const btnCloseManage = document.getElementById('btnCloseManagePanel');
  if (btnCloseManage) {
    btnCloseManage.addEventListener('click', () => {
      document.getElementById('manageProfilePanel')?.classList.add('hidden');
    });
  }

  if (btnCancel) btnCancel.addEventListener('click', () => eraseModal.classList.add('hidden'));
  if (btnConfirm) {
    btnConfirm.addEventListener('click', () => {
      if (!currentUser) return;
      let registered = loadFromStorage(STORAGE_PROFILES, []);
      registered = registered.filter(p => p.id !== currentUser.id);
      saveToStorage(STORAGE_PROFILES, registered);
      localStorage.removeItem(STORAGE_CURRENT_USER);
      localStorage.removeItem(STORAGE_SESSION);
      currentUser = null;

      allProfiles = registered.filter(p => !p.isMock);
      applyFilters();
      renderCurrentCard();
      renderHeroCard();
      updateUIForUser();
      eraseModal.classList.add('hidden');
      document.getElementById('manageProfilePanel')?.classList.add('hidden');
      showToast('Your profile has been permanently erased.');
    });
  }

  const btnEraseFromManage = document.getElementById('btnEraseFromManage');
  if (btnEraseFromManage) {
    btnEraseFromManage.addEventListener('click', () => {
      document.getElementById('manageProfilePanel')?.classList.add('hidden');
      eraseModal.classList.remove('hidden');
    });
  }
}

function openEditProfile() {
  if (!currentUser) return;
  const modal = document.getElementById('editProfileModal');
  if (!modal) return;

  document.getElementById('editName').value = currentUser.name || '';
  document.getElementById('editAge').value = currentUser.age || '';
  document.getElementById('editOccupation').value = currentUser.occupation || '';
  document.getElementById('editIntent').value = currentUser.intent || '';
  document.getElementById('editAvatar').value = currentUser.avatar || '';
  document.getElementById('editPromptTag').value = currentUser.promptTag || 'Relationship Goal';
  document.getElementById('editPromptQuestion').value = currentUser.promptQuestion || '';
  document.getElementById('editPromptAnswer').value = currentUser.promptAnswer || '';
  document.getElementById('editVerified').checked = !!currentUser.verified;

  modal.classList.remove('hidden');
}

function saveEditedProfile() {
  if (!currentUser) return;

  const name = document.getElementById('editName').value.trim();
  const age = parseInt(document.getElementById('editAge').value, 10);
  const occupation = document.getElementById('editOccupation').value.trim();
  const intent = document.getElementById('editIntent').value;
  const avatar = document.getElementById('editAvatar').value.trim() || currentUser.avatar;
  const promptTag = document.getElementById('editPromptTag').value;
  const promptQuestion = document.getElementById('editPromptQuestion').value.trim();
  const promptAnswer = document.getElementById('editPromptAnswer').value.trim();
  const verified = document.getElementById('editVerified').checked;

  if (!name || name.length < 2 || isNaN(age) || age < 18 || !occupation || !intent || !promptQuestion || promptAnswer.length < 10) {
    showToast('Please fill all required fields correctly.');
    return;
  }

  currentUser.name = name;
  currentUser.age = age;
  currentUser.occupation = occupation;
  currentUser.intent = intent;
  currentUser.avatar = avatar;
  currentUser.promptTag = promptTag;
  currentUser.promptQuestion = promptQuestion;
  currentUser.promptAnswer = promptAnswer;
  currentUser.verified = verified;

  let registered = loadFromStorage(STORAGE_PROFILES, []);
  const idx = registered.findIndex(p => p.id === currentUser.id);
  if (idx !== -1) {
    registered[idx] = { ...registered[idx], ...currentUser };
    saveToStorage(STORAGE_PROFILES, registered);
  }
  saveToStorage(STORAGE_CURRENT_USER, currentUser);

  allProfiles = registered.filter(p => !p.isMock);
  applyFilters();
  renderCurrentCard();
  renderHeroCard();
  updateUIForUser();
  document.getElementById('editProfileModal')?.classList.add('hidden');
  showToast('Profile updated successfully.');
}

function logoutUser() {
  stopChatPolling();
  clearInterval(presenceHeartbeatTimer);
  localStorage.removeItem(STORAGE_CURRENT_USER);
  localStorage.removeItem(STORAGE_SESSION);
  currentUser = null;
  activeChatMatchId = null;
  applyFilters();
  renderCurrentCard();
  renderHeroCard();
  updateUIForUser();
  showToast('You have been logged out.');
}

function updateUIForUser() {
  const manageBtn = document.getElementById('btnManageProfile');
  const regBtn = document.getElementById('btnOpenRegister');
  const loginBtn = document.getElementById('btnOpenLogin');
  const messagesBtn = document.getElementById('btnOpenMessages');
  const userChip = document.getElementById('navUserChip');
  const shareBtn = document.getElementById('btnSharePlatform');

  if (currentUser) {
    if (manageBtn) manageBtn.classList.remove('hidden');
    if (regBtn) {
      regBtn.textContent = 'Edit Profile';
      regBtn.classList.remove('btn-glow');
    }
    if (loginBtn) loginBtn.classList.add('hidden');
    if (messagesBtn) messagesBtn.classList.remove('hidden');
    if (shareBtn) shareBtn.classList.remove('hidden');
    if (userChip) {
      userChip.classList.remove('hidden');
      userChip.innerHTML = `<img src="${currentUser.avatar}" alt="" class="nav-user-avatar" /><span>${escapeHtml(currentUser.name)}</span>`;
    }
  } else {
    if (manageBtn) manageBtn.classList.add('hidden');
    if (regBtn) {
      regBtn.textContent = 'Try Demo / Register';
      regBtn.classList.add('btn-glow');
    }
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (messagesBtn) messagesBtn.classList.add('hidden');
    if (shareBtn) shareBtn.classList.remove('hidden');
    if (userChip) userChip.classList.add('hidden');
  }
  updateLikesBadge();
  updateMessagesBadge();
}

/* ==========================================================================
   LIKES, MUTUAL MATCHES
   ========================================================================== */
/**
 * Record an intentional like or prompt like.
 * Mutual match is created ONLY when a distinct reverse like already exists.
 */
function recordLike(targetProfile, isPromptOnly = false) {
  if (!targetProfile) return false;
  if (currentUser && isSameUser(currentUser, targetProfile)) {
    showToast('You cannot like your own profile.');
    return false;
  }

  // API mode: fire-and-forget server like; mutual handled by server
  if (USE_API && currentUser && !targetProfile.isDemoFallback) {
    api('/api/likes', {
      method: 'POST',
      body: JSON.stringify({ receiverId: targetProfile.id, isPromptOnly: !!isPromptOnly }),
    })
      .then((data) => {
        updateLikesBadge();
        if (data && data.mutual) {
          showToast(`New match with ${targetProfile.name}! Messaging is now open.`);
          updateMessagesBadge();
        }
      })
      .catch((err) => {
        console.warn(err);
        showToast(err.message || 'Could not send like.');
      });
    return false; // celebration may still run; mutual toast comes from server
  }

  const likes = loadFromStorage(STORAGE_LIKES, []);
  const entry = {
    likedByUserId: currentUser ? currentUser.id : 'guest',
    likedByName: currentUser ? currentUser.name : 'Guest',
    targetUserId: targetProfile.id,
    targetName: targetProfile.name,
    targetAvatar: targetProfile.avatar,
    timestamp: new Date().toISOString(),
    promptId: targetProfile.id,
    isPromptOnly
  };
  likes.unshift(entry);
  if (likes.length > 200) likes.length = 200;
  saveToStorage(STORAGE_LIKES, likes);
  updateLikesBadge();

  let isMutual = false;
  if (currentUser && !targetProfile.isMock) {
    const reverseLike = likes.find(l =>
      l.likedByUserId === targetProfile.id &&
      l.targetUserId === currentUser.id &&
      !l.isPromptOnly &&
      l.likedByUserId !== l.targetUserId
    );
    const reversePrompt = isPromptOnly
      ? likes.find(l =>
          l.likedByUserId === targetProfile.id &&
          l.targetUserId === currentUser.id &&
          l.likedByUserId !== l.targetUserId
        )
      : null;

    if (reverseLike || reversePrompt) {
      isMutual = true;
      createMatch(currentUser, targetProfile);
    }
  }

  return isMutual;
}

function createMatch(userA, userB) {
  if (!assertDistinctUsers(userA, userB, 'match')) return;

  const matches = loadFromStorage(STORAGE_MATCHES, []);
  const exists = matches.some(m =>
    (m.userA === userA.id && m.userB === userB.id) ||
    (m.userB === userA.id && m.userA === userB.id)
  );
  if (exists) return;

  const match = {
    id: 'match_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    userA: userA.id,
    userB: userB.id,
    userAName: userA.name,
    userBName: userB.name,
    userAAvatar: userA.avatar,
    userBAvatar: userB.avatar,
    createdAt: new Date().toISOString(),
    isSoft: false
  };
  matches.unshift(match);
  saveToStorage(STORAGE_MATCHES, matches);
  updateMessagesBadge();
  showToast(`New match with ${userB.name}! Messaging is now open.`);
}

function initLikesDrawer() {
  const drawer = document.getElementById('likesDrawer');
  const btnOpen = document.getElementById('btnOpenLikesDrawer');
  const btnClose = document.getElementById('btnCloseLikesDrawer');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      renderLikesList();
      drawer.classList.remove('hidden');
    });
  }
  if (btnClose) btnClose.addEventListener('click', () => drawer.classList.add('hidden'));
  drawer?.addEventListener('click', (e) => {
    if (e.target === drawer) drawer.classList.add('hidden');
  });
}

function renderLikesList() {
  const list = document.getElementById('likesList');
  const empty = document.getElementById('likesEmpty');
  const likes = loadFromStorage(STORAGE_LIKES, []);

  // "Who Liked You" — only likes received by the current user from others
  let relevant = [];
  if (currentUser) {
    relevant = likes.filter(l =>
      l.targetUserId === currentUser.id &&
      l.likedByUserId !== currentUser.id &&
      l.likedByUserId !== 'guest'
    );
  } else {
    relevant = likes.filter(l => l.likedByUserId !== l.targetUserId).slice(0, 20);
  }

  if (!relevant.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  // Resolve liker profile for avatar/name when possible
  list.innerHTML = relevant.map(l => {
    const liker = allProfiles.find(p => String(p.id) === String(l.likedByUserId));
    const displayName = liker ? liker.name : (l.likedByName || 'Someone');
    const displayAvatar = liker ? liker.avatar : (l.targetAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80');
    const isMutual = currentUser ? hasMutualMatch(currentUser.id, l.likedByUserId) : false;
    const actionLabel = isMutual ? 'Open chat' : 'Like back & message';
    return `
      <div class="like-item" role="button" tabindex="0" data-liker-id="${escapeHtml(String(l.likedByUserId))}" onclick="handleLikeItemClick('${escapeHtml(String(l.likedByUserId))}')">
        <img src="${displayAvatar}" alt="" />
        <div class="like-item-info">
          <h4>${escapeHtml(displayName)}</h4>
          <p>${l.isPromptOnly ? 'Liked your prompt' : 'Sent intentional like'} · ${formatTime(l.timestamp)}</p>
          <span class="like-item-action">${actionLabel} →</span>
        </div>
      </div>
    `;
  }).join('');
}

function hasMutualMatch(userIdA, userIdB) {
  if (!userIdA || !userIdB || userIdA === userIdB) return false;
  const matches = loadFromStorage(STORAGE_MATCHES, []);
  return matches.some(m =>
    (m.userA === userIdA && m.userB === userIdB) ||
    (m.userB === userIdA && m.userA === userIdB)
  );
}

/**
 * From "Who Liked You": establish mutual match if needed, then open 1-on-1 chat.
 */
function handleLikeItemClick(likerId) {
  if (!currentUser) {
    showToast('Please log in to message people who liked you.');
    document.getElementById('likesDrawer')?.classList.add('hidden');
    document.getElementById('loginModal')?.classList.remove('hidden');
    return;
  }
  if (String(likerId) === String(currentUser.id)) {
    showToast('You cannot message yourself.');
    return;
  }

  const likerProfile = allProfiles.find(p => String(p.id) === String(likerId));
  if (!likerProfile) {
    showToast('That profile is no longer available.');
    return;
  }

  // Ensure mutual match exists (like-back if needed)
  if (!hasMutualMatch(currentUser.id, likerId)) {
    // Record reverse like from current user to establish mutual
    recordLike(likerProfile, false);
  }

  // Find or create match id
  let matches = loadFromStorage(STORAGE_MATCHES, []);
  let match = matches.find(m =>
    (m.userA === currentUser.id && m.userB === likerId) ||
    (m.userB === currentUser.id && m.userA === likerId)
  );
  if (!match) {
    createMatch(currentUser, likerProfile);
    matches = loadFromStorage(STORAGE_MATCHES, []);
    match = matches.find(m =>
      (m.userA === currentUser.id && m.userB === likerId) ||
      (m.userB === currentUser.id && m.userA === likerId)
    );
  }

  document.getElementById('likesDrawer')?.classList.add('hidden');
  if (match) {
    openChatWithMatch(match.id);
  } else {
    showToast('Unable to open conversation. Please try again.');
  }
}

function updateLikesBadge() {
  const badge = document.getElementById('likesBadge');
  if (!badge) return;
  const likes = loadFromStorage(STORAGE_LIKES, []);
  const count = currentUser
    ? likes.filter(l => l.targetUserId === currentUser.id && l.likedByUserId !== currentUser.id).length
    : likes.length;
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return d.toLocaleDateString();
  } catch {
    return '';
  }
}

/* ==========================================================================
   MESSAGING SYSTEM + REAL-TIME SYNC
   ========================================================================== */
function initMessages() {
  const drawer = document.getElementById('messagesDrawer');
  const btnOpen = document.getElementById('btnOpenMessages');
  const btnClose = document.getElementById('btnCloseMessages');
  const chatForm = document.getElementById('chatForm');
  const btnBackToMatches = document.getElementById('btnBackToMatches');
  const chatInput = document.getElementById('chatInput');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      renderMatchesList();
      drawer?.classList.remove('hidden');
      document.getElementById('matchesListView')?.classList.remove('hidden');
      document.getElementById('chatView')?.classList.add('hidden');
    });
  }
  if (btnClose) {
    btnClose.addEventListener('click', () => {
      stopChatPolling();
      drawer?.classList.add('hidden');
    });
  }
  drawer?.addEventListener('click', (e) => {
    if (e.target === drawer) {
      stopChatPolling();
      drawer.classList.add('hidden');
    }
  });

  if (btnBackToMatches) {
    btnBackToMatches.addEventListener('click', () => {
      stopChatPolling();
      document.getElementById('matchesListView')?.classList.remove('hidden');
      document.getElementById('chatView')?.classList.add('hidden');
      activeChatMatchId = null;
      clearTypingIndicator();
    });
  }

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sendChatMessage();
    });
  }

  // Typing indicator: broadcast while user types
  if (chatInput) {
    chatInput.addEventListener('input', () => {
      if (!activeChatMatchId || !currentUser) return;
      broadcastTyping(true);
      clearTimeout(typingClearTimer);
      typingClearTimer = setTimeout(() => broadcastTyping(false), 1800);
    });
  }

  const btnSaveEdit = document.getElementById('btnSaveEditProfile');
  if (btnSaveEdit) btnSaveEdit.addEventListener('click', saveEditedProfile);
  const btnCancelEdit = document.getElementById('btnCancelEditProfile');
  if (btnCancelEdit) {
    btnCancelEdit.addEventListener('click', () => {
      document.getElementById('editProfileModal')?.classList.add('hidden');
    });
  }
}

function getMatchesForCurrentUser() {
  if (!currentUser) return [];
  const matches = loadFromStorage(STORAGE_MATCHES, []);
  return matches.filter(m =>
    (m.userA === currentUser.id || m.userB === currentUser.id) &&
    m.userA !== m.userB
  );
}

function renderMatchesList() {
  const list = document.getElementById('matchesList');
  const empty = document.getElementById('matchesEmpty');

  const paint = (matches) => {
    if (!matches.length) {
      if (list) list.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    list.innerHTML = matches.map(m => {
      const isA = m.userA === currentUser.id;
      const otherName = m.otherName || (isA ? m.userBName : m.userAName);
      const otherAvatar = m.otherAvatar || (isA ? m.userBAvatar : m.userAAvatar) || '';
      const lastMsg = getLastMessage(m.id);
      return `
      <div class="match-item" onclick="openChatWithMatch('${m.id}')">
        <img src="${otherAvatar}" alt="" />
        <div class="match-item-info">
          <h4>${escapeHtml(otherName || 'Match')}</h4>
          <p>${lastMsg ? escapeHtml(lastMsg.text).slice(0, 40) + (lastMsg.text.length > 40 ? '…' : '') : 'Say hello!'}</p>
        </div>
        <span class="match-time">${formatTime(lastMsg ? lastMsg.timestamp : m.createdAt)}</span>
      </div>`;
    }).join('');
  };

  if (USE_API && currentUser) {
    api('/api/matches')
      .then((data) => {
        const matches = (data.items || []).map((m) => ({
          id: m.id,
          createdAt: m.createdAt,
          userA: currentUser.id,
          userB: m.other && m.other.id,
          otherName: m.other && m.other.name,
          otherAvatar: m.other && (m.other.avatar || (m.other.photos && m.other.photos[0])),
          userAName: currentUser.name,
          userBName: m.other && m.other.name,
          userAAvatar: currentUser.avatar,
          userBAvatar: m.other && m.other.avatar,
        }));
        saveToStorage(STORAGE_MATCHES, matches);
        paint(matches);
      })
      .catch(() => paint(getMatchesForCurrentUser()));
    return;
  }
  paint(getMatchesForCurrentUser());
}

function getLastMessage(matchId) {
  const messages = loadFromStorage(STORAGE_MESSAGES, {});
  const thread = messages[matchId] || [];
  return thread.length ? thread[thread.length - 1] : null;
}

function openChatWithMatch(matchId) {
  if (!currentUser) {
    showToast('Please log in to message matches.');
    return;
  }

  activeChatMatchId = matchId;

  // Prefer API match list cache if present
  const matches = loadFromStorage(STORAGE_MATCHES, []);
  let match = matches.find(m => m.id === matchId);

  if (match) {
    if (match.userA === match.userB) {
      showToast('Invalid match — cannot open chat with yourself.');
      return;
    }
    if (match.userA && match.userB && match.userA !== currentUser.id && match.userB !== currentUser.id) {
      showToast('You are not part of this match.');
      return;
    }
    const isA = match.userA === currentUser.id;
    const otherName = match.otherName || (isA ? match.userBName : match.userAName);
    const otherAvatar = match.otherAvatar || (isA ? match.userBAvatar : match.userAAvatar);
    document.getElementById('chatPartnerName').textContent = otherName || 'Match';
    document.getElementById('chatPartnerAvatar').src = otherAvatar || '';
  }

  document.getElementById('matchesListView')?.classList.add('hidden');
  document.getElementById('chatView')?.classList.remove('hidden');
  document.getElementById('messagesDrawer')?.classList.remove('hidden');

  if (USE_API) {
    api('/api/matches/' + encodeURIComponent(matchId) + '/messages')
      .then((data) => {
        const messages = loadFromStorage(STORAGE_MESSAGES, {});
        messages[matchId] = (data.items || []).map((m) => ({
          id: m.id,
          senderId: m.senderId,
          text: m.content || m.text || '',
          timestamp: m.createdAt || m.timestamp,
          readAt: m.readAt || null,
        }));
        saveToStorage(STORAGE_MESSAGES, messages);
        renderChatThread(matchId);
        markMessagesRead(matchId);
        if (socket) socket.emit('mark_read', { matchId });
      })
      .catch((err) => {
        console.warn(err);
        renderChatThread(matchId);
      });
  } else {
    markMessagesRead(matchId);
    renderChatThread(matchId);
    startChatPolling();
  }
}

function markMessagesRead(matchId) {
  if (!currentUser) return;
  const messages = loadFromStorage(STORAGE_MESSAGES, {});
  const thread = messages[matchId] || [];
  let changed = false;
  thread.forEach(msg => {
    if (msg.senderId !== currentUser.id && !msg.readAt) {
      msg.readAt = new Date().toISOString();
      changed = true;
    }
  });
  if (changed) {
    messages[matchId] = thread;
    saveToStorage(STORAGE_MESSAGES, messages);
  }
}

function renderChatThread(matchId) {
  const container = document.getElementById('chatMessages');
  if (!container) return;
  const messages = loadFromStorage(STORAGE_MESSAGES, {});
  const thread = messages[matchId] || [];

  if (!thread.length) {
    container.innerHTML = `<p class="chat-empty">No messages yet. Start the conversation with an intentional opener.</p>`;
    return;
  }

  container.innerHTML = thread.map(msg => {
    const isMine = msg.senderId === currentUser.id;
    const receipt = isMine
      ? (msg.readAt
          ? '<span class="read-receipt read" title="Read">✓✓</span>'
          : '<span class="read-receipt" title="Sent">✓</span>')
      : '';
    return `
      <div class="chat-bubble ${isMine ? 'mine' : 'theirs'}">
        <p>${escapeHtml(msg.text)}</p>
        <span class="chat-time">${formatTime(msg.timestamp)} ${receipt}</span>
      </div>
    `;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

function sendChatMessage() {
  if (!activeChatMatchId || !currentUser) return;

  const input = document.getElementById('chatInput');
  const text = input?.value.trim();
  if (!text) return;

  // API + socket path
  if (USE_API && socket && socket.connected) {
    const messages = loadFromStorage(STORAGE_MESSAGES, {});
    if (!messages[activeChatMatchId]) messages[activeChatMatchId] = [];
    messages[activeChatMatchId].push({
      id: 'tmp_' + Date.now(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      text,
      timestamp: new Date().toISOString(),
      readAt: null,
      pending: true,
    });
    saveToStorage(STORAGE_MESSAGES, messages);
    input.value = '';
    if (typeof broadcastTyping === 'function') broadcastTyping(false);
    socket.emit('typing_stop', { matchId: activeChatMatchId });
    socket.emit('send_message', { matchId: activeChatMatchId, content: text });
    renderChatThread(activeChatMatchId);
    return;
  }

  // LocalStorage path
  const matches = loadFromStorage(STORAGE_MATCHES, []);
  const match = matches.find(m => m.id === activeChatMatchId);
  if (!match || match.userA === match.userB) {
    showToast('Cannot send message — invalid match.');
    return;
  }
  if (match.userA !== currentUser.id && match.userB !== currentUser.id) {
    showToast('You are not part of this conversation.');
    return;
  }

  const messages = loadFromStorage(STORAGE_MESSAGES, {});
  if (!messages[activeChatMatchId]) messages[activeChatMatchId] = [];

  messages[activeChatMatchId].push({
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    senderId: currentUser.id,
    senderName: currentUser.name,
    text,
    timestamp: new Date().toISOString(),
    readAt: null
  });
  try {
    saveToStorage(STORAGE_MESSAGES, messages);
  } catch (e) {
    showToast('Message could not be saved — check storage or connection.');
    return;
  }
  input.value = '';
  broadcastTyping(false);
  renderChatThread(activeChatMatchId);
  updateMessagesBadge();
}

function updateMessagesBadge() {
  const badge = document.getElementById('messagesBadge');
  if (!badge) return;
  const matches = getMatchesForCurrentUser();
  if (matches.length > 0) {
    badge.textContent = matches.length > 9 ? '9+' : matches.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

/* ---------- Typing indicator & real-time sync ---------- */
function broadcastTyping(isTyping) {
  if (!activeChatMatchId || !currentUser) return;
  if (USE_API && socket && socket.connected) {
    socket.emit(isTyping ? 'typing_start' : 'typing_stop', { matchId: activeChatMatchId });
    return;
  }
  const typing = loadFromStorage(STORAGE_TYPING, {});
  typing[activeChatMatchId] = {
    userId: currentUser.id,
    isTyping: !!isTyping,
    ts: Date.now()
  };
  saveToStorage(STORAGE_TYPING, typing);
}

function clearTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.classList.add('hidden');
}

function refreshTypingIndicator() {
  if (!activeChatMatchId || !currentUser) {
    clearTypingIndicator();
    return;
  }
  const typing = loadFromStorage(STORAGE_TYPING, {});
  const state = typing[activeChatMatchId];
  const el = document.getElementById('typingIndicator');
  if (!el) return;

  if (
    state &&
    state.isTyping &&
    state.userId !== currentUser.id &&
    Date.now() - state.ts < 2500
  ) {
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function startChatPolling() {
  stopChatPolling();
  chatPollTimer = setInterval(() => {
    if (!activeChatMatchId) return;
    markMessagesRead(activeChatMatchId);
    renderChatThread(activeChatMatchId);
    refreshTypingIndicator();
  }, 1200);
}

function stopChatPolling() {
  if (chatPollTimer) {
    clearInterval(chatPollTimer);
    chatPollTimer = null;
  }
}

/**
 * Cross-tab real-time sync via storage events.
 * When another tab writes messages / matches / likes, this tab reacts.
 */
function initRealtimeSync() {
  window.addEventListener('storage', (e) => {
    if (!e.key) return;

    if (e.key === STORAGE_MESSAGES && activeChatMatchId) {
      markMessagesRead(activeChatMatchId);
      renderChatThread(activeChatMatchId);
      refreshTypingIndicator();
    }
    if (e.key === STORAGE_MATCHES) {
      updateMessagesBadge();
      if (document.getElementById('matchesListView') &&
          !document.getElementById('matchesListView').classList.contains('hidden')) {
        renderMatchesList();
      }
    }
    if (e.key === STORAGE_LIKES) {
      updateLikesBadge();
    }
    if (e.key === STORAGE_TYPING) {
      refreshTypingIndicator();
    }
    if (e.key === STORAGE_PROFILES) {
      allProfiles = loadFromStorage(STORAGE_PROFILES, []).filter(p => !p.isMock);
      applyFilters();
      renderCurrentCard();
      renderHeroCard();
    }
    if (e.key === STORAGE_PRESENCE) {
      renderHeroCard();
    }
  });
}

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/* ==========================================================================
   FEATURE MODULES
   ========================================================================== */
function initFeatureModules() {
  const playBtn = document.getElementById('audioPlayBtn');
  const player = document.querySelector('.audio-player');
  let playing = false;
  let timer = null;

  if (playBtn && player) {
    playBtn.addEventListener('click', () => {
      playing = !playing;
      if (playing) {
        playBtn.textContent = '❚❚';
        playBtn.classList.add('playing');
        player.classList.add('playing');
        timer = setTimeout(() => {
          playing = false;
          playBtn.textContent = '▶';
          playBtn.classList.remove('playing');
          player.classList.remove('playing');
        }, 4000);
      } else {
        clearTimeout(timer);
        playBtn.textContent = '▶';
        playBtn.classList.remove('playing');
        player.classList.remove('playing');
      }
    });
  }

  const slider = document.getElementById('proximitySlider');
  const valueLabel = document.getElementById('proximityValue');
  if (slider) {
    maxDistance = parseInt(slider.value, 10) || 25;
    if (valueLabel) valueLabel.textContent = maxDistance;

    slider.addEventListener('input', () => {
      maxDistance = parseInt(slider.value, 10);
      if (valueLabel) valueLabel.textContent = maxDistance;
      if (USE_API) refreshFeedFromApi();
      else { applyFilters(); renderCurrentCard(); }
      showToast(`Radar set to ${maxDistance} ${preferredUnit === 'km' ? 'km' : 'miles'}`);
    });
  }

  // Note: the hero prototype card's "Like Prompt" button is wired dynamically
  // in initHeroCard() / handleHeroInlineLike() since it now binds to a real,
  // live-registered profile rather than static demo copy.
}

/* ==========================================================================
   SHARE MODULE
   ========================================================================== */
function initShareModule() {
  const btnShare = document.getElementById('btnSharePlatform');
  if (btnShare) btnShare.addEventListener('click', () => shareQuincyPlatform());

  const shareModal = document.getElementById('shareModal');
  const btnCloseShare = document.getElementById('btnCloseShareModal');
  if (btnCloseShare) btnCloseShare.addEventListener('click', () => shareModal?.classList.add('hidden'));
  shareModal?.addEventListener('click', (e) => {
    if (e.target === shareModal) shareModal.classList.add('hidden');
  });

  document.getElementById('shareWhatsApp')?.addEventListener('click', () => {
    const text = encodeURIComponent('Join me on Quincy — intentional dating with verified singles and real proximity discovery! ' + window.location.href);
    window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank', 'noopener');
  });
  document.getElementById('shareFacebook')?.addEventListener('click', () => {
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'noopener');
  });
  document.getElementById('shareTwitter')?.addEventListener('click', () => {
    const text = encodeURIComponent('Join me on Quincy — intentional dating with verified singles!');
    const url = encodeURIComponent(window.location.href);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'noopener');
  });
  document.getElementById('shareCopyLink')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast('Link copied to clipboard!');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = window.location.href;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast('Link copied to clipboard!');
    }
    document.getElementById('shareModal')?.classList.add('hidden');
  });
}

async function shareQuincyPlatform() {
  const shareData = {
    title: 'Quincy Dating Platform',
    text: 'Join me on Quincy — intentional dating with verified singles and real proximity discovery!',
    url: window.location.href
  };

  if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  } else if (navigator.share) {
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  document.getElementById('shareModal')?.classList.remove('hidden');
}

/* ==========================================================================
   LOCATION FALLBACK
   ========================================================================== */
const CITY_PRESETS = [
  { name: 'New York, NY', lat: 40.7128, lon: -74.0060 },
  { name: 'Los Angeles, CA', lat: 34.0522, lon: -118.2437 },
  { name: 'Chicago, IL', lat: 41.8781, lon: -87.6298 },
  { name: 'London, UK', lat: 51.5074, lon: -0.1278 },
  { name: 'Toronto, CA', lat: 43.6532, lon: -79.3832 },
  { name: 'Sydney, AU', lat: -33.8688, lon: 151.2093 },
  { name: 'Berlin, DE', lat: 52.5200, lon: 13.4050 },
  { name: 'Tokyo, JP', lat: 35.6762, lon: 139.6503 },
  { name: 'Lagos, NG', lat: 6.5244, lon: 3.3792 },
  { name: 'São Paulo, BR', lat: -23.5505, lon: -46.6333 },
  { name: 'Dubai, AE', lat: 25.2048, lon: 55.2708 },
  { name: 'Singapore', lat: 1.3521, lon: 103.8198 }
];

function initLocationFallback() {
  const modal = document.getElementById('locationFallbackModal');
  const btnClose = document.getElementById('btnCloseLocationFallback');
  const list = document.getElementById('locationPresetList');

  if (btnClose) btnClose.addEventListener('click', () => modal?.classList.add('hidden'));
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  if (list) {
    list.innerHTML = CITY_PRESETS.map((c, i) => `
      <button type="button" class="location-preset-btn" data-idx="${i}">
        📍 ${c.name}
      </button>
    `).join('');

    list.querySelectorAll('.location-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const city = CITY_PRESETS[idx];
        applyManualLocation(city);
        modal.classList.add('hidden');
      });
    });
  }

  document.getElementById('btnRetryGeolocation')?.addEventListener('click', async () => {
    if (!currentUser) return;
    const coords = await requestGeolocation();
    if (coords) {
      currentUser.latitude = coords.latitude;
      currentUser.longitude = coords.longitude;
      const place = await reverseGeocode(coords.latitude, coords.longitude);
      currentUser.city = place.city;
      currentUser.country = place.country;
      currentUser.locationDisplay = place.displayName;
      persistCurrentUserLocation();
      showToast(`Location set to ${place.displayName}`);
      modal.classList.add('hidden');
      applyFilters();
      renderCurrentCard();
      updateSimLocationLabel();
    } else {
      showToast('Still unable to access location. Please pick a city below.');
    }
  });
}

function openLocationFallbackModal(profile) {
  const modal = document.getElementById('locationFallbackModal');
  if (modal) modal.classList.remove('hidden');
}

function applyManualLocation(city) {
  if (!currentUser) return;
  currentUser.latitude = city.lat;
  currentUser.longitude = city.lon;
  currentUser.city = city.name.split(',')[0].trim();
  currentUser.country = city.name.includes(',') ? city.name.split(',').slice(1).join(',').trim() : '';
  currentUser.locationDisplay = city.name;
  persistCurrentUserLocation();
  showToast(`Location set to ${city.name}`);
  applyFilters();
  renderCurrentCard();
  updateSimLocationLabel();
}

function persistCurrentUserLocation() {
  if (!currentUser) return;
  saveToStorage(STORAGE_CURRENT_USER, currentUser);
  let registered = loadFromStorage(STORAGE_PROFILES, []);
  const idx = registered.findIndex(p => p.id === currentUser.id);
  if (idx !== -1) {
    registered[idx] = { ...registered[idx], ...currentUser };
    saveToStorage(STORAGE_PROFILES, registered);
    allProfiles = registered.filter(p => !p.isMock);
  }
}

/* ==========================================================================
   PROFILE COMMENT SYSTEM
   ========================================================================== */
function initComments() {
  const modal = document.getElementById('commentModal');
  const form = document.getElementById('commentForm');
  const btnCancel = document.getElementById('btnCancelComment');

  if (btnCancel) {
    btnCancel.addEventListener('click', () => {
      modal?.classList.add('hidden');
      activeCommentProfileId = null;
    });
  }
  modal?.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.add('hidden');
      activeCommentProfileId = null;
    }
  });

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      postComment();
    });
  }

  // Note: the hero prototype card's Comment button is wired dynamically in
  // initHeroCard() / handleHeroComment() since it now targets whichever real
  // profile is currently featured, not a fixed demo profile.
}

function openCommentModal(profileId) {
  if (!profileId) return;
  const profile = allProfiles.find(p => String(p.id) === String(profileId)) ||
    filteredProfiles.find(p => String(p.id) === String(profileId));
  if (!profile) {
    showToast('Profile not found.');
    return;
  }
  if (currentUser && isSameUser(currentUser, profile)) {
    showToast('You cannot comment on your own profile.');
    return;
  }

  activeCommentProfileId = profile.id;
  const modal = document.getElementById('commentModal');
  const sub = document.getElementById('commentModalSub');
  const targetInfo = document.getElementById('commentTargetInfo');
  const existing = document.getElementById('existingComments');
  const textArea = document.getElementById('commentText');
  const err = document.getElementById('errComment');

  if (sub) sub.textContent = `Leave an intentional note for ${profile.name}.`;
  if (targetInfo) {
    targetInfo.innerHTML = `
      <img src="${profile.avatar}" alt="" />
      <div>
        <h4>${escapeHtml(profile.name)}, ${profile.age}</h4>
        <p>${escapeHtml(profile.occupation)} · ${escapeHtml(profile.promptTag || 'Prompt')}</p>
      </div>
    `;
  }
  if (textArea) textArea.value = '';
  if (err) err.textContent = '';

  renderExistingComments(profile.id, existing);
  modal?.classList.remove('hidden');
}

function renderExistingComments(profileId, container) {
  if (!container) return;
  const allComments = loadFromStorage(STORAGE_COMMENTS, {});
  const list = allComments[profileId] || [];

  if (!list.length) {
    container.innerHTML = '<p class="comments-empty">No comments yet. Be the first to leave a thoughtful note.</p>';
    return;
  }

  // Newest first
  const sorted = [...list].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  container.innerHTML = sorted.map(c => `
    <div class="comment-item">
      <div class="comment-item-header">
        <span class="comment-author">${escapeHtml(c.authorName || 'Member')}</span>
        <span class="comment-time">${formatTime(c.timestamp)}</span>
      </div>
      <p class="comment-body">${escapeHtml(c.text)}</p>
    </div>
  `).join('');
}

function postComment() {
  if (!activeCommentProfileId) return;
  if (!currentUser) {
    showToast('Please log in to post a comment.');
    document.getElementById('commentModal')?.classList.add('hidden');
    document.getElementById('loginModal')?.classList.remove('hidden');
    return;
  }

  const profile = allProfiles.find(p => String(p.id) === String(activeCommentProfileId));
  if (!profile || isSameUser(currentUser, profile)) {
    showToast('You cannot comment on this profile.');
    return;
  }

  const textArea = document.getElementById('commentText');
  const err = document.getElementById('errComment');
  const text = (textArea?.value || '').trim();
  if (!text || text.length < 3) {
    if (err) err.textContent = 'Please write a meaningful comment (3+ characters).';
    return;
  }
  if (err) err.textContent = '';

  const allComments = loadFromStorage(STORAGE_COMMENTS, {});
  if (!allComments[activeCommentProfileId]) allComments[activeCommentProfileId] = [];

  const entry = {
    id: 'cmt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    profileId: activeCommentProfileId,
    authorId: currentUser.id,
    authorName: currentUser.name,
    text,
    timestamp: new Date().toISOString()
  };

  // Optimistic update
  allComments[activeCommentProfileId].unshift(entry);
  if (allComments[activeCommentProfileId].length > 100) {
    allComments[activeCommentProfileId].length = 100;
  }
  try {
    saveToStorage(STORAGE_COMMENTS, allComments);
  } catch (e) {
    showToast('Unable to save comment — storage may be full or offline.');
    return;
  }

  const existing = document.getElementById('existingComments');
  renderExistingComments(activeCommentProfileId, existing);
  if (textArea) textArea.value = '';
  showToast(`Comment posted on ${profile.name}'s profile.`);
}


/* ==========================================================================
   FULL PROFILE DRAWER
   ========================================================================== */
let activeFullProfileId = null;

function initFullProfileDrawer() {
  const drawer = document.getElementById('fullProfileDrawer');
  document.getElementById('btnCloseFullProfile')?.addEventListener('click', closeFullProfile);
  drawer?.addEventListener('click', (e) => {
    if (e.target === drawer) closeFullProfile();
  });
  document.getElementById('fpBtnLike')?.addEventListener('click', () => {
    const p = resolveProfileById(activeFullProfileId);
    if (p) { closeFullProfile(); recordLike(p, false); triggerMatchCelebration(p, false); }
  });
  document.getElementById('fpBtnSuper')?.addEventListener('click', () => {
    const p = resolveProfileById(activeFullProfileId);
    if (p) { closeFullProfile(); showToast(`★ Super Like sent to ${p.name}!`); recordLike(p, false); triggerMatchCelebration(p, false); }
  });
  document.getElementById('fpBtnPass')?.addEventListener('click', () => {
    closeFullProfile();
    handleSimAction('pass');
  });
  document.getElementById('fpBtnComment')?.addEventListener('click', () => {
    const id = activeFullProfileId;
    closeFullProfile();
    if (id) openCommentModal(id);
  });
}

function resolveProfileById(id) {
  if (!id) return null;
  if (String(id) === 'demo_sophia') return DEFAULT_HERO_PROFILE;
  return allProfiles.find(p => String(p.id) === String(id))
    || filteredProfiles.find(p => String(p.id) === String(id))
    || (heroProfile && String(heroProfile.id) === String(id) ? heroProfile : null);
}

function openFullProfile(profileId) {
  const profile = resolveProfileById(profileId);
  if (!profile) {
    showToast('Profile not found.');
    return;
  }
  if (currentUser && isSameUser(currentUser, profile) && !profile.isDemoFallback) {
    showToast('This is your profile.');
    return;
  }
  activeFullProfileId = profile.id;
  const enriched = profile.isDemoFallback ? profile : enrichProfileForDisplay(profile);
  const photos = getProfilePhotos(profile);
  const host = document.getElementById('fpGalleryHost');
  if (host) {
    host.innerHTML = '';
    const carousel = createPhotoCarousel(photos, { initialIndex: 0, className: 'fp-gallery' });
    host.appendChild(carousel.root);
  }
  document.getElementById('fpName').textContent = `${profile.name}, ${profile.age}`;
  const dist = enriched.distance || profile.locationDisplay || '';
  document.getElementById('fpSub').textContent = `${profile.occupation || ''} · ${dist}`;
  document.getElementById('fpPromptTag').textContent = profile.promptTag || 'Prompt';
  document.getElementById('fpPromptQ').textContent = profile.promptQuestion || '';
  document.getElementById('fpPromptA').textContent = profile.promptAnswer || '';

  const interests = profile.interests || ['Lifestyle', 'Conversation', 'Travel'];
  document.getElementById('fpInterests').innerHTML = interests.map(t =>
    `<span class="fp-chip">${escapeHtml(t)}</span>`
  ).join('');
  const basics = profile.basics || ['🚭 Non-smoker', '🏋️ Sometimes'];
  document.getElementById('fpBasics').innerHTML = basics.map(t =>
    `<span class="fp-chip">${escapeHtml(t)}</span>`
  ).join('');
  document.getElementById('fpIntent').innerHTML =
    `<span class="fp-chip">🎯 Looking for: ${escapeHtml(intentDisplayLabel(profile.intent || profile.intentLabel))}</span>`;

  document.getElementById('fullProfileDrawer')?.classList.remove('hidden');
}

function closeFullProfile() {
  document.getElementById('fullProfileDrawer')?.classList.add('hidden');
  activeFullProfileId = null;
}

/* ==========================================================================
   CLIENT-SIDE PHOTO UPLOAD & CROP PIPELINE
   ========================================================================== */
/** Pending registration photos as data-URLs (compressed). */
let pendingRegPhotos = [];

/**
 * Compress & orient image client-side to JPEG/WebP data URL.
 * Target ~ max edge 1200px, quality 0.82 — approximates CDN 80% WebP step.
 */
function processImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Not an image'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const maxEdge = 1200;
        let { width, height } = img;
        const scale = Math.min(1, maxEdge / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        // Crop to 4:5 portrait center
        const targetRatio = 4 / 5;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        const srcRatio = img.width / img.height;
        if (srcRatio > targetRatio) {
          sw = Math.round(img.height * targetRatio);
          sx = Math.round((img.width - sw) / 2);
        } else {
          sh = Math.round(img.width / targetRatio);
          sy = Math.round((img.height - sh) / 2);
        }
        const canvas = document.createElement('canvas');
        const outW = Math.min(800, Math.round(sw * scale));
        const outH = Math.round(outW / targetRatio);
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
        const mime = (typeof canvas.toDataURL === 'function' && canvas.toDataURL('image/webp').startsWith('data:image/webp'))
          ? 'image/webp' : 'image/jpeg';
        resolve(canvas.toDataURL(mime, 0.82));
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error('Read failed'));
    reader.readAsDataURL(file);
  });
}

function renderRegPhotoGrid() {
  const grid = document.getElementById('regPhotoGrid');
  if (!grid) return;
  const slots = Math.max(pendingRegPhotos.length + 1, 4);
  const count = Math.min(slots, MAX_PROFILE_PHOTOS);
  grid.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const slot = document.createElement('div');
    slot.className = 'photo-slot' + (pendingRegPhotos[i] ? '' : ' empty') + (i === 0 && pendingRegPhotos[i] ? ' primary-badge' : '');
    if (pendingRegPhotos[i]) {
      const img = document.createElement('img');
      img.src = pendingRegPhotos[i];
      img.alt = `Photo ${i + 1}`;
      slot.appendChild(img);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'photo-remove';
      rm.textContent = '✕';
      rm.addEventListener('click', (e) => {
        e.stopPropagation();
        pendingRegPhotos.splice(i, 1);
        renderRegPhotoGrid();
      });
      slot.appendChild(rm);
    } else {
      slot.addEventListener('click', () => document.getElementById('regPhotoInput')?.click());
    }
    grid.appendChild(slot);
  }
}

function initPhotoUploadModule() {
  const input = document.getElementById('regPhotoInput');
  if (!input) return;
  input.addEventListener('change', async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    for (const file of files) {
      if (pendingRegPhotos.length >= MAX_PROFILE_PHOTOS) {
        showToast('Maximum 8 photos per profile.');
        break;
      }
      try {
        const dataUrl = await processImageFile(file);
        pendingRegPhotos.push(dataUrl);
      } catch (err) {
        console.warn('Photo process failed', err);
        showToast('Could not process one of the images.');
      }
    }
    renderRegPhotoGrid();
  });
  renderRegPhotoGrid();
}

/* ==========================================================================
   UTILITIES
   ========================================================================== */
function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.add('hidden'), 2800);
}

window.handleSimAction = handleSimAction;
window.handleInlineLike = handleInlineLike;
window.handleSimRewind = handleSimRewind;
window.resetSim = resetSim;
window.resetSimFilters = resetSimFilters;
window.openChatWithMatch = openChatWithMatch;
window.shareQuincyPlatform = shareQuincyPlatform;
window.openCommentModal = openCommentModal;
window.handleLikeItemClick = handleLikeItemClick;
window.openFullProfile = openFullProfile;
