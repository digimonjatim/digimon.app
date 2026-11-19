/* DIGIMON — Measure OLO (alur berbasis ODP). Dimuat setelah script utama index.html & management.js.
   Alur: Order Number (opsional) → Latitude/Longitude → Bandwidth → Check Feasibility (radius 150 m)
         → peta menampilkan ODP yang port-nya available → klik ODP (data alpro) → Measure → Result Assessment & Type Design. */
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

  // S.checked = titik order yang dipakai saat Check Feasibility (Measure selalu memakai titik ini)
  var S = { built: false, map: null, pin: null, odpLayer: null, routeLayer: null, circle: null,
            odps: {}, markers: {}, sel: null, checked: null, radius: 150, busy: false };

  function build() {
    if (S.built) return; S.built = true;
    $('page-measure-olo').innerHTML =
      '<div class="mg-root mo-root">' +
        '<div class="mg-card">' +
          '<div class="mo-form">' +
            '<div class="mo-f"><label for="moOrder">1. Order Number (opsional)</label><input class="mg-input" id="moOrder" maxlength="120" autocomplete="off"></div>' +
            '<div class="mo-f"><label for="moLat">2. Latitude order</label><input class="mg-input" id="moLat" placeholder="-7.2756" inputmode="decimal" autocomplete="off"></div>' +
            '<div class="mo-f"><label for="moLon">Longitude order</label><input class="mg-input" id="moLon" placeholder="112.7482" inputmode="decimal" autocomplete="off"></div>' +
            '<div class="mo-f"><label for="moBw">3. Bandwidth</label><div class="mo-bw"><input class="mg-input" id="moBw" type="number" min="0" step="any" value="100" inputmode="decimal"><select class="mg-select" id="moUnit"><option>Mbps</option><option>Gbps</option></select></div></div>' +
            '<div class="mo-f mo-btns"><button class="mg-btn" id="moLoc" type="button">Lokasi saya</button><button class="mg-btn pri" id="moCheck" type="button">4. Check Feasibility (<span id="moRad">150</span> m)</button></div>' +
          '</div>' +
          '<p class="mg-note">Klik peta atau geser pin untuk menentukan titik order. Koordinat dari Google Maps (mis. <b>-7.2756, 112.7482</b>) bisa ditempel ke kolom Latitude.</p>' +
          '<div id="moMap" class="mo-map"><div class="mo-empty-map">Memuat peta…</div></div>' +
          '<div class="mo-legend"><span><i style="background:#12b76a"></i>ODP port available</span><span><i style="background:#667085"></i>ODP penuh</span><span><i style="background:#1f5fae"></i>ODP terpilih</span><span><i style="background:#b42318"></i>OLT</span>' +
            '<label><input type="checkbox" id="moFull"> Tampilkan ODP penuh</label></div>' +
          '<div class="mo-summary" id="moSummary"></div>' +
        '</div>' +
        '<div id="moSel"></div>' +
        '<div id="moOut"></div>' +
        '<div class="mg-card"><h3>Riwayat pengukuran saya</h3><div id="moHist"><div class="mg-empty">Memuat…</div></div></div>' +
      '</div>';

    $('moCheck').onclick = checkFeasibility;
    $('moFull').onchange = drawOdps;
    $('moLoc').onclick = function () {
      if (!navigator.geolocation) return notify('warning', 'Peramban tidak mendukung geolokasi.', 'Measure OLO');
      navigator.geolocation.getCurrentPosition(function (p) { setPoint(p.coords.latitude, p.coords.longitude, true); },
        function () { notify('warning', 'Lokasi tidak bisa diakses. Izinkan akses lokasi atau pilih titik di peta.', 'Measure OLO'); }, { enableHighAccuracy: true, timeout: 10000 });
    };
    $('moLat').addEventListener('input', function () {      // tempel "lat, lon" sekaligus
      var m = this.value.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
      if (m) { this.value = m[1]; $('moLon').value = m[2]; syncPinFromInputs(true); }
    });
    ['moLat', 'moLon'].forEach(function (id) { $(id).addEventListener('change', function () { syncPinFromInputs(true); }); });
  }

  function validPoint(lat, lon) { return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; }
  function setPoint(lat, lon, pan) {
    $('moLat').value = Number(lat).toFixed(6); $('moLon').value = Number(lon).toFixed(6);
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
      S.map.on('click', function (e) { setPoint(e.latlng.lat, e.latlng.lng, false); });
      syncPinFromInputs(false);
      setTimeout(function () { S.map.invalidateSize(); }, 150);
    }).catch(function () { $('moMap').innerHTML = '<div class="mo-empty-map">Peta gagal dimuat. Muat ulang halaman.</div>'; });
  }

  // ---------- Langkah 4–5: Check Feasibility ----------
  async function checkFeasibility() {
    if (S.busy) return;
    var lat = parseFloat($('moLat').value), lon = parseFloat($('moLon').value);
    if (!validPoint(lat, lon)) return notify('warning', 'Isi Latitude dan Longitude order, atau pilih titik di peta.', 'Measure OLO');
    S.busy = true; var btn = $('moCheck'); btn.disabled = true;
    $('moSummary').textContent = 'Mencari ODP di sekitar titik order…';
    var r = await call('feasibility', { lat: lat, lon: lon });
    S.busy = false; btn.disabled = false;
    if (!r.success) { $('moSummary').textContent = ''; return notify('error', r.message || 'Check Feasibility gagal.', 'Measure OLO'); }

    S.checked = { lat: lat, lon: lon }; S.radius = r.radius_m; $('moRad').textContent = r.radius_m;
    S.odps = {}; r.odps.forEach(function (o) { S.odps[o.id] = o; });
    S.sel = null; $('moSel').innerHTML = ''; $('moOut').innerHTML = ''; S.routeLayer.clearLayers();
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

  function markerStyle(o, selected) {
    if (selected) return { radius: 11, color: '#fff', weight: 3, fillColor: '#1f5fae', fillOpacity: 1 };
    return isAvail(o) ? { radius: 9, color: '#fff', weight: 2, fillColor: '#12b76a', fillOpacity: 1 }
                      : { radius: 7, color: '#fff', weight: 2, fillColor: '#667085', fillOpacity: .9 };
  }
  function drawOdps(fit) {
    if (!S.map || !S.checked) return;
    S.odpLayer.clearLayers(); S.markers = {};
    var showFull = $('moFull').checked;
    if (S.circle) S.map.removeLayer(S.circle);
    S.circle = L.circle([S.checked.lat, S.checked.lon], { radius: S.radius, color: '#1f5fae', weight: 2, fillColor: '#1f5fae', fillOpacity: .06, dashArray: '6 6', interactive: false }).addTo(S.map);
    Object.keys(S.odps).forEach(function (id) {
      var o = S.odps[id]; if (!isAvail(o) && !showFull) return;
      var m = L.circleMarker([o.latitude, o.longitude], markerStyle(o, S.sel === o.id)).addTo(S.odpLayer);
      m.bindTooltip(esc(o.nama_alpro) + ' · available ' + fmtN(o.available), { direction: 'top' });
      m.on('click', function () { selectOdp(o.id); });
      S.markers[o.id] = m;
    });
    if (fit === true) S.map.fitBounds(S.circle.getBounds().pad(0.2), { maxZoom: 18 });
  }

  // ---------- Langkah 6: klik ODP → data alpro + tombol Measure ----------
  function selectOdp(id) {
    var o = S.odps[id]; if (!o) return;
    S.sel = id;
    Object.keys(S.markers).forEach(function (k) { S.markers[k].setStyle(markerStyle(S.odps[k], Number(k) === id)); });
    var avail = isAvail(o);
    $('moSel').innerHTML =
      '<div class="mg-card"><div class="mo-sel-head"><h3>ODP terpilih: ' + esc(o.nama_alpro) + ' &nbsp;' + (avail ? '<span class="mg-badge ok">PORT AVAILABLE</span>' : '<span class="mg-badge err">PENUH</span>') + '</h3>' +
      '<button class="mg-btn pri" id="moMeasure" type="button"' + (o.olt_found ? '' : ' disabled') + '>Measure</button></div>' +
      '<div class="mo-3">' +
        '<div><span>District</span>' + esc(o.district || '-') + '</div><div><span>Sub District</span>' + esc(o.sub_district || '-') + '</div><div><span>STO</span>' + esc(o.sto || '-') + '</div>' +
        '<div><span>Used</span>' + fmtN(o.used) + '</div><div><span>Available</span><b>' + fmtN(o.available) + '</b></div><div><span>Reservation</span>' + fmtN(o.reservation) + '</div>' +
        '<div><span>Capacity</span>' + fmtN(o.capacity) + '</div><div><span>Status Occupancy</span>' + esc(o.status_occupancy || '-') + '</div><div><span>Percentage Occupancy</span>' + esc(o.percentage_occupancy || '-') + '</div>' +
        '<div><span>Hostname OLT</span>' + esc(o.hostname_olt || '-') + '</div><div><span>IP OLT</span>' + esc(o.ip_olt || '-') + '</div><div><span>flag XGSPON</span>' + esc(o.flag_xgspon || '-') + '</div>' +
        '<div><span>Koordinat ODP</span>' + Number(o.latitude).toFixed(6) + ', ' + Number(o.longitude).toFixed(6) + '</div><div><span>Jarak dari titik order</span>' + fmtN(o.dist_m) + ' m (garis lurus)</div>' +
      '</div>' +
      (o.olt_found ? '' : '<div class="mo-warn" style="margin:12px 0 0">OLT <b>' + esc(o.hostname_olt || o.ip_olt || '(kosong)') + '</b> belum cocok dengan tabel gpon, jadi Measure belum bisa dijalankan untuk ODP ini. Lengkapi HOSTNAME/IP OLT pada alpro dan pastikan OLT ada di tabel gpon.</div>') +
      '</div>';
    if ($('moMeasure')) $('moMeasure').onclick = doMeasure;
    $('moOut').innerHTML = '';
    S.routeLayer.clearLayers();
    $('moSel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ---------- Langkah 7: Measure → Result Assessment & Type Design ----------
  async function doMeasure() {
    if (S.busy || !S.sel || !S.checked) return;
    var lat = parseFloat($('moLat').value), lon = parseFloat($('moLon').value), bw = parseFloat($('moBw').value);
    if (Math.abs(lat - S.checked.lat) > 1e-6 || Math.abs(lon - S.checked.lon) > 1e-6)
      return notify('warning', 'Titik order sudah berubah sejak Check Feasibility. Klik Check Feasibility lagi.', 'Measure OLO');
    if (!(bw > 0)) return notify('warning', 'Isi bandwidth dengan angka lebih dari 0.', 'Measure OLO');
    S.busy = true; var btn = $('moMeasure'); btn.disabled = true; btn.textContent = 'Mengukur…';
    $('moOut').innerHTML = '<div class="mg-card"><div class="mg-empty">Menghitung jarak jalan ke OLT…</div></div>';
    var r = await call('measure', { lat: S.checked.lat, lon: S.checked.lon, alproId: S.sel, bandwidth: bw, unit: $('moUnit').value, orderNo: $('moOrder').value.trim() });
    S.busy = false; btn.disabled = false; btn.textContent = 'Measure';
    if (!r.success) { $('moOut').innerHTML = '<div class="mg-card"><div class="mg-empty">' + esc(r.message || 'Pengukuran gagal.') + '</div></div>'; return notify('error', r.message || 'Pengukuran gagal.', 'Measure OLO'); }
    render(r); drawRoute(r); loadHistory();
  }

  function drawRoute(d) {
    S.routeLayer.clearLayers();
    var pts = [[d.input.lat, d.input.lon]];
    if (d.geometry && d.geometry.length) {
      L.polyline(d.geometry, { color: d.estimated ? '#f79009' : '#1f5fae', weight: 5, opacity: .85, dashArray: d.estimated ? '8 8' : null }).addTo(S.routeLayer);
      pts = pts.concat(d.geometry);
    }
    L.circleMarker([d.olt.latitude, d.olt.longitude], { radius: 10, color: '#fff', weight: 3, fillColor: '#b42318', fillOpacity: 1 })
      .bindPopup('<b>' + esc(d.olt.hostname_olt) + '</b><br>' + esc(d.olt.ip_olt || '') + '<br>' + (d.olt.is_xgspon ? 'XGSPON' : 'non-XGSPON')).addTo(S.routeLayer);
    pts.push([d.olt.latitude, d.olt.longitude]);
    S.map.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 17 });
  }

  function render(d) {
    var r = d.result, o = d.olt, p = d.odp, ds = d.distance, h = '';
    if (d.estimated) h += '<div class="mo-warn">⚠ Layanan rute sedang tidak tersedia, sehingga jarak di bawah adalah <b>perkiraan</b> (garis lurus × faktor). Jangan dipakai sebagai keputusan final, terutama bila mendekati batas 8 km. Ulangi Measure beberapa saat lagi.</div>';
    var sub = ds.mode === 'via_odp' ? 'order→ODP ' + km(ds.order_to_odp_m) + ' + ODP→OLT ' + km(ds.odp_to_olt_m) : 'langsung order→OLT';
    h += '<div class="mo-tiles">' +
      '<div class="mo-tile ' + cls(r.assessment) + '"><span>Result Assessment</span><b>' + esc(r.assessment) + '</b><small>NTE: ' + esc(r.nte) + '</small></div>' +
      '<div class="mo-tile ' + cls(r.assessment) + '"><span>Type Design</span><b>' + esc(r.design) + '</b></div>' +
      '<div class="mg-kpi"><span>Jarak jalan ke OLT</span><b>' + km(ds.total_m) + '</b><span>' + esc(sub) + '</span></div>' +
      '<div class="mg-kpi"><span>Bandwidth</span><b>' + esc(fmtBw(d.input.bandwidthMbps)) + '</b><span>' + (d.input.orderNo ? 'Order ' + esc(d.input.orderNo) : '&nbsp;') + '</span></div></div>';
    h += '<div class="mg-grid2"><div class="mg-card"><h3>Jejak keputusan</h3><ol class="mo-steps">' +
      r.path.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ol>' +
      '<p class="mg-note">ODP: <b>' + esc(p.nama_alpro) + '</b> (available ' + fmtN(p.available) + ' dari capacity ' + fmtN(p.capacity) + '). Jarak tepat 8 km masih dihitung ONT.</p></div>' +
      '<div class="mg-card"><h3>OLT</h3><div class="mg-info" style="grid-template-columns:1fr 1fr">' +
      '<div><span>Hostname</span>' + esc(o.hostname_olt) + '</div><div><span>IP OLT</span>' + esc(o.ip_olt || '-') + '</div>' +
      '<div><span>Merk / Tipe</span>' + esc((o.merk || '-') + ' / ' + (o.tipe || '-')) + '</div><div><span>XGSPON</span>' + (o.is_xgspon ? 'Ya' : 'Tidak') + ' (flag: ' + esc(o.flag_xgspon || '-') + ')</div>' +
      '<div><span>District / Sub District</span>' + esc((o.district || '-') + ' / ' + (o.sub_district || '-')) + '</div><div><span>STO</span>' + esc(o.sto || '-') + '</div>' +
      '<div style="grid-column:1/-1"><span>Alamat / Gedung</span>' + esc((o.alamat || '-') + (o.nama_gedung ? ' — ' + o.nama_gedung : '')) + '</div></div></div></div>';
    $('moOut').innerHTML = h;
    $('moOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function loadHistory() {
    var box = $('moHist'); var r = await call('history', {});
    if (!r.success) { box.innerHTML = '<div class="mg-empty">' + esc(r.message || 'Gagal memuat.') + '</div>'; return; }
    box.innerHTML = r.rows.length ? '<div class="mg-wrap"><table class="mg-table"><thead><tr><th>Waktu</th><th>Order No</th><th>Koordinat order</th><th>Bandwidth</th><th>Hasil</th><th>Design</th><th class="num">Jarak</th><th>ODP</th><th>OLT</th></tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td>' + fmtDT(x.created_at) + '</td><td>' + esc(x.order_no || '-') + '</td><td class="mono">' + Number(x.lat).toFixed(5) + ', ' + Number(x.lon).toFixed(5) + '</td><td>' + esc(fmtBw(Number(x.bandwidth_mbps))) + '</td>' +
          '<td><span class="mg-badge ' + (x.assessment === 'TANPA JT' ? 'ok' : x.assessment === 'NEED JT (ODP)' ? 'Pending' : 'err') + '">' + esc(x.assessment) + '</span>' + (x.estimated ? ' <span class="mg-badge Pending">perkiraan</span>' : '') + '</td>' +
          '<td>' + esc(x.design) + '</td><td class="num">' + km(x.distance_m || 0) + '</td><td>' + esc(x.odp || '-') + '</td><td>' + esc(x.olt || '-') + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="mg-empty">Belum ada pengukuran.</div>';
  }

  window.MO = { enter: function () { build(); initMap(); loadHistory(); } };
})();
