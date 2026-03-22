// ═══════════════════════════════════════════════════════════
// IRRIGATION — zone state, zone names, MQTT commands
// ═══════════════════════════════════════════════════════════
let irrigZoneStates   = {}; // zoneNum -> true/false
let zoneNames         = {}; // zoneNum -> name string
let zoneStartTimes    = {}; // zoneNum -> Date when turned ON
let zoneOffTimers     = {}; // zoneNum -> setTimeout handle
let zoneOffAt         = {}; // zoneNum -> ms timestamp for auto-off
let zoneCommandedOnAt = {}; // zoneNum -> timestamp when last commanded ON

// Per-zone accent colors — one per zone (8 distinct), Precision Earth palette
const ZONE_COLORS = ['#17361d','#12629d','#d97706','#dc2626','#0d9488','#7c3aed','#ea580c','#be185d'];

async function loadZoneNames() {
  if (!irrigDevice) return;
  const { data } = await sb.from('zone_names')
    .select('zone_num, name')
    .eq('device_id', irrigDevice.id)
    .eq('customer_id', irrigDevice.customer_id);
  if (data) data.forEach(r => { zoneNames[r.zone_num] = r.name; });
  refreshZoneNameDisplays();
}

function refreshZoneNameDisplays() {
  for (let i = 1; i <= 8; i++) {
    const name = zoneNames[i] || 'Zone ' + i;
    const el  = document.getElementById('zoneName' + i);
    const inp = document.getElementById('zoneNameInput' + i);
    if (el)  el.textContent = name;
    if (inp) inp.value = name;
    const opt = document.querySelector(`#zoneActivityFilter option[value="${i}"]`);
    if (opt) opt.textContent = name;
  }
}

async function saveZoneName(zoneNum, name) {
  const { error } = await sb.from('zone_names').upsert({
    device_id: irrigDevice.id,
    customer_id: irrigDevice.customer_id,
    zone_num: zoneNum,
    name: name
  }, { onConflict: 'device_id,customer_id,zone_num' });
  if (error) { addLog('Zone name save failed: ' + error.message, 'alert'); return; }
  zoneNames[zoneNum] = name;
}

function irrigSetOnline(online) {
  const badge   = document.getElementById('irrigBadge');
  const grid    = document.getElementById('zoneGrid');
  const offline = document.getElementById('irrigOffline');
  const allOff  = document.getElementById('btnAllOff');
  if (!document.getElementById('zoneCard1')) buildZoneCards();
  if (grid)    grid.style.display = 'grid';
  if (offline) offline.style.display = 'none';
  if (online) {
    if (badge) { badge.textContent = 'online'; badge.className = 'board-status online'; }
    if (allOff) allOff.disabled = false;
    for (let i = 1; i <= 8; i++) {
      const btn  = document.getElementById('zoneBtn' + i);
      const card = document.getElementById('zoneCard' + i);
      if (btn)  btn.disabled = false;
      if (card) card.classList.remove('offline-zone');
    }
  } else {
    if (badge) { badge.textContent = 'offline'; badge.className = 'board-status offline'; }
    if (allOff) allOff.disabled = true;
    for (let i = 1; i <= 8; i++) {
      const btn  = document.getElementById('zoneBtn' + i);
      const card = document.getElementById('zoneCard' + i);
      if (btn)  btn.disabled = true;
      if (card) card.classList.add('offline-zone');
    }
  }
}

function buildZoneCards() {
  const grid = document.getElementById('zoneGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 1; i <= 8; i++) {
    const name  = zoneNames[i] || 'Zone ' + i;
    const color = ZONE_COLORS[i - 1];
    const card  = document.createElement('div');
    card.id = 'zoneCard' + i;
    card.className = 'zone-card';
    card.innerHTML = `
      <div id="zoneBar${i}" style="position:absolute;top:0;left:0;width:4px;height:100%;background:#c2c8bf;transition:background .2s"></div>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
        <div style="flex:1;min-width:0">
          <span style="font-family:'Public Sans',sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;color:#737971;display:block;margin-bottom:4px">Zone ${String(i).padStart(2,'0')}</span>
          <div id="zoneName${i}" style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:#1a1c1a;cursor:pointer;line-height:1.2" ondblclick="startRename(${i})" title="Double-click to rename">${esc(name)}</div>
          <input id="zoneNameInput${i}" value="${esc(name)}" style="display:none;font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:#1a1c1a;border:none;border-bottom:2px solid #17361d;background:transparent;width:100%;outline:none"
            onblur="finishRename(${i})"
            onkeydown="if(event.key==='Enter')finishRename(${i});if(event.key==='Escape')cancelRename(${i})">
        </div>
        <div id="zoneStatus${i}" style="background:#e8e8e5;color:#737971;padding:4px 10px;border-radius:99px;font-family:'Public Sans',sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;flex-shrink:0;margin-left:8px;transition:all .2s" onclick="openScheduleModal(${i})">
          <span class="material-symbols-outlined" style="font-size:14px">schedule</span> Idle
        </div>
      </div>
      <div style="display:flex;align-items:flex-end;justify-content:space-between;margin-top:auto">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <input id="zoneDur${i}" type="number" min="1" max="1440" value="30"
              style="width:56px;background:#e8e8e5;border:none;border-bottom:2px solid #737971;padding:4px 8px;font-family:'Space Grotesk',sans-serif;font-size:16px;font-weight:700;text-align:center;outline:none;transition:.2s"
              onfocus="this.style.borderBottomColor='#17361d'"
              onblur="this.style.borderBottomColor='#737971'"
              onclick="event.stopPropagation()" oninput="event.stopPropagation()">
            <span style="font-family:'Public Sans',sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;color:#737971">min</span>
          </div>
          <div style="display:flex;gap:4px;margin-bottom:10px">
            <button style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;background:#e8e8e5;color:#737971;border:none;cursor:pointer" onclick="setZoneDur(${i},15);event.stopPropagation()">15m</button>
            <button style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;background:#e8e8e5;color:#737971;border:none;cursor:pointer" onclick="setZoneDur(${i},30);event.stopPropagation()">30m</button>
            <button style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;background:#e8e8e5;color:#737971;border:none;cursor:pointer" onclick="setZoneDur(${i},60);event.stopPropagation()">1h</button>
            <button style="font-size:9px;font-weight:700;text-transform:uppercase;padding:2px 6px;background:#e8e8e5;color:#737971;border:none;cursor:pointer" onclick="setZoneDur(${i},120);event.stopPropagation()">2h</button>
          </div>
          <div id="zoneMiniTimeline${i}" class="zone-mini-timeline"></div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;margin-left:12px">
          <span style="font-family:'Public Sans',sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.15em;color:#737971">Water Now</span>
          <label style="position:relative;display:inline-flex;align-items:center;cursor:pointer" onclick="toggleZone(${i});event.preventDefault()">
            <input type="checkbox" id="zoneBtn${i}" style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none">
            <div id="zoneToggleTrack${i}" style="width:44px;height:24px;background:#e8e8e5;border-radius:99px;position:relative;transition:background .2s">
              <div id="zoneToggleThumb${i}" style="position:absolute;top:2px;left:2px;width:20px;height:20px;background:white;border-radius:50%;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></div>
            </div>
          </label>
        </div>
      </div>`;
    grid.appendChild(card);
  }
  for (let i = 1; i <= 8; i++) setZoneState(i, !!irrigZoneStates[i]);
}

function setZoneDur(zoneNum, min) {
  const inp = document.getElementById('zoneDur' + zoneNum);
  if (inp) inp.value = min;
}

function toggleZone(zoneNum) {
  if (irrigZoneStates[zoneNum]) {
    irrigZoneOff(zoneNum);
  } else {
    irrigZoneOn(zoneNum);
  }
}

function setZoneState(zoneNum, on) {
  const wasOn = irrigZoneStates[zoneNum];
  irrigZoneStates[zoneNum] = on;

  if (!on && wasOn && irrigDevice && currentUser) {
    if (typeof refreshHistoryChart === 'function') refreshHistoryChart();
  }

  const card   = document.getElementById('zoneCard' + zoneNum);
  const toggle = document.getElementById('zoneBtn' + zoneNum);
  const track  = document.getElementById('zoneToggleTrack' + zoneNum);
  const thumb  = document.getElementById('zoneToggleThumb' + zoneNum);
  const status = document.getElementById('zoneStatus' + zoneNum);
  const bar    = document.getElementById('zoneBar' + zoneNum);
  if (!card) return;

  const color = ZONE_COLORS[zoneNum - 1];

  if (on) {
    card.classList.add('active');
    if (bar)    bar.style.background = color;
    if (toggle) toggle.checked = true;
    if (track)  track.style.background = color;
    if (thumb)  thumb.style.left = '22px';
    if (status) {
      status.style.background = '#c7ecc7';
      status.style.color = '#2f4e33';
      status.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">water_drop</span> Active';
    }
  } else {
    card.classList.remove('active');
    if (bar)    bar.style.background = '#c2c8bf';
    if (toggle) toggle.checked = false;
    if (track)  track.style.background = '#e8e8e5';
    if (thumb)  thumb.style.left = '2px';
    if (status) {
      status.style.background = '#e8e8e5';
      status.style.color = '#737971';
      status.innerHTML = '<span class="material-symbols-outlined" style="font-size:14px">schedule</span> Idle';
    }
  }

  // Update active zone count on dashboard
  const activeCount = Object.values(irrigZoneStates).filter(v => v).length;
  const anyOn = activeCount > 0;
  const dashActive = document.getElementById('activeZonesVal');
  if (dashActive) dashActive.textContent = String(activeCount).padStart(2,'0');

  const allOffBtn = document.getElementById('btnAllOff');
  if (allOffBtn) allOffBtn.disabled = !anyOn;
}

function startRename(zoneNum) {
  document.getElementById('zoneName' + zoneNum).style.display = 'none';
  const inp = document.getElementById('zoneNameInput' + zoneNum);
  inp.style.display = 'block';
  inp.focus(); inp.select();
}
async function finishRename(zoneNum) {
  const inp = document.getElementById('zoneNameInput' + zoneNum);
  const newName = inp.value.trim() || ('Zone ' + zoneNum);
  inp.style.display = 'none';
  document.getElementById('zoneName' + zoneNum).style.display = '';
  document.getElementById('zoneName' + zoneNum).textContent = newName;
  await saveZoneName(zoneNum, newName);
  addLog(`Zone ${zoneNum} renamed to "${newName}"`, 'system');
}
function cancelRename(zoneNum) {
  document.getElementById('zoneNameInput' + zoneNum).style.display = 'none';
  document.getElementById('zoneName' + zoneNum).style.display = '';
}

function irrigRenderZones(zones) {
  irrigSetOnline(true);
  zones.forEach(z => {
    const zoneNum = z.id ?? (zones.indexOf(z) + 1);
    const on = z.on === true || z.state === 'manual' || z.state === 'schedule';
    if (!on && zoneOffTimers[zoneNum]) return;
    setZoneState(zoneNum, !!on);
  });
}

function irrigUpdateZoneCard(zoneNum, data) {
  const on = data.on === true || data.manual_on || data.schedule_active || data.state === 'on' || data.state === 'manual' || data.state === 'schedule';
  if (!on && zoneCommandedOnAt[zoneNum] && (Date.now() - zoneCommandedOnAt[zoneNum]) < 4000) return;
  setZoneState(zoneNum, !!on);
}

function irrigZoneOn(zoneNum, durationMin) {
  if (!irrigDevice) return;
  const durInput = document.getElementById('zoneDur' + zoneNum);
  const duration = durationMin ? Math.max(1, Math.round(durationMin)) : Math.max(1, parseInt(durInput?.value) || 30);
  sendCommand(`${irrigDevice.mqtt_topic_base}/zone/${zoneNum}/cmd`, JSON.stringify({ cmd: 'on', duration }));
  zoneCommandedOnAt[zoneNum] = Date.now();
  setZoneState(zoneNum, true);
  if (zoneOffTimers[zoneNum]) clearTimeout(zoneOffTimers[zoneNum]);
  zoneOffAt[zoneNum] = Date.now() + duration * 60000;
  zoneOffTimers[zoneNum] = setTimeout(() => {
    delete zoneOffTimers[zoneNum];
    delete zoneOffAt[zoneNum];
    irrigZoneOff(zoneNum);
  }, duration * 60000);
  addLog(`Zone ${zoneNum} ON — ${duration} min`, 'system');
}
function irrigZoneOff(zoneNum) {
  if (zoneOffTimers[zoneNum]) { clearTimeout(zoneOffTimers[zoneNum]); delete zoneOffTimers[zoneNum]; }
  delete zoneOffAt[zoneNum];
  delete zoneCommandedOnAt[zoneNum];
  setZoneState(zoneNum, false);
  if (irrigDevice) {
    sendCommand(`${irrigDevice.mqtt_topic_base}/zone/${zoneNum}/cmd`, JSON.stringify({ cmd: 'off' }));
  }
  addLog(`Zone ${zoneNum} OFF`, 'system');
}
function irrigAllOff() {
  if (!irrigDevice) return;
  sendCommand(`${irrigDevice.mqtt_topic_base}/all/off`, '');
  for (let i = 1; i <= 8; i++) {
    if (zoneOffTimers[i]) { clearTimeout(zoneOffTimers[i]); delete zoneOffTimers[i]; }
    delete zoneOffAt[i];
    delete zoneCommandedOnAt[i];
    setZoneState(i, false);
  }
  addLog('All zones OFF', 'system');
}

async function logZoneHistory(zoneNum, startedAt, endedAt, duration_min) {
  if (!irrigDevice || !currentUser) return;
  const { error } = await sb.from('zone_history').insert({
    device_id:    irrigDevice.id,
    customer_id:  irrigDevice.customer_id,
    zone_num:     zoneNum,
    started_at:   startedAt.toISOString(),
    ended_at:     endedAt.toISOString(),
    duration_min
  });
  if (error) { addLog('Zone history save failed: ' + error.message, 'alert'); return; }
  if (typeof refreshHistoryChart === 'function') refreshHistoryChart();
}
