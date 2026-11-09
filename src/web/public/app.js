(() => {
  const chatId = (location.pathname.match(/^\/g\/([^/?#]+)/) || [])[1];
  if (!chatId) return;
  const api = `/api/chat/${encodeURIComponent(chatId)}`;
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const say = (el, text, cls) => {
    if (!el) return;
    el.textContent = text;
    el.className = `saved ${cls ?? ''}`;
    setTimeout(() => {
      if (el.textContent === text) el.textContent = '';
    }, 4000);
  };

  const readValue = (el) => {
    if (el.type === 'checkbox') return el.checked;
    if (el.dataset.list === 'channels') {
      return el.value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((token) => {
          const raw = token.replace(/^@/, '');
          const parts = raw.split(/[:\s]+/).filter(Boolean);
          const isId = /^-?\d{3,}$/.test(parts[0]);
          return {
            id: isId ? parts[0] : null,
            username: !isId ? (parts[0] ?? '').replace(/^@/, '') : parts[1] ?? null,
            title: isId ? parts[1] ?? '' : parts.slice(1).join(' ') || parts[0],
          };
        });
    }
    if (el.dataset.list === 'list') {
      return el.value
        .split('\n')
        .map((v) => v.trim().replace(/^@/, '').toLowerCase())
        .filter(Boolean);
    }
    if (el.type === 'number') return Number(el.value || 0);
    return el.value;
  };

  const collect = () => {
    const patch = {};
    document.querySelectorAll('[data-path]').forEach((el) => {
      patch[el.dataset.path] = readValue(el);
    });
    return patch;
  };

  const save = document.getElementById('save');
  if (save) {
    save.addEventListener('click', async () => {
      save.disabled = true;
      say(document.getElementById('saved'), '…', '');
      try {
        const res = await fetch(`${api}/settings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(collect()),
        });
        if (!res.ok) throw new Error(String(res.status));
        say(document.getElementById('saved'), 'Saqlandi ✓', 'ok');
      } catch (err) {
        say(document.getElementById('saved'), `Xato: ${err.message}`, 'bad');
      } finally {
        save.disabled = false;
      }
    });
  }

  const form = document.getElementById('add-rule');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {
        pattern: form.pattern.value,
        action: form.action.value,
      };
      try {
        const res = await fetch(`${api}/rules`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        location.reload();
      } catch (err) {
        alert(`Qo‘shib bo‘lmadi: ${err.message}`);
      }
    });
  }

  document.querySelectorAll('[data-rule]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('O‘chirilsinmi?')) return;
      await fetch(`${api}/rules/${encodeURIComponent(btn.dataset.rule)}`, { method: 'DELETE' });
      location.reload();
    });
  });

  const run = document.getElementById('probe-run');
  if (run) {
    const probe = document.getElementById('probe');
    const out = document.getElementById('probe-out');
    const test = async () => {
      out.textContent = '…';
      const res = await fetch(`${api}/preview?text=${encodeURIComponent(probe.value || '')}`);
      const json = await res.json().catch(() => ({}));
      const r = json.result ?? {};
      out.textContent = JSON.stringify(r, null, 2);
      out.className = `out ${r.clean ? 'good' : 'hit'}`;
    };
    run.addEventListener('click', test);
    probe.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) test();
    });
  }

  document.querySelectorAll('[data-action-user]').forEach((btn) => {
    btn.addEventListener('click', () => runAction(btn.dataset.actionUser, btn.dataset.actionKind));
  });

  const quick = document.getElementById('quick-go');
  if (quick) {
    quick.addEventListener('click', () => {
      const id = document.getElementById('quick-id').value.trim();
      if (!/^-?\d{2,}$/.test(id)) return notify('ID ni to‘g‘ri kiriting', 'bad');
      runAction(id, document.getElementById('quick-action').value);
    });
  }

  async function runAction(userId, action) {
    const secondsEl = document.getElementById('quick-seconds');
    const reasonEl = document.getElementById('quick-reason');
    const body = {
      userId,
      action,
      seconds: Number(secondsEl?.value || 0),
      reason: reasonEl?.value || 'panel',
    };
    if (action === 'ban' || action === 'kick' || action === 'lock') {
      if (!confirm(`${action} ${userId}?`)) return;
    }
    const res = await fetch(`${api}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!json.ok) return notify(res.status === 401 ? 'Login talab qilinadi' : `Bajarilmadi (${res.status})`, 'bad');
    notify(`${action} ✓`, 'ok');
    setTimeout(() => location.reload(), 700);
  }

  const exportBtn = document.getElementById('export');
  if (exportBtn) {
    exportBtn.addEventListener('click', async () => {
      const res = await fetch(`${api}/export`);
      const json = await res.json().catch(() => null);
      if (!json) return notify('Eksport xato', 'bad');
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `mcguard-${chatId}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      notify('Yuklab olindi ✓', 'ok');
    });
  }

  const importBtn = document.getElementById('import');
  if (importBtn) {
    importBtn.addEventListener('click', async () => {
      const text = prompt('Eksport JSON matnini shu yerga tashlang:');
      if (!text) return;
      let payload;
      try {
        payload = JSON.parse(text);
      } catch {
        return notify('JSON noto‘g‘ri', 'bad');
      }
      const res = await fetch(`${api}/import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!json.ok) return notify('Import bajarilmadi', 'bad');
      notify('Import ✓', 'ok');
      setTimeout(() => location.reload(), 700);
    });
  }

  // Keyboard shortcut: Ctrl+S saves the settings tab.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && save) {
      e.preventDefault();
      save.click();
    }
  });

  const toast = document.createElement('div');
  toast.className = 'toast';
  document.body.appendChild(toast);
  const notify = (msg, cls) => {
    toast.innerHTML = `<span class="${cls ?? ''}">${esc(msg)}</span>`;
    toast.classList.add('on');
    setTimeout(() => toast.classList.remove('on'), 2600);
  };
  window.__panelNotify = notify;
})();
