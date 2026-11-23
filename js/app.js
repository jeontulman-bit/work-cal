import * as db from './db.js';
import { parseMessage, buildProtocol, selfTest } from './parser.js';
import { fetchMessages, publishMessage, DEFAULT_SERVER } from './ntfy.js';
import { resolveDayDisplay, getPatternWorkType } from './patterns.js';

// ---------- State ----------
const state = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth() + 1, // 1-12
  topic: '',
  daysCache: new Map(), // date -> dayRecord
  patterns: [],
  view: 'calendar',
  leaveDraft: [],
  adminType: 'work',
  lastSyncAt: 0,
  syncIntervalId: null
};

// ---------- Utils ----------
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return document.querySelectorAll(sel); }

function toast(msg, ms = 2500) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(el._tid);
  el._tid = setTimeout(() => el.classList.add('hidden'), ms);
}

function pad(n) { return String(n).padStart(2, '0'); }

function formatMonthLabel(y, m) {
  return `${y}년 ${m}월`;
}

function getMonthDays(year, month) {
  // returns array of { dateStr, day, weekday, otherMonth }
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);
  const startWeekday = first.getDay(); // 0=Sun
  const daysInMonth = last.getDate();

  const cells = [];
  // prev month fillers
  const prevLast = new Date(year, month - 1, 0).getDate();
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = prevLast - i;
    const m = month === 1 ? 12 : month - 1;
    const y = month === 1 ? year - 1 : year;
    cells.push({ dateStr: `${y}-${pad(m)}-${pad(d)}`, day: d, weekday: (startWeekday - 1 - i + 7) % 7, otherMonth: true });
  }
  // current
  for (let d = 1; d <= daysInMonth; d++) {
    const wd = (startWeekday + d - 1) % 7;
    cells.push({ dateStr: `${year}-${pad(month)}-${pad(d)}`, day: d, weekday: wd, otherMonth: false });
  }
  // next fillers to fill 6 weeks max
  let nextD = 1;
  while (cells.length % 7 !== 0 || cells.length < 35) {
    const m = month === 12 ? 1 : month + 1;
    const y = month === 12 ? year + 1 : year;
    cells.push({ dateStr: `${y}-${pad(m)}-${pad(nextD)}`, day: nextD, weekday: cells.length % 7, otherMonth: true });
    nextD++;
    if (cells.length >= 42) break;
  }
  return cells;
}

// ---------- Render Calendar ----------
async function renderCalendar() {
  $('#current-month-label').textContent = formatMonthLabel(state.currentYear, state.currentMonth);
  const ym = `${state.currentYear}-${pad(state.currentMonth)}`;
  const days = await db.getDaysByMonth(ym, state.topic);
  state.daysCache.clear();
  for (const d of days) state.daysCache.set(d.date, d);

  const cells = getMonthDays(state.currentYear, state.currentMonth);
  const todayStr = new Date().toISOString().slice(0, 10);
  const grid = $('#calendar-grid');
  grid.innerHTML = '';

  for (const cell of cells) {
    const record = state.daysCache.get(cell.dateStr);
    const { workType, leaveList } = resolveDayDisplay(record, cell.dateStr, state.patterns);

    const div = document.createElement('div');
    div.className = 'day-cell';
    if (cell.otherMonth) div.classList.add('other-month');
    if (cell.dateStr === todayStr) div.classList.add('today');
    if (workType || leaveList.length) div.classList.add('has-data');

    const numCls = cell.weekday === 0 ? 'sun' : cell.weekday === 6 ? 'sat' : '';
    let html = `<div class="day-num ${numCls}">${cell.day}</div>`;
    if (workType) html += `<div class="work-type">${workType}</div>`;
    for (const item of leaveList.slice(0, 4)) {
      html += `<div class="leave-item">${item}</div>`;
    }
    if (leaveList.length > 4) html += `<div class="leave-item">+${leaveList.length - 4}</div>`;
    div.innerHTML = html;
    div.addEventListener('click', () => openDayModal(cell.dateStr));
    grid.appendChild(div);
  }
}

// ---------- Day Modal ----------
async function openDayModal(dateStr) {
  const record = await db.getDay(dateStr) || state.daysCache.get(dateStr);
  const { workType, leaveList } = resolveDayDisplay(record, dateStr, state.patterns);
  const [y, m, d] = dateStr.split('-').map(Number);
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const wd = new Date(y, m - 1, d).getDay();

  $('#day-modal-title').textContent = `${y}년 ${m}월 ${d}일 (${weekdays[wd]})`;
  let body = '';
  body += `<p><strong>근무 종류:</strong> ${workType || '<span style="color:#94a3b8">미지정</span>'}</p>`;
  body += `<p style="margin-top:8px"><strong>연가/인원:</strong></p>`;
  if (leaveList.length) {
    body += '<ul style="margin:6px 0 0 16px">';
    for (const item of leaveList) body += `<li>${item}</li>`;
    body += '</ul>';
  } else {
    body += '<p style="color:#94a3b8;font-size:0.9rem">없음</p>';
  }
  if (record) {
    body += `<p style="margin-top:12px;font-size:0.8rem;color:#64748b">최종 갱신: ${new Date(record.updatedAt).toLocaleString('ko-KR')}</p>`;
  }
  $('#day-modal-body').innerHTML = body;
  $('#day-modal').classList.remove('hidden');
}

function closeDayModal() {
  $('#day-modal').classList.add('hidden');
}

// ---------- Sync ----------
async function syncNow(showToast = true) {
  if (!state.topic) {
    if (showToast) toast('토픽 값을 먼저 설정하세요');
    return;
  }
  try {
    // since=all : ntfy cached messages (deduped by id)
    const msgs = await fetchMessages(state.topic, { since: 'all' });
    let applied = 0;
    for (const msg of msgs) {
      const exists = await db.hasMessage(msg.id);
      if (exists) continue;

      const parsed = parseMessage(msg.message);
      const month = parsed.length ? parsed[0].month : new Date(msg.time * 1000).toISOString().slice(0, 7);

      await db.putMessage({
        id: msg.id,
        topic: state.topic,
        message: msg.message,
        receivedAt: (msg.time || Math.floor(Date.now() / 1000)) * 1000,
        month,
        parsed
      });

      for (const item of parsed) {
        let day = await db.getDay(item.date);
        if (!day) {
          day = {
            date: item.date,
            month: item.month,
            topic: state.topic,
            workType: null,
            leaveList: [],
            updatedAt: Date.now(),
            sourceMsgIds: []
          };
        }
        if (day.topic !== state.topic) {
          // different topic – skip or isolate
          continue;
        }
        if (item.type === 'work') {
          day.workType = item.value;
        } else if (item.type === 'leave') {
          // 빈 목록() → 초기화 / 값이 있으면 기존 목록에 병합(중복 제거)
          if (!item.value || item.value.length === 0) {
            day.leaveList = [];
          } else {
            const existing = Array.isArray(day.leaveList) ? day.leaveList : [];
            const merged = [...existing];
            for (const v of item.value) {
              if (v && !merged.includes(v)) merged.push(v);
            }
            day.leaveList = merged;
          }
        }
        day.updatedAt = Date.now();
        if (!day.sourceMsgIds.includes(msg.id)) day.sourceMsgIds.push(msg.id);
        await db.putDay(day);
        applied++;
      }
    }
    state.lastSyncAt = Date.now();
    await renderCalendar();
    if (showToast) toast(applied > 0 ? `동기화 완료 (${applied}건 반영)` : '동기화 완료 (새 데이터 없음)');
  } catch (err) {
    console.error(err);
    if (showToast) toast('동기화 실패: ' + (err.message || '네트워크 오류'));
  }
}

function startAutoSync() {
  if (state.syncIntervalId) clearInterval(state.syncIntervalId);
  state.syncIntervalId = setInterval(() => {
    if (document.visibilityState === 'visible') syncNow(false);
  }, 3600 * 1000); // 1 hour
}

// ---------- Views ----------
function switchView(view) {
  state.view = view;
  $all('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $('#history-view').classList.toggle('hidden', view !== 'history');
  $('#admin-view').classList.toggle('hidden', view !== 'admin');
  $('#settings-view').classList.toggle('hidden', view !== 'settings');
  // calendar is always under, panels overlay

  if (view === 'history') renderHistory();
  if (view === 'settings') loadSettingsUI();
  if (view === 'admin') loadAdminUI();
}

// ---------- History ----------
async function renderHistory() {
  const select = $('#history-month-select');
  // populate months from current -6 to +2
  const now = new Date();
  select.innerHTML = '';
  for (let i = -6; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const ym = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
    const opt = document.createElement('option');
    opt.value = ym;
    opt.textContent = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
    if (d.getFullYear() === state.currentYear && d.getMonth() + 1 === state.currentMonth) opt.selected = true;
    select.appendChild(opt);
  }

  const ym = select.value;
  const msgs = await db.getMessagesByMonth(ym, state.topic);
  const list = $('#history-list');
  list.innerHTML = '';
  if (!msgs.length) {
    list.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:24px">해당 월 수신 이력이 없습니다.</p>';
    return;
  }
  for (const msg of msgs) {
    const div = document.createElement('div');
    div.className = 'history-item';
    const time = new Date(msg.receivedAt).toLocaleString('ko-KR');
    div.innerHTML = `<div class="meta">${time} · ID ${msg.id.slice(0, 8)}…</div><div class="msg">${escapeHtml(msg.message)}</div>`;
    div.addEventListener('click', () => {
      // show current state of affected dates (not historical snapshot for simplicity)
      const dates = (msg.parsed || []).map(p => p.date);
      if (dates.length) {
        // jump calendar to first date
        const [y, m] = dates[0].split('-').map(Number);
        state.currentYear = y;
        state.currentMonth = m;
        switchView('calendar');
        renderCalendar().then(() => openDayModal(dates[0]));
      } else {
        toast('파싱된 날짜 없음');
      }
    });
    list.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ---------- Admin ----------
function loadAdminUI() {
  $('#admin-topic').value = state.topic || '';
  updateProtocolPreview();
}

function updateProtocolPreview() {
  const date = $('#admin-date').value.trim();
  let preview = '—';
  if (state.adminType === 'work') {
    const wt = $('#admin-work-type').value.trim();
    if (date && wt) preview = buildProtocol(date, 'work', wt);
  } else {
    if (date) preview = buildProtocol(date, 'leave', state.leaveDraft);
  }
  $('#protocol-preview').textContent = preview;
}

async function sendProtocol() {
  const topic = $('#admin-topic').value.trim() || state.topic;
  const body = $('#protocol-preview').textContent;
  if (!topic) { toast('토픽을 입력하세요'); return; }
  if (!body || body === '—') { toast('프로토콜을 완성하세요'); return; }
  const status = $('#admin-status');
  status.textContent = '발송 중…';
  status.className = 'status-msg';
  try {
    await publishMessage(topic, body);
    status.textContent = '발송 성공';
    status.className = 'status-msg success';
    toast('발송 완료');
    // remember topic
    if (topic !== state.topic) {
      // optional: don't auto change user topic
    }
    // append recent
    const recent = $('#recent-sends');
    const item = document.createElement('div');
    item.style.cssText = 'font-size:0.8rem;color:#64748b;margin-top:4px';
    item.textContent = `${new Date().toLocaleTimeString('ko-KR')} · ${body}`;
    recent.prepend(item);
  } catch (err) {
    status.textContent = '실패: ' + err.message;
    status.className = 'status-msg error';
    toast('발송 실패');
  }
}

async function sendMultiline() {
  const topic = $('#admin-topic').value.trim() || state.topic;
  const text = $('#admin-multiline').value.trim();
  if (!topic || !text) { toast('토픽과 내용을 입력하세요'); return; }
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const status = $('#admin-status');
  status.textContent = `발송 중 (0/${lines.length})…`;
  let ok = 0;
  for (let i = 0; i < lines.length; i++) {
    try {
      await publishMessage(topic, lines[i]);
      ok++;
      status.textContent = `발송 중 (${ok}/${lines.length})…`;
    } catch (err) {
      status.textContent = `일부 실패 (${ok}/${lines.length}): ${err.message}`;
      status.className = 'status-msg error';
      return;
    }
  }
  status.textContent = `일괄 발송 완료 (${ok}건)`;
  status.className = 'status-msg success';
  toast(`${ok}건 발송 완료`);
}

// ---------- Settings ----------
async function loadSettingsUI() {
  $('#setting-topic').value = state.topic || '';
  const active = state.patterns.find(p => p.active);
  const info = $('#active-pattern-info');
  if (active) {
    info.textContent = `활성: ${active.name} (${active.cycle.join(' → ')}) · 시작 ${active.startDate}`;
  } else {
    info.textContent = '활성 패턴 없음';
  }
}

async function saveTopic() {
  const topic = $('#setting-topic').value.trim();
  state.topic = topic;
  await db.setSetting('topic', topic);
  toast('토픽 저장됨');
  await syncNow(true);
  await renderCalendar();
}

// ---------- Pattern Modal ----------
async function openPatternModal() {
  await renderPatternList();
  $('#pattern-modal').classList.remove('hidden');
}

async function renderPatternList() {
  state.patterns = await db.getAllPatterns();
  const body = $('#pattern-modal-body');
  let html = `
    <div style="margin-bottom:16px">
      <h3 style="font-size:1rem;margin-bottom:8px">새 순환 패턴</h3>
      <input type="text" id="new-pattern-name" placeholder="패턴 이름 (예: 4조 3교대)" style="margin-bottom:6px" />
      <input type="text" id="new-pattern-cycle" placeholder="순환 (쉼표 구분) 예: 주간,야간,비번,휴무" style="margin-bottom:6px" />
      <input type="date" id="new-pattern-start" style="margin-bottom:6px" />
      <button id="btn-add-pattern" class="btn primary full">패턴 추가</button>
    </div>
    <div class="pattern-list" id="pattern-list-inner"></div>
  `;
  body.innerHTML = html;

  const list = $('#pattern-list-inner');
  if (!state.patterns.length) {
    list.innerHTML = '<p style="color:#94a3b8">등록된 패턴이 없습니다.</p>';
  } else {
    for (const p of state.patterns) {
      const card = document.createElement('div');
      card.className = 'pattern-card' + (p.active ? ' active' : '');
      card.innerHTML = `
        <strong>${p.name}</strong>
        <div style="font-size:0.85rem;margin-top:4px">${p.cycle.join(' → ')}</div>
        <div style="font-size:0.8rem;color:#64748b">시작: ${p.startDate}</div>
        <div class="pattern-actions">
          <button data-act="activate" data-id="${p.id}">${p.active ? '활성 중' : '활성화'}</button>
          <button data-act="delete" data-id="${p.id}">삭제</button>
        </div>
      `;
      list.appendChild(card);
    }
  }

  $('#btn-add-pattern').onclick = async () => {
    const name = $('#new-pattern-name').value.trim() || '새 패턴';
    const cycleStr = $('#new-pattern-cycle').value.trim();
    const start = $('#new-pattern-start').value;
    if (!cycleStr || !start) { toast('순환과 시작일을 입력하세요'); return; }
    const cycle = cycleStr.split(',').map(s => s.trim()).filter(Boolean);
    if (!cycle.length) { toast('순환 값을 확인하세요'); return; }
    const id = 'p_' + Date.now();
    // deactivate others if activating this
    const p = { id, name, type: 'cycle', cycle, startDate: start, active: true };
    for (const old of state.patterns) {
      if (old.active) {
        old.active = false;
        await db.putPattern(old);
      }
    }
    await db.putPattern(p);
    toast('패턴 추가됨');
    await renderPatternList();
    await renderCalendar();
  };

  list.querySelectorAll('button').forEach(btn => {
    btn.onclick = async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      if (act === 'delete') {
        await db.deletePattern(id);
        toast('삭제됨');
      } else if (act === 'activate') {
        for (const p of state.patterns) {
          p.active = p.id === id;
          await db.putPattern(p);
        }
        toast('활성화됨');
      }
      await renderPatternList();
      state.patterns = await db.getAllPatterns();
      await renderCalendar();
    };
  });
}

// ---------- Export / Import ----------
async function doExport() {
  const data = await db.exportAllData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `work-calendar-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('내보내기 완료');
}

async function doImport(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    await db.importAllData(data);
    state.topic = await db.getSetting('topic', '');
    state.patterns = await db.getAllPatterns();
    toast('가져오기 완료');
    await renderCalendar();
    loadSettingsUI();
  } catch (err) {
    toast('가져오기 실패: ' + err.message);
  }
}

// ---------- Init ----------
async function init() {
  // selfTest(); // uncomment to verify parser

  state.topic = await db.getSetting('topic', '');
  state.patterns = await db.getAllPatterns();

  // month nav
  $('#btn-prev-month').onclick = () => {
    state.currentMonth--;
    if (state.currentMonth < 1) { state.currentMonth = 12; state.currentYear--; }
    renderCalendar();
  };
  $('#btn-next-month').onclick = () => {
    state.currentMonth++;
    if (state.currentMonth > 12) { state.currentMonth = 1; state.currentYear++; }
    renderCalendar();
  };
  $('#btn-sync').onclick = () => syncNow(true);

  // nav
  $all('.nav-item').forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.view);
  });

  // modals
  $('#day-modal-close').onclick = closeDayModal;
  $('#day-modal .modal-backdrop').onclick = closeDayModal;
  $('#pattern-modal-close').onclick = () => $('#pattern-modal').classList.add('hidden');
  $('#pattern-modal .modal-backdrop').onclick = () => $('#pattern-modal').classList.add('hidden');

  // settings
  $('#btn-save-topic').onclick = saveTopic;
  $('#btn-manage-patterns').onclick = openPatternModal;
  $('#btn-export').onclick = doExport;
  $('#btn-import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = (e) => {
    if (e.target.files[0]) doImport(e.target.files[0]);
  };
  $('#btn-clear-data').onclick = async () => {
    if (!confirm('모든 로컬 데이터를 삭제할까요? 이 작업은 되돌릴 수 없습니다.')) return;
    await db.clearAllData();
    state.topic = '';
    state.patterns = [];
    state.daysCache.clear();
    toast('초기화 완료');
    loadSettingsUI();
    renderCalendar();
  };

  // admin
  $all('.type-btn').forEach(b => {
    b.onclick = () => {
      $all('.type-btn').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      state.adminType = b.dataset.type;
      $('#work-input-section').classList.toggle('hidden', state.adminType !== 'work');
      $('#leave-input-section').classList.toggle('hidden', state.adminType !== 'leave');
      updateProtocolPreview();
    };
  });
  $all('#work-chips .chip').forEach(c => {
    c.onclick = () => {
      $all('#work-chips .chip').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      $('#admin-work-type').value = c.dataset.value;
      updateProtocolPreview();
    };
  });
  $('#admin-date').oninput = updateProtocolPreview;
  $('#admin-work-type').oninput = updateProtocolPreview;
  $('#btn-add-leave').onclick = () => {
    const v = $('#leave-name').value.trim();
    if (!v) return;
    state.leaveDraft.push(v);
    $('#leave-name').value = '';
    renderLeaveDraft();
    updateProtocolPreview();
  };
  $('#btn-copy-protocol').onclick = () => {
    const t = $('#protocol-preview').textContent;
    if (t && t !== '—') {
      navigator.clipboard.writeText(t).then(() => toast('복사됨')).catch(() => toast('복사 실패'));
    }
  };
  $('#btn-send-protocol').onclick = sendProtocol;
  $('#btn-send-multiline').onclick = sendMultiline;

  // visibility / focus
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow(false);
  });
  window.addEventListener('focus', () => syncNow(false));

  // history month change
  $('#history-month-select').onchange = renderHistory;

  // initial render
  await renderCalendar();
  startAutoSync();
  // initial sync if topic exists
  if (state.topic) {
    setTimeout(() => syncNow(false), 500);
  }

  // service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./sw.js');
    } catch (e) { console.warn('SW register failed', e); }
  }
}

function renderLeaveDraft() {
  const ul = $('#leave-preview-list');
  ul.innerHTML = '';
  state.leaveDraft.forEach((item, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${item}</span><button class="remove" data-idx="${idx}">×</button>`;
    li.querySelector('button').onclick = () => {
      state.leaveDraft.splice(idx, 1);
      renderLeaveDraft();
      updateProtocolPreview();
    };
    ul.appendChild(li);
  });
}

init().catch(err => {
  console.error('Init failed', err);
  toast('앱 초기화 오류');
});
