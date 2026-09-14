/* =========================================================
   ShiftPulse — Personal Work Dashboard
   Полностью переписан с защитой от ошибок инициализации
   ========================================================= */
(function () {
  'use strict';

  // ============ ГЛОБАЛЬНАЯ ЗАЩИТА ============
  const $ = function (sel) { return document.querySelector(sel); };
  const $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  const on = function (el, evt, fn) { if (el) el.addEventListener(evt, fn); };

  // ============ КОНСТАНТЫ ============
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

  // ============ STATE ============
  const state = {
    shifts: [],
    active: null,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    currentTab: 'home',
    statsPeriod: 'month',
    historyFilter: 'month',
    customRange: { from: null, to: null },
    timerInterval: null,
    charts: { hours: null, months: null },
    modalHandler: null,
  };

  // ============ STORAGE ============
  const Storage = {
    load: function () {
      try {
        const s = localStorage.getItem(STORAGE_KEY);
        const parsed = s ? JSON.parse(s) : [];
        state.shifts = Array.isArray(parsed) ? parsed : [];
      } catch (e) { state.shifts = []; }

      try {
        const a = localStorage.getItem(ACTIVE_KEY);
        const p = a ? JSON.parse(a) : null;
        state.active = (p && typeof p === 'object') ? p : null;
      } catch (e) { state.active = null; }

      try {
        const st = localStorage.getItem(SETTINGS_KEY);
        const p = st ? JSON.parse(st) : null;
        state.settings = (p && typeof p === 'object')
          ? Object.assign({}, DEFAULT_SETTINGS, p)
          : Object.assign({}, DEFAULT_SETTINGS);
      } catch (e) { state.settings = Object.assign({}, DEFAULT_SETTINGS); }
    },
    saveShifts: function () {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.shifts)); } catch (e) {}
    },
    saveActive: function () {
      try {
        if (state.active) localStorage.setItem(ACTIVE_KEY, JSON.stringify(state.active));
        else localStorage.removeItem(ACTIVE_KEY);
      } catch (e) {}
    },
    saveSettings: function () {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (e) {}
    },
  };

  // ============ UTILS ============
  function pad(n) { return String(n).padStart(2, '0'); }

  function toMinutes(hhmm) {
    if (!hhmm || typeof hhmm !== 'string') return NaN;
    const parts = hhmm.split(':');
    const h = Number(parts[0]);
    const m = Number(parts[1]);
    if (Number.isNaN(h) || Number.isNaN(m)) return NaN;
    return h * 60 + m;
  }

  function minutesToHHMM(mins) {
    if (!Number.isFinite(mins) || mins < 0) return '00:00';
    return pad(Math.floor(mins / 60)) + ':' + pad(Math.round(mins % 60));
  }

  function formatDuration(mins) {
    if (!Number.isFinite(mins) || mins < 0) mins = 0;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    if (h === 0) return m + 'м';
    if (m === 0) return h + 'ч';
    return h + 'ч ' + m + 'м';
  }

  function formatHoursLabel(mins) {
    if (!Number.isFinite(mins) || mins < 0) mins = 0;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return h + 'ч ' + pad(m) + 'м';
  }

  function parseISODate(iso) {
    if (!iso || typeof iso !== 'string') return null;
    const parts = iso.split('-');
    if (parts.length < 3) return null;
    const y = Number(parts[0]), m = Number(parts[1]), d = Number(parts[2]);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }

  function toISODate(date) {
    if (!(date instanceof Date) || isNaN(date.getTime())) return '';
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  }

  function startOfWeek(date, weekStart) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = (day - weekStart + 7) % 7;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function endOfWeek(date, weekStart) {
    const s = startOfWeek(date, weekStart);
    s.setDate(s.getDate() + 6);
    s.setHours(23, 59, 59, 999);
    return s;
  }

  function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
  function endOfMonth(date) { return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999); }

  function formatTimeDisplay(hhmm, fmt) {
    if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return hhmm || '';
    if (fmt !== 12) return hhmm;
    const parts = hhmm.split(':');
    const h = Number(parts[0]);
    const m = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return h12 + ':' + m + ' ' + ampm;
  }

  function uid() {
    return 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pluralize(n, one, few, many) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
  }

  // ============ SHIFT LOGIC ============
  function calcShiftDuration(startTime, endTime, breakMinutes) {
    breakMinutes = breakMinutes || 0;
    const s = toMinutes(startTime);
    const e = toMinutes(endTime);
    if (Number.isNaN(s) || Number.isNaN(e)) return 0;
    let diff = e - s;
    if (diff <= 0) diff += 24 * 60;
    diff -= Math.max(0, breakMinutes);
    return diff < 0 ? 0 : diff;
  }

  function shiftsInRange(from, to) {
    const f = toISODate(from);
    const t = toISODate(to);
    return state.shifts.filter(function (s) { return s.date >= f && s.date <= t; });
  }

  function sumDuration(list) {
    return list.reduce(function (acc, s) { return acc + (s.durationMinutes || 0); }, 0);
  }

  function getLastShift() {
    if (!state.shifts.length) return null;
    const sorted = state.shifts.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return sorted[0];
  }

  function computeStreak() {
    if (!state.shifts.length) return 0;
    const dates = [];
    const seen = {};
    state.shifts.forEach(function (s) {
      if (!seen[s.date]) { seen[s.date] = true; dates.push(s.date); }
    });
    dates.sort().reverse();
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
    let start = null;
    if (dates[0] === toISODate(today)) start = today;
    else if (dates[0] === toISODate(yesterday)) start = yesterday;
    else return 0;
    let streak = 0;
    const cursor = new Date(start);
    const set = {};
    dates.forEach(function (d) { set[d] = true; });
    while (set[toISODate(cursor)]) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function getGreeting() {
    const h = new Date().getHours();
    if (h < 5) return 'Доброй ночи';
    if (h < 12) return 'Доброе утро';
    if (h < 17) return 'Добрый день';
    return 'Добрый вечер';
  }

  // ============ SAFE SET HELPERS ============
  function setText(sel, val) {
    const el = $(sel);
    if (el) el.textContent = val;
  }
  function setHTML(sel, val) {
    const el = $(sel);
    if (el) el.innerHTML = val;
  }
  function setValue(sel, val) {
    const el = $(sel);
    if (el) el.value = val;
  }

  // ============ TOAST ============
  let toastTimeout = null;
  function showToast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = msg;
    t.hidden = false;
    requestAnimationFrame(function () { t.classList.add('show'); });
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { t.hidden = true; }, 300);
    }, 2200);
  }

  // ============ MODAL ============
  function openModal(opts) {
    opts = opts || {};
    const backdrop = $('#modalBackdrop');
    const cancelBtn = $('#modalCancel');
    const confirmBtn = $('#modalConfirm');
    if (!backdrop || !cancelBtn || !confirmBtn) return;

    // Снимаем старые обработчики
    if (state.modalHandler) {
      cancelBtn.removeEventListener('click', state.modalHandler.onCancel);
      confirmBtn.removeEventListener('click', state.modalHandler.onConfirm);
      backdrop.removeEventListener('click', state.modalHandler.onBackdrop);
      document.removeEventListener('keydown', state.modalHandler.onEsc);
      state.modalHandler = null;
    }

    setText('#modalTitle', opts.title || 'Подтверждение');
    setText('#modalText', opts.text || '');
    cancelBtn.textContent = opts.cancelText || 'Отмена';
    confirmBtn.textContent = opts.confirmText || 'Удалить';

    function close() {
      backdrop.hidden = true;
      if (state.modalHandler) {
        cancelBtn.removeEventListener('click', state.modalHandler.onCancel);
        confirmBtn.removeEventListener('click', state.modalHandler.onConfirm);
        backdrop.removeEventListener('click', state.modalHandler.onBackdrop);
        document.removeEventListener('keydown', state.modalHandler.onEsc);
        state.modalHandler = null;
      }
    }

    const onCancel = function (e) { e.preventDefault(); e.stopPropagation(); close(); };
    const onConfirm = function (e) {
      e.preventDefault(); e.stopPropagation();
      close();
      if (typeof opts.onConfirm === 'function') {
        try { opts.onConfirm(); } catch (err) { console.error(err); }
      }
    };
    const onBackdrop = function (e) { if (e.target === backdrop) close(); };
    const onEsc = function (e) { if (e.key === 'Escape') close(); };

    state.modalHandler = { onCancel: onCancel, onConfirm: onConfirm, onBackdrop: onBackdrop, onEsc: onEsc };

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    backdrop.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onEsc);

    backdrop.hidden = false;
  }

  // ============ LIVE TIMER ============
  function startLiveTimer() {
    if (state.timerInterval) return;
    const tick = function () {
      const el = $('#liveTimer');
      if (!el || !state.active || !state.active.startTimeISO) return;
      const start = new Date(state.active.startTimeISO);
      const diffMs = Date.now() - start.getTime();
      const totalSec = Math.max(0, Math.floor(diffMs / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      el.textContent = pad(h) + ':' + pad(m) + ':' + pad(s);
    };
    tick();
    state.timerInterval = setInterval(tick, 1000);
  }

  function stopLiveTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  // ============ START / STOP SHIFT ============
  function startShift() {
    const now = new Date();
    state.active = {
      id: uid(),
      date: toISODate(now),
      startTime: pad(now.getHours()) + ':' + pad(now.getMinutes()),
      startTimeISO: now.toISOString(),
      status: 'active',
      createdAt: Date.now(),
    };
    Storage.saveActive();
    showToast('Смена началась. Хорошей работы!');
    renderHome();
  }

  function stopShift() {
    if (!state.active) return;
    const now = new Date();
    const endTime = pad(now.getHours()) + ':' + pad(now.getMinutes());
    const duration = calcShiftDuration(state.active.startTime, endTime, 0);
    const shift = {
      id: state.active.id,
      date: state.active.date,
      startTime: state.active.startTime,
      endTime: endTime,
      breakMinutes: 0,
      durationMinutes: duration,
      comment: '',
      status: 'completed',
      createdAt: state.active.createdAt || Date.now(),
    };
    state.shifts.push(shift);
    state.active = null;
    Storage.saveShifts();
    Storage.saveActive();
    stopLiveTimer();
    showToast('Смена завершена и сохранена');
    renderHome();
    if (state.currentTab === 'history') renderHistory();
    if (state.currentTab === 'stats') renderStats();
  }

  // ============ SHIFT CARD HTML ============
  function shiftCardHTML(shift, opts) {
    opts = opts || {};
    const date = parseISODate(shift.date);
    const weekday = date ? WEEKDAYS_RU[date.getDay()] : '';
    const dayLabel = date ? (date.getDate() + ' ' + MONTHS_RU_GEN[date.getMonth()]) : shift.date;
    const fmt = state.settings.timeFormat;
    const today = date && isSameDay(date, new Date());
    const yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterday = date && isSameDay(date, yesterdayDate);
    const statusText = today ? 'Сегодня' : yesterday ? 'Вчера' : '';
    const statusClass = today ? 'today' : '';

    const actions = opts.showActions !== false ? (
      '<div class="shift-actions">' +
        '<button type="button" data-action="edit" data-id="' + shift.id + '">Редактировать</button>' +
        '<button type="button" data-action="delete" data-id="' + shift.id + '" class="btn-del">Удалить</button>' +
      '</div>'
    ) : '';

    return (
      '<div class="shift-card" data-id="' + shift.id + '">' +
        '<div class="shift-date-row">' +
          '<div>' +
            '<div class="shift-date">' + dayLabel + '</div>' +
            '<div class="shift-weekday">' + weekday + '</div>' +
          '</div>' +
          (statusText ? '<span class="shift-status-pill ' + statusClass + '">' + statusText + '</span>' : '') +
        '</div>' +
        '<div class="shift-time-row">' +
          '<span class="shift-time">' + formatTimeDisplay(shift.startTime, fmt) + '</span>' +
          '<span class="shift-arrow">→</span>' +
          '<span class="shift-time">' + formatTimeDisplay(shift.endTime, fmt) + '</span>' +
        '</div>' +
        '<div class="shift-duration-row">' +
          '<span class="shift-duration-label">Рабочее время</span>' +
          '<span class="shift-duration">' + formatDuration(shift.durationMinutes) + '</span>' +
        '</div>' +
        (shift.breakMinutes ? '<div class="shift-comment">Перерыв: ' + formatDuration(shift.breakMinutes) + '</div>' : '') +
        (shift.comment ? '<div class="shift-comment">' + escapeHtml(shift.comment) + '</div>' : '') +
        actions +
      '</div>'
    );
  }

  // ============ RENDER: HOME ============
  function renderHome() {
    setText('#greeting', getGreeting());

    const card = $('#statusCard');
    const badge = $('#statusText');
    const body = $('#statusBody');
    if (!card || !badge || !body) return;

    const fmt = state.settings.timeFormat;

    if (state.active) {
      card.classList.add('active');
      card.classList.remove('idle');
      badge.textContent = 'На смене';
      const startTime = state.active.startTime || '--:--';
      body.innerHTML =
        '<div class="timer-display" id="liveTimer">00:00:00</div>' +
        '<p class="status-start">Начало: <strong>' + formatTimeDisplay(startTime, fmt) + '</strong></p>' +
        '<button type="button" class="btn-primary stop" id="stopShiftBtn">Завершить смену</button>';
      const stopBtn = $('#stopShiftBtn');
      if (stopBtn) stopBtn.addEventListener('click', stopShift);
      startLiveTimer();
    } else {
      card.classList.remove('active');
      card.classList.add('idle');
      badge.textContent = 'Статус';
      body.innerHTML =
        '<div class="status-idle-text">Не на смене</div>' +
        '<p class="status-idle-sub">Начни смену, когда будешь готов</p>' +
        '<button type="button" class="btn-primary" id="startShiftBtn">Начать смену</button>';
      const startBtn = $('#startShiftBtn');
      if (startBtn) startBtn.addEventListener('click', startShift);
      stopLiveTimer();
    }

    const now = new Date();
    const monthShifts = shiftsInRange(startOfMonth(now), endOfMonth(now));
    const monthMinutes = sumDuration(monthShifts);

    setText('#qsShifts', monthShifts.length);
    setText('#qsHours', formatDuration(monthMinutes));
    setText('#qsAvg', monthShifts.length ? formatDuration(Math.round(monthMinutes / monthShifts.length)) : '—');
    setText('#qsTotal', state.shifts.length);

    setText('#monthName', MONTHS_RU[now.getMonth()].toUpperCase() + ' ' + now.getFullYear());
    setText('#monthShifts', monthShifts.length);
    setText('#monthHours', formatHoursLabel(monthMinutes));
    setText('#monthAvg', monthShifts.length ? formatHoursLabel(Math.round(monthMinutes / monthShifts.length)) : '—');

    const target = state.settings.targetHours || 0;
    setText('#monthTarget', target + 'ч');
    const percent = target > 0 ? Math.min(100, (monthMinutes / 60) / target * 100) : 0;
    const fill = $('#monthProgress');
    if (fill) {
      fill.style.width = percent + '%';
      if (target > 0 && monthMinutes / 60 >= target) fill.classList.add('done');
      else fill.classList.remove('done');
    }
    setText('#progressText', Math.floor(monthMinutes / 60) + ' / ' + target + ' часов');
    setText('#progressPercent', percent.toFixed(0) + '%');

    const last = getLastShift();
    const wrap = $('#lastShiftWrap');
    if (wrap) {
      if (!last) {
        wrap.innerHTML =
          '<div class="empty-state">' +
            '<div class="empty-emoji">📋</div>' +
            '<p class="empty-title">Смен пока нет</p>' +
            '<p class="empty-sub">Добавь первую смену, чтобы начать вести статистику</p>' +
          '</div>';
      } else {
        wrap.innerHTML = shiftCardHTML(last, { showActions: false });
      }
    }

    const streak = computeStreak();
    setText('#streakValue', streak > 0 ? streak + ' ' + pluralize(streak, 'смена', 'смены', 'смен') + ' подряд' : 'Нет активной серии');
    setText('#streakLabel', streak > 0 ? 'Отличный темп!' : 'Начни смену, чтобы продолжить');
  }

  // ============ FORM ============
  function updateDurationPreview() {
    const s = $('#fStart') ? $('#fStart').value : '';
    const e = $('#fEnd') ? $('#fEnd').value : '';
    const br = $('#fBreak') ? ($('#fBreak').value || '00:00') : '00:00';
    const prev = $('#durationPreview');
    if (!prev) return;
    if (!s || !e) { prev.textContent = '0ч 00м'; return; }
    const breakMin = toMinutes(br) || 0;
    prev.textContent = formatDuration(calcShiftDuration(s, e, breakMin));
  }

  function showFormError(msg) {
    const el = $('#formError');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
  }

  function hideFormError() {
    const el = $('#formError');
    if (el) el.hidden = true;
  }

  function submitShiftForm(e) {
    if (e) e.preventDefault();
    hideFormError();

    const dateEl = $('#fDate');
    const startEl = $('#fStart');
    const endEl = $('#fEnd');
    const brEl = $('#fBreak');
    const commentEl = $('#fComment');
    const editIdEl = $('#editId');

    if (!dateEl || !startEl || !endEl) return;

    const date = dateEl.value;
    const start = startEl.value;
    const end = endEl.value;
    const br = (brEl && brEl.value) ? brEl.value : '00:00';
    const comment = (commentEl && commentEl.value) ? commentEl.value.trim() : '';
    const editId = editIdEl ? editIdEl.value : '';

    if (!date) { showFormError('Укажите дату смены'); return; }
    if (!start) { showFormError('Укажите время начала'); return; }
    if (!end) { showFormError('Укажите время окончания'); return; }

    const breakMin = toMinutes(br);
    if (Number.isNaN(breakMin) || breakMin < 0) { showFormError('Некорректный перерыв'); return; }
    if (breakMin >= 24 * 60) { showFormError('Перерыв слишком большой'); return; }

    const sMin = toMinutes(start);
    const eMin = toMinutes(end);
    let rawSpan = eMin - sMin;
    if (rawSpan <= 0) rawSpan += 24 * 60;

    if (breakMin >= rawSpan) {
      showFormError('Перерыв больше или равен длительности смены');
      return;
    }

    const dur = calcShiftDuration(start, end, breakMin);

    if (editId) {
      for (let i = 0; i < state.shifts.length; i++) {
        if (state.shifts[i].id === editId) {
          state.shifts[i].date = date;
          state.shifts[i].startTime = start;
          state.shifts[i].endTime = end;
          state.shifts[i].breakMinutes = breakMin;
          state.shifts[i].durationMinutes = dur;
          state.shifts[i].comment = comment;
          break;
        }
      }
      Storage.saveShifts();
      showToast('Смена обновлена');
    } else {
      state.shifts.push({
        id: uid(),
        date: date, startTime: start, endTime: end,
        breakMinutes: breakMin, durationMinutes: dur, comment: comment,
        status: 'completed',
        createdAt: Date.now(),
      });
      Storage.saveShifts();
      showToast('Смена сохранена');
    }

    resetForm();
    renderAll();
    switchTab('history');
  }

  function resetForm() {
    setValue('#editId', '');
    const form = $('#shiftForm');
    if (form) form.reset();
    setValue('#fDate', toISODate(new Date()));
    setValue('#fStart', '');
    setValue('#fEnd', '');
    setValue('#fBreak', '00:00');
    setValue('#fComment', '');
    setText('#durationPreview', '0ч 00м');
    setText('#saveShiftBtnLabel', 'Сохранить смену');
    const cancel = $('#cancelEditBtn');
    if (cancel) cancel.hidden = true;
    hideFormError();
  }

  function editShift(id) {
    let s = null;
    for (let i = 0; i < state.shifts.length; i++) {
      if (state.shifts[i].id === id) { s = state.shifts[i]; break; }
    }
    if (!s) return;
    setValue('#editId', s.id);
    setValue('#fDate', s.date);
    setValue('#fStart', s.startTime);
    setValue('#fEnd', s.endTime);
    setValue('#fBreak', minutesToHHMM(s.breakMinutes || 0));
    setValue('#fComment', s.comment || '');
    setText('#saveShiftBtnLabel', 'Сохранить изменения');
    const cancel = $('#cancelEditBtn');
    if (cancel) cancel.hidden = false;
    updateDurationPreview();
    switchTab('add');
  }

  function confirmDeleteShift(id) {
    openModal({
      title: 'Удалить эту смену?',
      text: 'Это действие нельзя отменить. Смена будет удалена из истории.',
      confirmText: 'Удалить',
      onConfirm: function () {
        state.shifts = state.shifts.filter(function (s) { return s.id !== id; });
        Storage.saveShifts();
        showToast('Смена удалена');
        renderAll();
      }
    });
  }

  // ============ STATS ============
  function getPeriodRange(period) {
    const now = new Date();
    if (period === 'week') return [startOfWeek(now, state.settings.weekStart), endOfWeek(now, state.settings.weekStart)];
    if (period === 'month') return [startOfMonth(now), endOfMonth(now)];
    if (period === 'year') return [new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999)];
    return [new Date(0), new Date(9999, 11, 31)];
  }

  function renderStats() {
    const range = getPeriodRange(state.statsPeriod);
    const list = shiftsInRange(range[0], range[1]);
    const total = sumDuration(list);

    setText('#stShifts', list.length);
    setText('#stHours', formatHoursLabel(total));

    if (!list.length) {
      setText('#stAvg', '—');
      setText('#stMax', '—');
      setText('#stMin', '—');
      setText('#stWeekAvg', '—');
    } else {
      const avg = Math.round(total / list.length);
      let max = 0, min = Infinity;
      list.forEach(function (s) {
        const d = s.durationMinutes || 0;
        if (d > max) max = d;
        if (d < min) min = d;
      });
      setText('#stAvg', formatDuration(avg));
      setText('#stMax', formatDuration(max));
      setText('#stMin', formatDuration(min));
      const weeks = Math.max(1, Math.ceil((range[1] - range[0]) / (7 * 24 * 60 * 60 * 1000)));
      setText('#stWeekAvg', formatDuration(Math.round(total / weeks)));
    }

    renderHoursChart(list, range[0], range[1]);
    renderMonthsChart();
    renderMonthsList();
  }

  function chartColors() {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return {
      text: isLight ? '#52596A' : '#A0A6B2',
      grid: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
      bar: 'rgba(139,92,246,0.85)',
      barHover: '#6366F1',
    };
  }

  function renderHoursChart(list, from, to) {
    const canvas = $('#hoursChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const col = chartColors();
    const labels = [];
    const values = [];

    if (state.statsPeriod === 'year') {
      const perMonth = new Array(12).fill(0);
      list.forEach(function (s) {
        const d = parseISODate(s.date);
        if (d) perMonth[d.getMonth()] += s.durationMinutes || 0;
      });
      MONTHS_RU.forEach(function (m, i) {
        labels.push(m.slice(0, 3));
        values.push(+(perMonth[i] / 60).toFixed(2));
      });
    } else {
      const cursor = new Date(from);
      cursor.setHours(0, 0, 0, 0);
      const end = new Date(to);
      while (cursor <= end) {
        const iso = toISODate(cursor);
        let dayMin = 0;
        list.forEach(function (s) { if (s.date === iso) dayMin += s.durationMinutes || 0; });
        labels.push(pad(cursor.getDate()) + '.' + pad(cursor.getMonth() + 1));
        values.push(+(dayMin / 60).toFixed(2));
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    if (state.charts.hours) { try { state.charts.hours.destroy(); } catch (e) {} state.charts.hours = null; }
    try {
      state.charts.hours = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: labels,
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
              callbacks: { label: function (ctx) { return ctx.parsed.y + ' ч'; } },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: col.text, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } },
            y: { grid: { color: col.grid }, border: { display: false }, ticks: { color: col.text, font: { size: 11 }, callback: function (v) { return v + 'ч'; } }, beginAtZero: true },
          },
        },
      });
    } catch (e) { console.warn('Chart error:', e); }
  }

  function renderMonthsChart() {
    const canvas = $('#monthsChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const col = chartColors();

    const now = new Date();
    const months = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        y: d.getFullYear(), m: d.getMonth(),
        label: MONTHS_RU[d.getMonth()].slice(0, 3) + ' ' + String(d.getFullYear()).slice(2),
        mins: 0,
      });
    }
    state.shifts.forEach(function (s) {
      const d = parseISODate(s.date);
      if (!d) return;
      for (let i = 0; i < months.length; i++) {
        if (months[i].y === d.getFullYear() && months[i].m === d.getMonth()) {
          months[i].mins += s.durationMinutes || 0;
          break;
        }
      }
    });

    if (state.charts.months) { try { state.charts.months.destroy(); } catch (e) {} state.charts.months = null; }
    try {
      state.charts.months = new Chart(canvas, {
        type: 'line',
        data: {
          labels: months.map(function (m) { return m.label; }),
          datasets: [{
            label: 'Часы',
            data: months.map(function (m) { return +(m.mins / 60).toFixed(1); }),
            borderColor: '#8B5CF6',
            backgroundColor: function (ctx) {
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
              callbacks: { label: function (ctx) { return ctx.parsed.y + ' ч'; } },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: col.text, font: { size: 10 } } },
            y: { grid: { color: col.grid }, border: { display: false }, ticks: { color: col.text, font: { size: 11 }, callback: function (v) { return v + 'ч'; } }, beginAtZero: true },
          },
        },
      });
    } catch (e) { console.warn('Chart error:', e); }
  }

  function renderMonthsList() {
    const wrap = $('#monthsList');
    if (!wrap) return;
    const map = {};
    state.shifts.forEach(function (s) {
      const d = parseISODate(s.date);
      if (!d) return;
      const key = d.getFullYear() + '-' + pad(d.getMonth() + 1);
      if (!map[key]) map[key] = { y: d.getFullYear(), m: d.getMonth(), shifts: 0, mins: 0 };
      map[key].shifts++;
      map[key].mins += s.durationMinutes || 0;
    });
    const sorted = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) {
      return (b.y - a.y) || (b.m - a.m);
    });

    if (!sorted.length) {
      wrap.innerHTML = '<div class="empty-state">' +
        '<div class="empty-emoji">📊</div>' +
        '<p class="empty-title">Пока нет данных по месяцам</p>' +
        '<p class="empty-sub">Добавь смены, чтобы увидеть статистику</p>' +
      '</div>';
      return;
    }

    wrap.innerHTML = sorted.map(function (item) {
      return '<div class="month-item">' +
        '<div>' +
          '<div class="month-item-name">' + MONTHS_RU[item.m] + ' ' + item.y + '</div>' +
          '<div class="month-item-shifts">' + item.shifts + ' ' + pluralize(item.shifts, 'смена', 'смены', 'смен') + '</div>' +
        '</div>' +
        '<div class="month-item-hours">' + formatHoursLabel(item.mins) + '</div>' +
      '</div>';
    }).join('');
  }

  // ============ HISTORY ============
  function getHistoryRange() {
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
      if (from) from.setHours(0, 0, 0, 0);
      if (to) to.setHours(23, 59, 59, 999);
      return [from, to];
    }
    return [new Date(0), new Date(9999, 11, 31)];
  }

  function renderHistory() {
    const range = getHistoryRange();
    const list = shiftsInRange(range[0], range[1]).sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });

    const totalMin = sumDuration(list);
    setText('#historySummary', list.length
      ? list.length + ' ' + pluralize(list.length, 'смена', 'смены', 'смен') + ' · ' + formatHoursLabel(totalMin)
      : '');

    const wrap = $('#historyList');
    if (!wrap) return;

    if (!list.length) {
      wrap.innerHTML = '<div class="empty-state">' +
        '<div class="empty-emoji">🗓️</div>' +
        '<p class="empty-title">История пока пуста</p>' +
        '<p class="empty-sub">Добавь первую смену и начни собирать свою рабочую статистику.</p>' +
        '<button type="button" class="btn-primary" id="emptyAddBtn">+ Добавить смену</button>' +
      '</div>';
      const b = $('#emptyAddBtn');
      if (b) b.addEventListener('click', function () { switchTab('add'); });
      return;
    }

    wrap.innerHTML = list.map(function (s) { return shiftCardHTML(s); }).join('');
  }

  // ============ SETTINGS ============
  function resolveTheme() {
    const t = state.settings.theme;
    if (t === 'system') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return t;
  }

  function applySettings() {
    document.documentElement.setAttribute('data-theme', resolveTheme());
    setValue('#sAppName', state.settings.appName);
    setValue('#sTarget', state.settings.targetHours);
    setValue('#sWeekStart', String(state.settings.weekStart));
    setValue('#sTimeFormat', String(state.settings.timeFormat));
    setValue('#sTheme', state.settings.theme);
    document.title = state.settings.appName;
  }

  // ============ EXPORT / IMPORT ============
  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportJSON() {
    const payload = {
      app: 'ShiftPulse',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      shifts: state.shifts,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile('shiftpulse_' + stamp + '.json', JSON.stringify(payload, null, 2), 'application/json');
    showToast('Экспорт JSON готов');
  }

  function csvEscape(val) {
    const s = String(val == null ? '' : val);
    if (/[",\n;]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV() {
    const fmt = state.settings.timeFormat;
    const header = ['Дата', 'Начало', 'Конец', 'Перерыв', 'Рабочие часы', 'Комментарий'];
    const sorted = state.shifts.slice().sort(function (a, b) {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    });
    const rows = sorted.map(function (s) {
      return [
        s.date,
        formatTimeDisplay(s.startTime, fmt),
        formatTimeDisplay(s.endTime, fmt),
        formatDuration(s.breakMinutes || 0),
        formatHoursLabel(s.durationMinutes),
        s.comment || '',
      ].map(csvEscape).join(',');
    });
    const csv = '\uFEFF' + [header.join(',')].concat(rows).join('\n');
    const stamp = new Date().toISOString().slice(0, 10);
    downloadFile('shifts_' + stamp + '.csv', csv, 'text/csv;charset=utf-8');
    showToast('Экспорт CSV готов');
  }

  function normalizeImportedShift(raw) {
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
      date: date, startTime: startTime, endTime: endTime,
      breakMinutes: breakMinutes, durationMinutes: durationMinutes,
      comment: raw.comment || '',
      status: raw.status || 'completed',
      createdAt: raw.createdAt || Date.now(),
    };
  }

  function handleImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function (ev) {
      let data;
      try { data = JSON.parse(ev.target.result); }
      catch (err) { showToast('Некорректный JSON файл'); e.target.value = ''; return; }

      const incoming = Array.isArray(data.shifts) ? data.shifts : (Array.isArray(data) ? data : []);
      if (!incoming.length) { showToast('Файл не содержит смен'); e.target.value = ''; return; }

      openModal({
        title: 'Импортировать данные?',
        text: 'Найдено ' + incoming.length + ' ' + pluralize(incoming.length, 'смена', 'смены', 'смен') + '. Существующие данные будут сохранены.',
        confirmText: 'Импортировать',
        onConfirm: function () {
          const existingIds = {};
          state.shifts.forEach(function (s) { existingIds[s.id] = true; });
          const normalized = incoming
            .map(normalizeImportedShift)
            .filter(function (s) { return s && !existingIds[s.id]; });
          state.shifts = state.shifts.concat(normalized);
          Storage.saveShifts();
          if (data.settings && typeof data.settings === 'object') {
            state.settings = Object.assign({}, state.settings, data.settings);
            Storage.saveSettings();
            applySettings();
          }
          showToast('Импортировано ' + normalized.length + ' смен');
          renderAll();
        },
      });
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  // ============ NAVIGATION ============
  function switchTab(tab) {
    state.currentTab = tab;
    $$('.tab').forEach(function (el) {
      el.hidden = el.getAttribute('data-tab') !== tab;
    });
    $$('.nav-btn').forEach(function (btn) {
      if (btn.getAttribute('data-tab') === tab) btn.classList.add('active');
      else btn.classList.remove('active');
    });
    if (tab === 'home') renderHome();
    else if (tab === 'stats') renderStats();
    else if (tab === 'history') renderHistory();
    else if (tab === 'add') {
      setTimeout(function () {
        const el = $('#fStart');
        if (el && !el.value) { try { el.focus(); } catch (e) {} }
      }, 50);
    }
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, 0); }
  }

  // ============ SETUP: EVENT DELEGATION ============
  // Единый делегированный обработчик для ВСЕХ кликов.
  // Работает даже если что-то в init упало.
  function setupGlobalClickHandler() {
    document.addEventListener('click', function (e) {
      const target = e.target;

      // Навигация (любой .nav-btn с data-tab)
      const navBtn = target.closest && target.closest('.nav-btn[data-tab]');
      if (navBtn) {
        e.preventDefault();
        switchTab(navBtn.getAttribute('data-tab'));
        return;
      }

      // Тема
      if (target.closest && target.closest('#themeQuickToggle')) {
        e.preventDefault();
        const cur = resolveTheme();
        state.settings.theme = cur === 'dark' ? 'light' : 'dark';
        Storage.saveSettings();
        applySettings();
        renderAll();
        return;
      }

      // Действия с карточкой смены
      const actionBtn = target.closest && target.closest('[data-action]');
      if (actionBtn) {
        e.preventDefault();
        e.stopPropagation();
        const action = actionBtn.getAttribute('data-action');
        const id = actionBtn.getAttribute('data-id');
        if (action === 'edit') editShift(id);
        else if (action === 'delete') confirmDeleteShift(id);
        return;
      }
    });
  }

  function setupFormListeners() {
    const dateEl = $('#fDate');
    const startEl = $('#fStart');
    const endEl = $('#fEnd');
    const breakEl = $('#fBreak');
    [dateEl, startEl, endEl, breakEl].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', updateDurationPreview);
      el.addEventListener('change', updateDurationPreview);
    });

    const form = $('#shiftForm');
    if (form) form.addEventListener('submit', submitShiftForm);

    const cancel = $('#cancelEditBtn');
    if (cancel) cancel.addEventListener('click', function (e) { e.preventDefault(); resetForm(); });
  }

  function setupSettingsListeners() {
    const appName = $('#sAppName');
    if (appName) appName.addEventListener('change', function (e) {
      state.settings.appName = e.target.value.trim() || 'ShiftPulse';
      Storage.saveSettings();
      applySettings();
    });

    const target = $('#sTarget');
    if (target) target.addEventListener('change', function (e) {
      const v = Math.max(0, Math.min(400, Number(e.target.value) || 0));
      state.settings.targetHours = v;
      e.target.value = v;
      Storage.saveSettings();
      renderHome();
    });

    const weekStart = $('#sWeekStart');
    if (weekStart) weekStart.addEventListener('change', function (e) {
      state.settings.weekStart = Number(e.target.value);
      Storage.saveSettings();
      renderAll();
    });

    const timeFormat = $('#sTimeFormat');
    if (timeFormat) timeFormat.addEventListener('change', function (e) {
      state.settings.timeFormat = Number(e.target.value);
      Storage.saveSettings();
      renderAll();
    });

    const theme = $('#sTheme');
    if (theme) theme.addEventListener('change', function (e) {
      state.settings.theme = e.target.value;
      Storage.saveSettings();
      applySettings();
      renderAll();
    });

    const exportJson = $('#exportJson');
    if (exportJson) exportJson.addEventListener('click', exportJSON);

    const exportCsv = $('#exportCsv');
    if (exportCsv) exportCsv.addEventListener('click', exportCSV);

    const importFile = $('#importFile');
    if (importFile) importFile.addEventListener('change', handleImport);

    const wipe = $('#wipeData');
    if (wipe) wipe.addEventListener('click', function () {
      openModal({
        title: 'Удалить все данные?',
        text: 'Все смены и настройки будут удалены безвозвратно. Рекомендуем сначала сделать экспорт.',
        confirmText: 'Удалить всё',
        onConfirm: function () {
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

    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () {
        if (state.settings.theme === 'system') {
          applySettings();
          renderAll();
        }
      });
    }
  }

  function setupStatsPeriod() {
    $$('#statsPeriod button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('#statsPeriod button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.statsPeriod = btn.getAttribute('data-period');
        renderStats();
      });
    });
  }

  function setupHistoryFilter() {
    const sel = $('#historyFilter');
    if (sel) sel.addEventListener('change', function (e) {
      state.historyFilter = e.target.value;
      const custom = state.historyFilter === 'custom';
      const cr = $('#customRange');
      if (cr) cr.hidden = !custom;
      if (custom) {
        const now = new Date();
        const fromEl = $('#rangeFrom');
        const toEl = $('#rangeTo');
        if (fromEl) {
          fromEl.value = state.customRange.from || toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
          state.customRange.from = fromEl.value;
        }
        if (toEl) {
          toEl.value = state.customRange.to || toISODate(now);
          state.customRange.to = toEl.value;
        }
      }
      renderHistory();
    });

    const fromEl = $('#rangeFrom');
    if (fromEl) fromEl.addEventListener('change', function (e) {
      state.customRange.from = e.target.value;
      renderHistory();
    });
    const toEl = $('#rangeTo');
    if (toEl) toEl.addEventListener('change', function (e) {
      state.customRange.to = e.target.value;
      renderHistory();
    });
  }

  // ============ RENDER ALL ============
  function renderAll() {
    renderHome();
    if (state.currentTab === 'stats') renderStats();
    if (state.currentTab === 'history') renderHistory();
  }

  // ============ PWA ============
  function registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () {});
      });
    }
  }

  // ============ INIT ============
  function init() {
    // 1. Скрыть оверлеи
    const backdrop = $('#modalBackdrop');
    const toast = $('#toast');
    if (backdrop) backdrop.hidden = true;
    if (toast) toast.hidden = true;

    // 2. Глобальные обработчики (работают всегда)
    setupGlobalClickHandler();

    // 3. Загрузка данных
    try { Storage.load(); } catch (e) { console.error('Storage load failed', e); }

    // 4. Настройки и UI
    try { applySettings(); } catch (e) { console.error('applySettings failed', e); }
    try { setupFormListeners(); } catch (e) { console.error('form listeners failed', e); }
    try { setupSettingsListeners(); } catch (e) { console.error('settings listeners failed', e); }
    try { setupStatsPeriod(); } catch (e) { console.error('stats period failed', e); }
    try { setupHistoryFilter(); } catch (e) { console.error('history filter failed', e); }
    try { resetForm(); } catch (e) { console.error('resetForm failed', e); }

    // 5. Отрисовка
    try { renderAll(); } catch (e) { console.error('renderAll failed', e); }

    // 6. PWA
    try { registerSW(); } catch (e) {}

    // 7. Авто-обновление "сегодня" раз в минуту
    setInterval(function () {
      if (state.currentTab === 'home') {
        try { renderHome(); } catch (e) {}
      }
    }, 60 * 1000);
  }

  // ============ ЗАПУСК ============
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Экспортируем для отладки
  window.__shiftpulse = { state: state, renderAll: renderAll, switchTab: switchTab };
})();
