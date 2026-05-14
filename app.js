const SB_URL = 'https://ocjuxlfysrafnxfwsehr.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9janV4bGZ5c3JhZm54ZndzZWhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzAzMDYsImV4cCI6MjA5NDM0NjMwNn0.pOFOoGIaOsAGOxPrwn8FM_mco3euP4Mhen9_4F9ZPis';

let items = [], currentView = 'kanban', calYear, calMonth;
let editingId = null, activeTimerTaskId = null, activeTimerStart = null, timerInterval = null;
let currentComments = [], currentTimeLogs = [], currentActivity = [];
const todayDate = new Date();
calYear = todayDate.getFullYear(); calMonth = todayDate.getMonth();

async function sbRead(table, query) {
  query = query || 'select=*&order=created_at.desc';
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?${query}`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`, 'Accept': 'application/json' }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch(e) { console.error('sbRead error', e); return null; }
}

async function sbWrite(table, method, id, body) {
  try {
    const url = id ? `${SB_URL}/rest/v1/${table}?id=eq.${id}` : `${SB_URL}/rest/v1/${table}`;
    const headers = {
      'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json', 'Accept': 'application/json'
    };
    if (method === 'POST' || method === 'PATCH') headers['Prefer'] = 'return=representation';
    const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const text = await res.text();
    return text ? JSON.parse(text) : [];
  } catch(e) { console.error('sbWrite error', e); throw e; }
}

async function sbDelete(table, id) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return true;
  } catch(e) { console.error('sbDelete error', e); throw e; }
}

function setStatus(txt, color) {
  const el = document.getElementById('statusDot');
  el.textContent = txt; el.style.color = color;
}

async function loadItems() {
  setStatus('⏳ loading...', 'var(--muted)');
  const data = await sbRead('tasks', 'select=*&order=created_at.desc');
  if (data && Array.isArray(data)) {
    items = data;
    setStatus('● live', 'var(--green)');
    renderCurrent();
  } else {
    setStatus('⚠ offline', 'var(--red)');
  }
}

function getFiltered() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const cat = document.getElementById('filterCat').value;
  const pri = document.getElementById('filterPri').value;
  return items.filter(i => {
    if (q && i.title.toLowerCase().indexOf(q) === -1 && (i.description||'').toLowerCase().indexOf(q) === -1) return false;
    if (cat && i.category !== cat) return false;
    if (pri && i.priority !== pri) return false;
    return true;
  });
}

function renderCurrent() { currentView === 'kanban' ? renderKanban() : renderCalendar(); }

function renderKanban() {
  ['backlog','in_progress','done'].forEach(col => {
    const colItems = getFiltered().filter(i => i.status === col);
    document.getElementById('cnt-' + col).textContent = colItems.length;
    const body = document.getElementById('body-' + col);
    if (!colItems.length) { body.innerHTML = '<div class="empty-col">No tasks</div>'; return; }
    body.innerHTML = colItems.map(cardHTML).join('');
    body.querySelectorAll('.card').forEach(card => {
      card.draggable = true;
      card.addEventListener('dragstart', e => { e.dataTransfer.setData('taskId', card.dataset.id); card.classList.add('dragging'); });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
  });
}

function cardHTML(item) {
  let actions = '';
  if (item.status !== 'backlog') actions += `<button onclick="event.stopPropagation();moveCard('${item.id}','backlog')">← Backlog</button>`;
  if (item.status !== 'in_progress') actions += `<button onclick="event.stopPropagation();moveCard('${item.id}','in_progress')">⚡ Progress</button>`;
  if (item.status !== 'done') actions += `<button onclick="event.stopPropagation();moveCard('${item.id}','done')">✓ Done</button>`;
  return `<div class="card" data-id="${item.id}" onclick="openModal('${item.id}')">
    ${activeTimerTaskId === item.id ? '<span class="timer-badge">⏱ running</span>' : ''}
    <div class="card-title">${escHtml(item.title)}</div>
    <div class="card-meta"><span class="badge badge-cat">${item.category||''}</span><span class="badge badge-priority-${item.priority}">${item.priority||''}</span></div>
    ${item.source ? `<div class="card-source">📎 ${escHtml(item.source)}</div>` : ''}
    <div class="card-actions">${actions}</div>
  </div>`;
}

function onDragOver(e, col) { e.preventDefault(); document.getElementById('col-' + col).classList.add('drag-over'); }
function onDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
async function onDrop(e, col) { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const id = e.dataTransfer.getData('taskId'); if (id) await moveCard(id, col); }

async function moveCard(id, newStatus) {
  const item = items.find(i => i.id === id);
  if (!item || item.status === newStatus) return;
  const oldStatus = item.status; item.status = newStatus; renderKanban();
  try {
    await sbWrite('tasks', 'PATCH', id, { status: newStatus, updated_at: new Date().toISOString() });
    logActivity(id, 'moved', oldStatus + ' → ' + newStatus);
    setStatus('✓ saved', 'var(--green)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
  } catch(e) { item.status = oldStatus; renderKanban(); setStatus('⚠ save failed', 'var(--red)'); }
}

async function openModal(id) {
  editingId = id; currentComments = []; currentTimeLogs = []; currentActivity = [];
  if (id) {
    const item = items.find(i => i.id === id); if (!item) return;
    document.getElementById('modalTitle').textContent = 'Edit Task';
    document.getElementById('fTitle').value = item.title || '';
    document.getElementById('fDescription').value = item.description || '';
    document.getElementById('fCategory').value = item.category || 'todo';
    document.getElementById('fPriority').value = item.priority || 'medium';
    document.getElementById('fStatus').value = item.status || 'backlog';
    document.getElementById('fSource').value = item.source || '';
    document.getElementById('btnDelete').style.display = 'inline-flex';
    ['commentsSection','timelogSection','activitySection'].forEach(s => document.getElementById(s).style.display = 'flex');
    const [comments, timelogs, activity] = await Promise.all([
      sbRead('comments', `task_id=eq.${id}&order=created_at.asc`),
      sbRead('time_logs', `task_id=eq.${id}&order=started_at.asc`),
      sbRead('activity', `task_id=eq.${id}&order=created_at.desc&limit=20`)
    ]);
    currentComments = comments || []; currentTimeLogs = timelogs || []; currentActivity = activity || [];
    renderComments(); renderTimeLogs(); renderActivity();
    const isRunning = activeTimerTaskId === id;
    document.getElementById('btnStartTimer').style.display = isRunning ? 'none' : 'inline-flex';
    document.getElementById('btnStopTimer').style.display = isRunning ? 'inline-flex' : 'none';
  } else {
    document.getElementById('modalTitle').textContent = 'New Task';
    ['fTitle','fDescription','fSource'].forEach(f => document.getElementById(f).value = f === 'fSource' ? 'Manual' : '');
    document.getElementById('fCategory').value = 'todo';
    document.getElementById('fPriority').value = 'medium';
    document.getElementById('fStatus').value = 'backlog';
    document.getElementById('btnDelete').style.display = 'none';
    ['commentsSection','timelogSection','activitySection'].forEach(s => document.getElementById(s).style.display = 'none');
  }
  document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal() { document.getElementById('modalOverlay').style.display = 'none'; editingId = null; }

async function saveTask() {
  const title = document.getElementById('fTitle').value.trim();
  if (!title) { alert('Title is required'); return; }
  const payload = {
    title, description: document.getElementById('fDescription').value.trim(),
    category: document.getElementById('fCategory').value, priority: document.getElementById('fPriority').value,
    status: document.getElementById('fStatus').value, source: document.getElementById('fSource').value.trim(),
    updated_at: new Date().toISOString()
  };
  try {
    if (editingId) {
      await sbWrite('tasks', 'PATCH', editingId, payload);
      const idx = items.findIndex(i => i.id === editingId);
      if (idx !== -1) items[idx] = Object.assign({}, items[idx], payload);
      logActivity(editingId, 'updated', 'Task details edited');
    } else {
      payload.id = 'T' + Date.now().toString(36).toUpperCase();
      payload.created_at = new Date().toISOString();
      const result = await sbWrite('tasks', 'POST', null, payload);
      items.unshift(result && result[0] ? result[0] : payload);
    }
    setStatus('✓ saved', 'var(--green)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
    renderCurrent(); closeModal();
  } catch(e) { alert('Save failed: ' + e.message); setStatus('⚠ save failed', 'var(--red)'); }
}

async function deleteTask() {
  if (!editingId || !confirm('Permanently delete this task?')) return;
  try {
    await sbDelete('tasks', editingId);
    items = items.filter(i => i.id !== editingId);
    renderCurrent(); closeModal();
    setStatus('✓ deleted', 'var(--red)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
  } catch(e) { alert('Delete failed: ' + e.message); }
}

function renderComments() {
  const el = document.getElementById('commentsList');
  el.innerHTML = currentComments.length ? currentComments.map(c =>
    `<div class="comment"><div class="comment-meta">${c.author||'Kyle'} · ${timeAgo(c.created_at)}</div><div class="comment-body">${escHtml(c.body)}</div></div>`
  ).join('') : '<div style="color:var(--muted);font-size:12px">No comments yet</div>';
}

async function addComment() {
  const input = document.getElementById('commentInput');
  const body = input.value.trim(); if (!body || !editingId) return;
  input.value = '';
  const result = await sbWrite('comments', 'POST', null, { task_id: editingId, body, author: 'Kyle' });
  if (result && result[0]) currentComments.push(result[0]);
  logActivity(editingId, 'commented', body.substring(0, 60));
  renderComments();
}

function renderTimeLogs() {
  const el = document.getElementById('timelogEntries'), totalEl = document.getElementById('timelogTotal');
  if (!currentTimeLogs.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">No time logged yet</div>'; totalEl.textContent = ''; return; }
  let total = 0;
  el.innerHTML = currentTimeLogs.map(t => { total += t.duration_minutes||0; return `<div class="timelog-entry"><span>${t.note||'Work session'}</span><span style="color:var(--accent)">${formatDuration(t.duration_minutes||0)}</span></div>`; }).join('');
  totalEl.textContent = 'Total: ' + formatDuration(total);
}

function startTimer() {
  if (!editingId) return;
  activeTimerTaskId = editingId; activeTimerStart = Date.now();
  document.getElementById('btnStartTimer').style.display = 'none';
  document.getElementById('btnStopTimer').style.display = 'inline-flex';
  timerInterval = setInterval(() => {
    const e = Math.floor((Date.now() - activeTimerStart) / 60000);
    document.getElementById('btnStopTimer').textContent = '■ Stop (' + formatDuration(e) + ')';
  }, 10000);
  renderKanban();
}

async function stopTimer() {
  if (!activeTimerTaskId || !activeTimerStart) return;
  const dur = Math.max(1, Math.floor((Date.now() - activeTimerStart) / 60000));
  clearInterval(timerInterval);
  const entry = { task_id: activeTimerTaskId, started_at: new Date(activeTimerStart).toISOString(), ended_at: new Date().toISOString(), duration_minutes: dur, note: 'Work session' };
  const result = await sbWrite('time_logs', 'POST', null, entry);
  if (result && result[0]) currentTimeLogs.push(result[0]);
  logActivity(activeTimerTaskId, 'time logged', formatDuration(dur));
  renderTimeLogs();
  activeTimerTaskId = null; activeTimerStart = null;
  document.getElementById('btnStartTimer').style.display = 'inline-flex';
  document.getElementById('btnStopTimer').style.display = 'none';
  document.getElementById('btnStopTimer').textContent = '■ Stop Timer';
  renderKanban();
}

async function logActivity(taskId, action, detail) {
  try { await sbWrite('activity', 'POST', null, { task_id: taskId, action, detail }); } catch(e) {}
}

function renderActivity() {
  const el = document.getElementById('activityList');
  el.innerHTML = currentActivity.length ? currentActivity.map(a =>
    `<div class="activity-item"><span class="activity-dot"></span><span class="activity-text"><strong>${a.action}</strong>${a.detail ? ' — ' + escHtml(a.detail) : ''}</span><span class="activity-time">${timeAgo(a.created_at)}</span></div>`
  ).join('') : '<div style="color:var(--muted);font-size:12px">No activity yet</div>';
}

function switchView(v) {
  currentView = v;
  document.getElementById('kanbanView').style.display = v === 'kanban' ? 'flex' : 'none';
  document.getElementById('calendarView').style.display = v === 'calendar' ? 'block' : 'none';
  document.getElementById('tabKanban').classList.toggle('active', v === 'kanban');
  document.getElementById('tabCalendar').classList.toggle('active', v === 'calendar');
  if (v === 'calendar') renderCalendar();
}

function renderCalendar() {
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('calTitle').textContent = months[calMonth] + ' ' + calYear;
  const grid = document.getElementById('calGrid');
  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();
  const todayStr = todayDate.getFullYear() + '-' + String(todayDate.getMonth()+1).padStart(2,'0') + '-' + String(todayDate.getDate()).padStart(2,'0');
  const total = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  let cells = '';
  for (let i = 0; i < total; i++) {
    let day, dm, dy, isOther = false;
    if (i < firstDay) { day = daysInPrev - firstDay + i + 1; dm = calMonth - 1; dy = calYear; isOther = true; }
    else if (i >= firstDay + daysInMonth) { day = i - firstDay - daysInMonth + 1; dm = calMonth + 1; dy = calYear; isOther = true; }
    else { day = i - firstDay + 1; dm = calMonth; dy = calYear; }
    const am = ((dm % 12) + 12) % 12, ay = dm < 0 ? dy - 1 : dm > 11 ? dy + 1 : dy;
    const dateStr = ay + '-' + String(am+1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
    const isToday = dateStr === todayStr;
    const dayItems = items.filter(it => (it.created_at||'').substring(0,10) === dateStr);
    cells += `<div class="cal-cell${isOther?' other-month':''}${isToday?' today':''}">
      <div class="cal-date">${day}</div>
      ${dayItems.slice(0,3).map(it => `<div class="cal-item" onclick="openModal('${it.id}')" title="${escHtml(it.title)}">${escHtml(it.title)}</div>`).join('')}
      ${dayItems.length > 3 ? `<div style="font-size:10px;color:var(--muted)">+${dayItems.length-3} more</div>` : ''}
    </div>`;
  }
  grid.innerHTML = cells;
}

function calPrev() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); }
function calNext() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); }
function calToday() { calMonth = todayDate.getMonth(); calYear = todayDate.getFullYear(); renderCalendar(); }

function escHtml(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function timeAgo(iso) {
  if (!iso) return '';
  const d = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (d < 60) return 'just now'; if (d < 3600) return Math.floor(d/60)+'m ago';
  if (d < 86400) return Math.floor(d/3600)+'h ago'; return Math.floor(d/86400)+'d ago';
}
function formatDuration(m) { if (!m) return '0m'; const h = Math.floor(m/60); return h > 0 ? h+'h '+(m%60)+'m' : m+'m'; }

function startPolling() {
  setInterval(async () => {
    const fresh = await sbRead('tasks', 'select=*&order=created_at.desc');
    if (!fresh || !Array.isArray(fresh)) return;
    const ourIds = new Set(items.map(i => i.id));
    const newOnes = fresh.filter(i => !ourIds.has(i.id));
    if (newOnes.length) {
      items = [...newOnes, ...items];
      setStatus('↻ +' + newOnes.length + ' new', '#4f46e5');
      setTimeout(() => setStatus('● live', 'var(--green)'), 3000);
      renderCurrent();
    }
  }, 60000);
}

loadItems().then(() => startPolling());
