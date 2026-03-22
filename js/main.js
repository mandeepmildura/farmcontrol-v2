// ═══════════════════════════════════════════════════════════
// MAIN — view switching, navigation
// ═══════════════════════════════════════════════════════════
const VIEWS = ['dashboard', 'zones', 'pressure', 'schedule', 'log', 'admin'];

function showView(view) {
  VIEWS.forEach(v => {
    const el = document.getElementById('view-' + v);
    if (el) el.style.display = v === view ? '' : 'none';
  });

  // Update mobile bottom nav
  document.querySelectorAll('.nav-item[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });

  // Update desktop floating nav
  document.querySelectorAll('.nav-item-desktop[data-view]').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });

  if (view === 'admin') loadAdminData();
  if (view === 'schedule') {
    if (typeof renderWeeklyGrid === 'function') renderWeeklyGrid();
  }
  if (view === 'log') {
    if (typeof refreshZoneActivity === 'function') refreshZoneActivity();
  }
}
