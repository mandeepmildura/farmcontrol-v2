// ═══════════════════════════════════════════════════════════
// SCHEDULE — zone scheduling, auto-fire, modal, charts
// ═══════════════════════════════════════════════════════════
let zoneSchedules      = [];
let schedModalZone     = null;
let schedulerTimer     = null;
let schedulerAlignTimer = null;

const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DAY_SHORT = ['S','M','T','W','T','F','S'];

// ── Load schedules from Supabase ───────────────────────────
async function loadSchedules() {
  if (!irrigDevice || !currentUser) return;
  const { data, error } = await sb.from('zone_schedules')
    .select('*')
    .eq('device_id',   irrigDevice.id)
    .eq('customer_id', irrigDevice.customer_id)
    .order('zone_num').order('start_time');
  if (error) { console.error('schedule load error', error); return; }
  zoneSchedules = data || [];
  renderMiniTimelines();
  renderUpcomingOnDashboard();
  refreshActivityChart();
  refreshUsageChart();
  if (typeof refreshZoneActivity === 'function') refreshZoneActivity();
  if (typeof renderWeeklyGrid === 'function') renderWeeklyGrid();
}

// ── Scheduler tick (called every minute) ──────────────────
function schedulerTick() {
  if (!irrigDevice || !currentUser) return;
  const now     = new Date();
  const today   = now.toISOString().slice(0,10);
  const hhmm    = String(now.getHours()).padStart(2,'0') + ':' + String(now.getMinutes()).padStart(2,'0');
  const dayOfWk = now.getDay();

  for (const s of zoneSchedules) {
    if (!s.enabled) continue;
    if (!s.days_of_week.some(d => +d === dayOfWk)) continue;

    const sTime = (s.start_time || '').slice(0, 5);
    if (sTime !== hhmm) continue;

    const key = `sched_fired_${s.id}`;
    const last = localStorage.getItem(key);
    if (last === today + 'T' + hhmm) continue;

    if (!irrigDevice) continue;
    const durEl = document.getElementById('zoneDur' + s.zone_num);
    if (durEl) durEl.value = s.duration_min;
    irrigZoneOn(s.zone_num, s.duration_min);
    localStorage.setItem(key, today + 'T' + hhmm);
    addLog(`Schedule fired: Zone ${s.zone_num} (${s.label || 'auto'}) — ${s.duration_min} min`, 'system');
  }

  if (typeof groupSchedulerTick === 'function') {
    groupSchedulerTick(now, dayOfWk, hhmm);
  }
}

// ── Start scheduler, aligned to top of next minute ────────
function initScheduler() {
  if (schedulerTimer)     { clearInterval(schedulerTimer);  schedulerTimer     = null; }
  if (schedulerAlignTimer){ clearTimeout(schedulerAlignTimer); schedulerAlignTimer = null; }
  const now = new Date();
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds();
  schedulerAlignTimer = setTimeout(() => {
    schedulerAlignTimer = null;
    schedulerTick();
    schedulerTimer = setInterval(schedulerTick, 60000);
  }, msToNextMinute);
}

// ── Modal open/close ──────────────────────────────────────
function openScheduleModal(zoneNum) {
  schedModalZone = zoneNum;
  document.getElementById('schedZoneNum').textContent  = zoneNum;
  document.getElementById('schedZoneName').textContent = zoneNames[zoneNum] || ('Zone ' + zoneNum);
  document.getElementById('schedErr').classList.remove('visible');
  document.getElementById('schedErr').textContent = '';
  document.getElementById('schedLabel').value = '';

  const durEl = document.getElementById('zoneDur' + zoneNum);
  document.getElementById('schedDuration').value = durEl ? durEl.value : 30;

  buildDayCheckboxes();
  renderScheduleList();
  document.getElementById('scheduleModal').classList.add('visible');
}

function closeScheduleModal() {
  document.getElementById('scheduleModal').classList.remove('visible');
  schedModalZone = null;
}

// ── Build day-of-week checkboxes in modal ─────────────────
function buildDayCheckboxes() {
  const container = document.getElementById('schedDays');
  container.innerHTML = '';
  DAY_NAMES.forEach((name, idx) => {
    const label = document.createElement('label');
    label.className = 'day-cb-label';
    label.innerHTML = `<input type="checkbox" value="${idx}" onchange="toggleDayLabel(this)"> ${name}`;
    container.appendChild(label);
  });
}

function toggleDayLabel(cb) {
  cb.closest('label').classList.toggle('selected', cb.checked);
}

function getSelectedDays() {
  return Array.from(document.querySelectorAll('#schedDays input[type=checkbox]:checked'))
    .map(cb => parseInt(cb.value));
}

// ── Render schedule list in modal ─────────────────────────
function renderScheduleList() {
  const container = document.getElementById('scheduleList');
  const myScheds  = zoneSchedules.filter(s => s.zone_num === schedModalZone);

  if (!myScheds.length) {
    container.innerHTML = '';
    const emptyDiv = document.createElement('div');
    emptyDiv.style.cssText = 'padding:16px;font-family:"Public Sans",sans-serif;font-size:11px;color:#737971;text-align:center';
    emptyDiv.textContent = 'No schedules yet';
    container.appendChild(emptyDiv);
    return;
  }

  container.innerHTML = '';
  for (const s of myScheds) {
    const row = document.createElement('div');
    row.className = 'sched-row';

    const dayTags = DAY_NAMES.map((n, i) => {
      const active = s.days_of_week.includes(i) ? 'active' : '';
      return `<span class="sched-day-tag ${active}">${n.slice(0,1)}</span>`;
    }).join('');

    row.innerHTML = `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0">
        <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="updateSchedule('${s.id}',{enabled:this.checked})" style="accent-color:#17361d">
        <span style="font-size:10px;color:#737971">${s.enabled ? 'On' : 'Off'}</span>
      </label>
      <div style="display:flex;gap:3px;flex-wrap:wrap">${dayTags}</div>
      <span style="font-family:'Public Sans',monospace;font-size:11px;color:#1a1c1a;flex-shrink:0">${(s.start_time||'').slice(0,5)}</span>
      <span style="font-family:'Public Sans',monospace;font-size:11px;color:#737971;flex-shrink:0">${s.duration_min}min</span>
      <span style="font-family:'Public Sans',monospace;font-size:11px;color:#737971;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.label || ''}</span>
      <button class="btn sm danger" onclick="deleteSchedule('${s.id}')" style="flex-shrink:0">✕</button>`;
    container.appendChild(row);
  }
}

// ── CRUD ──────────────────────────────────────────────────
async function addSchedule() {
  const errEl = document.getElementById('schedErr');
  errEl.classList.remove('visible'); errEl.textContent = '';

  const days = getSelectedDays();
  if (!days.length) { errEl.textContent = 'Select at least one day'; errEl.classList.add('visible'); return; }

  const startTime = document.getElementById('schedStartTime').value;
  if (!startTime) { errEl.textContent = 'Select a start time'; errEl.classList.add('visible'); return; }

  const dur = parseInt(document.getElementById('schedDuration').value);
  if (!dur || dur < 1) { errEl.textContent = 'Duration must be at least 1 minute'; errEl.classList.add('visible'); return; }

  const label = document.getElementById('schedLabel').value.trim();

  const { error } = await sb.from('zone_schedules').insert({
    device_id:    irrigDevice.id,
    customer_id:  irrigDevice.customer_id,
    zone_num:     schedModalZone,
    label,
    days_of_week: days,
    start_time:   startTime + ':00',
    duration_min: dur,
    enabled:      true
  });

  if (error) { errEl.textContent = 'Error: ' + error.message; errEl.classList.add('visible'); return; }

  await loadSchedules();
  renderScheduleList();
  addLog(`Schedule added: Zone ${schedModalZone} ${label || ''} @ ${startTime}`, 'system');

  document.getElementById('schedLabel').value = '';
  buildDayCheckboxes();
}

async function deleteSchedule(id) {
  const { error } = await sb.from('zone_schedules').delete().eq('id', id);
  if (error) { console.error('delete schedule error', error); return; }
  await loadSchedules();
  renderScheduleList();
}

async function updateSchedule(id, patch) {
  const { error } = await sb.from('zone_schedules').update(patch).eq('id', id);
  if (error) { console.error('update schedule error', error); return; }
  await loadSchedules();
  renderScheduleList();
}

// ── Mini timelines on zone cards ──────────────────────────
function renderMiniTimelines() {
  for (let i = 1; i <= 8; i++) {
    const el = document.getElementById('zoneMiniTimeline' + i);
    if (!el) continue;
    el.innerHTML = '';

    const today = new Date().getDay();
    const myScheds = zoneSchedules.filter(s => s.zone_num === i && s.enabled && s.days_of_week.includes(today));
    if (!myScheds.length) continue;

    const color = ZONE_COLORS[i - 1];
    const dayMins = 24 * 60;

    myScheds.forEach(s => {
      const [hh, mm] = (s.start_time || '00:00').split(':').map(Number);
      const startMin = hh * 60 + mm;
      const endMin   = Math.min(startMin + s.duration_min, dayMins);
      const left  = (startMin / dayMins * 100).toFixed(2) + '%';
      const width = ((endMin - startMin) / dayMins * 100).toFixed(2) + '%';
      const bar = document.createElement('div');
      bar.className = 'zone-mini-bar';
      bar.style.cssText = `background:${color};width:${width};margin-left:${left};flex-shrink:0`;
      el.appendChild(bar);
    });
  }
}

// ── Upcoming schedules on dashboard ───────────────────────
function renderUpcomingOnDashboard() {
  const wrapper = document.getElementById('upcomingSchedules');
  const listEl  = document.getElementById('upcomingList');
  if (!wrapper || !listEl) return;

  const upcoming = getNextRuns(5);
  if (!upcoming.length) { wrapper.style.display = 'none'; return; }

  wrapper.style.display = '';
  listEl.innerHTML = '';
  upcoming.forEach(item => {
    const el = document.createElement('div');
    el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #e8e8e5';
    el.innerHTML = `
      <div style="width:8px;height:8px;border-radius:50%;background:${ZONE_COLORS[item.zone - 1]};flex-shrink:0"></div>
      <span style="font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;color:#1a1c1a;flex:1">${zoneNames[item.zone] || 'Zone ' + item.zone}</span>
      <span style="font-family:'Public Sans',sans-serif;font-size:11px;color:#424841">${item.day} @ ${item.time}</span>
      <span style="font-family:'Public Sans',sans-serif;font-size:11px;color:#737971">${item.duration} min</span>`;
    listEl.appendChild(el);
  });
}

// ── Get next N upcoming run slots ─────────────────────────
function getNextRuns(limit) {
  const results = [];
  const now     = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  for (let dayOffset = 0; dayOffset <= 6 && results.length < limit; dayOffset++) {
    const checkDate  = new Date(now);
    checkDate.setDate(checkDate.getDate() + dayOffset);
    const checkDay   = checkDate.getDay();
    const isToday    = dayOffset === 0;

    for (const s of zoneSchedules) {
      if (!s.enabled) continue;
      if (!s.days_of_week.includes(checkDay)) continue;

      const [hh, mm] = (s.start_time || '00:00').split(':').map(Number);
      const schedMin = hh * 60 + mm;
      if (isToday && schedMin <= nowMins) continue;

      results.push({
        zone:     s.zone_num,
        day:      isToday ? 'Today' : DAY_NAMES[checkDay],
        time:     String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0'),
        duration: s.duration_min,
        label:    s.label
      });

      if (results.length >= limit) break;
    }
  }
  return results;
}

// ── Refresh zone activity Gantt chart ─────────────────────
function refreshActivityChart() {
  if (!window.activityChart) return;
  const today = new Date().getDay();
  const now   = new Date(); const dayStart = new Date(now); dayStart.setHours(0,0,0,0);

  const bars = [];
  zoneSchedules.forEach(s => {
    if (!s.enabled || !s.days_of_week.some(d => +d === today)) return;
    const [hh, mm] = (s.start_time || '00:00').split(':').map(Number);
    bars.push({
      zone:     s.zone_num,
      startMin: hh * 60 + mm,
      endMin:   hh * 60 + mm + s.duration_min
    });
  });

  buildActivityOption(bars);
}

// ── Refresh usage bar chart ───────────────────────────────
function refreshUsageChart() {
  if (!window.usageChart) return;
  const today = new Date().getDay();
  const mins  = new Array(8).fill(0);

  zoneSchedules.forEach(s => {
    if (!s.enabled || !s.days_of_week.some(d => +d === today)) return;
    mins[s.zone_num - 1] += s.duration_min;
  });

  buildUsageOption(mins);
}

// ── Render weekly grid in schedule view ───────────────────
function renderWeeklyGrid() {
  const grid = document.getElementById('weeklyGrid');
  if (!grid) return;
  const days    = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const dayDows = [1,2,3,4,5,6,0];
  grid.innerHTML = '';
  days.forEach((day, idx) => {
    const dow = dayDows[idx];
    const dayScheds = zoneSchedules.filter(s => s.enabled && s.days_of_week.some(d => +d === dow));
    const col = document.createElement('div');
    col.className = 'flex flex-col gap-2';
    col.innerHTML = `<span style="font-size:10px;font-weight:700;text-transform:uppercase;color:#737971;text-align:center;font-family:'Public Sans',sans-serif;padding-bottom:4px">${day}</span>`;
    const inner = document.createElement('div');
    inner.style.cssText = 'flex:1;background:#fff;border-left:2px solid #e8e8e5;padding:6px;min-height:180px;display:flex;flex-direction:column;gap:4px';
    if (dayScheds.length) {
      inner.style.borderLeftColor = '#c7ecc7';
    }
    dayScheds.forEach(s => {
      const item = document.createElement('div');
      item.style.cssText = 'background:#d0e4ff;padding:4px 6px;border-left:2px solid ' + ZONE_COLORS[s.zone_num - 1];
      item.innerHTML = `<span style="font-size:10px;font-weight:700;color:#004c7e;display:block;font-family:'Space Grotesk',sans-serif">${(s.start_time||'').slice(0,5)}</span><span style="font-size:9px;text-transform:uppercase;color:#12629d;font-family:'Public Sans',sans-serif">${zoneNames[s.zone_num]||'Zone '+s.zone_num}</span>`;
      inner.appendChild(item);
    });
    col.appendChild(inner);
    grid.appendChild(col);
  });

  // Update next task card
  const nextRuns = getNextRuns(1);
  if (nextRuns.length) {
    const r = nextRuns[0];
    const z = document.getElementById('nextTaskZone');
    const t = document.getElementById('nextTaskTime');
    const d = document.getElementById('nextTaskDur');
    if (z) z.textContent = zoneNames[r.zone] || 'Zone ' + r.zone;
    if (t) t.textContent = r.day + ', ' + r.time;
    if (d) d.textContent = r.duration + ' Minutes';
  }
}
