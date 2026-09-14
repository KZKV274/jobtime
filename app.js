/* =========================================================
   ShiftPulse — Personal Work Dashboard
   ========================================================= */
(() => {
  'use strict';

  // ---------- CONSTANTS ----------
  const STORAGE_KEY = 'shiftpulse.shifts.v1';
  const ACTIVE_KEY = 'shiftpulse.active.v1';
  const SETTINGS_KEY = 'shiftpulse.settings.v1';
  const APP_VERSION = 1;

  const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const MONTHS_RU_GEN = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const WEEKDAYS_RU = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];

  const DEFAULT_SETTINGS = {
    appName: 'ShiftPulse',
    targetHours: 176,
    weekStart: 1,
    timeFormat: 24,
    theme: 'system',
  };

  // ---------- STATE ----------
  const state = {
    shifts: [],
    active: null,
    settings: { ...DEFAULT_SETTINGS },
    currentTab: 'home',
    statsPeriod: 'month',
    historyFilter: 'month',
    customRange: { from: null, to: null },
    timerInterval: null,
    charts: { hours: null, months: null },
  };

  // ---------- STORAGE ----------
  const Storage = {
    load() {
      try {
        const s = localStorage.getItem(STORAGE_KEY);
        state.shifts = s ? JSON.parse(s) : [];
        if (!Array.isArray(state.shifts)) state.shifts = [];
      } catch (e) { state.shifts = []; }

      try {
        const a = localStorage.getItem(ACTIVE_KEY);
        state.active = a ? JSON.parse(a) : null;
      } catch (e) { state.active = null; }

      try {
        const st = localStorage.getItem(SETTINGS_KEY);
        state.settings = st ? { ...DEFAULT_SETTINGS, ...JSON.parse(st) } : { ...DEFAULT_SETTINGS };
      } catch (e) { state.settings = { ...DEFAULT_SETTINGS }; }
    },
    saveShifts() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.shifts));
    },
    saveActive() {
      if (state.active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(state.active));
      else localStorage.removeItem(ACTIVE_KEY);
    },
    saveSettings() {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    },
  };

  // ---------- UTILS ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const pad = (n) => String(n).padStart(2, '0');

  const toMinutes = (hhmm) => {
    if (!hhmm || typeof hhmm !== 'string') return NaN;
    const [h, m] = hhmm.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
    return h * 60 + m;
  };

  const minutesToHHMM = (mins) => {
    if (!Number.isFinite(mins) || mins < 0) return '00:00';
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${pad(h)}:${pad(m)}`;
  };

  const formatDuration = (mins) => {
    if (!Number.isFinite(mins) || mins < 0) mins = 0;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (h === 0) return `${m}м`;
    if (m === 0) return `${h}ч`;
    return `${h}ч ${m}м`;
  };

  const formatHoursLabel = (mins) => {
    if (!Number.isFinite(mins) || mins < 0) mins = 0;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return `${h}ч ${pad(m)}м`;
  };

  const parseISODate = (iso) => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  };

  const toISODate = (date) => {
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    return `${y}-${m}-${d}`;
  };

  const isSameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const startOfWeek = (date, weekStart = 1) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day - weekStart + 7) % 7;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  };

  const endOfWeek = (date, weekStart = 1) => {
    const s = startOfWeek(date, weekStart);
    s.setDate(s.getDate() + 6);
    s.setHours(23, 59, 59, 999);
    return s;
  };

  const startOfMonth = (date) => new Date(date.getFullYear(), date.getMonth(), 1);
  const endOfMonth = (date) => new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);

  const formatTimeDisplay = (hhmm, fmt) => {
    if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return hhmm || '';
    if (fmt !== 12) return hhmm;
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${pad(m)} ${ampm}`;
  };

  const uid = () => `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const escapeHtml = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  // ---------- SHIFT LOGIC ----------
  const calcShiftDuration = (startTime, endTime, breakMinutes = 0) => {
    const s = toMinutes(startTime);
    const e = toMinutes(endTime);
    if (Number.isNaN(s) || Number.isNaN(e)) return 0;
    let diff = e - s;
    if (diff <= 0) diff += 24 * 60;
    diff -= Math.max(0, breakMinutes || 0);
    if (diff < 0) diff = 0;
    return diff;
  };

  const shiftsInRange = (from, to) => {
    const f = toISODate(from);
    const t = toISODate(to);
    return state.shifts.filter(s => s.date >= f && s.date <= t);
  };

  const sumDuration = (list) => list.reduce((acc, s) => acc + (s.durationMinutes || 0), 0);

  const getLastShift = () => {
    if (!state.shifts.length) return null;
    const sorted = [...state.shifts].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return sorted[0];
  };

  const computeStreak = () => {
    if (!state.shifts.length) return 0;
    const dates = [...new Set(state.shifts.map(s => s.date))].sort().reverse();
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    let start = null;
    if (dates[0] === toISODate(today)) start = today;
    else if (dates[0] === toISODate(yesterday)) start = yesterday;
    else return 0;
    let streak = 0;
    let cursor = new Date(start);
    const set = new Set(dates);
    while (set.has(toISODate(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  };

  // ---------- GREETING ----------
  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 5) return 'Доброй ночи';
    if (h < 12) return 'Доброе утро';
    if (h < 17) return 'Добрый день';
    if (h < 22) return 'Добрый вечер';
    return 'Добрый вечер';
  };

  // ---------- RENDER: HOME ----------
  const renderHome = () => {
    $('#greeting').textContent = getGreeting();

    const card = $('#statusCard');
    const badge = $('#statusText');
    const body = $('#statusBody');
    const fmt = state.settings.timeFormat;

    if (state.active) {
      card.classList.add('active');
      card.classList.remove('idle');
      badge.textContent = 'На смене';
      const startTime = state.active.startTime || '--:--';
      body.innerHTML = `
        <div class="timer-display" id="liveTimer">00:00:00</div>
        <p class="status-start">Начало: <strong>${formatTimeDisplay(startTime, fmt)}</strong></p>
        <button class="btn-primary stop" id="stopShiftBtn">Завершить смену</button>
      `;
      $('#stopShiftBtn').addEventListener('click', stopShift);
      startLiveTimer();
    } else {
      card.classList.remove('active');
      card.classList.add('idle');
      badge.textContent = 'Статус';
      body.innerHTML = `
        <div class="status-idle-text">Не на смене</div>
        <p class="status-idle-sub">Начни смену, когда будешь готов</p>
        <button class="btn-primary" id="startShiftBtn">Начать смену</button>
      `;
      $('#startShiftBtn').addEventListener('click', startShift);
      stopLiveTimer();
    }

    const now = new Date();
    const monthShifts = shiftsInRange(startOfMonth(now), endOfMonth(now));
    const monthMinutes = sumDuration(monthShifts);

    $('#qsShifts').textContent = monthShifts.length;
    $('#qsHours').textContent = formatDuration(monthMinutes);
    $('#qsAvg').textContent = monthShifts.length ? formatDuration(Math.round(monthMinutes / monthShifts.length)) : '—';
    $('#qsTotal').textContent = state.shifts.length;

    $('#monthName').textContent = `${MONTHS_RU[now.getMonth()].toUpperCase()} ${now.getFullYear()}`;
    $('#monthShifts').textContent = monthShifts.length;
    $('#monthHours').textContent = formatHoursLabel(monthMinutes);
    $('#monthAvg').textContent = monthShifts.length ? formatHoursLabel(Math.round(monthMinutes / monthShifts.length)) : '—';
    const target = state.settings.targetHours || 0;
    $('#monthTarget').textContent = `${target}ч`;
    const percent = target > 0 ? Math.min(100, (monthMinutes / 60) / target * 100) : 0;
    const fill = $('#monthProgress');
    fill.style.width = `${percent}%`;
    fill.classList.toggle('done', target > 0 && monthMinutes / 60 >= target);
    $('#progressText').textContent = `${Math.floor(monthMinutes / 60)} / ${target} часов`;
    $('#progressPercent').textContent = `${percent.toFixed(0)}%`;

    const last = getLastShift();
    const wrap = $('#lastShiftWrap');
    if (!last) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-emoji">📋</div>
          <p class="empty-title">Смен пока нет</p>
          <p class="empty-sub">Добавь первую смену, чтобы начать вести статистику</p>
        </div>`;
    } else {
      wrap.innerHTML = shiftCardHTML(last, { showActions: false });
      bindShiftCardActions(wrap);
    }

    const streak = computeStreak();
    $('#streakValue').textContent = streak > 0 ? `${streak} ${pluralize(streak, 'смена', 'смены', 'смен')} подряд` : 'Нет активной серии';
    $('#streakLabel').textContent = streak > 0 ? 'Отличный темп!' : 'Начни смену, чтобы продолжить';
  };

  const pluralize = (n, one, few, many) => {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  };

  const shiftCardHTML = (shift, opts = {}) => {
    const date = parseISODate(shift.date);
    const weekday = date ? WEEKDAYS_RU[date.getDay()] : '';
    const dayLabel = date ? `${date.getDate()} ${MONTHS_RU_GEN[date.getMonth()]}` : shift.date;
    const fmt = state.settings.timeFormat;
    const today = isSameDay(date || new Date(0), new Date());
    const yesterday = (() => {
      const y = new Date(); y.setDate(y.getDate() - 1);
      return date && isSameDay(date, y);
    })();
    const statusText = today ? 'Сегодня' : yesterday ? 'Вчера' : '';
    const statusClass = today ? 'today' : '';

    const actions = opts.showActions !== false ? `
      <div class="shift-actions">
        <button data-action="edit" data-id="${shift.id}">Редактировать</button>
        <button data-action="delete" data-id="${shift.id}" class="btn-del">Удалить</button>
      </div>` : '';

    return `
      <div class="shift-card" data-id="${shift.id}">
        <div class="shift-date-row">
          <div>
            <div class="shift-date">${dayLabel}</div>
            <div class="shift-weekday">${weekday}</div>
          </div>
          ${statusText ? `<span class="shift-status-pill ${statusClass}">${statusText}</span>` : ''}
        </div>
        <div class="shift-time-row">
          <span class="shift-time">${formatTimeDisplay(shift.startTime, fmt)}</span>
          <span class="shift-arrow">→</span>
          <span class="shift-time">${formatTimeDisplay(shift.endTime, fmt)}</span>
        </div>
        <div class="shift-duration-row">
          <span class="shift-duration-label">Рабочее время</span>
          <span class="shift-duration">${formatDuration(shift.durationMinutes)}</span>
        </div>
        ${shift.breakMinutes ? `<div class="shift-comment">Перерыв: ${formatDuration(shift.breakMinutes)}</div>` : ''}
        ${shift.comment ? `<div class="shift-comment">${escapeHtml(shift.comment)}</div>` : ''}
        ${actions}
      </div>
    `;
  };

  const bindShiftCardActions = (root) => {
    root.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.id;
        const action = btn.dataset.action;
        if (action === 'edit') editShift(id);
        else if (action === 'delete') confirmDeleteShift(id);
      });
    });
  };

  // ---------- LIVE TIMER ----------
  const startLiveTimer = () => {
    if (state.timerInterval) return;
    const tick = () => {
      const el = $('#liveTimer');
      if (!el) return;
      if (!state.active) return;
      const start = new Date(state.active.startTimeISO);
      const diffMs = Date.now() - start.getTime();
      const totalSec = Math.max(0, Math.floor(diffMs / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      el.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
    };
    tick();
    state.timerInterval = setInterval(tick, 1000);
  };

  const stopLiveTimer = () => {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  };

  // ---------- START / STOP SHIFT ----------
  const startShift = () => {
    const now = new Date();
    state.active = {
      id: uid(),
      date: toISODate(now),
      startTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
      startTimeISO: now.toISOString(),
      status: 'active',
      createdAt: Date.now(),
    };
    Storage.saveActive();
    showToast('Смена началась. Хорошей работы!');
    renderHome();
  };

  const stopShift = () => {
    if (!state.active) return;
    const now = new Date();
    const endTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const duration = calcShiftDuration(state.active.startTime, endTime, 0);
    const shift = {
      id: state.active.id,
      date: state.active.date,
      startTime: state.active.startTime,
      endTime,
      breakMinutes: 0,
      durationMinutes: duration,
      comment: '',
      status: 'completed',
      createdAt: state.active.createdAt,
    };
    state.shifts.push(shift);
    state.active = null;
    Storage.saveShifts();
    Storage.saveActive();
    showToast('Смена завершена и сохранена');
    renderHome();
    if (state.currentTab === 'history') renderHistory();
    if (state.currentTab === 'stats') renderStats();
  };

  // ---------- FORM ----------
  const setupForm = () => {
    const today = toISODate(new Date());
    $('#fDate').value = today;

    const fields = ['#fDate', '#fStart', '#fEnd', '#fBreak'];
    fields.forEach(sel => {
      const el = $(sel);
      if (el) el.addEventListener('input', updateDurationPreview);
    });

    $('#shiftForm').addEventListener('submit', (e) => {
      e.preventDefault();
      submitShiftForm();
    });

    $('#cancelEditBtn').addEventListener('click', () => {
      resetForm();
    });
  };

  const updateDurationPreview = () => {
    const s = $('#fStart').value;
    const e = $('#fEnd').value;
    const br = $('#fBreak').value || '00:00';
    const prev = $('#durationPreview');
    if (!s || !e) { prev.textContent = '0ч 00м'; return; }
    const breakMin = toMinutes(br) || 0;
    const dur = calcShiftDuration(s, e, breakMin);
    prev.textContent = formatDuration(dur);
  };

  const showFormError = (msg) => {
    const el = $('#formError');
    el.textContent = msg;
    el.hidden = false;
  };

  const hideFormError = () => {
    $('#formError').hidden = true;
  };

  const submitShiftForm = () => {
    hideFormError();
    const date = $('#fDate').value;
    const start = $('#fStart').value;
    const end = $('#fEnd').value;
    const br = $('#fBreak').value || '00:00';
    const comment = $('#fComment').value.trim();
    const editId = $('#editId').value;

    if (!date) return showFormError('Укажите дату смены');
    if (!start) return showFormError('Укажите время начала');
    if (!end) return showFormError('Укажите время окончания');

    const breakMin = toMinutes(br);
    if (Number.isNaN(breakMin) || breakMin < 0) {
      return showFormError('Некорректный перерыв');
    }
    if (breakMin >= 24 * 60) return showFormError('Перерыв слишком большой');

    const rawSpan = (() => {
      const s = toMinutes(start);
      const e = toMinutes(end);
      let d = e - s;
      if (d <= 0) d += 24 * 60;
      return d;
    })();

    if (breakMin >= rawSpan) {
      return showFormError('Перерыв больше или равен длительности смены');
    }

    const dur = calcShiftDuration(start, end, breakMin);

    if (editId) {
      const idx = state.shifts.findIndex(s => s.id === editId);
      if (idx >= 0) {
        state.shifts[idx] = {
          ...state.shifts[idx],
          date, startTime: start, endTime: end,
          breakMinutes: breakMin, durationMinutes: dur, comment,
        };
      }
      Storage.saveShifts();
      showToast('Смена обновлена');
    } else {
      state.shifts.push({
        id: uid(),
        date, startTime: start, endTime: end,
        breakMinutes: breakMin, durationMinutes: dur, comment,
        status: 'completed',
        createdAt: Date.now(),
      });
      Storage.saveShifts();
      showToast('Смена сохранена');
    }

    resetForm();
    renderAll();
    switchTab('history');
  };

  const resetForm = () => {
    $('#editId').value = '';
    $('#shiftForm').reset();
    $('#fDate').value = toISODate(new Date());
    $('#fStart').value = '';
    $('#fEnd').value = '';
    $('#fBreak').value = '00:00';
    $('#fComment').value = '';
    $('#durationPreview').textContent = '0ч 00м';
    $('#saveShiftBtn').querySelector('span').textContent = 'Сохранить смену';
    $('#cancelEditBtn').hidden = true;
    hideFormError();
  };

  const editShift = (id) => {
    const s = state.shifts.find(x => x.id === id);
    if (!s) return;
    $('#editId').value = s.id;
    $('#fDate').value = s.date;
    $('#fStart').value = s.startTime;
    $('#fEnd').value = s.endTime;
    $('#fBreak').value = minutesToHHMM(s.breakMinutes || 0);
    $('#fComment').value = s.comment || '';
    $('#saveShiftBtn').querySelector('span').textContent = 'Сохранить изменения';
    $('#cancelEditBtn').hidden = false;
    updateDurationPreview();
    switchTab('add');
  };

  // ---------- DELETE ----------
  const confirmDeleteShift = (id) => {
    openModal({
      title: 'Удалить эту смену?',
      text: 'Это действие нельзя отменить. Смена будет удалена из истории.',
      confirmText: 'Удалить',
      onConfirm: () => {
        state.shifts = state.shifts.filter(s => s.id !== id);
        Storage.saveShifts();
        showToast('Смена удалена');
        renderAll();
      }
    });
  };

  // ---------- MODAL ----------
  let modalHandlers = null;

  const openModal = ({ title, text, confirmText = 'Удалить', cancelText = 'Отмена', onConfirm }) => {
    const backdrop = $('#modalBackdrop');
    const cancelBtn = $('#modalCancel');
    const confirmBtn = $('#modalConfirm');

    // Снимаем предыдущие обработчики, если остались
    if (modalHandlers) {
      cancelBtn.removeEventListener('click', modalHandlers.onCancel);
      confirmBtn.removeEventListener('click', modalHandlers.onConfirm);
      backdrop.removeEventListener('click', modalHandlers.onBackdrop);
      document.removeEventListener('keydown', modalHandlers.onEsc);
      modalHandlers = null;
    }

    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;
    cancelBtn.textContent = cancelText;
    confirmBtn.textContent = confirmText;

    const close = () => {
      backdrop.hidden = true;
      if (modalHandlers) {
        cancelBtn.removeEventListener('click', modalHandlers.onCancel);
        confirmBtn.removeEventListener('click', modalHandlers.onConfirm);
        backdrop.removeEventListener('click', modalHandlers.onBackdrop);
        document.removeEventListener('keydown', modalHandlers.onEsc);
        modalHandlers = null;
      }
    };

    const onCancel = (e) => { e.preventDefault(); close(); };
    const onConfirm = (e) => {
      e.preventDefault();
      close();
      try { onConfirm && onConfirm(); } catch (err) { console.error(err); }
    };
    const onBackdrop = (e) => { if (e.target === backdrop) close(); };
    const onEsc = (e) => { if (e.key === 'Escape') close(); };

    modalHandlers = { onCancel, onConfirm, onBackdrop, onEsc };

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);

    backdrop.hidden = false;
  };

  // ---------- TOAST ----------
  let toastTimeout = null;
  const showToast = (msg) => {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(() => t.classList.add('show'));
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => { t.hidden = true; }, 300);
    }, 2200);
  };

  // ---------- STATS ----------
  const getPeriodRange = (period) => {
    const now = new Date();
    if (period === 'week') {
      return [startOfWeek(now, state.settings.weekStart), endOfWeek(now, state.settings.weekStart)];
    }
    if (period === 'month') {
      return [startOfMonth(now), endOfMonth(now)];
    }
    if (period === 'year') {
      return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)];
    }
    return [new Date(0), new Date(9999, 11, 31)];
  };

  const renderStats = () => {
    const [from, to] = getPeriodRange(state.statsPeriod);
    const list = shiftsInRange(from, to);
    const total = sumDuration(list);

    $('#stShifts').textContent = list.length;
    $('#stHours').textContent = formatHoursLabel(total);

    if (!list.length) {
      $('#stAvg').textContent = '—';
      $('#stMax').textContent = '—';
      $('#stMin').textContent = '—';
      $('#stWeekAvg').textContent = '—';
    } else {
      const avg = Math.round(total / list.length);
      const max = Math.max(...list.map(s => s.durationMinutes || 0));
      const min = Math.min(...list.map(s => s.durationMinutes || 0));
      $('#stAvg').textContent = formatDuration(avg);
      $('#stMax').textContent = formatDuration(max);
      $('#stMin').textContent = formatDuration(min);
      const weeks = Math.max(1, Math.ceil((to - from) / (7 * 24 * 60 * 60 * 1000)));
      $('#stWeekAvg').textContent = formatDuration(Math.round(total / weeks));
    }

    renderHoursChart(list, from, to);
    renderMonthsChart();
    renderMonthsList();
  };

  const chartColors = () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return {
      text: isLight ? '#52596A' : '#A0A6B2',
      grid: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
      bar: 'rgba(139,92,246,0.85)',
      barBorder: '#8B5CF6',
      barHover: '#6366F1',
    };
  };

  const renderHoursChart = (list, from, to) => {
    const canvas = $('#hoursChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const col = chartColors();
    const labels = [];
    const values = [];

    if (state.statsPeriod === 'year') {
      const perMonth = Array.from({ length: 12 }, () => 0);
      list.forEach(s => {
        const d = parseISODate(s.date);
        if (d) perMonth[d.getMonth()] += s.durationMinutes || 0;
      });
      MONTHS_RU.forEach((m, i) => {
        labels.push(m.slice(0, 3));
        values.push(+(perMonth[i] / 60).toFixed(2));
      });
    } else {
      const cursor = new Date(from);
      cursor.setHours(0, 0, 0, 0);
      const end = new Date(to);
      while (cursor <= end) {
        const iso = toISODate(cursor);
        const dayMin = list.filter(s => s.date === iso).reduce((a, s) => a + (s.durationMinutes || 0), 0);
        labels.push(`${pad(cursor.getDate())}.${pad(cursor.getMonth() + 1)}`);
        values.push(+(dayMin / 60).toFixed(2));
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    if (state.charts.hours) state.charts.hours.destroy();
    state.charts.hours = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Часы',
          data: values,
          backgroundColor: col.bar,
          hoverBackgroundColor: col.barHover,
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 40,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(20,23,28,0.95)',
            borderColor: 'rgba(139,92,246,0.4)',
            borderWidth: 1,
            titleColor: '#F2F4F8',
            bodyColor: '#F2F4F8',
            padding: 12,
            cornerRadius: 12,
            displayColors: false,
            callbacks: { label: (ctx) => `${ctx.parsed.y} ч` },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: col.text, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
          },
          y: {
            grid: { color: col.grid },
            border: { display: false },
            ticks: { color: col.text, font: { size: 11 }, callback: (v) => `${v}ч` },
            beginAtZero: true,
          },
        },
      },
    });
  };

  const renderMonthsChart = () => {
    const canvas = $('#monthsChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const col = chartColors();

    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ y: d.getFullYear(), m: d.getMonth(), label: `${MONTHS_RU[d.getMonth()].slice(0,3)} ${String(d.getFullYear()).slice(2)}`, mins: 0 });
    }
    state.shifts.forEach(s => {
      const d = parseISODate(s.date);
      if (!d) return;
      const found = months.find(x => x.y === d.getFullYear() && x.m === d.getMonth());
      if (found) found.mins += s.durationMinutes || 0;
    });

    if (state.charts.months) state.charts.months.destroy();
    state.charts.months = new Chart(canvas, {
      type: 'line',
      data: {
        labels: months.map(m => m.label),
        datasets: [{
          label: 'Часы',
          data: months.map(m => +(m.mins / 60).toFixed(1)),
          borderColor: '#8B5CF6',
          backgroundColor: (ctx) => {
            const g = ctx.chart.ctx.createLinearGradient(0, 0, 0, 240);
            g.addColorStop(0, 'rgba(139,92,246,0.4)');
            g.addColorStop(1, 'rgba(139,92,246,0)');
            return g;
          },
          fill: true,
          tension: 0.4,
          borderWidth: 2.5,
          pointBackgroundColor: '#8B5CF6',
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(20,23,28,0.95)',
            borderColor: 'rgba(139,92,246,0.4)',
            borderWidth: 1,
            titleColor: '#F2F4F8',
            bodyColor: '#F2F4F8',
            padding: 12,
            cornerRadius: 12,
            displayColors: false,
            callbacks: { label: (ctx) => `${ctx.parsed.y} ч` },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: col.text, font: { size: 10 } },
          },
          y: {
            grid: { color: col.grid },
            border: { display: false },
            ticks: { color: col.text, font: { size: 11 }, callback: (v) => `${v}ч` },
            beginAtZero: true,
          },
        },
      },
    });
  };

  const renderMonthsList = () => {
    const wrap = $('#monthsList');
    const map = new Map();
    state.shifts.forEach(s => {
      const d = parseISODate(s.date);
      if (!d) return;
      const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      if (!map.has(key)) map.set(key, { y: d.getFullYear(), m: d.getMonth(), shifts: 0, mins: 0 });
      const item = map.get(key);
      item.shifts++;
      item.mins += s.durationMinutes || 0;
    });
    const sorted = [...map.values()].sort((a, b) => (b.y - a.y) || (b.m - a.m));

    if (!sorted.length) {
      wrap.innerHTML = `<div class="empty-state">
        <div class="empty-emoji">📊</div>
        <p class="empty-title">Пока нет данных по месяцам</p>
        <p class="empty-sub">Добавь смены, чтобы увидеть статистику</p>
      </div>`;
      return;
    }

    wrap.innerHTML = sorted.map(item => `
      <div class="month-item">
        <div>
          <div class="month-item-name">${MONTHS_RU[item.m]} ${item.y}</div>
          <div class="month-item-shifts">${item.shifts} ${pluralize(item.shifts, 'смена', 'смены', 'смен')}</div>
        </div>
        <div class="month-item-hours">${formatHoursLabel(item.mins)}</div>
      </div>
    `).join('');
  };

  // ---------- HISTORY ----------
  const getHistoryRange = () => {
    const now = new Date();
    const f = state.historyFilter;
    if (f === 'today') return [now, now];
    if (f === 'week') return [startOfWeek(now, state.settings.weekStart), endOfWeek(now, state.settings.weekStart)];
    if (f === 'month') return [startOfMonth(now), endOfMonth(now)];
    if (f === 'prevMonth') {
      const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return [startOfMonth(d), endOfMonth(d)];
    }
    if (f === 'year') return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 11, 31, 23, 59, 59)];
    if (f === 'custom') {
      const from = state.customRange.from ? parseISODate(state.customRange.from) : new Date(0);
      const to = state.customRange.to ? parseISODate(state.customRange.to) : new Date(9999, 11, 31);
      if (from) from.setHours(0,0,0,0);
      if (to) to.setHours(23,59,59,999);
      return [from, to];
    }
    return [new Date(0), new Date(9999, 11, 31)];
  };

  const renderHistory = () => {
    const [from, to] = getHistoryRange();
    const list = shiftsInRange(from, to).sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const totalMin = sumDuration(list);
    $('#historySummary').textContent = list.length
      ? `${list.length} ${pluralize(list.length, 'смена', 'смены', 'смен')} · ${formatHoursLabel(totalMin)}`
      : '';

    const wrap = $('#historyList');
    if (!list.length) {
      wrap.innerHTML = `
        <div class="empty-state">
          <div class="empty-emoji">🗓️</div>
          <p class="empty-title">История пока пуста</p>
          <p class="empty-sub">Добавь первую смену и начни собирать свою рабочую статистику.</p>
          <button class="btn-primary" id="emptyAddBtn">+ Добавить смену</button>
        </div>`;
      const b = $('#emptyAddBtn');
      if (b) b.addEventListener('click', () => switchTab('add'));
      return;
    }

    wrap.innerHTML = list.map(s => shiftCardHTML(s)).join('');
    bindShiftCardActions(wrap);
  };

  // ---------- SETTINGS ----------
  const applySettings = () => {
    document.documentElement.setAttribute('data-theme', resolveTheme());
    $('#sAppName').value = state.settings.appName;
    $('#sTarget').value = state.settings.targetHours;
    $('#sWeekStart').value = String(state.settings.weekStart);
    $('#sTimeFormat').value = String(state.settings.timeFormat);
    $('#sTheme').value = state.settings.theme;
    document.title = state.settings.appName;
  };

  const resolveTheme = () => {
    const t = state.settings.theme;
    if (t === 'system') {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return t;
  };

  const setupSettings = () => {
    $('#sAppName').addEventListener('change', (e) => {
      state.settings.appName = e.target.value.trim() || 'ShiftPulse';
      Storage.saveSettings();
      applySettings();
    });
    $('#sTarget').addEventListener('change', (e) => {
      const v = Math.max(0, Math.min(400, Number(e.target.value) || 0));
      state.settings.targetHours = v;
      e.target.value = v;
      Storage.saveSettings();
      renderHome();
    });
    $('#sWeekStart').addEventListener('change', (e) => {
      state.settings.weekStart = Number(e.target.value);
      Storage.saveSettings();
      renderAll();
    });
    $('#sTimeFormat').addEventListener('change', (e) => {
      state.settings.timeFormat = Number(e.target.value);
      Storage.saveSettings();
      renderAll();
    });
    $('#sTheme').addEventListener('change', (e) => {
      state.settings.theme = e.target.value;
      Storage.saveSettings();
      applySettings();
      renderAll();
    });

    $('#themeQuickToggle').addEventListener('click', () => {
      const cur = resolveTheme();
      state.settings.theme = cur === 'dark' ? 'light' : 'dark';
      Storage.saveSettings();
      applySettings();
      $('#sTheme').value = state.settings.theme;
      renderAll();
    });

    $('#exportJson').addEventListener('click', exportJSON);
    $('#exportCsv').addEventListener('click', exportCSV);
    $('#importFile').addEventListener('change', handleImport);
    $('#wipeData').addEventListener('click', () => {
      openModal({
        title: 'Удалить все данные?',
        text: 'Все смены и настройки будут удалены безвозвратно. Рекомендуем сначала сделать экспорт.',
        confirmText: 'Удалить всё',
        onConfirm: () => {
          state.shifts = [];
          state.active = null;
          Storage.saveShifts();
          Storage.saveActive();
          stopLiveTimer();
          showToast('Все данные удалены');
          renderAll();
        },
      });
    });

    window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
      if (state.settings.theme === 'system') {
        applySettings();
        renderAll();
      }
    });
  };

  // ---------- EXPORT ----------
  const downloadFile = (filename, content, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportJSON = () => {
    const payload = {
      app: 'ShiftPulse',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      shifts: state.shifts,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`shiftpulse_${stamp}.json`, JSON.stringify(payload, null, 2), 'application/json');
    showToast('Экспорт JSON готов');
  };

  const csvEscape = (val) => {
    const s = String(val ?? '');
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const exportCSV = () => {
    const fmt = state.settings.timeFormat;
    const header = ['Дата','Начало','Конец','Перерыв','Рабочие часы','Комментарий'];
    const rows = [...state.shifts]
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
      .map(s => [
        s.date,
        formatTimeDisplay(s.startTime, fmt),
        formatTimeDisplay(s.endTime, fmt),
        formatDuration(s.breakMinutes || 0),
        formatHoursLabel(s.durationMinutes),
        s.comment || '',
      ].map(csvEscape).join(','));
    const csv = '\uFEFF' + [header.join(','), ...rows].join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile(`shifts_${stamp}.csv`, csv, 'text/csv;charset=utf-8');
    showToast('Экспорт CSV готов');
  };

  // ---------- IMPORT ----------
  const handleImport = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const incoming = Array.isArray(data.shifts) ? data.shifts : Array.isArray(data) ? data : [];
        if (!incoming.length) { showToast('Файл не содержит смен'); return; }
        openModal({
          title: 'Импортировать данные?',
          text: `Найдено ${incoming.length} ${pluralize(incoming.length, 'смена', 'смены', 'смен')}. Существующие данные будут сохранены.`,
          confirmText: 'Импортировать',
          onConfirm: () => {
            const existingIds = new Set(state.shifts.map(s => s.id));
            const normalized = incoming.map(s => normalizeImportedShift(s)).filter(Boolean).filter(s => !existingIds.has(s.id));
            state.shifts.push(...normalized);
            Storage.saveShifts();
            if (data.settings && typeof data.settings === 'object') {
              state.settings = { ...state.settings, ...data.settings };
              Storage.saveSettings();
              applySettings();
            }
            showToast(`Импортировано ${normalized.length} смен`);
            renderAll();
          },
        });
      } catch (err) {
        showToast('Некорректный JSON файл');
      } finally {
        e.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const normalizeImportedShift = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const date = raw.date;
    const startTime = raw.startTime;
    const endTime = raw.endTime;
    if (!date || !startTime || !endTime) return null;
    const breakMinutes = Number(raw.breakMinutes) || 0;
    const durationMinutes = Number.isFinite(raw.durationMinutes)
      ? raw.durationMinutes
      : calcShiftDuration(startTime, endTime, breakMinutes);
    return {
      id: raw.id || uid(),
      date, startTime, endTime,
      breakMinutes, durationMinutes,
      comment: raw.comment || '',
      status: raw.status || 'completed',
      createdAt: raw.createdAt || Date.now(),
    };
  };

  // ---------- NAVIGATION ----------
  const switchTab = (tab) => {
    state.currentTab = tab;
    $$('.tab').forEach(el => {
      el.hidden = el.dataset.tab !== tab;
    });
    $$('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    if (tab === 'home') renderHome();
    else if (tab === 'stats') renderStats();
    else if (tab === 'history') renderHistory();
    else if (tab === 'add') {
      setTimeout(() => { const el = $('#fStart'); if (el && !el.value) el.focus(); }, 50);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const setupNav = () => {
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
  };

  // ---------- STATS PERIOD ----------
  const setupStatsPeriod = () => {
    $$('#statsPeriod button').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#statsPeriod button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.statsPeriod = btn.dataset.period;
        renderStats();
      });
    });
  };

  // ---------- HISTORY FILTER ----------
  const setupHistoryFilter = () => {
    $('#historyFilter').addEventListener('change', (e) => {
      state.historyFilter = e.target.value;
      const custom = state.historyFilter === 'custom';
      $('#customRange').hidden = !custom;
      if (custom) {
        const now = new Date();
        $('#rangeFrom').value = state.customRange.from || toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
        $('#rangeTo').value = state.customRange.to || toISODate(now);
        state.customRange.from = $('#rangeFrom').value;
        state.customRange.to = $('#rangeTo').value;
      }
      renderHistory();
    });
    $('#rangeFrom').addEventListener('change', (e) => {
      state.customRange.from = e.target.value;
      renderHistory();
    });
    $('#rangeTo').addEventListener('change', (e) => {
      state.customRange.to = e.target.value;
      renderHistory();
    });
  };

  // ---------- RENDER ALL ----------
  const renderAll = () => {
    renderHome();
    if (state.currentTab === 'stats') renderStats();
    if (state.currentTab === 'history') renderHistory();
  };

  // ---------- PWA REGISTRATION ----------
  const registerSW = () => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(() => {});
      });
    }
  };

  // ---------- INIT ----------
  const init = () => {
    // ⬇️ Явно скрываем модалку и тост при старте
    const backdrop = $('#modalBackdrop');
    const toast = $('#toast');
    if (backdrop) backdrop.hidden = true;
    if (toast) toast.hidden = true;

    Storage.load();
    applySettings();
    setupNav();
    setupForm();
    setupSettings();
    setupStatsPeriod();
    setupHistoryFilter();
    resetForm();
    renderAll();
    registerSW();

    setInterval(() => {
      if (state.currentTab === 'home') renderHome();
    }, 60 * 1000);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
