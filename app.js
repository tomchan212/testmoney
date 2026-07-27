/* ===== Configuration ===== */
const API_ENDPOINTS = {
  production: {
    label: '正式試算表',
    // 部署 apps-script/Code.production.gs 後，把 URL 貼這裡
    url: 'https://script.google.com/macros/s/AKfycbx_nd8jTwptzqNIEFE0jYeyAAsooNiIw2JUlf4gSukgO8vRV4tiqu5FO_22ZeKXQt08XQ/exec',
    spreadsheetId: '1zOCbb5gvBsom2p7KVSjFx3-SVyN6G5wQFBvI4cOWWh0',
    sheetGid: '48656539',
    spreadsheetUrl:
      'https://docs.google.com/spreadsheets/d/1zOCbb5gvBsom2p7KVSjFx3-SVyN6G5wQFBvI4cOWWh0/edit?gid=48656539#gid=48656539',
  },
  tester: {
    label: '測試試算表',
    // 部署 apps-script/Code.tester.gs 後，把「測試專案」的部署 URL 貼這裡（必須與正式不同）
    url: 'https://script.google.com/macros/s/AKfycbxuBkrGQpP56BEmrMCRPBkrTdGYpPkP4GBDtgLAPR24CSoLRKtGWo8vy_TFbvmu6jGPNA/exec',
    spreadsheetId: '1feUcrJ6_2HoJaWio22-rpycrFaLgaFThIcI0LBXaAzU',
    sheetGid: '48656539',
    spreadsheetUrl:
      'https://docs.google.com/spreadsheets/d/1feUcrJ6_2HoJaWio22-rpycrFaLgaFThIcI0LBXaAzU/edit?gid=48656539#gid=48656539',
  },
};

const API_STORAGE_KEY = 'money-api-endpoint';
const THEME_STORAGE_KEY = 'money-theme';
const PARTICLE_COLORS_LIGHT = ['#ff758c', '#ff7eb3', '#ffc2d1', '#fff0f3', '#f7c948', '#ffffff'];
const PARTICLE_COLORS_CYBER = ['#ff2bd6', '#00f6ff', '#7a3cff', '#39ff14', '#ffffff', '#ff9f1c'];
let PARTICLE_COLORS = PARTICLE_COLORS_LIGHT;

function resolveApiEndpoint() {
  const saved = localStorage.getItem(API_STORAGE_KEY);
  // 先用測試表驗證 location 等新功能；要切回正式可在同步狀態切換
  return saved === 'production' ? 'production' : 'tester';
}

function getActiveEndpoint() {
  return API_ENDPOINTS[apiEndpointKey] || API_ENDPOINTS.production;
}

function getApiUrl() {
  return getActiveEndpoint().url;
}

let apiEndpointKey = resolveApiEndpoint();
let API_URL = getApiUrl();

const CATEGORY_EMOJI = {
  餐飲: '🍱',
  '餐飲-早餐': '🌅',
  '餐飲-午餐': '☀️',
  '餐飲-晚餐': '🌙',
  交通: '🚗',
  住宿: '🏨',
  購物: '🛍️',
  景點: '🎟️',
  便利店: '🏪',
  雜項: '📦',
  還錢: '🤝🏻',
};

const PREDEFINED_CATEGORIES = Object.keys(CATEGORY_EMOJI);
const CUSTOM_CATEGORY = '__custom__';

const PERSON_EMOJI = {
  A: '👦🏻',
  B: '👩🏻',
};

const SPLIT_LABELS = {
  SPLIT_5050: '👥 一人一半',
  FOR_A: `${PERSON_EMOJI.A} 自己嘅`,
  FOR_B: `${PERSON_EMOJI.B} 自己嘅`,
  REPAY: '🤝🏻 還錢',
};

const REPAY_CATEGORY = '還錢';

const DEFAULT_BUDGETS = {
  A: { JPY: 150000, HKD: 5000 },
  B: { JPY: 150000, HKD: 5000 },
};

const SYNC_INTERVAL_MS = 15000;

const CURRENCY_SYMBOL = {
  JPY: '¥',
  HKD: '$',
};

let detailModalKey = null;

/* ===== State ===== */
let transactions = [];
let budgets = structuredClone(DEFAULT_BUDGETS);
let summary = null;
let toastTimer = null;
let syncTimer = null;
let isMutating = false;
let lastSyncedAt = null;
let currencyView = 'jpy';
let loadingProgressTimer = null;
let loadingProgressValue = 0;

const listFilters = {
  dayFrom: '',
  dayTo: '',
  sortAmount: '',
  sortDate: 'desc',
  category: '',
  splitMode: '',
  pageSize: 10,
  currentPage: 1,
};

/* ===== DOM References ===== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const els = {
  toast: $('#toast'),
  loading: $('#loading-overlay'),
  transactionList: $('#transaction-list'),
  expenseForm: $('#expense-form'),
  expenseDate: $('#expense-date'),
  budgetForm: $('#budget-form'),
  editForm: $('#edit-form'),
  budgetModal: $('#budget-modal'),
  editModal: $('#edit-modal'),
  detailModal: $('#detail-modal'),
  repayModal: $('#repay-modal'),
  deleteConfirmModal: $('#delete-confirm-modal'),
};

/* ===== Utilities ===== */
function showToast(message, type = 'info') {
  els.toast.textContent = message;
  els.toast.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2800);
}

function setLoadingProgress(percent) {
  loadingProgressValue = Math.max(0, Math.min(100, Math.round(percent)));
  const label = $('#loading-percent');
  if (label) label.textContent = `${loadingProgressValue}%`;
  const bar = $('#loading-progress-bar');
  if (bar) bar.style.width = `${loadingProgressValue}%`;
}

function stopLoadingProgress() {
  if (loadingProgressTimer) {
    clearInterval(loadingProgressTimer);
    loadingProgressTimer = null;
  }
}

function startLoadingProgress() {
  stopLoadingProgress();
  setLoadingProgress(0);
  loadingProgressTimer = setInterval(() => {
    if (loadingProgressValue >= 92) return;
    const step = loadingProgressValue < 40 ? 7 : loadingProgressValue < 70 ? 4 : 2;
    setLoadingProgress(loadingProgressValue + step);
  }, 180);
}

function setLoading(show) {
  if (show) {
    startLoadingProgress();
    els.loading.classList.remove('hidden');
    return;
  }

  stopLoadingProgress();
  setLoadingProgress(100);
  window.setTimeout(() => {
    els.loading.classList.add('hidden');
    setLoadingProgress(0);
  }, 180);
}

function formatNumber(n) {
  return Math.round(n).toLocaleString('zh-Hant');
}

function formatMoney(amount, currency) {
  return `${getCurrencySymbol(currency)}${formatNumber(amount)}`;
}

function moneyFigHtml(amount, currency, extraClass = '') {
  const curClass = currency === 'JPY' ? 'money-jpy' : currency === 'HKD' ? 'money-hkd' : '';
  const cls = ['money-fig', curClass, extraClass].filter(Boolean).join(' ');
  return `<span class="${cls}">${escapeHtml(formatMoney(amount, currency))}</span>`;
}

function formatRecordTime(timeStr) {
  if (!timeStr) return '';
  const str = String(timeStr).trim();
  if (/^\d{1,2}:\d{2}/.test(str)) return str.slice(0, 5);
  return str;
}

function formatTransactionMeta(tx) {
  const timePart = tx.time ? ` · ${formatRecordTime(tx.time)}` : '';
  return `${tx.date}${timePart} · ${escapeHtml(getCategoryLabel(tx.category))}`;
}

function getLocationText(tx) {
  return String(tx?.location || '').trim();
}

function locationMapsUrl(location) {
  const s = String(location || '').trim();
  if (!s) return '';
  const coords = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (coords) {
    return `https://maps.apple.com/?ll=${coords[1]},${coords[2]}&q=${coords[1]},${coords[2]}`;
  }
  return `https://maps.apple.com/?q=${encodeURIComponent(s)}`;
}

/** Auto-capture GPS for new records. Never blocks save if denied/unavailable. */
function captureCurrentLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve('');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(5);
        const lng = pos.coords.longitude.toFixed(5);
        resolve(`${lat}, ${lng}`);
      },
      () => resolve(''),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 }
    );
  });
}

function isPredefinedCategory(category) {
  return PREDEFINED_CATEGORIES.includes(category);
}

function getCategoryEmoji(category) {
  if (CATEGORY_EMOJI[category]) return CATEGORY_EMOJI[category];
  if (String(category).startsWith('餐飲')) return '🍱';
  return '✏️';
}

function getCategoryLabel(category) {
  if (String(category).startsWith('餐飲-')) return category.slice(3);
  return category;
}

function getTransactionTitle(tx) {
  const desc = String(tx.description || '').trim();
  if (desc) return desc;
  if (isRepayTransaction(tx)) return '還錢';
  return getCategoryLabel(tx.category) || '（無描述）';
}

function isRepayTransaction(tx) {
  return tx.split_mode === 'REPAY' || tx.category === REPAY_CATEGORY;
}

function matchesCategoryFilter(txCategory, filterValue) {
  if (!filterValue) return true;
  if (filterValue === '餐飲') {
    return txCategory === '餐飲' || String(txCategory).startsWith('餐飲-');
  }
  return txCategory === filterValue;
}

function resolveCategory(selectEl, customInputEl) {
  if (selectEl.value === CUSTOM_CATEGORY) {
    return customInputEl.value.trim();
  }
  return selectEl.value;
}

function setCategoryFields(selectEl, customInputEl, customRowEl, category) {
  if (isPredefinedCategory(category)) {
    selectEl.value = category;
    customInputEl.value = '';
    customRowEl.classList.add('hidden');
  } else {
    selectEl.value = CUSTOM_CATEGORY;
    customInputEl.value = category;
    customRowEl.classList.remove('hidden');
  }
}

function setupCategorySelect(selectId, customRowId, customInputId) {
  const select = $(selectId);
  const row = $(customRowId);
  const input = $(customInputId);

  select.addEventListener('change', () => {
    const isCustom = select.value === CUSTOM_CATEGORY;
    row.classList.toggle('hidden', !isCustom);
    if (isCustom) input.focus();
  });
}

function parseDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayISO() {
  const now = new Date();
  const offset = now.getTimezoneOffset();
  const local = new Date(now.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

function applySplitLabelsToDom() {
  ['#split-options', '#edit-split-options'].forEach((selector) => {
    document.querySelectorAll(`${selector} .split-option`).forEach((label) => {
      const input = label.querySelector('input[type="radio"]');
      const textSpan = label.querySelector(':scope > span');
      if (!input || !textSpan) return;
      const splitLabel = SPLIT_LABELS[input.value];
      if (!splitLabel) return;
      const spaceIdx = splitLabel.indexOf(' ');
      const emoji = spaceIdx > 0 ? splitLabel.slice(0, spaceIdx) : splitLabel;
      const text = spaceIdx > 0 ? splitLabel.slice(spaceIdx + 1) : '';
      textSpan.innerHTML = `<span class="split-emoji-lg" aria-hidden="true">${emoji}</span> ${text}`;
    });
  });

  const filterSplit = $('#filter-split');
  if (filterSplit) {
    const current = filterSplit.value;
    filterSplit.innerHTML = [
      { value: '', label: '全部' },
      { value: 'SPLIT_5050', label: SPLIT_LABELS.SPLIT_5050 },
      { value: 'FOR_A', label: SPLIT_LABELS.FOR_A },
      { value: 'FOR_B', label: SPLIT_LABELS.FOR_B },
      { value: 'REPAY', label: SPLIT_LABELS.REPAY },
    ]
      .map(
        (o) =>
          `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`
      )
      .join('');
    filterSplit.value = current;
  }
}

function hasDayRangeFilter() {
  return Boolean(listFilters.dayFrom || listFilters.dayTo);
}

function formatDayRangeLabel() {
  const from = listFilters.dayFrom;
  const to = listFilters.dayTo;
  if (from && to) {
    return from === to ? from : `${from} ～ ${to}`;
  }
  if (from) return `${from} 起`;
  if (to) return `至 ${to}`;
  return '';
}

function syncDayRangeInputs() {
  const fromInput = $('#filter-day-from');
  const toInput = $('#filter-day-to');
  if (fromInput) {
    fromInput.value = listFilters.dayFrom;
    fromInput.max = listFilters.dayTo || '';
  }
  if (toInput) {
    toInput.value = listFilters.dayTo;
    toInput.min = listFilters.dayFrom || '';
  }
}

function initListDayFilter() {
  listFilters.dayFrom = '';
  listFilters.dayTo = '';
  syncDayRangeInputs();
  updateDayScopeToggle();
}

function updateDayScopeToggle() {
  const today = todayISO();
  const { dayFrom, dayTo } = listFilters;
  let scope = 'custom';
  if (!dayFrom && !dayTo) {
    scope = 'all';
  } else if (dayFrom === today && dayTo === today) {
    scope = 'today';
  }
  document.querySelectorAll('#filter-day-toggle [data-day-scope]').forEach((btn) => {
    const active = btn.dataset.dayScope === scope;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setDayRange(from, to) {
  let dayFrom = from || '';
  let dayTo = to || '';
  if (dayFrom && dayTo && dayFrom > dayTo) {
    const tmp = dayFrom;
    dayFrom = dayTo;
    dayTo = tmp;
  }
  listFilters.dayFrom = dayFrom;
  listFilters.dayTo = dayTo;
  syncDayRangeInputs();
  updateDayScopeToggle();
}

function setDayFilter(day) {
  const value = day || '';
  setDayRange(value, value);
}

function computeShares(amount, payer, splitMode) {
  const amt = Number(amount) || 0;
  switch (splitMode) {
    case 'FOR_A':
      return {
        a_share: amt,
        b_share: 0,
        net_b_owes_a: payer === 'A' ? 0 : -amt,
      };
    case 'FOR_B':
      return {
        a_share: 0,
        b_share: amt,
        net_b_owes_a: payer === 'A' ? amt : 0,
      };
    case 'REPAY':
      return {
        a_share: 0,
        b_share: 0,
        net_b_owes_a: payer === 'B' ? -amt : amt,
      };
    default:
      return {
        a_share: amt / 2,
        b_share: amt / 2,
        net_b_owes_a: payer === 'A' ? amt / 2 : -amt / 2,
      };
  }
}

function enrichTransaction(tx) {
  const shares =
    tx.a_share !== '' && tx.a_share != null && !isNaN(Number(tx.a_share))
      ? {
          a_share: Number(tx.a_share),
          b_share: Number(tx.b_share),
          net_b_owes_a: Number(tx.net_b_owes_a),
        }
      : computeShares(tx.amount, tx.payer, tx.split_mode);
  return {
    ...tx,
    ...shares,
    date: parseDate(tx.date),
    time: formatRecordTime(tx.time),
    location: String(tx.location || '').trim(),
  };
}

function getTxKey(tx) {
  return tx.transaction_id || tx._uid;
}

function findTransactionByKey(key) {
  return transactions.find((t) => t.transaction_id === key || t._uid === key);
}

function normalizeTransactions(rawList) {
  return rawList
    .filter((tx) => Number(tx.amount) > 0)
    .map((tx) => {
      const enriched = enrichTransaction(tx);
      enriched._uid = enriched.transaction_id || enriched._uid;
      return enriched;
    });
}

function budgetsFromApi(apiBudgets) {
  const result = structuredClone(DEFAULT_BUDGETS);
  if (!Array.isArray(apiBudgets)) return result;
  for (const b of apiBudgets) {
    const person = String(b.person || '').trim();
    const currency = String(b.currency || '').trim();
    if (result[person] && result[person][currency] !== undefined) {
      result[person][currency] = Number(b.initial_budget) || 0;
    }
  }
  return result;
}

function budgetsToApi(b) {
  return [
    { person: 'A', currency: 'JPY', initial_budget: b.A.JPY },
    { person: 'B', currency: 'JPY', initial_budget: b.B.JPY },
    { person: 'A', currency: 'HKD', initial_budget: b.A.HKD },
    { person: 'B', currency: 'HKD', initial_budget: b.B.HKD },
  ];
}

function summaryFromApi(apiSummary) {
  if (!Array.isArray(apiSummary) || apiSummary.length === 0) return null;

  const result = { A: {}, B: {} };
  for (const row of apiSummary) {
    const person = String(row.person || '').trim();
    const currency = String(row.currency || '').trim();
    if (!result[person] || !currency) continue;
    result[person][currency] = {
      initial_budget: Number(row.initial_budget) || 0,
      total_spent: Number(row.total_spent) || 0,
      remaining_budget: Number(row.remaining_budget) || 0,
      net_balance: Number(row.net_balance) || 0,
    };
  }
  return result;
}

function getSummaryRow(person, currency) {
  return summary && summary[person] ? summary[person][currency] : null;
}

function buildLocalSummary() {
  const { spent, net } = calcSummary();
  const result = { A: {}, B: {} };

  ['A', 'B'].forEach((person) => {
    ['JPY', 'HKD'].forEach((currency) => {
      const initial = budgets[person][currency];
      const totalSpent = spent[person][currency];
      result[person][currency] = {
        initial_budget: initial,
        total_spent: totalSpent,
        remaining_budget: initial - totalSpent,
        net_balance: net[currency],
      };
    });
  });

  return result;
}

function updateSyncStatus(state, syncedAt) {
  const el = $('#sync-status');
  if (!el) return;

  const endpoint = getActiveEndpoint();
  const sheetHint = apiEndpointKey === 'tester' ? ' · 測試' : '';

  if (state === 'syncing') {
    el.textContent = `☁️ 同步中…${sheetHint}`;
    el.className = 'sync-status syncing';
    el.disabled = true;
    return;
  }

  if (state === 'error') {
    el.textContent = `⚠️ 無法連線試算表${sheetHint}`;
    el.className = 'sync-status error';
    el.disabled = false;
    return;
  }

  const timeSource = syncedAt || lastSyncedAt || new Date().toISOString();
  const time = new Date(timeSource).toLocaleTimeString('zh-Hant', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  el.textContent = `☁️ 已同步 ${time}${sheetHint}`;
  el.className = 'sync-status synced';
  el.disabled = false;
  el.title = endpoint.spreadsheetUrl
    ? `${endpoint.label}\n${endpoint.spreadsheetUrl}`
    : endpoint.label;
}

function getOtherEndpointKey() {
  return apiEndpointKey === 'tester' ? 'production' : 'tester';
}

function isCyberpunkTheme() {
  return document.documentElement.classList.contains('theme-cyberpunk');
}

function updateThemeControls() {
  const cyber = isCyberpunkTheme();
  const btn = $('#btn-toggle-theme');
  const desc = $('#theme-switcher-desc');
  if (btn) {
    btn.textContent = cyber ? '切回日間模式 ☀️' : '啟用賽博龐克 🌙';
    btn.setAttribute('aria-pressed', cyber ? 'true' : 'false');
  }
  if (desc) {
    desc.textContent = cyber ? '目前：賽博龐克深色模式' : '目前：日間模式';
  }
  PARTICLE_COLORS = cyber ? PARTICLE_COLORS_CYBER : PARTICLE_COLORS_LIGHT;
}

function applyTheme(theme) {
  const cyber = theme === 'cyberpunk';
  document.documentElement.classList.toggle('theme-cyberpunk', cyber);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, cyber ? 'cyberpunk' : 'light');
  } catch (_) {}
  updateThemeControls();
}

function toggleTheme() {
  applyTheme(isCyberpunkTheme() ? 'light' : 'cyberpunk');
  showToast(
    isCyberpunkTheme() ? '已切換賽博龐克模式 🌃' : '已切回日間模式 ☀️',
    'success'
  );
}

function setupThemeToggle() {
  applyTheme(localStorage.getItem(THEME_STORAGE_KEY) === 'cyberpunk' ? 'cyberpunk' : 'light');
  $('#btn-toggle-theme')?.addEventListener('click', toggleTheme);
}

function openSheetSwitcher() {
  const otherKey = getOtherEndpointKey();
  const current = getActiveEndpoint();
  const other = API_ENDPOINTS[otherKey];
  const msg = $('#sheet-switcher-message');
  const hint = $('#sheet-switcher-hint');
  const link = $('#sheet-switcher-link');
  const confirmBtn = $('#sheet-switcher-confirm');

  if (msg) {
    msg.textContent = `目前使用「${current.label}」。要改用「${other.label}」嗎？`;
  }

  if (hint) {
    if (otherKey === 'tester') {
      hint.textContent = '將連線測試試算表（下方連結），用來驗證功能，唔會影響正式資料。';
    } else {
      hint.textContent = '將切回正式試算表（下方連結）。';
    }
  }

  if (link) {
    if (other.spreadsheetUrl) {
      link.href = other.spreadsheetUrl;
      link.textContent = otherKey === 'tester' ? '開啟測試試算表 ↗' : '開啟正式試算表 ↗';
      link.classList.remove('hidden');
    } else {
      link.removeAttribute('href');
      link.textContent = '';
      link.classList.add('hidden');
    }
  }

  if (confirmBtn) {
    confirmBtn.textContent = `改用${other.label} ✅`;
    confirmBtn.dataset.target = otherKey;
  }

  updateThemeControls();
  openModal($('#sheet-switcher-modal'));
}

async function switchApiEndpoint(targetKey) {
  if (!API_ENDPOINTS[targetKey] || targetKey === apiEndpointKey) {
    closeModal($('#sheet-switcher-modal'));
    return;
  }

  apiEndpointKey = targetKey;
  API_URL = getApiUrl();
  localStorage.setItem(API_STORAGE_KEY, apiEndpointKey);
  closeModal($('#sheet-switcher-modal'));

  const endpoint = getActiveEndpoint();
  showToast(`已切換至${endpoint.label}`, 'success');

  // Reset local view before loading the selected spreadsheet.
  transactions = [];
  budgets = structuredClone(DEFAULT_BUDGETS);
  summary = null;
  lastSyncedAt = null;
  renderAll();
  updateSyncStatus('syncing');

  try {
    await fetchAllData();
    startAutoSync();
  } catch (err) {
    showToast(err.message || '切換後無法連線，請再試一次', 'error');
  }
}

function isModalOpen() {
  return !els.budgetModal.classList.contains('hidden') ||
    !els.editModal.classList.contains('hidden') ||
    !els.detailModal.classList.contains('hidden') ||
    !els.repayModal.classList.contains('hidden') ||
    !els.deleteConfirmModal.classList.contains('hidden') ||
    !$('#sheet-switcher-modal').classList.contains('hidden');
}

/* ===== API ===== */
async function apiRequest(payload = {}) {
  API_URL = getApiUrl();
  const endpoint = getActiveEndpoint();
  const url = new URL(API_URL);

  Object.entries(payload).forEach(([k, v]) => {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  });

  // Always pin requests to the selected spreadsheet when configured.
  if (endpoint.spreadsheetId) {
    url.searchParams.set('spreadsheetId', endpoint.spreadsheetId);
  }
  if (endpoint.sheetGid) {
    url.searchParams.set('gid', endpoint.sheetGid);
  }
  url.searchParams.set('source', apiEndpointKey);

  const controller = new AbortController();
  const timeoutMs = 25000;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      mode: 'cors',
      redirect: 'follow',
      cache: 'no-store',
      signal: controller.signal,
    });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`連線逾時（${timeoutMs / 1000}s），請稍後再試或檢查 Apps Script 部署`);
    }
    throw new Error(`無法連線 API（${err.message}）`);
  } finally {
    window.clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new Error(`API HTTP ${res.status}`);
  }

  const text = await res.text();
  if (text.trimStart().startsWith('<')) {
    throw new Error('API 回傳網頁而非 JSON，請檢查 Apps Script 部署 URL');
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('API 回傳格式錯誤');
  }

  if (data.status === 'ERROR') {
    throw new Error(data.message || 'API 錯誤');
  }

  const expectedSheetId = endpoint.spreadsheetId;
  const actualSheetId = data.spreadsheet_id || data.actual_spreadsheet_id || '';

  // 新版腳本一定會回 source；冇就代表仲用緊舊部署
  if (!data.source) {
    throw new Error(
      `「${endpoint.label}」API 仲係舊版腳本（冇 source 欄位）。請用 apps-script/Code.${apiEndpointKey}.gs 重新部署「新版本」，並更新 app.js 嘅 URL。`
    );
  }

  if (data.source !== apiEndpointKey) {
    throw new Error(
      `連錯後端：期望 ${apiEndpointKey}，實際 ${data.source}。請檢查 app.js 嘅 ${apiEndpointKey}.url 係咪貼錯部署連結。`
    );
  }

  if (expectedSheetId && actualSheetId && actualSheetId !== expectedSheetId) {
    throw new Error(
      `連到錯誤試算表（期望 ${expectedSheetId.slice(0, 8)}…，實際 ${String(actualSheetId).slice(0, 8)}…）。請確認 Apps Script 係喺正確試算表入面部署。`
    );
  }

  return data;
}

function applyServerData(data) {
  if (data.status !== 'SUCCESS') throw new Error('API 回傳失敗');
  transactions = normalizeTransactions(data.transactions || []);
  budgets = budgetsFromApi(data.budgets);

  const apiSummary = summaryFromApi(data.summary);
  if (apiSummary) {
    ['A', 'B'].forEach((person) => {
      ['JPY', 'HKD'].forEach((currency) => {
        const row = apiSummary[person]?.[currency];
        if (row && row.initial_budget >= 0) {
          budgets[person][currency] = row.initial_budget;
        }
      });
    });
  }

  summary = buildLocalSummary();
  lastSyncedAt = data.synced_at || new Date().toISOString();
  renderAll();
}

async function fetchAllData(options = {}) {
  const { silent = false, showSuccessToast = false } = options;
  if (!silent) setLoading(true);
  updateSyncStatus('syncing');

  try {
    const data = await apiRequest({ action: 'fetch' });
    applyServerData(data);
    updateSyncStatus('success', data.synced_at);
    if (showSuccessToast) showToast('已刷新資料 🔄', 'success');
    return data;
  } catch (err) {
    updateSyncStatus('error');
    throw err;
  } finally {
    if (!silent) setLoading(false);
  }
}

async function syncAddTransaction(tx) {
  return apiRequest({
    action: 'addTransaction',
    date: tx.date,
    category: tx.category,
    description: tx.description,
    location: tx.location || '',
    currency: tx.currency,
    amount: tx.amount,
    payer: tx.payer,
    split_mode: tx.split_mode,
  });
}

async function syncEditTransaction(tx) {
  return apiRequest({
    action: 'editTransaction',
    transaction_id: tx.transaction_id,
    date: tx.date,
    category: tx.category,
    description: tx.description,
    location: tx.location || '',
    currency: tx.currency,
    amount: tx.amount,
    payer: tx.payer,
    split_mode: tx.split_mode,
  });
}

async function syncDeleteTransaction(transactionId) {
  return apiRequest({
    action: 'deleteTransaction',
    transaction_id: transactionId,
  });
}

async function syncBudgets(b) {
  return apiRequest({
    action: 'updateBudget',
    budgets: JSON.stringify(budgetsToApi(b)),
    A_JPY: b.A.JPY,
    B_JPY: b.B.JPY,
    A_HKD: b.A.HKD,
    B_HKD: b.B.HKD,
  });
}

function startAutoSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = setInterval(async () => {
    if (isMutating || isModalOpen()) return;
    try {
      await fetchAllData({ silent: true });
    } catch (_) {}
  }, SYNC_INTERVAL_MS);
}

/* ===== Calculations ===== */
function calcSummary() {
  const spent = {
    A: { JPY: 0, HKD: 0 },
    B: { JPY: 0, HKD: 0 },
  };
  const net = { JPY: 0, HKD: 0 };

  for (const tx of transactions) {
    const cur = tx.currency;
    if (cur !== 'JPY' && cur !== 'HKD') continue;
    spent.A[cur] += tx.a_share;
    spent.B[cur] += tx.b_share;
    net[cur] += tx.net_b_owes_a;
  }

  return { spent, net };
}

function calcHelpPaid() {
  const bHelpedA = { JPY: 0, HKD: 0 };
  const aHelpedB = { JPY: 0, HKD: 0 };

  for (const tx of transactions) {
    const cur = tx.currency;
    if (cur !== 'JPY' && cur !== 'HKD') continue;
    if (isRepayTransaction(tx)) continue;
    const amt = tx.amount;
    switch (tx.split_mode) {
      case 'FOR_A':
        if (tx.payer === 'B') bHelpedA[cur] += amt;
        break;
      case 'FOR_B':
        if (tx.payer === 'A') aHelpedB[cur] += amt;
        break;
      default:
        if (tx.payer === 'A') aHelpedB[cur] += amt / 2;
        else bHelpedA[cur] += amt / 2;
    }
  }

  return { bHelpedA, aHelpedB };
}

function helpPayText(bHelpedA, aHelpedB, currency) {
  const parts = [];
  if (bHelpedA > 0) {
    parts.push(`${PERSON_EMOJI.B} 幫 ${PERSON_EMOJI.A} 畀咗 ${moneyFigHtml(bHelpedA, currency)}`);
  }
  if (aHelpedB > 0) {
    parts.push(`${PERSON_EMOJI.A} 幫 ${PERSON_EMOJI.B} 畀咗 ${moneyFigHtml(aHelpedB, currency)}`);
  }
  if (!parts.length) return '暫無代付紀錄';
  return parts.join(' · ');
}

function getDebtInfo(currency) {
  const net = calcSummary().net[currency];
  if (Math.abs(net) < 1) return null;
  if (net > 0) {
    return { payer: 'B', payee: 'A', amount: net };
  }
  return { payer: 'A', payee: 'B', amount: Math.abs(net) };
}

function pickRepayCurrency() {
  if (currencyView === 'jpy') return 'JPY';
  if (currencyView === 'hkd') return 'HKD';
  if (getDebtInfo('JPY')) return 'JPY';
  if (getDebtInfo('HKD')) return 'HKD';
  return 'JPY';
}

function settlementText(netAmount, currency) {
  if (Math.abs(netAmount) < 1) {
    return {
      text: '🎉 目前雙方完全平帳，互不相欠！',
      html: '🎉 目前雙方完全平帳，互不相欠！',
      balanced: true,
    };
  }
  if (netAmount > 0) {
    return {
      text: `${PERSON_EMOJI.B} 需給 ${PERSON_EMOJI.A}：${formatMoney(netAmount, currency)}`,
      html: `${PERSON_EMOJI.B} 需給 ${PERSON_EMOJI.A}：${moneyFigHtml(netAmount, currency, 'money-debt')}`,
      balanced: false,
    };
  }
  return {
    text: `${PERSON_EMOJI.A} 需給 ${PERSON_EMOJI.B}：${formatMoney(Math.abs(netAmount), currency)}`,
    html: `${PERSON_EMOJI.A} 需給 ${PERSON_EMOJI.B}：${moneyFigHtml(Math.abs(netAmount), currency, 'money-debt')}`,
    balanced: false,
  };
}

function explainTransactionNet(tx) {
  const amount = formatMoney(tx.amount, tx.currency);
  const half = formatMoney(tx.amount / 2, tx.currency);
  const payer = PERSON_EMOJI[tx.payer];
  const split = SPLIT_LABELS[tx.split_mode] || tx.split_mode;

  let formula = '';
  if (isRepayTransaction(tx)) {
    const payee = tx.payer === 'A' ? PERSON_EMOJI.B : PERSON_EMOJI.A;
    formula = `${payer} 還俾 ${payee} ${amount}（不計入消費，只調整淨欠款）`;
  } else switch (tx.split_mode) {
    case 'FOR_A':
      formula =
        tx.payer === 'A'
          ? `${PERSON_EMOJI.A} 自己嘅，自己畀 → 互不欠帳`
          : `${payer} 幫 ${PERSON_EMOJI.A} 畀 ${amount} → ${PERSON_EMOJI.B} 欠 ${PERSON_EMOJI.A} ${amount}`;
      break;
    case 'FOR_B':
      formula =
        tx.payer === 'B'
          ? `${PERSON_EMOJI.B} 自己嘅，自己畀 → 互不欠帳`
          : `${payer} 幫 ${PERSON_EMOJI.B} 畀 ${amount} → ${PERSON_EMOJI.A} 欠 ${PERSON_EMOJI.B} ${amount}`;
      break;
    default:
      formula =
        tx.payer === 'A'
          ? `${payer} 先畀 ${amount}，${split} → ${PERSON_EMOJI.B} 欠 ${PERSON_EMOJI.A} ${half}`
          : `${payer} 先畀 ${amount}，${split} → ${PERSON_EMOJI.A} 欠 ${PERSON_EMOJI.B} ${half}`;
  }

  const net = tx.net_b_owes_a;
  let netClass = '';
  let netLabel = '';
  if (isRepayTransaction(tx)) {
    if (net > 0) {
      netClass = 'positive';
      netLabel = `淨欠款 +${formatMoney(net, tx.currency)}（${PERSON_EMOJI.A} 欠 ${PERSON_EMOJI.B} 增加）`;
    } else if (net < 0) {
      netClass = 'negative';
      netLabel = `淨欠款 ${formatMoney(net, tx.currency)}（沖減 ${PERSON_EMOJI.B} 欠 ${PERSON_EMOJI.A}）`;
    }
  } else if (net > 0) {
    netClass = 'positive';
    netLabel = `淨欠款 +${formatMoney(net, tx.currency)}（${PERSON_EMOJI.B} 欠 ${PERSON_EMOJI.A}）`;
  } else if (net < 0) {
    netClass = 'negative';
    netLabel = `淨欠款 ${formatMoney(net, tx.currency)}（${PERSON_EMOJI.A} 欠 ${PERSON_EMOJI.B}）`;
  }

  return { formula, net, netClass, netLabel, split };
}

function buildTransactionDetailHtml(tx) {
  const { formula, netClass, netLabel } = explainTransactionNet(tx);
  const splitLabel = SPLIT_LABELS[tx.split_mode] || tx.split_mode;
  const payerLabel = PERSON_EMOJI[tx.payer] || tx.payer;
  const timePart = tx.time ? ` · ${formatRecordTime(tx.time)}` : '';
  const desc = getTransactionTitle(tx);
  const rawDesc = String(tx.description || '').trim();
  const showDesc = rawDesc && rawDesc !== desc;
  const curClass = tx.currency === 'JPY' ? 'jpy' : 'hkd';
  const isRepay = isRepayTransaction(tx);
  const emojiHtml = isRepay
    ? '<span class="emoji-handshake-badge"><span class="emoji-handshake" aria-hidden="true">🤝🏻</span></span>'
    : getCategoryEmoji(tx.category);
  const splitHtml = isRepay
    ? '<span class="emoji-handshake-badge"><span class="emoji-handshake" aria-hidden="true">🤝🏻</span></span> 還錢'
    : escapeHtml(splitLabel);

  let html = `
    <div class="detail-hero">
      <span class="detail-emoji">${emojiHtml}</span>
      <div class="detail-hero-text">
        <div class="detail-title">${escapeHtml(desc)}</div>
        <div class="detail-amount ${curClass}">${formatMoney(tx.amount, tx.currency)}</div>
      </div>
    </div>
    <dl class="detail-grid">
      <dt>📅 日期</dt>
      <dd>${escapeHtml(tx.date)}${escapeHtml(timePart)}</dd>
      <dt>🏷️ 分類</dt>
      <dd>${escapeHtml(getCategoryLabel(tx.category))}</dd>`;

  if (showDesc) {
    html += `
      <dt>📝 描述</dt>
      <dd>${escapeHtml(rawDesc)}</dd>`;
  }

  const location = getLocationText(tx);
  if (location) {
    const mapsUrl = locationMapsUrl(location);
    html += `
      <dt>📍 地點</dt>
      <dd><a class="detail-location-link" href="${escapeHtml(mapsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(location)}</a></dd>`;
  }

  html += `
      <dt>💳 邊個畀錢</dt>
      <dd>${payerLabel}</dd>
      <dt>💸 樣嘢點計</dt>
      <dd>${splitHtml}</dd>`;

  if (isRepay) {
    html += `
      <dt>📌 備註</dt>
      <dd>此筆為還錢紀錄，唔會計入消費預算</dd>`;
  } else {
    html += `
      <dt>${PERSON_EMOJI.A} 分攤</dt>
      <dd>${moneyFigHtml(tx.a_share, tx.currency)}</dd>
      <dt>${PERSON_EMOJI.B} 分攤</dt>
      <dd>${moneyFigHtml(tx.b_share, tx.currency)}</dd>`;
  }

  html += `
    </dl>
    <div class="detail-formula">
      <div class="detail-formula-label">結算說明</div>
      <div class="detail-formula-text">${escapeHtml(formula)}</div>`;

  if (netLabel) {
    html += `<div class="explain-step-net ${netClass}">${escapeHtml(netLabel)}</div>`;
  }

  html += '</div>';
  return html;
}

function openDetailModal(key) {
  const tx = findTransactionByKey(key);
  if (!tx) return;

  detailModalKey = key;
  $('#detail-modal-body').innerHTML = buildTransactionDetailHtml(tx);
  openModal(els.detailModal);
}

function bindDetailTriggers(container) {
  if (!container) return;
  container.querySelectorAll('[data-detail-key]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.edit-btn')) return;
      openDetailModal(el.dataset.detailKey);
    });
    if (el.classList.contains('transaction-item')) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openDetailModal(el.dataset.detailKey);
        }
      });
    }
  });
}

function renderSettlementExplain() {
  ['JPY', 'HKD'].forEach((cur) => {
    const el = $(`#settlement-explain-${cur.toLowerCase()}`);
    if (!el) return;

    const badge = cur === 'JPY' ? '💴' : '💵';
    const txs = transactions.filter((t) => t.currency === cur);
    const netTotal = txs.reduce((sum, t) => sum + t.net_b_owes_a, 0);
    const contributing = txs.filter((t) => Math.abs(t.net_b_owes_a) >= 1);
    const terms = contributing.map((t) => {
      const net = t.net_b_owes_a;
      const sign = net > 0 ? '+' : '−';
      return `${sign}${formatMoney(Math.abs(net), cur)}`;
    });

    let html = `<div class="explain-currency-label">${badge} ${cur}</div>`;
    html += `<p class="explain-rules-compact">加總每筆淨欠款：➕ ${PERSON_EMOJI.B}欠${PERSON_EMOJI.A} · ➖ ${PERSON_EMOJI.A}欠${PERSON_EMOJI.B}</p>`;

    if (txs.length === 0) {
      html += `<p class="explain-empty">尚無 ${cur} 消費紀錄</p>`;
    } else if (contributing.length === 0) {
      html += `<div class="explain-sum-line">
        <div><strong>加總：</strong><strong>${formatMoney(0, cur)}</strong>（全部互不欠帳）</div>
      </div>`;
    } else {
      html += `<ol class="explain-steps" aria-label="${cur} 明細">`;
      contributing.forEach((tx) => {
        const { netClass, netLabel } = explainTransactionNet(tx);
        const txKey = escapeHtml(getTxKey(tx));
        html += `<li class="explain-step-item">
          <button type="button" class="explain-step-btn" data-detail-key="${txKey}" aria-label="查看 ${escapeHtml(getTransactionTitle(tx))} 詳情">
            <span class="explain-step-desc">${escapeHtml(getTransactionTitle(tx))}</span>
            <span class="explain-step-net ${netClass}">${escapeHtml(netLabel)}</span>
            <span class="explain-step-chevron" aria-hidden="true">›</span>
          </button>
        </li>`;
      });
      html += '</ol>';

      const sumExpr = terms.join(' ');
      html += `<div class="explain-sum-line">
        <div><strong>加總：</strong>${escapeHtml(sumExpr)} = <strong>${formatMoney(Math.abs(netTotal), cur)}</strong></div>
      </div>`;
    }

    el.innerHTML = html;
    bindDetailTriggers(el);
  });

  updateExplainPreview();
}

function updateExplainPreview() {
  const el = $('#settlement-explain-preview');
  if (!el) return;

  const parts = [];
  ['JPY', 'HKD'].forEach((cur) => {
    const lower = cur.toLowerCase();
    if (currencyView !== 'all' && currencyView !== lower) return;

    const txs = transactions.filter((t) => t.currency === cur);
    const netTotal = txs.reduce((sum, t) => sum + t.net_b_owes_a, 0);
    const badge = cur === 'JPY' ? '💴' : '💵';
    const { text, balanced } = settlementText(netTotal, cur);
    parts.push(balanced ? `${badge} 平帳` : text);
  });

  el.textContent = parts.length ? parts.join(' · ') : '點擊展開';
}

/* ===== Render ===== */
function renderSummary() {
  const { spent, net } = calcSummary();
  const { bHelpedA, aHelpedB } = calcHelpPaid();

  ['JPY', 'HKD'].forEach((cur) => {
    const lower = cur.toLowerCase();
    ['A', 'B'].forEach((person) => {
      const p = person.toLowerCase();
      const used = spent[person][cur];
      const remaining = budgets[person][cur] - used;

      const spentText = formatMoney(used, cur);
      const remainText = `剩餘 ${formatMoney(remaining, cur)}`;

      document
        .querySelectorAll(`.spent-value[data-person="${p}"][data-currency="${lower}"]`)
        .forEach((el) => {
          el.textContent = spentText;
        });

      document
        .querySelectorAll(`.remain-value[data-person="${p}"][data-currency="${lower}"]`)
        .forEach((el) => {
          el.textContent = remainText;
          el.classList.toggle('over-budget', remaining < 0);
        });
    });

    const settlement = settlementText(net[cur], cur);
    const el = $(`#settlement-${lower}`);
    el.innerHTML =
      cur === 'JPY'
        ? `💴 ${settlement.html}`
        : `💵 ${settlement.html}`;
    el.classList.remove('balanced', 'debt');
    el.classList.add(settlement.balanced ? 'balanced' : 'debt');

    const helpEl = $(`#help-pay-${lower}`);
    if (helpEl) {
      const badge = cur === 'JPY' ? '💴' : '💵';
      helpEl.innerHTML = `${badge} ${helpPayText(bHelpedA[cur], aHelpedB[cur], cur)}`;
    }
  });

  const hasDebt =
    Math.abs(net.JPY) >= 1 || Math.abs(net.HKD) >= 1;
  $('#settlement-actions')?.classList.toggle('hidden', !hasDebt);

  renderSettlementExplain();
  applyCurrencyView();
}

function getFilteredTransactions() {
  let list = [...transactions];

  if (listFilters.category) {
    if (listFilters.category === CUSTOM_CATEGORY) {
      list = list.filter((tx) => !isPredefinedCategory(tx.category));
    } else {
      list = list.filter((tx) => matchesCategoryFilter(tx.category, listFilters.category));
    }
  }
  if (listFilters.splitMode) {
    list = list.filter((tx) => tx.split_mode === listFilters.splitMode);
  }
  if (listFilters.dayFrom) {
    list = list.filter((tx) => tx.date >= listFilters.dayFrom);
  }
  if (listFilters.dayTo) {
    list = list.filter((tx) => tx.date <= listFilters.dayTo);
  }

  list.sort((a, b) => {
    if (listFilters.sortAmount === 'asc') return a.amount - b.amount;
    if (listFilters.sortAmount === 'desc') return b.amount - a.amount;
    const da = `${a.date || ''}T${formatRecordTime(a.time) || '00:00'}`;
    const db = `${b.date || ''}T${formatRecordTime(b.time) || '00:00'}`;
    return listFilters.sortDate === 'asc' ? da.localeCompare(db) : db.localeCompare(da);
  });

  return list;
}

function paginateList(list) {
  if (listFilters.pageSize === 'all') {
    return { items: list, totalPages: 1, page: 1, total: list.length };
  }

  const size = Number(listFilters.pageSize) || 10;
  const totalPages = Math.max(1, Math.ceil(list.length / size));
  const page = Math.min(listFilters.currentPage, totalPages);
  const start = (page - 1) * size;

  return {
    items: list.slice(start, start + size),
    totalPages,
    page,
    total: list.length,
  };
}

function getPageRange(current, total) {
  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = [];
  const addPage = (p) => {
    if (p >= 1 && p <= total && !pages.includes(p)) pages.push(p);
  };

  addPage(1);
  for (let p = current - 1; p <= current + 1; p++) addPage(p);
  addPage(total);

  pages.sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) result.push('...');
    result.push(pages[i]);
  }
  return result;
}

function renderPagination(meta) {
  const info = $('#pagination-info');
  const pageNumbers = $('#page-numbers');
  const btnPrev = $('#btn-prev');
  const btnNext = $('#btn-next');

  if (meta.total === 0) {
    info.textContent = '共 0 筆';
    pageNumbers.innerHTML = '';
    btnPrev.disabled = true;
    btnNext.disabled = true;
    return;
  }

  if (listFilters.pageSize === 'all') {
    info.textContent = `共 ${meta.total} 筆（全部顯示）`;
    pageNumbers.innerHTML = '';
    btnPrev.disabled = true;
    btnNext.disabled = true;
    return;
  }

  info.textContent = `第 ${meta.page} / ${meta.totalPages} 頁，共 ${meta.total} 筆`;
  btnPrev.disabled = meta.page <= 1;
  btnNext.disabled = meta.page >= meta.totalPages;

  pageNumbers.innerHTML = getPageRange(meta.page, meta.totalPages)
    .map((p) => {
      if (p === '...') {
        return '<span class="page-num ellipsis">…</span>';
      }
      return `<button type="button" class="page-num ${p === meta.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
    })
    .join('');

  pageNumbers.querySelectorAll('.page-num[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      listFilters.currentPage = Number(btn.dataset.page);
      renderTransactionList();
    });
  });
}

function renderTransactionList() {
  const list = els.transactionList;
  const filtered = getFilteredTransactions();
  const meta = paginateList(filtered);
  listFilters.currentPage = meta.page;

  renderPagination(meta);

  if (filtered.length === 0) {
    list.innerHTML =
      transactions.length === 0
        ? '<li class="empty-state">尚無消費紀錄，快記第一筆吧 ✨</li>'
        : hasDayRangeFilter()
          ? `<li class="empty-state">${escapeHtml(formatDayRangeLabel())} 沒有紀錄 📅</li>`
          : '<li class="empty-state">沒有符合篩選條件的紀錄 🔍</li>';
    return;
  }

  list.innerHTML = meta.items
    .map((tx) => {
      const emoji = getCategoryEmoji(tx.category);
      const curClass = tx.currency === 'JPY' ? 'jpy' : 'hkd';
      const payerLabel = PERSON_EMOJI[tx.payer] || PERSON_EMOJI.A;
      const splitLabel = SPLIT_LABELS[tx.split_mode] || tx.split_mode;
      const txKey = getTxKey(tx);
      const isRepay = isRepayTransaction(tx);
      const repayClass = isRepay ? ' repay-item' : '';
      const iconHtml = isRepay
        ? '<span class="emoji-handshake-badge"><span class="emoji-handshake" aria-hidden="true">🤝🏻</span></span>'
        : emoji;

      return `
        <li class="transaction-item${repayClass}" data-key="${escapeHtml(txKey)}" data-detail-key="${escapeHtml(txKey)}" tabindex="0" role="button" aria-label="查看 ${escapeHtml(getTransactionTitle(tx))} 詳情">
          <div class="tx-icon">${iconHtml}</div>
          <div class="tx-body">
            <div class="tx-title">${escapeHtml(getTransactionTitle(tx))}</div>
            <div class="tx-meta">${formatTransactionMeta(tx)}</div>
            <div class="tx-tags">
              <span class="tx-tag payer" aria-label="${tx.payer === 'A' ? '男孩付款' : '女生付款'}">${payerLabel}</span>
              <span class="tx-tag split">${isRepay ? '<span class="emoji-handshake-badge"><span class="emoji-handshake" aria-hidden="true">🤝🏻</span></span> 還錢' : splitLabel}</span>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-amount ${curClass}">${formatMoney(tx.amount, tx.currency)}</div>
            <span class="tx-currency ${curClass}">${tx.currency}</span>
            <button type="button" class="btn-edit edit-btn" data-key="${escapeHtml(txKey)}" aria-label="編輯">
              <span class="btn-edit-icon" aria-hidden="true">✏️</span>
              <span class="btn-edit-text">編輯</span>
            </button>
          </div>
        </li>`;
    })
    .join('');

  list.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditModal(btn.dataset.key);
    });
  });

  bindDetailTriggers(list);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderAll() {
  renderSummary();
  renderTransactionList();
}

function populateBudgetForm() {
  $('#budget-a-jpy').value = budgets.A.JPY;
  $('#budget-b-jpy').value = budgets.B.JPY;
  $('#budget-a-hkd').value = budgets.A.HKD;
  $('#budget-b-hkd').value = budgets.B.HKD;
}

/* ===== Toggle Helpers ===== */
function setupToggle(groupId, hiddenId, attr, defaultVal) {
  const group = $(groupId);
  const hidden = $(hiddenId);
  group.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      group.querySelectorAll('.toggle-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      hidden.value = btn.dataset[attr];
    });
  });
  hidden.value = defaultVal;
}

function getCurrencySymbol(currency) {
  return CURRENCY_SYMBOL[currency] || '$';
}

function bindMoneyInput(input) {
  input.addEventListener('input', () => {
    input.value = input.value.replace(/\D/g, '');
  });
}

function updateMoneyPrefix(prefixEl, currency) {
  if (!prefixEl) return;
  prefixEl.textContent = getCurrencySymbol(currency);
  prefixEl.classList.toggle('prefix-jpy', currency === 'JPY');
  prefixEl.classList.toggle('prefix-hkd', currency === 'HKD');
}

function setupMoneyInputs() {
  $$('.money-input').forEach(bindMoneyInput);

  const expensePrefix = $('#expense-amount-prefix');
  $('#currency-toggle').querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      updateMoneyPrefix(expensePrefix, btn.dataset.currency);
    });
  });
  updateMoneyPrefix(expensePrefix, $('#expense-currency').value);

  const editPrefix = $('#edit-amount-prefix');
  $('#edit-currency-toggle').querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      updateMoneyPrefix(editPrefix, btn.dataset.currency);
    });
  });
}

function setToggleValue(groupId, hiddenId, attr, value) {
  const group = $(groupId);
  const hidden = $(hiddenId);
  group.querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset[attr] === value);
  });
  hidden.value = value;
}

/* ===== Modals ===== */
function openModal(modal) {
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(modal) {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

function openBudgetModal() {
  populateBudgetForm();
  openModal(els.budgetModal);
}

function updateRepayModalView() {
  const currency = $('#repay-currency').value;
  const debt = getDebtInfo(currency);
  const contextEl = $('#repay-context');
  const amountEl = $('#repay-amount');
  const payerEl = $('#repay-payer');
  const submitBtn = $('#repay-submit-btn');

  if (!debt) {
    contextEl.textContent = `${currency === 'JPY' ? '💴' : '💵'} 此幣別已平帳，可以揀另一個幣別`;
    amountEl.value = '';
    amountEl.disabled = true;
    payerEl.value = '';
    submitBtn.disabled = true;
    return;
  }

  payerEl.value = debt.payer;
  amountEl.disabled = false;
  submitBtn.disabled = false;
  contextEl.textContent = `目前 ${PERSON_EMOJI[debt.payer]} 欠 ${PERSON_EMOJI[debt.payee]} ${formatMoney(debt.amount, currency)}`;
  if (!amountEl.dataset.touched) {
    amountEl.value = Math.round(debt.amount);
  }
  updateMoneyPrefix($('#repay-amount-prefix'), currency);
}

function openRepayModal() {
  const currency = pickRepayCurrency();
  setToggleValue('#repay-currency-toggle', '#repay-currency', 'currency', currency);
  $('#repay-note').value = '';
  const amountEl = $('#repay-amount');
  amountEl.value = '';
  delete amountEl.dataset.touched;
  updateRepayModalView();
  openModal(els.repayModal);
}

function openEditModal(key) {
  const tx = findTransactionByKey(key);
  if (!tx) return;

  $('#edit-transaction-id').value = tx.transaction_id || '';
  $('#edit-transaction-key').value = getTxKey(tx);
  $('#edit-date').value = tx.date;
  setCategoryFields(
    $('#edit-category'),
    $('#edit-custom-category'),
    $('#edit-custom-category-row'),
    tx.category
  );
  $('#edit-description').value = tx.description;
  $('#edit-amount').value = tx.amount;
  setToggleValue('#edit-currency-toggle', '#edit-currency', 'currency', tx.currency);
  updateMoneyPrefix($('#edit-amount-prefix'), tx.currency);
  setToggleValue('#edit-payer-toggle', '#edit-payer', 'payer', tx.payer);
  const splitRow = $('#edit-split-row');
  const payerRow = $('#edit-payer-row');
  if (isRepayTransaction(tx)) {
    splitRow.classList.add('hidden');
    payerRow.classList.add('hidden');
  } else {
    splitRow.classList.remove('hidden');
    payerRow.classList.remove('hidden');
    const radio = document.querySelector(
      `#edit-split-options input[value="${tx.split_mode}"]`
    );
    if (radio) radio.checked = true;
  }

  openModal(els.editModal);
}

async function deleteTransactionRecord() {
  const transactionId = $('#edit-transaction-id').value;
  const key = $('#edit-transaction-key').value;
  if (!transactionId) {
    showToast('此紀錄尚未有試算表 ID，請先刷新', 'error');
    return;
  }

  const tx = findTransactionByKey(key);
  const title = tx ? getTransactionTitle(tx) : '此紀錄';
  const msg = $('#delete-confirm-message');
  if (msg) {
    msg.textContent = `確定要刪除「${title}」？刪除後無法復原。`;
  }
  openModal(els.deleteConfirmModal);
}

async function confirmDeleteTransaction() {
  const transactionId = $('#edit-transaction-id').value;
  const key = $('#edit-transaction-key').value;
  if (!transactionId) {
    showToast('此紀錄尚未有試算表 ID，請先刷新', 'error');
    closeModal(els.deleteConfirmModal);
    return;
  }

  const tx = findTransactionByKey(key);

  closeModal(els.deleteConfirmModal);
  isMutating = true;
  setLoading(true);
  try {
    const data = await syncDeleteTransaction(transactionId);
    applyServerData(data);
    updateSyncStatus('success', data.synced_at);
    closeModal(els.editModal);
    if (detailModalKey && tx && getTxKey(tx) === detailModalKey) {
      closeModal(els.detailModal);
      detailModalKey = null;
    }
    showToast('紀錄已刪除 🗑️', 'success');
  } catch (_) {
    showToast('刪除失敗，請稍後再試', 'error');
  } finally {
    isMutating = false;
    setLoading(false);
  }
}

function setupListFilters() {
  const resetPage = () => {
    listFilters.currentPage = 1;
    renderTransactionList();
  };

  $('#filter-sort-amount').addEventListener('change', (e) => {
    listFilters.sortAmount = e.target.value;
    resetPage();
  });

  const onDayRangeChange = () => {
    setDayRange($('#filter-day-from')?.value || '', $('#filter-day-to')?.value || '');
    resetPage();
  };
  $('#filter-day-from').addEventListener('change', onDayRangeChange);
  $('#filter-day-to').addEventListener('change', onDayRangeChange);

  document.querySelectorAll('#filter-day-toggle [data-day-scope]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.dayScope === 'today') {
        setDayFilter(todayISO());
      } else {
        setDayRange('', '');
      }
      resetPage();
    });
  });

  $('#filter-sort-date').addEventListener('change', (e) => {
    listFilters.sortDate = e.target.value;
    resetPage();
  });

  $('#filter-category').addEventListener('change', (e) => {
    listFilters.category = e.target.value;
    resetPage();
  });

  $('#filter-split').addEventListener('change', (e) => {
    listFilters.splitMode = e.target.value;
    resetPage();
  });

  $('#filter-page-size').addEventListener('change', (e) => {
    listFilters.pageSize = e.target.value;
    listFilters.currentPage = 1;
    renderTransactionList();
  });

  $('#btn-prev').addEventListener('click', () => {
    if (listFilters.currentPage > 1) {
      listFilters.currentPage -= 1;
      renderTransactionList();
    }
  });

  $('#btn-next').addEventListener('click', () => {
    const filtered = getFilteredTransactions();
    const meta = paginateList(filtered);
    if (listFilters.currentPage < meta.totalPages) {
      listFilters.currentPage += 1;
      renderTransactionList();
    }
  });
}

function switchTab(tabName) {
  $$('.tab-btn').forEach((btn) => {
    const isActive = btn.dataset.tab === tabName;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
}

function setupTabs() {
  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

function applyCurrencyView() {
  document.querySelectorAll('[data-currency-view]').forEach((btn) => {
    const active = btn.dataset.currencyView === currencyView;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  });

  document.querySelectorAll('[data-currency-panel]').forEach((panel) => {
    const show = currencyView === 'all' || panel.dataset.currencyPanel === currencyView;
    panel.classList.toggle('hidden', !show);
  });

  updateExplainPreview();
}

function setupCurrencyViewSelector() {
  document.querySelectorAll('[data-currency-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currencyView = btn.dataset.currencyView;
      applyCurrencyView();
    });
  });
  applyCurrencyView();
}

/* ===== Event Handlers ===== */
function setupEventListeners() {
  setupToggle('#currency-toggle', '#expense-currency', 'currency', 'JPY');
  setupToggle('#payer-toggle', '#expense-payer', 'payer', 'A');
  setupToggle('#edit-currency-toggle', '#edit-currency', 'currency', 'JPY');
  setupToggle('#edit-payer-toggle', '#edit-payer', 'payer', 'A');

  setupListFilters();
  setupCategorySelect('#expense-category', '#expense-custom-category-row', '#expense-custom-category');
  setupCategorySelect('#edit-category', '#edit-custom-category-row', '#edit-custom-category');

  $('#btn-edit-budget').addEventListener('click', openBudgetModal);
  $('#btn-refresh').addEventListener('click', async () => {
    try {
      await fetchAllData({ showSuccessToast: true });
    } catch (_) {
      showToast('刷新失敗，請稍後再試', 'error');
    }
  });

  $$('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => {
      closeModal(els.budgetModal);
      closeModal(els.editModal);
      closeModal(els.detailModal);
      closeModal(els.repayModal);
      closeModal(els.deleteConfirmModal);
      closeModal($('#sheet-switcher-modal'));
    });
  });

  $('#sync-status')?.addEventListener('click', () => {
    if ($('#sync-status').disabled) return;
    openSheetSwitcher();
  });

  $('#sheet-switcher-confirm')?.addEventListener('click', () => {
    const target = $('#sheet-switcher-confirm').dataset.target;
    switchApiEndpoint(target);
  });

  $('#delete-confirm-btn')?.addEventListener('click', () => {
    confirmDeleteTransaction();
  });

  $$('[data-close-delete-confirm]').forEach((el) => {
    el.addEventListener('click', () => closeModal(els.deleteConfirmModal));
  });

  $('#btn-open-repay')?.addEventListener('click', openRepayModal);

  setupToggle('#repay-currency-toggle', '#repay-currency', 'currency', 'JPY');
  $('#repay-currency-toggle').querySelectorAll('.toggle-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      delete $('#repay-amount').dataset.touched;
      updateRepayModalView();
    });
  });
  $('#repay-amount')?.addEventListener('input', (e) => {
    e.target.dataset.touched = '1';
  });

  $('#repay-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currency = $('#repay-currency').value;
    const debt = getDebtInfo(currency);
    if (!debt) {
      showToast('此幣別已平帳', 'info');
      return;
    }

    const amount = Number($('#repay-amount').value);
    if (amount <= 0) {
      showToast('請填寫有效金額', 'error');
      return;
    }
    if (amount > debt.amount + 0.01) {
      showToast(`還錢金額唔可以超過欠款 ${formatMoney(debt.amount, currency)}`, 'error');
      return;
    }

    const note = $('#repay-note').value.trim();
    const defaultDesc = `${PERSON_EMOJI[debt.payer]} 還俾 ${PERSON_EMOJI[debt.payee]}`;
    const tx = {
      date: todayISO(),
      category: REPAY_CATEGORY,
      description: note || defaultDesc,
      currency,
      amount,
      payer: debt.payer,
      split_mode: 'REPAY',
    };

    isMutating = true;
    setLoading(true);
    try {
      tx.location = await captureCurrentLocation();
      const data = await syncAddTransaction(tx);
      applyServerData(data);
      updateSyncStatus('success', data.synced_at);
      closeModal(els.repayModal);
      showToast('還錢紀錄已同步 ✅', 'success');
    } catch (_) {
      showToast('還錢同步失敗，請確認 Apps Script 已部署', 'error');
    } finally {
      isMutating = false;
      setLoading(false);
    }
  });

  $('#detail-edit-btn').addEventListener('click', () => {
    if (!detailModalKey) return;
    const key = detailModalKey;
    closeModal(els.detailModal);
    openEditModal(key);
  });

  $('#edit-delete-btn')?.addEventListener('click', deleteTransactionRecord);

  els.expenseForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(els.expenseForm);
    const category = resolveCategory($('#expense-category'), $('#expense-custom-category'));
    if (!category) {
      showToast('請輸入自定分類名稱', 'error');
      return;
    }

    const tx = {
      date: form.get('date'),
      category,
      description: form.get('description').trim(),
      currency: $('#expense-currency').value,
      amount: Number(form.get('amount')),
      payer: $('#expense-payer').value,
      split_mode: form.get('split_mode'),
    };

    if (tx.amount <= 0) {
      showToast('請填寫有效金額', 'error');
      return;
    }

    isMutating = true;
    setLoading(true);
    try {
      tx.location = await captureCurrentLocation();
      const data = await syncAddTransaction(tx);
      applyServerData(data);
      updateSyncStatus('success', data.synced_at);
      els.expenseForm.reset();
      els.expenseDate.value = todayISO();
      $('#expense-category').value = '餐飲-午餐';
      $('#expense-custom-category-row').classList.add('hidden');
      $('#expense-custom-category').value = '';
      setToggleValue('#currency-toggle', '#expense-currency', 'currency', 'JPY');
      updateMoneyPrefix($('#expense-amount-prefix'), 'JPY');
      setToggleValue('#payer-toggle', '#expense-payer', 'payer', 'A');
      listFilters.currentPage = 1;
      switchTab('list');
      showToast('已新增並同步至試算表 ✨', 'success');
    } catch (_) {
      showToast('同步失敗，請確認 Apps Script 已部署', 'error');
    } finally {
      isMutating = false;
      setLoading(false);
    }
  });

  els.budgetForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const newBudgets = {
      A: {
        JPY: Number($('#budget-a-jpy').value),
        HKD: Number($('#budget-a-hkd').value),
      },
      B: {
        JPY: Number($('#budget-b-jpy').value),
        HKD: Number($('#budget-b-hkd').value),
      },
    };

    isMutating = true;
    setLoading(true);
    try {
      const data = await syncBudgets(newBudgets);
      applyServerData(data);
      updateSyncStatus('success', data.synced_at);
      closeModal(els.budgetModal);
      showToast('預算已同步至試算表 💾', 'success');
    } catch (_) {
      showToast('預算同步失敗，請確認 Apps Script 已部署', 'error');
    } finally {
      isMutating = false;
      setLoading(false);
    }
  });

  els.editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = $('#edit-transaction-key').value;
    const idx = transactions.findIndex(
      (t) => t.transaction_id === key || t._uid === key
    );
    if (idx === -1) return;

    const category = resolveCategory($('#edit-category'), $('#edit-custom-category'));
    if (!category) {
      showToast('請輸入自定分類名稱', 'error');
      return;
    }

    const existing = transactions[idx];
    const transactionId = $('#edit-transaction-id').value || existing.transaction_id || '';
    if (!transactionId) {
      showToast('此紀錄尚未有試算表 ID，請先刷新', 'error');
      return;
    }

    const updated = {
      transaction_id: transactionId,
      date: $('#edit-date').value,
      category,
      description: $('#edit-description').value.trim(),
      location: getLocationText(existing),
      currency: $('#edit-currency').value,
      amount: Number($('#edit-amount').value),
      payer: $('#edit-payer').value,
      split_mode:
        existing.split_mode === 'REPAY'
          ? 'REPAY'
          : document.querySelector(
              '#edit-split-options input[name="edit_split_mode"]:checked'
            ).value,
    };

    isMutating = true;
    setLoading(true);
    try {
      const data = await syncEditTransaction(updated);
      applyServerData(data);
      updateSyncStatus('success', data.synced_at);
      closeModal(els.editModal);
      showToast('已更新並同步至試算表 💾', 'success');
    } catch (_) {
      showToast('更新同步失敗，請確認 Apps Script 已部署', 'error');
    } finally {
      isMutating = false;
      setLoading(false);
    }
  });
}

/* ===== Particle Burst ===== */
let particleCtx = null;
let particleCanvas = null;
let particles = [];
let particleAnimId = 0;

function resizeParticleCanvas() {
  if (!particleCanvas) return;
  particleCanvas.width = window.innerWidth * (window.devicePixelRatio || 1);
  particleCanvas.height = window.innerHeight * (window.devicePixelRatio || 1);
  particleCanvas.style.width = `${window.innerWidth}px`;
  particleCanvas.style.height = `${window.innerHeight}px`;
  if (particleCtx) {
    particleCtx.setTransform(window.devicePixelRatio || 1, 0, 0, window.devicePixelRatio || 1, 0, 0);
  }
}

function spawnParticles(x, y, count = 14) {
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const speed = 1.6 + Math.random() * 3.4;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 1.2,
      life: 1,
      decay: 0.018 + Math.random() * 0.02,
      size: 2 + Math.random() * 3.5,
      color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
      gravity: 0.06 + Math.random() * 0.04,
    });
  }
  if (!particleAnimId) particleAnimId = requestAnimationFrame(drawParticles);
}

function drawParticles() {
  if (!particleCtx || !particleCanvas) {
    particleAnimId = 0;
    return;
  }

  particleCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles = particles.filter((p) => p.life > 0);

  particles.forEach((p) => {
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity;
    p.vx *= 0.98;
    p.life -= p.decay;

    particleCtx.globalAlpha = Math.max(p.life, 0);
    particleCtx.fillStyle = p.color;
    particleCtx.beginPath();
    particleCtx.arc(p.x, p.y, p.size * Math.max(p.life, 0.2), 0, Math.PI * 2);
    particleCtx.fill();
  });

  particleCtx.globalAlpha = 1;

  if (particles.length) {
    particleAnimId = requestAnimationFrame(drawParticles);
  } else {
    particleAnimId = 0;
    particleCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

function setupParticleEffects() {
  particleCanvas = $('#particle-canvas');
  if (!particleCanvas) return;
  particleCtx = particleCanvas.getContext('2d');
  resizeParticleCanvas();
  window.addEventListener('resize', resizeParticleCanvas);

  document.addEventListener(
    'pointerdown',
    (e) => {
      const target = e.target.closest(
        '.btn, .toggle-btn, .tab-btn, .currency-label, .btn-page, .btn-edit, .sync-status, .split-option'
      );
      if (!target || target.disabled) return;
      spawnParticles(e.clientX, e.clientY, target.classList.contains('btn-primary') ? 18 : 12);
    },
    { passive: true }
  );
}

/* ===== Init ===== */
async function init() {
  els.expenseDate.value = todayISO();
  initListDayFilter();
  applySplitLabelsToDom();
  setupTabs();
  setupCurrencyViewSelector();
  setupMoneyInputs();
  setupEventListeners();
  setupParticleEffects();
  setupThemeToggle();

  try {
    await fetchAllData();
    startAutoSync();
  } catch (err) {
    console.error('fetchAllData failed:', err);
    showToast(err.message || '無法連線 Google Sheets，請部署 Apps Script', 'error');
    renderAll();
  }
}

document.addEventListener('DOMContentLoaded', init);
