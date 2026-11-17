/* DIGIMON — Menu Management (User & Traffic) + telemetri traffic GAS.
   Dimuat SETELAH script utama index.html (memakai SESSION_TOKEN, AUTH_URL, refreshAccess_, jwtExpMs_,
   clearAuth_, showAppNotif). Semua izin tetap ditegakkan di server (Edge Function "admin"). */
(function () {
  'use strict';
  // Sesuaikan slug di akhir URL dengan Endpoint URL fungsi "admin" di dashboard Supabase.
  var ADMIN_URL = 'https://lhnwbupbqnewhlzdobcr.supabase.co/functions/v1/admin';
  var STATUSES = ['Active', 'Inactive', 'Pending', 'Locked', 'Rejected'];
  var ROLES = ['MITRA', 'TSEL', 'TELKOM GROUP', 'TIF', 'SDI', 'CONSTRUCTION', 'OPERATION'];

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function notify(type, msg, title) { if (typeof showAppNotif === 'function') showAppNotif(type, msg, title); else alert(msg); }
  function claims() {
    try { return JSON.parse(atob(String(SESSION_TOKEN).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return {}; }
  }
  function fmtDT(iso) {
    if (!iso) return '-'; var d = new Date(iso); if (isNaN(d)) return '-';
    return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtN(n) { return Number(n || 0).toLocaleString('id-ID'); }
  function badge(s) { return '<span class="mg-badge ' + esc(s) + '">' + esc(s) + '</span>'; }
  function opts(list, sel, blank) {
    return (blank ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (x) {
      return '<option value="' + esc(x) + '"' + (x === sel ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
  }

  // ---------- pemanggilan API admin (token diperbarui otomatis) ----------
  async function call(action, body) {
    async function post() {
      var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, 20000);
      try {
        var r = await fetch(ADMIN_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ action: action, accessToken: SESSION_TOKEN }, body || {})), signal: ctrl.signal });
        return (await r.json().catch(function () { return null; })) || { success: false, message: 'Respons server tidak valid.' };
      } catch (e) { return { success: false, network: true, message: 'Tidak bisa terhubung ke server.' }; }
      finally { clearTimeout(t); }
    }
    if (jwtExpMs_(SESSION_TOKEN) - Date.now() < 60000) await refreshAccess_();
    var r = await post();
    if (r && r.code === 'UNAUTHORIZED') {
      var ok = await refreshAccess_();
      if (ok) r = await post(); else if (ok === false) { clearAuth_(); location.replace('login.html'); }
    }
    return r;
  }

  function pager(el, page, size, total, onGo) {
    var pages = Math.max(1, Math.ceil(total / size));
    el.innerHTML = '<span>' + fmtN(total) + ' data · halaman ' + page + ' / ' + pages + '</span><span>' +
      '<button class="mg-btn sm" data-g="-1"' + (page <= 1 ? ' disabled' : '') + '>‹ Sebelumnya</button> ' +
      '<button class="mg-btn sm" data-g="1"' + (page >= pages ? ' disabled' : '') + '>Berikutnya ›</button></span>';
    el.onclick = function (e) { var b = e.target.closest('button[data-g]'); if (b && !b.disabled) onGo(page + Number(b.dataset.g)); };
  }
  function tabs(root, onChange) {
    root.querySelector('.mg-tabs').onclick = function (e) {
      var b = e.target.closest('button[data-t]'); if (!b) return;
      root.querySelectorAll('.mg-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); });
      onChange(b.dataset.t);
    };
  }

  // ---------- menu hanya untuk admin (tampilan saja; server tetap memeriksa) ----------
  function syncMenu() {
    var g = $('nav-mg-group'); if (g) g.style.display = claims().adm === true ? '' : 'none';
  }

  /* =====================================================================
     USER
     ===================================================================== */
  var U = { built: false, search: '', status: '', role: '', page: 1, size: 20, rows: {}, timer: null, apage: 1 };

  function buildUser() {
    if (U.built) return; U.built = true;
    $('page-mg-user').innerHTML =
      '<div class="mg-root">' +
        '<div class="mg-tabs"><button data-t="users" class="on">Pengguna</button><button data-t="audit">Riwayat Admin</button></div>' +
        '<section id="mgUsers">' +
          '<div class="mg-chips" id="mgChips"></div>' +
          '<div class="mg-toolbar"><input class="mg-input" id="mgSearch" placeholder="Cari nama, email, NIK, company, Telegram…" autocomplete="off">' +
          '<select class="mg-select" id="mgRole"></select><button class="mg-btn" id="mgReload">Muat ulang</button></div>' +
          '<div class="mg-wrap"><table class="mg-table"><thead><tr><th>Pengguna</th><th>NIK</th><th>Company</th><th>Role</th><th>Status</th><th>Telegram</th><th>Login Terakhir</th><th></th></tr></thead><tbody id="mgUBody"></tbody></table></div>' +
          '<div class="mg-pager" id="mgUPager"></div>' +
        '</section>' +
        '<section id="mgAudit" hidden><div class="mg-wrap"><table class="mg-table"><thead><tr><th>Waktu</th><th>Admin</th><th>Aksi</th><th>Target</th><th>Detail</th></tr></thead><tbody id="mgABody"></tbody></table></div><div class="mg-pager" id="mgAPager"></div></section>' +
      '</div>' +
      '<div class="mg-modal" id="mgModal" hidden><div class="mg-dialog mg-root" id="mgDialog"></div></div>';
    var root = $('page-mg-user');
    $('mgRole').innerHTML = opts(ROLES, '', 'Semua role');
    $('mgRole').onchange = function () { U.role = this.value; U.page = 1; loadUsers(); };
    $('mgReload').onclick = function () { loadUsers(); };
    $('mgSearch').oninput = function () { var v = this.value; clearTimeout(U.timer); U.timer = setTimeout(function () { U.search = v.trim(); U.page = 1; loadUsers(); }, 350); };
    $('mgChips').onclick = function (e) { var c = e.target.closest('.mg-chip'); if (!c) return; U.status = c.dataset.s; U.page = 1; loadUsers(); };
    $('mgUBody').onclick = function (e) { var b = e.target.closest('button[data-id]'); if (b) openUser(b.dataset.id); };
    $('mgModal').onclick = function (e) { if (e.target === this) closeModal(); };
    tabs(root, function (t) { $('mgUsers').hidden = t !== 'users'; $('mgAudit').hidden = t !== 'audit'; if (t === 'audit') loadAudit(); });
  }

  async function loadUsers() {
    var body = $('mgUBody'); body.innerHTML = '<tr><td colspan="8" class="mg-empty">Memuat…</td></tr>';
    var r = await call('users_list', { search: U.search, status: U.status, role: U.role, page: U.page, pageSize: U.size });
    if (!r.success) { body.innerHTML = '<tr><td colspan="8" class="mg-empty">' + esc(r.message || 'Gagal memuat.') + '</td></tr>'; return; }
    U.rows = {}; r.rows.forEach(function (u) { U.rows[u.id] = u; });
    var total = Object.keys(r.counts || {}).reduce(function (a, k) { return a + r.counts[k]; }, 0);
    $('mgChips').innerHTML = '<button class="mg-chip' + (U.status === '' ? ' on' : '') + '" data-s="">Semua (' + fmtN(total) + ')</button>' +
      STATUSES.map(function (s) { return '<button class="mg-chip' + (U.status === s ? ' on' : '') + '" data-s="' + s + '">' + s + ' (' + fmtN((r.counts || {})[s] || 0) + ')</button>'; }).join('');
    body.innerHTML = r.rows.length ? r.rows.map(function (u) {
      return '<tr><td><b>' + esc(u.full_name) + '</b>' + (u.is_admin ? ' <span class="mg-badge adm">Admin</span>' : '') + '<span class="sub">' + esc(u.email) + '</span></td>' +
        '<td>' + esc(u.nik) + '</td><td>' + esc(u.company) + (u.company_is_custom ? '<span class="sub">diinput manual</span>' : '') + '</td>' +
        '<td>' + esc(u.role) + '</td><td>' + badge(u.status) + '</td><td>' + (u.telegram ? '@' + esc(u.telegram) : '-') + '</td>' +
        '<td>' + fmtDT(u.last_login_at) + '</td><td><button class="mg-btn sm" data-id="' + esc(u.id) + '">Kelola</button></td></tr>';
    }).join('') : '<tr><td colspan="8" class="mg-empty">Tidak ada pengguna yang cocok.</td></tr>';
    pager($('mgUPager'), r.page, r.pageSize, r.total, function (p) { U.page = p; loadUsers(); });
  }

  function closeModal() { $('mgModal').hidden = true; }
  function openUser(id) {
    var u = U.rows[id]; if (!u) return;
    var me = claims().sub === u.id, locked = u.locked_until && new Date(u.locked_until) > new Date();
    $('mgDialog').innerHTML =
      '<div class="head"><div><h2>' + esc(u.full_name) + '</h2><span class="sub" style="color:var(--mg-mut);font-size:13px">' + esc(u.email) + '</span></div>' +
      '<button class="mg-btn sm" id="mgClose">Tutup</button></div>' +
      '<div class="mg-info"><div><span>NIK Employee</span>' + esc(u.nik) + '</div><div><span>Telegram</span>' + (u.telegram ? '@' + esc(u.telegram) : '-') + '</div>' +
      '<div><span>Company</span>' + esc(u.company) + '</div><div><span>Status saat ini</span>' + badge(u.status) + (u.is_admin ? ' <span class="mg-badge adm">Admin</span>' : '') + '</div>' +
      '<div><span>Terdaftar</span>' + fmtDT(u.created_at) + '</div><div><span>Login terakhir</span>' + fmtDT(u.last_login_at) + '</div>' +
      '<div><span>Password salah berturut</span>' + fmtN(u.failed_logins) + '</div><div><span>Dikunci sampai</span>' + (locked ? fmtDT(u.locked_until) : '-') + '</div></div>' +
      '<div class="mg-sect"><h4>Status &amp; Role Access</h4><div class="mg-form">' +
      '<select class="mg-select" id="mgSt">' + opts(STATUSES, u.status) + '</select><select class="mg-select" id="mgRl">' + opts(ROLES, u.role) + '</select>' +
      '<button class="mg-btn pri" id="mgSave">Simpan</button></div>' +
      '<p class="mg-note">Status selain Active mengeluarkan user dari semua sesi. Role baru berlaku saat token user diperbarui (maks. 1 jam).</p></div>' +
      '<div class="mg-sect"><h4>Tindakan</h4><div class="mg-actions">' +
      '<button class="mg-btn" id="mgUnlock">Buka kunci login</button>' +
      '<button class="mg-btn" id="mgReset">Reset password (kirim ke Telegram)</button>' +
      '<button class="mg-btn" id="mgRevoke">Paksa keluar (cabut sesi)</button>' +
      '<button class="mg-btn ' + (u.is_admin ? 'danger' : '') + '" id="mgAdm"' + (me && u.is_admin ? ' disabled title="Tidak bisa mencabut hak admin sendiri"' : '') + '>' + (u.is_admin ? 'Cabut hak admin' : 'Jadikan admin') + '</button>' +
      '</div></div>';
    $('mgModal').hidden = false;
    $('mgClose').onclick = closeModal;

    async function act(btn, action, body, confirmMsg, after) {
      if (confirmMsg && !window.confirm(confirmMsg)) return;
      btn.disabled = true; var r = await call(action, Object.assign({ userId: u.id }, body || {})); btn.disabled = false;
      if (r.success) { notify('success', r.message || 'Berhasil.', 'Management User'); if (after !== false) { closeModal(); loadUsers(); } }
      else notify('error', r.message || 'Gagal.', 'Management User');
    }
    $('mgSave').onclick = function () {
      var st = $('mgSt').value, rl = $('mgRl').value, body = {};
      if (st !== u.status) body.status = st; if (rl !== u.role) body.role = rl;
      if (!Object.keys(body).length) return notify('info', 'Tidak ada perubahan.', 'Management User');
      act(this, 'user_update', body, st !== u.status && st !== 'Active' && u.status === 'Active' ? 'Ubah status menjadi ' + st + '? User akan dikeluarkan dari semua sesi.' : '');
    };
    $('mgUnlock').onclick = function () { act(this, 'user_unlock'); };
    $('mgReset').onclick = function () { act(this, 'user_reset_password', null, 'Kirim password sementara ke Telegram ' + u.full_name + '? Password lama tidak berlaku lagi.'); };
    $('mgRevoke').onclick = function () { act(this, 'user_revoke', null, 'Keluarkan ' + u.full_name + ' dari semua perangkat?'); };
    $('mgAdm').onclick = function () { act(this, 'user_admin', { flag: !u.is_admin }, (u.is_admin ? 'Cabut hak admin ' : 'Jadikan admin: ') + u.full_name + '?'); };
  }

  async function loadAudit() {
    var body = $('mgABody'); body.innerHTML = '<tr><td colspan="5" class="mg-empty">Memuat…</td></tr>';
    var r = await call('audit_list', { page: U.apage, pageSize: 20 });
    if (!r.success) { body.innerHTML = '<tr><td colspan="5" class="mg-empty">' + esc(r.message || 'Gagal memuat.') + '</td></tr>'; return; }
    body.innerHTML = r.rows.length ? r.rows.map(function (a) {
      return '<tr><td>' + fmtDT(a.ts) + '</td><td>' + esc(a.actor || '-') + '</td><td><span class="mg-badge">' + esc(a.action) + '</span></td><td>' + esc(a.target || '-') +
        '</td><td class="mono">' + esc(a.detail ? JSON.stringify(a.detail) : '') + '</td></tr>'; }).join('') : '<tr><td colspan="5" class="mg-empty">Belum ada riwayat.</td></tr>';
    pager($('mgAPager'), r.page, r.pageSize, r.total, function (p) { U.apage = p; loadAudit(); });
  }

  /* =====================================================================
     TRAFFIC
     ===================================================================== */
  var T = { built: false, hours: 24, lpage: 1, auto: null, tab: 'sum' };

  function buildTraffic() {
    if (T.built) return; T.built = true;
    $('page-mg-traffic').innerHTML =
      '<div class="mg-root">' +
        '<div class="mg-tabs"><button data-t="sum" class="on">Ringkasan</button><button data-t="log">Log Request</button><button data-t="ctl">Kontrol</button></div>' +
        '<section id="mgTSum"><div class="mg-toolbar"><select class="mg-select" id="mgRange">' +
          '<option value="1">1 jam terakhir</option><option value="6">6 jam terakhir</option><option value="24" selected>24 jam terakhir</option><option value="168">7 hari terakhir</option><option value="720">30 hari terakhir</option></select>' +
          '<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="mgAuto" checked> Auto-refresh 30 dtk</label><button class="mg-btn" id="mgTReload">Muat ulang</button></div>' +
          '<div id="mgSumBody"><div class="mg-empty">Memuat…</div></div></section>' +
        '<section id="mgTLog" hidden><div class="mg-toolbar"><select class="mg-select" id="mgLSrc"><option value="">Semua sumber</option><option value="auth">auth</option><option value="register">register</option><option value="gas">gas (data dashboard)</option></select>' +
          '<select class="mg-select" id="mgLRes"><option value="all">Semua hasil</option><option value="ok">Sukses</option><option value="error">Error / ditolak</option></select>' +
          '<input class="mg-input" id="mgLIp" placeholder="Filter IP (persis)"><button class="mg-btn pri" id="mgLGo">Terapkan</button></div>' +
          '<div class="mg-wrap"><table class="mg-table"><thead><tr><th>Waktu</th><th>Sumber</th><th>Aksi</th><th>Status</th><th class="num">ms</th><th>IP</th><th>User</th></tr></thead><tbody id="mgLBody"></tbody></table></div><div class="mg-pager" id="mgLPager"></div></section>' +
        '<section id="mgTCtl" hidden><div id="mgCtlBody"><div class="mg-empty">Memuat…</div></div></section>' +
      '</div>';
    var root = $('page-mg-traffic');
    $('mgRange').onchange = function () { T.hours = Number(this.value); loadSummary(); };
    $('mgTReload').onclick = function () { loadSummary(); };
    $('mgLGo').onclick = function () { T.lpage = 1; loadLogs(); };
    $('mgSumBody').onclick = function (e) {
      var b = e.target.closest('button[data-block]'); if (!b) return;
      blockIp(b.dataset.block, '', 60);
    };
    tabs(root, function (t) {
      T.tab = t; $('mgTSum').hidden = t !== 'sum'; $('mgTLog').hidden = t !== 'log'; $('mgTCtl').hidden = t !== 'ctl';
      if (t === 'sum') loadSummary(); if (t === 'log') loadLogs(); if (t === 'ctl') loadControl();
    });
    if (T.auto) clearInterval(T.auto);
    T.auto = setInterval(function () {
      var pg = $('page-mg-traffic');
      if (document.hidden || !pg || !pg.classList.contains('active-page') || T.tab !== 'sum' || !$('mgAuto').checked) return;
      loadSummary(true);
    }, 30000);
  }

  function chartSvg(series, bucket) {
    if (!series.length) return '<div class="mg-empty">Belum ada data pada rentang ini.</div>';
    var W = 720, H = 170, L = 38, R = 6, Tp = 8, B = 22, n = series.length, bw = (W - L - R) / n;
    var max = Math.max.apply(null, series.map(function (s) { return s.requests; })) || 1;
    function lab(iso) { var d = new Date(iso); return bucket === 'day' ? d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }); }
    var g = '', i;
    for (i = 0; i <= 4; i++) { var y = Tp + (H - Tp - B) * i / 4; g += '<line class="mg-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text class="mg-axis" x="' + (L - 4) + '" y="' + (y + 4) + '" text-anchor="end">' + Math.round(max * (1 - i / 4)) + '</text>'; }
    var bars = series.map(function (s, k) {
      var h1 = (H - Tp - B) * s.requests / max, h2 = (H - Tp - B) * s.errors / max, x = L + k * bw + 1;
      return '<rect class="mg-bar" x="' + x + '" y="' + (H - B - h1) + '" width="' + Math.max(1, bw - 2) + '" height="' + h1 + '"><title>' + esc(lab(s.t)) + ': ' + s.requests + ' request, ' + s.errors + ' error</title></rect>' +
        (s.errors ? '<rect class="mg-bar-err" x="' + x + '" y="' + (H - B - h2) + '" width="' + Math.max(1, bw - 2) + '" height="' + h2 + '"/>' : ''); }).join('');
    var ticks = [0, Math.floor((n - 1) / 2), n - 1].filter(function (v, k, a) { return a.indexOf(v) === k; }).map(function (k) {
      return '<text class="mg-axis" x="' + (L + k * bw + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(lab(series[k].t)) + '</text>'; }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafik jumlah request">' + g + bars + ticks + '</svg>';
  }

  async function loadSummary(silent) {
    var box = $('mgSumBody'); if (!silent) box.innerHTML = '<div class="mg-empty">Memuat…</div>';
    var r = await call('traffic_summary', { hours: T.hours });
    if (!r.success) { if (!silent) box.innerHTML = '<div class="mg-empty">' + esc(r.message || 'Gagal memuat.') + '</div>'; return; }
    var t = r.totals || {}, rate = t.requests ? (t.errors * 100 / t.requests) : 0;
    box.innerHTML =
      '<div class="mg-kpis"><div class="mg-kpi"><span>Total request</span><b>' + fmtN(t.requests) + '</b></div>' +
      '<div class="mg-kpi"><span>Error / ditolak</span><b' + (rate >= 10 ? ' class="warn"' : '') + '>' + fmtN(t.errors) + ' <small style="font-size:13px;font-weight:500">(' + rate.toFixed(1) + '%)</small></b></div>' +
      '<div class="mg-kpi"><span>Rata-rata latensi</span><b>' + fmtN(t.avg_ms) + ' ms</b></div><div class="mg-kpi"><span>P95 latensi</span><b>' + fmtN(t.p95_ms) + ' ms</b></div></div>' +
      '<div class="mg-card"><h3>Request per ' + (r.bucket === 'day' ? 'hari' : r.bucket === 'hour' ? 'jam' : 'menit') + ' <span class="mg-note" style="font-weight:400">(merah = error/ditolak)</span></h3><div class="mg-chart">' + chartSvg(r.series || [], r.bucket) + '</div></div>' +
      '<div class="mg-grid2"><div class="mg-card"><h3>Per sumber</h3><div class="mg-wrap"><table class="mg-table"><thead><tr><th>Sumber</th><th class="num">Request</th><th class="num">Error</th><th class="num">Avg ms</th><th class="num">P95 ms</th></tr></thead><tbody>' +
        ((r.by_source || []).map(function (s) { return '<tr><td><b>' + esc(s.source) + '</b></td><td class="num">' + fmtN(s.requests) + '</td><td class="num">' + fmtN(s.errors) + '</td><td class="num">' + fmtN(s.avg_ms) + '</td><td class="num">' + fmtN(s.p95_ms) + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="mg-empty">Belum ada data.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="mg-card"><h3>Endpoint teratas</h3><div class="mg-wrap"><table class="mg-table"><thead><tr><th>Sumber · aksi</th><th class="num">Request</th><th class="num">Error</th><th class="num">Avg ms</th></tr></thead><tbody>' +
        ((r.top_actions || []).map(function (a) { return '<tr><td>' + esc(a.source) + ' · <b>' + esc(a.action) + '</b></td><td class="num">' + fmtN(a.requests) + '</td><td class="num">' + fmtN(a.errors) + '</td><td class="num">' + fmtN(a.avg_ms) + '</td></tr>'; }).join('') || '<tr><td colspan="4" class="mg-empty">Belum ada data.</td></tr>') + '</tbody></table></div></div></div>' +
      '<div class="mg-card"><h3>IP teratas</h3><div class="mg-wrap"><table class="mg-table"><thead><tr><th>IP</th><th class="num">Request</th><th class="num">Error</th><th>Terakhir</th><th></th></tr></thead><tbody>' +
        ((r.top_ips || []).map(function (p) { return '<tr><td class="mono">' + esc(p.ip) + (p.blocked ? ' <span class="mg-badge err">diblokir</span>' : '') + '</td><td class="num">' + fmtN(p.requests) + '</td><td class="num">' + fmtN(p.errors) + '</td><td>' + fmtDT(p.last_ts) + '</td><td>' + (p.blocked ? '' : '<button class="mg-btn sm danger" data-block="' + esc(p.ip) + '">Blokir 1 jam</button>') + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="mg-empty">Belum ada data.</td></tr>') + '</tbody></table></div>' +
      '<p class="mg-note">Sumber <b>gas</b> = latensi panggilan data dashboard yang dilaporkan browser pengguna. Hanya sumber <b>auth</b> dan <b>register</b> yang bisa diblokir/dikontrol dari sini.</p></div>';
  }

  async function loadLogs() {
    var body = $('mgLBody'); body.innerHTML = '<tr><td colspan="7" class="mg-empty">Memuat…</td></tr>';
    var r = await call('traffic_logs', { source: $('mgLSrc').value, result: $('mgLRes').value, ip: $('mgLIp').value.trim(), page: T.lpage, pageSize: 25 });
    if (!r.success) { body.innerHTML = '<tr><td colspan="7" class="mg-empty">' + esc(r.message || 'Gagal memuat.') + '</td></tr>'; return; }
    body.innerHTML = r.rows.length ? r.rows.map(function (l) {
      return '<tr><td>' + fmtDT(l.ts) + '</td><td>' + esc(l.source) + '</td><td>' + esc(l.action) + '</td><td><span class="mg-badge ' + (l.ok ? 'ok' : 'err') + '">' + esc(l.status) + '</span></td>' +
        '<td class="num">' + fmtN(l.ms) + '</td><td class="mono">' + esc(l.ip || '-') + '</td><td>' + esc(l.user || '-') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="mg-empty">Tidak ada log yang cocok.</td></tr>';
    pager($('mgLPager'), r.page, r.pageSize, r.total, function (p) { T.lpage = p; loadLogs(); });
  }

  async function blockIp(ip, reason, minutes) {
    if (!window.confirm('Blokir IP ' + ip + (minutes ? ' selama ' + (minutes >= 60 ? (minutes / 60) + ' jam' : minutes + ' menit') : ' secara permanen') + '?')) return;
    var r = await call('ip_block', { ip: ip, reason: reason, minutes: minutes });
    notify(r.success ? 'success' : 'error', r.message || (r.success ? 'Berhasil.' : 'Gagal.'), 'Kontrol Traffic');
    if (r.success) { if (T.tab === 'ctl') loadControl(); else loadSummary(true); }
  }

  async function loadControl() {
    var box = $('mgCtlBody'); box.innerHTML = '<div class="mg-empty">Memuat…</div>';
    var r = await call('control_state', {});
    if (!r.success) { box.innerHTML = '<div class="mg-empty">' + esc(r.message || 'Gagal memuat.') + '</div>'; return; }
    box.innerHTML =
      '<div class="mg-card"><h3>Blokir IP</h3><div class="mg-form"><input class="mg-input" id="mgBIp" placeholder="Alamat IP, mis. 203.0.113.7"><input class="mg-input" id="mgBReason" placeholder="Alasan (opsional)">' +
        '<select class="mg-select" id="mgBDur"><option value="15">15 menit</option><option value="60" selected>1 jam</option><option value="1440">24 jam</option><option value="10080">7 hari</option><option value="0">Permanen</option></select>' +
        '<button class="mg-btn danger" id="mgBGo">Blokir</button></div>' +
        '<div class="mg-wrap"><table class="mg-table"><thead><tr><th>IP</th><th>Alasan</th><th>Oleh</th><th>Sejak</th><th>Berakhir</th><th></th></tr></thead><tbody>' +
        ((r.blocked || []).map(function (b) { return '<tr><td class="mono">' + esc(b.ip) + '</td><td>' + esc(b.reason || '-') + '</td><td>' + esc(b.by || '-') + '</td><td>' + fmtDT(b.created_at) + '</td><td>' + (b.expires_at ? fmtDT(b.expires_at) : 'Permanen') + '</td><td><button class="mg-btn sm" data-unb="' + esc(b.ip) + '">Buka blokir</button></td></tr>'; }).join('') || '<tr><td colspan="6" class="mg-empty">Tidak ada IP yang sedang diblokir.</td></tr>') + '</tbody></table></div>' +
        '<p class="mg-note">IP-mu saat ini: <b>' + esc(r.yourIp) + '</b> (tidak bisa diblokir). Berlaku untuk fungsi <b>auth</b> dan <b>register</b>; perubahan aktif dalam ±30 detik.</p></div>' +
      '<div class="mg-card"><h3>Saklar fitur</h3>' +
        (r.switches || []).map(function (s) { return '<div class="mg-sw"><div><b>' + esc(s.key) + '</b><small>' + esc(s.note || '') + '</small></div><label class="mg-toggle"><input type="checkbox" data-sw="' + esc(s.key) + '"' + (s.enabled ? ' checked' : '') + '><i></i></label></div>'; }).join('') +
        '<p class="mg-note">Matikan saklar untuk menolak fitur tersebut sementara (respons 503). Login sengaja tidak punya saklar agar admin tidak terkunci.</p></div>' +
      '<div class="mg-card"><h3>Reset batas permintaan</h3><p class="mg-note" style="margin:0 0 10px">Menghapus semua hitungan rate-limit dan membuka seluruh penguncian login karena salah password. Berguna setelah pengujian atau salah blokir.</p><button class="mg-btn" id="mgRL">Reset sekarang</button></div>';

    $('mgBGo').onclick = function () {
      var ip = $('mgBIp').value.trim(); if (!ip) return notify('warning', 'Isi alamat IP.', 'Kontrol Traffic');
      blockIp(ip, $('mgBReason').value.trim(), Number($('mgBDur').value));
    };
    box.onclick = async function (e) {
      var u = e.target.closest('button[data-unb]');
      if (u) { var x = await call('ip_unblock', { ip: u.dataset.unb }); notify(x.success ? 'success' : 'error', x.message || 'Gagal.', 'Kontrol Traffic'); if (x.success) loadControl(); }
    };
    box.querySelectorAll('input[data-sw]').forEach(function (cb) {
      cb.onchange = async function () {
        var x = await call('switch_set', { key: cb.dataset.sw, enabled: cb.checked });
        notify(x.success ? 'success' : 'error', x.message || 'Gagal.', 'Kontrol Traffic'); if (!x.success) cb.checked = !cb.checked;
      };
    });
    $('mgRL').onclick = async function () {
      if (!window.confirm('Reset semua batas permintaan dan penguncian login?')) return;
      var x = await call('rate_limit_reset', {}); notify(x.success ? 'success' : 'error', x.message || 'Gagal.', 'Kontrol Traffic');
    };
  }

  /* =====================================================================
     TELEMETRI: latensi & error panggilan GAS (semua pengguna), dikirim berkala ke fungsi "auth"
     ===================================================================== */
  var queue = [];
  function rec(fn, ms, ok, code) {
    queue.push({ f: String(fn).slice(0, 60), ms: Math.round(ms), ok: !!ok, c: code || '' });
    if (queue.length > 200) queue.splice(0, queue.length - 200);
  }
  function flush(final) {
    if (!queue.length || typeof AUTH_URL === 'undefined' || !SESSION_TOKEN || jwtExpMs_(SESSION_TOKEN) < Date.now()) return;
    var entries = queue.splice(0, 50);
    try {
      fetch(AUTH_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: !!final,
        body: JSON.stringify({ action: 'telemetry', accessToken: SESSION_TOKEN, entries: entries }) }).catch(function () {});
    } catch (e) { /* telemetri tidak boleh mengganggu aplikasi */ }
  }
  setInterval(function () { if (!document.hidden) flush(false); }, 30000);
  document.addEventListener('visibilitychange', function () { if (document.hidden) flush(true); });
  window.addEventListener('pagehide', function () { flush(true); });

  window.DGM_TM = { rec: rec, flush: flush };
  window.MG = {
    syncMenu: syncMenu,
    enterUser: function () { buildUser(); loadUsers(); },
    enterTraffic: function () { buildTraffic(); loadSummary(); }
  };
  syncMenu();
})();
