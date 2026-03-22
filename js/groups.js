// ═══════════════════════════════════════════════════════════
// GROUPS — zone groups, group schedules, step-based run
// ═══════════════════════════════════════════════════════════
let zoneGroups     = [];
let groupMembers   = {};
let groupSchedules = [];
let groupEditId    = null;
let groupSchedGid  = null;
let _groupRunTimer = null;
let modalSteps     = [];

// ── Load groups, members, group schedules ─────────────────
async function loadGroups() {
  if (!irrigDevice || !currentUser) return;

  const { data: groups } = await sb.from('zone_groups')
    .select('*')
    .eq('device_id',   irrigDevice.id)
    .eq('customer_id', irrigDevice.customer_id)
    .order('created_at');

  zoneGroups = groups || [];

  if (zoneGroups.length) {
    const ids = zoneGroups.map(g => g.id);
    const [memRes, schedRes] = await Promise.all([
      sb.from('zone_group_members').select('*').in('group_id', ids).order('sort_order'),
      sb.from('group_schedules').select('*')
        .eq('device_id', irrigDevice.id).eq('customer_id', irrigDevice.customer_id).order('start_time')
    ]);
    groupMembers = {};
    for (const m of (memRes.data || [])) {
      (groupMembers[m.group_id] ??= []).push(m);
    }
    groupSchedules = schedRes.data || [];
  } else {
    groupMembers = {}; groupSchedules = [];
  }

  renderGroupCards();
}

// ── Convert groupMembers into modalSteps format ───────────
function membersToSteps(members) {
  if (!members || !members.length) return [{ zones: [], duration: 30 }];
  const stepsMap = {};
  for (const m of members) {
    const key = m.sort_order ?? 0;
    if (!stepsMap[key]) stepsMap[key] = { zones: [], duration: m.duration_min };
    stepsMap[key].zones.push(m.zone_num);
    stepsMap[key].duration = Math.max(stepsMap[key].duration, m.duration_min);
  }
  return Object.keys(stepsMap).map(Number).sort((a, b) => a - b).map(k => stepsMap[k]);
}

// ── Convert modalSteps to DB rows ─────────────────────────
function stepsToMembers(steps, groupId) {
  const rows = [];
  steps.forEach((step, stepIdx) => {
    step.zones.forEach(zoneNum => {
      rows.push({ group_id: groupId, zone_num: zoneNum, duration_min: step.duration, sort_order: stepIdx });
    });
  });
  return rows;
}

// ── Render group cards ────────────────────────────────────
function renderGroupCards() {
  const container = document.getElementById('groupCards');
  if (!container) return;

  if (!zoneGroups.length) {
    container.innerHTML = `<div style="font-family:'Public Sans',sans-serif;font-size:11px;color:#737971;padding:20px;text-align:center">No groups yet — click New Group to create one</div>`;
    return;
  }

  container.innerHTML = '';
  for (const g of zoneGroups) {
    const members = (groupMembers[g.id] || []).sort((a, b) => a.sort_order - b.sort_order);
    const steps   = membersToSteps(members.length ? members : null);

    const stepDots = steps.filter(s => s.zones.length).map(step =>
      step.zones.map(z =>
        `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${ZONE_COLORS[z-1]}" title="${zoneNames[z]||'Zone '+z}"></span>`
      ).join('')
    ).join(`<span style="font-family:'Public Sans',sans-serif;font-size:9px;color:#737971;margin:0 3px">→</span>`);

    const totalMin   = steps.reduce((s, step) => s + step.duration, 0);
    const myScheds   = groupSchedules.filter(s => s.group_id === g.id && s.enabled);
    const schedLabel = myScheds.length ? myScheds.map(s => (s.start_time||'').slice(0,5)).join(', ') : 'No schedule';
    const stepsLabel = steps.length === 1 ? '1 step' : `${steps.length} steps`;

    const card = document.createElement('div');
    card.className = 'group-card';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div style="font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:700;color:#1a1c1a">${esc(g.name)}</div>
        <span style="font-family:'Public Sans',sans-serif;font-size:9px;padding:2px 7px;border:1px solid #0d9488;color:#0d9488;white-space:nowrap;flex-shrink:0">${stepsLabel}</span>
      </div>
      <div style="display:flex;gap:5px;align-items:center;flex-wrap:wrap;min-height:16px;margin-bottom:6px">
        ${stepDots || '<span style="font-family:\'Public Sans\',sans-serif;font-size:10px;color:#737971">no zones</span>'}
        <span style="font-family:'Public Sans',sans-serif;font-size:10px;color:#737971;margin-left:4px">${totalMin} min total</span>
      </div>
      <div style="font-family:'Public Sans',sans-serif;font-size:10px;color:#737971;margin-bottom:10px">⏱ ${esc(schedLabel)}</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn sm action" onclick="runGroupNow('${esc(g.id)}')">▶ Run Now</button>
        <button class="btn sm secondary" onclick="openGroupSchedModal('${esc(g.id)}')">⏱ Schedule</button>
        <button class="btn sm secondary" onclick="openGroupModal('${esc(g.id)}')">Edit</button>
        <button class="btn sm danger" onclick="deleteGroup('${esc(g.id)}')">✕</button>
      </div>`;
    container.appendChild(card);
  }
}

// ── Run group now ─────────────────────────────────────────
function runGroupNow(groupId) {
  const group   = zoneGroups.find(g => g.id === groupId);
  const members = (groupMembers[groupId] || []).sort((a, b) => a.sort_order - b.sort_order);
  if (!group || !members.length) return;
  if (!irrigDevice) { addLog('Cannot run group — no device', 'alert'); return; }
  runGroupSteps(group, members);
}

function runGroupSteps(group, members) {
  if (_groupRunTimer) { clearTimeout(_groupRunTimer); _groupRunTimer = null; }

  const stepsMap = {};
  for (const m of members) {
    const key = m.sort_order ?? 0;
    (stepsMap[key] ??= []).push(m);
  }
  const stepKeys = Object.keys(stepsMap).map(Number).sort((a, b) => a - b);
  let stepIdx = 0;
  addLog(`Group "${group.name}" — ${stepKeys.length} step run starting`, 'system');

  function nextStep() {
    if (stepIdx >= stepKeys.length) {
      addLog(`Group "${group.name}" — run complete`, 'system');
      return;
    }
    const key         = stepKeys[stepIdx++];
    const stepMembers = stepsMap[key];
    const maxDur      = Math.max(...stepMembers.map(m => m.duration_min));
    stepMembers.forEach(m => {
      const durEl = document.getElementById('zoneDur' + m.zone_num);
      if (durEl) durEl.value = m.duration_min;
      irrigZoneOn(m.zone_num, m.duration_min);
    });
    addLog(`Group step ${stepIdx}: zones [${stepMembers.map(m => m.zone_num).join(',')}] ON — ${maxDur} min`, 'system');
    _groupRunTimer = setTimeout(() => {
      stepMembers.forEach(m => irrigZoneOff(m.zone_num));
      _groupRunTimer = setTimeout(nextStep, 1500);
    }, maxDur * 60000);
  }
  nextStep();
}

// ── Group scheduler tick (called from schedulerTick) ──────
function groupSchedulerTick(now, today, hhmm) {
  for (const s of groupSchedules) {
    if (!s.enabled) continue;
    if (!s.days_of_week.some(d => +d === today)) continue;
    if ((s.start_time || '').slice(0, 5) !== hhmm) continue;

    const dateKey = now.toISOString().slice(0, 10) + 'T' + hhmm;
    const key     = `grp_fired_${s.id}`;
    if (localStorage.getItem(key) === dateKey) continue;

    if (!irrigDevice) continue;

    const group   = zoneGroups.find(g => g.id === s.group_id);
    const members = (groupMembers[s.group_id] || []).sort((a, b) => a.sort_order - b.sort_order);
    if (!group || !members.length) continue;

    runGroupNow(s.group_id);
    localStorage.setItem(key, dateKey);
    addLog(`Group schedule fired: "${group.name}" (${s.label || 'auto'})`, 'system');
  }
}

// ── Group modal — step rendering ──────────────────────────
function renderModalSteps() {
  const container = document.getElementById('groupStepsContainer');
  if (!container) return;
  container.innerHTML = '';

  modalSteps.forEach((step, idx) => {
    const stepEl = document.createElement('div');
    stepEl.style.cssText = 'border:1px solid #c2c8bf;padding:12px;margin-bottom:10px;background:#f9f9f6';

    const zoneBtns = Array.from({ length: 8 }, (_, i) => {
      const z      = i + 1;
      const active = step.zones.includes(z);
      const color  = ZONE_COLORS[i];
      const bg     = active ? color : 'transparent';
      const tc     = active ? '#fff' : color;
      return `<button onclick="toggleZoneInStep(${idx},${z})"
        style="width:32px;height:32px;border-radius:50%;border:2px solid ${color};background:${bg};color:${tc};font-family:'Public Sans',sans-serif;font-size:10px;font-weight:700;cursor:pointer;transition:all .15s"
        title="${zoneNames[z]||'Zone '+z}">${z}</button>`;
    }).join('');

    stepEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-family:'Public Sans',sans-serif;font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#737971">Step ${idx + 1}</div>
        ${modalSteps.length > 1 ? `<button onclick="removeModalStep(${idx})" style="font-family:'Public Sans',sans-serif;font-size:10px;color:#ba1a1a;border:none;background:transparent;cursor:pointer;padding:2px 6px">Remove</button>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">${zoneBtns}</div>
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-family:'Public Sans',sans-serif;font-size:11px;color:#737971">Run for</span>
        <input type="number" id="stepDur${idx}" value="${step.duration}" min="1" max="1440"
          oninput="modalSteps[${idx}].duration = Math.max(1, parseInt(this.value)||1)"
          style="width:65px;font-family:'Space Grotesk',sans-serif;font-size:12px;padding:3px 6px;border:none;border-bottom:2px solid #c2c8bf;background:#eeeeeb;color:#1a1c1a;text-align:center;outline:none">
        <span style="font-family:'Public Sans',sans-serif;font-size:11px;color:#737971">min</span>
      </div>`;
    container.appendChild(stepEl);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'btn secondary';
  addBtn.textContent = '+ Add Step';
  addBtn.style.cssText = 'width:100%;margin-top:4px';
  addBtn.onclick = addModalStep;
  container.appendChild(addBtn);
}

function toggleZoneInStep(stepIdx, zoneNum) {
  const step = modalSteps[stepIdx];
  if (!step) return;
  const pos = step.zones.indexOf(zoneNum);
  if (pos >= 0) step.zones.splice(pos, 1);
  else           step.zones.push(zoneNum);
  renderModalSteps();
}

function addModalStep() {
  modalSteps.push({ zones: [], duration: 30 });
  renderModalSteps();
}

function removeModalStep(stepIdx) {
  modalSteps.splice(stepIdx, 1);
  renderModalSteps();
}

// ── Create / Edit Group modal ─────────────────────────────
function openGroupModal(groupId) {
  groupEditId   = groupId || null;
  const group   = groupId ? zoneGroups.find(g => g.id === groupId) : null;
  const members = groupId ? (groupMembers[groupId] || []).sort((a, b) => a.sort_order - b.sort_order) : [];

  document.getElementById('groupModalTitle').textContent = group ? 'Edit Group' : 'New Group';
  document.getElementById('groupName').value = group?.name || '';
  document.getElementById('groupModalErr').style.display = 'none';

  modalSteps = membersToSteps(members.length ? members : null);
  renderModalSteps();
  document.getElementById('groupModal').classList.add('visible');
}

function closeGroupModal() {
  document.getElementById('groupModal').classList.remove('visible');
  groupEditId = null;
  modalSteps  = [];
}

async function saveGroup() {
  const name  = document.getElementById('groupName').value.trim();
  const errEl = document.getElementById('groupModalErr');
  errEl.style.display = 'none';
  if (!name) { errEl.textContent = 'Group name is required'; errEl.style.display = 'block'; return; }

  const validSteps = modalSteps.filter(s => s.zones.length > 0);
  if (!validSteps.length) { errEl.textContent = 'Add at least one zone to a step'; errEl.style.display = 'block'; return; }

  if (groupEditId) {
    const { error } = await sb.from('zone_groups').update({ name, run_mode: 'sequential' }).eq('id', groupEditId);
    if (error) { errEl.textContent = 'Error: ' + error.message; errEl.style.display = 'block'; return; }
    await sb.from('zone_group_members').delete().eq('group_id', groupEditId);
    const rows = stepsToMembers(validSteps, groupEditId);
    if (rows.length) await sb.from('zone_group_members').insert(rows);
    addLog(`Group "${name}" updated`, 'system');
  } else {
    const { data: grp, error } = await sb.from('zone_groups')
      .insert({ device_id: irrigDevice.id, customer_id: irrigDevice.customer_id, name, run_mode: 'sequential' })
      .select().single();
    if (error) { errEl.textContent = 'Error: ' + error.message; errEl.style.display = 'block'; return; }
    const rows = stepsToMembers(validSteps, grp.id);
    if (rows.length) await sb.from('zone_group_members').insert(rows);
    addLog(`Group "${name}" created`, 'system');
  }

  closeGroupModal();
  await loadGroups();
}

async function deleteGroup(groupId) {
  const group = zoneGroups.find(g => g.id === groupId);
  if (!confirm(`Delete group "${group?.name}"?`)) return;
  await sb.from('zone_groups').delete().eq('id', groupId);
  addLog(`Group "${group?.name}" deleted`, 'system');
  await loadGroups();
}

// ── Group Schedule modal ──────────────────────────────────
function openGroupSchedModal(groupId) {
  groupSchedGid = groupId;
  const group = zoneGroups.find(g => g.id === groupId);
  document.getElementById('groupSchedTitle').textContent = `Schedule: ${group?.name || ''}`;
  buildGroupDayCheckboxes();
  renderGroupSchedList();
  document.getElementById('groupSchedModal').classList.add('visible');
}

function closeGroupSchedModal() {
  document.getElementById('groupSchedModal').classList.remove('visible');
  groupSchedGid = null;
}

function buildGroupDayCheckboxes() {
  const container = document.getElementById('groupSchedDays');
  container.innerHTML = '';
  ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach((name, idx) => {
    const label = document.createElement('label');
    label.className = 'day-cb-label';
    label.innerHTML = `<input type="checkbox" value="${idx}" onchange="this.closest('label').classList.toggle('selected',this.checked)"> ${name}`;
    container.appendChild(label);
  });
}

function renderGroupSchedList() {
  const container = document.getElementById('groupSchedList');
  const myScheds  = groupSchedules.filter(s => s.group_id === groupSchedGid);
  if (!myScheds.length) {
    container.innerHTML = `<div style="padding:16px;font-family:'Public Sans',sans-serif;font-size:11px;color:#737971;text-align:center">No schedules yet</div>`;
    return;
  }
  container.innerHTML = '';
  const DAY_N = ['S','M','T','W','T','F','S'];
  for (const s of myScheds) {
    const row = document.createElement('div');
    row.className = 'sched-row';
    const dayTags = DAY_N.map((n, i) =>
      `<span class="sched-day-tag ${s.days_of_week.includes(i)?'active':''}">${n}</span>`
    ).join('');
    row.innerHTML = `
      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex-shrink:0">
        <input type="checkbox" ${s.enabled?'checked':''} onchange="updateGroupSched('${s.id}',{enabled:this.checked})" style="accent-color:#17361d">
        <span style="font-size:10px;color:#737971">${s.enabled?'On':'Off'}</span>
      </label>
      <div style="display:flex;gap:3px">${dayTags}</div>
      <span style="font-family:'Public Sans',monospace;font-size:11px">${(s.start_time||'').slice(0,5)}</span>
      <span style="font-family:'Public Sans',monospace;font-size:11px;color:#737971;flex:1">${s.label||''}</span>
      <button class="btn sm danger" onclick="deleteGroupSched('${s.id}')">✕</button>`;
    container.appendChild(row);
  }
}

async function addGroupSchedule() {
  const errEl = document.getElementById('groupSchedErr');
  errEl.style.display = 'none';
  const days  = Array.from(document.querySelectorAll('#groupSchedDays input:checked')).map(c => parseInt(c.value));
  const time  = document.getElementById('groupSchedTime').value;
  const label = document.getElementById('groupSchedLabel').value.trim();
  if (!days.length) { errEl.textContent = 'Select at least one day'; errEl.style.display = 'block'; return; }
  if (!time)        { errEl.textContent = 'Select a start time';     errEl.style.display = 'block'; return; }

  const { error } = await sb.from('group_schedules').insert({
    group_id: groupSchedGid, device_id: irrigDevice.id, customer_id: irrigDevice.customer_id,
    label, days_of_week: days, start_time: time + ':00', enabled: true
  });
  if (error) { errEl.textContent = 'Error: ' + error.message; errEl.style.display = 'block'; return; }

  await loadGroups();
  renderGroupSchedList();
  document.getElementById('groupSchedLabel').value = '';
  buildGroupDayCheckboxes();
  addLog(`Group "${zoneGroups.find(g=>g.id===groupSchedGid)?.name}" schedule added`, 'system');
}

async function deleteGroupSched(id) {
  await sb.from('group_schedules').delete().eq('id', id);
  await loadGroups();
  renderGroupSchedList();
}

async function updateGroupSched(id, patch) {
  await sb.from('group_schedules').update(patch).eq('id', id);
  await loadGroups();
  renderGroupSchedList();
}
