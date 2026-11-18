/* DIGIMON — Measure OLO. Dimuat setelah script utama index.html & management.js.
   Peta (Leaflet/OSM) di atas, hasil pengukuran di bawah. Perhitungan dilakukan Edge Function "measure". */
(function () {
  'use strict';
  // Sesuaikan slug di akhir URL dengan Endpoint URL fungsi "measure" di dashboard Supabase.
  var MEASURE_URL = 'https://lhnwbupbqnewhlzdobcr.supabase.co/functions/v1/measure';
  var DEFAULT_CENTER = [-7.25, 112.75], DEFAULT_ZOOM = 11;   // Jawa Timur

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function notify(type, msg, title) { if (typeof showAppNotif === 'function') showAppNotif(type, msg, title); else alert(msg); }
  function fmtN(n, d) { return Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d || 0 }); }
  function fmtDT(iso) {
    var d = new Date(iso); if (isNaN(d)) return '-';
    return d.toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtBw(mbps) { return mbps >= 1000 ? fmtN(mbps / 1000, 2) + ' Gbps' : fmtN(mbps, 0) + ' Mbps'; }
  function cls(a) { return a === 'TANPA JT' ? 'mo-c-no' : a === 'NEED JT (ODP)' ? 'mo-c-odp' : 'mo-c-otb'; }

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

  var S = { built: false, map: null, pin: null, layer: null, busy: false };

  function build() {
    if (S.built) return; S.built = true;
    $('page-measure-olo').innerHTML =
      '<div class="mg-root mo-root">' +
        '<div class="mg-card">' +
          '<div class="mo-form">' +
            '<div class="mo-f"><label for="moLabel">Nama / ID pelanggan (opsional)</label><input class="mg-input" id="moLabel" maxlength="120" autocomplete="off"></div>' +
            '<div class="mo-f"><label for="moBw">Bandwidth layanan OLO</label><div class="mo-bw"><input class="mg-input" id="moBw" type="number" min="0" step="any" value="100" inputmode="decimal"><select class="mg-select" id="moUnit"><option>Mbps</option><option>Gbps</option></select></div></div>' +
            '<div class="mo-f"><label for="moLat">Latitude</label><input class="mg-input" id="moLat" placeholder="-7.2756" inputmode="decimal" autocomplete="off"></div>' +
            '<div class="mo-f"><label for="moLon">Longitude</label><input class="mg-input" id="moLon" placeholder="112.7482" inputmode="decimal" autocomplete="off"></div>' +
            '<div class="mo-f mo-btns"><button class="mg-btn" id="moLoc" type="button">Lokasi saya</button><button class="mg-btn pri" id="moGo" type="button">Ukur &amp; Assess</button></div>' +
          '</div>' +
          '<p class="mg-note">Klik peta atau geser pin untuk memilih titik pelanggan. Koordinat dari Google Maps (mis. <b>-7.2756, 112.7482</b>) bisa ditempel langsung ke kolom Latitude.</p>' +
          '<div id="moMap" class="mo-map"><div class="mo-empty-map">Memuat peta…</div></div>' +
        '</div>' +
        '<div id="moOut"><div class="mg-card"><div class="mg-empty">Pilih titik pelanggan dan bandwidth, lalu klik <b>Ukur &amp; Assess</b>.</div></div></div>' +
        '<div class="mg-card"><h3>Riwayat pengukuran saya</h3><div id="moHist"><div class="mg-empty">Memuat…</div></div></div>' +
      '</div>';

    $('moGo').onclick = run;
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
      S.pin = L.marker([lat, lon], { draggable: true, title: 'Lokasi pelanggan' }).addTo(S.map);
      S.pin.on('dragend', function () { var p = S.pin.getLatLng(); setPoint(p.lat, p.lng, false); });
    } else S.pin.setLatLng([lat, lon]);
    if (pan) S.map.setView([lat, lon], Math.max(S.map.getZoom(), 15));
  }
  function syncPinFromInputs(pan) {
    var lat = parseFloat($('moLat').value), lon = parseFloat($('moLon').value);
    if (validPoint(lat, lon)) setPoint(lat, lon, pan);
  }

  function initMap() {
    if (S.map) { setTimeout(function () { S.map.invalidateSize(); }, 150); return Promise.resolve(); }
    return berandaEnsureLeaflet_().then(function () {
      $('moMap').innerHTML = '';
      S.map = L.map('moMap', { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(S.map);
      S.layer = L.layerGroup().addTo(S.map);
      S.map.on('click', function (e) { setPoint(e.latlng.lat, e.latlng.lng, false); });
      syncPinFromInputs(false);
      setTimeout(function () { S.map.invalidateSize(); }, 150);
    }).catch(function () { $('moMap').innerHTML = '<div class="mo-empty-map">Peta gagal dimuat. Muat ulang halaman. Pengukuran tetap bisa dengan mengisi koordinat manual.</div>'; });
  }

  function dot(color, r, title) { return { radius: r, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1, title: title }; }
  function drawResult(d) {
    if (!S.map) return;
    S.layer.clearLayers();
    var pts = [[d.input.lat, d.input.lon]];
    if (d.olt.geometry && d.olt.geometry.length) { L.polyline(d.olt.geometry, { color: d.estimated ? '#f79009' : '#1f5fae', weight: 5, opacity: .85, dashArray: d.estimated ? '8 8' : null }).addTo(S.layer); pts = pts.concat(d.olt.geometry); }
    d.olts.forEach(function (o) {
      var chosen = o.id === d.olt.id;
      L.circleMarker([o.latitude, o.longitude], dot(chosen ? '#b42318' : '#98a2b3', chosen ? 10 : 7))
        .bindPopup('<b>' + esc(o.hostname_olt) + '</b><br>' + esc(o.sto || '') + (o.is_xgspon ? ' · XGSPON' : ' · non-XGSPON') + '<br>' + (o.road_m != null ? fmtN(o.road_m / 1000, 2) + ' km (jalan)' : 'rute tidak tersedia')).addTo(S.layer);
      pts.push([o.latitude, o.longitude]);
    });
    d.odp.items.forEach(function (a) {
      L.circleMarker([a.latitude, a.longitude], dot(Number(a.available) > 0 ? '#12b76a' : '#667085', 6))
        .bindPopup('<b>' + esc(a.nama_alpro) + '</b><br>Available: ' + fmtN(a.available) + ' / Capacity: ' + fmtN(a.capacity) + '<br>' + fmtN(a.dist_m) + ' m dari titik').addTo(S.layer);
      pts.push([a.latitude, a.longitude]);
    });
    S.map.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 17 });
  }

  function render(d) {
    var r = d.result, o = d.olt;
    var h = '';
    if (d.estimated) h += '<div class="mo-warn">⚠ Layanan rute sedang tidak tersedia, sehingga jarak di bawah adalah <b>perkiraan</b> (garis lurus × faktor). Jangan dipakai sebagai keputusan final, terutama bila mendekati batas 8 km. Ulangi pengukuran beberapa saat lagi.</div>';
    h += '<div class="mo-tiles">' +
      '<div class="mo-tile ' + cls(r.assessment) + '"><span>Result Assessment</span><b>' + esc(r.assessment) + '</b><small>NTE: ' + esc(r.nte) + '</small></div>' +
      '<div class="mo-tile ' + cls(r.assessment) + '"><span>Type Design</span><b>' + esc(r.design) + '</b></div>' +
      '<div class="mg-kpi"><span>Jarak jalan ke OLT</span><b>' + fmtN(o.road_km, 2) + ' km</b><span>garis lurus ' + fmtN(o.straight_m / 1000, 2) + ' km</span></div>' +
      '<div class="mg-kpi"><span>Bandwidth</span><b>' + esc(fmtBw(d.input.bandwidthMbps)) + '</b><span>' + (d.input.label ? esc(d.input.label) : '&nbsp;') + '</span></div></div>';

    h += '<div class="mg-grid2"><div class="mg-card"><h3>Jejak keputusan</h3><ol class="mo-steps">' +
      r.path.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ol>' +
      '<p class="mg-note">OLT acuan: <b>' + esc(o.hostname_olt) + '</b> (OLT terdekat berdasarkan jarak jalan terpendek). Jarak tepat 8 km masih dihitung ONT.</p></div>';

    h += '<div class="mg-card"><h3>OLT acuan</h3><div class="mg-info" style="grid-template-columns:1fr 1fr">' +
      '<div><span>Hostname</span>' + esc(o.hostname_olt) + '</div><div><span>IP OLT</span>' + esc(o.ip_olt || '-') + '</div>' +
      '<div><span>Merk / Tipe</span>' + esc((o.merk || '-') + ' / ' + (o.tipe || '-')) + '</div><div><span>XGSPON</span>' + (o.is_xgspon ? 'Ya' : 'Tidak') + '</div>' +
      '<div><span>District / Sub District</span>' + esc((o.district || '-') + ' / ' + (o.sub_district || '-')) + '</div><div><span>STO</span>' + esc(o.sto || '-') + '</div>' +
      '<div style="grid-column:1/-1"><span>Alamat / Gedung</span>' + esc((o.alamat || '-') + (o.nama_gedung ? ' — ' + o.nama_gedung : '')) + '</div></div></div></div>';

    h += '<div class="mg-card"><h3>Kandidat OLT</h3><div class="mg-wrap"><table class="mg-table"><thead><tr><th>Hostname</th><th>STO</th><th>Tipe</th><th>XGSPON</th><th class="num">Jarak jalan</th><th class="num">Garis lurus</th><th></th></tr></thead><tbody>' +
      d.olts.map(function (x) {
        return '<tr><td><b>' + esc(x.hostname_olt) + '</b></td><td>' + esc(x.sto || '-') + '</td><td>' + esc(x.tipe || '-') + '</td><td>' + (x.is_xgspon ? 'Ya' : 'Tidak') + '</td>' +
          '<td class="num">' + (x.road_m != null ? fmtN(x.road_m / 1000, 2) + ' km' : '-') + '</td><td class="num">' + fmtN(x.straight_m / 1000, 2) + ' km</td><td>' + (x.id === o.id ? '<span class="mg-badge adm">acuan</span>' : '') + '</td></tr>'; }).join('') +
      '</tbody></table></div></div>';

    var odp = d.odp;
    h += '<div class="mg-card"><h3>Port ODP dalam radius ' + fmtN(odp.radius_m) + ' m &nbsp;' + (odp.ready ? '<span class="mg-badge ok">READY</span>' : '<span class="mg-badge err">TIDAK READY</span>') + '</h3>';
    if (!odp.items.length) h += '<div class="mg-empty">Tidak ada ODP dalam radius ini, sehingga dianggap tidak ready.</div>';
    else {
      h += '<div class="mg-wrap"><table class="mg-table"><thead><tr><th>Nama Alpro</th><th>STO</th><th class="num">Jarak</th><th class="num">Used</th><th class="num">Available</th><th class="num">Reservation</th><th class="num">Capacity</th><th>Status</th><th class="num">%</th></tr></thead><tbody>' +
        odp.items.map(function (a) {
          return '<tr><td><b>' + esc(a.nama_alpro) + '</b></td><td>' + esc(a.sto || '-') + '</td><td class="num">' + fmtN(a.dist_m) + ' m</td><td class="num">' + fmtN(a.used) + '</td>' +
            '<td class="num"><span class="mg-badge ' + (Number(a.available) > 0 ? 'ok' : 'err') + '">' + fmtN(a.available) + '</span></td><td class="num">' + fmtN(a.reservation) + '</td><td class="num">' + fmtN(a.capacity) + '</td>' +
            '<td>' + esc(a.status_occupancy || '-') + '</td><td class="num">' + esc(a.percentage_occupancy || '-') + '</td></tr>'; }).join('') + '</tbody></table></div>';
      if (odp.chosen && odp.chosen.sto && o.sto && String(odp.chosen.sto).toUpperCase() !== String(o.sto).toUpperCase())
        h += '<p class="mg-note">Catatan: ODP terdekat berada di STO <b>' + esc(odp.chosen.sto) + '</b>, sedangkan OLT acuan di STO <b>' + esc(o.sto) + '</b>. Pastikan keduanya memang satu jalur layanan.</p>';
    }
    h += '</div>';
    $('moOut').innerHTML = h;
    $('moOut').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  async function run() {
    if (S.busy) return;
    var lat = parseFloat($('moLat').value), lon = parseFloat($('moLon').value), bw = parseFloat($('moBw').value);
    if (!validPoint(lat, lon)) return notify('warning', 'Pilih titik pelanggan di peta atau isi Latitude dan Longitude.', 'Measure OLO');
    if (!(bw > 0)) return notify('warning', 'Isi bandwidth dengan angka lebih dari 0.', 'Measure OLO');
    S.busy = true; var btn = $('moGo'); btn.disabled = true; btn.textContent = 'Mengukur…';
    $('moOut').innerHTML = '<div class="mg-card"><div class="mg-empty">Menghitung jarak jalan dan mencari OLT/ODP terdekat…</div></div>';
    var r = await call('assess', { lat: lat, lon: lon, bandwidth: bw, unit: $('moUnit').value, label: $('moLabel').value.trim() });
    S.busy = false; btn.disabled = false; btn.textContent = 'Ukur & Assess';
    if (!r.success) { $('moOut').innerHTML = '<div class="mg-card"><div class="mg-empty">' + esc(r.message || 'Pengukuran gagal.') + '</div></div>'; return notify('error', r.message || 'Pengukuran gagal.', 'Measure OLO'); }
    render(r); drawResult(r); loadHistory();
  }

  async function loadHistory() {
    var box = $('moHist'); var r = await call('history', {});
    if (!r.success) { box.innerHTML = '<div class="mg-empty">' + esc(r.message || 'Gagal memuat.') + '</div>'; return; }
    box.innerHTML = r.rows.length ? '<div class="mg-wrap"><table class="mg-table"><thead><tr><th>Waktu</th><th>Pelanggan</th><th>Koordinat</th><th>Bandwidth</th><th>Hasil</th><th>Design</th><th class="num">Jarak</th><th>OLT</th></tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td>' + fmtDT(x.created_at) + '</td><td>' + esc(x.label || '-') + '</td><td class="mono">' + Number(x.lat).toFixed(5) + ', ' + Number(x.lon).toFixed(5) + '</td><td>' + esc(fmtBw(Number(x.bandwidth_mbps))) + '</td>' +
          '<td><span class="mg-badge ' + (x.assessment === 'TANPA JT' ? 'ok' : x.assessment === 'NEED JT (ODP)' ? 'Pending' : 'err') + '">' + esc(x.assessment) + '</span>' + (x.estimated ? ' <span class="mg-badge Pending">perkiraan</span>' : '') + '</td>' +
          '<td>' + esc(x.design) + '</td><td class="num">' + fmtN((x.distance_m || 0) / 1000, 2) + ' km</td><td>' + esc(x.olt || '-') + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<div class="mg-empty">Belum ada pengukuran.</div>';
  }

  window.MO = {
    enter: function () { build(); initMap(); loadHistory(); }
  };
})();
