// ═══════════════════════════════════════════════════════════
// ADMIN — customer and device management
// ═══════════════════════════════════════════════════════════
async function loadAdminData() {
  if (!isAdmin) return;

  const { data: profiles } = await sb.from('profiles')
    .select('id, name, email, is_admin')
    .order('email');

  const { data: devices } = await sb.from('devices')
    .select('*')
    .order('sort_order');

  allCustomers = profiles || [];
  allDevices   = devices  || [];

  const customers = allCustomers.filter(p => !p.is_admin);
  document.getElementById('statCustomers').textContent = customers.length;
  document.getElementById('statDevices').textContent   = allDevices.length;
  document.getElementById('statFilters').textContent   = allDevices.filter(d => d.device_type === 'filter').length;
  document.getElementById('statIrrig').textContent     = allDevices.filter(d => d.device_type === 'irrigation').length;

  const sel = document.getElementById('deviceCustomer');
  sel.innerHTML = '<option value="">— select customer —</option>';
  allCustomers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = (p.name || p.email) + ' — ' + p.email;
    sel.appendChild(opt);
  });

  renderCustomerTable(allCustomers, allDevices);
}

function renderCustomerTable(customers, devs) {
  const tbody = document.getElementById('customerRows');
  if (!customers.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#737971;font-family:\'Public Sans\',sans-serif;font-size:12px;padding:32px">No customers found</td></tr>';
    return;
  }

  tbody.innerHTML = customers.map(p => {
    const custDevs  = devs.filter(d => d.customer_id === p.id);
    const roleClass = p.is_admin ? 'admin' : 'customer';
    const roleLabel = p.is_admin ? 'Admin' : 'Customer';
    const deviceRows = custDevs.length
      ? custDevs.map(d => `
          <tr>
            <td colspan="5" style="padding:0;background:#f3f4f1;">
              <div style="display:flex;align-items:center;gap:12px;padding:8px 16px 8px 48px;border-bottom:1px solid #c2c8bf;font-family:'Public Sans',sans-serif;font-size:11px;">
                <span class="role-badge ${esc(d.device_type)}">${esc(d.device_type)}</span>
                <span style="font-weight:600;color:#1a1c1a">${esc(d.device_name || d.device_id)}</span>
                <span style="color:#737971">${esc(d.mqtt_topic_base)}</span>
                <span style="color:#737971;margin-left:auto">#${esc(d.sort_order)}</span>
                <button class="btn sm secondary" onclick="openTransfer('${esc(d.id)}')">Transfer</button>
                <button class="btn sm danger" onclick="deleteDevice('${esc(d.id)}')">Remove</button>
              </div>
            </td>
          </tr>`).join('')
      : `<tr><td colspan="5" style="padding:8px 16px 8px 48px;background:#f3f4f1;font-family:'Public Sans',sans-serif;font-size:11px;color:#737971;border-bottom:1px solid #c2c8bf;">No devices assigned</td></tr>`;

    return `
      <tr>
        <td>${esc(p.name) || '—'}</td>
        <td>${esc(p.email) || '—'}</td>
        <td><span class="role-badge ${roleClass}">${roleLabel}</span></td>
        <td style="font-family:'Public Sans',sans-serif;font-size:12px;">${custDevs.length}</td>
        <td>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${!p.is_admin ? `<button class="btn sm action" onclick="toggleAdmin('${esc(p.id)}', true)">Make Admin</button>` : `<button class="btn sm secondary" onclick="toggleAdmin('${esc(p.id)}', false)">Revoke Admin</button>`}
            ${!p.is_admin && custDevs.length > 0 ? `<button class="btn sm primary" onclick="connectToCustomerDevice('${esc(p.id)}','${esc(p.name||p.email).replace(/'/g,"\\'")}')">Support</button>` : ''}
          </div>
        </td>
      </tr>
      ${deviceRows}`;
  }).join('');
}

function filterCustomers(query) {
  const q = query.toLowerCase().trim();
  if (!q) { renderCustomerTable(allCustomers, allDevices); return; }
  const filtered = allCustomers.filter(p =>
    (p.name || '').toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q)
  );
  renderCustomerTable(filtered, allDevices);
}

async function toggleAdmin(userId, makeAdmin) {
  const { error } = await sb.from('profiles').update({ is_admin: makeAdmin }).eq('id', userId);
  if (error) { alert('Error: ' + error.message); return; }
  loadAdminData();
}

async function deleteDevice(deviceId) {
  if (!confirm('Remove this device?')) return;
  const { error } = await sb.from('devices').delete().eq('id', deviceId);
  if (error) { alert('Error: ' + error.message); return; }
  addLog('Device removed', 'system');
  loadAdminData();
}

async function addDevice() {
  const errEl = document.getElementById('addDeviceErr');
  errEl.style.display = 'none';
  const customerId = document.getElementById('deviceCustomer').value;
  const deviceId   = document.getElementById('deviceId').value.trim();
  const deviceName = document.getElementById('deviceName').value.trim();
  const deviceType = document.getElementById('deviceType').value;
  const topic      = document.getElementById('deviceTopic').value.trim();
  const sortOrder  = parseInt(document.getElementById('deviceSort').value) || 1;

  if (!customerId || !deviceId || !deviceType || !topic) {
    errEl.textContent = 'Customer, Device ID, Type and Topic are required';
    errEl.style.display = 'block'; return;
  }

  const { error } = await sb.from('devices').insert({
    customer_id: customerId, device_id: deviceId, device_name: deviceName,
    device_type: deviceType, mqtt_topic_base: topic, sort_order: sortOrder, enabled: true
  });

  if (error) { errEl.textContent = error.message; errEl.style.display = 'block'; return; }

  document.getElementById('deviceId').value = '';
  document.getElementById('deviceName').value = '';
  document.getElementById('deviceTopic').value = '';
  document.getElementById('deviceSort').value = '1';
  addLog('Device added: ' + deviceId, 'system');
  loadAdminData();
}

// ── Transfer device ──
let transferDeviceId = null;

function openTransfer(deviceId) {
  transferDeviceId = deviceId;
  const dev = allDevices.find(d => d.id === deviceId);
  document.getElementById('transferDeviceName').textContent = 'Device: ' + (dev?.device_name || dev?.device_id || deviceId);
  document.getElementById('transferErr').classList.remove('visible');

  const sel = document.getElementById('transferCustomer');
  sel.innerHTML = '<option value="">— select customer —</option>';
  allCustomers.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = (p.name || p.email) + ' — ' + p.email;
    sel.appendChild(opt);
  });

  document.getElementById('transferModal').classList.add('visible');
}

function closeTransfer() {
  transferDeviceId = null;
  document.getElementById('transferModal').classList.remove('visible');
}

async function doTransfer() {
  const errEl = document.getElementById('transferErr');
  errEl.classList.remove('visible');
  const newCustomerId = document.getElementById('transferCustomer').value;
  if (!newCustomerId) { errEl.textContent = 'Please select a customer'; errEl.classList.add('visible'); return; }
  if (!transferDeviceId) return;

  const { error } = await sb.from('devices').update({ customer_id: newCustomerId }).eq('id', transferDeviceId);
  if (error) { errEl.textContent = error.message; errEl.classList.add('visible'); return; }

  closeTransfer();
  addLog('Device transferred to new customer', 'system');
  loadAdminData();
}

// ── Add customer modal ──
function openAddCustomer() { document.getElementById('addCustomerModal').classList.add('visible'); }
function closeAddCustomer() { document.getElementById('addCustomerModal').classList.remove('visible'); }

async function createCustomer() {
  const errEl = document.getElementById('addCustErr');
  errEl.classList.remove('visible');
  const name  = document.getElementById('custName').value.trim();
  const email = document.getElementById('custEmail').value.trim();
  const pass  = document.getElementById('custPass').value;

  if (!name || !email || !pass) { errEl.textContent = 'All fields required'; errEl.classList.add('visible'); return; }
  if (pass.length < 8) { errEl.textContent = 'Password must be at least 8 characters'; errEl.classList.add('visible'); return; }

  const btn = document.querySelector('#addCustomerModal .btn.primary');
  btn.disabled = true; btn.textContent = 'Creating…';
  const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { name } } });
  btn.disabled = false; btn.textContent = 'Create Account';
  if (error) { errEl.textContent = error.message; errEl.classList.add('visible'); return; }

  if (data.user) {
    await sb.from('profiles').upsert({ id: data.user.id, email, name, is_admin: false });
  }

  closeAddCustomer();
  document.getElementById('custName').value = '';
  document.getElementById('custEmail').value = '';
  document.getElementById('custPass').value = '';
  addLog('Customer created: ' + email, 'system');
  loadAdminData();
}
