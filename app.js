// app.js

/**
 * Quincy Dating Platform — Interactive Client Logic
 * State-driven, localStorage-persisted, modular Vanilla JS
 */

document.addEventListener('DOMContentLoaded', () => {
  initAgeGate();
  initStatsCounter();
  initState();
  initInteractiveSimulator();
  initMatchModal();
  initRegistration();
  initFeatureModules();
  initLikesDrawer();
  initManageProfile();
  updateUIForUser();
});

/* ==========================================================================
   STATE & STORAGE HELPERS
   ========================================================================== */
const STORAGE_PROFILES = 'quincy_registered_profiles';
const STORAGE_LIKES = 'quincy_likes_received';
const STORAGE_CURRENT_USER = 'quincy_current_user';

const defaultMockProfiles = [
  {
    id: 1,
    name: "Maya",
    age: 27,
    occupation: "Architect & Designer",
    distance: "1.8 miles away",
    distanceNum: 1.8,
    matchScore: "98% Match",
    intent: "marriage",
    verified: true,
    avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80",
    promptTag: "Relationship Goal",
    promptQuestion: "The key to a lasting partnership is...",
    promptAnswer: "Intentional communication, space for individual growth, and agreeing on what weekend coffee spot is non-negotiable."
  },
  {
    id: 2,
    name: "Marcus",
    age: 29,
    occupation: "Software Lead",
    distance: "3.2 miles away",
    distanceNum: 3.2,
    matchScore: "94% Match",
    intent: "marriage",
    verified: true,
    avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80",
    promptTag: "Sunday Vibe",
    promptQuestion: "Together we could...",
    promptAnswer: "Explore local farmers markets, spend hours arguing over book recommendations, and build a quiet life filled with deep conversations."
  },
  {
    id: 3,
    name: "Elena",
    age: 26,
    occupation: "Biomedical Researcher",
    distance: "2.4 miles away",
    distanceNum: 2.4,
    matchScore: "96% Match",
    intent: "verified",
    verified: true,
    avatar: "https://images.unsplash.com/photo-1517841905240-472988babdf9?auto=format&fit=crop&w=300&q=80",
    promptTag: "Green Flags I Look For",
    promptQuestion: "I know we'll get along if...",
    promptAnswer: "You value clarity over mind games, love long dinner table discussions, and treat hospitality as a core art form."
  },
  {
    id: 4,
    name: "Jordan",
    age: 31,
    occupation: "Product Manager",
    distance: "8.5 miles away",
    distanceNum: 8.5,
    matchScore: "91% Match",
    intent: "long-term",
    verified: true,
    avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80",
    promptTag: "Dating Intent",
    promptQuestion: "I'm looking for someone who...",
    promptAnswer: "Can hold space for both ambition and rest, and still make time for spontaneous road trips."
  },
  {
    id: 5,
    name: "Alex",
    age: 28,
    occupation: "UX Researcher",
    distance: "12.1 miles away",
    distanceNum: 12.1,
    matchScore: "89% Match",
    intent: "marriage",
    verified: false,
    avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80",
    promptTag: "Non-Negotiable",
    promptQuestion: "A dealbreaker for me is...",
    promptAnswer: "Lack of curiosity. I need someone who asks questions and stays open to changing their mind."
  }
];

let allProfiles = [];
let filteredProfiles = [];
let currentProfileIndex = 0;
let currentFilter = 'all';
let maxDistance = 25;
let currentUser = null;

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

function initState() {
  const registered = loadFromStorage(STORAGE_PROFILES, []);
  currentUser = loadFromStorage(STORAGE_CURRENT_USER, null);
  allProfiles = [...defaultMockProfiles, ...registered];
  applyFilters();
}

function applyFilters() {
  filteredProfiles = allProfiles.filter(p => {
    const distOk = (p.distanceNum || parseFloat(p.distance) || 99) <= maxDistance;
    if (!distOk) return false;
    if (currentFilter === 'all') return true;
    if (currentFilter === 'marriage') return p.intent === 'marriage' || p.intent === 'long-term';
    if (currentFilter === 'verified') return p.verified === true;
    return true;
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

function renderCurrentCard() {
  const cardStack = document.getElementById('simCardStack');
  const profile = filteredProfiles[currentProfileIndex];

  if (!profile) {
    cardStack.innerHTML = `
      <div class="sim-profile-card text-center" style="padding: 40px;">
        <h3>All Catchup Complete!</h3>
        <p style="color: var(--text-muted); margin: 12px 0 20px;">You've previewed all nearby value-matched profiles in your current radar.</p>
        <button class="btn btn-primary" onclick="resetSim()">Restart Preview Stack</button>
      </div>
    `;
    updateStatusText('No more profiles in range. Adjust distance or filters.');
    return;
  }

  const verifiedBadge = profile.verified
    ? '<span class="verified-badge" title="ID Verified" style="display:inline-flex;width:16px;height:16px;background:#3B82F6;color:white;border-radius:50%;font-size:0.65rem;align-items:center;justify-content:center;margin-left:4px;">✓</span>'
    : '';

  cardStack.innerHTML = `
    <div class="sim-profile-card" id="currentSimCard">
      <div class="sim-card-header">
        <img src="${profile.avatar}" alt="${profile.name}" class="sim-avatar" />
        <div class="sim-details">
          <h3>${profile.name}, ${profile.age} ${verifiedBadge}</h3>
          <p class="sim-meta">${profile.occupation} • ${profile.distance}</p>
        </div>
        <div class="sim-match-pill">${profile.matchScore}</div>
      </div>

      <div class="sim-prompt prompt-clickable" data-prompt-id="${profile.id}">
        <div class="sim-prompt-title">${profile.promptTag}</div>
        <div class="sim-prompt-body">"${profile.promptQuestion}"</div>
        <p style="font-size: 0.85rem; color: var(--text-muted); margin-top: 8px;">${profile.promptAnswer}</p>
        <button class="inline-like-btn" onclick="handleInlineLike(${profile.id})">♥ Like Prompt</button>
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
    recordLike(currentProfile);
    setTimeout(() => {
      triggerMatchCelebration(currentProfile);
    }, 280);
  } else {
    if (card) card.classList.add('swipe-left');
    setTimeout(() => advanceProfile(), 320);
  }
}

function handleInlineLike(profileId) {
  const profile = allProfiles.find(p => p.id === profileId);
  if (!profile) return;
  const btn = document.querySelector(`.inline-like-btn`);
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

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      matchModal.classList.add('hidden');
      document.getElementById('firstMoveIndicator')?.classList.add('hidden');
      advanceProfile();
    });
  }
}

function triggerMatchCelebration(profile) {
  const matchModal = document.getElementById('matchModal');
  const matchNameHeading = document.getElementById('matchNameHeading');
  const matchTargetAvatar = document.getElementById('matchTargetAvatar');
  const firstMove = document.getElementById('firstMoveIndicator');
  const userAvatar = document.getElementById('matchUserAvatar');

  if (matchNameHeading) matchNameHeading.innerText = `You & ${profile.name} Connected!`;
  if (matchTargetAvatar) matchTargetAvatar.src = profile.avatar;
  if (currentUser && userAvatar) {
    userAvatar.src = currentUser.avatar;
  }
  if (firstMove) firstMove.classList.remove('hidden');

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
   5. REGISTRATION & PROFILE MANAGEMENT
   ========================================================================== */
function initRegistration() {
  const modal = document.getElementById('registerModal');
  const form = document.getElementById('registerForm');
  const btnOpen = document.getElementById('btnOpenRegister');
  const btnHero = document.getElementById('btnHeroRegister');
  const btnCancel = document.getElementById('btnCancelRegister');

  const open = () => modal.classList.remove('hidden');
  const close = () => modal.classList.add('hidden');

  if (btnOpen) btnOpen.addEventListener('click', open);
  if (btnHero) btnHero.addEventListener('click', open);
  if (btnCancel) btnCancel.addEventListener('click', close);

  // Avatar presets
  document.querySelectorAll('.avatar-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.avatar-preset').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('regAvatar').value = btn.dataset.url;
    });
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!validateRegistrationForm()) return;

    const profile = buildProfileFromForm();
    const registered = loadFromStorage(STORAGE_PROFILES, []);
    registered.push(profile);
    saveToStorage(STORAGE_PROFILES, registered);
    saveToStorage(STORAGE_CURRENT_USER, profile);
    currentUser = profile;

    allProfiles = [...defaultMockProfiles, ...registered];
    applyFilters();
    renderCurrentCard();
    updateUIForUser();
    close();
    showToast(`Welcome, ${profile.name}! Your profile is live.`);
  });
}

function validateRegistrationForm() {
  let valid = true;
  const clear = (id) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.previousElementSibling?.classList.remove('invalid'); }
  };
  const err = (id, msg) => {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    valid = false;
  };

  ['errName','errAge','errOccupation','errIntent','errAvatar','errPromptQuestion','errPromptAnswer'].forEach(clear);

  const name = document.getElementById('regName').value.trim();
  const age = parseInt(document.getElementById('regAge').value, 10);
  const occupation = document.getElementById('regOccupation').value.trim();
  const intent = document.getElementById('regIntent').value;
  const avatar = document.getElementById('regAvatar').value.trim();
  const q = document.getElementById('regPromptQuestion').value.trim();
  const a = document.getElementById('regPromptAnswer').value.trim();

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

  const dist = (Math.random() * 4 + 0.8).toFixed(1);
  const score = Math.floor(Math.random() * 8 + 90);

  return {
    id: Date.now(),
    name,
    age,
    occupation,
    distance: `${dist} miles away`,
    distanceNum: parseFloat(dist),
    matchScore: `${score}% Match`,
    intent,
    verified,
    avatar,
    promptTag,
    promptQuestion,
    promptAnswer,
    isUser: true
  };
}

function initManageProfile() {
  const btn = document.getElementById('btnManageProfile');
  const eraseModal = document.getElementById('eraseConfirmModal');
  const btnConfirm = document.getElementById('btnConfirmErase');
  const btnCancel = document.getElementById('btnCancelErase');

  if (btn) {
    btn.addEventListener('click', () => {
      eraseModal.classList.remove('hidden');
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
      currentUser = null;

      allProfiles = [...defaultMockProfiles, ...registered];
      applyFilters();
      renderCurrentCard();
      updateUIForUser();
      eraseModal.classList.add('hidden');
      showToast('Your profile has been permanently erased.');
    });
  }
}

function updateUIForUser() {
  const manageBtn = document.getElementById('btnManageProfile');
  const regBtn = document.getElementById('btnOpenRegister');
  if (currentUser) {
    if (manageBtn) manageBtn.classList.remove('hidden');
    if (regBtn) regBtn.textContent = 'Your Profile ✓';
  } else {
    if (manageBtn) manageBtn.classList.add('hidden');
    if (regBtn) regBtn.textContent = 'Try Demo / Register';
  }
  updateLikesBadge();
}

/* ==========================================================================
   6. LIKES TRACKING & DRAWER
   ========================================================================== */
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
  // Keep last 50
  if (likes.length > 50) likes.length = 50;
  saveToStorage(STORAGE_LIKES, likes);
  updateLikesBadge();
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
  // Click outside panel to close
  drawer?.addEventListener('click', (e) => {
    if (e.target === drawer) drawer.classList.add('hidden');
  });
}

function renderLikesList() {
  const list = document.getElementById('likesList');
  const empty = document.getElementById('likesEmpty');
  const likes = loadFromStorage(STORAGE_LIKES, []);

  // Show likes directed at the current user, or all recent likes if guest
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
        <h4>${l.targetName || 'Someone'}</h4>
        <p>${l.isPromptOnly ? 'Liked a prompt' : 'Sent intentional like'} · ${formatTime(l.timestamp)}</p>
      </div>
    </div>
  `).join('');
}

function updateLikesBadge() {
  const badge = document.getElementById('likesBadge');
  if (!badge) return;
  const likes = loadFromStorage(STORAGE_LIKES, []);
  const count = likes.length;
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
   7. FEATURE MODULES (Audio, Proximity Slider, Inline Likes)
   ========================================================================== */
function initFeatureModules() {
  // Audio player simulation
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
        // Simulate 4s clip
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

  // Proximity slider
  const slider = document.getElementById('proximitySlider');
  const valueLabel = document.getElementById('proximityValue');
  if (slider) {
    slider.addEventListener('input', () => {
      maxDistance = parseInt(slider.value, 10);
      if (valueLabel) valueLabel.textContent = maxDistance;
      applyFilters();
      renderCurrentCard();
      showToast(`Radar set to ${maxDistance} miles`);
    });
  }

  // Hero card inline like
  document.querySelectorAll('.proto-prompt-box .inline-like-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.classList.add('liked');
      btn.textContent = '♥ Liked';
      showToast('You liked Sophia\'s prompt!');
    });
  });
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

// Expose for inline onclick handlers
window.handleSimAction = handleSimAction;
window.handleInlineLike = handleInlineLike;
window.resetSim = resetSim;
