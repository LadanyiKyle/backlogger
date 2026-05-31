// ── BackLogger AI Chat — Grok-3-mini ────────────────────────────────────────

// API key is no longer used in the browser — requests go through the Vercel proxy
const GROK_KEY = '';
const GROK_URL = 'https://backlogger-8lntst0eh-kyleit.vercel.app/api/chat';
const GROK_MODEL = 'grok-3-mini';

let chatHistory = [];
let chatOpen = false;
let pendingFileContent = null;
let pendingFileName = null;

// ── PERSISTENCE ──────────────────────────────────────────────────────────────

function saveChatHistory() {
  try { localStorage.setItem('backlogger_chat_history', JSON.stringify(chatHistory)); } catch(e) {}
}

function restoreChatUI() {
  if (!chatHistory.length) return;
  const msgs = document.getElementById('aiMessages');
  if (!msgs) return;
  // Clear the default welcome message
  msgs.innerHTML = '';
  chatHistory.forEach(m => {
    const div = document.createElement('div');
    div.className = `ai-message ai-message-${m.role}`;
    div.innerHTML = `<div class="ai-bubble">${escHtml(m.content)}</div>`;
    msgs.appendChild(div);
  });
  msgs.scrollTop = msgs.scrollHeight;
}

// Load persisted history on init
(function initChatHistory() {
  const saved = localStorage.getItem('backlogger_chat_history');
  if (saved) {
    try {
      chatHistory = JSON.parse(saved);
      // Restore UI once DOM is ready
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', restoreChatUI);
      } else {
        restoreChatUI();
      }
    } catch(e) { chatHistory = []; }
  }
})();

// ── UI ───────────────────────────────────────────────────────────────────────

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById('aiChatPanel').classList.toggle('open', chatOpen);
  if (chatOpen) {
    setTimeout(() => document.getElementById('aiInput').focus(), 200);
  }
}

function clearChat() {
  chatHistory = [];
  localStorage.removeItem('backlogger_chat_history');
  const msgs = document.getElementById('aiMessages');
  msgs.innerHTML = `<div class="ai-message ai-message-assistant">
    <div class="ai-bubble">Chat cleared. What can I help you with?</div>
  </div>`;
}

function sendSuggestion(el) {
  document.getElementById('aiInput').value = el.textContent;
  sendChat();
}

// ── FILE UPLOAD ──────────────────────────────────────────────────────────────

// Dynamically load mammoth.js for .docx extraction (loaded once on first use)
let mammothLoaded = false;
function loadMammoth() {
  return new Promise((resolve, reject) => {
    if (mammothLoaded || window.mammoth) { mammothLoaded = true; return resolve(); }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
    script.onload = () => { mammothLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load mammoth.js'));
    document.head.appendChild(script);
  });
}

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  const maxSize = 5 * 1024 * 1024; // 5MB
  if (file.size > maxSize) {
    appendMessage('assistant', `That file is too large (${(file.size/1024/1024).toFixed(1)}MB). Try a smaller doc or paste the text directly.`);
    return;
  }

  const name = file.name.toLowerCase();

  // ── .docx — use mammoth for proper text extraction ──
  if (name.endsWith('.docx') || name.endsWith('.doc')) {
    appendMessage('assistant', `Reading ${file.name}…`);
    try {
      await loadMammoth();
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      if (result.value && result.value.trim().length > 20) {
        setFileContext(file.name, result.value.trim());
        // Remove the "reading" message
        const msgs = document.getElementById('aiMessages');
        if (msgs.lastChild) msgs.removeChild(msgs.lastChild);
      } else {
        appendMessage('assistant', `Couldn't extract text from this Word doc. Try saving as .txt and uploading again.`);
      }
    } catch(e) {
      appendMessage('assistant', `Error reading Word doc: ${e.message}`);
    }
    return;
  }

  // ── .pdf — heuristic binary extraction ──
  if (name.endsWith('.pdf')) {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result;
      const textMatches = raw.match(/\(([^)]{3,})\)/g);
      if (textMatches && textMatches.length > 10) {
        const extracted = textMatches.map(m => m.slice(1,-1)).join(' ').replace(/\\[rn]/g,' ').trim();
        setFileContext(file.name, extracted);
      } else {
        appendMessage('assistant', `Couldn't extract text from this PDF. Try saving it as .txt and uploading again.`);
      }
    };
    reader.readAsBinaryString(file);
    return;
  }

  // ── Plain text / markdown / csv ──
  const reader = new FileReader();
  reader.onload = () => setFileContext(file.name, reader.result);
  reader.readAsText(file);
}

function setFileContext(name, content) {
  pendingFileName = name;
  // Truncate to ~15000 chars (~4000 tokens) — enough for detailed meeting notes
  pendingFileContent = content.substring(0, 15000);

  // Show file pill in chat
  const msgs = document.getElementById('aiMessages');
  const pill = document.createElement('div');
  pill.className = 'ai-message ai-message-user';
  pill.id = 'aiFilePill';
  pill.innerHTML = `<div class="ai-file-pill">
    📄 <strong>${escHtml(name)}</strong> ready
    <button onclick="clearFileContext()" title="Remove">×</button>
  </div>`;
  msgs.appendChild(pill);
  msgs.scrollTop = msgs.scrollHeight;

  // Pre-fill input with suggestion
  const input = document.getElementById('aiInput');
  input.value = 'Summarise this doc and create tasks from all action items, grouped by urgency';
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  input.focus();
}

function clearFileContext() {
  pendingFileName = null;
  pendingFileContent = null;
  const pill = document.getElementById('aiFilePill');
  if (pill) pill.remove();
}

function appendMessage(role, content, actionPill) {
  const msgs = document.getElementById('aiMessages');
  const div = document.createElement('div');
  div.className = `ai-message ai-message-${role}`;
  let html = `<div class="ai-bubble">${escHtml(content)}</div>`;
  if (actionPill) html += `<div class="ai-action-pill">✓ ${escHtml(actionPill)}</div>`;
  div.innerHTML = html;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function showTyping() {
  const msgs = document.getElementById('aiMessages');
  const div = document.createElement('div');
  div.className = 'ai-message ai-message-assistant';
  div.id = 'aiTyping';
  div.innerHTML = `<div class="ai-typing"><span></span><span></span><span></span></div>`;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('aiTyping');
  if (el) el.remove();
}

// ── SEND ─────────────────────────────────────────────────────────────────────

async function sendChat() {
  const input = document.getElementById('aiInput');
  const userMsg = input.value.trim();
  if (!userMsg) return;

  input.value = '';
  input.style.height = 'auto';
  document.getElementById('aiSendBtn').disabled = true;

  appendMessage('user', userMsg);

  // Build context from current tasks
  const taskContext = buildTaskContext();

  // Build full message — inject file content if attached
  let fullUserMsg = userMsg;
  if (pendingFileContent) {
    fullUserMsg = `${userMsg}\n\n--- ATTACHED DOCUMENT: ${pendingFileName} ---\n${pendingFileContent}\n--- END DOCUMENT ---`;
    clearFileContext();
  }

  // Add to history
  chatHistory.push({ role: 'user', content: fullUserMsg });

  showTyping();

  try {
    const systemPrompt = `You are BackLogger AI — Kyle's sharp personal productivity assistant (kyle@exonic.co.za). Kyle is a PM/project owner at Exonic, a software consultancy based in South Africa.

Today's date: ${new Date().toLocaleDateString('en-ZA', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}

── CURRENT TASK BOARD ──
${taskContext}

── YOUR CAPABILITIES ──
You can answer questions about tasks, give summaries, suggest priorities, and CREATE or UPDATE tasks directly on Kyle's board. You also process uploaded documents — meeting notes, emails, briefs, specs — and extract every concrete action item from them.

── WHEN PROCESSING A DOCUMENT ──
Read the full document carefully. Extract ALL explicit and implicit action items. For each one:
- Write a concise, verb-first task title (e.g. "Send rebaseline deck to Scott", "Research KYC compliance obligations")
- Include a description with: what needs to be done, who owns it, any deadline or context from the doc
- Assign priority: critical (blocker/imminent deadline), high (this week), medium (this sprint), low (later)
- Assign the right category: client | internal | research | training | trading | todo | meetings
- Do NOT lump everything into generic tasks like "Review meeting notes" — extract the actual work items
- Group your text summary by urgency (immediate, this week, this sprint, ongoing) before the action block
- If a person is named as owner, put their name in the description
- If a date or deadline is mentioned, include it in the description

── ACTIONS ──
To create one task, include at the END of your response:
\`\`\`action
{"type":"create_task","title":"...","description":"...","category":"client|internal|research|training|trading|todo|meetings","priority":"critical|high|medium|low","status":"backlog","source":"AI Chat"}
\`\`\`

To create multiple tasks at once (preferred for documents):
\`\`\`action
{"type":"create_tasks","tasks":[{"title":"...","description":"...","category":"...","priority":"critical|high|medium|low","status":"backlog","source":"AI Chat"}]}
\`\`\`

To update a task status:
\`\`\`action
{"type":"update_status","id":"...","status":"backlog|in_progress|done"}
\`\`\`

── RULES ──
- Only include an action block if Kyle is explicitly asking you to add/create/update something
- Be direct, specific, and thorough — vague tasks are useless
- Keep your text response clean — no excessive markdown, just clear prose or grouped plain-text lists
- Always confirm what you created at the end`;


    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory
    ];

    const res = await fetch(GROK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages,
        max_tokens: 2048,
        temperature: 0.4
      })
    });

    if (!res.ok) throw new Error(`Grok API error: ${res.status}`);
    const data = await res.json();
    const fullResponse = data.choices[0].message.content;

    // Parse out action block if present
    const actionMatch = fullResponse.match(/```action\n([\s\S]*?)\n```/);
    let displayText = fullResponse.replace(/```action[\s\S]*?```/g, '').trim();
    let actionPill = null;

    if (actionMatch) {
      try {
        const action = JSON.parse(actionMatch[1]);
        actionPill = await executeAction(action);
      } catch(e) {
        console.error('Action parse/execute failed:', e);
      }
    }

    removeTyping();
    appendMessage('assistant', displayText, actionPill);

    // Add assistant response to history (without action block)
    chatHistory.push({ role: 'assistant', content: displayText });

    // Keep history manageable (last 20 messages)
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);

    // Persist to localStorage
    saveChatHistory();

  } catch(e) {
    removeTyping();
    appendMessage('assistant', 'Sorry, I ran into an error: ' + e.message);
    console.error('Chat error:', e);
  }

  document.getElementById('aiSendBtn').disabled = false;
  document.getElementById('aiInput').focus();
}

// ── EXECUTE ACTIONS ──────────────────────────────────────────────────────────

async function executeAction(action) {
  if (action.type === 'create_task') {
    const task = {
      id: 'AI' + Date.now().toString(36).toUpperCase(),
      title: action.title,
      description: action.description || '',
      category: action.category || 'todo',
      priority: action.priority || 'medium',
      status: action.status || 'backlog',
      source: action.source || 'AI Chat',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const result = await sbWrite('tasks', 'POST', null, task);
    const created = result && result[0] ? result[0] : task;
    created._seenByUser = false;
    items.unshift(created);
    renderCurrent();
    return `Task created: "${task.title}"`;
  }

  if (action.type === 'create_tasks' && Array.isArray(action.tasks)) {
    let count = 0;
    for (const t of action.tasks) {
      const task = {
        id: 'AI' + Date.now().toString(36).toUpperCase() + count,
        title: t.title,
        description: t.description || '',
        category: t.category || 'todo',
        priority: t.priority || 'medium',
        status: t.status || 'backlog',
        source: t.source || 'AI Chat',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const result = await sbWrite('tasks', 'POST', null, task);
      const created = result && result[0] ? result[0] : task;
      created._seenByUser = false;
      items.unshift(created);
      count++;
    }
    renderCurrent();
    return `${count} tasks created`;
  }

  if (action.type === 'update_status') {
    const item = items.find(i => i.id === action.id);
    if (!item) return null;
    const oldStatus = item.status;
    item.status = action.status;
    await sbWrite('tasks', 'PATCH', action.id, { status: action.status, updated_at: new Date().toISOString() });
    logActivity(action.id, 'moved', `${oldStatus} → ${action.status}`);
    renderCurrent();
    return `"${item.title}" moved to ${action.status}`;
  }

  return null;
}

// ── CONTEXT BUILDER ──────────────────────────────────────────────────────────

function buildTaskContext() {
  if (!items || !items.length) return 'No tasks currently on the board.';

  const byStatus = { backlog: [], in_progress: [], done: [] };
  items.forEach(i => {
    const s = i.status || 'backlog';
    if (byStatus[s]) byStatus[s].push(i);
  });

  const fmt = (list) => list.map(i =>
    `  [${i.id}] ${i.title} (${i.priority}, ${i.category})${i.description ? ' — ' + i.description.substring(0, 80) : ''}`
  ).join('\n');

  return `BACKLOG (${byStatus.backlog.length} tasks):
${byStatus.backlog.length ? fmt(byStatus.backlog) : '  (empty)'}

IN PROGRESS (${byStatus.in_progress.length} tasks):
${byStatus.in_progress.length ? fmt(byStatus.in_progress) : '  (empty)'}

DONE (${byStatus.done.length} tasks):
${byStatus.done.length ? fmt(byStatus.done.slice(0, 10)) : '  (empty)'}${byStatus.done.length > 10 ? `\n  ... and ${byStatus.done.length - 10} more` : ''}`;
}
