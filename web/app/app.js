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
    taskFilter: 'all',
    itemsFilter: 'all',
    itemsQuery: '',
    itemsChild: '',
    itemsKind: '',
    gradesChild: '',
    calMonth: startOfMonth(new Date()),
    calSel: dateKey(new Date()),
    calChild: '',
    calKind: '',
    senderRules: new Map(),
    comments: [],
    commentReads: new Set(),
    openId: null,
    lastChatSeen: (() => { try { return Number(localStorage.getItem('adr_lastChatSeen') || 0); } catch (e) { return 0; } })(),
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const VIEW_TITLES = { today: 'Dziś', calendar: 'Kalendarz', tasks: 'Zadania', items: 'Wiadomości', grades: 'Oceny', chat: 'Czat' };
  const TEST_RE = /sprawdzian|kartk[óo]wk|dyktand|praca klasowa|klas[óo]wk|\btest\b|egzamin/i;
  const HOMEWORK_RE = /zadani|praca domowa|zad\. dom/i;
  const KIND_LABEL = { message: 'Wiadomość', announcement: 'Ogłoszenie', homework: 'Zadanie domowe', event: 'Wydarzenie', grade: 'Ocena', attendance: 'Frekwencja', other: 'Inne' };
  const SOURCE_LABEL = { librus: 'Librus', '4parents': '4Parents', manual: 'Ręcznie' };
  const COLORS = ['#0ea5e9', '#8b5cf6', '#ec4899', '#f97316', '#22c55e', '#eab308', '#14b8a6', '#ef4444'];
  const DAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  const MONTHS = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];

  // -------------------------------------------------------------- utils
  function startOfMonth(d) { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; }
  function addMonths(d, n) { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
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
  function memberChip(id, childAssignee = false) {
    if (childAssignee) return '<span class="chip"><span class="dot" style="background:#8b5cf6"></span>Dziecko</span>';
    const m = member(id);
    return m ? `<span class="chip"><span class="dot" style="background:${m.color}"></span>${esc(m.display_name)}</span>` : '<span class="chip">nieprzypisane</span>';
  }
  const isAssigned = t => !!t.assignee || !!t.child_assignee;
  function itemForEvent(e) { return e.item_id ? S.items.find(i => i.id === e.item_id) : S.items.find(i => i.source === e.source && i.external_id === e.external_id); }
  function taskForEvent(e) { const i = itemForEvent(e); return i ? S.tasks.find(t => t.item_id === i.id) : null; }
  function testKw(title) { const m = title.match(TEST_RE); return m ? m[0].toLowerCase().slice(0, 5) : null; }
  function twinEventItem(msg) {
    if (msg.kind !== 'message' || !msg.occurred_at) return null;
    const kw = testKw(msg.title); if (!kw) return null;
    const d = dateKey(msg.occurred_at);
    return S.items.find(i => i.kind === 'event' && i.child_id === msg.child_id && i.occurred_at && dateKey(i.occurred_at) === d && i.title.toLowerCase().includes(kw)) || null;
  }
  function twinMessage(evItem) {
    if (evItem.kind !== 'event' || !evItem.occurred_at) return null;
    const kw = testKw(evItem.title); if (!kw) return null;
    const d = dateKey(evItem.occurred_at);
    return S.items.find(i => i.kind === 'message' && i.child_id === evItem.child_id && i.occurred_at && dateKey(i.occurred_at) === d && i.title.toLowerCase().includes(kw)) || null;
  }
  function goToTask(id) { S.openId = id; setView('tasks'); setTimeout(() => { const el = document.querySelector(`[data-task="${id}"]`); if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 50); }
  function mentionsMe(c) { return c.author !== S.me.user_id && new RegExp('@' + S.me.display_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(c.body); }
  function unreadMentions() { return S.comments.filter(c => mentionsMe(c) && !S.commentReads.has(c.id)); }
  function taskUnreadMentions(taskId) { return unreadMentions().filter(c => c.task_id === taskId).length; }
  function fmtComment(body) { return esc(body).replace(/@([\p{L}]+)/gu, '<span class="m">@$1</span>'); }

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
    watchForUpdates();
  }

  // -------------------------------------------------------------- motyw
  function getTheme() { try { return localStorage.getItem('adr_theme') || 'auto'; } catch (e) { return 'auto'; } }
  function applyThemeIcon() {
    const t = getTheme(); const b = $('#btn-theme');
    b.textContent = t === 'dark' ? '☾' : t === 'light' ? '☀' : '◐';
    b.title = 'Motyw: ' + (t === 'dark' ? 'ciemny' : t === 'light' ? 'jasny' : 'automatyczny (jak system)');
    const meta = document.querySelector('meta[name=theme-color]');
    const dark = t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (meta) meta.content = dark ? '#0b1020' : '#ffffff';
  }
  function cycleTheme() {
    const order = ['auto', 'dark', 'light']; const next = order[(order.indexOf(getTheme()) + 1) % order.length];
    try { if (next === 'auto') localStorage.removeItem('adr_theme'); else localStorage.setItem('adr_theme', next); } catch (e) {}
    if (next === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', next);
    applyThemeIcon(); toast('Motyw: ' + (next === 'dark' ? 'ciemny' : next === 'light' ? 'jasny' : 'automatyczny'));
  }

  async function refreshData() {
    const b = $('#btn-refresh'); b.classList.add('spinning');
    try { await loadAll(); render(); toast('Odświeżono'); } catch (e) { fail(e); }
    finally { b.classList.remove('spinning'); }
    checkForUpdate();
  }

  // -------------------------------------------------------------- aktualizacje aplikacji
  let currentVersion = null;
  async function fetchVersion() {
    try { const r = await fetch('version.txt', { cache: 'no-store' }); return r.ok ? (await r.text()).trim() : null; } catch (e) { return null; }
  }
  async function checkForUpdate() {
    const v = await fetchVersion();
    if (!v) return;
    if (currentVersion === null) { currentVersion = v; return; }
    if (v !== currentVersion) $('#update-bar').classList.remove('hidden');
  }
  function watchForUpdates() {
    $('#update-btn').onclick = async () => {
      try { const regs = await navigator.serviceWorker?.getRegistrations?.(); for (const r of regs || []) await r.unregister(); const keys = await caches?.keys?.(); for (const k of keys || []) await caches.delete(k); } catch (e) {}
      location.reload();
    };
    checkForUpdate();
    setInterval(checkForUpdate, 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(); });
  }

  // -------------------------------------------------------------- data
  async function loadAll() {
    const since = new Date(); since.setDate(since.getDate() - 60);
    const [ch, ta, ev, it, rd, ms, tc, cr, cp, sr] = await Promise.all([
      sb.from('children').select('*').order('sort_order').order('name'),
      sb.from('tasks').select('*').order('due_at', { ascending: true, nullsFirst: false }).order('created_at'),
      sb.from('events').select('*').order('starts_at'),
      sb.from('items').select('*').order('published_at', { ascending: false }).limit(300),
      sb.from('item_reads').select('item_id').eq('user_id', S.me.user_id),
      sb.from('messages').select('*').order('created_at', { ascending: false }).limit(200),
      sb.from('task_comments').select('*').order('created_at'),
      sb.from('comment_reads').select('comment_id').eq('user_id', S.me.user_id),
      sb.from('task_completions').select('task_id,day'),
      sb.from('sender_rules').select('*'),
    ]);
    for (const r of [ch, ta, ev, it, rd, ms]) if (r.error) return fail(r.error);
    S.children = ch.data; S.tasks = ta.data; S.events = ev.data; S.items = it.data;
    S.reads = new Set(rd.data.map(r => r.item_id)); S.messages = ms.data.reverse();
    S.comments = tc.error ? [] : tc.data; S.commentReads = new Set(cr.error ? [] : cr.data.map(r => r.comment_id));
    S.completions = new Set(cp.error ? [] : cp.data.map(r => `${r.task_id}|${r.day}`));
    S.senderRules = new Map((sr.error ? [] : sr.data).map(r => [`${r.source}|${r.sender}`, r]));
  }

  function subscribeRealtime() {
    sb.channel('family')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, p => { if (p.eventType === 'INSERT') { S.messages.push(p.new); if (S.view === 'chat') markChatSeen(); render(); } else if (p.eventType === 'DELETE') { S.messages = S.messages.filter(m => m.id !== (p.old && p.old.id)); render(); } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, async () => { const { data } = await sb.from('tasks').select('*').order('due_at', { ascending: true, nullsFirst: false }).order('created_at'); if (data) { S.tasks = data; render(); } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, async () => { const { data } = await sb.from('events').select('*').order('starts_at'); if (data) { S.events = data; render(); } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, async () => { const { data } = await sb.from('task_comments').select('*').order('created_at'); if (data) { S.comments = data; if (S.openId) refreshComments(S.openId); render(); } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sender_rules' }, async () => { const { data } = await sb.from('sender_rules').select('*'); if (data) { S.senderRules = new Map(data.map(r => [`${r.source}|${r.sender}`, r])); render(); } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_completions' }, async () => { const { data } = await sb.from('task_completions').select('task_id,day'); if (data) { S.completions = new Set(data.map(r => `${r.task_id}|${r.day}`)); render(); } })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, async () => { const { data } = await sb.from('items').select('*').order('published_at', { ascending: false }).limit(300); if (data) { S.items = data; render(); } })
      .subscribe();
  }

  // -------------------------------------------------------------- UI bindings
  function bindUI() {
    $$('.bottom-nav button').forEach(b => b.onclick = () => setView(b.dataset.nav));
    $('#fab').onclick = () => openAddMenu();
    $('#btn-settings').onclick = openSettings;
    $('#btn-refresh').onclick = refreshData;
    $('#btn-theme').onclick = cycleTheme; applyThemeIcon();
    $('#modal-close').onclick = closeModal;
    $('#modal').onclick = e => { if (e.target.id === 'modal') closeModal(); };

    $('#cal-prev').onclick = () => { S.calMonth = addMonths(S.calMonth, -1); render(); };
    $('#cal-next').onclick = () => { S.calMonth = addMonths(S.calMonth, 1); render(); };
    $('#cal-today').onclick = () => { S.calMonth = startOfMonth(new Date()); S.calSel = dateKey(new Date()); render(); };

    $('#task-filter').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; S.taskFilter = b.dataset.f; render(); };
    $$('#items-filter button').forEach(b => b.onclick = () => { S.itemsFilter = b.dataset.f; render(); });
    $('#mark-all-read').onclick = markAllRead;
    $('#items-search').oninput = e => { S.itemsQuery = e.target.value; render(); };
    $('#go-senders').onclick = () => setView('senders');
    $('#senders-back').onclick = () => setView('items');
    $('#items-child').onclick = e => { const b = e.target.closest('[data-child]'); if (!b) return; S.itemsChild = b.dataset.child; render(); };
    $$('#items-kind .tile').forEach(b => b.onclick = () => { S.itemsKind = S.itemsKind === b.dataset.k ? '' : b.dataset.k; render(); });
    $('#grades-child').onclick = e => { const b = e.target.closest('[data-child]'); if (!b) return; S.gradesChild = b.dataset.child; render(); };

    const ep = $('#emoji-panel');
    ep.innerHTML = EMOJI.map(e => `<button type="button">${e}</button>`).join('');
    ep.onclick = e => { const b = e.target.closest('button'); if (!b) return; const inp = $('#chat-input'); inp.value += b.textContent; inp.focus(); };
    $('#chat-emoji').onclick = () => ep.classList.toggle('hidden');
    $('#chat-attach').onclick = () => $('#chat-file').click();
    $('#chat-file').onchange = e => { const f = e.target.files[0]; e.target.value = ''; sendChatImage(f); };
    $('#chat-input').addEventListener('paste', e => {
      const f = [...(e.clipboardData?.files || [])][0];
      if (f && f.type.startsWith('image/')) { e.preventDefault(); sendChatImage(f); }
    });
    $('#chat-form').onsubmit = async e => {
      e.preventDefault();
      const inp = $('#chat-input'); const body = inp.value.trim(); if (!body) return;
      inp.value = ''; $('#emoji-panel').classList.add('hidden');
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
    $$('#items-kind .tile').forEach(b => {
      b.classList.toggle('on', b.dataset.k === S.itemsKind);
      const all = S.items.filter(i => kindMatch(i, b.dataset.k) && (!S.itemsChild || i.child_id === S.itemsChild) && !twinEventItem(i));
      const nw = all.filter(i => !S.reads.has(i.id)).length;
      const c = b.querySelector('.cnt');
      if (b.dataset.k === 'archive') { c.textContent = all.length ? `${all.length}` : '—'; c.classList.remove('new'); }
      else { c.textContent = nw ? `${nw} nowe` : (all.length ? `${all.length}` : '—'); c.classList.toggle('new', nw > 0); }
    });
    ({ today: renderToday, calendar: renderCalendar, tasks: renderTasks, items: renderItems, grades: renderGrades, chat: renderChat, senders: renderSenders })[S.view]();
  }

  function renderBadges() {
    const myOpen = S.tasks.filter(t => t.status !== 'done' && t.assignee === S.me.user_id).length;
    const unread = S.items.filter(i => !S.reads.has(i.id) && i.kind !== 'grade' && !isArchived(i) && !twinEventItem(i)).length;
    const unreadGrades = S.items.filter(i => !S.reads.has(i.id) && i.kind === 'grade').length;
    $('#badge-grades').textContent = unreadGrades || '';
    const newChat = S.messages.filter(m => m.sender !== S.me.user_id && new Date(m.created_at).getTime() > S.lastChatSeen).length;
    const mentions = unreadMentions().length;
    $('#badge-tasks').textContent = (myOpen + mentions) || '';
    $('#badge-items').textContent = unread || '';
    $('#badge-chat').textContent = newChat || '';
  }

  function childChips(selected, allowAll) {
    const chip = (id, name, color) => `<button data-child="${id}" class="${selected === id ? 'on' : ''}">${color ? `<span class="dot" style="background:${color}"></span>` : ''}${esc(name)}</button>`;
    return (allowAll ? chip('', 'Wszystkie dzieci', null) : '') + S.children.map(c => chip(c.id, c.name, c.color)).join('');
  }

  function renderChildSelect() {
    $('#items-child').innerHTML = childChips(S.itemsChild, true);
    const withGrades = S.children.filter(c => S.items.some(i => i.kind === 'grade' && i.child_id === c.id));
    const list = withGrades.length ? withGrades : S.children;
    if (!S.gradesChild || !list.some(c => c.id === S.gradesChild)) S.gradesChild = list[0]?.id || '';
    $('#grades-child').innerHTML = S.children.map(c => `<button data-child="${c.id}" class="${S.gradesChild === c.id ? 'on' : ''}"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</button>`).join('') || '<span class="muted">Dodaj dzieci w ustawieniach.</span>';
  }

  // ---- DZIŚ
  function renderToday() {
    const now = new Date(); const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const in7 = addDays(todayStart, 7);
    const standing = S.tasks.filter(t => isRepeating(t) && activeOn(t, now) && (t.assignee === S.me.user_id || t.child_assignee || !isAssigned(t)));
    const myTasks = S.tasks.filter(t => !isRepeating(t) && t.status !== 'done' && (t.assignee === S.me.user_id || !isAssigned(t)));
    const overdue = myTasks.filter(t => t.due_at && new Date(t.due_at) < todayStart);
    const weekTasks = S.tasks.filter(t => !isRepeating(t) && t.due_at && new Date(t.due_at) >= todayStart && new Date(t.due_at) < in7);
    const events = S.events.filter(e => new Date(e.starts_at) >= todayStart && new Date(e.starts_at) < in7 && !taskForEvent(e));
    const noDateMine = myTasks.filter(t => !t.due_at);
    const unread = S.items.filter(i => !S.reads.has(i.id) && i.kind !== 'grade' && !isArchived(i) && !twinEventItem(i)).slice(0, 8);
    const greeting = now.getHours() < 12 ? 'Dzień dobry' : now.getHours() < 18 ? 'Cześć' : 'Dobry wieczór';

    let h = `<h2>${greeting}, ${esc(S.me.display_name)}</h2><p class="muted">${DAYS[now.getDay()]}, ${fmtDate(now)}</p>`;
    if (!S.children.length) h += `<div class="card"><div class="grow"><div class="title">Zacznij od dodania dzieci</div><div class="meta">Ustawienia (⚙) → Dzieci. Każde dziecko dostaje swój kolor.</div></div><div class="actions"><button class="btn sm" data-act="settings">Otwórz</button></div></div>`;

    const um = unreadMentions();
    if (um.length) h += `<div class="section-title">Wzmianki dla Ciebie</div>` + um.map(c => { const t = S.tasks.find(x => x.id === c.task_id); return t ? `<div class="card clickable" style="border-left-color:#0ea5e9" data-task="${t.id}"><div class="grow" data-act="edit-task"><div class="title">💬 ${esc(member(c.author)?.display_name || '')}: ${fmtComment(c.body)}</div><div class="meta"><span>w zadaniu: ${esc(t.title)}</span><span>${fmtDateTime(c.created_at)}</span></div></div></div>` : ''; }).join('');
    if (standing.length) { const left = standing.filter(t => !doneToday(t)).length;
      h += `<div class="section-title">Na dziś, stałe${left ? ` · zostało ${left}` : ' · wszystko odhaczone ✓'}</div>` + standing.map(t => taskCard(t)).join(''); }
    if (overdue.length) { h += `<div class="section-title">Po terminie</div>` + overdue.map(taskCard).join(''); }
    h += `<div class="section-title">Najbliższe 7 dni</div>`;
    const merged = [
      ...events.map(e => ({ when: new Date(e.starts_at), html: eventCard(e) })),
      ...weekTasks.map(t => ({ when: new Date(t.due_at), html: taskCard(t) })),
    ].sort((a, b) => a.when - b.when);
    h += merged.length ? groupByDay(merged) : `<div class="empty">Nic zaplanowanego. Spokojny tydzień 🙂</div>`;
    if (noDateMine.length) h += `<div class="section-title">Moje zadania bez terminu</div>` + noDateMine.map(taskCard).join('');
    if (unread.length) h += `<div class="section-title">Nieprzeczytane wiadomości</div>` + unread.map(itemCard).join('');
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

  // ---- KALENDARZ (miesiąc)
  const MONTHS_FULL = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
  function renderCalendar() {
    const m0 = S.calMonth;
    $('#cal-range').textContent = `${MONTHS_FULL[m0.getMonth()]} ${m0.getFullYear()}`;
    const gridStart = startOfWeek(m0);
    const todayKey = dateKey(new Date());
    const byDay = new Map();
    const push = (k, x) => { if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(x); };
    $('#cal-child').innerHTML = childChips(S.calChild, true);
    $$('#cal-kind button').forEach(b => b.classList.toggle('on', b.dataset.k === S.calKind));
    const calKindOf = (title, cat) => { const head = (title.split(':')[0] || '') + ' ' + (cat || ''); return TEST_RE.test(cat + ' ' + title) ? 'test' : HOMEWORK_RE.test(head) ? 'homework' : 'other'; };
    const okChild = cid => !S.calChild || cid === S.calChild;
    const okKind = k => !S.calKind || k === S.calKind;
    for (const e of S.events) { const k = calKindOf(e.title, ''); if (okChild(e.child_id) && okKind(k)) push(dateKey(e.starts_at), { kind: 'event', ck: k, when: new Date(e.starts_at), e }); }
    // Zadania przedszkolne są w widoku "Wszystko" na równi z resztą; kafelek je wyodrębnia.
    if (!S.calKind || S.calKind === 'kinder') {
      for (const i of S.items) if (isKinderTask(i) && okChildItem(i, S.calChild)) push(dateKey(i.occurred_at), { kind: 'item', ck: 'kinder', when: new Date(i.occurred_at), i });
    }
    for (const i of S.items) if (i.kind === 'message' && i.occurred_at && TEST_RE.test(i.title) && okChild(i.child_id) && okKind('test')) {
      const kw = (i.title.match(TEST_RE) || [''])[0].toLowerCase().slice(0, 5);
      const dup = S.events.some(e => e.child_id === i.child_id && dateKey(e.starts_at) === dateKey(i.occurred_at) && e.title.toLowerCase().includes(kw));
      if (!dup) push(dateKey(i.occurred_at), { kind: 'item', ck: 'test', when: new Date(i.occurred_at), i });
    }
    let h = '<div class="month">' + ['Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So', 'Nd'].map(d => `<div class="dow">${d}</div>`).join('');
    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i); const k = dateKey(d);
      if (i >= 35 && d.getMonth() !== m0.getMonth()) break;
      const list = (byDay.get(k) || []).sort((a, b) => a.when - b.when);
      const cls = ['day', d.getMonth() !== m0.getMonth() ? 'other' : '', k === todayKey ? 'today' : '', k === S.calSel ? 'sel' : '', d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''].join(' ');
      const max = 4;
      h += `<div class="${cls}" data-day="${k}"><div class="dn">${d.getDate()}</div>` + list.slice(0, max).map(x => {
        const obj = x.kind === 'item' ? x.i : x.e; const c = child(x.kind === 'item' ? effChild(obj) : obj.child_id); const isTest = x.ck === 'test';
        const trip = /wycieczk|wyjazd|wyjści|kino|teatr|muzeum/i.test(obj.title);
        const ico = isTest ? '<span class="pi">!</span>' : x.ck === 'kinder' ? '🧸 ' : x.ck === 'homework' ? '📚 ' : trip ? '🚗 ' : '📣 ';
        const label = x.ck === 'kinder' ? kinderLabel(obj) : obj.title.replace(/^[^:·]*·\s*/, '');
        return `<div class="pill ${isTest ? 'test' : ''}" style="background:${c ? c.color : '#64748b'}" title="${esc(obj.title)}">${ico}${esc(label)}</div>`;
      }).join('') + (list.length > max ? `<div class="more">+${list.length - max}</div>` : '') + '</div>';
    }
    h += '</div><div class="cal-legend"><span><span class="pi">!</span>sprawdzian / kartkówka / dyktando</span><span>📚 zadanie domowe</span><span>🚗 wycieczka / wyjście</span><span>📣 inne</span><span>🧸 zadania przedszkolne</span><span>kolor = dziecko</span></div>';
    $('#calendar-content').innerHTML = h;
    $('#calendar-content').onclick = e => { const d = e.target.closest('[data-day]'); if (!d) return; S.calSel = d.dataset.day; render(); };
    $('#cal-child').onclick = e => { const b = e.target.closest('[data-child]'); if (!b) return; S.calChild = b.dataset.child; render(); };
    $$('#cal-kind button').forEach(b => b.onclick = () => { S.calKind = b.dataset.k; render(); });

    // szczegóły wybranego dnia
    const sel = new Date(S.calSel + 'T12:00:00');
    const list = (byDay.get(S.calSel) || []).sort((a, b) => a.when - b.when);
    const dd = $('#calendar-day');
    dd.innerHTML = `<div class="day-detail">${dayHead(sel)}` + (list.length ? list.map(x => x.kind === 'item' ? itemCard(x.i) : eventCard(x.e)).join('') : `<div class="muted" style="padding:4px 0 10px 4px;font-size:.9rem">Nic zaplanowanego.</div>`) + `<button class="btn sm" data-act="add-event" data-day="${S.calSel}">+ Wydarzenie tego dnia</button></div>`;
    wireCards(dd);
  }

  // ---- ZADANIA STAŁE (powtarzalne)
  const REPEATS = [['', 'Jednorazowe'], ['daily', 'Codziennie'], ['weekdays', 'W dni powszednie (pn–pt)'], ['weekly', 'Co tydzień']];
  const REPEAT_LABEL = { daily: 'codziennie', weekdays: 'pn–pt', weekly: 'co tydzień' };
  function isRepeating(t) { return !!t.repeat; }
  function doneOn(t, d) { return S.completions.has(`${t.id}|${dateKey(d)}`); }
  function doneToday(t) { return doneOn(t, new Date()); }
  // status pokazywany: dla zadania stałego liczy się odhaczenie DZISIAJ, nie globalny status
  function effStatus(t) { return isRepeating(t) ? (doneToday(t) ? 'done' : (t.status === 'doing' ? 'doing' : 'todo')) : t.status; }
  function nextOccurrence(t) {
    const d = new Date(); d.setHours(12, 0, 0, 0);
    for (let n = 0; n < 400; n++) { if (activeOn(t, d)) return d; d.setDate(d.getDate() + 1); }
    return null;
  }
  function activeOn(t, d) {
    const k = dateKey(d);
    if (t.starts_at && dateKey(t.starts_at) > k) return false;
    if (t.due_at && dateKey(t.due_at) < k) return false;
    const wd = new Date(d).getDay();
    if (t.repeat === 'weekdays') return wd >= 1 && wd <= 5;
    if (t.repeat === 'weekly') return t.starts_at ? new Date(t.starts_at).getDay() === wd : true;
    return true;
  }

  // ---- ZADANIA: kanban
  const STATUS_COLS = [['todo', 'Do zrobienia'], ['doing', 'W toku'], ['done', 'Zrobione']];
  function renderTasks() {
    const f = S.taskFilter; const p = partner();
    const byDue = (a, b) => (a.due_at ? new Date(a.due_at) : Infinity) - (b.due_at ? new Date(b.due_at) : Infinity) || new Date(a.created_at) - new Date(b.created_at);
    // tablica: tylko zadania z przypisaną osobą; backlog: bez osoby
    let board = S.tasks.filter(isAssigned);
    if (f === 'mine') board = board.filter(t => t.assignee === S.me.user_id);
    if (f === 'partner') board = board.filter(t => p && t.assignee === p.user_id);
    if (f === 'child') board = board.filter(t => t.child_assignee);
    let h = '';
    for (const [st, label] of STATUS_COLS) {
      let col = board.filter(t => effStatus(t) === st);
      col = st === 'done' ? col.sort((a, b) => new Date(b.done_at || 0) - new Date(a.done_at || 0)).slice(0, 30) : col.sort(byDue);
      h += `<div class="col" data-status="${st}"><div class="col-head"><span>${label}</span><span class="n">${col.length}</span></div>`
        + (col.length ? col.map(t => taskCard(t, true)).join('') : `<div class="col-empty">${st === 'done' ? 'Jeszcze nic' : 'Pusto'}</div>`)
        + (st === 'done' ? '' : `<button class="col-add" data-act="add-task" data-status="${st}">+ Dodaj</button>`)
        + '</div>';
    }
    const root = $('#tasks-content');
    root.innerHTML = h;
    wireCards(root);
    wireDragDrop(root);

    const backlog = S.tasks.filter(t => !isAssigned(t) && effStatus(t) !== 'done').sort(byDue);
    const bl = $('#tasks-backlog');
    bl.innerHTML = `<div class="backlog-head"><span>Nieprzypisane zadania</span><span class="n">${backlog.length}</span></div>`
      + (backlog.length ? `<div class="backlog-grid">${backlog.map(t => taskCard(t, 'backlog')).join('')}</div>` : `<div class="col-empty">Pusto. Trafiają tu zadania bez osoby — także te tworzone automatycznie z wiadomości z terminem.</div>`)
      + `<button class="col-add" data-act="add-task" data-status="todo" data-backlog="1" style="margin-top:10px">+ Dodaj zadanie</button>`;
    wireCards(bl);
  }

  function wireDragDrop(root) {
    root.querySelectorAll('.card[draggable]').forEach(c => {
      c.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', c.dataset.task); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
      c.addEventListener('dragend', () => c.classList.remove('dragging'));
    });
    root.querySelectorAll('.col').forEach(col => {
      col.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; col.classList.add('drop'); });
      col.addEventListener('dragleave', () => col.classList.remove('drop'));
      col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('drop'); const id = e.dataTransfer.getData('text/plain'); const t = S.tasks.find(x => x.id === id); if (t && effStatus(t) !== col.dataset.status) setTaskStatus(id, col.dataset.status); });
    });
  }

  // ---- KTO PISZE O KIM -------------------------------------------------
  // 4Parents nie oznacza, kogo dotyczy wpis (140 ze 150 ogłoszeń idzie "do wszystkich"),
  // więc dziecko bierzemy z reguły przypisanej do nadawcy w Ustawieniach.
  const KINDER_TASK_RE = /przyni|przynie[śs]|prosz[ęe] o |zabra[ćc]|potrzebn|ubra|str[óo]j|przebra|wp[łl]at|kostium/i;
  function senderRule(i) { return i.sender ? S.senderRules.get(`${i.source}|${i.sender}`) : null; }
  function effChild(i) { if (i.child_id) return i.child_id; const r = senderRule(i); return r && r.scope === 'child' ? r.child_id : null; }
  function wholeSchool(i) {
    if (i.child_id) return false;
    const r = senderRule(i);
    if (r && r.scope === 'child') return false;
    return i.source === '4parents';
  }
  function okChildItem(i, cid) { if (!cid) return true; const e = effChild(i); return e ? e === cid : wholeSchool(i); }
  function isKinderTask(i) { return i.source === '4parents' && !!i.occurred_at && KINDER_TASK_RE.test(`${i.title} ${i.body || ''}`); }
  // Tytuł wpisu z przedszkola to zwykle "Drodzy Rodzice!" — na pigułce w kalendarzu
  // pokazujemy zdanie, w którym faktycznie jest prośba.
  function kinderLabel(i) {
    const zd = `${i.title}. ${i.body || ''}`.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);
    const hit = zd.find(x => KINDER_TASK_RE.test(x)) || i.title;
    return hit.length > 48 ? hit.slice(0, 47).replace(/\s+\S*$/, '') + '…' : hit;
  }

  // ---- WPISY
  function isArchived(i) {
    if (!i.occurred_at) return false;
    const t0 = new Date(); t0.setHours(0, 0, 0, 0);
    return new Date(i.occurred_at) < t0;
  }
  function catOf(i) {
    if (i.kind === 'grade') return 'grade';
    if (i.source === '4parents') return 'kinder';
    const head = (i.sender || '') + ' ' + (i.title.split(':')[0] || '');
    if ((i.kind === 'event' && TEST_RE.test((i.sender || '') + ' ' + i.title)) || (i.kind === 'message' && TEST_RE.test(i.title))) return 'test';
    if ((i.kind === 'homework' || (i.kind === 'event' && HOMEWORK_RE.test(head))) && !TEST_RE.test(i.title)) return 'homework';
    return 'message';
  }
  function kindMatch(i, k) {
    if (k === 'archive') return i.kind !== 'grade' && isArchived(i);
    if (i.kind !== 'grade' && isArchived(i)) return false;
    const c = catOf(i);
    if (c === 'grade') return false;
    return !k || c === k;
  }

  // bez polskich znaków i wielkości liter — "zdjecie" znajdzie "Zdjęcia"
  function norm(t) { return (t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l'); }
  function matchesQuery(i, q) {
    const hay = norm(`${i.title} ${i.body || ''} ${i.sender || ''}`);
    return q.split(/\s+/).filter(Boolean).every(w => hay.includes(w));
  }

  function itemsList() {
    const q = norm(S.itemsQuery).trim();
    // szukanie obejmuje WSZYSTKIE wiadomości, także archiwum — inaczej łatwo przeoczyć starszy wpis
    if (q) {
      let found = S.items.filter(i => i.kind !== 'grade' && !twinEventItem(i) && matchesQuery(i, q));
      if (S.itemsChild) found = found.filter(i => okChildItem(i, S.itemsChild));
      return found.sort((a, b) => new Date(b.occurred_at || b.published_at || 0) - new Date(a.occurred_at || a.published_at || 0));
    }
    let list = S.items.filter(i => kindMatch(i, S.itemsKind) && !twinEventItem(i));
    if (S.itemsFilter === 'unread') list = list.filter(i => !S.reads.has(i.id));
    if (S.itemsChild) list = list.filter(i => okChildItem(i, S.itemsChild));
    return list;
  }

  async function markAllRead() {
    const unread = itemsList().filter(i => !S.reads.has(i.id));
    if (!unread.length) return toast('Nie ma czego oznaczać ✓');
    unread.forEach(i => S.reads.add(i.id)); render();
    const rows = unread.map(i => ({ item_id: i.id, user_id: S.me.user_id }));
    for (let n = 0; n < rows.length; n += 200) {
      const { error } = await sb.from('item_reads').upsert(rows.slice(n, n + 200), { onConflict: 'item_id,user_id' });
      if (error) return fail(error);
    }
    toast(`Oznaczono ${unread.length} ${unread.length === 1 ? 'wiadomość' : 'wiadomości'} jako przeczytane`);
  }

  function renderItems() {
    const list = itemsList();
    const q = S.itemsQuery.trim();
    $$('#items-kind .tile').forEach(t => t.classList.toggle('dimmed', !!q));
    let html;
    if (q) {
      html = `<p class="hint">Szukam we wszystkich wiadomościach, też w archiwum. Znaleziono: ${list.length}.</p>`
        + (list.length ? list.map(itemCard).join('') : `<div class="empty">Nic nie pasuje do „${esc(q)}".</div>`);
    } else if (S.itemsKind === 'archive') {
      const arch = [...list].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at));
      html = arch.length ? groupByDay(arch.map(i => ({ when: new Date(i.occurred_at), html: itemCard(i) }))) : `<div class="empty">Archiwum puste.</div>`;
    } else if (S.itemsKind === 'test') {
      // sprawdziany: nadchodzące od najbliższego, potem minione
      const now = Date.now();
      const up = list.filter(i => i.occurred_at && new Date(i.occurred_at) >= now).sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
      const past = list.filter(i => !i.occurred_at || new Date(i.occurred_at) < now).sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0));
      html = (up.length ? `<div class="section-title">Nadchodzące</div>` + groupByDay(up.map(i => ({ when: new Date(i.occurred_at), html: itemCard(i) }))) : `<div class="empty">Brak zaplanowanych sprawdzianów 🎉</div>`)
        + (past.length ? `<div class="section-title">Bez terminu</div>` + past.map(itemCard).join('') : '');
    } else {
      html = list.length ? list.map(itemCard).join('')
        : `<div class="empty">${S.items.length ? (S.itemsFilter === 'unread' ? 'Brak nowych wiadomości ✓' : 'Brak wiadomości w tej kategorii.') : 'Jeszcze nie ma żadnych wiadomości. Pojawią się tu, gdy uruchomisz workera (Librus / 4Parents) albo dodasz wiadomość ręcznie.'}</div>`;
    }
    $('#items-content').innerHTML = html;
    const nw = list.filter(i => !S.reads.has(i.id)).length;
    const mb = $('#mark-all-read'); mb.textContent = `✓ Oznacz jako przeczytane${nw ? ` (${nw})` : ''}`; mb.disabled = !nw;
    $('#items-summary').textContent = list.length ? `${list.length} wiadomości${nw ? ` · ${nw} nowych` : ''}` : '';
    const sq = $('#items-search'); if (document.activeElement !== sq && sq.value !== S.itemsQuery) sq.value = S.itemsQuery;
    wireCards($('#items-content'));
  }

  // ---- MAPOWANIE NADAWCÓW -----------------------------------------------
  // Pomijamy domowników — Karolina jest właścicielką konta, więc jej wiadomości
  // są wychodzące, nie od przedszkola.
  function isHousehold(name) {
    const n = norm(name);
    return S.members.some(m => n.includes(norm(m.display_name))) || /brzesk/i.test(name);
  }

  function schoolYearStart() {
    const n = new Date();
    return new Date(n.getMonth() >= 8 ? n.getFullYear() : n.getFullYear() - 1, 8, 1);
  }

  async function markInactiveBulk(senders) {
    if (!senders.length) return;
    const rows = senders.map(x => ({ source: '4parents', sender: x, scope: 'inactive', child_id: null, updated_by: S.me.user_id, updated_at: new Date().toISOString() }));
    rows.forEach(r => S.senderRules.set(`4parents|${r.sender}`, r));
    render();
    const { error } = await sb.from('sender_rules').upsert(rows, { onConflict: 'source,sender' });
    if (error) return fail(error);
    toast(`Oznaczono ${senders.length} jako nieaktywnych`);
  }

  function senderStats() {
    const by = new Map();
    for (const i of S.items) {
      if (i.source !== '4parents' || !i.sender || isHousehold(i.sender)) continue;
      let r = by.get(i.sender);
      if (!r) { r = { sender: i.sender, n: 0, last: null, lastTitle: '' }; by.set(i.sender, r); }
      r.n++;
      const d = i.published_at || i.occurred_at;
      if (d && (!r.last || new Date(d) > new Date(r.last))) { r.last = d; r.lastTitle = i.title; }
    }
    return [...by.values()].sort((a, b) => b.n - a.n);
  }

  function renderSenders() {
    const list = senderStats();
    const ruleOf = s0 => S.senderRules.get(`4parents|${s0}`);
    const offCount = list.filter(r => { const x = ruleOf(r.sender); return x && x.scope === 'inactive'; }).length;
    const done = list.filter(r => { const x = ruleOf(r.sender); return x && x.scope !== 'inactive'; }).length;
    const covered = list.filter(r => { const x = ruleOf(r.sender); return x && x.scope !== 'inactive'; }).reduce((a, r) => a + r.n, 0);
    const total = list.reduce((a, r) => a + r.n, 0);

    const row = r => {
      const rl = ruleOf(r.sender);
      const val = rl ? (rl.scope === 'child' ? (rl.child_id || '') : rl.scope) : '';
      const c = rl && rl.scope === 'child' ? child(rl.child_id) : null;
      const opts = [['', '— nie przypisano —'], ['all', '🏫 całe przedszkole']]
        .concat(S.children.filter(k => k.institution !== 'szkoła').map(k => [k.id, k.name]))
        .concat(S.children.filter(k => k.institution === 'szkoła').map(k => [k.id, k.name + ' (szkoła)']))
        .concat([['inactive', '🚫 nieaktywny pracownik']])
        .map(([v, l]) => `<option value="${esc(v)}" ${val === v ? 'selected' : ''}>${esc(l)}</option>`).join('');
      return `<div class="card sender ${val === 'inactive' ? 'off' : ''}" style="border-left-color:${c ? c.color : val === 'inactive' ? 'var(--line)' : '#64748b'}">
        <div class="grow">
          <div class="title">${esc(r.sender)}</div>
          <div class="meta"><span>${r.n} ${r.n === 1 ? 'wiadomość' : 'wiadomości'} w aplikacji</span>${r.last ? `<span>ostatnia ${fmtDate(r.last)}</span>` : ''}</div>
          ${r.lastTitle ? `<div class="body muted">ostatnio: „${esc(r.lastTitle.slice(0, 70))}${r.lastTitle.length > 70 ? '…' : ''}"</div>` : ''}
        </div>
        <div class="actions sel-wrap"><span class="sel-label">wszystkie jej wiadomości dotyczą</span><select data-sender="${esc(r.sender)}">${opts}</select></div></div>`;
    };

    const scopeOf = r => { const x = ruleOf(r.sender); return x ? x.scope : null; };
    const todo = list.filter(r => !scopeOf(r));
    const ok = list.filter(r => ['child', 'all'].includes(scopeOf(r)));
    const off = list.filter(r => scopeOf(r) === 'inactive');
    const h = `<p class="hint"><b>Reguły ogólne — jedna na osobę, nie na wiadomość.</b> 4Parents nie zaznacza, którego dziecka dotyczy wpis, więc ustalasz to raz dla nadawcy: wszystkie wiadomości od tej osoby, <b>dotychczasowe i przyszłe</b>, dostaną wybrane dziecko. Gdy zmieni się opiekunka, poprawiasz jedną pozycję. Liczba wiadomości i podgląd służą tylko rozpoznaniu, kto to jest.</p>
      <div class="sum ok">✓ <b>Nic nie ginie.</b> Wiadomość bez przypisanego nadawcy jest traktowana jako „🏫 całe przedszkole" — widzisz ją przy każdym dziecku. Mapowanie nie jest obowiązkowe: służy tylko temu, żeby <b>zawęzić</b> wiadomości do jednego dziecka.</div>
      <div class="sum">Zawężone do dziecka: <b>${done} z ${list.length - offCount}</b> aktywnych nadawców · <b>${covered} z ${total}</b> wiadomości</div>`
      + (todo.length ? (() => {
          const cut = schoolYearStart();
          const stare = todo.filter(r => !r.last || new Date(r.last) < cut);
          const nowe = todo.filter(r => r.last && new Date(r.last) >= cut);
          return (nowe.length ? `<div class="section-title">Warto zawęzić — piszą w tym roku szkolnym (${nowe.length})</div>` + nowe.map(row).join('') : '')
            + (stare.length ? `<div class="section-title">Cisza od ${fmtDate(cut)} (${stare.length})</div>`
                + `<p class="hint">Nic nie napisali w tym roku szkolnym, więc to najpewniej byli pracownicy. Możesz ich odhaczyć jednym kliknięciem — pojedyncze pozycje zawsze da się potem zmienić.</p>`
                + `<button class="btn" id="bulk-off" style="margin-bottom:10px">🚫 Oznacz tych ${stare.length} jako nieaktywnych</button>`
                + stare.map(row).join('') : '');
        })() : `<div class="empty">Wszyscy nadawcy ustawieni ✓</div>`)
      + (ok.length ? `<div class="section-title">Ustawione (${ok.length})</div>` + ok.map(row).join('') : '')
      + (off.length ? `<div class="section-title">Nieaktywni pracownicy (${off.length})</div>` + off.map(row).join('') : '');
    const root = $('#senders-content');
    root.innerHTML = h;
    root.querySelectorAll('select').forEach(sel => sel.onchange = () => saveSenderRule('4parents', sel.dataset.sender, sel.value));
    const bulk = $('#bulk-off');
    if (bulk) bulk.onclick = () => { const cut = schoolYearStart(); markInactiveBulk(list.filter(r => !ruleOf(r.sender) && (!r.last || new Date(r.last) < cut)).map(r => r.sender)); };
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
          `<button class="gchip ${S.reads.has(i.id) ? '' : 'unread'} ${S.openId === i.id ? 'sel' : ''}" data-grade="${i.id}" title="${esc(i.body || '')}"><b>${esc(value)}</b><small>${d.getDate()}.${String(d.getMonth() + 1).padStart(2, '0')}</small></button>`).join('')}</div></td>`;
      }).join('') + '</tr>';
    }
    h += '</tbody></table></div><p class="muted" style="font-size:.78rem;margin-top:10px">Kliknij ocenę, aby zobaczyć kategorię i komentarz. Czerwona obwódka = jeszcze nieprzejrzana.</p>';
    $('#grades-content').innerHTML = h;
    const wrap = $('#grades-content .grades-wrap'); if (wrap) wrap.scrollLeft = wrap.scrollWidth;
    wireCards($('#grades-content'));
  }

  // ---- CZAT
  const EMOJI = ['😀','😁','😂','🤣','🙂','😉','😍','🥰','😘','😎','🤔','😴','🙃','😇','🤗','👍','👎','👏','🙏','💪','🤝','✌️','🫶','❤️','💔','🔥','✨','🎉','🎂','🍕','☕','🍺','🏃','⚽','🎸','🚗','🏠','🧸','📚','✏️','🎒','⏰','✅','❌','❗','❓','💬','😅','😭','🤯','🤪','🥳','😱','🤷','🤦'];
  const URL_RE = /(https?:\/\/[^\s<]+)/g;
  const IMG_EXT_RE = /\.(?:png|jpe?g|gif|webp|heic|bmp)$/i;
  const mediaUrls = new Map();

  function chatBodyHtml(body) {
    return esc(body).replace(URL_RE, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  }

  function mediaHtml(m) {
    if (!m.media_path) return '';
    const url = mediaUrls.get(m.media_path);
    const name = m.media_name || 'załącznik';
    if (!url) return '<div class="muted" style="font-size:.78rem">ładowanie załącznika…</div>';
    return IMG_EXT_RE.test(name) ? `<img src="${esc(url)}" alt="${esc(name)}" loading="lazy">`
      : `<a class="file" href="${esc(url)}" target="_blank" rel="noopener">📄 ${esc(name)}</a>`;
  }

  async function signMedia(paths) {
    const missing = paths.filter(p => !mediaUrls.has(p));
    if (!missing.length) return false;
    const { data } = await sb.storage.from('attachments').createSignedUrls(missing, 60 * 60 * 6);
    (data || []).forEach(r => { if (r.signedUrl) mediaUrls.set(r.path, r.signedUrl); });
    return true;
  }

  function renderChat() {
    const log = $('#chat-log');
    let h = '', lastDay = null;
    for (const m of S.messages) {
      const d = new Date(m.created_at); const k = dateKey(d);
      if (k !== lastDay) { lastDay = k; h += `<div class="muted" style="text-align:center;font-size:.75rem;margin:10px 0 4px">${isToday(d) ? 'Dziś' : fmtDate(d)}</div>`; }
      const me = m.sender === S.me.user_id;
      const media = mediaHtml(m);
      h += `<div class="msg ${me ? 'me' : ''}">${me ? `<button class="del" data-del="${m.id}" title="Usuń">✕</button>` : ''}${media}${m.body ? chatBodyHtml(m.body) : ''}<span class="t">${me ? '' : esc(member(m.sender)?.display_name || '') + ' · '}${fmtTime(d)}</span></div>`;
    }
    log.innerHTML = h || `<div class="empty">Napiszcie do siebie coś miłego 🙂</div>`;
    log.querySelectorAll('[data-del]').forEach(b => b.onclick = () => deleteMessage(b.dataset.del));
    log.scrollTop = log.scrollHeight; window.scrollTo(0, document.body.scrollHeight);
    const paths = S.messages.map(m => m.media_path).filter(p => p && !mediaUrls.has(p));
    if (paths.length) signMedia(paths).then(ok => ok && S.view === 'chat' && renderChat());
  }

  async function deleteMessage(id) {
    const m = S.messages.find(x => x.id === id);
    if (!m || m.sender !== S.me.user_id) return;
    if (!confirm('Usunąć tę wiadomość?')) return;
    S.messages = S.messages.filter(x => x.id !== id); render();
    const { error } = await sb.from('messages').delete().eq('id', id);
    if (error) fail(error);
    if (m.media_path) sb.storage.from('attachments').remove([m.media_path]).then(() => {});
  }

  async function sendChatImage(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return toast('Plik za duży (max 20 MB)');
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `chat/${crypto.randomUUID()}.${ext}`;
    toast('Wysyłam załącznik…');
    const { error: upErr } = await sb.storage.from('attachments').upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) return fail(upErr);
    const body = $('#chat-input').value.trim(); $('#chat-input').value = '';
    const { data, error } = await sb.from('messages').insert({ sender: S.me.user_id, body, media_path: path, media_name: file.name.slice(0, 200) }).select().single();
    if (error) return fail(error);
    S.messages.push(data); render();
  }

  // -------------------------------------------------------------- cards
  function taskCard(t, board = false) {
    const c = child(t.child_id); const col = c ? c.color : 'var(--line)';
    const due = t.due_at ? new Date(t.due_at) : null;
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const st = effStatus(t);
    const rep = isRepeating(t);
    const over = !rep && st !== 'done' && due && due < todayStart;
    const doing = st === 'doing';
    const nx = rep && !activeOn(t, new Date()) ? nextOccurrence(t) : null;
    const when = rep
      ? `<span class="chip rep">🔁 ${REPEAT_LABEL[t.repeat] || 'stałe'}${due ? ` do ${fmtDate(due)}` : ''}</span>${nx ? `<span class="chip">nie dziś · najbliżej ${fmtDate(nx)}</span>` : ''}${rep && !nx && !doneToday(t) ? '<span class="chip today">na dziś</span>' : ''}`
      : (due ? `<span class="${over ? 'overdue' : ''}">⏰ ${fmtDate(due)}${t.starts_at && dateKey(t.starts_at) !== dateKey(due) ? ` (od ${fmtDate(t.starts_at)})` : ''}</span>` : '');
    const moves = board === 'backlog' ? `<div class="actions"><button class="btn sm" data-act="claim" data-who="${S.me.user_id}">👤 biorę</button>${partner() ? `<button class="btn sm" data-act="claim" data-who="${partner().user_id}">→ ${esc(partner().display_name)}</button>` : ''}<button class="btn sm" data-act="claim" data-who="child">→ Dziecko</button></div>` : board ? `<div class="actions">${st !== 'todo' ? `<button class="btn sm" data-act="move" data-to="todo">← do zrobienia</button>` : ''}${st !== 'doing' ? `<button class="btn sm" data-act="move" data-to="doing">${st === 'done' ? '← ' : ''}w toku${st === 'todo' ? ' →' : ''}</button>` : ''}${st !== 'done' ? `<button class="btn sm" data-act="move" data-to="done">zrobione →</button>` : ''}</div>` : '';
    const nC = S.comments.filter(c => c.task_id === t.id).length; const nM = taskUnreadMentions(t.id);
    return `<div class="card ${st === 'done' && board ? 'done' : ''} ${S.openId === t.id ? 'sel' : ''}" style="border-left-color:${col}" data-task="${t.id}" ${board ? 'draggable="true"' : ''}>
      <button class="check ${st === 'done' ? 'on' : ''} ${doing ? 'doing' : ''}" data-act="toggle" title="${rep ? 'Odhacz na dziś' : 'Oznacz jako zrobione'}">${st === 'done' ? '✓' : ''}</button>
      <div class="grow clickable" data-act="edit-task">
        <div class="title">${esc(t.title)}</div>
        <div class="meta">${childChip(t.child_id)}${memberChip(t.assignee, t.child_assignee)}${when}${t.item_id ? '<span>↗ z wiadomości</span>' : ''}${nM ? '<span class="chip mention">@ dla Ciebie</span>' : (nC ? `<span>💬 ${nC}</span>` : '')}</div>
        ${t.notes ? `<div class="body">${esc(t.notes)}</div>` : ''}
      </div>
      ${board ? moves : `<div class="actions"><span class="status st-${st}">${st === 'done' ? (rep ? '✓ Dziś zrobione' : '✓ Zrobione') : nx ? '○ Nie dziś' : doing ? '◐ W toku' : '○ Do zrobienia'}</span></div>`}</div>`;
  }

  function eventCard(e) {
    const c = child(e.child_id); const col = c ? c.color : 'var(--line)';
    const time = e.all_day ? 'cały dzień' : fmtTime(e.starts_at) + (e.ends_at ? '–' + fmtTime(e.ends_at) : '');
    return `<div class="card ${S.openId === e.id ? 'sel' : ''}" style="border-left-color:${col}" data-event="${e.id}">
      <div class="grow clickable" data-act="edit-event">
        <div class="title">${esc(e.title)}</div>
        <div class="meta">${childChip(e.child_id)}<span>📅 ${fmtDate(e.starts_at)} · ${time}</span>${e.source !== 'manual' ? `<span>${SOURCE_LABEL[e.source] || e.source}</span>` : ''}</div>
        ${e.notes ? `<div class="body">${esc(e.notes)}</div>` : ''}
      </div>
      <div class="actions">${taskForEvent(e) ? `<button class="btn sm" data-act="goto-task" data-task-id="${taskForEvent(e).id}">↗ zadanie</button>` : `<button class="btn sm" data-act="event-to-task">→ zadanie</button>`}</div></div>`;
  }

  function itemCard(i) {
    const ec = effChild(i); const c = child(ec); const col = c ? c.color : 'var(--line)';
    const unread = !S.reads.has(i.id);
    return `<div class="card ${unread ? 'unread' : ''} ${S.openId === i.id ? 'sel' : ''}" style="border-left-color:${col}" data-item="${i.id}">
      <div class="grow clickable" data-act="open-item">
        <div class="title">${unread ? '● ' : ''}${esc(i.title)}</div>
        <div class="meta">${childChip(ec)}${wholeSchool(i) ? '<span class="chip school">🏫 całe przedszkole</span>' : ''}<span>${KIND_LABEL[i.kind] || i.kind} · ${SOURCE_LABEL[i.source] || i.source}</span>${i.sender ? `<span>od: ${esc(i.sender)}</span>` : ''}<span>${fmtDateTime(i.published_at)}</span>${i.occurred_at ? `<span>⏰ ${fmtDate(i.occurred_at)}</span>` : ''}</div>
      </div>
      <div class="actions">${(() => { const tm = twinMessage(i); return tm ? `<button class="btn sm" data-act="open-twin" data-item-id="${tm.id}" title="${esc(tm.sender || '')}">💬 wiadomość${S.reads.has(tm.id) ? '' : ' ●'}</button>` : ''; })()}${S.tasks.some(t => t.item_id === i.id) ? `<button class="btn sm" data-act="goto-task" data-task-id="${S.tasks.find(t => t.item_id === i.id).id}">↗ zadanie</button>` : `<button class="btn sm" data-act="item-to-task">→ zadanie</button>`}</div></div>`;
  }

  function wireCards(root) {
    root.onclick = async e => {
      const g = e.target.closest('[data-grade]');
      if (g) return openItem(S.items.find(x => x.id === g.dataset.grade));
      const btn = e.target.closest('[data-act]'); if (!btn) return;
      const act = btn.dataset.act;
      const card = btn.closest('.card');
      if (act === 'settings') return openSettings();
      if (act === 'goto-task') return goToTask(btn.dataset.taskId);
      if (act === 'open-twin') return openItem(S.items.find(x => x.id === btn.dataset.itemId));
      if (act === 'add-event') return openEventForm({ starts_at: new Date(btn.dataset.day + 'T12:00:00').toISOString() });
      if (act === 'add-task') return openTaskForm({ status: btn.dataset.status, assignee: btn.dataset.backlog ? null : undefined });
      if (act === 'toggle') return toggleTask(card.dataset.task);
      if (act === 'move') return setTaskStatus(card.dataset.task, btn.dataset.to);
      if (act === 'claim') return assignTask(card.dataset.task, btn.dataset.who);
      if (act === 'add-task') return openTaskForm({ status: btn.dataset.status, assignee: btn.dataset.backlog ? null : undefined });
      if (act === 'cycle') return setTaskStatus(card.dataset.task, S.tasks.find(t => t.id === card.dataset.task).status === 'doing' ? 'todo' : 'doing');
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

  async function assignTask(id, who) {
    const t = S.tasks.find(x => x.id === id);
    const patch = who === 'child' ? { assignee: null, child_assignee: true } : { assignee: who, child_assignee: false };
    Object.assign(t, patch); render();
    const { error } = await sb.from('tasks').update(patch).eq('id', id);
    if (error) fail(error);
  }

  async function setTaskStatus(id, status) {
    const t = S.tasks.find(x => x.id === id);
    if (isRepeating(t)) {
      // zadanie stałe: "zrobione" dotyczy tylko dzisiejszego dnia — jutro wraca na listę
      const day = dateKey(new Date()); const key = `${id}|${day}`;
      const wasDone = S.completions.has(key);
      if (status === 'done') S.completions.add(key); else S.completions.delete(key);
      if (status !== 'done' && t.status !== status) t.status = status === 'doing' ? 'doing' : 'todo';
      render();
      if (status === 'done' && !wasDone) {
        const { error } = await sb.from('task_completions').upsert({ task_id: id, day, user_id: S.me.user_id }, { onConflict: 'task_id,day' });
        if (error) fail(error);
      } else if (status !== 'done' && wasDone) {
        const { error } = await sb.from('task_completions').delete().eq('task_id', id).eq('day', day);
        if (error) fail(error);
      }
      if (status !== 'done') await sb.from('tasks').update({ status: t.status, done_at: null }).eq('id', id);
      return;
    }
    t.status = status; t.done_at = status === 'done' ? new Date().toISOString() : null; render();
    const { error } = await sb.from('tasks').update({ status: t.status, done_at: t.done_at }).eq('id', id);
    if (error) fail(error);
  }

  async function openItem(i) {
    S.openId = i.id;
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
  function memberOptions(sel) { return `<option value="">— nieprzypisane —</option>` + S.members.map(m => `<option value="${m.user_id}" ${m.user_id === sel ? 'selected' : ''}>${esc(m.display_name)}</option>`).join('') + `<option value="child" ${sel === 'child' ? 'selected' : ''}>Dziecko</option>`; }

  function openAddMenu() {
    openModal('Dodaj', `
      <ul class="list-plain">
        <li><button class="btn" style="width:100%;text-align:left" id="a-task">☑ Zadanie</button></li>
        <li><button class="btn" style="width:100%;text-align:left" id="a-event">📅 Wydarzenie w kalendarzu</button></li>
        <li><button class="btn" style="width:100%;text-align:left" id="a-item">✉ Wiadomość / notatka (np. kartka z plecaka)</button></li>
      </ul>`);
    $('#a-task').onclick = () => openTaskForm({});
    $('#a-event').onclick = () => openEventForm({});
    $('#a-item').onclick = () => openItemForm();
  }

  function openTaskForm(t) {
    const isNew = !t.id;
    if (!isNew) { S.openId = t.id; render(); }
    openModal(isNew ? 'Nowe zadanie' : 'Zadanie', `
      <form id="f">
        <label>Tytuł<input name="title" required value="${esc(t.title || '')}"></label>
        <div class="row">
          <label>Dziecko<select name="child_id">${childOptions(t.child_id)}</select></label>
          <label>Kto robi<select name="assignee">${memberOptions(t.child_assignee ? 'child' : ('assignee' in t && t.assignee !== undefined ? t.assignee : (isNew ? S.me.user_id : null)))}</select></label>
        </div>
        <div class="row">
          <label>Od<input type="date" name="start" value="${t.starts_at ? dateKey(t.starts_at) : ''}"></label>
          <label>Termin / do<input type="date" name="due" value="${t.due_at ? dateKey(t.due_at) : ''}"></label>
        </div>
        <div class="row">
          <label>Powtarzanie<select name="repeat">${REPEATS.map(([v, l]) => `<option value="${v}" ${(t.repeat || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label>Status<select name="status">${[['todo', 'Do zrobienia'], ['doing', 'W toku'], ['done', 'Zrobione']].map(([v, l]) => `<option value="${v}" ${(t.status || 'todo') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        <p class="hint">Zadanie stałe (np. 10 min logopedii dziennie): wybierz powtarzanie i zostaw <b>Termin / do</b> puste, żeby trwało bez końca. Odhaczasz je osobno każdego dnia.</p>
        <label>Notatki<textarea name="notes">${esc(t.notes || '')}</textarea></label>
        <button class="btn primary" type="submit">${isNew ? 'Dodaj' : 'Zapisz'}</button>
        ${isNew ? '' : '<button class="btn danger" type="button" id="f-del" style="width:100%;margin-top:8px">Usuń zadanie</button>'}
      </form>
      ${isNew ? '' : `<div class="comments"><div class="section-title" style="margin-top:0">Komentarze</div><div id="comments-list"></div>
        <form class="comment-form" id="comment-form"><textarea id="comment-input" placeholder="Napisz komentarz… użyj @imię, żeby zapytać drugą osobę"></textarea><button class="btn sm" type="submit">Wyślij</button></form>
        <div class="mention-btns">${S.members.filter(m => m.user_id !== S.me.user_id).map(m => `<button type="button" class="btn sm" data-mention="${esc(m.display_name)}">@${esc(m.display_name)}</button>`).join('')}</div></div>`}`);
    if (!isNew) {
      refreshComments(t.id); markCommentsRead(t.id);
      $$('#modal-body [data-mention]').forEach(b => b.onclick = () => { const ta = $('#comment-input'); ta.value = (ta.value ? ta.value.replace(/\s*$/, ' ') : '') + '@' + b.dataset.mention + ' '; ta.focus(); });
      $('#comment-form').onsubmit = async e => {
        e.preventDefault(); const body = $('#comment-input').value.trim(); if (!body) return;
        $('#comment-input').value = '';
        const { data, error } = await sb.from('task_comments').insert({ task_id: t.id, author: S.me.user_id, body }).select().single();
        if (error) return fail(error);
        S.comments.push(data); refreshComments(t.id); render();
      };
    }
    $('#f').onsubmit = async e => {
      e.preventDefault(); const f = new FormData(e.target);
      const status = f.get('status') || 'todo';
      const who = f.get('assignee');
      const repeat = f.get('repeat') || null;
      const st = repeat && status === 'done' ? 'todo' : status;   // stałe odhacza się per dzień
      const rec = { title: f.get('title').trim(), child_id: f.get('child_id') || null, assignee: who && who !== 'child' ? who : null, child_assignee: who === 'child', starts_at: f.get('start') ? new Date(f.get('start') + 'T12:00:00').toISOString() : null, due_at: f.get('due') ? new Date(f.get('due') + 'T12:00:00').toISOString() : null, repeat, notes: f.get('notes').trim() || null, status: st, done_at: st === 'done' ? (t.done_at || new Date().toISOString()) : null };
      let q;
      if (isNew) q = sb.from('tasks').insert({ ...rec, item_id: t.item_id || null, created_by: S.me.user_id }).select().single();
      else q = sb.from('tasks').update(rec).eq('id', t.id).select().single();
      const { data, error } = await q; if (error) return fail(error);
      if (isNew) S.tasks.push(data); else Object.assign(S.tasks.find(x => x.id === t.id), data);
      closeModal(); render(); toast(isNew ? 'Zadanie dodane' : 'Zapisano');
    };
    const del = $('#f-del'); if (del) del.onclick = async () => { if (!confirm('Usunąć zadanie?')) return; const { error } = await sb.from('tasks').delete().eq('id', t.id); if (error) return fail(error); S.tasks = S.tasks.filter(x => x.id !== t.id); closeModal(); render(); };
  }

  function refreshComments(taskId) {
    const el = $('#comments-list'); if (!el) return;
    const list = S.comments.filter(c => c.task_id === taskId);
    el.innerHTML = list.length ? list.map(c => `<div class="comment ${c.author === S.me.user_id ? 'me' : ''}"><div class="who">${esc(member(c.author)?.display_name || '?')} · ${fmtDateTime(c.created_at)}</div>${fmtComment(c.body)}</div>`).join('') : '<div class="muted" style="font-size:.85rem">Brak komentarzy.</div>';
    el.scrollTop = el.scrollHeight;
  }
  async function markCommentsRead(taskId) {
    const unread = S.comments.filter(c => c.task_id === taskId && c.author !== S.me.user_id && !S.commentReads.has(c.id));
    if (!unread.length) return;
    unread.forEach(c => S.commentReads.add(c.id)); render();
    await sb.from('comment_reads').upsert(unread.map(c => ({ comment_id: c.id, user_id: S.me.user_id })), { onConflict: 'comment_id,user_id' });
  }

  function openEventForm(e0) {
    const isNew = !e0.id;
    if (!isNew) { S.openId = e0.id; render(); }
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
    openModal('Nowa wiadomość', `
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
      closeModal(); render(); toast('Wiadomość dodana');
    };
  }

  // -------------------------------------------------------------- settings
  function openSettings() {
    openModal('Ustawienia', `
      <h3 style="margin:8px 0">Dzieci</h3>
      <ul class="list-plain" id="kids">${S.children.map(c => `<li><span class="dot" style="background:${c.color};width:14px;height:14px"></span><span style="flex:1">${esc(c.name)} <span class="muted">${esc(c.institution || '')}</span></span><button class="btn sm" data-edit="${c.id}">Edytuj</button></li>`).join('') || '<li class="muted">Brak dzieci — dodaj pierwsze.</li>'}</ul>
      <button class="btn" id="add-kid" style="margin-top:10px">+ Dodaj dziecko</button>
      <h3 style="margin:22px 0 8px">Kto pisze o kim</h3>
      <p class="hint">Przypisanie nadawców z 4Parents do dzieci ma własną stronę.</p>
      <button class="btn" id="open-senders">👥 Otwórz mapowanie nadawców</button>
      <h3 style="margin:22px 0 8px">Rodzina</h3>
      <ul class="list-plain">${S.members.map(m => `<li><span class="dot" style="background:${m.color};width:14px;height:14px"></span><span style="flex:1">${esc(m.display_name)}${m.user_id === S.me.user_id ? ' (ja)' : ''}</span></li>`).join('')}</ul>
      <p class="muted" style="font-size:.85rem">Zalogowano jako ${esc(S.user.email)}.</p>
      <button class="btn" id="logout">Wyloguj</button>
      <p class="muted" style="font-size:.75rem;margin-top:18px">Agent Dużej Rodziny · ${S.items.length} wiadomości, ${S.tasks.length} zadań, ${S.events.length} wydarzeń</p>`);
    $('#open-senders').onclick = () => { closeModal(); setView('senders'); };
    $('#add-kid').onclick = () => openChildForm({});
    $$('#kids [data-edit]').forEach(b => b.onclick = () => openChildForm(child(b.dataset.edit)));
    $('#logout').onclick = () => sb.auth.signOut();
  }

  async function saveSenderRule(source, sender, val) {
    const key = `${source}|${sender}`;
    if (!val) {
      S.senderRules.delete(key); render();
      const { error } = await sb.from('sender_rules').delete().eq('source', source).eq('sender', sender);
      return error && fail(error);
    }
    const scope = val === 'all' || val === 'inactive' ? val : 'child';
    const row = { source, sender, scope, child_id: scope === 'child' ? val : null, updated_by: S.me.user_id, updated_at: new Date().toISOString() };
    S.senderRules.set(key, row); render();
    const { error } = await sb.from('sender_rules').upsert(row, { onConflict: 'source,sender' });
    if (error) return fail(error);
    toast(scope === 'inactive' ? 'Oznaczono jako nieaktywnego' : 'Zapisano regułę');
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
    const del = $('#f-del'); if (del) del.onclick = async () => { if (!confirm('Usunąć dziecko? Zadania i wiadomości zostaną, ale bez przypisania.')) return; const { error } = await sb.from('children').delete().eq('id', c.id); if (error) return fail(error); S.children = S.children.filter(x => x.id !== c.id); openSettings(); render(); };
  }

  // -------------------------------------------------------------- modal
  function openModal(title, html) { $('#modal-title').innerHTML = title; $('#modal-body').innerHTML = html; $('#modal').classList.remove('hidden'); const first = $('#modal-body input,#modal-body textarea'); if (first && window.innerWidth > 640) first.focus(); }
  function closeModal() { $('#modal').classList.add('hidden'); if (S.openId) { S.openId = null; render(); } }

  boot().catch(fail);
})();
