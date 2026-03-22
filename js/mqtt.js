// ═══════════════════════════════════════════════════════════
// REALTIME — connection, device loading, message handling
//
// The browser never connects directly to MQTT.
// The bridge maintains the MQTT connection and writes every
// device message into the device_telemetry table.
// This file subscribes via Supabase Realtime and routes rows
// to handleMessage(), which dispatches to irrigation/filter handlers.
//
// Commands (zone on/off, backwash, etc.) insert into device_commands;
// the bridge picks them up within ~500ms and publishes to MQTT.
// ═══════════════════════════════════════════════════════════

let realtimeChannel  = null;
let realtimeConnected = false;
let filterOnline = false;
let lastFilterMsg = 0;
let lastIrrigMsg  = 0;
let eventLog = [];
let userDevices = [];
let filterDevice = null;
let irrigDevice  = null;
let supportSessionName = null;

// ── Device loading ────────────────────────────────────────

async function loadUserDevices() {
  const { data } = await sb.from('devices')
    .select('*')
    .eq('customer_id', currentUser.id)
    .eq('enabled', true)
    .order('sort_order');
  userDevices = data || [];
  filterDevice = userDevices.find(d => d.device_type === 'filter') || null;
  irrigDevice  = userDevices.find(d => d.device_type === 'irrigation') || null;
  addLog(`Devices loaded: filter=${filterDevice?.device_id||'none'} irrig=${irrigDevice?.device_id||'none'}`, 'system');

  const filterHeader = document.getElementById('filterHeader');
  if (filterHeader) filterHeader.style.display = filterDevice ? '' : 'none';
  const filterSection = document.getElementById('filterSection');
  if (filterSection) filterSection.style.display = filterDevice ? '' : 'none';
  const filterChartSection = document.getElementById('filterChartSection');
  if (filterChartSection) filterChartSection.style.display = filterDevice ? '' : 'none';
  const irrigSection = document.getElementById('irrigSection');
  if (irrigSection) irrigSection.style.display = irrigDevice ? '' : 'none';

  if (!filterDevice && !irrigDevice) {
    addLog('No devices assigned to your account yet.', 'alert');
  }
}

// ── Admin support session ─────────────────────────────────

async function connectToCustomerDevice(customerId, customerName) {
  const { data } = await sb.from('devices')
    .select('*').eq('customer_id', customerId).eq('enabled', true).order('sort_order');
  const devices = data || [];
  filterDevice = devices.find(d => d.device_type === 'filter') || null;
  irrigDevice  = devices.find(d => d.device_type === 'irrigation') || null;

  if (!filterDevice && !irrigDevice) {
    addLog(`No devices found for ${customerName}`, 'alert');
    return;
  }

  supportSessionName = customerName;
  sessionStorage.setItem('supportSession', JSON.stringify({ customerId, customerName }));

  // Reset zone state
  for (let i = 1; i <= 8; i++) {
    irrigZoneStates[i] = false;
    delete zoneStartTimes[i];
    delete zoneCommandedOnAt[i];
    delete zoneOffAt[i];
    if (zoneOffTimers[i]) { clearTimeout(zoneOffTimers[i]); delete zoneOffTimers[i]; }
  }
  zoneNames = {};

  const filterHeader = document.getElementById('filterHeader');
  if (filterHeader) filterHeader.style.display = filterDevice ? '' : 'none';
  const filterSection = document.getElementById('filterSection');
  if (filterSection) filterSection.style.display = filterDevice ? '' : 'none';
  const filterChartSection = document.getElementById('filterChartSection');
  if (filterChartSection) filterChartSection.style.display = filterDevice ? '' : 'none';
  const irrigSection = document.getElementById('irrigSection');
  if (irrigSection) irrigSection.style.display = irrigDevice ? '' : 'none';

  const banner = document.getElementById('supportBanner');
  if (banner) {
    banner.style.display = 'flex';
    document.getElementById('supportBannerName').textContent = customerName;
  }

  if (irrigDevice) irrigSetOnline(false);

  zoneNames = {};
  await loadZoneNames();
  await loadSchedules();
  await loadGroups();
  if (irrigDevice) refreshHistoryChart(168);

  connect();
  addLog(`Support session — viewing ${customerName}'s device`, 'system');
  showView('dashboard');
}

async function endSupportSession() {
  supportSessionName = null;
  sessionStorage.removeItem('supportSession');
  const banner = document.getElementById('supportBanner');
  if (banner) banner.style.display = 'none';
  await loadUserDevices();
  zoneNames = {};
  await loadZoneNames();
  await loadSchedules();
  await loadGroups();
  if (irrigDevice) { irrigSetOnline(false); refreshHistoryChart(168); }
  connect();
  addLog('Support session ended — back to your own devices', 'system');
}

// ── Realtime connection ───────────────────────────────────

function connect() {
  if (realtimeChannel) {
    sb.removeChannel(realtimeChannel);
    realtimeChannel = null;
    realtimeConnected = false;
  }

  const deviceIds = [filterDevice?.id, irrigDevice?.id].filter(Boolean);
  if (!deviceIds.length) {
    setConnBadge('', 'No devices');
    return;
  }

  setConnBadge('connecting', 'Connecting...');
  addLog('Connecting to Supabase Realtime...', 'system');

  realtimeChannel = sb.channel('telemetry-' + deviceIds.join('-'));

  for (const deviceId of deviceIds) {
    realtimeChannel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'device_telemetry', filter: `device_id=eq.${deviceId}` },
      ({ new: row }) => {
        try {
          handleMessage(row.topic, row.payload, { retain: false });
        } catch (e) {
          addLog('MSG ERROR: ' + e.message + ' topic:' + row.topic, 'alert');
        }
      }
    );
  }

  realtimeChannel.subscribe(status => {
    if (status === 'SUBSCRIBED') {
      realtimeConnected = true;
      setConnBadge('connected', 'Connected');
      addLog('Realtime connected', 'system');
      if (irrigDevice) {
        sendCommand(`${irrigDevice.mqtt_topic_base}/cmd/sync`, '');
        const now = Date.now();
        for (let z = 1; z <= 8; z++) {
          if (zoneOffAt[z] && zoneOffAt[z] > now) {
            const remainMin = Math.max(1, Math.round((zoneOffAt[z] - now) / 60000));
            sendCommand(
              `${irrigDevice.mqtt_topic_base}/zone/${z}/cmd`,
              JSON.stringify({ cmd: 'on', duration: remainMin })
            );
            addLog(`Zone ${z} re-issued after reconnect — ${remainMin} min remaining`, 'system');
          }
        }
      }
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      realtimeConnected = false;
      setConnBadge('error', 'Connection error');
      addLog('Realtime error: ' + status, 'alert');
    } else if (status === 'CLOSED') {
      realtimeConnected = false;
      setConnBadge('', 'Disconnected');
    }
  });

  document.addEventListener('visibilitychange', _onVisibilityChange, { once: true });
}

function _onVisibilityChange() {
  if (document.visibilityState === 'visible' && !realtimeConnected && (filterDevice || irrigDevice)) {
    addLog('Tab visible — reconnecting...', 'system');
    connect();
  }
}

// ── Send a command to a device via the device_commands table ──

async function sendCommand(topic, payload) {
  const device =
    (filterDevice && topic.startsWith(filterDevice.mqtt_topic_base)) ? filterDevice :
    (irrigDevice  && topic.startsWith(irrigDevice.mqtt_topic_base))  ? irrigDevice  :
    null;
  if (!device) return;

  const { error } = await sb.from('device_commands').insert({
    device_id: device.id,
    topic,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
  });
  if (error) addLog('Command failed: ' + error.message, 'alert');
}

// Backwash commands (filter) — called from HTML buttons
function mqttCmd(cmd) {
  if (!filterDevice) return;
  sendCommand(`${filterDevice.mqtt_topic_base}/backwash/${cmd}`, '');
  addLog('Command sent: backwash/' + cmd, 'system');
}

// ── Message router ────────────────────────────────────────

function handleMessage(topic, data, packet) {
  const ft = filterDevice?.mqtt_topic_base || '__none__';
  const it = irrigDevice?.mqtt_topic_base  || '__none__';
  if (packet?.retain && it !== '__none__' && topic.startsWith(`${it}/zone/`) && topic.endsWith('/state')) return;

  if (topic === `${ft}/status`) { setFilterOnline(!!data.online, data); }
  else if (topic === `${ft}/pressure`) {
    lastFilterMsg = Date.now(); setFilterOnline(true);
    updatePSI('inletVal',  'inletBar',  data.inlet_psi,  100);
    updatePSI('outletVal', 'outletBar', data.outlet_psi, 100);
    const diff   = data.differential_psi;
    const diffEl = document.getElementById('diffVal');
    if (diffEl) {
      diffEl.textContent = diff !== undefined ? diff.toFixed(1) : '—';
      diffEl.className   = 'card-value ' + (diff >= 8 ? 'crit' : diff >= 5 ? 'warn' : 'good');
    }
    const diffBar  = document.getElementById('diffBar');
    if (diffBar) {
      const diffPct  = Math.min(100, (diff / 10) * 100);
      diffBar.style.width = diffPct + '%';
      diffBar.className   = 'card-bar-fill ' + (diff >= 8 ? 'crit' : diff >= 5 ? 'warn' : '');
    }
    addChartPoint(data.inlet_psi, data.outlet_psi, data.differential_psi);
  } else if (topic === `${ft}/backwash/state`) {
    const state = data.state || '—';
    const pill  = document.getElementById('statePill');
    if (pill) { pill.textContent = state; pill.className = 'state-pill ' + state; }
    const elapsedEl = document.getElementById('elapsed');
    if (elapsedEl) elapsedEl.textContent = (state === 'BACKWASHING' || state === 'RECOVERING') ? (data.elapsed_sec + 's') : '—';
    const lastBWEl = document.getElementById('lastBW');
    if (lastBWEl) lastBWEl.textContent = data.last_complete_ago_sec != null ? fmtAgo(data.last_complete_ago_sec) : 'never';
    const active = ['TRIGGERED','BACKWASHING','RECOVERING'].includes(state);
    const btnStart = document.getElementById('btnStart');
    const btnStop  = document.getElementById('btnStop');
    if (btnStart) btnStart.disabled = active;
    if (btnStop)  btnStop.disabled  = !active;
    const fb = document.getElementById('faultBanner');
    if (fb) {
      if (state === 'FAULT') {
        fb.classList.add('visible');
        const fr = document.getElementById('faultReason');
        if (fr) fr.textContent = data.fault_reason || '—';
      } else {
        fb.classList.remove('visible');
      }
    }
  } else if (topic === `${ft}/alerts`) { addLog(`ALERT [${data.code}]: ${data.message}`, 'alert'); }
  else if (topic === `${it}/status`) {
    lastIrrigMsg = Date.now();
    const badge = document.getElementById('irrigBadge');
    if (badge) { badge.textContent = 'online'; badge.className = 'board-status online'; }
    const btnAllOff = document.getElementById('btnAllOff');
    if (btnAllOff) btnAllOff.disabled = false;
    const psi = parseFloat(data.supply_psi !== undefined ? data.supply_psi : (data.supplyPsi || 0));
    const supplyVal = document.getElementById('irrigSupplyVal');
    if (supplyVal) supplyVal.textContent = psi.toFixed(1);
    const supplyBar = document.getElementById('irrigSupplyBar');
    if (supplyBar) supplyBar.style.width = Math.min(100, (psi/100)*100) + '%';
    irrigSetOnline(true);
    if (Array.isArray(data.zones)) irrigRenderZones(data.zones);
  } else if (it !== '__none__' && topic.startsWith(`${it}/zone/`) && topic.endsWith('/state')) {
    const parts   = topic.split('/');
    const zoneNum = parseInt(parts[parts.length - 2]);
    irrigUpdateZoneCard(zoneNum, data);
  } else if (topic === `${it}/alert`) { addLog(`IRRIGATION ALERT: ${data.message || JSON.stringify(data)}`, 'alert'); }
}

// ── UI helpers ────────────────────────────────────────────

function updatePSI(valId, barId, val, max) {
  const valEl = document.getElementById(valId);
  const bar   = document.getElementById(barId);
  if (valEl) valEl.textContent = val !== undefined ? val.toFixed(1) : '—';
  if (bar) {
    const pct = Math.min(100, (val / max) * 100);
    bar.style.width = pct + '%';
    bar.className   = 'card-bar-fill' + (pct >= 90 ? ' crit' : pct >= 70 ? ' warn' : '');
  }
}
function setConnBadge(cls, text) {
  const b = document.getElementById('connBadge');
  if (b) b.className = 'conn-badge ' + cls;
  const t = document.getElementById('connText');
  if (t) t.textContent = text;
}
function setFilterOnline(online, data) {
  filterOnline = online;
  const statusEl  = document.getElementById('filterStatus');
  const overlay   = document.getElementById('filterOffline');
  const uptimeEl  = document.getElementById('filterUptime');
  if (online) {
    if (statusEl) { statusEl.textContent = 'online'; statusEl.className = 'board-status online'; }
    if (overlay)  overlay.classList.remove('visible');
    if (uptimeEl && data?.uptime_sec !== undefined) { uptimeEl.textContent = 'up ' + fmtUptime(data.uptime_sec); uptimeEl.style.display = ''; }
  } else {
    if (statusEl) { statusEl.textContent = 'offline'; statusEl.className = 'board-status offline'; }
    if (overlay)  overlay.classList.add('visible');
    if (uptimeEl) uptimeEl.style.display = 'none';
  }
}
function fmtAgo(sec)    { if (sec == null) return 'never'; if (sec < 60) return sec + 's ago'; if (sec < 3600) return Math.floor(sec/60) + 'm ago'; return Math.floor(sec/3600) + 'h ago'; }
function fmtUptime(sec) { return `${Math.floor(sec/3600)}h ${Math.floor((sec%3600)/60)}m`; }
function addLog(msg, type) { eventLog.unshift({ time: new Date().toLocaleTimeString(), msg, type: type||'info' }); if (eventLog.length > 50) eventLog.pop(); renderLog(); }
function renderLog() {
  const ul = document.getElementById('logList');
  if (!ul) return;
  if (!eventLog.length) { ul.innerHTML = '<li><span class="log-empty">No events yet</span></li>'; return; }
  ul.innerHTML = eventLog.map(e => `<li class="${e.type}"><span class="log-time">${e.time}</span><span class="log-msg">${e.msg}</span></li>`).join('');
}
function clearLog() { eventLog = []; renderLog(); }

// ── Timers ────────────────────────────────────────────────
setInterval(() => {
  const ft = document.getElementById('footerTime');
  if (ft) ft.textContent = new Date().toLocaleString();
}, 1000);
setInterval(() => { if (filterOnline && lastFilterMsg > 0 && Date.now() - lastFilterMsg > 15000) { setFilterOnline(false); addLog('Filter board — no data for 15s', 'alert'); } }, 5000);
setInterval(() => { if (lastIrrigMsg > 0 && Date.now() - lastIrrigMsg > 60000) { lastIrrigMsg = 0; irrigSetOnline(false); addLog('Irrigation board — no data for 60s', 'alert'); } }, 15000);
