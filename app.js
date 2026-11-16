const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

const CURRENCIES = {
  JPY: { symbol: '¥', label: 'JPY', cacheKey: 'rate_cache_JPY', decimals: 4, amountDecimals: 0 },
  USD: { symbol: '$', label: 'USD', cacheKey: 'rate_cache_USD', decimals: 6, amountDecimals: 2 },
};

const amountInput     = document.getElementById('amount-input');
const ntdInput        = document.getElementById('ntd-input');
const rateText        = document.getElementById('rate-text');
const rateTime        = document.getElementById('rate-time');
const refreshBtn      = document.getElementById('refresh-btn');
const plus10Checkbox  = document.getElementById('plus10-checkbox');
const minus10Checkbox = document.getElementById('minus10-checkbox');
const customCheckbox  = document.getElementById('custom-checkbox');
const customPctInput  = document.getElementById('custom-pct');
const signBtn         = document.getElementById('sign-btn');
const adjustCheckboxes = [minus10Checkbox, plus10Checkbox, customCheckbox];
const errorBanner     = document.getElementById('error-banner');
const errorMsg        = document.getElementById('error-msg');
const headerLogo      = document.getElementById('header-logo');
const headerTitle     = document.getElementById('header-title');
const inputLabel      = document.getElementById('input-label');
const inputPrefix     = document.getElementById('input-prefix');
const toggleBtns      = document.querySelectorAll('.toggle-btn');

const CUSTOM_PCT_KEY = 'custom_pct';
const CUSTOM_CHECKED_KEY = 'custom_checked';

let currentCurrency = 'JPY';
let currentRate = null;
let lastEdited = 'foreign'; // 'foreign' or 'ntd'

function roundTo(value, decimals) {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

// Keep only a valid number in a text field (also converts full-width digits)
function sanitizeNumber(el, allowNegative = false) {
  let v = el.value.replace(/[０-９．－]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  v = v.replace(/,/g, '.');
  v = v.replace(allowNegative ? /[^0-9.\-]/g : /[^0-9.]/g, '');
  if (allowNegative) v = (v.startsWith('-') ? '-' : '') + v.replace(/-/g, '');
  const dot = v.indexOf('.');
  if (dot >= 0) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
  if (v !== el.value) el.value = v;
}

function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} mins ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

function showError(message) {
  errorMsg.textContent = message;
  errorBanner.classList.remove('hidden');
}

function hideError() {
  errorBanner.classList.add('hidden');
}

function getMultiplier() {
  if (plus10Checkbox.checked) return 1.1;
  if (minus10Checkbox.checked) return 0.9;
  if (customCheckbox.checked) {
    const pct = parseFloat(customPctInput.value);
    if (isNaN(pct)) return 1.0;
    const m = 1 + pct / 100;
    return m > 0 ? m : null; // -100% or lower is invalid
  }
  return 1.0;
}

// Foreign → NTD
function updateFromForeign() {
  if (currentRate === null) return;
  const amount = parseFloat(amountInput.value);
  if (!amountInput.value || isNaN(amount) || amount < 0) { ntdInput.value = ''; return; }
  const m = getMultiplier();
  if (m === null) { ntdInput.value = ''; return; }
  ntdInput.value = Math.round(amount * currentRate * m);
}

// NTD → Foreign
function updateFromNTD() {
  if (currentRate === null) return;
  const ntd = parseFloat(ntdInput.value);
  if (!ntdInput.value || isNaN(ntd) || ntd < 0) { amountInput.value = ''; return; }
  const cfg = CURRENCIES[currentCurrency];
  const m = getMultiplier();
  if (m === null) { amountInput.value = ''; return; }
  amountInput.value = roundTo(ntd / (currentRate * m), cfg.amountDecimals);
}

function updateResult() {
  if (lastEdited === 'ntd') updateFromNTD();
  else updateFromForeign();
}

function updateLabels() {
  const cfg = CURRENCIES[currentCurrency];
  headerLogo.textContent = cfg.symbol;
  headerTitle.textContent = `${cfg.label} → NTD`;
  inputLabel.textContent = `Amount in ${cfg.label}`;
  inputPrefix.textContent = cfg.symbol;
  amountInput.value = '';
  ntdInput.value = '';
  lastEdited = 'foreign';
}

// ignoreTTL: return an old rate too (used when offline)
function getCachedRate(currency, ignoreTTL = false) {
  try {
    const cached = localStorage.getItem(CURRENCIES[currency].cacheKey);
    if (!cached) return null;
    const { rate, timestamp } = JSON.parse(cached);
    if (!ignoreTTL && Date.now() - timestamp > CACHE_TTL_MS) return null;
    return { rate, timestamp };
  } catch { return null; }
}

function setCachedRate(currency, rate) {
  try {
    localStorage.setItem(CURRENCIES[currency].cacheKey, JSON.stringify({ rate, timestamp: Date.now() }));
  } catch {}
}

function setRate(rate, timestamp) {
  const cfg = CURRENCIES[currentCurrency];
  currentRate = rate;
  rateText.textContent = `1 ${cfg.label} = ${rate.toFixed(cfg.decimals)} TWD`;
  rateTime.textContent = `Updated ${timeAgo(timestamp)}`;
  updateResult();
}

async function fetchRate(forceRefresh = false) {
  const currency = currentCurrency;

  if (!forceRefresh) {
    const cached = getCachedRate(currency);
    if (cached) { setRate(cached.rate, cached.timestamp); return; }
  }

  refreshBtn.classList.add('spinning');
  rateText.textContent = 'Fetching rate…';
  rateTime.textContent = '';
  hideError();

  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${currency}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.result !== 'success') throw new Error('API error');
    const rate = data.rates['TWD'];
    if (!rate) throw new Error('TWD rate not available');
    setCachedRate(currency, rate);
    if (currentCurrency === currency) setRate(rate, Date.now());
  } catch (err) {
    if (currentCurrency !== currency) return;
    const stale = getCachedRate(currency, true);
    if (stale) {
      // Offline: fall back to the last saved rate
      const cfg = CURRENCIES[currency];
      currentRate = stale.rate;
      rateText.textContent = `1 ${cfg.label} ≈ ${stale.rate.toFixed(cfg.decimals)} TWD (offline)`;
      rateTime.textContent = `Saved ${timeAgo(stale.timestamp)}`;
      showError('Offline — using the last saved rate.');
      updateResult();
    } else {
      rateText.textContent = 'Failed to fetch rate';
      showError('Could not load exchange rate. Check your connection and try refreshing.');
    }
  } finally {
    refreshBtn.classList.remove('spinning');
  }
}

// Currency toggle
toggleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.currency === currentCurrency) return;
    toggleBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCurrency = btn.dataset.currency;
    currentRate = null;
    updateLabels();
    fetchRate();
  });
});

amountInput.addEventListener('input', () => { sanitizeNumber(amountInput); lastEdited = 'foreign'; updateFromForeign(); });
ntdInput.addEventListener('input', () => { sanitizeNumber(ntdInput); lastEdited = 'ntd'; updateFromNTD(); });

// -10%, +10% and custom % are mutually exclusive
function selectAdjust(changed) {
  if (changed.checked) adjustCheckboxes.forEach(cb => { if (cb !== changed) cb.checked = false; });
  try { localStorage.setItem(CUSTOM_CHECKED_KEY, customCheckbox.checked ? '1' : '0'); } catch {}
  updateResult();
}
adjustCheckboxes.forEach(cb => cb.addEventListener('change', () => selectAdjust(cb)));

// Remember the last custom % (and whether it is selected)
try {
  const saved = localStorage.getItem(CUSTOM_PCT_KEY);
  if (saved !== null) customPctInput.value = saved;
  customCheckbox.checked = localStorage.getItem(CUSTOM_CHECKED_KEY) === '1';
} catch {}

function onCustomPctChanged() {
  try { localStorage.setItem(CUSTOM_PCT_KEY, customPctInput.value); } catch {}
  customCheckbox.checked = true;
  selectAdjust(customCheckbox);
}

// Typing a custom % automatically selects it
customPctInput.addEventListener('input', () => {
  sanitizeNumber(customPctInput, true);
  onCustomPctChanged();
});

// ± button: the iPhone number pad has no minus key
signBtn.addEventListener('click', () => {
  const v = customPctInput.value;
  customPctInput.value = v.startsWith('-') ? v.slice(1) : '-' + v;
  onCustomPctChanged();
});

refreshBtn.addEventListener('click', () => fetchRate(true));

// Refresh the rate when the app comes back to the foreground
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') fetchRate();
});

fetchRate();

// Offline support
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
