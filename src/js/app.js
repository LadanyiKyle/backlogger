const SB_URL = 'https://ocjuxlfysrafnxfwsehr.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9janV4bGZ5c3JhZm54ZndzZWhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3NzAzMDYsImV4cCI6MjA5NDM0NjMwNn0.pOFOoGIaOsAGOxPrwn8FM_mco3euP4Mhen9_4F9ZPis';

let items = [], currentView = 'kanban', calYear, calMonth;
let editingId = null;
let currentComments = [], currentTimeLogs = [], currentActivity = [];
let latestComments = {};
let currentAttachments = [];
let summaries = [];
let currentTags = [];
let currentLinkedTasks = [];
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
  const [data, comments, summaryData] = await Promise.all([
    sbRead('tasks', 'select=*&order=created_at.desc'),
    sbRead('comments', 'select=task_id,body,created_at&order=created_at.desc'),
    sbRead('summaries', 'select=*&order=created_at.desc&status=eq.unread')
  ]);
  if (data && Array.isArray(data)) {
    items = data;
    summaries = (summaryData && Array.isArray(summaryData)) ? summaryData : [];
    // Build map of latest comment per task
    latestComments = {};
    if (comments && Array.isArray(comments)) {
      comments.forEach(c => {
        if (!latestComments[c.task_id]) latestComments[c.task_id] = c.body;
      });
    }
    // Load link relationships for card display
    // _outLinks: tasks I linked TO (I initiated) → shown as L on my card
    // _inLinks: tasks that linked TO me (they initiated) → shown as P on my card
    const links = await sbRead('task_links', 'select=task_id,linked_task_id');
    if (links && Array.isArray(links)) {
      const outMap = {}, inMap = {};
      links.forEach(l => {
        if (!outMap[l.task_id]) outMap[l.task_id] = [];
        outMap[l.task_id].push(l.linked_task_id);
        if (!inMap[l.linked_task_id]) inMap[l.linked_task_id] = [];
        inMap[l.linked_task_id].push(l.task_id);
      });
      items.forEach(i => {
        i._outLinks = outMap[i.id] || [];  // L badges
        i._inLinks  = inMap[i.id]  || [];  // P badges
        i._linkedIds = [...new Set([...i._outLinks, ...i._inLinks])]; // for modal list
        i._linkCount = i._outLinks.length + i._inLinks.length;
      });
    }
    // Assign sequential 3-digit display IDs (#001, #002...) by creation order
    const sorted = [...items].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    sorted.forEach((item, idx) => { item._seq = String(idx + 1).padStart(3, '0'); });
    setStatus('● live', 'var(--green)');
    // Auto-archive done tasks older than 7 days
    autoArchiveOldDone();
    populateTagFilter();
    checkReminders();
    renderCurrent();
  } else {
    setStatus('⚠ offline', 'var(--red)');
  }
}

async function autoArchiveOldDone() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const toArchive = items.filter(i => i.status === 'done' && i.updated_at && i.updated_at < sevenDaysAgo);
  for (const item of toArchive) {
    try {
      await sbWrite('tasks', 'PATCH', item.id, { status: 'archived', archived_at: new Date().toISOString() });
      item.status = 'archived';
      item.archived_at = new Date().toISOString();
    } catch(e) { console.error('Auto-archive failed for', item.id, e); }
  }
  if (toArchive.length) renderCurrent();
}

function checkReminders() {
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  // Exclude individually dismissed notifications
  const dismissed = getDismissedNotifs();
  const count = items.filter(i =>
    (i.status === 'backlog' || i.status === 'in_progress' || i.status === 'action') &&
    i.deadline &&
    (new Date(i.deadline).getTime() - now) <= sevenDays &&
    !dismissed.includes(i.id)
  ).length;
  const badge = document.getElementById('notifBadge');
  if (badge) {
    if (count > 0) { badge.textContent = count; badge.style.display = 'inline-flex'; }
    else { badge.style.display = 'none'; }
  }
}

function getDismissedNotifs() {
  try { return JSON.parse(localStorage.getItem('notifs_dismissed') || '[]'); } catch(e) { return []; }
}

function getFiltered() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const cat = document.getElementById('filterCat').value;
  const pri = document.getElementById('filterPri').value;
  const tag = document.getElementById('filterTag').value;
  return items.filter(i => {
    if (i.status === 'archived') return false;
    if (q && i.title.toLowerCase().indexOf(q) === -1 && (i.description||'').toLowerCase().indexOf(q) === -1 && !(i._seq && i._seq.includes(q))) return false;
    if (cat && i.category !== cat) return false;
    if (pri && i.priority !== pri) return false;
    if (tag && !(i.tags || []).includes(tag)) return false;
    return true;
  });
}

function renderCurrent() { currentView === 'kanban' ? renderKanban() : renderCalendar(); }

function renderKanban() {
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

  // Conditional Review column — hide if empty
  const reviewItems = getFiltered().filter(i => i.status === 'review');
  const reviewCol = document.getElementById('col-review');
  if (reviewItems.length) {
    reviewCol.style.display = 'flex';
    document.getElementById('cnt-review').textContent = reviewItems.length;
    const reviewBody = document.getElementById('body-review');
    reviewBody.innerHTML = reviewItems.map(reviewCardHTML).join('');
  } else {
    reviewCol.style.display = 'none';
  }
  updateReviewBadge();

  // Render Summaries column
  renderSummaries();

  // Render standard columns
  ['backlog','in_progress','action','done'].forEach(col => {
    let colItems = getFiltered().filter(i => i.status === col);
    // Smart sort: priority → deadline status → date
    if (col !== 'done') {
      colItems.sort(smartSort);
    }
    document.getElementById('cnt-' + col).textContent = colItems.length;
    const body = document.getElementById('body-' + col);
    if (!colItems.length) { body.innerHTML = '<div class="empty-col">No tasks</div>'; return; }
    body.innerHTML = colItems.map(cardHTML).join('');
    body.querySelectorAll('.card').forEach(card => {
      card.draggable = true;
      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('taskId', card.dataset.id);
        card.classList.add('dragging');
      });
      card.addEventListener('dragend', () => card.classList.remove('dragging'));
    });
  });
}

function smartSort(a, b) {
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  const now = Date.now();
  // 1. Priority tier
  const pa = priorityOrder[a.priority] ?? 4;
  const pb = priorityOrder[b.priority] ?? 4;
  if (pa !== pb) return pa - pb;
  // 2. Within same priority: overdue first, then due soon, then no deadline
  const aDeadline = a.deadline ? new Date(a.deadline).getTime() : null;
  const bDeadline = b.deadline ? new Date(b.deadline).getTime() : null;
  const aOverdue = aDeadline && aDeadline < now;
  const bOverdue = bDeadline && bDeadline < now;
  if (aOverdue && !bOverdue) return -1;
  if (!aOverdue && bOverdue) return 1;
  if (aOverdue && bOverdue) return aDeadline - bDeadline; // oldest overdue first
  // Both have deadlines (not overdue)
  if (aDeadline && bDeadline) return aDeadline - bDeadline; // due soonest first
  if (aDeadline && !bDeadline) return -1;
  if (!aDeadline && bDeadline) return 1;
  // Both no deadline: oldest created first
  return new Date(a.created_at||0).getTime() - new Date(b.created_at||0).getTime();
}

function renderSummaries() {
  const col = document.getElementById('col-summaries');
  const body = document.getElementById('body-summaries');
  const cnt = document.getElementById('cnt-summaries');
  if (!summaries.length) {
    col.style.display = 'none';
    return;
  }
  col.style.display = 'flex';
  cnt.textContent = summaries.length;
  body.innerHTML = summaries.map(s => {
    const time = s.created_at ? new Date(s.created_at).toLocaleString('en-ZA', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    const source = s.summary_source || '';
    const scanType = s.scan_type || 'scan';
    // Truncate content for preview (show first ~100 chars)
    const preview = (s.content || '').substring(0, 100) + (s.content && s.content.length > 100 ? '...' : '');
    return `<div class="card summary-card" onclick="expandSummary('${escAttr(s.id)}')">
      <div class="summary-source-title">${escHtml(source)}</div>
      <div class="summary-sub-meta"><span class="badge badge-scan">${escHtml(scanType)}</span> <span style="color:var(--muted);font-size:11px">${time}</span></div>
      <div class="summary-content" style="cursor:pointer;color:var(--text);padding:8px;border-radius:6px;background:var(--surface2);min-height:60px;max-height:80px;overflow:hidden">${escHtml(preview)}</div>
      ${s.tasks_added ? `<div class="summary-tasks-count">+${s.tasks_added} tasks added</div>` : ''}
      <div class="card-actions" style="margin-top:8px">
        <button class="review-approve-btn" onclick="event.stopPropagation();markSummaryRead('${s.id}')">✓ Mark as Read</button>
        <button class="summary-promote-btn" id="promote-${s.id}" onclick="event.stopPropagation();promoteToTask('${s.id}')">→ Create Task</button>
      </div>
    </div>`;
  }).join('');
}

async function markSummaryRead(id) {
  try {
    await sbWrite('summaries', 'PATCH', id, { status: 'read', read_at: new Date().toISOString() });
    summaries = summaries.filter(s => s.id !== id);
    renderSummaries();
    setStatus('✓ read', 'var(--green)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
  } catch(e) { alert('Failed to mark as read: ' + e.message); }
}

async function promoteToTask(summaryId) {
  const s = summaries.find(x => x.id === summaryId);
  if (!s) return;
  const title = (s.content || '').substring(0, 60).trim();
  const description = (s.content || '') + '\n\nSource: ' + (s.summary_source || '');
  const now = new Date().toISOString();
  const payload = {
    id: 'T' + Date.now().toString(36).toUpperCase(),
    title, description,
    category: 'todo', priority: 'medium', status: 'backlog',
    source: 'Summary', created_at: now, updated_at: now
  };
  try {
    const result = await sbWrite('tasks', 'POST', null, payload);
    items.unshift(result && result[0] ? result[0] : payload);
    renderKanban();
    // Brief confirmation on the button
    const btn = document.getElementById('promote-' + summaryId);
    if (btn) {
      btn.textContent = '✓ Task created';
      btn.style.color = 'var(--green)';
      setTimeout(() => { btn.textContent = '→ Create Task'; btn.style.color = ''; }, 2000);
    }
  } catch(e) { alert('Failed to create task: ' + e.message); }
}

function reviewCardHTML(item) {
  return `<div class="card" data-id="${item.id}" onclick="openModal('${item.id}')">
    <div class="card-title">${escHtml(item.title)}</div>
    <div class="card-meta"><span class="badge badge-cat">${item.category||''}</span><span class="badge badge-priority-${item.priority}">${item.priority||''}</span></div>
    ${item.source ? `<div class="card-source">📎 ${escHtml(item.source)}</div>` : ''}
    <div class="card-actions">
      <button class="review-approve-btn" onclick="event.stopPropagation();approveReview('${item.id}')">✓ Approve</button>
      <button class="review-dismiss-btn" onclick="event.stopPropagation();dismissReview('${item.id}')">✗ Dismiss</button>
    </div>
  </div>`;
}

function updateReviewBadge() {
  const count = items.filter(i => i.status === 'review').length;
  const badge = document.getElementById('reviewBadge');
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-flex';
  } else {
    badge.style.display = 'none';
  }
}

async function approveReview(id) {
  const item = items.find(i => i.id === id);
  if (!item) return;
  item.status = 'backlog';
  renderKanban();
  try {
    await sbWrite('tasks', 'PATCH', id, { status: 'backlog', updated_at: new Date().toISOString() });
    logActivity(id, 'approved', 'Moved from review to backlog');
    setStatus('✓ approved', 'var(--green)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
  } catch(e) { item.status = 'review'; renderKanban(); setStatus('⚠ save failed', 'var(--red)'); }
}

async function dismissReview(id) {
  showConfirm('Dismiss this task? It will be permanently deleted.', async () => {
    try {
      await sbDelete('tasks', id);
      items = items.filter(i => i.id !== id);
      renderKanban();
      setStatus('✓ dismissed', 'var(--muted)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
    } catch(e) { alert('Dismiss failed: ' + e.message); }
  });
}

// Enable reorder within columns (set up once)
document.addEventListener('DOMContentLoaded', () => {
  ['review','backlog','in_progress','action','done'].forEach(col => {
    const body = document.getElementById('body-' + col);
    body.addEventListener('dragover', e => {
      e.preventDefault();
      const dragging = body.querySelector('.dragging');
      if (!dragging) return;
      const siblings = [...body.querySelectorAll('.card:not(.dragging)')];
      const next = siblings.find(s => {
        const rect = s.getBoundingClientRect();
        return e.clientY < rect.top + rect.height / 2;
      });
      if (next) body.insertBefore(dragging, next);
      else body.appendChild(dragging);
    });
  });

  // Mobile: tap column header to collapse/expand
  if (window.innerWidth <= 768) {
    document.querySelectorAll('.col-header').forEach(header => {
      header.addEventListener('click', () => {
        header.closest('.column').classList.toggle('collapsed');
      });
    });
    // Start with Done collapsed on mobile
    const doneCol = document.getElementById('col-done');
    if (doneCol) doneCol.classList.add('collapsed');
  }
});

function cardHTML(item) {
  let actions = '';
  if (item.status !== 'backlog') actions += `<button onclick="event.stopPropagation();moveCard('${item.id}','backlog')">← Backlog</button>`;
  if (item.status !== 'in_progress') actions += `<button onclick="event.stopPropagation();moveCard('${item.id}','in_progress')">⚡ Progress</button>`;
  if (item.status !== 'action') actions += `<button onclick="event.stopPropagation();moveCard('${item.id}','action')">🎯 Action</button>`;
  if (item.status !== 'done') actions += `<button onclick="event.stopPropagation();moveCard('${item.id}','done')">✓ Done</button>`;
  actions += `<button class="card-delete-btn" onclick="event.stopPropagation();deleteCardDirect('${item.id}')">🗑</button>`;
  const deadlineBadge = getDeadlineBadge(item);
  const overdueClass = isOverdue(item) ? ' card-overdue' : '';
  // P badges: tasks that linked TO this card (they initiated)
  const pBadges = (item._inLinks || []).map(pid => {
    const pt = items.find(i => i.id === pid);
    if (!pt) return '';
    return `<span class="badge badge-relation badge-parent" onclick="event.stopPropagation();openModal('${pt.id}')" title="${escHtml(pt.title)}">P${pt._seq||pt.id}</span>`;
  }).join('');
  // L badges: tasks this card linked TO (I initiated)
  const lBadges = (item._outLinks || []).map(lid => {
    const lt = items.find(i => i.id === lid);
    if (!lt) return '';
    return `<span class="badge badge-relation badge-linked" onclick="event.stopPropagation();openModal('${lt.id}')" title="${escHtml(lt.title)}">L${lt._seq||lt.id}</span>`;
  }).join('');
  const relationRow = (pBadges || lBadges) ? `<div class="card-relations">${pBadges}${lBadges}</div>` : '';
  return `<div class="card${overdueClass}" data-id="${item.id}" onclick="openModal('${item.id}')">
    <div class="card-title-row"><span class="card-title">${escHtml(item.title)}</span><span class="card-id">#${item._seq||'—'}</span></div>
    <div class="card-meta"><span class="badge badge-cat">${item.category||''}</span><span class="badge badge-priority-${item.priority}">${item.priority||''}</span>${deadlineBadge}${(item.tags||[]).map(t => `<span class="badge badge-tag">${escHtml(t)}</span>`).join('')}</div>
    ${item.source ? `<div class="card-source">📎 ${escHtml(item.source)}</div>` : ''}
    ${latestComments[item.id] ? `<div class="card-comment">💬 ${escHtml(latestComments[item.id])}</div>` : ''}
    ${relationRow}
    <div class="card-actions">${actions}</div>
  </div>`;
}

function isOverdue(item) {
  return item.deadline && new Date(item.deadline).getTime() < Date.now();
}

function getDeadlineBadge(item) {
  if (!item.deadline) return '';
  const now = Date.now();
  const dl = new Date(item.deadline).getTime();
  const diff = dl - now;
  const hours = diff / (1000 * 60 * 60);
  let colorClass, text;
  if (diff <= 0) {
    colorClass = 'deadline-red';
    text = '⏰ Overdue';
  } else if (hours < 6) {
    colorClass = 'deadline-red';
    text = '⏰ ' + formatTimeRemaining(diff);
  } else if (hours < 24) {
    colorClass = 'deadline-orange';
    text = '⏰ ' + formatTimeRemaining(diff);
  } else {
    colorClass = 'deadline-green';
    text = '⏰ ' + formatTimeRemaining(diff);
  }
  return `<span class="badge ${colorClass}">${text}</span>`;
}

function formatTimeRemaining(ms) {
  if (ms <= 0) return 'Overdue';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  if (days > 0) return days + 'd ' + remainHours + 'h';
  if (hours > 0) return hours + 'h';
  const mins = Math.floor(ms / (1000 * 60));
  return mins + 'm';
}

function onDragOver(e, col) { e.preventDefault(); document.getElementById('col-' + col).classList.add('drag-over'); }
function onDragLeave(e) { e.currentTarget.classList.remove('drag-over'); }
async function onDrop(e, col) { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); const id = e.dataTransfer.getData('taskId'); if (id) await moveCard(id, col); }

let pendingTimeTaskId = null;

async function moveCard(id, newStatus) {
  const item = items.find(i => i.id === id);
  if (!item || item.status === newStatus) return;
  const oldStatus = item.status; item.status = newStatus; renderKanban();
  try {
    await sbWrite('tasks', 'PATCH', id, { status: newStatus, updated_at: new Date().toISOString() });
    logActivity(id, 'moved', oldStatus + ' → ' + newStatus);
    setStatus('✓ saved', 'var(--green)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
    // Prompt for time when moving from in_progress to done
    if (oldStatus === 'in_progress' && newStatus === 'done') {
      pendingTimeTaskId = id;
      document.getElementById('timePromptOverlay').style.display = 'flex';
    }
  } catch(e) { item.status = oldStatus; renderKanban(); setStatus('⚠ save failed', 'var(--red)'); }
}

async function logTimeAndClose(minutes) {
  if (!pendingTimeTaskId) return;
  const now = new Date().toISOString();
  const entry = { task_id: pendingTimeTaskId, duration_minutes: minutes, logged: false, created_at: now, started_at: now, ended_at: now };
  try {
    await sbWrite('time_logs', 'POST', null, entry);
    logActivity(pendingTimeTaskId, 'time logged', formatDuration(minutes));
    setStatus('✓ +' + minutes + 'm', 'var(--green)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
  } catch(e) { console.error('Time log failed', e); }
  pendingTimeTaskId = null;
  document.getElementById('timePromptOverlay').style.display = 'none';
}

function logTimePromptCustom() {
  const input = document.getElementById('timePromptCustom');
  const minutes = parseInt(input.value);
  if (!minutes || minutes < 1) return;
  logTimeAndClose(minutes);
  input.value = '';
}

function skipTimePrompt() {
  pendingTimeTaskId = null;
  document.getElementById('timePromptOverlay').style.display = 'none';
}

async function openModal(id) {
  editingId = id; currentComments = []; currentTimeLogs = []; currentActivity = [];
  if (id) {
    const item = items.find(i => i.id === id); if (!item) return;
    document.getElementById('modalTitle').textContent = `Edit Task  #${item._seq||item.id}`;
    document.getElementById('fTitle').value = item.title || '';
    document.getElementById('fDescription').value = item.description || '';
    document.getElementById('fCategory').value = item.category || 'todo';
    document.getElementById('fPriority').value = item.priority || 'medium';
    document.getElementById('fStatus').value = item.status || 'backlog';
    document.getElementById('fSource').value = item.source || '';
    currentTags = item.tags || [];
    renderTags();
    document.getElementById('btnDelete').style.display = 'inline-flex';
    ['commentsSection','timelogSection','activitySection','attachmentsSection','logPostSection','linkedTasksSection'].forEach(s => document.getElementById(s).style.display = 'flex');
    renderDeadlineDisplay(item);
    const [comments, timelogs, activity, attachments] = await Promise.all([
      sbRead('comments', `task_id=eq.${id}&order=created_at.asc`),
      sbRead('time_logs', `task_id=eq.${id}&order=started_at.asc`),
      sbRead('activity', `task_id=eq.${id}&order=created_at.desc&limit=20`),
      sbRead('attachments', `task_id=eq.${id}&order=created_at.asc`)
    ]);
    currentComments = comments || []; currentTimeLogs = timelogs || []; currentActivity = activity || []; currentAttachments = attachments || [];
    renderComments(); renderTimeLogs(); renderActivity(); renderAttachments();
    // Load linked tasks (outbound only — tasks this task linked to)
    const links = await sbRead('task_links', `task_id=eq.${id}&select=linked_task_id`);
    currentLinkedTasks = (links || []).map(l => l.linked_task_id);
    renderLinkedTasks();
  } else {
    document.getElementById('modalTitle').textContent = 'New Task';
    ['fTitle','fDescription','fSource'].forEach(f => document.getElementById(f).value = f === 'fSource' ? 'Manual' : '');
    document.getElementById('fCategory').value = 'todo';
    document.getElementById('fPriority').value = 'medium';
    document.getElementById('fStatus').value = 'backlog';
    document.getElementById('btnDelete').style.display = 'none';
    currentTags = [];
    renderTags();
    ['commentsSection','timelogSection','activitySection','attachmentsSection','logPostSection','linkedTasksSection'].forEach(s => document.getElementById(s).style.display = 'none');
    renderDeadlineDisplay(null);
  }
  document.getElementById('modalOverlay').style.display = 'flex';
}

function closeModal() { document.getElementById('modalOverlay').style.display = 'none'; editingId = null; }

function renderDeadlineDisplay(item) {
  const el = document.getElementById('deadlineDisplay');
  if (!item || !item.deadline) {
    el.innerHTML = '<span style="color:var(--muted)">No deadline set</span>';
    return;
  }
  const dl = new Date(item.deadline);
  const formatted = dl.toLocaleString('en-ZA', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const remaining = dl.getTime() - Date.now();
  let remainText, color;
  if (remaining <= 0) {
    remainText = 'OVERDUE';
    color = 'var(--red)';
  } else {
    remainText = formatTimeRemaining(remaining) + ' remaining';
    color = remaining < 6*60*60*1000 ? 'var(--red)' : remaining < 24*60*60*1000 ? 'var(--orange)' : 'var(--green)';
  }
  el.innerHTML = `<span>Due: <strong>${formatted}</strong></span> <span style="color:${color};margin-left:8px;font-weight:600">${remainText}</span>`;
}

function prefillDeadline(days) {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const local = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + 'T' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  document.getElementById('deadlinePicker').value = local;
}

async function saveDeadlineFromPicker() {
  if (!editingId) return;
  const picker = document.getElementById('deadlinePicker');
  const val = picker.value;
  if (!val) { alert('Please select a date and time first'); return; }
  const deadline = new Date(val).toISOString();
  try {
    await sbWrite('tasks', 'PATCH', editingId, { deadline, updated_at: new Date().toISOString() });
    const idx = items.findIndex(i => i.id === editingId);
    if (idx !== -1) items[idx].deadline = deadline;
    renderDeadlineDisplay(items[idx]);
    renderCurrent();
    setStatus('✓ deadline set', 'var(--green)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
  } catch(e) { alert('Failed to set deadline: ' + e.message); }
}

async function clearDeadline() {
  if (!editingId) return;
  try {
    await sbWrite('tasks', 'PATCH', editingId, { deadline: null, updated_at: new Date().toISOString() });
    const idx = items.findIndex(i => i.id === editingId);
    if (idx !== -1) items[idx].deadline = null;
    renderDeadlineDisplay(null);
    renderCurrent();
    setStatus('✓ deadline cleared', 'var(--muted)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
  } catch(e) { alert('Failed to clear deadline: ' + e.message); }
}

async function saveTask() {
  const title = document.getElementById('fTitle').value.trim();
  if (!title) { alert('Title is required'); return; }
  const payload = {
    title, description: document.getElementById('fDescription').value.trim(),
    category: document.getElementById('fCategory').value, priority: document.getElementById('fPriority').value,
    status: document.getElementById('fStatus').value, source: document.getElementById('fSource').value.trim(),
    tags: currentTags,
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
    populateTagFilter();
    renderCurrent(); closeModal();
  } catch(e) { alert('Save failed: ' + e.message); setStatus('⚠ save failed', 'var(--red)'); }
}

let pendingConfirmCallback = null;

function showConfirm(message, callback) {
  document.getElementById('confirmMessage').textContent = message;
  pendingConfirmCallback = callback;
  document.getElementById('confirmOverlay').style.display = 'flex';
}

function closeConfirm() {
  document.getElementById('confirmOverlay').style.display = 'none';
  pendingConfirmCallback = null;
}

function confirmCallback() {
  if (pendingConfirmCallback) pendingConfirmCallback();
  closeConfirm();
}

async function deleteTask() {
  if (!editingId) return;
  const id = editingId;
  showConfirm('Are you sure you want to permanently delete this task?', async () => {
    try {
      await sbDelete('tasks', id);
      items = items.filter(i => i.id !== id);
      renderCurrent(); closeModal();
      setStatus('✓ deleted', 'var(--red)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
    } catch(e) { alert('Delete failed: ' + e.message); }
  });
}

async function deleteCardDirect(id) {
  showConfirm('Are you sure you want to permanently delete this task?', async () => {
    try {
      await sbDelete('tasks', id);
      items = items.filter(i => i.id !== id);
      renderCurrent();
      setStatus('✓ deleted', 'var(--red)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
    } catch(e) { alert('Delete failed: ' + e.message); }
  });
}

function renderComments() {
  const el = document.getElementById('commentsList');
  if (!currentComments.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">No comments yet</div>';
    return;
  }
  const entries = currentComments.map(c =>
    `<div class="comment"><div class="comment-meta">${c.author||'Kyle'} · ${timeAgo(c.created_at)}</div><div class="comment-body">${escHtml(c.body)}</div></div>`
  );
  if (entries.length <= 1) {
    el.innerHTML = entries.join('');
  } else {
    el.innerHTML = entries[entries.length - 1] + `<details class="expand-section"><summary class="expand-toggle">Show ${entries.length - 1} more</summary><div>${entries.slice(0, -1).reverse().join('')}</div></details>`;
  }
}

// addComment() removed — comments are now posted via logAndPost() in the unified Log & Post section

async function logAndPost() {
  if (!editingId) return;
  const comment = document.getElementById('logComment').value.trim();
  const minutes = accumMinutes;
  if (!comment && minutes <= 0) return;
  try {
    if (minutes > 0) {
      const now = new Date().toISOString();
      const entry = { task_id: editingId, duration_minutes: minutes, logged: false, created_at: now, started_at: now, ended_at: now };
      const result = await sbWrite('time_logs', 'POST', null, entry);
      if (result && result[0]) currentTimeLogs.push(result[0]);
      else currentTimeLogs.push(entry);
      logActivity(editingId, 'time logged', formatDuration(minutes));
      resetAccumTime();
      renderTimeLogs();
    }
    if (comment) {
      const result = await sbWrite('comments', 'POST', null, { task_id: editingId, body: comment, author: 'Kyle' });
      if (result && result[0]) currentComments.push(result[0]);
      latestComments[editingId] = comment;
      logActivity(editingId, 'commented', comment.substring(0, 60));
      renderComments();
      document.getElementById('logComment').value = '';
    }
    setStatus('✓ logged', 'var(--green)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
    renderCurrent();
  } catch(e) { alert('Failed: ' + e.message); }
}

function renderTimeLogs() {
  const el = document.getElementById('timelogEntries'), totalEl = document.getElementById('timelogTotal');
  if (!currentTimeLogs.length) { el.innerHTML = '<div style="color:var(--muted);font-size:12px">No time logged yet</div>'; totalEl.textContent = ''; return; }
  let total = 0;
  const entries = currentTimeLogs.map(t => {
    total += t.duration_minutes||0;
    const loggedClass = t.logged ? 'timelog-logged' : '';
    const timestamp = t.created_at ? new Date(t.created_at).toLocaleString('en-ZA', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="timelog-entry ${loggedClass}"><span>${formatDuration(t.duration_minutes||0)}</span><span style="color:var(--muted);font-size:11px">${timestamp}</span></div>`;
  });
  if (entries.length <= 1) {
    el.innerHTML = entries.join('');
  } else {
    el.innerHTML = entries[0] + `<details class="expand-section"><summary class="expand-toggle">Show ${entries.length - 1} more</summary><div>${entries.slice(1).join('')}</div></details>`;
  }
  totalEl.textContent = 'Total: ' + formatDuration(total);
}

let accumMinutes = 0;

function accumTime(mins) {
  accumMinutes += mins;
  document.getElementById('accumDisplay').textContent = formatDuration(accumMinutes);
}

function resetAccumTime() {
  accumMinutes = 0;
  document.getElementById('accumDisplay').textContent = '';
}

async function commitTime() {
  if (!editingId || accumMinutes <= 0) return;
  const minutes = accumMinutes;
  resetAccumTime();
  const now = new Date().toISOString();
  const entry = { task_id: editingId, duration_minutes: minutes, logged: false, created_at: now, started_at: now, ended_at: now };
  try {
    const result = await sbWrite('time_logs', 'POST', null, entry);
    if (result && result[0]) currentTimeLogs.push(result[0]);
    else currentTimeLogs.push(entry);
    logActivity(editingId, 'time logged', formatDuration(minutes));
    renderTimeLogs();
    setStatus('✓ +' + formatDuration(minutes), 'var(--green)'); setTimeout(() => setStatus('● live', 'var(--green)'), 1500);
  } catch(e) { alert('Failed to log time: ' + e.message); }
}
async function logActivity(taskId, action, detail) {
  try { await sbWrite('activity', 'POST', null, { task_id: taskId, action, detail }); } catch(e) {}
}

function renderActivity() {
  const el = document.getElementById('activityList');
  if (!currentActivity.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">No activity yet</div>';
    return;
  }
  const entries = currentActivity.map(a =>
    `<div class="activity-item"><span class="activity-dot"></span><span class="activity-text"><strong>${a.action}</strong>${a.detail ? ' — ' + escHtml(a.detail) : ''}</span><span class="activity-time">${timeAgo(a.created_at)}</span></div>`
  );
  if (entries.length <= 1) {
    el.innerHTML = entries.join('');
  } else {
    el.innerHTML = entries[0] + `<details class="expand-section"><summary class="expand-toggle">Show ${entries.length - 1} more</summary><div>${entries.slice(1).join('')}</div></details>`;
  }
}

function renderAttachments() {
  const el = document.getElementById('attachmentsList');
  if (!currentAttachments.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">No attachments yet</div>';
    return;
  }
  el.innerHTML = currentAttachments.map(a =>
    `<div class="attachment-item">
      <a href="${escHtml(a.url)}" target="_blank" rel="noopener" class="attachment-link">🔗 ${escHtml(a.label || a.url)}</a>
      <button class="attachment-delete" onclick="deleteAttachment('${a.id}')">×</button>
    </div>`
  ).join('');
}

async function addAttachment() {
  const labelInput = document.getElementById('attachLabel');
  const urlInput = document.getElementById('attachUrl');
  const url = urlInput.value.trim();
  const label = labelInput.value.trim() || url;
  if (!url || !editingId) return;
  try {
    const result = await sbWrite('attachments', 'POST', null, { task_id: editingId, label, url });
    if (result && result[0]) currentAttachments.push(result[0]);
    logActivity(editingId, 'attached', label);
    renderAttachments();
    labelInput.value = ''; urlInput.value = '';
  } catch(e) { alert('Failed to add attachment: ' + e.message); }
}

async function deleteAttachment(id) {
  try {
    await sbDelete('attachments', id);
    currentAttachments = currentAttachments.filter(a => a.id !== id);
    renderAttachments();
  } catch(e) { alert('Failed to delete: ' + e.message); }
}

function renderTags() {
  const el = document.getElementById('tagsList');
  el.innerHTML = currentTags.map(t =>
    `<span class="badge badge-tag">${escHtml(t)} <button onclick="removeTag('${escAttr(t)}')" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;padding:0 2px">×</button></span>`
  ).join('');
}

function addTag() {
  const input = document.getElementById('tagInput');
  const tag = input.value.trim().toLowerCase();
  if (!tag || currentTags.includes(tag)) { input.value = ''; return; }
  currentTags.push(tag);
  renderTags();
  input.value = '';
}

function removeTag(tag) {
  currentTags = currentTags.filter(t => t !== tag);
  renderTags();
}

function populateTagFilter() {
  const allTags = new Set();
  items.forEach(i => (i.tags || []).forEach(t => allTags.add(t)));
  const select = document.getElementById('filterTag');
  const current = select.value;
  select.innerHTML = '<option value="">All tags</option>' + [...allTags].sort().map(t => `<option${t===current?' selected':''}>${escHtml(t)}</option>`).join('');
}

// ── Parent Task ──
// ── Linked Tasks ──
function renderLinkedTasks() {
  const el = document.getElementById('linkedTasksList');
  if (!currentLinkedTasks.length) {
    el.innerHTML = '<span style="color:var(--muted);font-size:12px">No linked tasks</span>';
    return;
  }
  el.innerHTML = currentLinkedTasks.map(id => {
    const t = items.find(i => i.id === id);
    const label = t ? `<span class="search-result-id">#${t._seq||t.id}</span> ${escHtml(t.title)}` : id;
    return `<span class="linked-task-pill">${label} <button onclick="unlinkTask('${id}')">×</button></span>`;
  }).join('');
}

function searchLinkedTasks() {
  const q = document.getElementById('linkSearchInput').value.toLowerCase().trim();
  const el = document.getElementById('linkSearchResults');
  if (!q) { el.innerHTML = ''; return; }
  const results = items.filter(i =>
    i.id !== editingId && !currentLinkedTasks.includes(i.id) &&
    (i.title.toLowerCase().includes(q) || (i._seq && i._seq.includes(q)))
  ).slice(0, 5);
  el.innerHTML = results.map(i =>
    `<div class="search-result-item" onclick="linkTask('${i.id}')"><span class="search-result-id">#${i._seq||i.id}</span> ${escHtml(i.title)}</div>`
  ).join('') || '<div class="search-result-item" style="color:var(--muted)">No results</div>';
}

// ── Browse-to-link overlay ──
function openLinkBrowser() {
  const overlay = document.getElementById('linkBrowserOverlay');
  const cols = document.getElementById('linkBrowserCols');
  const statuses = ['backlog', 'in_progress', 'action', 'review', 'done'];
  const labels = { backlog: '📋 Backlog', in_progress: '⚡ In Progress', action: '🎯 Action', review: '👁 Review', done: '✓ Done' };
  const eligible = items.filter(i => i.id !== editingId && !currentLinkedTasks.includes(i.id));

  cols.innerHTML = statuses.map(s => {
    const col = eligible.filter(i => i.status === s);
    if (!col.length) return '';
    return `<div class="lb-col">
      <div class="lb-col-header">${labels[s]} <span class="lb-col-count">${col.length}</span></div>
      ${col.map(i => `<div class="lb-card" onclick="confirmLinkFromBrowser('${i.id}')">
        <div class="lb-card-id">#${i._seq||i.id}</div>
        <div class="lb-card-title">${escHtml(i.title)}</div>
        <div class="lb-card-meta"><span class="badge badge-cat">${i.category||''}</span><span class="badge badge-priority-${i.priority}">${i.priority||''}</span></div>
      </div>`).join('')}
    </div>`;
  }).join('');

  overlay.style.display = 'flex';
}

function closeLinkBrowser() {
  document.getElementById('linkBrowserOverlay').style.display = 'none';
  document.getElementById('linkConfirmDialog').style.display = 'none';
}

function confirmLinkFromBrowser(targetId) {
  const t = items.find(i => i.id === targetId);
  if (!t) return;
  const dialog = document.getElementById('linkConfirmDialog');
  dialog.querySelector('.lc-task-id').textContent = '#' + (t._seq || t.id);
  dialog.querySelector('.lc-task-title').textContent = t.title;
  dialog.querySelector('.lc-confirm-btn').onclick = async () => {
    dialog.style.display = 'none';
    await linkTask(targetId);
    closeLinkBrowser();
  };
  dialog.querySelector('.lc-cancel-btn').onclick = () => { dialog.style.display = 'none'; };
  dialog.style.display = 'flex';
}

async function linkTask(linkedId) {
  if (!editingId) return;
  try {
    // Only write the outbound row — editingId is the initiator (parent of link)
    await sbWrite('task_links', 'POST', null, { task_id: editingId, linked_task_id: linkedId });
    currentLinkedTasks.push(linkedId);
    // Update in-memory: editingId gains an outLink, linkedId gains an inLink
    const a = items.find(i => i.id === editingId);
    const b = items.find(i => i.id === linkedId);
    if (a) { a._outLinks = a._outLinks || []; if (!a._outLinks.includes(linkedId)) a._outLinks.push(linkedId); }
    if (b) { b._inLinks  = b._inLinks  || []; if (!b._inLinks.includes(editingId))  b._inLinks.push(editingId); }
    renderLinkedTasks();
    renderCurrent();
    document.getElementById('linkSearchInput').value = '';
    document.getElementById('linkSearchResults').innerHTML = '';
  } catch(e) { alert('Failed to link: ' + e.message); }
}

async function unlinkTask(linkedId) {
  if (!editingId) return;
  try {
    // Delete the single outbound row
    await fetch(`${SB_URL}/rest/v1/task_links?task_id=eq.${editingId}&linked_task_id=eq.${linkedId}`, { method: 'DELETE', headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` } });
    currentLinkedTasks = currentLinkedTasks.filter(id => id !== linkedId);
    // Update in-memory
    const a = items.find(i => i.id === editingId);
    const b = items.find(i => i.id === linkedId);
    if (a) { a._outLinks = (a._outLinks || []).filter(id => id !== linkedId); }
    if (b) { b._inLinks  = (b._inLinks  || []).filter(id => id !== editingId); }
    renderLinkedTasks();
    renderCurrent();
  } catch(e) { alert('Failed to unlink: ' + e.message); }
}


function switchView(v) {
  currentView = v;
  document.getElementById('kanbanView').style.display = v === 'kanban' ? 'flex' : 'none';
  document.getElementById('calendarView').style.display = v === 'calendar' ? 'block' : 'none';
  document.getElementById('tabKanban').classList.toggle('active', v === 'kanban');
  document.getElementById('tabCalendar').classList.toggle('active', v === 'calendar');
  if (v === 'calendar') renderCalendar();
}

let calViewMode = 'month';
let calDay = todayDate.getDate();

function setCalView(mode) {
  calViewMode = mode;
  document.getElementById('calViewDay').classList.toggle('active', mode === 'day');
  document.getElementById('calViewWeek').classList.toggle('active', mode === 'week');
  document.getElementById('calViewMonth').classList.toggle('active', mode === 'month');
  document.getElementById('calDayView').style.display = mode === 'day' ? 'block' : 'none';
  document.getElementById('calWeekView').style.display = mode === 'week' ? 'block' : 'none';
  document.getElementById('calMonthView').style.display = mode === 'month' ? 'block' : 'none';
  renderCalendar();
}

function renderCalendar() {
  if (calViewMode === 'month') renderCalMonth();
  else if (calViewMode === 'week') renderCalWeek();
  else renderCalDay();
}

function getTaskDate(it) {
  return (it.deadline || it.created_at || '').substring(0, 10);
}

function calItemHTML(it) {
  const cls = !it.deadline ? 'cal-item' : (new Date(it.deadline).getTime() < Date.now() ? 'cal-item cal-item-overdue' : 'cal-item cal-item-future');
  return `<div class="${cls}" onclick="openModal('${it.id}')" title="${escHtml(it.title)}">${escHtml(it.title)}</div>`;
}

function renderCalMonth() {
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
    const dayItems = items.filter(it => it.status !== 'archived' && getTaskDate(it) === dateStr);
    cells += `<div class="cal-cell${isOther?' other-month':''}${isToday?' today':''}">
      <div class="cal-date">${day}</div>
      ${dayItems.slice(0,3).map(it => calItemHTML(it)).join('')}
      ${dayItems.length > 3 ? `<div style="font-size:10px;color:var(--muted)">+${dayItems.length-3} more</div>` : ''}
    </div>`;
  }
  grid.innerHTML = cells;
}

function renderCalWeek() {
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const current = new Date(calYear, calMonth, calDay);
  const dayOfWeek = current.getDay();
  const weekStart = new Date(current);
  weekStart.setDate(current.getDate() - dayOfWeek);

  const todayStr = todayDate.getFullYear() + '-' + String(todayDate.getMonth()+1).padStart(2,'0') + '-' + String(todayDate.getDate()).padStart(2,'0');
  const startStr = weekStart.toLocaleDateString('en-ZA', {day:'numeric',month:'short'});
  const endDate = new Date(weekStart); endDate.setDate(weekStart.getDate() + 6);
  const endStr = endDate.toLocaleDateString('en-ZA', {day:'numeric',month:'short',year:'numeric'});
  document.getElementById('calTitle').textContent = startStr + ' – ' + endStr;

  let headerHTML = '';
  let gridHTML = '';
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    const dateStr = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    const isToday = dateStr === todayStr;
    const dayItems = items.filter(it => it.status !== 'archived' && getTaskDate(it) === dateStr);
    headerHTML += `<div class="cal-day-name${isToday?' cal-day-today':''}">${dayNames[i]} ${d.getDate()}</div>`;
    gridHTML += `<div class="cal-week-cell${isToday?' today':''}">
      ${dayItems.map(it => calItemHTML(it)).join('')}
      ${!dayItems.length ? '<div style="color:var(--muted);font-size:11px;text-align:center;padding:20px 0">—</div>' : ''}
    </div>`;
  }
  document.getElementById('calWeekHeader').innerHTML = headerHTML;
  document.getElementById('calWeekGrid').innerHTML = gridHTML;
}

function renderCalDay() {
  const current = new Date(calYear, calMonth, calDay);
  const dateStr = current.getFullYear() + '-' + String(current.getMonth()+1).padStart(2,'0') + '-' + String(current.getDate()).padStart(2,'0');
  const dayName = current.toLocaleDateString('en-ZA', {weekday:'long',day:'numeric',month:'long',year:'numeric'});
  document.getElementById('calTitle').textContent = dayName;

  const dayItems = items.filter(it => it.status !== 'archived' && getTaskDate(it) === dateStr);
  const el = document.getElementById('calDayView');
  if (!dayItems.length) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">No tasks for this day</div>';
    return;
  }
  el.innerHTML = dayItems.map(it => {
    const cls = !it.deadline ? '' : (new Date(it.deadline).getTime() < Date.now() ? ' cal-day-item-overdue' : ' cal-day-item-future');
    const deadline = it.deadline ? new Date(it.deadline).toLocaleTimeString('en-ZA', {hour:'2-digit',minute:'2-digit'}) : '';
    return `<div class="cal-day-item${cls}" onclick="openModal('${it.id}')">
      <div class="cal-day-item-title">${escHtml(it.title)}</div>
      <div class="cal-day-item-meta">
        <span class="badge badge-cat">${it.category||''}</span>
        <span class="badge badge-priority-${it.priority}">${it.priority||''}</span>
        ${deadline ? `<span style="color:var(--muted);font-size:11px">⏰ ${deadline}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

function calPrev() {
  if (calViewMode === 'month') { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } }
  else if (calViewMode === 'week') { calDay -= 7; normalizeCalDate(); }
  else { calDay -= 1; normalizeCalDate(); }
  renderCalendar();
}
function calNext() {
  if (calViewMode === 'month') { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } }
  else if (calViewMode === 'week') { calDay += 7; normalizeCalDate(); }
  else { calDay += 1; normalizeCalDate(); }
  renderCalendar();
}
function calToday() {
  calYear = todayDate.getFullYear(); calMonth = todayDate.getMonth(); calDay = todayDate.getDate();
  renderCalendar();
}
function normalizeCalDate() {
  const d = new Date(calYear, calMonth, calDay);
  calYear = d.getFullYear(); calMonth = d.getMonth(); calDay = d.getDate();
}

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

function escAttr(s) { return String(s||'').replace(/'/g,'&#39;').replace(/"/g,'&quot;'); }

function expandSummary(id) {
  const s = summaries.find(x => x.id === id);
  if (!s) return;
  const time = s.created_at ? new Date(s.created_at).toLocaleString('en-ZA', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}) : '';
  const source = s.summary_source || '';
  const scanType = s.scan_type || 'scan';

  document.getElementById('summaryExpandTitle').textContent = (source ? source + ' • ' : '') + scanType;
  document.getElementById('summaryExpandBody').innerHTML = `
    <div style="margin-bottom:16px">
      <div style="color:var(--muted);font-size:12px;margin-bottom:8px">${time}</div>
      <div style="font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word">${escHtml(s.content || '')}</div>
    </div>
    ${s.tasks_added ? `<div style="margin-top:12px;padding:10px;background:var(--surface2);border-radius:6px;font-size:13px">✓ <strong>${s.tasks_added} task${s.tasks_added===1?'':'s'} created</strong> from this summary</div>` : ''}
    <div style="display:flex;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">
      <button class="review-approve-btn" style="padding:6px 12px;border-radius:6px;border:1px solid var(--green);background:transparent;cursor:pointer;font-size:12px" onclick="markSummaryRead('${escAttr(s.id)}');closeSummaryExpand()">✓ Mark as Read</button>
      <button style="padding:6px 12px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;font-size:12px" onclick="promoteToTask('${escAttr(s.id)}')">→ Create Task</button>
    </div>
  `;
  document.getElementById('summaryExpandOverlay').style.display = 'flex';
}

function closeSummaryExpand() {
  document.getElementById('summaryExpandOverlay').style.display = 'none';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('summaryExpandOverlay').style.display === 'flex') closeSummaryExpand();
  }
});

loadItems().then(() => startPolling());
