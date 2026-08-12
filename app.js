// app.js

/**
 * Quincy Dating Platform — Production-Ready Client Logic
 * State-driven, StorageAdapter-backed, modular Vanilla JS
 * Global proximity via Haversine, algorithmic compatibility, native Web Share
 * Fully dynamic: only real registered user profiles (no hardcoded mocks)
 */

document.addEventListener('DOMContentLoaded', () => {
  initAgeGate();
  initStatsCounter();
  initState();
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
  updateUIForUser();
});

/* ==========================================================================
   STATE & STORAGE ABSTRACTION LAYER
   ========================================================================== */
const STORAGE_PROFILES = 'quincy_registered_profiles';
const STORAGE_LIKES = 'quincy_likes_received';
const STORAGE_CURRENT_USER = 'quincy_current_user';
const STORAGE_MATCHES = 'quincy_matches';
const STORAGE_MESSAGES = 'quincy_messages';
const STORAGE_SESSION = 'quincy_session_token';

/**
 * StorageAdapter — async-ready abstraction for localStorage with
 * future Firebase/Supabase sync hooks. Offline-first with local fallback.
 */
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
      // Future: await syncToCloud(key, value);
    } catch (e) {
      console.warn('StorageAdapter.set failed', e);
    }
  },
  async remove(key) {
    localStorage.removeItem(key);
  }
};

// Synchronous helpers kept for compatibility with existing call sites
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
let preferredUnit = 'miles'; // 'miles' | 'km'

/** Simple client-side credential hash (demo only — not production-grade) */
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
   GEOLOCATION & HAVERSINE DISTANCE ENGINE
   ========================================================================== */

/**
 * Haversine formula — exact great-circle distance between two lat/lon points.
 * Returns distance in miles (default) or kilometres.
 * R = 3958.8 mi / 6371 km
 */
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

/**
 * Format a numeric distance for display cards.
 */
function formatDistance(milesOrKm, unit = preferredUnit) {
  if (milesOrKm == null || isNaN(milesOrKm)) return 'Unknown distance';
  const val = milesOrKm < 10 ? milesOrKm.toFixed(1) : Math.round(milesOrKm);
  return unit === 'km' ? `${val} km away` : `${val} miles away`;
}

/**
 * Request browser geolocation. Returns { latitude, longitude } or null.
 */
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

/**
 * Lightweight reverse-geocode via free OpenStreetMap Nominatim (no key required).
 * Falls back to coordinate string if offline / rate-limited.
 */
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

/**
 * Attach coordinates + place name to a profile object.
 * Shows location fallback modal if permission denied.
 */
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
    // Trigger fallback UI; user can pick a city later
    profile.latitude = null;
    profile.longitude = null;
    profile.city = '';
    profile.country = '';
    profile.locationDisplay = 'Location not set';
    // Defer modal open so registration toast can finish
    setTimeout(() => openLocationFallbackModal(profile), 600);
  }
  return profile;
}

/* ==========================================================================
   COMPATIBILITY SCORING ENGINE
   ========================================================================== */

/**
 * Multi-dimensional compatibility score (0–100).
 * Vectors: Intent match, Prompt-tag alignment, Verification boost, Distance weight.
 */
function calculateCompatibilityScore(userA, userB) {
  if (!userA || !userB) return 70;

  let score = 55; // baseline

  // 1. Relationship Intent (high weight)
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

  // 2. Prompt Tag / Goal alignment
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

  // 3. Verification boost
  if (userA.verified && userB.verified) score += 8;
  else if (userA.verified || userB.verified) score += 3;

  // 4. Distance weight (closer = higher)
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
    // farther adds nothing
  } else {
    score += 2; // unknown distance mild boost so cards still look alive
  }

  // Clamp & slight randomness for natural feel (max ±2)
  score = Math.max(62, Math.min(99, Math.round(score + (Math.random() * 4 - 2))));
  return score;
}

/**
 * Enrich a profile with live distance & match score relative to currentUser.
 */
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

  if (currentUser) {
    const pct = calculateCompatibilityScore(currentUser, profile);
    enriched.matchScore = `${pct}% Match`;
    enriched.matchScoreNum = pct;
  } else {
    enriched.matchScore = profile.matchScore || '—';
  }

  return enriched;
}

/* ==========================================================================
   STATE INITIALISATION
   ========================================================================== */

/**
 * Initialize application state exclusively from registered (real) users.
 * No hardcoded mock profiles are loaded into the discovery pool.
 */
function initState() {
  const registered = loadFromStorage(STORAGE_PROFILES, []);
  currentUser = loadFromStorage(STORAGE_CURRENT_USER, null);

  // Validate session token
  if (currentUser) {
    const session = loadFromStorage(STORAGE_SESSION, null);
    if (!session || session.userId !== currentUser.id || session.token !== currentUser.sessionToken) {
      currentUser = null;
      localStorage.removeItem(STORAGE_CURRENT_USER);
      localStorage.removeItem(STORAGE_SESSION);
    }
  }

  // Populate system strictly with live registered profiles
  allProfiles = registered.filter(p => !p.isMock);
  applyFilters();
}

/**
 * Filter pipeline: exclude self, enforce Haversine distance, apply intent/verified filters.
 */
function applyFilters() {
  filteredProfiles = allProfiles
    .filter(p => {
      if (currentUser && p.id === currentUser.id) return false;

      // Compute live Haversine distance when both users have coordinates
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

      // Only enforce distance filter when we have real coordinates
      if (hasRealCoords && dist != null && dist > maxDistance) return false;

      if (currentFilter === 'all') return true;
      if (currentFilter === 'marriage') return p.intent === 'marriage' || p.intent === 'long-term';
      if (currentFilter === 'verified') return p.verified === true;
      return true;
    })
    .map(enrichProfileForDisplay)
    .sort((a, b) => {
      // Prefer higher match score, then closer distance
      const scoreDiff = (b.matchScoreNum || 0) - (a.matchScoreNum || 0);
      if (Math.abs(scoreDiff) > 2) return scoreDiff;
      return (a.distanceNum || 99) - (b.distanceNum || 99);
    });

  currentProfileIndex = 0;
}

/* ==========================================================================
   1. AGE VERIFICATION GATE
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
   2. HERO STATS ANIMATED COUNTER
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
      if (progress < 1) {
        window.requestAnimationFrame(step);
      }
    };
    window.requestAnimationFrame(step);
  }
}

/* ==========================================================================
   3. INTERACTIVE MATCHING PREVIEW SIMULATOR
   ========================================================================== */
function initInteractiveSimulator() {
  const filters = document.querySelectorAll('.sim-filter');

  renderCurrentCard();

  filters.forEach(btn => {
    btn.addEventListener('click', (e) => {
      filters.forEach(f => f.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.getAttribute('data-filter');
      applyFilters();
      renderCurrentCard();
      updateStatusText();
    });
  });
}

/**
 * Render the current discovery card.
 * When no real registered profiles match filters, show a high-conversion empty state.
 */
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
          ${currentUser ? `
            <button class="btn btn-outline" onclick="shareQuincyPlatform()">Share Quincy</button>
          ` : ''}
          ${hasAnyRegistered ? `
            <button class="btn btn-outline" onclick="resetSimFilters()">Reset Filters & Distance</button>
          ` : ''}
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

  const verifiedBadge = profile.verified
    ? '<span class="verified-badge" title="ID Verified" style="display:inline-flex;width:16px;height:16px;background:#3B82F6;color:white;border-radius:50%;font-size:0.65rem;align-items:center;justify-content:center;margin-left:4px;">✓</span>'
    : '';

  const liveBadge = '<span class="live-user-badge" title="Live registered user">Live</span>';
  const locationLine = profile.locationDisplay
    ? `<span class="sim-location">📍 ${escapeHtml(profile.locationDisplay)}</span>`
    : '';

  cardStack.innerHTML = `
    <div class="sim-profile-card" id="currentSimCard">
      <div class="sim-card-header">
        <img src="${profile.avatar}" alt="${escapeHtml(profile.name)}" class="sim-avatar" />
        <div class="sim-details">
          <h3>${escapeHtml(profile.name)}, ${profile.age} ${verifiedBadge} ${liveBadge}</h3>
          <p class="sim-meta">${escapeHtml(profile.occupation)} • ${escapeHtml(profile.distance)}</p>
          ${locationLine}
        </div>
        <div class="sim-match-pill">${escapeHtml(profile.matchScore)}</div>
      </div>

      <div class="sim-prompt prompt-clickable" data-prompt-id="${profile.id}">
        <div class="sim-prompt-title">${escapeHtml(profile.promptTag)}</div>
        <div class="sim-prompt-body">"${escapeHtml(profile.promptQuestion)}"</div>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px;">${escapeHtml(profile.promptAnswer)}</p>
        <button class="inline-like-btn" onclick="handleInlineLike('${profile.id}')">♥ Like Prompt</button>
      </div>

      <div class="sim-actions">
        <button class="btn sim-btn-pass" onclick="handleSimAction('pass')">Pass</button>
        <button class="btn sim-btn-like" onclick="handleSimAction('like')">♥ Send Intentional Like</button>
      </div>
    </div>
  `;
  updateStatusText();
}

function handleSimAction(action) {
  const card = document.getElementById('currentSimCard');
  const currentProfile = filteredProfiles[currentProfileIndex];
  if (!currentProfile) return;

  if (action === 'like') {
    if (card) {
      card.classList.add('swipe-right');
      spawnHeartBurst(card);
    }
    const isMutual = recordLike(currentProfile);
    setTimeout(() => {
      triggerMatchCelebration(currentProfile, isMutual);
    }, 280);
  } else {
    if (card) card.classList.add('swipe-left');
    setTimeout(() => advanceProfile(), 320);
  }
}

function handleInlineLike(profileId) {
  const profile = allProfiles.find(p => String(p.id) === String(profileId));
  if (!profile) return;
  const btn = document.querySelector('.inline-like-btn');
  if (btn) {
    btn.classList.add('liked');
    btn.textContent = '♥ Liked';
  }
  recordLike(profile, true);
  showToast(`You liked ${profile.name}'s prompt!`);
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
  const slider = document.getElementById('proximitySlider');
  if (slider) {
    slider.value = 25;
    const valueLabel = document.getElementById('proximityValue');
    if (valueLabel) valueLabel.textContent = '25';
  }
  document.querySelectorAll('.sim-filter').forEach(f => {
    f.classList.toggle('active', f.getAttribute('data-filter') === 'all');
  });
  applyFilters();
  renderCurrentCard();
  showToast('Filters and distance reset');
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
   4. MATCH CELEBRATION MODAL
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
      if (matchId) {
        openChatWithMatch(matchId);
      }
    });
  }
}

function triggerMatchCelebration(profile, isMutual = false) {
  const matchModal = document.getElementById('matchModal');
  const matchNameHeading = document.getElementById('matchNameHeading');
  const matchTargetAvatar = document.getElementById('matchTargetAvatar');
  const firstMove = document.getElementById('firstMoveIndicator');
  const userAvatar = document.getElementById('matchUserAvatar');
  const mutualBanner = document.getElementById('mutualMatchBanner');
  const btnStartChat = document.getElementById('btnStartChatFromMatch');

  if (matchNameHeading) matchNameHeading.innerText = `You & ${profile.name} Connected!`;
  if (matchTargetAvatar) matchTargetAvatar.src = profile.avatar;
  if (currentUser && userAvatar) {
    userAvatar.src = currentUser.avatar;
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
   5. REGISTRATION, LOGIN & PROFILE MANAGEMENT
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
    if (currentUser) {
      openEditProfile();
    } else {
      open();
    }
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

    let profile = buildProfileFromForm();
    const registered = loadFromStorage(STORAGE_PROFILES, []);

    if (registered.some(p => p.email && p.email.toLowerCase() === profile.email.toLowerCase())) {
      const errEl = document.getElementById('errEmail');
      if (errEl) errEl.textContent = 'An account with this email already exists. Please log in.';
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Profile';
      }
      return;
    }

    // Attach real geolocation
    profile = await attachLocationToProfile(profile);

    registered.push(profile);
    saveToStorage(STORAGE_PROFILES, registered);

    const token = generateSessionToken(profile.id);
    profile.sessionToken = token;
    saveToStorage(STORAGE_CURRENT_USER, profile);
    saveToStorage(STORAGE_SESSION, { userId: profile.id, token });
    currentUser = profile;

    // Sync into live pool immediately
    allProfiles = registered.filter(p => !p.isMock);
    applyFilters();
    renderCurrentCard();
    updateUIForUser();
    close();
    showToast(`Welcome, ${profile.name}! Your profile is live and discoverable.`);
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Create Profile';
    }
  });
}

function validateRegistrationForm() {
  let valid = true;
  const clear = (id) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; }
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

/**
 * Build a real user profile object. isMock is always false.
 * Coordinates are attached asynchronously after this call.
 */
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

  return {
    id: 'usr_' + Date.now(),
    name,
    age,
    occupation,
    distance: 'Calculating…',
    distanceNum: null,
    matchScore: '—',
    intent,
    verified,
    avatar,
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

/* ---------- Login ---------- */
function initLogin() {
  const modal = document.getElementById('loginModal');
  const form = document.getElementById('loginForm');
  const btnOpen = document.getElementById('btnOpenLogin');
  const btnCancel = document.getElementById('btnCancelLogin');
  const switchToRegister = document.getElementById('switchToRegister');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => modal?.classList.remove('hidden'));
  }
  if (btnCancel) {
    btnCancel.addEventListener('click', () => modal?.classList.add('hidden'));
  }
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

      const registered = loadFromStorage(STORAGE_PROFILES, []);
      const user = registered.find(p => p.email === email);

      if (!user || user.passwordHash !== hashCredential(password)) {
        if (errEl) errEl.textContent = 'Invalid email or password.';
        return;
      }

      // Refresh location on login if missing
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
      updateUIForUser();
      modal.classList.add('hidden');
      showToast(`Welcome back, ${user.name}!`);
    });
  }
}

/* ---------- Profile Edit / Erase ---------- */
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

  if (btnCancel) {
    btnCancel.addEventListener('click', () => eraseModal.classList.add('hidden'));
  }
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
  updateUIForUser();
  document.getElementById('editProfileModal')?.classList.add('hidden');
  showToast('Profile updated successfully.');
}

function logoutUser() {
  localStorage.removeItem(STORAGE_CURRENT_USER);
  localStorage.removeItem(STORAGE_SESSION);
  currentUser = null;
  applyFilters();
  renderCurrentCard();
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
   6. LIKES TRACKING, MUTUAL MATCHES & DRAWER
   ========================================================================== */
/**
 * Record a like. Mutual matches occur only between two real registered users.
 */
function recordLike(targetProfile, isPromptOnly = false) {
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
  if (likes.length > 100) likes.length = 100;
  saveToStorage(STORAGE_LIKES, likes);
  updateLikesBadge();

  let isMutual = false;
  if (currentUser && !targetProfile.isMock) {
    const reverseLike = likes.find(l =>
      l.likedByUserId === targetProfile.id &&
      l.targetUserId === currentUser.id &&
      !l.isPromptOnly
    );
    if (reverseLike) {
      isMutual = true;
      createMatch(currentUser, targetProfile);
    }
  }

  return isMutual;
}

function createMatch(userA, userB, isSoft = false) {
  const matches = loadFromStorage(STORAGE_MATCHES, []);
  const exists = matches.some(m =>
    (m.userA === userA.id && m.userB === userB.id) ||
    (m.userB === userA.id && m.userA === userB.id)
  );
  if (exists) return;

  const match = {
    id: 'match_' + Date.now(),
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
  if (btnClose) {
    btnClose.addEventListener('click', () => drawer.classList.add('hidden'));
  }
  drawer?.addEventListener('click', (e) => {
    if (e.target === drawer) drawer.classList.add('hidden');
  });
}

function renderLikesList() {
  const list = document.getElementById('likesList');
  const empty = document.getElementById('likesEmpty');
  const likes = loadFromStorage(STORAGE_LIKES, []);

  let relevant = likes;
  if (currentUser) {
    relevant = likes.filter(l => l.targetUserId === currentUser.id || l.likedByUserId === currentUser.id);
  }

  if (!relevant.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = relevant.map(l => `
    <div class="like-item">
      <img src="${l.targetAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=100&q=80'}" alt="" />
      <div class="like-item-info">
        <h4>${escapeHtml(l.targetName || 'Someone')}</h4>
        <p>${l.isPromptOnly ? 'Liked a prompt' : 'Sent intentional like'} · ${formatTime(l.timestamp)}</p>
      </div>
    </div>
  `).join('');
}

function updateLikesBadge() {
  const badge = document.getElementById('likesBadge');
  if (!badge) return;
  const likes = loadFromStorage(STORAGE_LIKES, []);
  const count = currentUser
    ? likes.filter(l => l.targetUserId === currentUser.id).length
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
   7. MESSAGING SYSTEM
   ========================================================================== */
function initMessages() {
  const drawer = document.getElementById('messagesDrawer');
  const btnOpen = document.getElementById('btnOpenMessages');
  const btnClose = document.getElementById('btnCloseMessages');
  const chatForm = document.getElementById('chatForm');
  const btnBackToMatches = document.getElementById('btnBackToMatches');

  if (btnOpen) {
    btnOpen.addEventListener('click', () => {
      renderMatchesList();
      drawer?.classList.remove('hidden');
      document.getElementById('matchesListView')?.classList.remove('hidden');
      document.getElementById('chatView')?.classList.add('hidden');
    });
  }
  if (btnClose) {
    btnClose.addEventListener('click', () => drawer?.classList.add('hidden'));
  }
  drawer?.addEventListener('click', (e) => {
    if (e.target === drawer) drawer.classList.add('hidden');
  });

  if (btnBackToMatches) {
    btnBackToMatches.addEventListener('click', () => {
      document.getElementById('matchesListView')?.classList.remove('hidden');
      document.getElementById('chatView')?.classList.add('hidden');
      activeChatMatchId = null;
    });
  }

  if (chatForm) {
    chatForm.addEventListener('submit', (e) => {
      e.preventDefault();
      sendChatMessage();
    });
  }

  const btnSaveEdit = document.getElementById('btnSaveEditProfile');
  if (btnSaveEdit) {
    btnSaveEdit.addEventListener('click', saveEditedProfile);
  }
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
  return matches.filter(m => m.userA === currentUser.id || m.userB === currentUser.id);
}

function renderMatchesList() {
  const list = document.getElementById('matchesList');
  const empty = document.getElementById('matchesEmpty');
  const matches = getMatchesForCurrentUser();

  if (!matches.length) {
    if (list) list.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  list.innerHTML = matches.map(m => {
    const isA = m.userA === currentUser.id;
    const otherName = isA ? m.userBName : m.userAName;
    const otherAvatar = isA ? m.userBAvatar : m.userAAvatar;
    const lastMsg = getLastMessage(m.id);
    return `
      <div class="match-item" onclick="openChatWithMatch('${m.id}')">
        <img src="${otherAvatar}" alt="" />
        <div class="match-item-info">
          <h4>${escapeHtml(otherName)}</h4>
          <p>${lastMsg ? escapeHtml(lastMsg.text).slice(0, 40) + (lastMsg.text.length > 40 ? '…' : '') : 'Say hello!'}</p>
        </div>
        <span class="match-time">${formatTime(lastMsg ? lastMsg.timestamp : m.createdAt)}</span>
      </div>
    `;
  }).join('');
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
  const matches = loadFromStorage(STORAGE_MATCHES, []);
  const match = matches.find(m => m.id === matchId);
  if (!match) return;

  const isA = match.userA === currentUser.id;
  const otherName = isA ? match.userBName : match.userAName;
  const otherAvatar = isA ? match.userBAvatar : match.userAAvatar;

  document.getElementById('chatPartnerName').textContent = otherName;
  document.getElementById('chatPartnerAvatar').src = otherAvatar;

  renderChatThread(matchId);

  document.getElementById('matchesListView')?.classList.add('hidden');
  document.getElementById('chatView')?.classList.remove('hidden');
  document.getElementById('messagesDrawer')?.classList.remove('hidden');
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
    return `
      <div class="chat-bubble ${isMine ? 'mine' : 'theirs'}">
        <p>${escapeHtml(msg.text)}</p>
        <span class="chat-time">${formatTime(msg.timestamp)}</span>
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

  const messages = loadFromStorage(STORAGE_MESSAGES, {});
  if (!messages[activeChatMatchId]) messages[activeChatMatchId] = [];

  messages[activeChatMatchId].push({
    id: 'msg_' + Date.now(),
    senderId: currentUser.id,
    senderName: currentUser.name,
    text,
    timestamp: new Date().toISOString()
  });
  saveToStorage(STORAGE_MESSAGES, messages);
  input.value = '';
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

function escapeHtml(str) {
  if (str == null) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/* ==========================================================================
   8. FEATURE MODULES (Audio, Proximity Slider, Inline Likes)
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
    // Sync initial value
    maxDistance = parseInt(slider.value, 10) || 25;
    if (valueLabel) valueLabel.textContent = maxDistance;

    slider.addEventListener('input', () => {
      maxDistance = parseInt(slider.value, 10);
      if (valueLabel) valueLabel.textContent = maxDistance;
      applyFilters();
      renderCurrentCard();
      showToast(`Radar set to ${maxDistance} ${preferredUnit === 'km' ? 'km' : 'miles'}`);
    });
  }

  document.querySelectorAll('.proto-prompt-box .inline-like-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.classList.add('liked');
      btn.textContent = '♥ Liked';
      showToast("You liked Sophia's prompt!");
    });
  });
}

/* ==========================================================================
   9. NATIVE WEB SHARE + FALLBACK SOCIAL MODAL
   ========================================================================== */
function initShareModule() {
  const btnShare = document.getElementById('btnSharePlatform');
  if (btnShare) {
    btnShare.addEventListener('click', () => shareQuincyPlatform());
  }

  // Close share modal handlers
  const shareModal = document.getElementById('shareModal');
  const btnCloseShare = document.getElementById('btnCloseShareModal');
  if (btnCloseShare) {
    btnCloseShare.addEventListener('click', () => shareModal?.classList.add('hidden'));
  }
  shareModal?.addEventListener('click', (e) => {
    if (e.target === shareModal) shareModal.classList.add('hidden');
  });

  // Fallback social buttons
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
      // Fallback for older browsers
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

/**
 * Primary share entry point — uses Web Share API when available,
 * otherwise opens the fallback social modal.
 */
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
      // User cancelled or share failed — fall through to modal
      if (err.name === 'AbortError') return;
    }
  } else if (navigator.share) {
    // Older implementations without canShare
    try {
      await navigator.share(shareData);
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  // Fallback modal
  document.getElementById('shareModal')?.classList.remove('hidden');
}

/* ==========================================================================
   10. MANUAL LOCATION FALLBACK
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

  if (btnClose) {
    btnClose.addEventListener('click', () => modal?.classList.add('hidden'));
  }
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

  // Retry geolocation button
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
window.resetSim = resetSim;
window.resetSimFilters = resetSimFilters;
window.openChatWithMatch = openChatWithMatch;
window.shareQuincyPlatform = shareQuincyPlatform;
