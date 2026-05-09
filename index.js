  const editor = document.getElementById('editor');
  const docTitle = document.getElementById('docTitle');
  let saveTimer = null;

  function execCmd(cmd, val) {
    editor.focus();
    document.execCommand(cmd, false, val || null);
    updateActiveStates();
  }

  function fmt(cmd) {
    execCmd(cmd);
  }

  function insertBlock(type) {
    editor.focus();
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const range = sel.getRangeAt(0);

    if (type === 'hr') {
      const hr = document.createElement('hr');
      const p = document.createElement('p');
      p.innerHTML = '<br>';
      range.collapse(false);
      range.insertNode(p);
      range.insertNode(hr);
      const newRange = document.createRange();
      newRange.setStart(p, 0);
      newRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(newRange);
      onEdit();
      return;
    }

    if (type === 'code') {
      const code = document.createElement('code');
      if (range.collapsed) {
        code.textContent = 'code';
      } else {
        const frag = range.extractContents();
        code.appendChild(frag);
      }
      range.deleteContents();
      range.insertNode(code);
      onEdit();
      return;
    }

    let el;
    if (type === 'blockquote') {
      el = document.createElement('blockquote');
      el.innerHTML = '<br>';
    } else if (type === 'ul') {
      el = document.createElement('ul');
      el.innerHTML = '<li>List item</li>';
    } else if (type === 'ol') {
      el = document.createElement('ol');
      el.innerHTML = '<li>List item</li>';
    } else if (type === 'h1' || type === 'h2') {
      el = document.createElement(type);
      el.innerHTML = 'Heading';
    }

    range.collapse(false);
    range.insertNode(el);
    const newRange = document.createRange();
    newRange.selectNodeContents(el);
    newRange.collapse(false);
    sel.removeAllRanges();
    sel.addRange(newRange);
    onEdit();
  }

  function setColor(hex, dot) {
    document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'));
    dot.classList.add('active');
    execCmd('foreColor', hex);
  }

  function updateActiveStates() {
    ['bold','italic','underline','strikeThrough'].forEach(cmd => {
      const map = {bold:'btn-b',italic:'btn-i',underline:'btn-u',strikeThrough:'btn-s'};
      const el = document.getElementById(map[cmd]);
      if (el) el.classList.toggle('active', document.queryCommandState(cmd));
    });
  }

  function onEdit() {
    updateMeta();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autoSave, 2000);
  }

  function updateMeta() {
    const text = editor.innerText.trim();
    const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const charCount = text.length;
    const readMins = Math.max(1, Math.round(wordCount / 200));
    const lines = editor.innerHTML.split(/<br|<\/p>|<\/div>|<\/h[1-6]>|<\/blockquote>|<\/li>/i).length;

    document.getElementById('statWords').textContent = wordCount;
    document.getElementById('statChars').textContent = charCount;
    document.getElementById('statRead').textContent = wordCount < 200 ? '< 1 min' : readMins + ' min';
    document.getElementById('statLines').textContent = lines;
    document.getElementById('docMeta').textContent = `${wordCount} words · ${charCount} chars · edited just now`;
  }

  function autoSave() {
    const data = { title: docTitle.value, content: editor.innerHTML, saved: new Date().toISOString() };
    try { localStorage.setItem('prose_editor_doc', JSON.stringify(data)); } catch(e) {}
    const badge = document.getElementById('savedBadge');
    badge.classList.add('show');
    setTimeout(() => badge.classList.remove('show'), 2000);
  }

  function saveDoc() {
    autoSave();
    const title = docTitle.value || 'document';
    const text = editor.innerText;
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = title.replace(/\s+/g,'-').toLowerCase() + '.txt';
    a.click();
  }

  let findOpen = false;
  function toggleFind() {
    findOpen = !findOpen;
    const bar = document.getElementById('findBar');
    bar.classList.toggle('open', findOpen);
    if (findOpen) {
      document.getElementById('findInput').focus();
      doFind();
    } else {
      clearHighlights();
      document.getElementById('findCount').textContent = '–';
    }
  }

  function clearHighlights() {
    const marks = editor.querySelectorAll('mark');
    marks.forEach(m => {
      const parent = m.parentNode;
      while (m.firstChild) parent.insertBefore(m.firstChild, m);
      parent.removeChild(m);
    });
    editor.normalize();
  }

  function doFind() {
    clearHighlights();
    const query = document.getElementById('findInput').value.trim();
    if (!query) { document.getElementById('findCount').textContent = '–'; return; }

    const text = editor.innerHTML;
    const regex = new RegExp('(' + query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&') + ')', 'gi');
    editor.innerHTML = text.replace(regex, '<mark>$1</mark>');

    const hits = editor.querySelectorAll('mark').length;
    document.getElementById('findCount').textContent = hits ? `${hits} match${hits>1?'es':''}` : 'No matches';
  }

  function handleKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') { e.preventDefault(); toggleFind(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveDoc(); }
    if (e.key === 'Tab') { e.preventDefault(); execCmd('insertHTML', '&nbsp;&nbsp;&nbsp;&nbsp;'); }
  }

  try {
    const saved = localStorage.getItem('prose_editor_doc');
    if (saved) {
      const data = JSON.parse(saved);
      if (data.title) docTitle.value = data.title;
      if (data.content) editor.innerHTML = data.content;
      updateMeta();
    }
  } catch(e) {}