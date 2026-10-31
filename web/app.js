/* =====================================================================
   AGENT DUŻEJ RODZINY — aplikacja (vanilla JS + Supabase)
   ===================================================================== */
(() => {
  'use strict';

  if (!window.APP_CONFIG || !APP_CONFIG.SUPABASE_URL || APP_CONFIG.SUPABASE_URL.includes('TWOJ')) {
    document.body.innerHTML = '<div class="auth"><div class="auth-card"><h1>Brak konfiguracji</h1><p class="muted">Uzupełnij plik <code>config.js</code> (SUPABASE_URL i SUPABASE_ANON_KEY).</p></div></div>';
    return;
  }

  const sb = supabase.createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_ANON_KEY);

  // -------------------------------------------------------------- state
  const S = {
    user: null,            // auth user
    me: null,              // family_members row
    members: [],           // all family members
    children: [],
    tasks: [],
    events: [],
    items: [],
    reads: new Set(),      // item ids read by me
    messages: [],
    view: 'today',
    taskFilter: 'open',
    itemsFilter: 'unread',
    itemsChild: '',
    itemsKind: '',
    gradesChild: '',
    calStart: startOfWeek(new Date()),
    lastChatSeen: (() => { try { return Number(localStorage.getItem('adr_lastChatSeen') || 0); } catch (e) { return 0; } })(),
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const VIEW_TITLES = { today: 'Dziś', calendar: 'Kalendarz', tasks: 'Zadania', items: 'Wpisy', grades: 'Oceny', chat: 'Czat' };
  const TEST_RE = /sprawdzian|kartk[óo]wk|dyktand|praca klasowa|klas[óo]wk|\btest\b|egzamin/i;
  const KIND_LABEL = { message: 'Wiadomość', announcement: 'Ogłoszenie', homework: 'Zadanie domowe', event: 'Wydarzenie', grade: 'Ocena', attendance: 'Frekwencja', other: 'Inne' };
  const SOURCE_LABEL = { librus: 'Librus', '4parents': '4Parents', manual: 'Ręcznie' };
  const COLORS = ['#0ea5e9', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#eab308', '#14b8a6', '#ef4444'];
  const DAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

  // -------------------------------------------------------------- utils
  function startOfWeek(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x; }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
  function isToday(d) { return sameDay(d, new Date()); }
  function fmtDate(d) { d = new Date(d); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
  function fmtTime(d) { d = new Date(d); return d.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }); }
  function fmtDateTime(d) { d = new Date(d); return `${fmtDate(d)}, ${fmtTime(d)}`; }
  function dateKey(d) { d = new Date(d); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  function toLocalInput(d) { d = new Date(d); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function child(id) { return S.children.find(c => c.id === id); }
  function member(id) { return S.members.find(m => m.user_id === id); }
  function partner() { return S.members.find(m => m.user_id !== S.me.user_id); }
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add('hidden'), 2200); }
  function fail(e) { console.error(e); toast('Błąd: ' + (e?.message || e)); }

  function childChip(id) {
    const c = child(id);
    return c ? `<span class="chip"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span>` : '';
  }
  function memberChip(id) {
    const m = member(id);
    return m ? `<span class="chip"><span class="dot" style="background:${m.color}"></span>${esc(m.display_name)}</span>` : '<span class="chip">nieprzypisane</span>';
  }

  // -------------------------------------------------------------- auth
  async function boot() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) { S.user = session.user; await enterApp(); } else showAuth();
    sb.auth.onAuthStateChange((_e, sess) => {
      if (sess && !S.user) { S.user = sess.user; enterApp(); }
      if (!sess && S.user) location.reload();
    });
  }

  function showAuth() {
    $('#auth').classList.remove('hidden'); $('#app').classList.add('hidden');
    $('#login-form').onsubmit = async ev => {
      ev.preventDefault();
      const f = new FormData(ev.target);
      const { error } = await sb.auth.signInWithPassword({ email: f.get('email'), password: f.get('password') });
      $('#login-error').textContent = error ? 'Nieprawidłowy e-mail lub hasło.' : '';
    };
  }

  async function enterApp() {
    const { data: members, error } = await sb.from('family_members').select('*');
    if (error) return fail(error);
    S.members = members;
    S.me = members.find(m => m.user_id === S.user.id);
    if (!S.me) {
      $('#auth').classList.remove('hidden');
      $('#auth .auth-card').innerHTML = '<h1>Konto nie jest w rodzinie</h1><p class="muted">Zalogowano jako ' + esc(S.user.email) + ', ale to konto nie zostało dodane do tabeli <code>family_members</code>. Zobacz README, krok 4.</p><button class="btn primary" id="lo">Wyloguj</button>';
      $('#lo').onclick = () => sb.auth.signOut();
      return;
    }
    $('#auth').classList.add('hidden'); $('#app').classList.remove('hidden');
    $('#me-badge').textContent = S.me.display_name;
    await loadAll();
    bindUI();
    subscribeRealtime();
    render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // -------------------------------------------------------------- data
  async function loadAll() {
    const since = new Date(); since.setDate(since.getDate() - 60);
    const [ch, ta, ev, it, rd, ms] = await Promise.all([
      sb.from('children').select('*').order('sort_order').order('name'),
      sb.from('tasks').select('*').order('due_at', { ascending: true, nullsFirst: false }).order('created_at'),
      sb.from('events').select('*').gte('starts_at', since.toISOString()).order('starts_at'),
      sb.from('items').select('*').order('published_at', { ascending: false }).limit(300),
      sb.from('item_reads').select('item_id').eq('user_id', S.me.user_id),
      sb.from('messages').select('*').order('created_at', { ascending: false }).limit(200),
    ]);
    for (const r of [ch, ta, ev, it, rd, ms]) if (r.error) return fail(r.error);
    S.children = ch.data; S.tasks = ta.data; S.events = ev.data; S.items = it.data;
    S.reads = new Set(rd.data.map(r => r.item_id)); S.messages = ms.data.reverse();
  }

  function subscribeRealtime() {
    sb.channel('family')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, p => { if (p.eventType === 'INSERT') { S.messages.push(p.new); if (S.view === 'chat') markChatSeen(); render(); } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => { const { data } = await sb.from('tasks').select('*').order('due_at', { ascending: true, nullsFirst: false }).order('created_at'); if (data) { S.tasks = data; render(); } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, async () => { const since = new Date(); since.setDate(since.getDate() - 60); const { data } = await sb.from('events').select('*').gte('starts_at', since.toISOString()).order('starts_at'); if (data) { S.events = data; render(); } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, async () => { const { data } = await sb.from('items').select('*').order('published_at', { ascending: false }).limit(300); if (data) { S.items = data; render(); } })
      .subscribe();
  }

  // -------------------------------------------------------------- UI bindings
  function bindUI() {
    $$('.bottom-nav button').forEach(b => b.onclick = () => setView(b.dataset.nav));
    $('#fab').onclick = () => openAddMenu();
    $('#btn-settings').onclick = openSettings;
    $('#modal-close').onclick = closeModal;
    $('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

    $('#cal-prev').onclick = () => { S.calStart = addDays(S.calStart, -7); render(); };
    $('#cal-next').onclick = () => { S.calStart = addDays(S.calStart, 7); render(); };
    $('#cal-today').onclick = () => { S.calStart = startOfWeek(new Date()); render(); };

    $$('#task-filter button').forEach(b => b.onclick = () => { S.taskFilter = b.dataset.f; render(); });
    $$('#items-filter button').forEach(b => b.onclick = () => { S.itemsFilter = b.dataset.f; render(); });
    $('#items-child').onchange = e => { S.itemsChild = e.target.value; render(); };
    $$('#items-kind button').forEach(b => b.onclick = () => { S.itemsKind = b.dataset.k; render(); });
    $('#grades-child').onchange = e => { S.gradesChild = e.target.value; render(); };

    $('#chat-form').onsubmit = async e => {
      e.preventDefault();
      const inp = $('#chat-input'); const body = inp.value.trim(); if (!body) return;
      inp.value = '';
      const { error } = await sb.from('messages').insert({ sender: S.me.user_id, body });
      if (error) fail(error);
    };
  }

  function setView(v) {
    S.view = v;
    $$('.bottom-nav button').forEach(b => b.classList.toggle('on', b.dataset.nav === v));
    $$('.view').forEach(x => x.classList.toggle('hidden', x.dataset.view !== v));
    $('#view-title').textContent = VIEW_TITLES[v];
    $('#fab').classList.toggle('hidden', v === 'chat');
    if (v === 'chat') markChatSeen();
    render();
  }

  function markChatSeen() {
    const last = S.messages.at(-1);
    S.lastChatSeen = last ? new Date(last.created_at).getTime() : Date.now();
    try { localStorage.setItem('adr_lastChatSeen', String(S.lastChatSeen)); } catch (e) {}
  }

  // -------------------------------------------------------------- render
  function render() {
    renderBadges();
    renderChildSelect();
    $$('#task-filter button').forEach(b => b.classList.toggle('on', b.dataset.f === S.taskFilter));
    $$('#items-filter button').forEach(b => b.classList.toggle('on', b.dataset.f === S.itemsFilter));
    $$('#items-kind button').forEach(b => b.classList.toggle('on', b.dataset.k === S.itemsKind));
    ({ today: renderToday, calendar: renderCalendar, tasks: renderTasks, items: renderItems, grades: renderGrades, chat: renderChat })[S.view]();
  }

  function renderBadges() {
    const myOpen = S.tasks.filter(t => t.status === 'todo' && t.assignee === S.me.user_id).length;
    const unread = S.items.filter(i => !S.reads.has(i.id) && i.kind !== 'grade').length;
    const unreadGrades = S.items.filter(i => !S.reads.has(i.id) && i.kind === 'grade').length;
    $('#badge-grades').textContent = unreadGrades || '';
    const newChat = S.messages.filter(m => m.sender !== S.me.user_id && new Date(m.created_at).getTime() > S.lastChatSeen).length;
    $('#badge-tasks').textContent = myOpen || '';
    $('#badge-items').textContent = unread || '';
    $('#badge-chat').textContent = newChat || '';
  }

  function renderChildSelect() {
    const sel = $('#items-child');
    const cur = sel.value;
    sel.innerHTML = '<option value="">Wszystkie dzieci</option>' + S.children.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    sel.value = cur;
    const gs = $('#grades-child');
    const withGrades = S.children.filter(c => S.items.some(i => i.kind === 'grade' && i.child_id === c.id));
    const list = withGrades.length ? withGrades : S.children;
    if (!S.gradesChild || !list.some(c => c.id === S.gradesChild)) S.gradesChild = list[0]?.id || '';
    gs.innerHTML = list.map(c => `<option value="${c.id}" ${c.id === S.gradesChild ? 'selected' : ''}>${esc(c.name)}</option>`).join('') || '<option value="">— brak dzieci —</option>';
  }

  // ---- DZIŚ
  function renderToday() {
    const now = new Date(); const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const in7 = addDays(todayStart, 7);
    const myTasks = S.tasks.filter(t => t.status === 'todo' && (t.assignee === S.me.user_id || !t.assignee));
    const overdue = myTasks.filter(t => t.due_at && new Date(t.due_at) < todayStart);
    const dueSoon = myTasks.filter(t => !t.due_at || (new Date(t.due_at) >= todayStart && new Date(t.due_at) < in7));
    const events = S.events.filter(e => new Date(e.starts_at) >= todayStart && new Date(e.starts_at) < in7);
    const unread = S.items.filter(i => !S.reads.has(i.id) && i.kind !== 'grade').slice(0, 8);
    const greeting = now.getHours() < 12 ? 'Dzień dobry' : now.getHours() < 18 ? 'Cześć' : 'Dobry wieczór';

    let h = `<h2>${greeting}, ${esc(S.me.display_name)}</h2><p class="muted">${DAYS[now.getDay()]}, ${fmtDate(now)}</p>`;
    if (!S.children.length) h += `<div class="card"><div class="grow"><div class="title">Zacznij od dodania dzieci</div><div class="meta">Ustawienia (⚙) → Dzieci. Każde dziecko dostaje swój kolor.</div></div><div class="actions"><button class="btn sm" data-act="settings">Otwórz</button></div></div>`;

    if (overdue.length) { h += `<div class="section-title">Po terminie</div>` + overdue.map(taskCard).join(''); }
    h += `<div class="section-title">Najbliższe 7 dni</div>`;
    const merged = [
      ...events.map(e => ({ when: new Date(e.starts_at), html: eventCard(e) })),
      ...dueSoon.filter(t => t.due_at).map(t => ({ when: new Date(t.due_at), html: taskCard(t) })),
    ].sort((a, b) => a.when - b.when);
    h += merged.length ? groupByDay(merged) : `<div class="empty">Nic zaplanowanego. Spokojny tydzień 🙂</div>`;
    const noDate = dueSoon.filter(t => !t.due_at);
    if (noDate.length) h += `<div class="section-title">Zadania bez terminu</div>` + noDate.map(taskCard).join('');
    if (unread.length) h += `<div class="section-title">Nieprzeczytane wpisy</div>` + unread.map(itemCard).join('');
    $('#today-content').innerHTML = h;
    wireCards($('#today-content'));
  }

  function groupByDay(list) {
    let out = '', lastKey = null;
    for (const x of list) {
      const k = dateKey(x.when);
      if (k !== lastKey) { lastKey = k; out += dayHead(x.when); }
      out += x.html;
    }
    return out;
  }
  function dayHead(d) { return `<div class="day-head ${isToday(d) ? 'today' : ''}"><span class="d">${isToday(d) ? 'Dziś' : fmtDate(d)}</span><span class="w">${DAYS[d.getDay()]}</span></div>`; }

  // ---- KALENDARZ (tydzień)
  function renderCalendar() {
    const end = addDays(S.calStart, 7);
    $('#cal-range').textContent = `${fmtDate(S.calStart)} – ${fmtDate(addDays(S.calStart, 6))}`;
    let h = '';
    for (let i = 0; i < 7; i++) {
      const d = addDays(S.calStart, i); const key = dateKey(d);
      const evs = S.events.filter(e => dateKey(e.starts_at) === key);
      const tks = S.tasks.filter(t => t.due_at && dateKey(t.due_at) === key);
      h += dayHead(d);
      if (!evs.length && !tks.length) { h += `<div class="muted" style="padding:0 0 4px 4px;font-size:.85rem">—</div>`; continue; }
      h += evs.map(eventCard).join('') + tks.map(taskCard).join('');
    }
    $('#calendar-content').innerHTML = h;
    wireCards($('#calendar-content'));
  }

  // ---- ZADANIA
  function renderTasks() {
    const f = S.taskFilter; const p = partner();
    let list = S.tasks;
    if (f === 'open') list = list.filter(t => t.status === 'todo');
    if (f === 'mine') list = list.filter(t => t.status === 'todo' && t.assignee === S.me.user_id);
    if (f === 'partner') list = list.filter(t => t.status === 'todo' && p && t.assignee === p.user_id);
    if (f === 'done') list = list.filter(t => t.status === 'done').sort((a, b) => new Date(b.done_at) - new Date(a.done_at)).slice(0, 50);
    $('#tasks-content').innerHTML = list.length ? list.map(taskCard).join('') : `<div class="empty">Brak zadań w tym widoku.</div>`;
    wireCards($('#tasks-content'));
  }

  // ---- WPISY
  function kindMatch(i, k) {
    if (!k) return i.kind !== 'grade';
    if (k === 'message') return i.kind === 'message';
    if (k === 'homework') return i.kind === 'homework';
    if (k === 'test') return i.kind === 'event' && TEST_RE.test((i.sender || '') + ' ' + i.title);
    if (k === 'other') return i.kind !== 'grade' && !kindMatch(i, 'message') && !kindMatch(i, 'homework') && !kindMatch(i, 'test');
    return true;
  }

  function renderItems() {
    let list = S.items.filter(i => kindMatch(i, S.itemsKind));
    if (S.itemsFilter === 'unread') list = list.filter(i => !S.reads.has(i.id));
    if (S.itemsChild) list = list.filter(i => i.child_id === S.itemsChild);
    let html;
    if (S.itemsKind === 'test') {
      // sprawdziany: nadchodzące od najbliższego, potem minione
      const now = Date.now();
      const up = list.filter(i => i.occurred_at && new Date(i.occurred_at) >= now).sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
      const past = list.filter(i => !i.occurred_at || new Date(i.occurred_at) < now).sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0));
      html = (up.length ? `<div class="section-title">Nadchodzące</div>` + groupByDay(up.map(i => ({ when: new Date(i.occurred_at), html: itemCard(i) }))) : `<div class="empty">Brak zaplanowanych sprawdzianów 🎉</div>`)
        + (past.length ? `<div class="section-title">Minione</div>` + past.map(itemCard).join('') : '');
    } else {
      html = list.length ? list.map(itemCard).join('')
        : `<div class="empty">${S.items.length ? (S.itemsFilter === 'unread' ? 'Wszystko przeczytane ✓' : 'Brak wpisów w tej kategorii.') : 'Jeszcze nie ma żadnych wpisów. Pojawią się tu, gdy uruchomisz workera (Librus / 4Parents) albo dodasz wpis ręcznie.'}</div>`;
    }
    $('#items-content').innerHTML = html;
    wireCards($('#items-content'));
  }

  // ---- OCENY: tabela przedmiot × miesiąc
  function renderGrades() {
    const list = S.items.filter(i => i.kind === 'grade' && (!S.gradesChild || i.child_id === S.gradesChild));
    const sum = $('#grades-summary');
    if (!list.length) { sum.textContent = ''; $('#grades-content').innerHTML = `<div class="empty">Brak ocen dla tego dziecka.</div>`; return; }
    const months = new Map();   // key 'YYYY-MM' -> label
    const subjects = new Map(); // subject -> Map(monthKey -> [items])
    for (const i of list) {
      const idx = i.title.indexOf(':');
      const subject = idx > 0 ? i.title.slice(0, idx).trim() : 'Inne';
      const value = idx > 0 ? i.title.slice(idx + 1).trim() : i.title;
      const d = new Date(i.published_at);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.set(mk, `${MONTHS[d.getMonth()]} ${d.getFullYear()}`);
      if (!subjects.has(subject)) subjects.set(subject, new Map());
      const bym = subjects.get(subject);
      if (!bym.has(mk)) bym.set(mk, []);
      bym.get(mk).push({ i, value, d });
    }
    const mkeys = [...months.keys()].sort();
    const unread = list.filter(i => !S.reads.has(i.id)).length;
    sum.textContent = `${list.length} ocen${unread ? ` · ${unread} nowych` : ''}`;
    let h = `<div class="grades-wrap"><table class="grades"><thead><tr><th>Przedmiot</th>${mkeys.map(k => `<th>${esc(months.get(k))}</th>`).join('')}</tr></thead><tbody>`;
    for (const [subject, bym] of [...subjects].sort((a, b) => a[0].localeCompare(b[0], 'pl'))) {
      h += `<tr><td>${esc(subject)}</td>` + mkeys.map(k => {
        const arr = (bym.get(k) || []).sort((a, b) => a.d - b.d);
        return `<td><div class="gcell">${arr.map(({ i, value, d }) =>
          `<button class="gchip ${S.reads.has(i.id) ? '' : 'unread'}" data-grade="${i.id}" title="${esc(i.body || '')}"><b>${esc(value)}</b><small>${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}</small></button>`).join('')}</div></td>`;
      }).join('') + '</tr>';
    }
    h += '</tbody></table></div><p class="muted" style="font-size:.78rem;margin-top:10px">Kliknij ocenę, aby zobaczyć kategorię i komentarz. Czerwona obwódka = jeszcze nieprzejrzana.</p>';
    $('#grades-content').innerHTML = h;
    wireCards($('#grades-content'));
  }

  // ---- CZAT
  function renderChat() {
    const log = $('#chat-log');
    let h = '', lastDay = null;
    for (const m of S.messages) {
      const d = new Date(m.created_at); const k = dateKey(d);
      if (k !== lastDay) { lastDay = k; h += `<div class="muted" style="text-align:center;font-size:.75rem;margin:10px 0 4px">${isToday(d) ? 'Dziś' : fmtDate(d)}</div>`; }
      const me = m.sender === S.me.user_id;
      h += `<div class="msg ${me ? 'me' : ''}">${esc(m.body)}<span class="t">${me ? '' : esc(member(m.sender)?.display_name || '') + ' · '}${fmtTime(d)}</span></div>`;
    }
    log.innerHTML = h || `<div class="empty">Napiszcie do siebie coś miłego 🙂</div>`;
    log.scrollTop = log.scrollHeight; window.scrollTo(0, document.body.scrollHeight);
  }

  // -------------------------------------------------------------- cards
  function taskCard(t) {
    const c = child(t.child_id); const col = c ? c.color : 'var(--line)';
    const due = t.due_at ? new Date(t.due_at) : null;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const over = t.status === 'todo' && due && due < todayStart;
    return `<div class="card ${t.status === 'done' ? 'done' : ''}" style="border-left-color:${col}" data-task="${t.id}">
      <button class="check ${t.status === 'done' ? 'on' : ''}" data-act="toggle" title="Oznacz">${t.status === 'done' ? '✓' : ''}</button>
      <div class="grow clickable" data-act="edit-task">
        <div class="title">${esc(t.title)}</div>
        <div class="meta">${childChip(t.child_id)}${memberChip(t.assignee)}${due ? `<span class="${over ? 'overdue' : ''}">⏰ ${fmtDate(due)}</span>` : ''}${t.item_id ? '<span>↗ z wpisu</span>' : ''}</div>
        ${t.notes ? `<div class="body">${esc(t.notes)}</div>` : ''}
      </div></div>`;
  }

  function eventCard(e) {
    const c = child(e.child_id); const col = c ? c.color : 'var(--line)';
    const time = e.all_day ? 'cały dzień' : fmtTime(e.starts_at) + (e.ends_at ? '–' + fmtTime(e.ends_at) : '');
    return `<div class="card" style="border-left-color:${col}" data-event="${e.id}">
      <div class="grow clickable" data-act="edit-event">
        <div class="title">${esc(e.title)}</div>
        <div class="meta">${childChip(e.child_id)}<span>📅 ${fmtDate(e.starts_at)} · ${time}</span>${e.source !== 'manual' ? `<span>${SOURCE_LABEL[e.source] || e.source}</span>` : ''}</div>
        ${e.notes ? `<div class="body">${esc(e.notes)}</div>` : ''}
      </div>
      <div class="actions"><button class="btn sm" data-act="event-to-task">→ zadanie</button></div></div>`;
  }

  function itemCard(i) {
    const c = child(i.child_id); const col = c ? c.color : 'var(--line)';
    const unread = !S.reads.has(i.id);
    return `<div class="card ${unread ? 'unread' : ''}" style="border-left-color:${col}" data-item="${i.id}">
      <div class="grow clickable" data-act="open-item">
        <div class="title">${unread ? '● ' : ''}${esc(i.title)}</div>
        <div class="meta">${childChip(i.child_id)}<span>${KIND_LABEL[i.kind] || i.kind} · ${SOURCE_LABEL[i.source] || i.source}</span>${i.sender ? `<span>od: ${esc(i.sender)}</span>` : ''}<span>${fmtDateTime(i.published_at)}</span>${i.occurred_at ? `<span>⏰ ${fmtDate(i.occurred_at)}</span>` : ''}</div>
      </div>
      <div class="actions"><button class="btn sm" data-act="item-to-task">→ zadanie</button></div></div>`;
  }

  function wireCards(root) {
    root.onclick = async e => {
      const g = e.target.closest('[data-grade]');
      if (g) return openItem(S.items.find(x => x.id === g.dataset.grade));
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const act = btn.dataset.act;
      const card = btn.closest('.card');
      if (act === 'settings') return openSettings();
      if (act === 'toggle') return toggleTask(card.dataset.task);
      if (act === 'edit-task') return openTaskForm(S.tasks.find(t => t.id === card.dataset.task));
      if (act === 'edit-event') return openEventForm(S.events.find(x => x.id === card.dataset.event));
      if (act === 'event-to-task') { const ev = S.events.find(x => x.id === card.dataset.event); return openTaskForm({ title: ev.title, child_id: ev.child_id, due_at: ev.starts_at, notes: ev.notes }); }
      if (act === 'open-item') return openItem(S.items.find(x => x.id === card.dataset.item));
      if (act === 'item-to-task') { const it = S.items.find(x => x.id === card.dataset.item); return openTaskForm({ title: it.title, child_id: it.child_id, due_at: it.occurred_at, item_id: it.id, notes: (it.body || '').slice(0, 300) }); }
    };
  }

  // -------------------------------------------------------------- actions
  async function toggleTask(id) {
    const t = S.tasks.find(x => x.id === id);
    const done = t.status !== 'done';
    t.status = done ? 'done' : 'todo'; t.done_at = done ? new Date().toISOString() : null; render();
    const { error } = await sb.from('tasks').update({ status: t.status, done_at: t.done_at }).eq('id', id);
    if (error) fail(error);
  }

  async function openItem(i) {
    if (!S.reads.has(i.id)) {
      S.reads.add(i.id);
      sb.from('item_reads').insert({ item_id: i.id, user_id: S.me.user_id }).then(({ error }) => error && console.warn(error));
    }
    openModal(esc(i.title), `
      <div class="meta muted" style="margin-bottom:10px">${childChip(i.child_id)} ${KIND_LABEL[i.kind] || i.kind} · ${SOURCE_LABEL[i.source] || i.source}${i.sender ? ' · od: ' + esc(i.sender) : ''}<br>${fmtDateTime(i.published_at)}${i.occurred_at ? ' · termin: ' + fmtDate(i.occurred_at) : ''}</div>
      <div class="body" style="white-space:pre-wrap">${esc(i.body || '(brak treści)')}</div>
      ${attachmentsHtml(i)}
      <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap">
        <button class="btn sm" id="m-totask">→ zadanie</button>
        <button class="btn sm" id="m-toevent">→ wydarzenie</button>
        ${i.url ? `<a class="btn sm" href="${esc(i.url)}" target="_blank" rel="noopener">Otwórz w źródle ↗</a>` : ''}
        ${i.source === 'manual' ? `<button class="btn sm danger" id="m-del">Usuń</button>` : ''}
      </div>`);
    render();
    $$('#modal-body [data-att]').forEach(b => b.onclick = () => openAttachment(b.dataset.att, b));
    $('#m-totask').onclick = () => openTaskForm({ title: i.title, child_id: i.child_id, due_at: i.occurred_at, item_id: i.id, notes: (i.body || '').slice(0, 300) });
    $('#m-toevent').onclick = () => openEventForm({ title: i.title, child_id: i.child_id, starts_at: i.occurred_at || new Date().toISOString(), item_id: i.id, notes: (i.body || '').slice(0, 300) });
    const del = $('#m-del'); if (del) del.onclick = async () => { if (!confirm('Usunąć wpis?')) return; const { error } = await sb.from('items').delete().eq('id', i.id); if (error) return fail(error); S.items = S.items.filter(x => x.id !== i.id); closeModal(); render(); };
  }

  function attachmentsHtml(i) {
    const files = (i.raw && Array.isArray(i.raw.attachments)) ? i.raw.attachments : [];
    if (!files.length) return '';
    return `<div class="section-title" style="margin-top:14px">Załączniki</div><ul class="list-plain">${files.map(f =>
      `<li><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">📎 ${esc(f.name)}</span><button class="btn sm" data-att="${esc(f.path)}">Otwórz</button></li>`).join('')}</ul>`;
  }

  async function openAttachment(path, btn) {
    btn.disabled = true; btn.textContent = '…';
    const { data, error } = await sb.storage.from('attachments').createSignedUrl(path, 3600);
    btn.disabled = false; btn.textContent = 'Otwórz';
    if (error || !data?.signedUrl) return fail(error || 'Nie udało się pobrać pliku');
    window.open(data.signedUrl, '_blank', 'noopener');
  }

  // -------------------------------------------------------------- forms
  function childOptions(sel) { return `<option value="">— brak —</option>` + S.children.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join(''); }
  function memberOptions(sel) { return `<option value="">— nieprzypisane —</option>` + S.members.map(m => `<option value="${m.user_id}" ${m.user_id === sel ? 'selected' : ''}>${esc(m.display_name)}</option>`).join(''); }

  function openAddMenu() {
    openModal('Dodaj', `
      <ul class="list-plain">
        <li><button class="btn" style="width:100%;text-align:left" id="a-task">☑ Zadanie</button></li>
        <li><button class="btn" style="width:100%;text-align:left" id="a-event">📅 Wydarzenie w kalendarzu</button></li>
        <li><button class="btn" style="width:100%;text-align:left" id="a-item">✉ Wpis / notatka (np. kartka z plecaka)</button></li>
      </ul>`);
    $('#a-task').onclick = () => openTaskForm({});
    $('#a-event').onclick = () => openEventForm({});
    $('#a-item').onclick = () => openItemForm();
  }

  function openTaskForm(t) {
    const isNew = !t.id;
    openModal(isNew ? 'Nowe zadanie' : 'Zadanie', `
      <form id="f">
        <label>Tytuł<input name="title" required value="${esc(t.title || '')}"></label>
        <div class="row">
          <label>Dziecko<select name="child_id">${childOptions(t.child_id)}</select></label>
          <label>Kto robi<select name="assignee">${memberOptions(t.assignee ?? (isNew ? S.me.user_id : null))}</select></label>
        </div>
        <label>Termin<input type="date" name="due" value="${t.due_at ? dateKey(t.due_at) : ''}"></label>
        <label>Notatki<textarea name="notes">${esc(t.notes || '')}</textarea></label>
        <button class="btn primary" type="submit">${isNew ? 'Dodaj' : 'Zapisz'}</button>
        ${isNew ? '' : '<button class="btn danger" type="button" id="f-del" style="width:100%;margin-top:8px">Usuń zadanie</button>'}
      </form>`);
    $('#f').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const rec = { title: f.get('title').trim(), child_id: f.get('child_id') || null, assignee: f.get('assignee') || null, due_at: f.get('due') ? new Date(f.get('due') + 'T12:00:00').toISOString() : null, notes: f.get('notes').trim() || null };
      let q;
      if (isNew) q = sb.from('tasks').insert({ ...rec, item_id: t.item_id || null, created_by: S.me.user_id }).select().single();
      else q = sb.from('tasks').update(rec).eq('id', t.id).select().single();
      const { data, error } = await q; if (error) return fail(error);
      if (isNew) S.tasks.push(data); else Object.assign(S.tasks.find(x => x.id === t.id), data);
      closeModal(); render(); toast(isNew ? 'Zadanie dodane' : 'Zapisano');
    };
    const del = $('#f-del'); if (del) del.onclick = async () => { if (!confirm('Usunąć zadanie?')) return; const { error } = await sb.from('tasks').delete().eq('id', t.id); if (error) return fail(error); S.tasks = S.tasks.filter(x => x.id !== t.id); closeModal(); render(); };
  }

  function openEventForm(e0) {
    const isNew = !e0.id;
    const start = e0.starts_at ? new Date(e0.starts_at) : new Date();
    openModal(isNew ? 'Nowe wydarzenie' : 'Wydarzenie', `
      <form id="f">
        <label>Tytuł<input name="title" required value="${esc(e0.title || '')}"></label>
        <label>Dziecko<select name="child_id">${childOptions(e0.child_id)}</select></label>
        <label style="display:flex;align-items:center;gap:8px;margin-top:12px"><input type="checkbox" name="all_day" style="width:auto;margin:0" ${e0.all_day !== false ? 'checked' : ''}> Cały dzień</label>
        <div class="row">
          <label>Początek<input type="datetime-local" name="starts" required value="${toLocalInput(start)}"></label>
          <label>Koniec<input type="datetime-local" name="ends" value="${e0.ends_at ? toLocalInput(e0.ends_at) : ''}"></label>
        </div>
        <label>Notatki<textarea name="notes">${esc(e0.notes || '')}</textarea></label>
        <button class="btn primary" type="submit">${isNew ? 'Dodaj' : 'Zapisz'}</button>
        ${isNew ? '' : '<button class="btn danger" type="button" id="f-del" style="width:100%;margin-top:8px">Usuń wydarzenie</button>'}
      </form>`);
    $('#f').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const rec = { title: f.get('title').trim(), child_id: f.get('child_id') || null, all_day: !!f.get('all_day'), starts_at: new Date(f.get('starts')).toISOString(), ends_at: f.get('ends') ? new Date(f.get('ends')).toISOString() : null, notes: f.get('notes').trim() || null };
      let q;
      if (isNew) q = sb.from('events').insert({ ...rec, item_id: e0.item_id || null, created_by: S.me.user_id }).select().single();
      else q = sb.from('events').update(rec).eq('id', e0.id).select().single();
      const { data, error } = await q; if (error) return fail(error);
      if (isNew) S.events.push(data); else Object.assign(S.events.find(x => x.id === e0.id), data);
      S.events.sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
      closeModal(); render(); toast(isNew ? 'Wydarzenie dodane' : 'Zapisano');
    };
    const del = $('#f-del'); if (del) del.onclick = async () => { if (!confirm('Usunąć wydarzenie?')) return; const { error } = await sb.from('events').delete().eq('id', e0.id); if (error) return fail(error); S.events = S.events.filter(x => x.id !== e0.id); closeModal(); render(); };
  }

  function openItemForm() {
    openModal('Nowy wpis', `
      <form id="f">
        <label>Tytuł<input name="title" required placeholder="np. Kartka: wycieczka do ZOO, 40 zł"></label>
        <div class="row">
          <label>Dziecko<select name="child_id">${childOptions()}</select></label>
          <label>Rodzaj<select name="kind">${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        </div>
        <label>Dotyczy daty (opcjonalnie)<input type="date" name="occ"></label>
        <label>Treść<textarea name="body"></textarea></label>
        <button class="btn primary" type="submit">Dodaj</button>
      </form>`);
    $('#f').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const rec = { title: f.get('title').trim(), child_id: f.get('child_id') || null, kind: f.get('kind'), body: f.get('body').trim() || null, source: 'manual', external_id: crypto.randomUUID(), sender: S.me.display_name, occurred_at: f.get('occ') ? new Date(f.get('occ') + 'T12:00:00').toISOString() : null };
      const { data, error } = await sb.from('items').insert(rec).select().single(); if (error) return fail(error);
      S.items.unshift(data); S.reads.add(data.id);
      sb.from('item_reads').insert({ item_id: data.id, user_id: S.me.user_id }).then(() => {});
      closeModal(); render(); toast('Wpis dodany');
    };
  }

  // -------------------------------------------------------------- settings
  function openSettings() {
    openModal('Ustawienia', `
      <h3 style="margin:8px 0">Dzieci</h3>
      <ul class="list-plain" id="kids">${S.children.map(c => `<li><span class="dot" style="background:${c.color};width:14px;height:14px"></span><span style="flex:1">${esc(c.name)} <span class="muted">${esc(c.institution || '')}</span></span><button class="btn sm" data-edit="${c.id}">Edytuj</button></li>`).join('') || '<li class="muted">Brak dzieci — dodaj pierwsze.</li>'}</ul>
      <button class="btn" id="add-kid" style="margin-top:10px">+ Dodaj dziecko</button>
      <h3 style="margin:22px 0 8px">Rodzina</h3>
      <ul class="list-plain">${S.members.map(m => `<li><span class="dot" style="background:${m.color};width:14px;height:14px"></span><span style="flex:1">${esc(m.display_name)}${m.user_id === S.me.user_id ? ' (ja)' : ''}</span></li>`).join('')}</ul>
      <p class="muted" style="font-size:.85rem">Zalogowano jako ${esc(S.user.email)}.</p>
      <button class="btn" id="logout">Wyloguj</button>
      <p class="muted" style="font-size:.75rem;margin-top:18px">Agent Dużej Rodziny · ${S.items.length} wpisów, ${S.tasks.length} zadań, ${S.events.length} wydarzeń</p>`);
    $('#add-kid').onclick = () => openChildForm({});
    $$('#kids [data-edit]').forEach(b => b.onclick = () => openChildForm(child(b.dataset.edit)));
    $('#logout').onclick = () => sb.auth.signOut();
  }

  function openChildForm(c) {
    const isNew = !c.id; const color = c.color || COLORS[S.children.length % COLORS.length];
    openModal(isNew ? 'Nowe dziecko' : 'Dziecko', `
      <form id="f">
        <label>Imię<input name="name" required value="${esc(c.name || '')}"></label>
        <label>Placówka<select name="institution"><option value="">—</option>${['szkoła', 'przedszkole', 'żłobek'].map(x => `<option ${c.institution === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
        <label>Kolor</label>
        <div class="color-pick">${COLORS.map(col => `<label><input type="radio" name="color" value="${col}" ${col === color ? 'checked' : ''}><span style="background:${col}"></span></label>`).join('')}</div>
        <button class="btn primary" type="submit">${isNew ? 'Dodaj' : 'Zapisz'}</button>
        ${isNew ? '' : '<button class="btn danger" type="button" id="f-del" style="width:100%;margin-top:8px">Usuń dziecko</button>'}
      </form>`);
    $('#f').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const rec = { name: f.get('name').trim(), institution: f.get('institution') || null, color: f.get('color') };
      const q = isNew ? sb.from('children').insert({ ...rec, sort_order: S.children.length }).select().single() : sb.from('children').update(rec).eq('id', c.id).select().single();
      const { data, error } = await q; if (error) return fail(error);
      if (isNew) S.children.push(data); else Object.assign(child(c.id), data);
      openSettings(); render();
    };
    const del = $('#f-del'); if (del) del.onclick = async () => { if (!confirm('Usunąć dziecko? Zadania i wpisy zostaną, ale bez przypisania.')) return; const { error } = await sb.from('children').delete().eq('id', c.id); if (error) return fail(error); S.children = S.children.filter(x => x.id !== c.id); openSettings(); render(); };
  }

  // -------------------------------------------------------------- modal
  function openModal(title, html) { $('#modal-title').innerHTML = title; $('#modal-body').innerHTML = html; $('#modal').classList.remove('hidden'); const first = $('#modal-body input,#modal-body textarea'); if (first && window.innerWidth > 640) first.focus(); }
  function closeModal() { $('#modal').classList.add('hidden'); }

  boot().catch(fail);
})();
