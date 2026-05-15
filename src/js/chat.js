// ── BackLogger AI Chat — Grok-3-mini ────────────────────────────────────────

// Set your xAI Grok API key in config.js (see config.example.js — not committed to git)
const GROK_KEY = window.BACKLOGGER_CONFIG && window.BACKLOGGER_CONFIG.grokKey ? window.BACKLOGGER_CONFIG.grokKey : '';
const GROK_URL = 'https://api.x.ai/v1/chat/completions';
const GROK_MODEL = 'grok-3-mini';

let chatHistory = [];
let chatOpen = false;

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
  const msgs = document.getElementById('aiMessages');
  msgs.innerHTML = `<div class="ai-message ai-message-assistant">
    <div class="ai-bubble">Chat cleared. What can I help you with?</div>
  </div>`;
}

function sendSuggestion(el) {
  document.getElementById('aiInput').value = el.textContent;
  sendChat();
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

  // Add to history
  chatHistory.push({ role: 'user', content: userMsg });

  showTyping();

  try {
    const systemPrompt = `You are BackLogger AI, a personal productivity assistant for Kyle (kyle@exonic.co.za).
You have access to Kyle's current task board. Here is the current state:

${taskContext}

You can answer questions about tasks, give summaries, suggest priorities, and CREATE or UPDATE tasks.

When you want to perform an action on the board, include a JSON block at the END of your response in this exact format:

\`\`\`action
{"type":"create_task","title":"...","description":"...","category":"client|internal|research|training|trading|todo|meetings","priority":"critical|high|medium|low","status":"backlog|in_progress|done","source":"AI Chat"}
\`\`\`

Or to update a task status:
\`\`\`action
{"type":"update_status","id":"...","status":"backlog|in_progress|done"}
\`\`\`

Or to create multiple tasks at once:
\`\`\`action
{"type":"create_tasks","tasks":[{"title":"...","description":"...","category":"...","priority":"...","status":"backlog","source":"AI Chat"}]}
\`\`\`

Rules:
- Only include an action block if the user is explicitly asking you to add/create/update something
- Keep task titles concise and actionable (start with a verb)
- Be conversational, direct, and helpful
- Format your text response cleanly — no markdown headers, just clear prose
- If summarising tasks, use plain text not bullet markdown
- Today's date is ${new Date().toLocaleDateString('en-ZA', {weekday:'long',year:'numeric',month:'long',day:'numeric'})}`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...chatHistory
    ];

    const res = await fetch(GROK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROK_KEY}`
      },
      body: JSON.stringify({
        model: GROK_MODEL,
        messages,
        max_tokens: 1024,
        temperature: 0.7
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
      items.unshift(result && result[0] ? result[0] : task);
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
