// ═══════════════════════════════════════════════════════════
// AUTH — login, signup, logout, session restore
// ═══════════════════════════════════════════════════════════
function showTab(tab) {
  document.getElementById('tabLogin').style.display  = tab === 'login'  ? '' : 'none';
  document.getElementById('tabSignup').style.display = tab === 'signup' ? '' : 'none';
  document.querySelectorAll('.auth-tab').forEach((el, i) => {
    el.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'signup'));
  });
  clearAuthErr();
}
function showAuthErr(msg) { const el = document.getElementById('authErr'); el.textContent = msg; el.classList.add('visible'); }
function clearAuthErr() { document.getElementById('authErr').classList.remove('visible'); }

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPass').value;
  if (!email || !pass) return showAuthErr('Email and password required');
  clearAuthErr();
  const btn = document.querySelector('#tabLogin .btn.primary');
  btn.disabled = true; btn.textContent = 'Logging in…';
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  btn.disabled = false; btn.textContent = 'Log in';
  if (error) return showAuthErr(error.message);
  onLogin(data.user);
}

async function doSignup() {
  const name  = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const pass  = document.getElementById('signupPass').value;
  if (!name || !email || !pass) return showAuthErr('All fields required');
  if (pass.length < 8) return showAuthErr('Password must be at least 8 characters');
  clearAuthErr();
  const btn = document.querySelector('#tabSignup .btn.primary');
  btn.disabled = true; btn.textContent = 'Creating account…';
  const { data, error } = await sb.auth.signUp({ email, password: pass, options: { data: { name } } });
  btn.disabled = false; btn.textContent = 'Create account';
  if (error) return showAuthErr(error.message);
  if (data.user) { onLogin(data.user); }
  else { showAuthErr('Account created — check your email to confirm, then log in.'); showTab('login'); }
}

async function doLogout() {
  sessionStorage.removeItem('supportSession');
  await sb.auth.signOut();
  currentUser = null; isAdmin = false;
  irrigZoneStates   = {};
  zoneStartTimes    = {};
  zoneCommandedOnAt = {};
  Object.values(zoneOffTimers).forEach(t => clearTimeout(t));
  zoneOffTimers = {};
  zoneOffAt     = {};
  zoneNames       = {};
  zoneSchedules   = [];
  zoneGroups      = [];
  groupMembers    = {};
  groupSchedules  = [];
  if (realtimeChannel) { sb.removeChannel(realtimeChannel); realtimeChannel = null; realtimeConnected = false; }
  document.getElementById('adminBadge').style.display = 'none';
  document.getElementById('adminTabBtn').style.display = 'none';
  showView('dashboard');
  document.getElementById('appScreen').style.display = 'none';
  document.getElementById('authScreen').style.display = '';
}

function loadConfig() { return Promise.resolve(true); }

async function onLogin(user) {
  currentUser = user;
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = '';

  const name = user.user_metadata?.name || user.email;
  document.getElementById('userPill').textContent = name;
  document.getElementById('footerName').textContent = 'FarmControl v2.0 — ' + name;

  document.getElementById('adminBadge').style.display = 'none';
  document.getElementById('adminTabBtn').style.display = 'none';
  isAdmin = false;

  const { data: profile } = await sb.from('profiles').select('is_admin').eq('id', user.id).single();
  isAdmin = profile?.is_admin === true;
  if (isAdmin) {
    document.getElementById('adminBadge').style.display = '';
    document.getElementById('adminTabBtn').style.display = '';
  }

  showView('dashboard');
  await initChart();

  // Admins: restore any support session that was active before a page refresh
  const savedSupport = isAdmin ? sessionStorage.getItem('supportSession') : null;
  if (savedSupport) {
    try {
      const { customerId, customerName } = JSON.parse(savedSupport);
      await loadUserDevices();
      initScheduler();
      await connectToCustomerDevice(customerId, customerName);
      loadHistory();
      return;
    } catch (e) {
      sessionStorage.removeItem('supportSession');
      // fall through to normal login
    }
  }

  // Normal login — load the current user's devices and all zone data
  await loadUserDevices();
  await loadZoneNames();
  if (typeof initZoneSchedBoard === 'function') initZoneSchedBoard();
  await loadSchedules();
  await loadGroups();
  initScheduler();
  if (irrigDevice) { irrigSetOnline(false); refreshHistoryChart(168); }
  connect();
  loadHistory();
}

// Restore session on page load
sb.auth.getSession().then(({ data }) => { if (data.session) onLogin(data.session.user); });
