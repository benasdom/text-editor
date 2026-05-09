/* ─────────────────────────────────────────
   PROSE EDITOR — script.js
   All state lives in localStorage under key
   'prose_docs' (array of doc objects) and
   'prose_active' (id of current doc).
───────────────────────────────────────── */

const STORAGE_KEY = 'prose_docs';
const ACTIVE_KEY  = 'prose_active';

// ── DOM refs ──────────────────────────────
const editor        = document.getElementById('editor');
const docTitle      = document.getElementById('docTitle');
const docMeta       = document.getElementById('docMeta');
const toolbar       = document.getElementById('toolbar');
const findBar       = document.getElementById('findBar');
const findInput     = document.getElementById('findInput');
const findCount     = document.getElementById('findCount');
const docsPanel     = document.getElementById('docsPanel');
const panelOverlay  = document.getElementById('panelOverlay');
const docsList      = document.getElementById('docsList');
const docsEmpty     = document.getElementById('docsEmpty');
const docCount      = document.getElementById('docCount');
const panelSearch   = document.getElementById('panelSearch');
const currentLabel  = document.getElementById('currentDocLabel');
const autosaveDot   = document.getElementById('autosaveDot');
const toast         = document.getElementById('toast');
const themeToggle   = document.getElementById('themeToggle');

// Stats
const statWords = document.getElementById('statWords');
const statChars = document.getElementById('statChars');
const statLines = document.getElementById('statLines');
const statRead  = document.getElementById('statRead');

// ── State ─────────────────────────────────
let activeDocId    = null;
let saveTimer      = null;
let findMatches    = [];
let findIndex      = 0;
let activeColor    = '#f0f0f5';
let undoStack      = [];
let redoStack      = [];
let lastSavedHTML  = '';

// ── Helpers ───────────────────────────────
function genId() {
  return 'doc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function loadDocs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveDocs(docs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
}

function getDoc(id) {
  return loadDocs().find(d => d.id === id) || null;
}

function fmt(date) {
  const d = new Date(date);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
}

function countWords(text) {
  return text.trim() ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className   = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = 'toast'; }, 2600);
}

// ── Theme ─────────────────────────────────
(function initTheme() {
  const saved = localStorage.getItem('prose_theme') || 'dark';
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
})();

themeToggle.addEventListener('click', () => {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  document.documentElement.setAttribute('data-theme', isLight ? 'dark' : 'light');
  localStorage.setItem('prose_theme', isLight ? 'dark' : 'light');
});

// ── Custom cursor ─────────────────────────
(function initCursor() {
  const cur  = document.getElementById('cursor');
  const ring = document.getElementById('cursor-ring');
  if (!cur || !ring) return;

  let mx = 0, my = 0;   // mouse actual position
  let rx = 0, ry = 0;   // ring lagged position

  // Track real mouse position instantly
  document.addEventListener('mousemove', e => {
    mx = e.clientX;
    my = e.clientY;
    cur.style.left = mx + 'px';
    cur.style.top  = my + 'px';
  });

  // Ring follows with lerp via RAF
  function animateRing() {
    rx += (mx - rx) * 0.10;
    ry += (my - ry) * 0.10;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
    requestAnimationFrame(animateRing);
  }
  animateRing();

  // Grow on interactive elements
  const interactiveSelector = 'a, button, input, select, textarea, [contenteditable], .c-dot, .doc-item, .tb-btn, .nav-btn';
  document.addEventListener('mouseover', e => {
    if (e.target.closest(interactiveSelector)) {
      cur.classList.add('hovered');
      ring.classList.add('hovered');
    }
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest(interactiveSelector)) {
      cur.classList.remove('hovered');
      ring.classList.remove('hovered');
    }
  });
})();

// ── Document CRUD ─────────────────────────
function newDoc() {
    if(!confirm("Create a new empty document?")){
        return false
    }
  const doc = {
    id:       genId(),
    title:    '',
    content:  '',
    created:  Date.now(),
    updated:  Date.now(),
    words:    0,
  };
  const docs = loadDocs();
  docs.unshift(doc);
  saveDocs(docs);
  openDoc(doc.id);
  renderDocsList();
  closePanel();
  docTitle.focus();
}

function openDoc(id) {
  const doc = getDoc(id);
  if (!doc) return;
  activeDocId     = id;
  lastSavedHTML   = doc.content;
  localStorage.setItem(ACTIVE_KEY, id);

  docTitle.value  = doc.title;
  editor.innerHTML = doc.content;

  updateStats();
  updateMeta(doc);
  currentLabel.textContent = doc.title || 'Untitled document';

  undoStack = [];
  redoStack = [];
  renderDocsList();
}

function saveCurrentDoc(silent = false) {
  if (!activeDocId) {
    // Auto-create doc if there's content
    const text = editor.innerText.trim();
    const title = docTitle.value.trim();
    if (!text && !title) return;
    activeDocId = genId();
    localStorage.setItem(ACTIVE_KEY, activeDocId);
  }

  const docs = loadDocs();
  const idx  = docs.findIndex(d => d.id === activeDocId);
  const now  = Date.now();
  const text = editor.innerText.trim();
  const words = countWords(text);
  const html  = editor.innerHTML;

  const doc = {
    id:      activeDocId,
    title:   docTitle.value.trim() || 'Untitled document',
    content: html,
    created: idx >= 0 ? docs[idx].created : now,
    updated: now,
    words:   words,
  };

  if (idx >= 0) {
    docs[idx] = doc;
  } else {
    docs.unshift(doc);
  }

  saveDocs(docs);
  lastSavedHTML = html;

  autosaveDot.classList.add('saved');
  setTimeout(() => autosaveDot.classList.remove('saved'), 2000);

  currentLabel.textContent = doc.title;
  updateMeta(doc);
  renderDocsList();

  if (!silent) showToast('Document saved', 'success');
}

function deleteDoc(id) {
  if (!confirm('Delete this document? This cannot be undone.')) return;
  let docs = loadDocs().filter(d => d.id !== id);
  saveDocs(docs);
  if (activeDocId === id) {
    activeDocId = null;
    localStorage.removeItem(ACTIVE_KEY);
    docTitle.value = '';
    editor.innerHTML = '';
    docMeta.textContent = 'New document';
    currentLabel.textContent = 'No document open';
    updateStats();
  }
  renderDocsList();
  showToast('Document deleted', 'error');
}

function duplicateDoc(id) {
  const src = getDoc(id);
  if (!src) return;
  const docs = loadDocs();
  const copy = {
    id:      genId(),
    title:   (src.title || 'Untitled') + ' (copy)',
    content: src.content,
    created: Date.now(),
    updated: Date.now(),
    words:   src.words,
  };
  docs.unshift(copy);
  saveDocs(docs);
  renderDocsList();
  openDoc(copy.id);
  closePanel();
  showToast('Document duplicated', 'success');
}

// ── Render docs list ──────────────────────
function renderDocsList(filter = '') {
  const docs = loadDocs();
  const query = filter.toLowerCase();
  const filtered = query
    ? docs.filter(d => (d.title || '').toLowerCase().includes(query) || (d.content || '').toLowerCase().includes(query))
    : docs;

  docCount.textContent = docs.length + ' saved';
  docsEmpty.style.display = filtered.length === 0 ? 'flex' : 'none';

  // Remove old doc items
  const old = docsList.querySelectorAll('.doc-item');
  old.forEach(el => el.remove());

  filtered.forEach(doc => {
    const div = document.createElement('div');
    div.className = 'doc-item' + (doc.id === activeDocId ? ' active' : '');
    div.dataset.id = doc.id;

    const stripped = doc.content.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    const preview  = stripped.slice(0, 80) + (stripped.length > 80 ? '…' : '');

    div.innerHTML = `
      <div class="doc-item-title">${doc.title || 'Untitled document'}</div>
      <div class="doc-item-preview">${preview || 'Empty document'}</div>
      <div class="doc-item-meta">
        <span>${doc.words} words</span>
        <span>·</span>
        <span>${fmt(doc.updated)}</span>
      </div>
      <div class="doc-item-actions">
        <button class="doc-action-btn" data-action="duplicate" data-id="${doc.id}" title="Duplicate">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" style="width:11px;height:11px">
            <rect x="1" y="3" width="8" height="10" rx="1.2"/>
            <rect x="4" y="1" width="8" height="10" rx="1.2"/>
          </svg>
        </button>
        <button class="doc-action-btn" data-action="delete" data-id="${doc.id}" title="Delete">
          <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" style="width:11px;height:11px">
            <polyline points="1 3 13 3"/><path d="M4 3V2h6v1"/><path d="M5 6v4M9 6v4"/><path d="M2 3l1 9h8l1-9"/>
          </svg>
        </button>
      </div>
    `;

    // Open on click (not on action buttons)
    div.addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (btn) {
        const action = btn.dataset.action;
        const id     = btn.dataset.id;
        if (action === 'delete') deleteDoc(id);
        if (action === 'duplicate') duplicateDoc(id);
        return;
      }
      openDoc(doc.id);
      closePanel();
    });

    docsList.appendChild(div);
  });
}

// ── Panel open/close ──────────────────────
function openPanel() {
  renderDocsList();
  docsPanel.classList.add('open');
  panelOverlay.classList.add('open');
}
function closePanel() {
  docsPanel.classList.remove('open');
  panelOverlay.classList.remove('open');
}

document.getElementById('btnDocs').addEventListener('click', openPanel);
document.getElementById('btnNew').addEventListener('click', newDoc);
document.getElementById('panelClose').addEventListener('click', closePanel);
panelOverlay.addEventListener('click', closePanel);

panelSearch.addEventListener('input', () => renderDocsList(panelSearch.value));

// ── Stats ─────────────────────────────────
function updateStats() {
  const text  = editor.innerText;
  const words = countWords(text);
  const chars = text.length;
  const lines = Math.max(1, editor.innerHTML.split(/<br|<\/div>|<\/p>|<\/h[1-6]>|<\/li>|<\/blockquote>/i).length);
  const mins  = words < 200 ? '<1 min' : Math.round(words / 200) + ' min';

  statWords.textContent = words;
  statChars.textContent = chars;
  statLines.textContent = lines;
  statRead.textContent  = mins;
}

function updateMeta(doc) {
  if (!doc) { docMeta.textContent = 'New document'; return; }
  docMeta.textContent = fmt(doc.updated) + ' · ' + (doc.words || 0) + ' words';
}

// ── Undo/redo stack ───────────────────────
function pushUndo() {
  const snap = { title: docTitle.value, html: editor.innerHTML };
  if (undoStack.length && undoStack[undoStack.length-1].html === snap.html) return;
  undoStack.push(snap);
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}

function undo() {
  if (undoStack.length < 2) return;
  const cur = undoStack.pop();
  redoStack.push(cur);
  const prev = undoStack[undoStack.length - 1];
  editor.innerHTML = prev.html;
  docTitle.value   = prev.title;
  updateStats();
  scheduleSave();
}

function redo() {
  if (!redoStack.length) return;
  const next = redoStack.pop();
  undoStack.push(next);
  editor.innerHTML = next.html;
  docTitle.value   = next.title;
  updateStats();
  scheduleSave();
}

// ── Auto-save ─────────────────────────────
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveCurrentDoc(true), 1500);
}

// ── Editor events ─────────────────────────
editor.addEventListener('input', () => {
  updateStats();
  pushUndo();
  scheduleSave();
});

editor.addEventListener('keydown', e => {
  // Tab → indent
  if (e.key === 'Tab') {
    e.preventDefault();
    insertAtCursor('\u00a0\u00a0\u00a0\u00a0');
    return;
  }
  // Shortcuts
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'b') { e.preventDefault(); applyFmt('bold'); }
    if (e.key === 'i') { e.preventDefault(); applyFmt('italic'); }
    if (e.key === 'u') { e.preventDefault(); applyFmt('underline'); }
    if (e.key === 's') { e.preventDefault(); saveCurrentDoc(); }
    if (e.key === 'z') { e.preventDefault(); undo(); }
    if (e.key === 'y') { e.preventDefault(); redo(); }
    if (e.key === 'f') { e.preventDefault(); toggleFind(); }
  }
});

docTitle.addEventListener('input', scheduleSave);

// ── Formatting engine ──────────────────────
// We use document.execCommand for in-browser richtext editing.
// This is the standard supported way inside real browser documents (not sandboxed iframes).
function applyFmt(cmd, val) {
  editor.focus();
  document.execCommand(cmd, false, val || null);
  updateActiveStates();
  pushUndo();
  scheduleSave();
}

// formatBlock toggles: if the current block is already the tag, revert to <p>
function applyFormatBlock(tag) {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  // Find what block element the cursor is currently in
  let node = sel.getRangeAt(0).startContainer;
  while (node && node !== editor) {
    if (node.nodeType === 1 && node.tagName.toLowerCase() === tag) {
      // Already that tag — toggle back to paragraph
      document.execCommand('formatBlock', false, 'p');
      afterInsert();
      return;
    }
    node = node.parentNode;
  }
  document.execCommand('formatBlock', false, tag);
  afterInsert();
}

function updateActiveStates() {
  document.getElementById('btnBold').classList.toggle('active', document.queryCommandState('bold'));
  document.getElementById('btnItalic').classList.toggle('active', document.queryCommandState('italic'));
  document.getElementById('btnUnderline').classList.toggle('active', document.queryCommandState('underline'));
  document.getElementById('btnStrike').classList.toggle('active', document.queryCommandState('strikeThrough'));
}

editor.addEventListener('mouseup', updateActiveStates);
editor.addEventListener('keyup', updateActiveStates);

// Toolbar buttons
document.getElementById('btnBold').addEventListener('click',      () => applyFmt('bold'));
document.getElementById('btnItalic').addEventListener('click',    () => applyFmt('italic'));
document.getElementById('btnUnderline').addEventListener('click', () => applyFmt('underline'));
document.getElementById('btnStrike').addEventListener('click',    () => applyFmt('strikeThrough'));

document.getElementById('btnAlignL').addEventListener('click', () => applyFmt('justifyLeft'));
document.getElementById('btnAlignC').addEventListener('click', () => applyFmt('justifyCenter'));
document.getElementById('btnAlignR').addEventListener('click', () => applyFmt('justifyRight'));

document.getElementById('btnUndo').addEventListener('click', undo);
document.getElementById('btnRedo').addEventListener('click', redo);
document.getElementById('btnSave').addEventListener('click', () => saveCurrentDoc());

// Block inserts — H1/H2/blockquote use formatBlock so they apply to the
// current block the cursor is in, toggling on/off correctly.
document.getElementById('btnH1').addEventListener('click', () => applyFormatBlock('h1'));
document.getElementById('btnH2').addEventListener('click', () => applyFormatBlock('h2'));
document.getElementById('btnQuote').addEventListener('click', () => applyFormatBlock('blockquote'));
document.getElementById('btnCode').addEventListener('click', () => insertInlineCode());
document.getElementById('btnUL').addEventListener('click', () => insertBlock('ul'));
document.getElementById('btnHR').addEventListener('click', () => insertBlock('hr'));

// Font / size selects
document.getElementById('selFont').addEventListener('change', function() {
  applyFmt('fontName', this.value);
});
document.getElementById('selSize').addEventListener('change', function() {
  // execCommand fontSize only takes 1-7; wrap selection in a span with inline style instead
  const px = this.value;
  editor.focus();
  const sel = window.getSelection();
  if (sel && sel.rangeCount && !sel.isCollapsed) {
    const range = sel.getRangeAt(0);
    const span  = document.createElement('span');
    span.style.fontSize = px + 'px';
    span.appendChild(range.extractContents());
    range.insertNode(span);
    // re-select
    const r2 = document.createRange();
    r2.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(r2);
  }
  afterInsert();
});

// Color dots
document.querySelectorAll('.c-dot').forEach(dot => {
  dot.addEventListener('click', () => {
    document.querySelectorAll('.c-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    activeColor = dot.dataset.color;
    applyFmt('foreColor', activeColor);
  });
});

// ── Block insert helper ───────────────────
function insertBlock(tag) {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;

  const range = sel.getRangeAt(0);

  if (tag === 'hr') {
    const hr = document.createElement('hr');
    const p  = document.createElement('p');
    p.innerHTML = '<br>';
    range.collapse(false);
    range.insertNode(p);
    range.insertNode(hr);
    const r2 = document.createRange();
    r2.setStart(p, 0);
    r2.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r2);
    afterInsert();
    return;
  }

  if (tag === 'ul') {
    const ul = document.createElement('ul');
    const li = document.createElement('li');
    li.innerHTML = 'List item';
    ul.appendChild(li);
    range.collapse(false);
    range.insertNode(ul);
    const r2 = document.createRange();
    r2.selectNodeContents(li);
    sel.removeAllRanges();
    sel.addRange(r2);
    afterInsert();
    return;
  }

  const el = document.createElement(tag);
  if (range.collapsed) {
    el.innerHTML = tag === 'blockquote' ? 'Quote text here' : 'Heading';
  } else {
    el.appendChild(range.extractContents());
  }
  range.deleteContents();
  range.insertNode(el);

  const r2 = document.createRange();
  r2.selectNodeContents(el);
  r2.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r2);
  afterInsert();
}

function insertInlineCode() {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const code  = document.createElement('code');
  if (range.collapsed) {
    code.textContent = 'code';
  } else {
    code.appendChild(range.extractContents());
  }
  range.deleteContents();
  range.insertNode(code);
  afterInsert();
}

function insertAtCursor(text) {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  afterInsert();
}

function wrapSelectionWithStyle(prop, val) {
  editor.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  const span  = document.createElement('span');
  span.style[prop] = val;
  span.appendChild(range.extractContents());
  range.insertNode(span);
  afterInsert();
}

function afterInsert() {
  updateStats();
  pushUndo();
  scheduleSave();
}

// ── Find & highlight ──────────────────────
let findOpen = false;

document.getElementById('btnFind').addEventListener('click', toggleFind);
document.getElementById('findClose').addEventListener('click', () => { findOpen = true; toggleFind(); });
document.getElementById('findPrev').addEventListener('click', () => navigateFind(-1));
document.getElementById('findNext').addEventListener('click', () => navigateFind(1));
findInput.addEventListener('input', doFind);

findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') navigateFind(e.shiftKey ? -1 : 1);
  if (e.key === 'Escape') { findOpen = true; toggleFind(); }
});

function toggleFind() {
  findOpen = !findOpen;
  findBar.classList.toggle('open', findOpen);
  if (findOpen) {
    findInput.focus();
    doFind();
  } else {
    clearMarks();
    findCount.textContent = '';
  }
}

function doFind() {
  clearMarks();
  findMatches = [];
  findIndex   = 0;

  const query = findInput.value.trim();
  if (!query) { findCount.textContent = ''; return; }

  // Walk text nodes and wrap matches in <mark>
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, null, false);
  const nodes  = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);

  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');

  nodes.forEach(textNode => {
    let m;
    const text = textNode.nodeValue;
    if (!regex.test(text)) return;
    regex.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let last = 0;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      const mark = document.createElement('mark');
      mark.textContent = m[0];
      frag.appendChild(mark);
      findMatches.push(mark);
      last = regex.lastIndex;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    textNode.parentNode.replaceChild(frag, textNode);
  });

  if (findMatches.length) {
    highlightMatch(0);
    findCount.textContent = `1 of ${findMatches.length}`;
  } else {
    findCount.textContent = 'No matches';
  }
}

function navigateFind(dir) {
  if (!findMatches.length) return;
  findMatches[findIndex].classList.remove('current-match');
  findIndex = (findIndex + dir + findMatches.length) % findMatches.length;
  highlightMatch(findIndex);
  findCount.textContent = `${findIndex + 1} of ${findMatches.length}`;
}

function highlightMatch(i) {
  findMatches.forEach(m => m.classList.remove('current-match'));
  const m = findMatches[i];
  m.classList.add('current-match');
  m.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearMarks() {
  editor.querySelectorAll('mark').forEach(m => {
    const txt = document.createTextNode(m.textContent);
    m.parentNode.replaceChild(txt, m);
  });
  editor.normalize();
  findMatches = [];
  findIndex   = 0;
}

// ── Init ──────────────────────────────────
(function init() {
  // Push initial undo snapshot
  pushUndo();

  // Load last active doc
  const lastId = localStorage.getItem(ACTIVE_KEY);
  if (lastId && getDoc(lastId)) {
    openDoc(lastId);
  } else {
    const docs = loadDocs();
    if (docs.length) {
      openDoc(docs[0].id);
    } else {
      docMeta.textContent     = 'No document open — click New to start';
      currentLabel.textContent = 'No document open';
    }
  }

  renderDocsList();
})();