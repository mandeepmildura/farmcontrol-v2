// ═══════════════════════════════════════════════════════════
// CHART — Plotly.js: pressure, gauge, zone board & history
// ═══════════════════════════════════════════════════════════
let chartRangeMin   = 15;
let pressureHistory = { times: [], inlet: [], outlet: [], diff: [] };
let customRangeActive = false;

const GAUGE_MAX = 120; // PSI max scale

let chartsInited = false;

function isDark() { return window.matchMedia('(prefers-color-scheme: dark)').matches; }

function pTheme() {
  const dark = isDark();
  return {
    bg:     'transparent',
    font:   dark ? '#7aaa7a' : '#5a7a5a',
    text:   dark ? '#e8f5e8' : '#0f1f0f',
    grid:   dark ? 'rgba(42,74,42,0.5)'   : 'rgba(184,212,184,0.7)',
    border: dark ? '#2a4a2a' : '#b8d4b8',
  };
}

const PLY_CFG  = { displayModeBar: false, responsive: true };
const PLY_FONT = 'Public Sans, sans-serif';

function baseLayout(height, extra) {
  const t = pTheme();
  return {
    paper_bgcolor: t.bg, plot_bgcolor: t.bg,
    height,
    font: { family: PLY_FONT, color: t.font, size: 10 },
    margin: { l: 48, r: 16, t: 10, b: 32, pad: 0 },
    ...extra
  };
}

// ── Init all charts ────────────────────────────────────────
async function initChart() {
  chartsInited = false;
  const t = pTheme();

  // ── PRESSURE AREA CHART ──────────────────────────────────
  if (document.getElementById('pressureChart')) {
    await Plotly.newPlot('pressureChart', [
      { name:'Inlet',        x:[], y:[], type:'scatter', mode:'lines', line:{ color:'#12629d', width:2, shape:'spline' }, fill:'tozeroy', fillcolor:'rgba(18,98,157,0.12)'  },
      { name:'Outlet',       x:[], y:[], type:'scatter', mode:'lines', line:{ color:'#17361d', width:2, shape:'spline' }, fill:'tozeroy', fillcolor:'rgba(23,54,29,0.10)'  },
      { name:'Differential', x:[], y:[], type:'scatter', mode:'lines', line:{ color:'#d97706', width:2, shape:'spline' }, fill:'tozeroy', fillcolor:'rgba(217,119,6,0.10)' }
    ], {
      ...baseLayout(260, { margin:{ l:50, r:16, t:24, b:36 } }),
      xaxis: { tickfont:{ size:9 }, gridcolor:t.grid, showgrid:true, zeroline:false },
      yaxis: { title:{ text:'PSI', font:{ size:10 } }, tickfont:{ size:9 }, gridcolor:t.grid, showgrid:true, zeroline:false },
      legend: { x:1, xanchor:'right', y:1.12, orientation:'h', font:{ size:10 }, bgcolor:'transparent' },
      hovermode: 'x unified',
      hoverlabel: { font:{ family:PLY_FONT, size:11 } },
    }, PLY_CFG);
  }

  // ── GAUGE ────────────────────────────────────────────────
  if (document.getElementById('gaugeChart')) {
    await Plotly.newPlot('gaugeChart', [{
      type: 'indicator', mode: 'gauge+number',
      value: 0,
      number: { suffix:' PSI', font:{ size:22, family:PLY_FONT, color:t.text } },
      gauge: {
        axis: { range:[0, GAUGE_MAX], nticks:7, tickfont:{ size:9 }, tickcolor:t.font },
        bar:  { color:'#17361d', thickness:0.28 },
        bgcolor: 'transparent', borderwidth: 0,
        steps: [
          { range:[0,  45], color:'rgba(23,54,29,0.10)' },
          { range:[45, 80], color:'rgba(217,119,6,0.10)' },
          { range:[80,120], color:'rgba(186,26,26,0.10)' }
        ],
        threshold: { line:{ color:'#ba1a1a', width:3 }, thickness:0.8, value:90 }
      }
    }], {
      paper_bgcolor:'transparent', plot_bgcolor:'transparent',
      height:200, margin:{ l:32, r:32, t:16, b:16 },
      font:{ family:PLY_FONT, color:t.font },
    }, PLY_CFG);
  }

  chartsInited = true;

  // Zone board is pure HTML — init after charts are ready
  initZoneSchedBoard();
}

// ── Live pressure point ────────────────────────────────────
function addChartPoint(inlet, outlet, diff) {
  const timeStr = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  pressureHistory.times.push(timeStr);
  pressureHistory.inlet.push(inlet);
  pressureHistory.outlet.push(outlet);
  pressureHistory.diff.push(diff);

  const MAX_POINTS = 720;
  if (pressureHistory.times.length > MAX_POINTS) {
    pressureHistory.times.shift(); pressureHistory.inlet.shift();
    pressureHistory.outlet.shift(); pressureHistory.diff.shift();
  }

  const count = Math.min(pressureHistory.times.length, chartRangeMin * 12);
  const s     = pressureHistory.times.length - count;
  const vis   = {
    t: pressureHistory.times.slice(s),
    i: pressureHistory.inlet.slice(s),
    o: pressureHistory.outlet.slice(s),
    d: pressureHistory.diff.slice(s),
  };

  if (chartsInited && document.getElementById('pressureChart')) {
    Plotly.restyle('pressureChart', { x: [vis.t, vis.t, vis.t], y: [vis.i, vis.o, vis.d] });
  }
  if (chartsInited) {
    const gd = document.getElementById('gaugeChart');
    if (gd && gd.data && gd.data[0]) {
      gd.data[0].value = inlet;
      Plotly.redraw(gd);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// ZONE STATUS BOARD — live per-zone rows (no Plotly needed)
// ═══════════════════════════════════════════════════════════
let _zsbTimer = null;

function initZoneSchedBoard() {
  const board = document.getElementById('zoneSchedBoard');
  if (!board) return;
  board.innerHTML = '';
  for (let z = 1; z <= 8; z++) {
    const color = (typeof ZONE_COLORS !== 'undefined') ? ZONE_COLORS[z - 1] : '#888';
    const row = document.createElement('div');
    row.className = 'zsb-row';
    row.id = `zsb-row-${z}`;
    row.innerHTML = `
      <div class="zsb-swatch" style="background:${color}"></div>
      <div class="zsb-name" id="zsb-name-${z}">Zone ${z}</div>
      <div class="zsb-pill" id="zsb-pill-${z}">Ready</div>
      <div class="zsb-countdown" id="zsb-cd-${z}"><span style="color:#737971">—</span></div>
      <div class="zsb-tl" id="zsb-tl-${z}" title="Today's schedule (00:00 – 23:59)"></div>`;
    board.appendChild(row);
  }
  if (_zsbTimer) clearInterval(_zsbTimer);
  _zsbTick();
  _zsbTimer = setInterval(_zsbTick, 1000);
}

function _fmtCountdown(ms) {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000);
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2,'0')}s`;
  return `${s}s`;
}

function _getNextRun(zoneNum) {
  if (typeof zoneSchedules === 'undefined') return null;
  const now      = new Date();
  const todayDow = now.getDay();
  let best = null;
  for (const s of zoneSchedules) {
    if (s.zone_num !== zoneNum || !s.enabled) continue;
    const [hh, mm] = (s.start_time || '00:00').split(':').map(Number);
    for (let offset = 0; offset < 7; offset++) {
      const dow = (todayDow + offset) % 7;
      if (!s.days_of_week.some(d => +d === dow)) continue;
      const candidate = new Date(now);
      candidate.setDate(candidate.getDate() + offset);
      candidate.setHours(hh, mm, 0, 0);
      if (candidate <= now) continue;
      if (!best || candidate.getTime() < best.ms) {
        best = { ms: candidate.getTime(), durationMin: s.duration_min,
                 timeStr: candidate.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) };
      }
      break;
    }
  }
  return best;
}

function _getTodayBars(zoneNum) {
  if (typeof zoneSchedules === 'undefined') return [];
  const todayDow = new Date().getDay();
  return zoneSchedules
    .filter(s => s.zone_num === zoneNum && s.enabled && s.days_of_week.some(d => +d === todayDow))
    .map(s => {
      const [hh, mm] = (s.start_time || '00:00').split(':').map(Number);
      const startMin = hh * 60 + mm;
      return { startMin, endMin: startMin + s.duration_min };
    });
}

function _zsbTick() {
  const board = document.getElementById('zoneSchedBoard');
  if (!board) return;
  const now    = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const nowPct = (nowMin / 1440 * 100).toFixed(3);

  const clk = document.getElementById('zsbClock');
  if (clk) clk.textContent = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });

  for (let z = 1; z <= 8; z++) {
    const pill = document.getElementById(`zsb-pill-${z}`);
    const cd   = document.getElementById(`zsb-cd-${z}`);
    const tl   = document.getElementById(`zsb-tl-${z}`);
    const nm   = document.getElementById(`zsb-name-${z}`);
    if (!pill) continue;

    if (nm) nm.textContent = (typeof zoneNames !== 'undefined' && zoneNames[z]) || `Zone ${z}`;

    const color     = (typeof ZONE_COLORS !== 'undefined') ? ZONE_COLORS[z - 1] : '#888';
    const isRunning = typeof irrigZoneStates !== 'undefined' && !!irrigZoneStates[z];
    const offAt     = typeof zoneOffAt !== 'undefined' ? zoneOffAt[z] : null;

    if (isRunning) {
      pill.className  = 'zsb-pill running';
      pill.textContent = 'Watering';
      if (offAt && offAt > Date.now()) {
        const left = offAt - Date.now();
        cd.innerHTML = `<b>${_fmtCountdown(left)}</b> <span style="color:#737971">left</span>`;
      } else {
        cd.innerHTML = `<span style="color:#737971">running</span>`;
      }
    } else {
      const next = _getNextRun(z);
      if (next) {
        pill.className  = 'zsb-pill next';
        pill.textContent = 'Scheduled';
        cd.innerHTML = `<b>${next.timeStr}</b> <span style="color:#737971">in ${_fmtCountdown(next.ms - Date.now())}</span>`;
      } else {
        pill.className  = 'zsb-pill';
        pill.textContent = 'Ready';
        cd.innerHTML = `<span style="color:#737971">No watering scheduled</span>`;
      }
    }

    if (tl) {
      const bars = _getTodayBars(z);
      let html = '';
      for (const b of bars) {
        const left  = (b.startMin / 1440 * 100).toFixed(3);
        const width = Math.max(0.3, (b.endMin - b.startMin) / 1440 * 100).toFixed(3);
        const cls   = isRunning ? 'zsb-tl-seg running-seg' : 'zsb-tl-seg';
        html += `<div class="${cls}" style="left:${left}%;width:${width}%;background:${color}"></div>`;
      }
      html += `<div class="zsb-tl-now" style="left:${nowPct}%"></div>`;
      tl.innerHTML = html;
    }
  }
}

// Called by schedule.js when schedules change
function buildActivityOption(_ganttBars) {
  _zsbTick();
  return null;
}
function buildUsageOption(_minutesByZone) {
  return null;
}

// Called from mqtt.js / irrigation.js when a zone run completes
function refreshHistoryChart(_hours) {
  refreshZoneActivity();
}

// ═══════════════════════════════════════════════════════════
// ZONE ACTIVITY LOG
// ═══════════════════════════════════════════════════════════
async function refreshZoneActivity() {
  const log = document.getElementById('zoneActivityLog');
  if (!log || !irrigDevice || !currentUser) return;

  const days    = parseInt(document.getElementById('zoneActivityDays')?.value)  || 7;
  const zFilter = parseInt(document.getElementById('zoneActivityFilter')?.value) || 0;
  const since   = new Date(Date.now() - days * 86400000).toISOString();

  log.innerHTML = `<div class="zal-empty">Loading...</div>`;

  let q = sb.from('zone_history')
    .select('zone_num, started_at, ended_at')
    .eq('device_id', irrigDevice.id)
    .gte('started_at', since)
    .not('ended_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(300);
  if (zFilter > 0) q = q.eq('zone_num', zFilter);

  const { data, error } = await q;
  if (error) {
    log.innerHTML = `<div class="zal-empty">Failed to load activity</div>`;
    return;
  }
  if (!data || !data.length) {
    log.innerHTML = `<div class="zal-empty">No zone runs in this period</div>`;
    return;
  }

  const todayStr = new Date().toDateString();
  const yestStr  = new Date(Date.now() - 86400000).toDateString();

  const rows = data.map(r => {
    const z       = r.zone_num;
    const color   = (typeof ZONE_COLORS !== 'undefined') ? ZONE_COLORS[z - 1] : '#888';
    const name    = (typeof zoneNames !== 'undefined' && zoneNames[z]) || `Zone ${z}`;
    const start   = new Date(r.started_at);
    const end     = new Date(r.ended_at);
    const durMin  = Math.round((end - start) / 60000);
    const durTxt  = durMin >= 1 ? `${durMin} min` : `${Math.round((end - start)/1000)}s`;

    let dateLabel;
    if (start.toDateString() === todayStr)   dateLabel = 'Today';
    else if (start.toDateString() === yestStr) dateLabel = 'Yesterday';
    else dateLabel = start.toLocaleDateString([], { weekday:'short', month:'short', day:'numeric' });

    const timeStr = start.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    const endStr  = end.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

    return `<div class="zal-row">
      <div class="zal-dot" style="background:${color}"></div>
      <div class="zal-zone">${name}</div>
      <div class="zal-event"><b>Watered</b> ${timeStr} → ${endStr}</div>
      <div class="zal-time">${dateLabel}</div>
      <div class="zal-dur">${durTxt}</div>
    </div>`;
  });

  log.innerHTML = rows.join('');
}

// ── Apply DB pressure rows to chart ───────────────────────
function applyHistoryToPressureChart(rows, spanMs) {
  const fmtTime = ts => {
    const d = new Date(ts);
    if (spanMs <= 3600000)  return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit', second:'2-digit' });
    if (spanMs <= 86400000) return d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
    return d.toLocaleDateString([], { weekday:'short' }) + ' ' + d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  };
  pressureHistory = { times:[], inlet:[], outlet:[], diff:[] };
  for (const r of rows) {
    pressureHistory.times.push(fmtTime(r.ts));
    pressureHistory.inlet.push(parseFloat(r.inlet_psi));
    pressureHistory.outlet.push(parseFloat(r.outlet_psi));
    pressureHistory.diff.push(parseFloat(r.diff_psi));
  }
  if (chartsInited && document.getElementById('pressureChart')) {
    Plotly.restyle('pressureChart', {
      x: [pressureHistory.times, pressureHistory.times, pressureHistory.times],
      y: [pressureHistory.inlet, pressureHistory.outlet, pressureHistory.diff]
    });
  }
}

// ── Range button ───────────────────────────────────────────
function setRange(min) {
  chartRangeMin = min;
  customRangeActive = false;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('r' + min)?.classList.add('active');
  loadHistory();
}

function toggleDatePicker() {
  const dp  = document.getElementById('datePicker');
  const btn = document.getElementById('rCustom');
  const visible = dp.style.display === 'flex';
  dp.style.display = visible ? 'none' : 'flex';
  btn.classList.toggle('active', !visible);
  if (!visible) {
    const now = new Date(); const from = new Date(now); from.setHours(0,0,0,0);
    document.getElementById('dtFrom').value = toLocalISO(from);
    document.getElementById('dtTo').value   = toLocalISO(now);
  }
}

function toLocalISO(d) {
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function loadPresets(preset) {
  const now = new Date(); let from, to;
  if (preset === 'today') {
    from = new Date(now); from.setHours(0,0,0,0); to = now;
  } else {
    from = new Date(now); from.setDate(from.getDate()-1); from.setHours(0,0,0,0);
    to   = new Date(now); to.setDate(to.getDate()-1);   to.setHours(23,59,59,0);
  }
  document.getElementById('dtFrom').value = toLocalISO(from);
  document.getElementById('dtTo').value   = toLocalISO(to);
  loadCustomRange();
}

async function loadCustomRange() {
  const fromVal = document.getElementById('dtFrom').value;
  const toVal   = document.getElementById('dtTo').value;
  if (!fromVal || !toVal) return;
  const fromDate = new Date(fromVal), toDate = new Date(toVal);
  const statusEl = document.getElementById('dateRangeStatus');
  if (fromDate >= toDate) { if (statusEl) statusEl.textContent = '⚠ From must be before To'; return; }
  customRangeActive = true;
  document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('rCustom').classList.add('active');
  if (statusEl) statusEl.textContent = 'Loading...';
  try {
    let q = sb.from('pressure_log').select('ts,inlet_psi,outlet_psi,diff_psi')
      .gte('ts', fromDate.toISOString()).lte('ts', toDate.toISOString())
      .order('ts', { ascending:true }).limit(2000);
    if (filterDevice) q = q.eq('device_id', filterDevice.id);
    const { data: rows, error } = await q;
    if (error || !rows?.length) { if (statusEl) statusEl.textContent = 'No data for this range'; return; }
    let picked = rows;
    if (rows.length > 500) { picked = []; const step = rows.length/500; for (let i=0;i<500;i++) picked.push(rows[Math.round(i*step)]); }
    const spanMs = toDate - fromDate;
    applyHistoryToPressureChart(picked, spanMs);
    const chartLabel = document.getElementById('chartLabel');
    if (chartLabel) chartLabel.textContent =
      `${fromDate.toLocaleDateString()} ${fromDate.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})} → ${toDate.toLocaleDateString()} ${toDate.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}`;
    if (statusEl) statusEl.textContent = `${picked.length} readings`;
    addLog(`Custom range loaded: ${picked.length} readings`, 'system');
  } catch(e) { if (statusEl) statusEl.textContent = 'Error loading data'; }
}

async function loadHistory() {
  try {
    const since = new Date(Date.now() - chartRangeMin * 60 * 1000).toISOString();
    let q = sb.from('pressure_log').select('ts,inlet_psi,outlet_psi,diff_psi')
      .gte('ts', since).order('ts', { ascending:true }).limit(500);
    if (filterDevice) q = q.eq('device_id', filterDevice.id);
    const { data: rows, error } = await q;
    if (error || !rows?.length) return;
    let picked = rows;
    if (rows.length > 300) { picked = []; const step = rows.length/300; for (let i=0;i<300;i++) picked.push(rows[Math.round(i*step)]); }
    const spanMs = chartRangeMin * 60 * 1000;
    applyHistoryToPressureChart(picked, spanMs);
    const chartLabel = document.getElementById('chartLabel');
    if (chartLabel) chartLabel.textContent = 'Live pressure log';
    const dp = document.getElementById('datePicker');
    if (dp) dp.style.display = 'none';
    customRangeActive = false;
    addLog(`Loaded ${picked.length} readings`, 'system');
  } catch(e) { console.error('History load failed', e); }
}
