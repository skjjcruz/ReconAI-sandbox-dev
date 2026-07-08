// js/shell.js — Native app shell: bottom sheets, pull-to-refresh, gestures

const SHELL_PRIMARY_TABS = ['digest', 'team', 'tools', 'ai'];
const SHELL_TAB_GROUPS = {
  digest: 'digest',
  fieldlog: 'digest',
  team: 'team',
  roster: 'team',
  startsit: 'team',
  tools: 'tools',
  waivers: 'tools',
  trades: 'tools',
  draftroom: 'tools',
  league: 'tools',
  calendar: 'tools',
  history: 'tools',
  analytics: 'tools',
  ai: 'ai',
  portfolio: 'tools',
};

function _prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function _isTextEntry(el) {
  return !!el?.closest?.('input, textarea, select, [contenteditable="true"]');
}

function _hasBlockingOverlay() {
  return !!(
    document.body.classList.contains('keyboard-open') ||
    document.body.classList.contains('gm-bar-active') ||
    document.body.classList.contains('gm-bar-typing') ||
    document.querySelector('.pm-overlay.open') ||
    document.querySelector('.bottom-sheet.open') ||
    document.querySelector('.override-modal-visible') ||
    document.querySelector('.trial-expired-overlay[style*="flex"]')
  );
}

function _triggerHaptic(pattern = 8) {
  if (_prefersReducedMotion()) return;
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {}
}

function _currentPrimaryTab() {
  const active = document.querySelector('.panel.active');
  const tab = active?.id?.replace(/^panel-/, '') || 'digest';
  return SHELL_TAB_GROUPS[tab] || tab;
}

function _goPrimaryTab(delta) {
  const current = _currentPrimaryTab();
  const idx = SHELL_PRIMARY_TABS.indexOf(current);
  if (idx < 0) return false;
  const next = SHELL_PRIMARY_TABS[idx + delta];
  if (!next) return false;
  _triggerHaptic(10);
  if (typeof window.mobileTab === 'function') window.mobileTab(next);
  else if (typeof window.switchTab === 'function') window.switchTab(next, null);
  return true;
}

// ── Generic Bottom Sheet ────────────────────────────────────────

function openBottomSheet(contentHtml) {
  let backdrop = document.getElementById('bs-backdrop');
  let sheet = document.getElementById('bs-sheet');

  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'bs-backdrop';
    backdrop.className = 'bottom-sheet-backdrop';
    backdrop.onclick = closeBottomSheet;
    document.body.appendChild(backdrop);

    sheet = document.createElement('div');
    sheet.id = 'bs-sheet';
    sheet.className = 'bottom-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.innerHTML = '<div class="bottom-sheet-handle"></div><div id="bs-content"></div>';
    document.body.appendChild(sheet);

    let startY = 0;
    sheet.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    sheet.addEventListener('touchmove', e => {
      const dy = e.touches[0].clientY - startY;
      if (dy > 0 && sheet.scrollTop === 0) {
        sheet.style.transform = `translateY(${dy}px)`;
        e.preventDefault();
      }
    }, { passive: false });
    sheet.addEventListener('touchend', e => {
      const dy = e.changedTouches[0].clientY - startY;
      if (dy > 100) closeBottomSheet();
      else sheet.style.transform = '';
    }, { passive: true });
  }

  document.getElementById('bs-content').innerHTML = contentHtml;
  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    sheet.classList.add('open');
  });
  document.body.style.overflow = 'hidden';
  document.body.classList.add('sheet-open');
  _triggerHaptic(8);
}

function closeBottomSheet() {
  const backdrop = document.getElementById('bs-backdrop');
  const sheet = document.getElementById('bs-sheet');
  if (sheet) { sheet.classList.remove('open'); sheet.style.transform = ''; }
  if (backdrop) backdrop.classList.remove('open');
  document.body.style.overflow = '';
  document.body.classList.remove('sheet-open');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeBottomSheet();
});

// ── Tab Transition Animation ────────────────────────────────────

function _animatePanel(panel) {
  if (!panel || _prefersReducedMotion()) return;
  panel.classList.remove('tab-anim');
  void panel.offsetWidth;
  panel.classList.add('tab-anim');
  panel.addEventListener('animationend', () => panel.classList.remove('tab-anim'), { once: true });
}

window._animatePanel = _animatePanel;

// ── Pull-to-Refresh ─────────────────────────────────────────────

function _initPullToRefresh() {
  const content = document.querySelector('.content');
  if (!content || content.dataset.ptrReady === '1') return;
  content.dataset.ptrReady = '1';

  let ind = document.getElementById('ptr-indicator');
  if (!ind) {
    ind = document.createElement('div');
    ind.id = 'ptr-indicator';
    ind.className = 'ptr-indicator';
    ind.innerHTML = '<span class="ptr-glyph"></span><span class="ptr-copy">Pull to refresh</span>';
    content.prepend(ind);
  }

  let startY = 0;
  let startX = 0;
  let active = false;
  let pulling = false;
  let primed = false;
  let refreshing = false;
  const trigger = 96;
  const maxPull = 86;
  const copy = ind.querySelector('.ptr-copy');

  function resetPull(delay = 0) {
    window.setTimeout(() => {
      content.classList.remove('ptr-pulling');
      ind.classList.remove('visible', 'ready', 'refreshing');
      ind.style.setProperty('--ptr-progress', '0');
      content.style.transform = '';
      if (copy) copy.textContent = 'Pull to refresh';
      active = false;
      pulling = false;
      primed = false;
      refreshing = false;
    }, delay);
  }

  function refreshData() {
    if (typeof window.handleRefreshClick === 'function') return window.handleRefreshClick();
    if (typeof window.loadAllData === 'function') return window.loadAllData();
    if (typeof window.renderMobileHome === 'function') return window.renderMobileHome();
    return null;
  }

  content.addEventListener('touchstart', e => {
    if (refreshing || e.touches.length !== 1 || _hasBlockingOverlay() || _isTextEntry(e.target)) {
      active = false;
      return;
    }
    startY = e.touches[0].clientY;
    startX = e.touches[0].clientX;
    active = content.scrollTop <= 1;
    pulling = false;
    primed = false;
  }, { passive: true });

  content.addEventListener('touchmove', e => {
    if (!active) return;
    const touch = e.touches[0];
    const dy = touch.clientY - startY;
    const dx = touch.clientX - startX;
    if (dy <= 0 || Math.abs(dx) > dy * 1.25) {
      resetPull();
      return;
    }
    if (dy < 12) return;
    e.preventDefault();
    pulling = true;
    const eased = Math.min(maxPull, Math.round(dy * 0.42));
    const progress = Math.min(1, dy / trigger);
    content.classList.add('ptr-pulling');
    content.style.transform = `translateY(${eased}px)`;
    ind.style.setProperty('--ptr-progress', progress.toFixed(2));
    ind.classList.add('visible');
    ind.classList.toggle('ready', dy >= trigger);
    if (copy) copy.textContent = dy >= trigger ? 'Release to refresh' : 'Pull to refresh';
    if (!primed && dy >= trigger) {
      primed = true;
      _triggerHaptic(12);
    }
  }, { passive: false });

  content.addEventListener('touchend', e => {
    if (!active || !pulling) {
      resetPull();
      return;
    }
    const dy = e.changedTouches[0].clientY - startY;
    if (dy >= trigger) {
      refreshing = true;
      content.style.transform = 'translateY(46px)';
      ind.classList.add('visible', 'refreshing');
      if (copy) copy.textContent = 'Refreshing';
      Promise.resolve(refreshData()).finally(() => resetPull(500));
    } else {
      resetPull();
    }
  }, { passive: true });
}

// ── Primary Tab Swipe Navigation ────────────────────────────────

function _horizontalScrollerFrom(target) {
  for (let el = target; el && el !== document.body; el = el.parentElement) {
    const style = window.getComputedStyle(el);
    const canScroll = el.scrollWidth > el.clientWidth + 8;
    if (canScroll && (style.overflowX === 'auto' || style.overflowX === 'scroll')) return el;
  }
  return null;
}

function _initPrimaryTabSwipes() {
  const content = document.querySelector('.content');
  if (!content || content.dataset.swipeReady === '1') return;
  content.dataset.swipeReady = '1';

  let startX = 0;
  let startY = 0;
  let startTarget = null;
  let maybeSwipe = false;

  content.addEventListener('touchstart', e => {
    if (e.touches.length !== 1 || _hasBlockingOverlay() || _isTextEntry(e.target) || _horizontalScrollerFrom(e.target)) {
      maybeSwipe = false;
      return;
    }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTarget = e.target;
    maybeSwipe = true;
  }, { passive: true });

  content.addEventListener('touchmove', e => {
    if (!maybeSwipe) return;
    const dx = e.touches[0].clientX - startX;
    const dy = e.touches[0].clientY - startY;
    if (Math.abs(dy) > 28 && Math.abs(dy) > Math.abs(dx)) maybeSwipe = false;
    if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy) * 1.35) e.preventDefault();
  }, { passive: false });

  content.addEventListener('touchend', e => {
    if (!maybeSwipe) return;
    const dx = e.changedTouches[0].clientX - startX;
    const dy = e.changedTouches[0].clientY - startY;
    maybeSwipe = false;
    if (Math.abs(dx) < 74 || Math.abs(dx) < Math.abs(dy) * 1.45) return;
    if (startTarget?.closest?.('[data-no-tab-swipe], .search-results, #unified-search-results')) return;
    _goPrimaryTab(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ── App Shell Classes and Touch Feedback ────────────────────────

function _markShellEnvironment() {
  const standalone = window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  document.body.classList.toggle('ios-standalone', !!(ios && standalone));
  document.body.classList.toggle('touch-device', window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
  _applyScoutProChrome();
}

// Scout Pro chrome — the .is-pro body class (drives CSS-gated surfaces like the
// iPad/landscape layout) + the header wordmark. Safe to re-run; called at boot
// and again after loadUserTier() resolves the async paid tier.
function _applyScoutProChrome() {
  try {
    const pro = typeof window.isScoutPro === 'function' && window.isScoutPro();
    document.body.classList.toggle('is-pro', !!pro);
    const logoSpan = document.querySelector('.logo span');
    if (logoSpan) logoSpan.textContent = pro ? 'Scout Pro' : 'Scout';
  } catch (_) { /* ignore */ }
}
window._applyScoutProChrome = _applyScoutProChrome;

function _patchNavigationHooks() {
  if (window.mobileTab && !window.mobileTab.__shellPatched) {
    const original = window.mobileTab;
    window.mobileTab = function shellMobileTab(tab, btn) {
      const current = _currentPrimaryTab();
      const result = original.apply(this, arguments);
      const next = SHELL_TAB_GROUPS[tab] || tab;
      if (next !== current) {
        _triggerHaptic(8);
        document.querySelector('.content')?.scrollTo?.({ top: 0, behavior: _prefersReducedMotion() ? 'auto' : 'smooth' });
      }
      return result;
    };
    window.mobileTab.__shellPatched = true;
  }
}

function _initTouchFeedback() {
  if (document.documentElement.dataset.shellTouchFeedback === '1') return;
  document.documentElement.dataset.shellTouchFeedback = '1';
  document.addEventListener('pointerup', e => {
    if (e.pointerType === 'mouse') return;
    const target = e.target?.closest?.('button, [role="button"], summary, .mobile-nav-item, .chip, .ctx-chip, [onclick]');
    if (!target || target.disabled || target.getAttribute?.('aria-disabled') === 'true') return;
    _triggerHaptic(6);
  }, { passive: true });
}

function _initShell() {
  _markShellEnvironment();
  _initPullToRefresh();
  _initPrimaryTabSwipes();
  _patchNavigationHooks();
  _initTouchFeedback();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _initShell);
} else {
  _initShell();
}

// ── Exports ─────────────────────────────────────────────────────

window.openBottomSheet = openBottomSheet;
window.closeBottomSheet = closeBottomSheet;
window.ScoutShell = {
  haptic: _triggerHaptic,
  goPrimaryTab: _goPrimaryTab,
};
