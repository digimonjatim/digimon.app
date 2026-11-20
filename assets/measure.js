/* DIGIMON — Measure OLO. Dimuat setelah script utama index.html & management.js.
   Alur: Order Number, Latitude, Longitude, Bandwidth (wajib) → Check Feasibility (radius 150 m)
         → peta menampilkan ODP yang port-nya available → klik ODP (popup data alpro) → Measure
         → hasil (Result Assessment & Type Design) tampil di modal. */
(function () {
  'use strict';
  // Sesuaikan slug di akhir URL dengan Endpoint URL fungsi "measure" di dashboard Supabase.
  var MEASURE_URL = 'https://lhnwbupbqnewhlzdobcr.supabase.co/functions/v1/measure';
  var DEFAULT_CENTER = [-7.25, 112.75], DEFAULT_ZOOM = 11;   // Jawa Timur

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function notify(type, msg, title) { if (typeof showAppNotif === 'function') showAppNotif(type, msg, title); else alert(msg); }
  function fmtN(n, d) { return Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }); }
  function fmtDT(iso) { var d = new Date(iso); return isNaN(d) ? '-' : d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function fmtBw(mbps) { return mbps >= 1000 ? fmtN(mbps / 1000, 2) + ' Gbps' : fmtN(mbps, 0) + ' Mbps'; }
  function cls(a) { return a === 'TANPA JT' ? 'mo-c-no' : a === 'NEED JT (ODP)' ? 'mo-c-odp' : 'mo-c-otb'; }
  function isAvail(o) { return Number(o.available) > 0; }
  function km(m) { return fmtN(m / 1000, 2) + ' km'; }

  async function call(action, body) {
    async function post() {
      var ctrl = new AbortController(), t = setTimeout(function () { ctrl.abort(); }, 45000);   // rute bisa beberapa detik
      try {
        var r = await fetch(MEASURE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ action: action, accessToken: SESSION_TOKEN }, body || {})), signal: ctrl.signal });
        return (await r.json().catch(function () { return null; })) || { success: false, message: 'Respons server tidak valid.' };
      } catch (e) { return { success: false, message: 'Tidak bisa terhubung ke server (atau waktu habis).' }; }
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

  // S.checked = titik order saat Check Feasibility (Measure selalu memakai titik ini)
  var S = { built: false, map: null, pin: null, odpLayer: null, routeLayer: null, circle: null,
            odps: {}, markers: {}, sel: null, checked: null, radius: 150, busy: false };
  var H = { page: 1, size: 10, search: '', timer: null };

  function build() {
    if (S.built) return; S.built = true;
    $('page-measure-olo').innerHTML =
      '<div class="mg-root mo-root">' +
        '<div class="mg-card">' +
          '<div class="mo-form">' +
            '<div class="mo-f"><label for="moOrder">Order Number</label><input class="mg-input" id="moOrder" maxlength="120" placeholder="Opsional" autocomplete="off"></div>' +
            '<div class="mo-f"><label for="moLat">Latitude</label><input class="mg-input" id="moLat" placeholder="-7.2756" inputmode="decimal" autocomplete="off"></div>' +
            '<div class="mo-f"><label for="moLon">Longitude</label><input class="mg-input" id="moLon" placeholder="112.7482" inputmode="decimal" autocomplete="off"></div>' +
            '<div class="mo-f"><label for="moBw">Bandwidth <span class="mo-req" title="Wajib diisi">*</span></label><div class="mo-bw"><input class="mg-input" id="moBw" type="number" min="0" step="any" placeholder="Wajib diisi" inputmode="decimal"><select class="mg-select" id="moUnit"><option>Mbps</option><option>Gbps</option></select></div></div>' +
            '<div class="mo-f mo-btns"><button class="mg-btn pri" id="moCheck" type="button">Check Feasibility (<span id="moRad">150</span> m)</button></div>' +
          '</div>' +
          '<p class="mg-note">Klik peta atau geser pin untuk menentukan titik order. Koordinat dari Google Maps (mis. <b>-7.2756, 112.7482</b>) bisa ditempel ke kolom Latitude.</p>' +
          '<div id="moMap" class="mo-map"><div class="mo-empty-map">Memuat peta…</div></div>' +
          '<div class="mo-legend"><span><i class="mo-lg" style="background:#12b76a"></i>ODP (alpro) port available</span><span><i class="mo-lg" style="background:#667085"></i>ODP penuh</span><span><i class="mo-lg" style="background:#f79009"></i>ODP terpilih</span><span><i class="mo-lg mo-lg-sq" style="background:#b42318"></i>OLT (gpon)</span><span>📍 Titik order</span>' +
            '<label><input type="checkbox" id="moFull"> Tampilkan ODP penuh</label></div>' +
          '<div class="mo-summary" id="moSummary"></div>' +
        '</div>' +
        '<div class="mg-card"><h3>Riwayat pengukuran saya</h3>' +
          '<div class="mo-hbar"><label>Tampilkan <select class="mg-select" id="moHSize"><option>10</option><option>20</option><option>30</option><option>40</option><option>50</option></select> data</label>' +
          '<input class="mg-input" id="moHSearch" placeholder="Cari order, ODP, OLT, hasil, design…" autocomplete="off"></div>' +
          '<div id="moHist"><div class="mg-empty">Memuat…</div></div><div class="mg-pager" id="moHPager"></div></div>' +
      '</div>';

    // modal hasil (ditaruh di <body> agar menutup seluruh layar)
    var md = document.createElement('div'); md.className = 'mg-modal'; md.id = 'moModal'; md.hidden = true;
    md.innerHTML = '<div class="mg-dialog mg-root mo-dialog" id="moDlg"></div>';
    document.body.appendChild(md);
    md.onclick = function (e) { if (e.target === md) closeModal(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('moModal').hidden) closeModal(); });

    $('moCheck').onclick = checkFeasibility;
    $('moFull').onchange = function () { drawOdps(false); };
    $('moLat').addEventListener('input', function () {      // tempel "lat, lon" sekaligus
      var m = this.value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) { this.value = m[1]; $('moLon').value = m[2]; syncPinFromInputs(true); }
    });
    ['moLat', 'moLon'].forEach(function (id) { $(id).addEventListener('change', function () { syncPinFromInputs(true); }); });
    ['moLat', 'moLon', 'moBw'].forEach(function (id) { $(id).addEventListener('input', function () { $(id).classList.remove('mo-invalid'); }); });
    $('moHSize').onchange = function () { H.size = Number(this.value); H.page = 1; loadHistory(); };
    $('moHSearch').oninput = function () { var v = this.value.trim(); clearTimeout(H.timer); H.timer = setTimeout(function () { H.search = v; H.page = 1; loadHistory(); }, 350); };
  }

  function bad(id) { var el = $(id); el.classList.add('mo-invalid'); el.focus(); }
  function validPoint(lat, lon) { return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; }
  function setPoint(lat, lon, pan) {
    $('moLat').value = Number(lat).toFixed(6); $('moLon').value = Number(lon).toFixed(6);
    $('moLat').classList.remove('mo-invalid'); $('moLon').classList.remove('mo-invalid');
    if (!S.map) return;
    if (!S.pin) {
      S.pin = L.marker([lat, lon], { draggable: true, title: 'Titik order' }).addTo(S.map);
      S.pin.on('dragend', function () { var p = S.pin.getLatLng(); setPoint(p.lat, p.lng, false); });
    } else S.pin.setLatLng([lat, lon]);
    if (pan) S.map.setView([lat, lon], Math.max(S.map.getZoom(), 17));
  }
  function syncPinFromInputs(pan) {
    var lat = parseFloat($('moLat').value), lon = parseFloat($('moLon').value);
    if (validPoint(lat, lon)) setPoint(lat, lon, pan);
  }

  function initMap() {
    if (S.map) { setTimeout(function () { S.map.invalidateSize(); }, 150); return Promise.resolve(); }
    return berandaEnsureLeaflet_().then(function () {
      $('moMap').innerHTML = '';
      S.map = L.map('moMap').setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(S.map);
      S.odpLayer = L.layerGroup().addTo(S.map);
      S.routeLayer = L.layerGroup().addTo(S.map);
      S.map.on('click', function (e) { setPoint(e.latlng.lat, e.latlng.lng, false); });   // penanda ODP/OLT tidak meneruskan klik ke sini
      syncPinFromInputs(false);
      setTimeout(function () { S.map.invalidateSize(); }, 150);
    }).catch(function () { $('moMap').innerHTML = '<div class="mo-empty-map">Peta gagal dimuat. Muat ulang halaman.</div>'; });
  }

  // ---------- Check Feasibility ----------
  async function checkFeasibility() {
    if (S.busy) return;
    var lat = parseFloat($('moLat').value), lon = parseFloat($('moLon').value), bw = parseFloat($('moBw').value);
    if (!isFinite(lat)) { bad('moLat'); return notify('warning', 'Isi Latitude order, atau pilih titik di peta.', 'Measure OLO'); }
    if (!isFinite(lon)) { bad('moLon'); return notify('warning', 'Isi Longitude order, atau pilih titik di peta.', 'Measure OLO'); }
    if (!validPoint(lat, lon)) { bad('moLat'); return notify('warning', 'Koordinat tidak valid.', 'Measure OLO'); }
    if (!(bw > 0)) { bad('moBw'); return notify('warning', 'Bandwidth wajib diisi (angka lebih dari 0).', 'Measure OLO'); }

    S.busy = true; var btn = $('moCheck'); btn.disabled = true;
    $('moSummary').textContent = 'Mencari ODP di sekitar titik order…';
    var r = await call('feasibility', { lat: lat, lon: lon });
    S.busy = false; btn.disabled = false;
    if (!r.success) { $('moSummary').textContent = ''; return notify('error', r.message || 'Check Feasibility gagal.', 'Measure OLO'); }

    S.checked = { lat: lat, lon: lon }; S.radius = r.radius_m; $('moRad').textContent = r.radius_m;
    S.odps = {}; r.odps.forEach(function (o) { S.odps[o.id] = o; });
    S.sel = null; S.routeLayer.clearLayers(); S.map.closePopup();
    var total = r.odps.length;
    if (r.availableCount === 0) {
      $('moFull').checked = total > 0;       // tidak ada yang available: tampilkan yang penuh sebagai acuan
      $('moSummary').innerHTML = total
        ? '<span class="mg-badge err">TIDAK ADA PORT AVAILABLE</span> &nbsp;Ada ' + fmtN(total) + ' ODP dalam radius ' + r.radius_m + ' m, tetapi semuanya penuh. Klik salah satu lalu Measure untuk assessment “port tidak ready”.'
        : '<span class="mg-badge err">TIDAK ADA ODP</span> &nbsp;Tidak ada ODP dalam radius ' + r.radius_m + ' m dari titik order. Periksa koordinat atau data tabel alpro.';
    } else {
      $('moSummary').innerHTML = '<span class="mg-badge ok">FEASIBLE</span> &nbsp;<b>' + fmtN(r.availableCount) + '</b> ODP dengan port available dari ' + fmtN(total) + ' ODP dalam radius ' + r.radius_m + ' m. <b>Klik ODP di peta</b> untuk melihat datanya.';
    }
    drawOdps(true);
  }

  // Ikon berbeda: ODP/alpro = LINGKARAN "ODP" (hijau/abu/oranye), OLT/gpon = KOTAK merah "OLT"
  function odpIcon(o, selected) {
    var st = selected ? 'sel' : (isAvail(o) ? 'avail' : 'full'), sz = selected ? 30 : 24;
    return L.divIcon({ className: 'mo-ico', html: '<div class="mo-odp ' + st + '">ODP</div>', iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2] });
  }
  function oltIcon() { return L.divIcon({ className: 'mo-ico', html: '<div class="mo-olt">OLT</div>', iconSize: [32, 32], iconAnchor: [16, 16] }); }

  // Popup informasi ODP (alpro) — gaya sama dengan popup OLT (gpon)
  function row(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }
  function odpPopup(o) {
    return '<div class="mo-pop"><div class="mo-pop-h"><b>' + esc(o.nama_alpro) + '</b>' + (isAvail(o) ? '<span class="mg-badge ok">PORT AVAILABLE</span>' : '<span class="mg-badge err">PENUH</span>') + '</div>' +
      '<table>' +
        row('District', esc(o.district || '-')) + row('Sub District', esc(o.sub_district || '-')) + row('STO', esc(o.sto || '-')) +
        row('Used', fmtN(o.used)) + row('Available', '<b>' + fmtN(o.available) + '</b>') + row('Reservation', fmtN(o.reservation)) + row('Capacity', fmtN(o.capacity)) +
        row('Status Occupancy', esc(o.status_occupancy || '-')) + row('Percentage Occupancy', esc(o.percentage_occupancy || '-')) +
        row('Hostname OLT', esc(o.hostname_olt || '-')) + row('IP OLT', esc(o.ip_olt || '-')) + row('flag XGSPON', esc(o.flag_xgspon || '-')) +
        row('Jarak dari titik order', fmtN(o.dist_m) + ' m') +
      '</table>' +
      (o.olt_found ? '' : '<div class="mo-warn">OLT <b>' + esc(o.hostname_olt || o.ip_olt || '(kosong)') + '</b> belum cocok dengan tabel gpon, sehingga Measure belum bisa dijalankan untuk ODP ini.</div>') +
      '<button class="mg-btn pri sm" type="button" data-measure' + (o.olt_found ? '' : ' disabled') + '>Measure</button></div>';
  }

  function drawOdps(fit) {
    if (!S.map || !S.checked) return;
    S.odpLayer.clearLayers(); S.markers = {};
    var showFull = $('moFull').checked;
    if (S.circle) S.map.removeLayer(S.circle);
    S.circle = L.circle([S.checked.lat, S.checked.lon], { radius: S.radius, color: '#1f5fae', weight: 2, fillColor: '#1f5fae', fillOpacity: .06, dashArray: '6 6', interactive: false }).addTo(S.map);
    Object.keys(S.odps).forEach(function (id) {
      var o = S.odps[id]; if (!isAvail(o) && !showFull) return;
      var m = L.marker([o.latitude, o.longitude], { icon: odpIcon(o, S.sel === o.id), riseOnHover: true, keyboard: false, zIndexOffset: S.sel === o.id ? 1000 : 0 }).addTo(S.odpLayer);
      m.bindTooltip(esc(o.nama_alpro) + ' · available ' + fmtN(o.available), { direction: 'top', offset: [0, -10] });
      m.bindPopup(odpPopup(o), { maxWidth: 340, minWidth: 270, autoPanPadding: [30, 30] });
      m.on('popupopen', function (ev) {
        selectOdp(o.id);
        var btn = ev.popup.getElement() && ev.popup.getElement().querySelector('[data-measure]');
        if (btn) btn.onclick = function () { doMeasure(o.id, btn); };
      });
      S.markers[o.id] = m;
    });
    if (fit === true) S.map.fitBounds(S.circle.getBounds().pad(0.2), { maxZoom: 18 });
  }

  function selectOdp(id) {
    S.sel = id;
    Object.keys(S.markers).forEach(function (k) {
      var sel = Number(k) === id; S.markers[k].setIcon(odpIcon(S.odps[k], sel)); S.markers[k].setZIndexOffset(sel ? 1000 : 0);
    });
  }

  // ---------- Modal hasil ----------
  function openModal(html) { $('moDlg').innerHTML = html; $('moModal').hidden = false; var c = $('moClose'); if (c) c.onclick = closeModal; var c2 = $('moClose2'); if (c2) c2.onclick = closeModal; }
  function closeModal() { $('moModal').hidden = true; }

  async function doMeasure(id, btn) {
    if (S.busy || !S.checked) return;
    var lat = parseFloat($('moLat').value), lon = parseFloat($('moLon').value), bw = parseFloat($('moBw').value);
    if (Math.abs(lat - S.checked.lat) > 1e-6 || Math.abs(lon - S.checked.lon) > 1e-6)
      return notify('warning', 'Titik order sudah berubah sejak Check Feasibility. Klik Check Feasibility lagi.', 'Measure OLO');
    if (!(bw > 0)) { bad('moBw'); return notify('warning', 'Bandwidth wajib diisi (angka lebih dari 0).', 'Measure OLO'); }
    S.busy = true; if (btn) { btn.disabled = true; btn.textContent = 'Mengukur…'; }
    S.map.closePopup();
    openModal('<div class="head"><div><h2>Hasil Measure</h2></div><button class="mg-btn sm" id="moClose" type="button">Tutup</button></div><div class="mg-empty">Menghitung jarak jalan ke OLT…</div>');
    var r = await call('measure', { lat: S.checked.lat, lon: S.checked.lon, alproId: id, bandwidth: bw, unit: $('moUnit').value, orderNo: $('moOrder').value.trim() });
    S.busy = false;
    if (!r.success) {
      openModal('<div class="head"><div><h2>Hasil Measure</h2></div><button class="mg-btn sm" id="moClose" type="button">Tutup</button></div><div class="mg-empty">' + esc(r.message || 'Pengukuran gagal.') + '</div>');
      return notify('error', r.message || 'Pengukuran gagal.', 'Measure OLO');
    }
    openModal(resultHtml(r)); drawRoute(r); H.page = 1; loadHistory();
  }

  function drawRoute(d) {
    S.routeLayer.clearLayers();
    var pts = [[d.input.lat, d.input.lon]];
    if (d.geometry && d.geometry.length) {
      L.polyline(d.geometry, { color: d.estimated ? '#f79009' : '#1f5fae', weight: 5, opacity: .85, dashArray: d.estimated ? '8 8' : null }).addTo(S.routeLayer);
      pts = pts.concat(d.geometry);
    }
    var o = d.olt;
    L.marker([o.latitude, o.longitude], { icon: oltIcon(), keyboard: false, zIndexOffset: 900 })
      .bindPopup('<div class="mo-pop"><div class="mo-pop-h"><b>' + esc(o.hostname_olt) + '</b><span class="mg-badge ' + (o.is_xgspon ? 'ok' : '') + '">' + (o.is_xgspon ? 'XGSPON' : 'non-XGSPON') + '</span></div><table>' +
        row('IP OLT', esc(o.ip_olt || '-')) + row('Merk / Tipe', esc((o.merk || '-') + ' / ' + (o.tipe || '-'))) + row('STO', esc(o.sto || '-')) + row('Alamat', esc(o.alamat || '-')) + '</table></div>', { maxWidth: 320 })
      .addTo(S.routeLayer);
    pts.push([o.latitude, o.longitude]);
    S.map.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 17 });
  }

  function resultHtml(d) {
    var r = d.result, o = d.olt, p = d.odp, ds = d.distance, h = '';
    h += '<div class="head"><div><h2>Hasil Measure</h2><span style="color:var(--mg-mut);font-size:13px">' + (d.input.orderNo ? 'Order ' + esc(d.input.orderNo) + ' · ' : '') + 'ODP ' + esc(p.nama_alpro) + '</span></div><button class="mg-btn sm" id="moClose" type="button">Tutup</button></div>';
    if (d.estimated) h += '<div class="mo-warn">⚠ Layanan rute sedang tidak tersedia, sehingga jarak di bawah adalah <b>perkiraan</b> (garis lurus × faktor). Jangan dipakai sebagai keputusan final, terutama bila mendekati batas 8 km. Ulangi Measure beberapa saat lagi.</div>';
    var sub = ds.mode === 'via_odp' ? 'order→ODP ' + km(ds.order_to_odp_m) + ' + ODP→OLT ' + km(ds.odp_to_olt_m) : 'langsung order→OLT';
    h += '<div class="mo-tiles">' +
      '<div class="mo-tile ' + cls(r.assessment) + '"><span>Result Assessment</span><b>' + esc(r.assessment) + '</b><small>NTE: ' + esc(r.nte) + '</small></div>' +
      '<div class="mo-tile ' + cls(r.assessment) + '"><span>Type Design</span><b>' + esc(r.design) + '</b></div>' +
      '<div class="mg-kpi"><span>Jarak jalan ke OLT</span><b>' + km(ds.total_m) + '</b><span>' + esc(sub) + '</span></div>' +
      '<div class="mg-kpi"><span>Bandwidth</span><b>' + esc(fmtBw(d.input.bandwidthMbps)) + '</b><span>&nbsp;</span></div></div>';
    h += '<div class="mg-grid2"><div class="mg-card"><h3>Jejak keputusan</h3><ol class="mo-steps">' +
      r.path.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' +
      '<p class="mg-note">ODP: <b>' + esc(p.nama_alpro) + '</b> (available ' + fmtN(p.available) + ' dari capacity ' + fmtN(p.capacity) + '). Jarak tepat 8 km masih dihitung ONT.</p></div>' +
      '<div class="mg-card"><h3>OLT</h3><div class="mg-info" style="grid-template-columns:1fr 1fr">' +
      '<div><span>Hostname</span>' + esc(o.hostname_olt) + '</div><div><span>IP OLT</span>' + esc(o.ip_olt || '-') + '</div>' +
      '<div><span>Merk / Tipe</span>' + esc((o.merk || '-') + ' / ' + (o.tipe || '-')) + '</div><div><span>XGSPON</span>' + (o.is_xgspon ? 'Ya' : 'Tidak') + ' (flag: ' + esc(o.flag_xgspon || '-') + ')</div>' +
      '<div><span>District / Sub District</span>' + esc((o.district || '-') + ' / ' + (o.sub_district || '-')) + '</div><div><span>STO</span>' + esc(o.sto || '-') + '</div>' +
      '<div style="grid-column:1/-1"><span>Alamat / Gedung</span>' + esc((o.alamat || '-') + (o.nama_gedung ? ' — ' + o.nama_gedung : '')) + '</div></div></div></div>' +
      '<div style="text-align:right"><button class="mg-btn pri" id="moClose2" type="button">Tutup &amp; lihat rute di peta</button></div>';
    return h;
  }

  // ---------- Riwayat: pagination + pencarian (sisi server) ----------
  function pager(el, page, size, total, onGo) {
    var pages = Math.max(1, Math.ceil(total / size)), from = total ? (page - 1) * size + 1 : 0, to = Math.min(total, page * size);
    el.innerHTML = '<span>Menampilkan ' + fmtN(from) + '–' + fmtN(to) + ' dari ' + fmtN(total) + ' data · halaman ' + page + ' / ' + pages + '</span><span>' +
      '<button class="mg-btn sm" data-g="-1"' + (page <= 1 ? ' disabled' : '') + '>‹ Sebelumnya</button> ' +
      '<button class="mg-btn sm" data-g="1"' + (page >= pages ? ' disabled' : '') + '>Berikutnya ›</button></span>';
    el.onclick = function (e) { var b = e.target.closest('button[data-g]'); if (b && !b.disabled) onGo(page + Number(b.dataset.g)); };
  }

  async function loadHistory() {
    var box = $('moHist'); if (!box) return;
    var r = await call('history', { page: H.page, pageSize: H.size, search: H.search });
    if (!r.success) { box.innerHTML = '<div class="mg-empty">' + esc(r.message || 'Gagal memuat.') + '</div>'; $('moHPager').innerHTML = ''; return; }
    box.innerHTML = r.rows.length ? '<div class="mg-wrap"><table class="mg-table"><thead><tr><th>Waktu</th><th>Order No</th><th>Koordinat order</th><th>Bandwidth</th><th>Hasil</th><th>Design</th><th class="num">Jarak</th><th>ODP</th><th>OLT</th></tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td>' + fmtDT(x.created_at) + '</td><td>' + esc(x.order_no || '-') + '</td><td class="mono">' + Number(x.lat).toFixed(5) + ', ' + Number(x.lon).toFixed(5) + '</td><td>' + esc(fmtBw(Number(x.bandwidth_mbps))) + '</td>' +
          '<td><span class="mg-badge ' + (x.assessment === 'TANPA JT' ? 'ok' : x.assessment === 'NEED JT (ODP)' ? 'Pending' : 'err') + '">' + esc(x.assessment) + '</span>' + (x.estimated ? ' <span class="mg-badge Pending">perkiraan</span>' : '') + '</td>' +
          '<td>' + esc(x.design) + '</td><td class="num">' + km(x.distance_m || 0) + '</td><td>' + esc(x.odp || '-') + '</td><td>' + esc(x.olt || '-') + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="mg-empty">' + (H.search ? 'Tidak ada data yang cocok dengan pencarian.' : 'Belum ada pengukuran.') + '</div>';
    pager($('moHPager'), r.page, r.pageSize, r.total, function (p) { H.page = p; loadHistory(); });
  }

  window.MO = { enter: function () { build(); initMap(); loadHistory(); } };
})();
