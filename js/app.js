/* ==========================================================================
   Stock Opname Management System — App logic (prototype / UI-UX phase)
   Data layer uses localStorage as a stand-in for Supabase so the interface
   is fully clickable end-to-end. Every place a real Supabase call will go
   is marked with `// SUPABASE:` so migration in later phases is a
   find-and-replace exercise, per the PRD's services/ folder plan.
   ========================================================================== */

const STORAGE_KEY = 'so_app_state_v1';
const TODAY = new Date('2026-09-11T10:00:00');

let state = null;
let charts = {};
let ui = {
  role: 'Admin',
  currentUser: null,
  selectedLocationId: null,
  selectedSkuId: null,
  rekapPage: 1,
  barangPage: 1,
  lokasiPage: 1,
  importTarget: null, // 'barang' | 'lokasi'
  importStep: 1,
};

/* ---------------------------------- Bootstrap / persistence ---------------------------------- */

function loadState(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw){
    try {
      const parsed = JSON.parse(raw);
      // Merge in anything added by a later version so upgrading an existing
      // session never silently loses a new module's permissions or setting.
      const defaultPerms = defaultPermissions();
      parsed.permissions = parsed.permissions || {};
      Object.keys(defaultPerms).forEach(m=>{ if (!parsed.permissions[m]) parsed.permissions[m] = defaultPerms[m]; });
      parsed.settings = parsed.settings || {};
      if (parsed.settings.low_stock_threshold === undefined) parsed.settings.low_stock_threshold = SEED_SETTINGS.low_stock_threshold;
      if (parsed.settings.default_warehouse_id === undefined) parsed.settings.default_warehouse_id = SEED_SETTINGS.default_warehouse_id;
      return parsed;
    } catch(e){ /* fall through to seed */ }
  }
  return {
    warehouses: SEED_WAREHOUSES,
    skus: SEED_SKUS,
    locations: SEED_LOCATIONS,
    staff: SEED_STAFF,
    suppliers: SEED_SUPPLIERS,
    customers: SEED_CUSTOMERS,
    balances: SEED_BALANCES,
    stockMovements: SEED_STOCK_MOVEMENTS,
    soItems: SEED_SO_ITEMS,
    barangMasukItems: SEED_BARANG_MASUK,
    barangKeluarItems: SEED_BARANG_KELUAR,
    transferGudangItems: SEED_TRANSFER_GUDANG,
    transferLokasiItems: SEED_TRANSFER_LOKASI,
    auditLogs: SEED_AUDIT_LOGS,
    settings: SEED_SETTINGS,
    permissions: defaultPermissions(),
    soCounter: 100,
    bmCounter: 20,
    bkCounter: 20,
    tgCounter: 15,
    tlCounter: 15,
  };
}

function defaultPermissions(){
  const modules = ['Dashboard','Stock Gudang','Input SO','Input Barang Masuk','Input Barang Keluar','Transfer Antar Gudang','Transfer Antar Lokasi','Laporan Stock','Rekap SO','Master Data','Audit Log','Pengaturan'];
  const operatorCreateModules = ['Stock Gudang','Input SO','Input Barang Masuk','Input Barang Keluar','Transfer Antar Gudang','Transfer Antar Lokasi'];
  const operatorNoViewModules = ['Master Data','Audit Log','Pengaturan'];
  const perms = {};
  modules.forEach(m=>{
    perms[m] = {
      Admin: { view:true, create:true, update:true, delete:true },
      Operator: {
        view: !operatorNoViewModules.includes(m),
        create: operatorCreateModules.includes(m),
        update: false,
        delete: false,
      }
    };
  });
  return perms;
}

function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function logAudit(action, module, detail){
  const entry = {
    id: 'log-' + Date.now(),
    user_name: ui.currentUser ? ui.currentUser.name : 'System',
    action, module, detail,
    created_at: new Date().toISOString().slice(0,19)
  };
  state.auditLogs.unshift(entry);
  // SUPABASE: insert into audit_logs (append-only, RLS: admin can select, no delete policy)
}

/* ---------------------------------- Utilities ---------------------------------- */

function fmtNum(n){ return Math.round(n).toLocaleString('id-ID'); }
function fmtSigned(n){ return (n>0?'+':'') + fmtNum(n); }
function fmtDate(iso){
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtDateTime(iso){
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' }) + ' · ' +
         d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
}
function todayStr(){ return TODAY.toISOString().slice(0,10); }
function daysAgoStr(n){
  const d = new Date(TODAY); d.setDate(d.getDate()-n);
  return d.toISOString().slice(0,10);
}
function debounce(fn, wait){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); };
}
function toast(msg, icon='success'){
  Swal.fire({ toast:true, position:'top-end', icon, title: msg, showConfirmButton:false, timer:2600, timerProgressBar:true });
}
function initials(name){
  return name.split(' ').map(p=>p[0]).slice(0,2).join('').toUpperCase();
}
function statusBadgeClass(status){
  if (status==='Sesuai') return 'badge-success';
  if (status==='Selisih Plus') return 'badge-info';
  if (status==='Selisih Minus') return 'badge-danger';
  return 'badge-neutral';
}

/* Lookup maps kept fresh after any state mutation */
let mSku={}, mLoc={}, mWh={}, mStaff={}, mSupplier={}, mCustomer={};
function rebuildIndexes(){
  mSku = Object.fromEntries(state.skus.map(s=>[s.id,s]));
  mLoc = Object.fromEntries(state.locations.map(l=>[l.id,l]));
  mWh  = Object.fromEntries(state.warehouses.map(w=>[w.id,w]));
  mStaff = Object.fromEntries(state.staff.map(s=>[s.id,s]));
  mSupplier = Object.fromEntries(state.suppliers.map(s=>[s.id,s]));
  mCustomer = Object.fromEntries(state.customers.map(s=>[s.id,s]));
}
/* Safe accessors — historical SO/audit records may reference a master record
   that was later deleted; these keep the UI from breaking in that case. */
function safeSku(id){ return mSku[id] || { sku:'(dihapus)', nama_produk:'SKU tidak ditemukan', kategori:'-', unit:'-' }; }
function safeLoc(id){ return mLoc[id] || { code:'(dihapus)', name:'Lokasi tidak ditemukan', warehouse_id:null, location_type:'-' }; }
function safeWh(id){ return mWh[id] || { name:'—', code:'—' }; }
function safeStaff(id){ return mStaff[id] || { name:'(Staff dihapus)', email:'-' }; }
function safeSupplier(id){ return mSupplier[id] || { name:'(Supplier dihapus)' }; }
function safeCustomer(id){ return mCustomer[id] || { name:'(Customer dihapus)' }; }

/* ==========================================================================
   STOCK LEDGER ENGINE
   Qty Stock per SKU+Lokasi is never stored directly — it is always the sum
   of every movement ever posted against that pair. Every future feature
   (Barang Masuk, Barang Keluar, Transfer, SO) posts through postMovement();
   nothing mutates a "qty" field on a balance record directly.
   ========================================================================== */

function getQtySystem(skuId, locId){
  return state.stockMovements.reduce((sum,m)=> (m.sku_id===skuId && m.location_id===locId) ? sum + m.qty : sum, 0);
}

function postMovement({ tipe, sku_id, location_id, qty, ref_type, ref_doc, supplier_id=null, customer_id=null, related_movement_id=null, catatan='' }){
  const loc = mLoc[location_id];
  const entry = {
    id: 'mv-' + Date.now() + Math.random().toString(36).slice(2,6),
    tanggal: todayStr(),
    waktu: new Date().toISOString().slice(0,19),
    tipe, sku_id, location_id,
    warehouse_id: loc ? loc.warehouse_id : null,
    qty, ref_type, ref_doc, supplier_id, customer_id, related_movement_id, catatan,
    created_by: ui.currentUser ? ui.currentUser.name : 'System',
  };
  // SUPABASE: insert into stock_movements (append-only ledger; qty_system is a VIEW that SUMs this table)
  state.stockMovements.push(entry);
  return entry;
}

/* Which SKU+Lokasi pairs actually have ledger history — used to guide the
   Input SO combo search toward pairs that will return a real Qty System. */
function skusAtLocation(locId){
  return new Set(state.stockMovements.filter(m=>m.location_id===locId).map(m=>m.sku_id));
}
function locationsForSku(skuId){
  return new Set(state.stockMovements.filter(m=>m.sku_id===skuId).map(m=>m.location_id));
}
function hasAnyMovement(skuId, locId){
  return state.stockMovements.some(m=>m.sku_id===skuId && m.location_id===locId);
}

/* ==========================================================================
   AUTH
   Real Supabase Auth. `staff` table rows are linked to auth.users via
   auth_user_id (see the on_auth_user_created trigger in
   supabase_auth_trigger.sql) — signing in fetches that row to get the
   person's role, name, and warehouse.
   ========================================================================== */

function initAuth(){
  document.getElementById('showRegister').addEventListener('click', (e)=>{
    e.preventDefault();
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('registerForm').classList.remove('hidden');
  });
  document.getElementById('showLogin').addEventListener('click', (e)=>{
    e.preventDefault();
    document.getElementById('registerForm').classList.add('hidden');
    document.getElementById('loginForm').classList.remove('hidden');
  });

  document.getElementById('loginForm').addEventListener('submit', (e)=>{
    e.preventDefault();
    handleLogin();
  });

  document.getElementById('registerForm').addEventListener('submit', (e)=>{
    e.preventDefault();
    handleRegister();
  });

  checkExistingSession();
}

function setFormBusy(formId, busy, busyLabel, idleLabel){
  const btn = document.querySelector(`#${formId} button[type=submit]`);
  btn.disabled = busy;
  btn.textContent = busy ? busyLabel : idleLabel;
}

async function loadStaffForUser(authUser){
  let staffRow, error;
  try {
    ({ data: staffRow, error } = await supabaseClient
      .from('staff')
      .select('*')
      .eq('auth_user_id', authUser.id)
      .maybeSingle());
  } catch(e){
    Swal.fire({ icon:'error', title:'Tidak bisa terhubung', text:'Gagal mengambil data staff, coba lagi.' });
    return false;
  }

  if (error || !staffRow){
    await supabaseClient.auth.signOut();
    Swal.fire({ icon:'error', title:'Akun belum terhubung', text:'Akun ini belum tertaut ke data staff — hubungi admin.' });
    return false;
  }

  ui.role = staffRow.role;
  ui.currentUser = staffRow;

  // Bridge into the still-local staff array (Master Data/Staff and the rest of
  // the app haven't migrated off it yet — that's Sub-Fase 3) so a brand-new
  // sign-up shows up correctly everywhere right away.
  const existing = state.staff.find(s=>s.id===staffRow.id);
  if (existing) Object.assign(existing, staffRow); else state.staff.push(staffRow);
  rebuildIndexes();

  document.getElementById('authScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('topbarUserName').textContent = ui.currentUser.name;
  document.getElementById('avatarInitial').textContent = initials(ui.currentUser.name);
  document.querySelectorAll('[data-admin-only]').forEach(el=>{
    el.style.display = ui.role === 'Admin' ? '' : 'none';
  });

  logAudit('LOGIN', 'Auth', `Login sebagai ${ui.role} (${ui.currentUser.name})`);
  saveState();
  goToPage('dashboard');
  return true;
}

async function checkExistingSession(){
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) await loadStaffForUser(session.user);
  } catch(e){
    console.error('checkExistingSession failed', e);
  }
}

async function handleLogin(){
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  setFormBusy('loginForm', true, 'Memproses…', 'Masuk');

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error){
      Swal.fire({ icon:'error', title:'Tidak bisa masuk', text: error.message.includes('Invalid') ? 'Email atau kata sandi salah.' : error.message });
      return;
    }
    await loadStaffForUser(data.user);
  } catch(e){
    Swal.fire({ icon:'error', title:'Tidak bisa terhubung', text:'Gagal menghubungi server, coba lagi.' });
  } finally {
    setFormBusy('loginForm', false, 'Memproses…', 'Masuk');
  }
}

async function handleRegister(){
  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  setFormBusy('registerForm', true, 'Memproses…', 'Daftar & Masuk');

  try {
    const { data, error } = await supabaseClient.auth.signUp({ email, password, options: { data: { name } } });
    if (error){
      Swal.fire({ icon:'error', title:'Tidak bisa daftar', text: error.message });
      return;
    }
    if (!data.session){
      // Project has "Confirm email" turned on — no usable session yet.
      Swal.fire({ icon:'info', title:'Cek email Anda', text:'Klik link konfirmasi yang dikirim ke email Anda, lalu masuk di sini.' });
      document.getElementById('registerForm').classList.add('hidden');
      document.getElementById('loginForm').classList.remove('hidden');
      return;
    }
    toast('Akun dibuat');
    await loadStaffForUser(data.user);
  } catch(e){
    Swal.fire({ icon:'error', title:'Tidak bisa terhubung', text:'Gagal menghubungi server, coba lagi.' });
  } finally {
    setFormBusy('registerForm', false, 'Memproses…', 'Daftar & Masuk');
  }
}

function logout(){
  Swal.fire({
    title:'Keluar dari akun?',
    text:'Sesi Anda akan diakhiri.',
    icon:'question', showCancelButton:true,
    confirmButtonText:'Ya, keluar', cancelButtonText:'Batal',
    confirmButtonColor:'#DC2626'
  }).then(async res=>{
    if (res.isConfirmed){
      try { await supabaseClient.auth.signOut(); } catch(e){ console.error('signOut failed', e); }
      document.getElementById('appShell').classList.add('hidden');
      document.getElementById('authScreen').classList.remove('hidden');
      document.getElementById('loginForm').classList.remove('hidden');
      document.getElementById('registerForm').classList.add('hidden');
    }
  });
}

/* ==========================================================================
   NAVIGATION
   ========================================================================== */

const PAGE_META = {
  'dashboard': ['Dashboard', 'Ringkasan kondisi stock opname secara real-time'],
  'stock-gudang': ['Stock Gudang', 'Posisi stok per SKU dan lokasi, dihitung dari seluruh riwayat mutasi'],
  'input-so': ['Input Stock Opname', 'Catat hasil hitung fisik dan bandingkan dengan Qty System'],
  'barang-masuk': ['Input Barang Masuk', 'Catat penerimaan barang dari supplier'],
  'barang-keluar': ['Input Barang Keluar', 'Catat pengeluaran barang untuk customer'],
  'transfer-gudang': ['Transfer Antar Gudang', 'Pindahkan stok dari satu gudang ke gudang lain'],
  'transfer-lokasi': ['Transfer Antar Lokasi', 'Pindahkan stok antar lokasi dalam satu gudang'],
  'laporan-stock': ['Laporan Stock', 'Kartu stok — riwayat mutasi lengkap per SKU'],
  'rekap': ['Rekap Stock Opname', 'Telusuri dan ekspor seluruh hasil stock opname'],
  'master': ['Master Data', 'Kelola data acuan barang, lokasi, dan staff'],
  'audit': ['Audit Log', 'Riwayat aktivitas sensitif pada sistem'],
  'settings': ['Pengaturan', 'Identitas perusahaan dan preferensi sistem'],
};

function goToPage(page){
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active', b.dataset.page===page));
  document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active', p.id === 'page-'+page));
  document.getElementById('pageTitle').textContent = PAGE_META[page][0];
  closeMobileSidebar();

  if (page==='dashboard') renderCurrentDashboard();
  if (page==='stock-gudang') renderStockGudang();
  if (page==='input-so') renderInputSO();
  if (page==='barang-masuk') renderBarangMasuk();
  if (page==='barang-keluar') renderBarangKeluar();
  if (page==='transfer-gudang') renderTransferGudang();
  if (page==='transfer-lokasi') renderTransferLokasi();
  if (page==='laporan-stock') renderLaporanStock();
  if (page==='rekap') renderRekap();
  if (page==='master') renderMaster();
  if (page==='audit') renderAudit();
  if (page==='settings') renderSettings();
}

function initNav(){
  document.querySelectorAll('.nav-item').forEach(btn=>{
    btn.addEventListener('click', ()=> goToPage(btn.dataset.page));
  });
  document.getElementById('btnLogout').addEventListener('click', logout);
  document.getElementById('sidebarInputBtn').addEventListener('click', ()=> goToPage('input-so'));
  document.getElementById('heroGotoRekap').addEventListener('click', ()=> goToPage('rekap'));
  document.getElementById('btnNotif').addEventListener('click', ()=>{
    Swal.fire({icon:'info', title:'Notifikasi', text:'Belum ada notifikasi baru.'});
  });

  document.getElementById('menuToggle').addEventListener('click', openMobileSidebar);
  document.getElementById('sidebarClose').addEventListener('click', closeMobileSidebar);
  document.getElementById('sidebarBackdrop').addEventListener('click', closeMobileSidebar);
}
function openMobileSidebar(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarBackdrop').classList.add('show');
}
function closeMobileSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarBackdrop').classList.remove('show');
}

/* ==========================================================================
   SHARED FILTER OPTION POPULATION
   ========================================================================== */

function fillSelect(el, items, {value, label, keepFirst=true}={}){
  const first = keepFirst ? el.querySelector('option') : null;
  el.innerHTML = '';
  if (first) el.appendChild(first);
  items.forEach(it=>{
    const opt = document.createElement('option');
    opt.value = value(it); opt.textContent = label(it);
    el.appendChild(opt);
  });
}

function populateSharedFilters(){
  const activeStaff = state.staff.filter(s=>s.is_active);
  const jenisLokasiSet = [...new Set(state.locations.map(l=>l.location_type))];

  ['filterGudang','rkGudang','lokasiGudangFilter','sgGudang','duGudang'].forEach(id=>{
    fillSelect(document.getElementById(id), state.warehouses, { value:w=>w.id, label:w=>w.name });
  });
  ['filterOperator','rkOperator','auditUser'].forEach(id=>{
    fillSelect(document.getElementById(id), activeStaff, { value:s=>s.id, label:s=>s.name });
  });
  ['filterJenisLokasi','rkJenisLokasi','lokasiJenisFilter','sgJenisLokasi'].forEach(id=>{
    fillSelect(document.getElementById(id), jenisLokasiSet, { value:j=>j, label:j=>j });
  });
  const kategoriSet = [...new Set(state.skus.map(s=>s.kategori))];
  ['barangKategoriFilter','sgKategori'].forEach(id=>{
    fillSelect(document.getElementById(id), kategoriSet, { value:k=>k, label:k=>k });
  });

  const moduleSet = [...new Set(state.auditLogs.map(a=>a.module))];
  const actionSet = [...new Set(state.auditLogs.map(a=>a.action))];
  fillSelect(document.getElementById('auditModule'), moduleSet, { value:m=>m, label:m=>m });
  fillSelect(document.getElementById('auditAction'), actionSet, { value:a=>a, label:a=>a });
}

/* ==========================================================================
   DASHBOARD
   ========================================================================== */

function locMatchesJenis(loc, jenis){ return jenis==='all' || loc.location_type === jenis; }
function locMatchesGudang(loc, whId){ return whId==='all' || loc.warehouse_id === whId; }

function getDashboardFilters(){
  return {
    periode: parseInt(document.getElementById('filterPeriode').value, 10),
    gudang: document.getElementById('filterGudang').value,
    operator: document.getElementById('filterOperator').value,
    jenisLokasi: document.getElementById('filterJenisLokasi').value,
  };
}

function filteredBalances(f){
  // "Target" positions now come from the ledger (distinct SKU+Lokasi pairs that
  // have ever had a movement), not the old static balances snapshot.
  const seen = new Set();
  const pairs = [];
  state.stockMovements.forEach(m=>{
    const key = m.sku_id+'::'+m.location_id;
    if (seen.has(key)) return;
    const loc = mLoc[m.location_id];
    if (!loc) return;
    if (!locMatchesGudang(loc, f.gudang) || !locMatchesJenis(loc, f.jenisLokasi)) return;
    seen.add(key);
    pairs.push({ sku_id: m.sku_id, location_id: m.location_id });
  });
  return pairs;
}

function filteredSoItems(f){
  const cutoff = daysAgoStr(f.periode);
  return state.soItems.filter(it=>{
    if (!it.is_final) return false;
    if (it.tanggal < cutoff) return false;
    if (f.operator !== 'all' && it.operator_id !== f.operator) return false;
    const loc = mLoc[it.location_id];
    if (!loc) return false;
    if (!locMatchesGudang(loc, f.gudang)) return false;
    if (!locMatchesJenis(loc, f.jenisLokasi)) return false;
    return true;
  });
}

/* ==========================================================================
   DASHBOARD TOGGLE (Utama <-> SO)
   One "Dashboard" menu, two views sharing the page — matches the confirmed
   design of offering both as an option rather than two separate menu items.
   ========================================================================== */

let currentDashTab = 'utama';

function initDashToggle(){
  document.querySelectorAll('.dash-toggle-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      currentDashTab = btn.dataset.dash;
      document.querySelectorAll('.dash-toggle-btn').forEach(b=>b.classList.toggle('active', b===btn));
      document.getElementById('dashboardUtamaView').classList.toggle('active', currentDashTab==='utama');
      document.getElementById('dashboardSoView').classList.toggle('active', currentDashTab==='so');
      renderCurrentDashboard();
    });
  });
  document.getElementById('duGotoStockGudang').addEventListener('click', ()=> goToPage('stock-gudang'));
}

function renderCurrentDashboard(){
  if (currentDashTab === 'utama') renderDashboardUtama();
  else renderDashboard();
}

/* ==========================================================================
   DASHBOARD UTAMA
   General inventory overview across every module — stock levels, in/out
   volume, warehouse comparison, low-stock alerts, and a unified activity
   feed. Independent of the SO-specific dashboard below.
   ========================================================================== */

function getDashUtamaFilters(){
  return {
    periode: parseInt(document.getElementById('duPeriode').value, 10),
    gudang: document.getElementById('duGudang').value,
  };
}

function initDashUtamaFilters(){
  ['duPeriode','duGudang'].forEach(id=>{
    document.getElementById(id).addEventListener('change', renderDashboardUtama);
  });
}

/* Combine SO + Barang Masuk/Keluar + both Transfer histories into one
   normalized, chronologically-sortable feed. */
function buildActivityFeed(limit, gudangFilter){
  const items = [];
  state.soItems.forEach(i=> items.push({ waktu:i.waktu, tipe:'Stock Opname', badge:'badge-neutral', sku_id:i.sku_id, location_id:i.location_id, warehouse_id:i.warehouse_id, qty:i.selisih, ket:i.status }));
  state.barangMasukItems.forEach(i=> items.push({ waktu:i.waktu, tipe:'Barang Masuk', badge:'badge-info', sku_id:i.sku_id, location_id:i.location_id, warehouse_id:i.warehouse_id, qty:i.qty, ket: safeSupplier(i.supplier_id).name }));
  state.barangKeluarItems.forEach(i=> items.push({ waktu:i.waktu, tipe:'Barang Keluar', badge:'badge-danger', sku_id:i.sku_id, location_id:i.location_id, warehouse_id:i.warehouse_id, qty:-i.qty, ket: safeCustomer(i.customer_id).name }));
  state.transferGudangItems.forEach(i=> items.push({ waktu:i.waktu, tipe:'Transfer Gudang', badge:'badge-warning', sku_id:i.sku_id, location_id:i.source_location_id, warehouse_id:i.source_warehouse_id, qty:i.qty, ket: `${safeLoc(i.source_location_id).code} → ${safeLoc(i.dest_location_id).code}` }));
  state.transferLokasiItems.forEach(i=> items.push({ waktu:i.waktu, tipe:'Transfer Lokasi', badge:'badge-warning', sku_id:i.sku_id, location_id:i.source_location_id, warehouse_id:i.warehouse_id, qty:i.qty, ket: `${safeLoc(i.source_location_id).code} → ${safeLoc(i.dest_location_id).code}` }));
  const filtered = gudangFilter==='all' ? items : items.filter(it=>it.warehouse_id===gudangFilter);
  return filtered.sort((a,b)=> b.waktu.localeCompare(a.waktu)).slice(0, limit);
}

function renderDashboardUtama(){
  const f = getDashUtamaFilters();
  const cutoff = daysAgoStr(f.periode);

  const positions = getStockPositions(todayStr()).filter(p=>{
    if (f.gudang==='all') return true;
    return safeLoc(p.location_id).warehouse_id === f.gudang;
  });
  const totalQty = positions.reduce((s,p)=>s+p.qty,0);
  const LOW_STOCK_THRESHOLD = state.settings.low_stock_threshold ?? 5;
  const lowStock = positions.filter(p=>p.qty<=LOW_STOCK_THRESHOLD).sort((a,b)=>a.qty-b.qty);

  const inMovements = state.stockMovements.filter(m=> m.tipe==='IN' && m.tanggal>=cutoff && (f.gudang==='all' || safeLoc(m.location_id).warehouse_id===f.gudang));
  const outMovements = state.stockMovements.filter(m=> m.tipe==='OUT' && m.tanggal>=cutoff && (f.gudang==='all' || safeLoc(m.location_id).warehouse_id===f.gudang));
  const transferCount = new Set(state.stockMovements.filter(m=> m.tipe==='TRANSFER_OUT' && m.tanggal>=cutoff && (f.gudang==='all' || safeLoc(m.location_id).warehouse_id===f.gudang)).map(m=>m.ref_doc)).size;
  const qtyMasuk = inMovements.reduce((s,m)=>s+m.qty,0);
  const qtyKeluar = outMovements.reduce((s,m)=>s+Math.abs(m.qty),0);

  document.getElementById('duHeroDesc').textContent =
    `${fmtNum(state.skus.filter(s=>s.is_active).length)} SKU aktif tersebar di ${fmtNum(state.warehouses.filter(w=>w.is_active).length)} gudang dengan total ${fmtNum(totalQty)} unit stok. ${fmtNum(lowStock.length)} posisi butuh perhatian karena stoknya menipis atau kosong.`;

  const kpis = [
    { icon:'inventory_2', color:'#2563EB', label:'Total SKU Aktif', value: fmtNum(state.skus.filter(s=>s.is_active).length) },
    { icon:'warehouse', color:'#0D9488', label:'Total Gudang', value: fmtNum(state.warehouses.filter(w=>w.is_active).length) },
    { icon:'location_on', color:'#7C3AED', label:'Total Lokasi Aktif', value: fmtNum(state.locations.filter(l=>l.is_active).length) },
    { icon:'stacks', color:'#15803D', label:'Total Qty Stock', value: fmtNum(totalQty) },
    { icon:'move_to_inbox', color:'#2563EB', label:`Barang Masuk (${f.periode}h)`, value: fmtNum(qtyMasuk) },
    { icon:'outbox', color:'#DC2626', label:`Barang Keluar (${f.periode}h)`, value: fmtNum(qtyKeluar) },
    { icon:'sync_alt', color:'#F59E0B', label:`Transfer (${f.periode}h)`, value: fmtNum(transferCount) },
    { icon:'warning', color:'#DC2626', label:'Stok Menipis/Kosong', value: fmtNum(lowStock.length) },
  ];
  document.getElementById('duKpiGrid').innerHTML = kpis.map(k=>`
    <div class="kpi-card">
      <div class="kpi-card-head"><div class="kpi-icon" style="background:${k.color}"><span class="material-symbols-outlined">${k.icon}</span></div></div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join('');

  renderLowStockTable(lowStock);
  renderActivityTable(f.gudang);
  renderDashUtamaCharts(f, positions);
}

function renderLowStockTable(lowStock){
  const rows = lowStock.slice(0,8);
  document.querySelector('#lowStockTable tbody').innerHTML = rows.length ? rows.map(p=>{
    const sku=safeSku(p.sku_id), loc=safeLoc(p.location_id);
    return `<tr>
      <td class="cell-strong">${sku.sku}</td><td>${sku.nama_produk}</td><td>${loc.code}</td>
      <td class="cell-muted">${safeWh(loc.warehouse_id).name}</td>
      <td class="cell-strong" style="color:${p.qty<=0?'var(--danger)':'var(--warning)'}">${fmtNum(p.qty)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted);">Tidak ada posisi dengan stok menipis pada filter ini.</td></tr>`;
}

function renderActivityTable(gudangFilter){
  const rows = buildActivityFeed(10, gudangFilter);
  document.querySelector('#activityTable tbody').innerHTML = rows.length ? rows.map(r=>{
    const sku=safeSku(r.sku_id), loc=safeLoc(r.location_id);
    return `<tr>
      <td class="cell-muted">${fmtDateTime(r.waktu)}</td>
      <td><span class="badge ${r.badge}">${r.tipe}</span></td>
      <td class="cell-strong">${sku.sku}</td>
      <td>${loc.code}</td>
      <td style="color:${r.qty>0?'var(--info)':r.qty<0?'var(--danger)':'var(--text-muted)'};font-weight:700;">${fmtSigned(r.qty)}</td>
      <td class="cell-muted">${r.ket}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-muted);">Belum ada aktivitas.</td></tr>`;
}

function renderDashUtamaCharts(f, positions){
  if (!chartsAvailable()) return;
  const palette = ['#0D9488','#16A34A','#2563EB','#F59E0B','#DC2626','#7C3AED','#DB2777','#0EA5E9'];

  const days = [...Array(7)].map((_,i)=> daysAgoStr(6-i));
  const masukData = days.map(d=> state.stockMovements.filter(m=>m.tipe==='IN' && m.tanggal===d && (f.gudang==='all'||safeLoc(m.location_id).warehouse_id===f.gudang)).reduce((s,m)=>s+m.qty,0));
  const keluarData = days.map(d=> state.stockMovements.filter(m=>m.tipe==='OUT' && m.tanggal===d && (f.gudang==='all'||safeLoc(m.location_id).warehouse_id===f.gudang)).reduce((s,m)=>s+Math.abs(m.qty),0));
  destroyChart('inOutTrend');
  charts.inOutTrend = new Chart(document.getElementById('chartInOutTrend'), {
    type:'bar',
    data:{ labels: days.map(d=>fmtDate(d).slice(0,6)), datasets:[
      { label:'Masuk', data: masukData, backgroundColor:'#2563EB', borderRadius:6 },
      { label:'Keluar', data: keluarData, backgroundColor:'#DC2626', borderRadius:6 },
    ]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:true, position:'bottom', labels:{boxWidth:10} } } }
  });

  const byKategori = {};
  positions.forEach(p=>{ const kat = safeSku(p.sku_id).kategori; byKategori[kat] = (byKategori[kat]||0) + Math.max(0,p.qty); });
  destroyChart('kategoriDonut');
  charts.kategoriDonut = new Chart(document.getElementById('chartKategoriDonut'), {
    type:'doughnut',
    data:{ labels:Object.keys(byKategori), datasets:[{ data:Object.values(byKategori), backgroundColor:palette, borderWidth:0 }]},
    options:{ responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{ legend:{display:false} } }
  });
  document.getElementById('legendKategoriDonut').innerHTML = legendHtml(Object.keys(byKategori).map((k,i)=>[k, palette[i%palette.length]]));

  // Always compares every gudang, regardless of the filter above — that's the point of this chart
  const allPositions = getStockPositions(todayStr());
  const byWh = {};
  state.warehouses.forEach(w=> byWh[w.id] = 0);
  allPositions.forEach(p=>{ const whId = safeLoc(p.location_id).warehouse_id; if (whId in byWh) byWh[whId] += Math.max(0,p.qty); });
  destroyChart('qtyPerGudang');
  charts.qtyPerGudang = new Chart(document.getElementById('chartQtyPerGudang'), {
    type:'bar',
    data:{ labels: state.warehouses.map(w=>w.name), datasets:[{ data: state.warehouses.map(w=>byWh[w.id]), backgroundColor:'#15803D', borderRadius:8, maxBarThickness:60 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } }
  });

  const bySku = {};
  positions.forEach(p=>{ bySku[p.sku_id] = (bySku[p.sku_id]||0) + Math.max(0,p.qty); });
  const topSku = Object.entries(bySku).sort((a,b)=>b[1]-a[1]).slice(0,10);
  destroyChart('topStokSku');
  charts.topStokSku = new Chart(document.getElementById('chartTopStokSku'), {
    type:'bar',
    data:{ labels: topSku.map(([id])=>safeSku(id).sku), datasets:[{ data: topSku.map(([,v])=>v), backgroundColor: palette, borderRadius:6 }]},
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } }
  });
}

function renderDashboard(){
  const f = getDashboardFilters();
  const balances = filteredBalances(f);
  const items = filteredSoItems(f);

  const targetCount = balances.length;
  const doneKeys = new Set(items.map(it=>it.sku_id+'::'+it.location_id));
  const sudahCount = balances.filter(b=>doneKeys.has(b.sku_id+'::'+b.location_id)).length;
  const belumCount = Math.max(0, targetCount - sudahCount);
  const progress = targetCount ? Math.round((sudahCount/targetCount)*100) : 0;

  const sesuai = items.filter(i=>i.status==='Sesuai').length;
  const plus = items.filter(i=>i.status==='Selisih Plus').length;
  const minus = items.filter(i=>i.status==='Selisih Minus').length;
  const selisihTotal = plus+minus;
  const lineAccuracy = items.length ? (sesuai/items.length*100) : 100;
  const totalSkuActive = state.skus.filter(s=>s.is_active).length;

  document.getElementById('heroDesc').textContent =
    `${sudahCount.toLocaleString('id-ID')} dari ${targetCount.toLocaleString('id-ID')} target SKU-lokasi-gudang sudah dihitung fisik pada ${f.periode} hari terakhir. Sisa ${belumCount.toLocaleString('id-ID')} target belum di-SO.`;
  document.getElementById('heroProgressFill').style.width = progress+'%';
  document.getElementById('heroProgressLabel').textContent = progress+'% selesai';
  document.getElementById('heroProgressTarget').textContent = `${sudahCount} dari ${targetCount} target`;

  const kpis = [
    { icon:'inventory_2', color:'#2563EB', label:'Total SKU Aktif', value: fmtNum(totalSkuActive) },
    { icon:'verified', color:'#15803D', label:`Akurasi (${f.periode} hari)`, value: lineAccuracy.toFixed(1)+'%' },
    { icon:'task_alt', color:'#16A34A', label:'Sudah SO', value: fmtNum(sudahCount) },
    { icon:'hourglass_empty', color:'#F59E0B', label:'Belum SO', value: fmtNum(belumCount) },
    { icon:'trending_up', color:'#0D9488', label:'Progress SO', value: progress+'%' },
    { icon:'check_circle', color:'#16A34A', label:'Barang Sesuai', value: fmtNum(sesuai) },
    { icon:'error_outline', color:'#DC2626', label:'Barang Selisih', value: fmtNum(selisihTotal) },
    { icon:'arrow_upward', color:'#2563EB', label:'Selisih Plus', value: fmtNum(plus) },
    { icon:'arrow_downward', color:'#DC2626', label:'Selisih Minus', value: fmtNum(minus) },
  ];
  document.getElementById('kpiGrid').innerHTML = kpis.map(k=>`
    <div class="kpi-card">
      <div class="kpi-card-head">
        <div class="kpi-icon" style="background:${k.color}"><span class="material-symbols-outlined">${k.icon}</span></div>
      </div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-label">${k.label}</div>
    </div>`).join('');

  renderAttentionTable(balances, doneKeys, items);
  renderDashboardCharts(f, items, sesuai, plus, minus, sudahCount, belumCount);
}

function renderAttentionTable(balances, doneKeys, items){
  const rows = [];
  // repeated-variance SKUs/locations (appear with non-Sesuai status more than once)
  const varCount = {};
  items.filter(i=>i.status!=='Sesuai').forEach(i=>{
    const k = i.sku_id+'::'+i.location_id;
    varCount[k] = (varCount[k]||0)+1;
  });
  Object.entries(varCount).filter(([,c])=>c>=2).slice(0,4).forEach(([k])=>{
    const [skuId, locId] = k.split('::');
    rows.push({ sku: safeSku(skuId), loc: safeLoc(locId), tag: 'Selisih Berulang', cls: 'badge-warning' });
  });
  // uncounted targets
  balances.filter(b=>!doneKeys.has(b.sku_id+'::'+b.location_id)).slice(0,6-rows.length).forEach(b=>{
    rows.push({ sku: safeSku(b.sku_id), loc: safeLoc(b.location_id), tag: 'Belum SO', cls: 'badge-neutral' });
  });

  document.querySelector('#attentionTable tbody').innerHTML = rows.length ? rows.map(r=>`
    <tr>
      <td class="cell-strong">${r.sku.sku}</td>
      <td>${r.sku.nama_produk}</td>
      <td>${r.loc.code}</td>
      <td class="cell-muted">${safeWh(r.loc.warehouse_id).name}</td>
      <td><span class="badge ${r.cls}">${r.tag}</span></td>
    </tr>`).join('') :
    `<tr><td colspan="5" class="cell-muted" style="text-align:center;padding:24px;">Semua target pada filter ini sudah tertangani dengan baik.</td></tr>`;
}

function destroyChart(id){ if (charts[id]){ charts[id].destroy(); delete charts[id]; } }

// Chart.js is loaded from a CDN (index.html); if that request ever fails
// (flaky network, blocked by an extension, CDN hiccup) `Chart` stays
// undefined and `new Chart(...)` throws, which used to abort whatever
// caller was mid-render (including the silent session-restore flow on
// page load). Both chart-rendering functions below check this first so a
// failed CDN load degrades to a clear message instead of a crash.
function chartsAvailable(){
  if (typeof Chart !== 'undefined') return true;
  console.warn('Chart.js belum termuat (gagal dimuat dari CDN) — grafik dilewati untuk render ini.');
  document.querySelectorAll('.chart-canvas-wrap').forEach(wrap=>{
    if (!wrap.querySelector('.chart-load-error')){
      wrap.insertAdjacentHTML('beforeend', `<div class="chart-load-error" style="display:flex;align-items:center;justify-content:center;height:100%;min-height:120px;color:var(--text-muted);font-size:13px;text-align:center;padding:16px;">Gagal memuat library grafik.<br>Coba muat ulang halaman.</div>`);
    }
  });
  return false;
}

function renderDashboardCharts(f, items, sesuai, plus, minus, sudahCount, belumCount){
  if (!chartsAvailable()) return;
  const palette = ['#0D9488','#16A34A','#2563EB','#F59E0B','#DC2626','#7C3AED','#DB2777','#0EA5E9'];

  // Trend 7 hari
  const days = [...Array(7)].map((_,i)=> daysAgoStr(6-i));
  const trendData = days.map(d=>{
    const dayItems = state.soItems.filter(it=>it.tanggal===d && it.is_final);
    if (!dayItems.length) return null;
    return +(dayItems.filter(i=>i.status==='Sesuai').length/dayItems.length*100).toFixed(1);
  });
  destroyChart('trend');
  charts.trend = new Chart(document.getElementById('chartTrend'), {
    type:'line',
    data:{ labels: days.map(d=>fmtDate(d).slice(0,6)), datasets:[{
      label:'Akurasi %', data: trendData, borderColor:'#15803D', backgroundColor:'rgba(21,128,61,.1)',
      fill:true, tension:.35, spanGaps:true, pointRadius:4, pointBackgroundColor:'#15803D'
    }]},
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ min:80, max:100, ticks:{ callback:v=>v+'%' } } }, plugins:{ legend:{display:false} } }
  });

  // Akurasi per operator
  const activeStaff = state.staff.filter(s=>s.is_active);
  const opLabels = activeStaff.map(s=>s.name.split(' ')[0]);
  const opData = activeStaff.map(s=>{
    const opItems = items.filter(i=>i.operator_id===s.id);
    return opItems.length ? +(opItems.filter(i=>i.status==='Sesuai').length/opItems.length*100).toFixed(1) : 0;
  });
  destroyChart('operator');
  charts.operator = new Chart(document.getElementById('chartOperator'), {
    type:'bar',
    data:{ labels: opLabels, datasets:[{ label:'Akurasi %', data: opData, backgroundColor:'#0D9488', borderRadius:8, maxBarThickness:36 }]},
    options:{ responsive:true, maintainAspectRatio:false, scales:{ y:{ min:0, max:100 } }, plugins:{ legend:{display:false} } }
  });

  // Status SO donut
  destroyChart('statusDonut');
  charts.statusDonut = new Chart(document.getElementById('chartStatusDonut'), {
    type:'doughnut',
    data:{ labels:['Sudah SO','Belum SO'], datasets:[{ data:[sudahCount, belumCount], backgroundColor:['#15803D','#E6EAF0'], borderWidth:0 }]},
    options:{ responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{ legend:{display:false} } }
  });
  document.getElementById('legendStatusDonut').innerHTML = legendHtml([['Sudah SO','#15803D'],['Belum SO','#E6EAF0']]);

  // Distribusi Sesuai/Plus/Minus
  destroyChart('distribution');
  charts.distribution = new Chart(document.getElementById('chartDistribution'), {
    type:'doughnut',
    data:{ labels:['Sesuai','Selisih Plus','Selisih Minus'], datasets:[{ data:[sesuai,plus,minus], backgroundColor:['#16A34A','#2563EB','#DC2626'], borderWidth:0 }]},
    options:{ responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{ legend:{display:false} } }
  });
  document.getElementById('legendDistribution').innerHTML = legendHtml([['Sesuai','#16A34A'],['Selisih Plus','#2563EB'],['Selisih Minus','#DC2626']]);

  // Distribusi level akurasi per SKU
  const bySku = {};
  items.forEach(i=>{ (bySku[i.sku_id] = bySku[i.sku_id]||[]).push(i); });
  const buckets = {'100%':0, '99–99,9%':0, '95–98,9%':0, '<95%':0};
  Object.values(bySku).forEach(arr=>{
    const acc = arr.filter(i=>i.status==='Sesuai').length/arr.length*100;
    if (acc===100) buckets['100%']++;
    else if (acc>=99) buckets['99–99,9%']++;
    else if (acc>=95) buckets['95–98,9%']++;
    else buckets['<95%']++;
  });
  destroyChart('accLevel');
  charts.accLevel = new Chart(document.getElementById('chartAccuracyLevel'), {
    type:'bar',
    data:{ labels:Object.keys(buckets), datasets:[{ data:Object.values(buckets), backgroundColor:['#15803D','#16A34A','#F59E0B','#DC2626'], borderRadius:8 }]},
    options:{ responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } }
  });

  // Top 10 SKU variance
  const varBySku = {};
  items.forEach(i=>{ varBySku[i.sku_id] = (varBySku[i.sku_id]||0) + Math.abs(i.selisih); });
  const topSku = Object.entries(varBySku).sort((a,b)=>b[1]-a[1]).slice(0,10);
  destroyChart('topSku');
  charts.topSku = new Chart(document.getElementById('chartTopSku'), {
    type:'bar',
    data:{ labels: topSku.map(([id])=>safeSku(id).sku), datasets:[{ data: topSku.map(([,v])=>v), backgroundColor: palette, borderRadius:6 }]},
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } }
  });

  // Top 10 lokasi variance
  const varByLoc = {};
  items.forEach(i=>{ varByLoc[i.location_id] = (varByLoc[i.location_id]||0) + Math.abs(i.selisih); });
  const topLoc = Object.entries(varByLoc).sort((a,b)=>b[1]-a[1]).slice(0,10);
  destroyChart('topLoc');
  charts.topLoc = new Chart(document.getElementById('chartTopLokasi'), {
    type:'bar',
    data:{ labels: topLoc.map(([id])=>safeLoc(id).code), datasets:[{ data: topLoc.map(([,v])=>v), backgroundColor: palette, borderRadius:6 }]},
    options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{ legend:{display:false} } }
  });
}

function legendHtml(pairs){
  return pairs.map(([label,color])=>`<span class="legend-item"><span class="legend-dot" style="background:${color}"></span>${label}</span>`).join('');
}

function initDashboardFilters(){
  ['filterPeriode','filterGudang','filterOperator','filterJenisLokasi'].forEach(id=>{
    document.getElementById(id).addEventListener('change', renderDashboard);
  });
}

/* ==========================================================================
   STOCK GUDANG
   Live stock position table, entirely derived from the ledger. Every row is
   a distinct SKU+Lokasi pair that has ever had a movement; "Qty Stok" is the
   sum of movements up to (and including) the chosen as-of date.
   ========================================================================== */

let sgPage = 1;

function initStockGudang(){
  document.getElementById('sgTanggal').value = todayStr();
  ['sgTanggal','sgGudang','sgJenisLokasi','sgKategori'].forEach(id=>{
    document.getElementById(id).addEventListener('change', ()=>{ sgPage=1; renderStockGudang(); });
  });
  ['sgSkuSearch','sgLokasiSearch','sgQtyMin','sgQtyMax'].forEach(id=>{
    document.getElementById(id).addEventListener('input', debounce(()=>{ sgPage=1; renderStockGudang(); }, 200));
  });
  document.getElementById('btnResetFilterStock').addEventListener('click', ()=>{
    document.getElementById('sgTanggal').value = todayStr();
    ['sgSkuSearch','sgLokasiSearch','sgQtyMin','sgQtyMax'].forEach(id=>document.getElementById(id).value='');
    ['sgGudang','sgJenisLokasi','sgKategori'].forEach(id=>document.getElementById(id).value='all');
    sgPage = 1; renderStockGudang();
  });
  document.getElementById('btnExportStockCsv').addEventListener('click', exportStockCsv);
  document.getElementById('btnExportStockPdf').addEventListener('click', exportStockPdf);
}

/* Every distinct SKU+Lokasi pair that has ledger history, with qty summed
   only up to the chosen as-of date — this is what makes "Stok per Tanggal"
   a real point-in-time position instead of just today's snapshot. */
function getStockPositions(asOfDate){
  const seen = new Map();
  state.stockMovements.forEach(m=>{
    if (m.tanggal > asOfDate) return;
    const key = m.sku_id+'::'+m.location_id;
    if (!seen.has(key)) seen.set(key, { sku_id:m.sku_id, location_id:m.location_id, qty:0, lastDate:m.tanggal });
    const pos = seen.get(key);
    pos.qty += m.qty;
    if (m.tanggal > pos.lastDate) pos.lastDate = m.tanggal;
  });
  return [...seen.values()];
}

function getStockGudangFiltered(){
  const asOf = document.getElementById('sgTanggal').value || todayStr();
  const skuQ = document.getElementById('sgSkuSearch').value.trim().toLowerCase();
  const locQ = document.getElementById('sgLokasiSearch').value.trim().toLowerCase();
  const gudang = document.getElementById('sgGudang').value;
  const jenis = document.getElementById('sgJenisLokasi').value;
  const kategori = document.getElementById('sgKategori').value;
  const qtyMinRaw = document.getElementById('sgQtyMin').value;
  const qtyMaxRaw = document.getElementById('sgQtyMax').value;
  const qtyMin = qtyMinRaw==='' ? null : parseFloat(qtyMinRaw);
  const qtyMax = qtyMaxRaw==='' ? null : parseFloat(qtyMaxRaw);

  return getStockPositions(asOf).filter(p=>{
    const sku = safeSku(p.sku_id), loc = safeLoc(p.location_id);
    if (skuQ && !(sku.sku.toLowerCase().includes(skuQ) || sku.nama_produk.toLowerCase().includes(skuQ))) return false;
    if (locQ && !(loc.code.toLowerCase().includes(locQ) || loc.name.toLowerCase().includes(locQ))) return false;
    if (gudang!=='all' && loc.warehouse_id!==gudang) return false;
    if (jenis!=='all' && loc.location_type!==jenis) return false;
    if (kategori!=='all' && sku.kategori!==kategori) return false;
    if (qtyMin!==null && p.qty < qtyMin) return false;
    if (qtyMax!==null && p.qty > qtyMax) return false;
    return true;
  }).sort((a,b)=> safeSku(a.sku_id).sku.localeCompare(safeSku(b.sku_id).sku));
}

function renderStockGudang(){
  const rows = getStockGudangFiltered();
  const totalQty = rows.reduce((s,p)=>s+p.qty,0);
  const emptyCount = rows.filter(p=>p.qty<=0).length;

  document.getElementById('stockSummaryGrid').innerHTML = [
    { v: fmtNum(rows.length), l:'Total Posisi SKU-Lokasi' },
    { v: fmtNum(totalQty), l:'Total Qty Stok' },
    { v: fmtNum(emptyCount), l:'Posisi Stok Kosong/Minus' },
  ].map(s=>`<div class="summary-card"><div class="summary-value">${s.v}</div><div class="summary-label">${s.l}</div></div>`).join('');

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length/pageSize));
  sgPage = Math.min(sgPage, totalPages);
  const pageRows = rows.slice((sgPage-1)*pageSize, sgPage*pageSize);

  document.querySelector('#stockGudangTable tbody').innerHTML = pageRows.length ? pageRows.map((p,idx)=>{
    const sku = safeSku(p.sku_id), loc = safeLoc(p.location_id);
    return `<tr>
      <td>${(sgPage-1)*pageSize + idx + 1}</td>
      <td class="cell-strong">${sku.sku}</td>
      <td>${sku.nama_produk}</td>
      <td class="cell-muted">${sku.kategori}</td>
      <td>${loc.code}</td>
      <td class="cell-muted">${loc.location_type}</td>
      <td class="cell-muted">${safeWh(loc.warehouse_id).name}</td>
      <td class="cell-strong" style="${p.qty<=0?'color:var(--danger);':''}">${fmtNum(p.qty)}</td>
      <td class="cell-muted">${fmtDate(p.lastDate)}</td>
      <td><button class="btn btn-secondary btn-xs" data-so-cepat data-sku="${p.sku_id}" data-loc="${p.location_id}"><span class="material-symbols-outlined" style="font-size:15px;">bolt</span> SO Cepat</button></td>
    </tr>`;
  }).join('') : `<tr><td colspan="10" style="text-align:center;padding:30px;color:var(--text-muted);">Tidak ada posisi stok yang cocok dengan filter.</td></tr>`;

  document.querySelectorAll('[data-so-cepat]').forEach(btn=>{
    btn.addEventListener('click', ()=> openQuickSOModal(btn.dataset.sku, btn.dataset.loc));
  });

  renderPagination('stockGudangPagination', sgPage, totalPages, rows.length, p=>{ sgPage=p; renderStockGudang(); });
}

function openQuickSOModal(skuId, locationId){
  const sku = safeSku(skuId), loc = safeLoc(locationId);
  const qtySystem = getQtySystem(skuId, locationId);
  openModal('SO Cepat', `
    <div class="lookup-filled" style="margin-bottom:16px;">
      <div class="lookup-product">
        <span class="lookup-thumb material-symbols-outlined">package_2</span>
        <div><p class="lookup-name">${sku.nama_produk}</p><p class="lookup-meta">${sku.sku} · ${loc.code} · ${safeWh(loc.warehouse_id).name}</p></div>
      </div>
      <div class="lookup-qty-box"><span class="lookup-qty-label">Qty System</span><span class="lookup-qty-value">${fmtNum(qtySystem)}</span></div>
    </div>
    <div class="form-grid form-grid-2">
      <label class="field"><span class="field-label">Qty Fisik <span class="req">*</span></span><input type="number" id="qsoQtyFisik" min="0" required autofocus></label>
      <div class="field"><span class="field-label">Selisih &amp; Status</span>
        <div class="selisih-box" id="qsoSelisihBox">
          <span class="selisih-value" id="qsoSelisihValue">0</span>
          <span class="badge badge-neutral" id="qsoStatusBadge">Menunggu input</span>
        </div>
      </div>
    </div>
    <label class="field"><span class="field-label">Catatan <span class="req hidden" id="qsoCatatanReq">*</span></span><textarea id="qsoCatatan" rows="2" placeholder="Wajib diisi jika terjadi selisih…"></textarea></label>
    <p class="text-muted-sm">Langsung final begitu disimpan — tidak ada langkah approval terpisah, tapi tercatat penuh di Audit Log.</p>
  `, ()=>{
    const qtyFisikRaw = document.getElementById('qsoQtyFisik').value;
    if (qtyFisikRaw === '' || parseFloat(qtyFisikRaw) < 0){ toast('Qty Fisik wajib diisi (≥ 0)', 'warning'); return; }
    const qtyFisik = parseFloat(qtyFisikRaw);
    const selisih = qtyFisik - qtySystem;
    const catatan = document.getElementById('qsoCatatan').value.trim();
    if (selisih !== 0 && !catatan){ toast('Catatan wajib diisi karena terjadi selisih', 'warning'); return; }
    const item = finalizeSO({
      skuId, locationId, operatorId: ui.currentUser.id, tanggal: todayStr(),
      qtySystem, qtyFisik, catatan, sourceLabel: 'SO Cepat'
    });
    toast(`SO Cepat tersimpan — ${item.so_number}`);
    renderStockGudang();
  });

  document.getElementById('qsoQtyFisik').addEventListener('input', ()=>{
    const raw = document.getElementById('qsoQtyFisik').value;
    const badge = document.getElementById('qsoStatusBadge');
    const valueEl = document.getElementById('qsoSelisihValue');
    const catatanReq = document.getElementById('qsoCatatanReq');
    const catatanInput = document.getElementById('qsoCatatan');
    if (raw===''){
      valueEl.textContent='0'; valueEl.style.color='';
      badge.textContent='Menunggu input'; badge.className='badge badge-neutral';
      catatanReq.classList.add('hidden'); catatanInput.required=false;
      return;
    }
    const qf = parseFloat(raw)||0;
    const sel = qf - qtySystem;
    valueEl.textContent = fmtSigned(sel);
    let status = 'Sesuai'; if (sel>0) status='Selisih Plus'; if (sel<0) status='Selisih Minus';
    valueEl.style.color = sel===0?'var(--success)':(sel>0?'var(--info)':'var(--danger)');
    badge.textContent = status; badge.className = 'badge ' + statusBadgeClass(status);
    const needsNote = sel!==0;
    catatanReq.classList.toggle('hidden', !needsNote);
    catatanInput.required = needsNote;
  });
}

function exportStockCsv(){
  const rows = getStockGudangFiltered();
  if (!rows.length){ toast('Tidak ada data untuk diekspor', 'warning'); return; }
  const asOf = document.getElementById('sgTanggal').value || todayStr();
  const header = ['No','SKU','Nama Produk','Kategori','Lokasi','Jenis Lokasi','Gudang','Qty Stok','Update Terakhir'];
  const lines = [header.join(';')];
  rows.forEach((p,idx)=>{
    const sku=safeSku(p.sku_id), loc=safeLoc(p.location_id);
    lines.push([idx+1, sku.sku, sku.nama_produk.replace(/;/g,','), sku.kategori, loc.code, loc.location_type, safeWh(loc.warehouse_id).name, p.qty, p.lastDate].join(';'));
  });
  downloadBlob('\uFEFF'+lines.join('\n'), `Stock_Gudang_${asOf}.csv`, 'text/csv;charset=utf-8;');
  logAudit('EXPORT', 'Stock Gudang', `Export ${rows.length} baris posisi stok (per ${fmtDate(asOf)}) ke CSV/XLSX`);
  saveState();
  toast('File CSV terunduh (kompatibel dengan Excel)');
}

function exportStockPdf(){
  const rows = getStockGudangFiltered();
  if (!rows.length){ toast('Tidak ada data untuk diekspor', 'warning'); return; }
  const asOf = document.getElementById('sgTanggal').value || todayStr();
  const totalQty = rows.reduce((s,p)=>s+p.qty,0);
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>Laporan Stock Gudang</title>
    <style>
      body{font-family:Arial,sans-serif;padding:32px;color:#172B24;}
      h1{margin-bottom:2px;} .muted{color:#64748B;font-size:12px;}
      table{width:100%;border-collapse:collapse;margin-top:18px;font-size:11px;}
      th,td{border:1px solid #E6EAF0;padding:6px 8px;text-align:left;}
      th{background:#F1F5F9;} .summary{display:flex;gap:24px;margin-top:16px;}
      .box{border:1px solid #E6EAF0;border-radius:8px;padding:10px 16px;}
      .box b{display:block;font-size:16px;}
    </style></head><body>
    <h1>${state.settings.company_name}</h1>
    <p class="muted">Laporan Posisi Stock Gudang per ${fmtDate(asOf)}</p>
    <p class="muted">Dibuat: ${fmtDateTime(new Date().toISOString())}</p>
    <div class="summary">
      <div class="box"><b>${rows.length}</b>Total posisi</div>
      <div class="box"><b>${fmtNum(totalQty)}</b>Total qty</div>
    </div>
    <table><thead><tr><th>SKU</th><th>Nama Produk</th><th>Kategori</th><th>Lokasi</th><th>Gudang</th><th>Qty Stok</th><th>Update Terakhir</th></tr></thead>
    <tbody>${rows.map(p=>{
      const sku=safeSku(p.sku_id), loc=safeLoc(p.location_id);
      return `<tr><td>${sku.sku}</td><td>${sku.nama_produk}</td><td>${sku.kategori}</td><td>${loc.code}</td><td>${safeWh(loc.warehouse_id).name}</td><td>${p.qty}</td><td>${fmtDate(p.lastDate)}</td></tr>`;
    }).join('')}</tbody></table>
    </body></html>`);
  win.document.close();
  setTimeout(()=> win.print(), 300);
  logAudit('EXPORT', 'Stock Gudang', `Export ${rows.length} baris posisi stok (per ${fmtDate(asOf)}) ke PDF`);
  saveState();
}

/* ==========================================================================
   INPUT STOCK OPNAME
   ========================================================================== */

function initInputSO(){
  document.getElementById('soTanggal').value = todayStr();

  document.getElementById('soLokasiInput').addEventListener('input', debounce(onLokasiSearch, 180));
  document.getElementById('soSkuInput').addEventListener('input', debounce(onSkuSearch, 180));
  document.getElementById('soLokasiInput').addEventListener('focus', onLokasiSearch);
  document.getElementById('soSkuInput').addEventListener('focus', onSkuSearch);
  document.addEventListener('click', (e)=>{
    if (!e.target.closest('#soLokasiInput')) document.getElementById('soLokasiDropdown').classList.remove('open');
    if (!e.target.closest('#soSkuInput')) document.getElementById('soSkuDropdown').classList.remove('open');
  });

  document.getElementById('soQtyFisik').addEventListener('input', updateSelisih);

  document.getElementById('btnScan').addEventListener('click', ()=>{
    Swal.fire({ icon:'info', title:'Pemindai Barcode/QR', text:'Kamera aktif otomatis di perangkat (tablet/HP) yang mendukung. Pada desktop, gunakan pencarian manual di atas.' });
  });

  let submitMode = 'save';
  document.querySelectorAll('#formSO button[type=submit]').forEach(btn=>{
    btn.addEventListener('click', ()=> submitMode = btn.dataset.mode);
  });
  document.getElementById('formSO').addEventListener('submit', (e)=>{
    e.preventDefault();
    submitSO(submitMode);
  });
}

function renderInputSO(){
  fillSelect(document.getElementById('soGudang'), state.warehouses, { value:w=>w.id, label:w=>w.name });
  const opSelect = document.getElementById('soOperator');
  fillSelect(opSelect, state.staff.filter(s=>s.is_active), { value:s=>s.id, label:s=>s.name, keepFirst:false });
  if (ui.role === 'Operator'){
    opSelect.value = ui.currentUser.id;
    opSelect.disabled = true;
  } else {
    opSelect.disabled = false;
  }
  document.getElementById('soGudang').value = ui.currentUser.warehouse_id || state.settings.default_warehouse_id || state.warehouses[0].id;
  renderTodayFeed();
}

function onLokasiSearch(){
  const q = document.getElementById('soLokasiInput').value.trim().toLowerCase();
  const dd = document.getElementById('soLokasiDropdown');
  let results = state.locations.filter(l=>l.is_active && (l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q)));

  // If a SKU is already picked, surface locations that actually stock it first —
  // that's what makes Qty System come back non-zero instead of a fresh 0.
  const validLocs = ui.selectedSkuId ? locationsForSku(ui.selectedSkuId) : null;
  if (validLocs) results.sort((a,b)=> (validLocs.has(b.id)?1:0) - (validLocs.has(a.id)?1:0));
  results = results.slice(0,8);

  dd.innerHTML = results.length ? results.map(l=>{
    const registered = validLocs && validLocs.has(l.id);
    return `<div class="combo-option" data-id="${l.id}">
      <div class="combo-option-title">${l.code} ${registered?'<span class="combo-tag combo-tag-ok">Ada stok SKU ini</span>':''}</div>
      <div class="combo-option-sub">${l.name} · ${l.location_type} · ${mWh[l.warehouse_id].name}</div>
    </div>`;
  }).join('') : `<div class="combo-empty">Lokasi tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      ui.selectedLocationId = opt.dataset.id;
      const l = mLoc[ui.selectedLocationId];
      document.getElementById('soLokasiInput').value = `${l.code} — ${l.name}`;
      document.getElementById('soGudang').value = l.warehouse_id;
      dd.classList.remove('open');
      updateLookup();
    });
  });
}

function onSkuSearch(){
  const q = document.getElementById('soSkuInput').value.trim().toLowerCase();
  const dd = document.getElementById('soSkuDropdown');
  let results = state.skus.filter(s=>s.is_active && (s.sku.toLowerCase().includes(q) || s.nama_produk.toLowerCase().includes(q)));

  // If a Lokasi is already picked, surface SKUs actually stocked there first —
  // picking one of these guarantees a real Qty System value, not 0.
  const validSkus = ui.selectedLocationId ? skusAtLocation(ui.selectedLocationId) : null;
  if (validSkus) results.sort((a,b)=> (validSkus.has(b.id)?1:0) - (validSkus.has(a.id)?1:0));
  results = results.slice(0,8);

  dd.innerHTML = results.length ? results.map(s=>{
    const registered = validSkus && validSkus.has(s.id);
    return `<div class="combo-option" data-id="${s.id}">
      <div class="combo-option-title">${s.sku} ${registered?'<span class="combo-tag combo-tag-ok">Ada di lokasi ini</span>':''}</div>
      <div class="combo-option-sub">${s.nama_produk}</div>
    </div>`;
  }).join('') : `<div class="combo-empty">SKU tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      ui.selectedSkuId = opt.dataset.id;
      const s = mSku[ui.selectedSkuId];
      document.getElementById('soSkuInput').value = `${s.sku} — ${s.nama_produk}`;
      dd.classList.remove('open');
      updateLookup();
      document.getElementById('soQtyFisik').focus();
    });
  });
}

function updateLookup(){
  if (!ui.selectedLocationId || !ui.selectedSkuId) return;
  const sku = mSku[ui.selectedSkuId];
  const loc = mLoc[ui.selectedLocationId];
  const everMoved = hasAnyMovement(sku.id, loc.id);
  const qty = getQtySystem(sku.id, loc.id);

  document.getElementById('soLookupEmpty').classList.add('hidden');
  document.getElementById('soLookupFilled').classList.remove('hidden');
  document.getElementById('soLookupName').textContent = sku.nama_produk;
  document.getElementById('soLookupMeta').textContent = `${sku.sku} · ${sku.kategori} · ${loc.code}${everMoved ? '' : ' · belum pernah ada mutasi stok di lokasi ini — akan dicatat sebagai temuan baru'}`;
  document.getElementById('soQtySystem').textContent = fmtNum(qty);
  updateSelisih();
}

function updateSelisih(){
  const qtySystem = parseFloat(document.getElementById('soQtySystem').textContent.replace(/\./g,'')) || 0;
  const qtyFisikRaw = document.getElementById('soQtyFisik').value;
  const box = document.getElementById('soSelisihBox');
  const badge = document.getElementById('soStatusBadge');
  const valueEl = document.getElementById('soSelisihValue');
  const catatanReq = document.getElementById('soCatatanReq');
  const catatanInput = document.getElementById('soCatatan');

  if (qtyFisikRaw === ''){
    valueEl.textContent = '0'; valueEl.style.color = '';
    badge.textContent = 'Menunggu input'; badge.className = 'badge badge-neutral';
    catatanReq.classList.add('hidden'); catatanInput.required = false;
    return;
  }
  const qtyFisik = parseFloat(qtyFisikRaw) || 0;
  const selisih = qtyFisik - qtySystem;
  valueEl.textContent = fmtSigned(selisih);
  let status = 'Sesuai';
  if (selisih>0) status = 'Selisih Plus';
  if (selisih<0) status = 'Selisih Minus';
  valueEl.style.color = selisih===0 ? 'var(--success)' : (selisih>0 ? 'var(--info)' : 'var(--danger)');
  badge.textContent = status;
  badge.className = 'badge ' + statusBadgeClass(status);
  const needsNote = selisih !== 0;
  catatanReq.classList.toggle('hidden', !needsNote);
  catatanInput.required = needsNote;
}

/* Shared by the full Input SO form and the "SO Cepat" quick-action modal —
   one place owns "what happens when a physical count is finalized". */
function finalizeSO({ skuId, locationId, operatorId, tanggal, qtySystem, qtyFisik, catatan, sourceLabel='Input SO' }){
  const loc = mLoc[locationId];
  const selisih = qtyFisik - qtySystem;
  const status = selisih===0 ? 'Sesuai' : (selisih>0 ? 'Selisih Plus' : 'Selisih Minus');
  state.soCounter += 1;
  const soNumber = `SO-${tanggal.replace(/-/g,'')}-${String(state.soCounter).padStart(3,'0')}`;

  const item = {
    id: 'soi-' + Date.now() + Math.random().toString(36).slice(2,5),
    so_number: soNumber, tanggal, operator_id: operatorId,
    sku_id: skuId, location_id: locationId, warehouse_id: loc.warehouse_id,
    qty_system: qtySystem, qty_fisik: qtyFisik, selisih, status, catatan,
    is_final: true, recount_of_id: null,
    waktu: new Date().toISOString().slice(0,19)
  };
  // SUPABASE: insert into stock_opname_items (snapshot qty_system at time of count, per PRD §8/§21)
  state.soItems.unshift(item);
  if (selisih !== 0){
    // Auto-approved, no separate admin sign-off (per confirmed design) — the physical
    // count immediately becomes the new system truth, posted as one ledger entry.
    postMovement({
      tipe: 'SO_ADJUSTMENT', sku_id: skuId, location_id: locationId,
      qty: selisih, ref_type: sourceLabel, ref_doc: soNumber,
      catatan: `Koreksi SO: sistem ${fmtNum(qtySystem)} → fisik ${fmtNum(qtyFisik)}. ${catatan}`.trim()
    });
  }
  logAudit('SO', 'Stock Opname', `${soNumber} (${sourceLabel}): ${safeSku(skuId).sku} @ ${loc.code} — ${status}`);
  saveState();
  return item;
}

function submitSO(mode){
  if (!ui.selectedLocationId || !ui.selectedSkuId){
    toast('Pilih lokasi dan SKU terlebih dahulu', 'warning'); return;
  }
  const qtyFisikRaw = document.getElementById('soQtyFisik').value;
  if (qtyFisikRaw === '' || parseFloat(qtyFisikRaw) < 0){
    toast('Qty Fisik wajib diisi (≥ 0)', 'warning'); return;
  }
  const catatan = document.getElementById('soCatatan').value.trim();
  const qtySystem = parseFloat(document.getElementById('soQtySystem').textContent.replace(/\./g,'')) || 0;
  const qtyFisik = parseFloat(qtyFisikRaw);
  const selisih = qtyFisik - qtySystem;

  if (selisih !== 0 && !catatan){
    toast('Catatan wajib diisi karena terjadi selisih', 'warning'); return;
  }

  const tanggal = document.getElementById('soTanggal').value || todayStr();
  const item = finalizeSO({
    skuId: ui.selectedSkuId, locationId: ui.selectedLocationId,
    operatorId: document.getElementById('soOperator').value,
    tanggal, qtySystem, qtyFisik, catatan, sourceLabel: 'Input SO'
  });
  toast(`Tersimpan — ${item.so_number}`);

  document.getElementById('soQtyFisik').value = '';
  document.getElementById('soCatatan').value = '';
  updateSelisih();
  renderTodayFeed();

  if (mode === 'save-next'){
    // Operator stays in the same location, moves to the next SKU
    ui.selectedSkuId = null;
    document.getElementById('soSkuInput').value = '';
    document.getElementById('soLookupFilled').classList.add('hidden');
    document.getElementById('soLookupEmpty').classList.remove('hidden');
    document.getElementById('soSkuInput').focus();
  } else {
    ui.selectedSkuId = null; ui.selectedLocationId = null;
    document.getElementById('soSkuInput').value = '';
    document.getElementById('soLokasiInput').value = '';
    document.getElementById('soLookupFilled').classList.add('hidden');
    document.getElementById('soLookupEmpty').classList.remove('hidden');
  }
}

function renderTodayFeed(){
  const list = state.soItems.filter(i=>i.tanggal===todayStr()).sort((a,b)=> b.waktu.localeCompare(a.waktu));
  document.getElementById('todayCount').textContent = list.length;
  document.getElementById('todayInputList').innerHTML = list.length ? list.map(i=>`
    <div class="feed-item">
      <div class="feed-item-top">
        <span class="feed-item-sku">${safeSku(i.sku_id).sku}</span>
        <span class="badge ${statusBadgeClass(i.status)}">${i.status}</span>
      </div>
      <div class="feed-item-name">${safeSku(i.sku_id).nama_produk}</div>
      <div class="feed-item-meta">${safeLoc(i.location_id).code} · Sistem ${fmtNum(i.qty_system)} → Fisik ${fmtNum(i.qty_fisik)} · ${fmtDateTime(i.waktu).split('·')[1]}</div>
    </div>`).join('') : `<div class="feed-empty">Belum ada input hari ini.</div>`;
}

/* ==========================================================================
   INPUT BARANG MASUK
   Same interaction shape as Input SO (search Lokasi + SKU, see current
   position, submit), but there is no "right" combination to guide toward —
   a delivery can land on any SKU at any location, including a brand new one.
   Every save posts a plain +qty "IN" movement to the ledger.
   ========================================================================== */

let bmSelectedLocationId = null, bmSelectedSkuId = null;

function initBarangMasuk(){
  document.getElementById('bmTanggal').value = todayStr();

  document.getElementById('bmLokasiInput').addEventListener('input', debounce(onBmLokasiSearch, 180));
  document.getElementById('bmSkuInput').addEventListener('input', debounce(onBmSkuSearch, 180));
  document.getElementById('bmLokasiInput').addEventListener('focus', onBmLokasiSearch);
  document.getElementById('bmSkuInput').addEventListener('focus', onBmSkuSearch);
  document.addEventListener('click', (e)=>{
    if (!e.target.closest('#bmLokasiInput')) document.getElementById('bmLokasiDropdown').classList.remove('open');
    if (!e.target.closest('#bmSkuInput')) document.getElementById('bmSkuDropdown').classList.remove('open');
  });

  document.getElementById('btnImportBarangMasuk').addEventListener('click', ()=> openImportModal('barang-masuk'));

  let submitMode = 'save';
  document.querySelectorAll('#formBarangMasuk button[type=submit]').forEach(btn=>{
    btn.addEventListener('click', ()=> submitMode = btn.dataset.mode);
  });
  document.getElementById('formBarangMasuk').addEventListener('submit', (e)=>{
    e.preventDefault();
    submitBarangMasuk(submitMode);
  });
}

function renderBarangMasuk(){
  fillSelect(document.getElementById('bmGudang'), state.warehouses, { value:w=>w.id, label:w=>w.name });
  fillSelect(document.getElementById('bmOperator'), state.staff.filter(s=>s.is_active), { value:s=>s.id, label:s=>s.name, keepFirst:false });
  fillSelect(document.getElementById('bmSupplier'), state.suppliers.filter(s=>s.is_active), { value:s=>s.id, label:s=>s.name, keepFirst:false });
  if (ui.role === 'Operator'){
    document.getElementById('bmOperator').value = ui.currentUser.id;
    document.getElementById('bmOperator').disabled = true;
  } else {
    document.getElementById('bmOperator').disabled = false;
  }
  document.getElementById('bmGudang').value = ui.currentUser.warehouse_id || state.settings.default_warehouse_id || state.warehouses[0].id;
  renderBmTodayFeed();
}

function onBmLokasiSearch(){
  const q = document.getElementById('bmLokasiInput').value.trim().toLowerCase();
  const dd = document.getElementById('bmLokasiDropdown');
  const results = state.locations.filter(l=>l.is_active && (l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q))).slice(0,8);
  dd.innerHTML = results.length ? results.map(l=>`
    <div class="combo-option" data-id="${l.id}">
      <div class="combo-option-title">${l.code}</div>
      <div class="combo-option-sub">${l.name} · ${l.location_type} · ${mWh[l.warehouse_id].name}</div>
    </div>`).join('') : `<div class="combo-empty">Lokasi tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      bmSelectedLocationId = opt.dataset.id;
      const l = mLoc[bmSelectedLocationId];
      document.getElementById('bmLokasiInput').value = `${l.code} — ${l.name}`;
      document.getElementById('bmGudang').value = l.warehouse_id;
      dd.classList.remove('open');
      updateBmLookup();
    });
  });
}

function onBmSkuSearch(){
  const q = document.getElementById('bmSkuInput').value.trim().toLowerCase();
  const dd = document.getElementById('bmSkuDropdown');
  const results = state.skus.filter(s=>s.is_active && (s.sku.toLowerCase().includes(q) || s.nama_produk.toLowerCase().includes(q))).slice(0,8);
  dd.innerHTML = results.length ? results.map(s=>`
    <div class="combo-option" data-id="${s.id}">
      <div class="combo-option-title">${s.sku}</div>
      <div class="combo-option-sub">${s.nama_produk}</div>
    </div>`).join('') : `<div class="combo-empty">SKU tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      bmSelectedSkuId = opt.dataset.id;
      const s = mSku[bmSelectedSkuId];
      document.getElementById('bmSkuInput').value = `${s.sku} — ${s.nama_produk}`;
      dd.classList.remove('open');
      updateBmLookup();
      document.getElementById('bmQtyMasuk').focus();
    });
  });
}

function updateBmLookup(){
  if (!bmSelectedLocationId || !bmSelectedSkuId) return;
  const sku = mSku[bmSelectedSkuId];
  const loc = mLoc[bmSelectedLocationId];
  const qty = getQtySystem(sku.id, loc.id);
  const everMoved = hasAnyMovement(sku.id, loc.id);

  document.getElementById('bmLookupEmpty').classList.add('hidden');
  document.getElementById('bmLookupFilled').classList.remove('hidden');
  document.getElementById('bmLookupName').textContent = sku.nama_produk;
  document.getElementById('bmLookupMeta').textContent = `${sku.sku} · ${sku.kategori} · ${loc.code}${everMoved ? '' : ' · lokasi baru untuk SKU ini'}`;
  document.getElementById('bmQtyCurrent').textContent = fmtNum(qty);
}

function submitBarangMasuk(mode){
  if (!bmSelectedLocationId || !bmSelectedSkuId){
    toast('Pilih lokasi dan SKU terlebih dahulu', 'warning'); return;
  }
  const qtyRaw = document.getElementById('bmQtyMasuk').value;
  if (qtyRaw === '' || parseFloat(qtyRaw) <= 0){
    toast('Qty Masuk wajib diisi (> 0)', 'warning'); return;
  }
  const supplierId = document.getElementById('bmSupplier').value;
  if (!supplierId){ toast('Pilih Supplier terlebih dahulu', 'warning'); return; }

  const qty = parseFloat(qtyRaw);
  const loc = mLoc[bmSelectedLocationId];
  const tanggal = document.getElementById('bmTanggal').value || todayStr();
  const catatan = document.getElementById('bmCatatan').value.trim();
  const noRef = document.getElementById('bmNoRef').value.trim();

  state.bmCounter += 1;
  const docNumber = `BM-${tanggal.replace(/-/g,'')}-${String(state.bmCounter).padStart(3,'0')}`;

  const item = {
    id: 'bmi-' + Date.now(), doc_number: docNumber, tanggal,
    waktu: new Date().toISOString().slice(0,19),
    supplier_id: supplierId, sku_id: bmSelectedSkuId, location_id: bmSelectedLocationId,
    warehouse_id: loc.warehouse_id, qty, no_referensi: noRef, catatan,
    operator_id: document.getElementById('bmOperator').value,
  };
  // SUPABASE: insert into barang_masuk_items
  state.barangMasukItems.unshift(item);
  postMovement({
    tipe:'IN', sku_id: bmSelectedSkuId, location_id: bmSelectedLocationId,
    qty, ref_type:'Barang Masuk', ref_doc: docNumber, supplier_id: supplierId,
    catatan: catatan || `Penerimaan dari ${safeSupplier(supplierId).name}`
  });
  logAudit('CREATE', 'Barang Masuk', `${docNumber}: +${fmtNum(qty)} ${safeSku(bmSelectedSkuId).sku} @ ${loc.code} dari ${safeSupplier(supplierId).name}`);
  saveState();
  toast(`Tersimpan — ${docNumber}`);

  document.getElementById('bmQtyMasuk').value = '';
  document.getElementById('bmNoRef').value = '';
  document.getElementById('bmCatatan').value = '';
  renderBmTodayFeed();

  if (mode === 'save-next'){
    // Same delivery, same location — move to the next SKU in the box/pallet
    bmSelectedSkuId = null;
    document.getElementById('bmSkuInput').value = '';
    document.getElementById('bmLookupFilled').classList.add('hidden');
    document.getElementById('bmLookupEmpty').classList.remove('hidden');
    document.getElementById('bmSkuInput').focus();
  } else {
    bmSelectedSkuId = null; bmSelectedLocationId = null;
    document.getElementById('bmSkuInput').value = '';
    document.getElementById('bmLokasiInput').value = '';
    document.getElementById('bmLookupFilled').classList.add('hidden');
    document.getElementById('bmLookupEmpty').classList.remove('hidden');
  }
}

function renderBmTodayFeed(){
  const list = state.barangMasukItems.filter(i=>i.tanggal===todayStr()).sort((a,b)=> b.waktu.localeCompare(a.waktu));
  document.getElementById('bmTodayCount').textContent = list.length;
  document.getElementById('bmTodayInputList').innerHTML = list.length ? list.map(i=>`
    <div class="feed-item">
      <div class="feed-item-top">
        <span class="feed-item-sku">${safeSku(i.sku_id).sku}</span>
        <span class="badge badge-info">+${fmtNum(i.qty)}</span>
      </div>
      <div class="feed-item-name">${safeSku(i.sku_id).nama_produk}</div>
      <div class="feed-item-meta">${safeLoc(i.location_id).code} · ${safeSupplier(i.supplier_id).name} · ${fmtDateTime(i.waktu).split('·')[1]}</div>
    </div>`).join('') : `<div class="feed-empty">Belum ada input hari ini.</div>`;
}

/* ==========================================================================
   INPUT BARANG KELUAR
   Mirrors Barang Masuk exactly, except it subtracts from the ledger and
   Customer replaces Supplier — plus the confirmed business rule: qty keluar
   melebihi stok tersedia is BLOCKED, never allowed to go negative.
   ========================================================================== */

let bkSelectedLocationId = null, bkSelectedSkuId = null;

function initBarangKeluar(){
  document.getElementById('bkTanggal').value = todayStr();

  document.getElementById('bkLokasiInput').addEventListener('input', debounce(onBkLokasiSearch, 180));
  document.getElementById('bkSkuInput').addEventListener('input', debounce(onBkSkuSearch, 180));
  document.getElementById('bkLokasiInput').addEventListener('focus', onBkLokasiSearch);
  document.getElementById('bkSkuInput').addEventListener('focus', onBkSkuSearch);
  document.addEventListener('click', (e)=>{
    if (!e.target.closest('#bkLokasiInput')) document.getElementById('bkLokasiDropdown').classList.remove('open');
    if (!e.target.closest('#bkSkuInput')) document.getElementById('bkSkuDropdown').classList.remove('open');
  });

  document.getElementById('bkQtyKeluar').addEventListener('input', validateBkQty);
  document.getElementById('btnImportBarangKeluar').addEventListener('click', ()=> openImportModal('barang-keluar'));

  let submitMode = 'save';
  document.querySelectorAll('#formBarangKeluar button[type=submit]').forEach(btn=>{
    btn.addEventListener('click', ()=> submitMode = btn.dataset.mode);
  });
  document.getElementById('formBarangKeluar').addEventListener('submit', (e)=>{
    e.preventDefault();
    submitBarangKeluar(submitMode);
  });
}

function renderBarangKeluar(){
  fillSelect(document.getElementById('bkGudang'), state.warehouses, { value:w=>w.id, label:w=>w.name });
  fillSelect(document.getElementById('bkOperator'), state.staff.filter(s=>s.is_active), { value:s=>s.id, label:s=>s.name, keepFirst:false });
  fillSelect(document.getElementById('bkCustomer'), state.customers.filter(c=>c.is_active), { value:c=>c.id, label:c=>c.name, keepFirst:false });
  if (ui.role === 'Operator'){
    document.getElementById('bkOperator').value = ui.currentUser.id;
    document.getElementById('bkOperator').disabled = true;
  } else {
    document.getElementById('bkOperator').disabled = false;
  }
  document.getElementById('bkGudang').value = ui.currentUser.warehouse_id || state.settings.default_warehouse_id || state.warehouses[0].id;
  renderBkTodayFeed();
}

function onBkLokasiSearch(){
  const q = document.getElementById('bkLokasiInput').value.trim().toLowerCase();
  const dd = document.getElementById('bkLokasiDropdown');
  // Prioritize locations that actually have stock for the SKU already picked —
  // there's nothing to take out of a position with nothing in it.
  const validLocs = bkSelectedSkuId ? locationsForSku(bkSelectedSkuId) : null;
  let results = state.locations.filter(l=>l.is_active && (l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q)));
  if (validLocs) results.sort((a,b)=> (validLocs.has(b.id)?1:0) - (validLocs.has(a.id)?1:0));
  results = results.slice(0,8);
  dd.innerHTML = results.length ? results.map(l=>{
    const tag = validLocs && validLocs.has(l.id) ? '<span class="combo-tag combo-tag-ok">Ada stok SKU ini</span>' : '';
    return `<div class="combo-option" data-id="${l.id}">
      <div class="combo-option-title">${l.code} ${tag}</div>
      <div class="combo-option-sub">${l.name} · ${l.location_type} · ${mWh[l.warehouse_id].name}</div>
    </div>`;
  }).join('') : `<div class="combo-empty">Lokasi tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      bkSelectedLocationId = opt.dataset.id;
      const l = mLoc[bkSelectedLocationId];
      document.getElementById('bkLokasiInput').value = `${l.code} — ${l.name}`;
      document.getElementById('bkGudang').value = l.warehouse_id;
      dd.classList.remove('open');
      updateBkLookup();
    });
  });
}

function onBkSkuSearch(){
  const q = document.getElementById('bkSkuInput').value.trim().toLowerCase();
  const dd = document.getElementById('bkSkuDropdown');
  const validSkus = bkSelectedLocationId ? skusAtLocation(bkSelectedLocationId) : null;
  let results = state.skus.filter(s=>s.is_active && (s.sku.toLowerCase().includes(q) || s.nama_produk.toLowerCase().includes(q)));
  if (validSkus) results.sort((a,b)=> (validSkus.has(b.id)?1:0) - (validSkus.has(a.id)?1:0));
  results = results.slice(0,8);
  dd.innerHTML = results.length ? results.map(s=>{
    const tag = validSkus && validSkus.has(s.id) ? '<span class="combo-tag combo-tag-ok">Ada di lokasi ini</span>' : '';
    return `<div class="combo-option" data-id="${s.id}">
      <div class="combo-option-title">${s.sku} ${tag}</div>
      <div class="combo-option-sub">${s.nama_produk}</div>
    </div>`;
  }).join('') : `<div class="combo-empty">SKU tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      bkSelectedSkuId = opt.dataset.id;
      const s = mSku[bkSelectedSkuId];
      document.getElementById('bkSkuInput').value = `${s.sku} — ${s.nama_produk}`;
      dd.classList.remove('open');
      updateBkLookup();
      document.getElementById('bkQtyKeluar').focus();
    });
  });
}

function updateBkLookup(){
  if (!bkSelectedLocationId || !bkSelectedSkuId) return;
  const sku = mSku[bkSelectedSkuId];
  const loc = mLoc[bkSelectedLocationId];
  const qty = getQtySystem(sku.id, loc.id);

  document.getElementById('bkLookupEmpty').classList.add('hidden');
  document.getElementById('bkLookupFilled').classList.remove('hidden');
  document.getElementById('bkLookupName').textContent = sku.nama_produk;
  document.getElementById('bkLookupMeta').textContent = `${sku.sku} · ${sku.kategori} · ${loc.code}`;
  document.getElementById('bkQtyCurrent').textContent = fmtNum(qty);
  validateBkQty();
}

function bkAvailableQty(){
  if (!bkSelectedLocationId || !bkSelectedSkuId) return 0;
  return getQtySystem(bkSelectedSkuId, bkSelectedLocationId);
}

function validateBkQty(){
  const warn = document.getElementById('bkStockWarning');
  const raw = document.getElementById('bkQtyKeluar').value;
  if (raw === '' || !bkSelectedSkuId || !bkSelectedLocationId){ warn.classList.add('hidden'); return true; }
  const qty = parseFloat(raw) || 0;
  const available = bkAvailableQty();
  if (qty > available){
    warn.textContent = `Qty Keluar melebihi stok tersedia (${fmtNum(available)}). Kurangi jumlahnya untuk bisa menyimpan.`;
    warn.classList.remove('hidden');
    return false;
  }
  warn.classList.add('hidden');
  return true;
}

function submitBarangKeluar(mode){
  if (!bkSelectedLocationId || !bkSelectedSkuId){
    toast('Pilih lokasi dan SKU terlebih dahulu', 'warning'); return;
  }
  const qtyRaw = document.getElementById('bkQtyKeluar').value;
  if (qtyRaw === '' || parseFloat(qtyRaw) <= 0){
    toast('Qty Keluar wajib diisi (> 0)', 'warning'); return;
  }
  const customerId = document.getElementById('bkCustomer').value;
  if (!customerId){ toast('Pilih Customer terlebih dahulu', 'warning'); return; }

  const qty = parseFloat(qtyRaw);
  const available = bkAvailableQty();
  if (qty > available){
    toast(`Ditolak — Qty Keluar (${fmtNum(qty)}) melebihi stok tersedia (${fmtNum(available)})`, 'error');
    return;
  }

  const loc = mLoc[bkSelectedLocationId];
  const tanggal = document.getElementById('bkTanggal').value || todayStr();
  const catatan = document.getElementById('bkCatatan').value.trim();
  const noRef = document.getElementById('bkNoRef').value.trim();

  state.bkCounter += 1;
  const docNumber = `BK-${tanggal.replace(/-/g,'')}-${String(state.bkCounter).padStart(3,'0')}`;

  const item = {
    id: 'bki-' + Date.now(), doc_number: docNumber, tanggal,
    waktu: new Date().toISOString().slice(0,19),
    customer_id: customerId, sku_id: bkSelectedSkuId, location_id: bkSelectedLocationId,
    warehouse_id: loc.warehouse_id, qty, no_referensi: noRef, catatan,
    operator_id: document.getElementById('bkOperator').value,
  };
  // SUPABASE: insert into barang_keluar_items
  state.barangKeluarItems.unshift(item);
  postMovement({
    tipe:'OUT', sku_id: bkSelectedSkuId, location_id: bkSelectedLocationId,
    qty: -qty, ref_type:'Barang Keluar', ref_doc: docNumber, customer_id: customerId,
    catatan: catatan || `Pengeluaran untuk ${safeCustomer(customerId).name}`
  });
  logAudit('CREATE', 'Barang Keluar', `${docNumber}: -${fmtNum(qty)} ${safeSku(bkSelectedSkuId).sku} @ ${loc.code} untuk ${safeCustomer(customerId).name}`);
  saveState();
  toast(`Tersimpan — ${docNumber}`);

  document.getElementById('bkQtyKeluar').value = '';
  document.getElementById('bkNoRef').value = '';
  document.getElementById('bkCatatan').value = '';
  document.getElementById('bkStockWarning').classList.add('hidden');
  renderBkTodayFeed();

  if (mode === 'save-next'){
    bkSelectedSkuId = null;
    document.getElementById('bkSkuInput').value = '';
    document.getElementById('bkLookupFilled').classList.add('hidden');
    document.getElementById('bkLookupEmpty').classList.remove('hidden');
    document.getElementById('bkSkuInput').focus();
  } else {
    bkSelectedSkuId = null; bkSelectedLocationId = null;
    document.getElementById('bkSkuInput').value = '';
    document.getElementById('bkLokasiInput').value = '';
    document.getElementById('bkLookupFilled').classList.add('hidden');
    document.getElementById('bkLookupEmpty').classList.remove('hidden');
  }
}

function renderBkTodayFeed(){
  const list = state.barangKeluarItems.filter(i=>i.tanggal===todayStr()).sort((a,b)=> b.waktu.localeCompare(a.waktu));
  document.getElementById('bkTodayCount').textContent = list.length;
  document.getElementById('bkTodayInputList').innerHTML = list.length ? list.map(i=>`
    <div class="feed-item">
      <div class="feed-item-top">
        <span class="feed-item-sku">${safeSku(i.sku_id).sku}</span>
        <span class="badge badge-danger">-${fmtNum(i.qty)}</span>
      </div>
      <div class="feed-item-name">${safeSku(i.sku_id).nama_produk}</div>
      <div class="feed-item-meta">${safeLoc(i.location_id).code} · ${safeCustomer(i.customer_id).name} · ${fmtDateTime(i.waktu).split('·')[1]}</div>
    </div>`).join('') : `<div class="feed-empty">Belum ada input hari ini.</div>`;
}

/* ==========================================================================
   TRANSFER ANTAR GUDANG
   Moves stock from a location in one warehouse to a location in another.
   Posts a linked TRANSFER_OUT/TRANSFER_IN pair — never a plain qty edit.
   ========================================================================== */

let tgSelectedSkuId = null, tgSelectedAsalId = null, tgSelectedTujuanId = null;

function initTransferGudang(){
  document.getElementById('tgTanggal').value = todayStr();

  document.getElementById('tgSkuInput').addEventListener('input', debounce(onTgSkuSearch, 180));
  document.getElementById('tgSkuInput').addEventListener('focus', onTgSkuSearch);
  document.getElementById('tgLokasiAsalInput').addEventListener('input', debounce(onTgLokasiAsalSearch, 180));
  document.getElementById('tgLokasiAsalInput').addEventListener('focus', onTgLokasiAsalSearch);
  document.getElementById('tgLokasiTujuanInput').addEventListener('input', debounce(onTgLokasiTujuanSearch, 180));
  document.getElementById('tgLokasiTujuanInput').addEventListener('focus', onTgLokasiTujuanSearch);
  document.getElementById('tgGudangAsal').addEventListener('change', ()=>{
    tgSelectedAsalId = null; document.getElementById('tgLokasiAsalInput').value='';
    document.getElementById('tgLookupFilled').classList.add('hidden');
    document.getElementById('tgLookupEmpty').classList.remove('hidden');
  });
  document.getElementById('tgGudangTujuan').addEventListener('change', ()=>{
    tgSelectedTujuanId = null; document.getElementById('tgLokasiTujuanInput').value='';
  });
  document.getElementById('tgQty').addEventListener('input', validateTgQty);

  document.addEventListener('click', (e)=>{
    if (!e.target.closest('#tgSkuInput')) document.getElementById('tgSkuDropdown').classList.remove('open');
    if (!e.target.closest('#tgLokasiAsalInput')) document.getElementById('tgLokasiAsalDropdown').classList.remove('open');
    if (!e.target.closest('#tgLokasiTujuanInput')) document.getElementById('tgLokasiTujuanDropdown').classList.remove('open');
  });

  let submitMode = 'save';
  document.querySelectorAll('#formTransferGudang button[type=submit]').forEach(btn=>{
    btn.addEventListener('click', ()=> submitMode = btn.dataset.mode);
  });
  document.getElementById('formTransferGudang').addEventListener('submit', (e)=>{
    e.preventDefault();
    submitTransferGudang(submitMode);
  });
}

function renderTransferGudang(){
  fillSelect(document.getElementById('tgGudangAsal'), state.warehouses, { value:w=>w.id, label:w=>w.name, keepFirst:false });
  fillSelect(document.getElementById('tgGudangTujuan'), state.warehouses, { value:w=>w.id, label:w=>w.name, keepFirst:false });
  fillSelect(document.getElementById('tgOperator'), state.staff.filter(s=>s.is_active), { value:s=>s.id, label:s=>s.name, keepFirst:false });
  if (ui.role === 'Operator'){
    document.getElementById('tgOperator').value = ui.currentUser.id;
    document.getElementById('tgOperator').disabled = true;
  } else {
    document.getElementById('tgOperator').disabled = false;
  }
  const asalId = ui.currentUser.warehouse_id || state.settings.default_warehouse_id || state.warehouses[0].id;
  document.getElementById('tgGudangAsal').value = asalId;
  const other = state.warehouses.find(w=>w.id !== asalId);
  if (other) document.getElementById('tgGudangTujuan').value = other.id;
  renderTgTodayFeed();
}

function onTgSkuSearch(){
  const q = document.getElementById('tgSkuInput').value.trim().toLowerCase();
  const dd = document.getElementById('tgSkuDropdown');
  const results = state.skus.filter(s=>s.is_active && (s.sku.toLowerCase().includes(q) || s.nama_produk.toLowerCase().includes(q))).slice(0,8);
  dd.innerHTML = results.length ? results.map(s=>`
    <div class="combo-option" data-id="${s.id}"><div class="combo-option-title">${s.sku}</div><div class="combo-option-sub">${s.nama_produk}</div></div>`).join('') : `<div class="combo-empty">SKU tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      tgSelectedSkuId = opt.dataset.id;
      const s = mSku[tgSelectedSkuId];
      document.getElementById('tgSkuInput').value = `${s.sku} — ${s.nama_produk}`;
      dd.classList.remove('open');
      updateTgLookup();
    });
  });
}

function onTgLokasiAsalSearch(){
  const q = document.getElementById('tgLokasiAsalInput').value.trim().toLowerCase();
  const dd = document.getElementById('tgLokasiAsalDropdown');
  const gudangAsal = document.getElementById('tgGudangAsal').value;
  const validSkuLocs = tgSelectedSkuId ? locationsForSku(tgSelectedSkuId) : null;
  let results = state.locations.filter(l=>l.is_active && l.warehouse_id===gudangAsal && (l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q)));
  if (validSkuLocs) results.sort((a,b)=>(validSkuLocs.has(b.id)?1:0)-(validSkuLocs.has(a.id)?1:0));
  results = results.slice(0,8);
  dd.innerHTML = results.length ? results.map(l=>{
    const tag = validSkuLocs && validSkuLocs.has(l.id) ? '<span class="combo-tag combo-tag-ok">Ada stok SKU ini</span>' : '';
    return `<div class="combo-option" data-id="${l.id}"><div class="combo-option-title">${l.code} ${tag}</div><div class="combo-option-sub">${l.name} · ${l.location_type}</div></div>`;
  }).join('') : `<div class="combo-empty">Tidak ada lokasi di gudang ini yang cocok</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      tgSelectedAsalId = opt.dataset.id;
      const l = mLoc[tgSelectedAsalId];
      document.getElementById('tgLokasiAsalInput').value = `${l.code} — ${l.name}`;
      dd.classList.remove('open');
      updateTgLookup();
    });
  });
}

function onTgLokasiTujuanSearch(){
  const q = document.getElementById('tgLokasiTujuanInput').value.trim().toLowerCase();
  const dd = document.getElementById('tgLokasiTujuanDropdown');
  const gudangTujuan = document.getElementById('tgGudangTujuan').value;
  const results = state.locations.filter(l=>l.is_active && l.warehouse_id===gudangTujuan && (l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q))).slice(0,8);
  dd.innerHTML = results.length ? results.map(l=>`
    <div class="combo-option" data-id="${l.id}"><div class="combo-option-title">${l.code}</div><div class="combo-option-sub">${l.name} · ${l.location_type}</div></div>`).join('') : `<div class="combo-empty">Tidak ada lokasi di gudang ini yang cocok</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      tgSelectedTujuanId = opt.dataset.id;
      const l = mLoc[tgSelectedTujuanId];
      document.getElementById('tgLokasiTujuanInput').value = `${l.code} — ${l.name}`;
      dd.classList.remove('open');
    });
  });
}

function updateTgLookup(){
  if (!tgSelectedSkuId || !tgSelectedAsalId) return;
  const sku = mSku[tgSelectedSkuId];
  const loc = mLoc[tgSelectedAsalId];
  const qty = getQtySystem(sku.id, loc.id);
  document.getElementById('tgLookupEmpty').classList.add('hidden');
  document.getElementById('tgLookupFilled').classList.remove('hidden');
  document.getElementById('tgLookupName').textContent = sku.nama_produk;
  document.getElementById('tgLookupMeta').textContent = `${sku.sku} · ${sku.kategori} · ${loc.code}`;
  document.getElementById('tgQtyCurrent').textContent = fmtNum(qty);
  validateTgQty();
}

function validateTgQty(){
  const warn = document.getElementById('tgStockWarning');
  const raw = document.getElementById('tgQty').value;
  if (raw === '' || !tgSelectedSkuId || !tgSelectedAsalId){ warn.classList.add('hidden'); return true; }
  const qty = parseFloat(raw) || 0;
  const available = getQtySystem(tgSelectedSkuId, tgSelectedAsalId);
  if (qty > available){
    warn.textContent = `Qty Transfer melebihi stok tersedia (${fmtNum(available)}) di lokasi asal.`;
    warn.classList.remove('hidden');
    return false;
  }
  warn.classList.add('hidden');
  return true;
}

function submitTransferGudang(mode){
  if (!tgSelectedSkuId || !tgSelectedAsalId || !tgSelectedTujuanId){
    toast('Pilih SKU, Lokasi Asal, dan Lokasi Tujuan terlebih dahulu', 'warning'); return;
  }
  if (tgSelectedAsalId === tgSelectedTujuanId){
    toast('Lokasi Asal dan Lokasi Tujuan tidak boleh sama', 'warning'); return;
  }
  const qtyRaw = document.getElementById('tgQty').value;
  if (qtyRaw === '' || parseFloat(qtyRaw) <= 0){ toast('Qty Transfer wajib diisi (> 0)', 'warning'); return; }
  const qty = parseFloat(qtyRaw);
  const available = getQtySystem(tgSelectedSkuId, tgSelectedAsalId);
  if (qty > available){
    toast(`Ditolak — Qty Transfer (${fmtNum(qty)}) melebihi stok tersedia (${fmtNum(available)})`, 'error');
    return;
  }

  const srcLoc = mLoc[tgSelectedAsalId], destLoc = mLoc[tgSelectedTujuanId];
  const tanggal = document.getElementById('tgTanggal').value || todayStr();
  const catatan = document.getElementById('tgCatatan').value.trim();
  state.tgCounter += 1;
  const docNumber = `TG-${tanggal.replace(/-/g,'')}-${String(state.tgCounter).padStart(3,'0')}`;

  const item = {
    id: 'tgi-' + Date.now(), doc_number: docNumber, tanggal, waktu: new Date().toISOString().slice(0,19),
    sku_id: tgSelectedSkuId, source_location_id: tgSelectedAsalId, source_warehouse_id: srcLoc.warehouse_id,
    dest_location_id: tgSelectedTujuanId, dest_warehouse_id: destLoc.warehouse_id,
    qty, catatan, operator_id: document.getElementById('tgOperator').value,
  };
  // SUPABASE: insert into transfer_gudang_items
  state.transferGudangItems.unshift(item);
  const outEntry = postMovement({ tipe:'TRANSFER_OUT', sku_id: tgSelectedSkuId, location_id: tgSelectedAsalId, qty:-qty, ref_type:'Transfer Antar Gudang', ref_doc: docNumber, catatan: catatan || `Transfer ke ${safeWh(destLoc.warehouse_id).name}` });
  postMovement({ tipe:'TRANSFER_IN', sku_id: tgSelectedSkuId, location_id: tgSelectedTujuanId, qty, ref_type:'Transfer Antar Gudang', ref_doc: docNumber, related_movement_id: outEntry.id, catatan: catatan || `Transfer dari ${safeWh(srcLoc.warehouse_id).name}` });
  logAudit('CREATE', 'Transfer Antar Gudang', `${docNumber}: ${fmtNum(qty)} ${safeSku(tgSelectedSkuId).sku} dari ${srcLoc.code} (${safeWh(srcLoc.warehouse_id).name}) ke ${destLoc.code} (${safeWh(destLoc.warehouse_id).name})`);
  saveState();
  toast(`Tersimpan — ${docNumber}`);

  document.getElementById('tgQty').value = '';
  document.getElementById('tgCatatan').value = '';
  document.getElementById('tgStockWarning').classList.add('hidden');
  renderTgTodayFeed();

  if (mode === 'save-next'){
    // Same Lokasi Asal/Tujuan, move to the next SKU in the same transfer run
    tgSelectedSkuId = null;
    document.getElementById('tgSkuInput').value = '';
    document.getElementById('tgLookupFilled').classList.add('hidden');
    document.getElementById('tgLookupEmpty').classList.remove('hidden');
    document.getElementById('tgSkuInput').focus();
  } else {
    tgSelectedSkuId = null; tgSelectedAsalId = null; tgSelectedTujuanId = null;
    document.getElementById('tgSkuInput').value = '';
    document.getElementById('tgLokasiAsalInput').value = '';
    document.getElementById('tgLokasiTujuanInput').value = '';
    document.getElementById('tgLookupFilled').classList.add('hidden');
    document.getElementById('tgLookupEmpty').classList.remove('hidden');
  }
}

function renderTgTodayFeed(){
  const list = state.transferGudangItems.filter(i=>i.tanggal===todayStr()).sort((a,b)=> b.waktu.localeCompare(a.waktu));
  document.getElementById('tgTodayCount').textContent = list.length;
  document.getElementById('tgTodayInputList').innerHTML = list.length ? list.map(i=>`
    <div class="feed-item">
      <div class="feed-item-top">
        <span class="feed-item-sku">${safeSku(i.sku_id).sku}</span>
        <span class="badge badge-info">${fmtNum(i.qty)}</span>
      </div>
      <div class="feed-item-name">${safeSku(i.sku_id).nama_produk}</div>
      <div class="feed-item-meta">${safeLoc(i.source_location_id).code} → ${safeLoc(i.dest_location_id).code} · ${fmtDateTime(i.waktu).split('·')[1]}</div>
    </div>`).join('') : `<div class="feed-empty">Belum ada input hari ini.</div>`;
}

/* ==========================================================================
   TRANSFER ANTAR LOKASI
   Same mechanic as Transfer Antar Gudang, but scoped to one warehouse —
   Lokasi Tujuan is locked until Lokasi Asal is chosen, then filtered to the
   same warehouse only (cross-warehouse moves belong in the other menu).
   ========================================================================== */

let tlSelectedSkuId = null, tlSelectedAsalId = null, tlSelectedTujuanId = null;

function initTransferLokasi(){
  document.getElementById('tlTanggal').value = todayStr();

  document.getElementById('tlSkuInput').addEventListener('input', debounce(onTlSkuSearch, 180));
  document.getElementById('tlSkuInput').addEventListener('focus', onTlSkuSearch);
  document.getElementById('tlLokasiAsalInput').addEventListener('input', debounce(onTlLokasiAsalSearch, 180));
  document.getElementById('tlLokasiAsalInput').addEventListener('focus', onTlLokasiAsalSearch);
  document.getElementById('tlLokasiTujuanInput').addEventListener('input', debounce(onTlLokasiTujuanSearch, 180));
  document.getElementById('tlLokasiTujuanInput').addEventListener('focus', onTlLokasiTujuanSearch);
  document.getElementById('tlQty').addEventListener('input', validateTlQty);

  document.addEventListener('click', (e)=>{
    if (!e.target.closest('#tlSkuInput')) document.getElementById('tlSkuDropdown').classList.remove('open');
    if (!e.target.closest('#tlLokasiAsalInput')) document.getElementById('tlLokasiAsalDropdown').classList.remove('open');
    if (!e.target.closest('#tlLokasiTujuanInput')) document.getElementById('tlLokasiTujuanDropdown').classList.remove('open');
  });

  let submitMode = 'save';
  document.querySelectorAll('#formTransferLokasi button[type=submit]').forEach(btn=>{
    btn.addEventListener('click', ()=> submitMode = btn.dataset.mode);
  });
  document.getElementById('formTransferLokasi').addEventListener('submit', (e)=>{
    e.preventDefault();
    submitTransferLokasi(submitMode);
  });
}

function renderTransferLokasi(){
  fillSelect(document.getElementById('tlOperator'), state.staff.filter(s=>s.is_active), { value:s=>s.id, label:s=>s.name, keepFirst:false });
  if (ui.role === 'Operator'){
    document.getElementById('tlOperator').value = ui.currentUser.id;
    document.getElementById('tlOperator').disabled = true;
  } else {
    document.getElementById('tlOperator').disabled = false;
  }
  renderTlTodayFeed();
}

function onTlSkuSearch(){
  const q = document.getElementById('tlSkuInput').value.trim().toLowerCase();
  const dd = document.getElementById('tlSkuDropdown');
  const results = state.skus.filter(s=>s.is_active && (s.sku.toLowerCase().includes(q) || s.nama_produk.toLowerCase().includes(q))).slice(0,8);
  dd.innerHTML = results.length ? results.map(s=>`
    <div class="combo-option" data-id="${s.id}"><div class="combo-option-title">${s.sku}</div><div class="combo-option-sub">${s.nama_produk}</div></div>`).join('') : `<div class="combo-empty">SKU tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      tlSelectedSkuId = opt.dataset.id;
      const s = mSku[tlSelectedSkuId];
      document.getElementById('tlSkuInput').value = `${s.sku} — ${s.nama_produk}`;
      dd.classList.remove('open');
      updateTlLookup();
    });
  });
}

function onTlLokasiAsalSearch(){
  const q = document.getElementById('tlLokasiAsalInput').value.trim().toLowerCase();
  const dd = document.getElementById('tlLokasiAsalDropdown');
  const validSkuLocs = tlSelectedSkuId ? locationsForSku(tlSelectedSkuId) : null;
  let results = state.locations.filter(l=>l.is_active && (l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q)));
  if (validSkuLocs) results.sort((a,b)=>(validSkuLocs.has(b.id)?1:0)-(validSkuLocs.has(a.id)?1:0));
  results = results.slice(0,8);
  dd.innerHTML = results.length ? results.map(l=>{
    const tag = validSkuLocs && validSkuLocs.has(l.id) ? '<span class="combo-tag combo-tag-ok">Ada stok SKU ini</span>' : '';
    return `<div class="combo-option" data-id="${l.id}"><div class="combo-option-title">${l.code} ${tag}</div><div class="combo-option-sub">${l.name} · ${l.location_type} · ${mWh[l.warehouse_id].name}</div></div>`;
  }).join('') : `<div class="combo-empty">Lokasi tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      tlSelectedAsalId = opt.dataset.id;
      const l = mLoc[tlSelectedAsalId];
      document.getElementById('tlLokasiAsalInput').value = `${l.code} — ${l.name}`;
      dd.classList.remove('open');
      tlSelectedTujuanId = null;
      const tujuanInput = document.getElementById('tlLokasiTujuanInput');
      tujuanInput.disabled = false;
      tujuanInput.value = '';
      tujuanInput.placeholder = 'Cari kode / nama lokasi…';
      updateTlLookup();
    });
  });
}

function onTlLokasiTujuanSearch(){
  if (!tlSelectedAsalId) return;
  const q = document.getElementById('tlLokasiTujuanInput').value.trim().toLowerCase();
  const dd = document.getElementById('tlLokasiTujuanDropdown');
  const asalWh = mLoc[tlSelectedAsalId].warehouse_id;
  const results = state.locations.filter(l=>l.is_active && l.id!==tlSelectedAsalId && l.warehouse_id===asalWh && (l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q))).slice(0,8);
  dd.innerHTML = results.length ? results.map(l=>`
    <div class="combo-option" data-id="${l.id}"><div class="combo-option-title">${l.code}</div><div class="combo-option-sub">${l.name} · ${l.location_type}</div></div>`).join('') : `<div class="combo-empty">Tidak ada lokasi lain di gudang yang sama</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      tlSelectedTujuanId = opt.dataset.id;
      const l = mLoc[tlSelectedTujuanId];
      document.getElementById('tlLokasiTujuanInput').value = `${l.code} — ${l.name}`;
      dd.classList.remove('open');
    });
  });
}

function updateTlLookup(){
  if (!tlSelectedSkuId || !tlSelectedAsalId) return;
  const sku = mSku[tlSelectedSkuId];
  const loc = mLoc[tlSelectedAsalId];
  const qty = getQtySystem(sku.id, loc.id);
  document.getElementById('tlLookupEmpty').classList.add('hidden');
  document.getElementById('tlLookupFilled').classList.remove('hidden');
  document.getElementById('tlLookupName').textContent = sku.nama_produk;
  document.getElementById('tlLookupMeta').textContent = `${sku.sku} · ${sku.kategori} · ${loc.code} · ${mWh[loc.warehouse_id].name}`;
  document.getElementById('tlQtyCurrent').textContent = fmtNum(qty);
  validateTlQty();
}

function validateTlQty(){
  const warn = document.getElementById('tlStockWarning');
  const raw = document.getElementById('tlQty').value;
  if (raw === '' || !tlSelectedSkuId || !tlSelectedAsalId){ warn.classList.add('hidden'); return true; }
  const qty = parseFloat(raw) || 0;
  const available = getQtySystem(tlSelectedSkuId, tlSelectedAsalId);
  if (qty > available){
    warn.textContent = `Qty Transfer melebihi stok tersedia (${fmtNum(available)}) di lokasi asal.`;
    warn.classList.remove('hidden');
    return false;
  }
  warn.classList.add('hidden');
  return true;
}

function submitTransferLokasi(mode){
  if (!tlSelectedSkuId || !tlSelectedAsalId || !tlSelectedTujuanId){
    toast('Pilih SKU, Lokasi Asal, dan Lokasi Tujuan terlebih dahulu', 'warning'); return;
  }
  if (tlSelectedAsalId === tlSelectedTujuanId){
    toast('Lokasi Asal dan Lokasi Tujuan tidak boleh sama', 'warning'); return;
  }
  const qtyRaw = document.getElementById('tlQty').value;
  if (qtyRaw === '' || parseFloat(qtyRaw) <= 0){ toast('Qty Transfer wajib diisi (> 0)', 'warning'); return; }
  const qty = parseFloat(qtyRaw);
  const available = getQtySystem(tlSelectedSkuId, tlSelectedAsalId);
  if (qty > available){
    toast(`Ditolak — Qty Transfer (${fmtNum(qty)}) melebihi stok tersedia (${fmtNum(available)})`, 'error');
    return;
  }

  const srcLoc = mLoc[tlSelectedAsalId], destLoc = mLoc[tlSelectedTujuanId];
  const tanggal = document.getElementById('tlTanggal').value || todayStr();
  const catatan = document.getElementById('tlCatatan').value.trim();
  state.tlCounter += 1;
  const docNumber = `TL-${tanggal.replace(/-/g,'')}-${String(state.tlCounter).padStart(3,'0')}`;

  const item = {
    id: 'tli-' + Date.now(), doc_number: docNumber, tanggal, waktu: new Date().toISOString().slice(0,19),
    sku_id: tlSelectedSkuId, source_location_id: tlSelectedAsalId, dest_location_id: tlSelectedTujuanId,
    warehouse_id: srcLoc.warehouse_id, qty, catatan, operator_id: document.getElementById('tlOperator').value,
  };
  // SUPABASE: insert into transfer_lokasi_items
  state.transferLokasiItems.unshift(item);
  const outEntry = postMovement({ tipe:'TRANSFER_OUT', sku_id: tlSelectedSkuId, location_id: tlSelectedAsalId, qty:-qty, ref_type:'Transfer Antar Lokasi', ref_doc: docNumber, catatan: catatan || `Transfer ke ${destLoc.code}` });
  postMovement({ tipe:'TRANSFER_IN', sku_id: tlSelectedSkuId, location_id: tlSelectedTujuanId, qty, ref_type:'Transfer Antar Lokasi', ref_doc: docNumber, related_movement_id: outEntry.id, catatan: catatan || `Transfer dari ${srcLoc.code}` });
  logAudit('CREATE', 'Transfer Antar Lokasi', `${docNumber}: ${fmtNum(qty)} ${safeSku(tlSelectedSkuId).sku} dari ${srcLoc.code} ke ${destLoc.code}`);
  saveState();
  toast(`Tersimpan — ${docNumber}`);

  document.getElementById('tlQty').value = '';
  document.getElementById('tlCatatan').value = '';
  document.getElementById('tlStockWarning').classList.add('hidden');
  renderTlTodayFeed();

  if (mode === 'save-next'){
    tlSelectedSkuId = null;
    document.getElementById('tlSkuInput').value = '';
    document.getElementById('tlLookupFilled').classList.add('hidden');
    document.getElementById('tlLookupEmpty').classList.remove('hidden');
    document.getElementById('tlSkuInput').focus();
  } else {
    tlSelectedSkuId = null; tlSelectedAsalId = null; tlSelectedTujuanId = null;
    document.getElementById('tlSkuInput').value = '';
    document.getElementById('tlLokasiAsalInput').value = '';
    document.getElementById('tlLokasiTujuanInput').value = '';
    document.getElementById('tlLokasiTujuanInput').disabled = true;
    document.getElementById('tlLokasiTujuanInput').placeholder = 'Pilih Lokasi Asal dahulu…';
    document.getElementById('tlLookupFilled').classList.add('hidden');
    document.getElementById('tlLookupEmpty').classList.remove('hidden');
  }
}

function renderTlTodayFeed(){
  const list = state.transferLokasiItems.filter(i=>i.tanggal===todayStr()).sort((a,b)=> b.waktu.localeCompare(a.waktu));
  document.getElementById('tlTodayCount').textContent = list.length;
  document.getElementById('tlTodayInputList').innerHTML = list.length ? list.map(i=>`
    <div class="feed-item">
      <div class="feed-item-top">
        <span class="feed-item-sku">${safeSku(i.sku_id).sku}</span>
        <span class="badge badge-info">${fmtNum(i.qty)}</span>
      </div>
      <div class="feed-item-name">${safeSku(i.sku_id).nama_produk}</div>
      <div class="feed-item-meta">${safeLoc(i.source_location_id).code} → ${safeLoc(i.dest_location_id).code} · ${fmtDateTime(i.waktu).split('·')[1]}</div>
    </div>`).join('') : `<div class="feed-empty">Belum ada input hari ini.</div>`;
}

/* ==========================================================================
   LAPORAN STOCK (Kartu Stok)
   The complementary report to Stock Gudang: instead of "what's the position
   right now", this shows the full movement trail for one SKU with a running
   balance — every module built so far (SO, Barang Masuk/Keluar, Transfer)
   feeds into it since they all post through the same ledger.
   ========================================================================== */

const MOVEMENT_LABELS = {
  SALDO_AWAL: { label:'Saldo Awal', badge:'badge-neutral' },
  IN: { label:'Barang Masuk', badge:'badge-info' },
  OUT: { label:'Barang Keluar', badge:'badge-danger' },
  TRANSFER_IN: { label:'Transfer Masuk', badge:'badge-warning' },
  TRANSFER_OUT: { label:'Transfer Keluar', badge:'badge-warning' },
  SO_ADJUSTMENT: { label:'Koreksi SO', badge:'badge-neutral' },
};

let ksSelectedSkuId = null, ksSelectedLocationId = null, ksPage = 1;

function initLaporanStock(){
  document.getElementById('ksSkuInput').addEventListener('input', debounce(onKsSkuSearch, 180));
  document.getElementById('ksSkuInput').addEventListener('focus', onKsSkuSearch);
  document.getElementById('ksLokasiInput').addEventListener('input', debounce(onKsLokasiSearch, 180));
  document.getElementById('ksLokasiInput').addEventListener('focus', onKsLokasiSearch);
  document.addEventListener('click', (e)=>{
    if (!e.target.closest('#ksSkuInput')) document.getElementById('ksSkuDropdown').classList.remove('open');
    if (!e.target.closest('#ksLokasiInput')) document.getElementById('ksLokasiDropdown').classList.remove('open');
  });
  ['ksTglMulai','ksTglAkhir'].forEach(id=> document.getElementById(id).addEventListener('change', ()=>{ ksPage=1; renderKartuStok(); }));
  document.getElementById('btnResetFilterKartu').addEventListener('click', ()=>{
    ksSelectedSkuId = null; ksSelectedLocationId = null;
    document.getElementById('ksSkuInput').value=''; document.getElementById('ksLokasiInput').value='';
    document.getElementById('ksTglMulai').value=''; document.getElementById('ksTglAkhir').value='';
    ksPage = 1; renderKartuStok();
  });
  document.getElementById('btnExportKartuCsv').addEventListener('click', exportKartuCsv);
  document.getElementById('btnExportKartuPdf').addEventListener('click', exportKartuPdf);
}

function renderLaporanStock(){
  renderKartuStok();
}

function onKsSkuSearch(){
  const q = document.getElementById('ksSkuInput').value.trim().toLowerCase();
  const dd = document.getElementById('ksSkuDropdown');
  const results = state.skus.filter(s=>s.sku.toLowerCase().includes(q) || s.nama_produk.toLowerCase().includes(q)).slice(0,8);
  dd.innerHTML = results.length ? results.map(s=>`
    <div class="combo-option" data-id="${s.id}"><div class="combo-option-title">${s.sku}</div><div class="combo-option-sub">${s.nama_produk}</div></div>`).join('') : `<div class="combo-empty">SKU tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      ksSelectedSkuId = opt.dataset.id;
      const s = mSku[ksSelectedSkuId];
      document.getElementById('ksSkuInput').value = `${s.sku} — ${s.nama_produk}`;
      dd.classList.remove('open');
      ksPage = 1;
      renderKartuStok();
    });
  });
}

function onKsLokasiSearch(){
  const q = document.getElementById('ksLokasiInput').value.trim().toLowerCase();
  const dd = document.getElementById('ksLokasiDropdown');
  const validLocs = ksSelectedSkuId ? locationsForSku(ksSelectedSkuId) : null;
  let results = state.locations.filter(l=>l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q));
  if (validLocs) results.sort((a,b)=>(validLocs.has(b.id)?1:0)-(validLocs.has(a.id)?1:0));
  results = results.slice(0,8);
  dd.innerHTML = results.length ? results.map(l=>{
    const tag = validLocs && validLocs.has(l.id) ? '<span class="combo-tag combo-tag-ok">Ada riwayat</span>' : '';
    return `<div class="combo-option" data-id="${l.id}"><div class="combo-option-title">${l.code} ${tag}</div><div class="combo-option-sub">${l.name}</div></div>`;
  }).join('') : `<div class="combo-empty">Lokasi tidak ditemukan</div>`;
  dd.classList.add('open');
  dd.querySelectorAll('.combo-option').forEach(opt=>{
    opt.addEventListener('click', ()=>{
      ksSelectedLocationId = opt.dataset.id;
      const l = mLoc[ksSelectedLocationId];
      document.getElementById('ksLokasiInput').value = `${l.code} — ${l.name}`;
      dd.classList.remove('open');
      ksPage = 1;
      renderKartuStok();
    });
  });
}

function getKartuMovements(){
  const tglMulai = document.getElementById('ksTglMulai').value;
  const tglAkhir = document.getElementById('ksTglAkhir').value;
  return state.stockMovements.filter(m=>{
    if (m.sku_id !== ksSelectedSkuId) return false;
    if (ksSelectedLocationId && m.location_id !== ksSelectedLocationId) return false;
    if (tglMulai && m.tanggal < tglMulai) return false;
    if (tglAkhir && m.tanggal > tglAkhir) return false;
    return true;
  }).sort((a,b)=> (a.tanggal+a.waktu).localeCompare(b.tanggal+b.waktu));
}

function getSaldoAwalKartu(){
  const tglMulai = document.getElementById('ksTglMulai').value;
  if (!tglMulai) return 0;
  return state.stockMovements.filter(m=>{
    if (m.sku_id !== ksSelectedSkuId) return false;
    if (ksSelectedLocationId && m.location_id !== ksSelectedLocationId) return false;
    return m.tanggal < tglMulai;
  }).reduce((s,m)=>s+m.qty,0);
}

function renderKartuStok(){
  if (!ksSelectedSkuId){
    document.getElementById('ksEmptyState').classList.remove('hidden');
    document.getElementById('ksContent').classList.add('hidden');
    return;
  }
  document.getElementById('ksEmptyState').classList.add('hidden');
  document.getElementById('ksContent').classList.remove('hidden');

  const saldoAwal = getSaldoAwalKartu();
  const movements = getKartuMovements();
  let running = saldoAwal;
  const rows = movements.map(m=>{ running += m.qty; return { ...m, saldo: running }; });

  const totalMasuk = movements.filter(m=>m.qty>0).reduce((s,m)=>s+m.qty,0);
  const totalKeluar = movements.filter(m=>m.qty<0).reduce((s,m)=>s+Math.abs(m.qty),0);
  const saldoAkhir = saldoAwal + totalMasuk - totalKeluar;

  document.getElementById('kartuSummaryGrid').innerHTML = [
    { v: fmtNum(saldoAwal), l:'Saldo Awal' },
    { v: fmtNum(totalMasuk), l:'Total Masuk' },
    { v: fmtNum(totalKeluar), l:'Total Keluar' },
    { v: fmtNum(saldoAkhir), l:'Saldo Akhir' },
  ].map(s=>`<div class="summary-card"><div class="summary-value">${s.v}</div><div class="summary-label">${s.l}</div></div>`).join('');

  const pageSize = 15;
  const totalPages = Math.max(1, Math.ceil(rows.length/pageSize));
  ksPage = Math.min(ksPage, totalPages);
  const pageRows = rows.slice((ksPage-1)*pageSize, ksPage*pageSize);

  document.querySelector('#kartuStokTable tbody').innerHTML = pageRows.length ? pageRows.map(m=>{
    const info = MOVEMENT_LABELS[m.tipe] || { label:m.tipe, badge:'badge-neutral' };
    const masuk = m.qty > 0 ? fmtNum(m.qty) : '—';
    const keluar = m.qty < 0 ? fmtNum(Math.abs(m.qty)) : '—';
    return `<tr>
      <td class="cell-muted">${fmtDate(m.tanggal)}</td>
      <td><span class="badge ${info.badge}">${info.label}</span></td>
      <td class="cell-strong">${m.ref_doc}</td>
      <td>${safeLoc(m.location_id).code}</td>
      <td style="color:var(--info);font-weight:700;">${masuk}</td>
      <td style="color:var(--danger);font-weight:700;">${keluar}</td>
      <td class="cell-strong">${fmtNum(m.saldo)}</td>
      <td class="cell-muted">${m.catatan||'—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="8" style="text-align:center;padding:26px;color:var(--text-muted);">Belum ada mutasi pada periode/lokasi ini.</td></tr>`;

  renderPagination('kartuPagination', ksPage, totalPages, rows.length, p=>{ ksPage=p; renderKartuStok(); });
}

function exportKartuCsv(){
  if (!ksSelectedSkuId){ toast('Pilih SKU terlebih dahulu', 'warning'); return; }
  const saldoAwal = getSaldoAwalKartu();
  const movements = getKartuMovements();
  let running = saldoAwal;
  const rows = movements.map(m=>{ running += m.qty; return {...m, saldo:running}; });
  if (!rows.length){ toast('Tidak ada data untuk diekspor', 'warning'); return; }
  const sku = safeSku(ksSelectedSkuId);
  const header = ['Tanggal','Jenis','No Dokumen','Lokasi','Masuk','Keluar','Saldo','Keterangan'];
  const lines = [`SKU;${sku.sku};${sku.nama_produk}`, `Saldo Awal;${saldoAwal}`, '', header.join(';')];
  rows.forEach(m=>{
    const info = MOVEMENT_LABELS[m.tipe] || { label:m.tipe };
    lines.push([fmtDate(m.tanggal), info.label, m.ref_doc, safeLoc(m.location_id).code, m.qty>0?m.qty:'', m.qty<0?Math.abs(m.qty):'', m.saldo, (m.catatan||'').replace(/;/g,',')].join(';'));
  });
  downloadBlob('\uFEFF'+lines.join('\n'), `Kartu_Stok_${sku.sku}_${todayStr()}.csv`, 'text/csv;charset=utf-8;');
  logAudit('EXPORT', 'Laporan Stock', `Export kartu stok ${sku.sku} (${rows.length} baris) ke CSV/XLSX`);
  saveState();
  toast('File CSV terunduh (kompatibel dengan Excel)');
}

function exportKartuPdf(){
  if (!ksSelectedSkuId){ toast('Pilih SKU terlebih dahulu', 'warning'); return; }
  const saldoAwal = getSaldoAwalKartu();
  const movements = getKartuMovements();
  let running = saldoAwal;
  const rows = movements.map(m=>{ running += m.qty; return {...m, saldo:running}; });
  if (!rows.length){ toast('Tidak ada data untuk diekspor', 'warning'); return; }
  const sku = safeSku(ksSelectedSkuId);
  const totalMasuk = movements.filter(m=>m.qty>0).reduce((s,m)=>s+m.qty,0);
  const totalKeluar = movements.filter(m=>m.qty<0).reduce((s,m)=>s+Math.abs(m.qty),0);
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>Kartu Stok - ${sku.sku}</title>
    <style>
      body{font-family:Arial,sans-serif;padding:32px;color:#172B24;}
      h1{margin-bottom:2px;font-size:20px;} .muted{color:#64748B;font-size:12px;}
      table{width:100%;border-collapse:collapse;margin-top:18px;font-size:11px;}
      th,td{border:1px solid #E6EAF0;padding:6px 8px;text-align:left;}
      th{background:#F1F5F9;} .summary{display:flex;gap:24px;margin-top:16px;}
      .box{border:1px solid #E6EAF0;border-radius:8px;padding:10px 16px;}
      .box b{display:block;font-size:16px;}
    </style></head><body>
    <h1>${state.settings.company_name}</h1>
    <p class="muted">Kartu Stok — ${sku.sku} · ${sku.nama_produk}${ksSelectedLocationId ? ' · '+safeLoc(ksSelectedLocationId).code : ' · Semua Lokasi'}</p>
    <p class="muted">Dibuat: ${fmtDateTime(new Date().toISOString())}</p>
    <div class="summary">
      <div class="box"><b>${fmtNum(saldoAwal)}</b>Saldo Awal</div>
      <div class="box"><b>${fmtNum(totalMasuk)}</b>Total Masuk</div>
      <div class="box"><b>${fmtNum(totalKeluar)}</b>Total Keluar</div>
      <div class="box"><b>${fmtNum(saldoAwal+totalMasuk-totalKeluar)}</b>Saldo Akhir</div>
    </div>
    <table><thead><tr><th>Tanggal</th><th>Jenis</th><th>No Dokumen</th><th>Lokasi</th><th>Masuk</th><th>Keluar</th><th>Saldo</th></tr></thead>
    <tbody>${rows.map(m=>{
      const info = MOVEMENT_LABELS[m.tipe] || { label:m.tipe };
      return `<tr><td>${fmtDate(m.tanggal)}</td><td>${info.label}</td><td>${m.ref_doc}</td><td>${safeLoc(m.location_id).code}</td><td>${m.qty>0?m.qty:''}</td><td>${m.qty<0?Math.abs(m.qty):''}</td><td>${m.saldo}</td></tr>`;
    }).join('')}</tbody></table>
    </body></html>`);
  win.document.close();
  setTimeout(()=> win.print(), 300);
  logAudit('EXPORT', 'Laporan Stock', `Export kartu stok ${sku.sku} (${rows.length} baris) ke PDF`);
  saveState();
}

/* ==========================================================================
   REKAP SO
   ========================================================================== */

function initRekap(){
  ['rkTglMulai','rkTglAkhir','rkOperator','rkStatus','rkGudang','rkJenisLokasi'].forEach(id=>{
    document.getElementById(id).addEventListener('change', ()=>{ ui.rekapPage=1; renderRekap(); });
  });
  document.getElementById('rkSearch').addEventListener('input', debounce(()=>{ ui.rekapPage=1; renderRekap(); }, 200));
  document.getElementById('btnResetFilterRekap').addEventListener('click', ()=>{
    ['rkTglMulai','rkTglAkhir','rkSearch'].forEach(id=>document.getElementById(id).value='');
    ['rkOperator','rkStatus','rkGudang','rkJenisLokasi'].forEach(id=>document.getElementById(id).value='all');
    ui.rekapPage = 1; renderRekap();
  });
  document.getElementById('btnExportCsv').addEventListener('click', exportRekapCsv);
  document.getElementById('btnExportPdf').addEventListener('click', exportRekapPdf);
}

function getRekapFiltered(){
  const tglMulai = document.getElementById('rkTglMulai').value;
  const tglAkhir = document.getElementById('rkTglAkhir').value;
  const operator = document.getElementById('rkOperator').value;
  const status = document.getElementById('rkStatus').value;
  const gudang = document.getElementById('rkGudang').value;
  const jenis = document.getElementById('rkJenisLokasi').value;
  const q = document.getElementById('rkSearch').value.trim().toLowerCase();

  return state.soItems.filter(it=>{
    if (!it.is_final) return false;
    if (tglMulai && it.tanggal < tglMulai) return false;
    if (tglAkhir && it.tanggal > tglAkhir) return false;
    if (operator!=='all' && it.operator_id!==operator) return false;
    if (status!=='all' && it.status!==status) return false;
    const loc = mLoc[it.location_id];
    if (gudang!=='all' && loc.warehouse_id!==gudang) return false;
    if (jenis!=='all' && loc.location_type!==jenis) return false;
    if (q){
      const sku = mSku[it.sku_id];
      const hay = (sku.sku+' '+sku.nama_produk+' '+loc.code+' '+loc.name).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a,b)=> b.waktu.localeCompare(a.waktu));
}

function renderRekap(){
  const rows = getRekapFiltered();
  const sesuai = rows.filter(r=>r.status==='Sesuai').length;
  const plus = rows.filter(r=>r.status==='Selisih Plus').length;
  const minus = rows.filter(r=>r.status==='Selisih Minus').length;
  const netVar = rows.reduce((s,r)=>s+r.selisih,0);
  const absVar = rows.reduce((s,r)=>s+Math.abs(r.selisih),0);
  const akurasi = rows.length ? (sesuai/rows.length*100) : 0;

  const summary = [
    { v: akurasi.toFixed(1)+'%', l:'Akurasi Stock' },
    { v: fmtNum(rows.length), l:'Total Sudah SO' },
    { v: fmtNum(sesuai), l:'Jumlah Klop' },
    { v: fmtNum(minus), l:'Selisih Minus' },
    { v: fmtNum(plus), l:'Selisih Plus' },
    { v: fmtSigned(netVar)+' / '+fmtNum(absVar), l:'Variance Net / Absolut' },
  ];
  document.getElementById('rekapSummaryGrid').innerHTML = summary.map(s=>`
    <div class="summary-card"><div class="summary-value">${s.v}</div><div class="summary-label">${s.l}</div></div>`).join('');

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length/pageSize));
  ui.rekapPage = Math.min(ui.rekapPage, totalPages);
  const pageRows = rows.slice((ui.rekapPage-1)*pageSize, ui.rekapPage*pageSize);

  document.querySelector('#rekapTable tbody').innerHTML = pageRows.length ? pageRows.map((r,idx)=>{
    const sku = safeSku(r.sku_id), loc = safeLoc(r.location_id);
    return `<tr>
      <td>${(ui.rekapPage-1)*pageSize + idx + 1}</td>
      <td>${fmtDate(r.tanggal)}</td>
      <td class="cell-strong">${r.so_number}</td>
      <td class="cell-strong">${sku.sku}</td>
      <td>${sku.nama_produk}</td>
      <td>${loc.code}</td>
      <td class="cell-muted">${safeWh(loc.warehouse_id).name}</td>
      <td>${safeStaff(r.operator_id).name}</td>
      <td>${fmtNum(r.qty_system)}</td>
      <td>${fmtNum(r.qty_fisik)}</td>
      <td style="color:${r.selisih===0?'var(--success)':r.selisih>0?'var(--info)':'var(--danger)'};font-weight:700;">${fmtSigned(r.selisih)}</td>
      <td><span class="badge ${statusBadgeClass(r.status)}">${r.status}</span></td>
      <td class="cell-muted">${r.catatan || '—'}</td>
      <td class="cell-muted">${fmtDateTime(r.waktu)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="14" style="text-align:center;padding:30px;color:var(--text-muted);">Tidak ada data yang cocok dengan filter.</td></tr>`;

  renderPagination('rekapPagination', ui.rekapPage, totalPages, rows.length, (p)=>{ ui.rekapPage=p; renderRekap(); });
}

function renderPagination(elId, page, totalPages, totalRows, onGo){
  const el = document.getElementById(elId);
  let btns = '';
  for (let p=1; p<=totalPages; p++){
    if (p===1 || p===totalPages || Math.abs(p-page)<=1){
      btns += `<button class="pg-btn ${p===page?'active':''}" data-p="${p}">${p}</button>`;
    } else if (Math.abs(p-page)===2){
      btns += `<span style="padding:0 4px;">…</span>`;
    }
  }
  el.innerHTML = `<span>${totalRows} baris · Halaman ${page} dari ${totalPages}</span><div class="pagination-controls">
    <button class="pg-btn" id="${elId}Prev" ${page<=1?'disabled':''}>‹</button>
    ${btns}
    <button class="pg-btn" id="${elId}Next" ${page>=totalPages?'disabled':''}>›</button>
  </div>`;
  el.querySelectorAll('[data-p]').forEach(b=>b.addEventListener('click', ()=>onGo(parseInt(b.dataset.p,10))));
  const prev = document.getElementById(elId+'Prev'), next = document.getElementById(elId+'Next');
  if (prev) prev.addEventListener('click', ()=> page>1 && onGo(page-1));
  if (next) next.addEventListener('click', ()=> page<totalPages && onGo(page+1));
}

function downloadBlob(content, filename, type){
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportRekapCsv(){
  const rows = getRekapFiltered();
  if (!rows.length){ toast('Tidak ada data untuk diekspor', 'warning'); return; }
  const header = ['No','Tanggal','No SO','SKU','Nama Produk','Lokasi','Gudang','Operator','Qty System','Qty Fisik','Selisih','Status','Catatan','Waktu'];
  const lines = [header.join(';')];
  rows.forEach((r,idx)=>{
    const sku=safeSku(r.sku_id), loc=safeLoc(r.location_id);
    lines.push([idx+1, r.tanggal, r.so_number, sku.sku, sku.nama_produk.replace(/;/g,','), loc.code, safeWh(loc.warehouse_id).name, safeStaff(r.operator_id).name, r.qty_system, r.qty_fisik, r.selisih, r.status, (r.catatan||'').replace(/;/g,','), r.waktu].join(';'));
  });
  downloadBlob('\uFEFF'+lines.join('\n'), `Rekap_SO_${todayStr()}.csv`, 'text/csv;charset=utf-8;');
  logAudit('EXPORT', 'Rekap SO', `Export ${rows.length} baris ke CSV/XLSX`);
  saveState();
  toast('File CSV terunduh (kompatibel dengan Excel)');
}

function exportRekapPdf(){
  const rows = getRekapFiltered();
  if (!rows.length){ toast('Tidak ada data untuk diekspor', 'warning'); return; }
  const sesuai = rows.filter(r=>r.status==='Sesuai').length;
  const win = window.open('', '_blank');
  win.document.write(`
    <html><head><title>Laporan Rekap SO</title>
    <style>
      body{font-family:Arial,sans-serif;padding:32px;color:#172B24;}
      h1{margin-bottom:2px;} .muted{color:#64748B;font-size:12px;}
      table{width:100%;border-collapse:collapse;margin-top:18px;font-size:11px;}
      th,td{border:1px solid #E6EAF0;padding:6px 8px;text-align:left;}
      th{background:#F1F5F9;} .summary{display:flex;gap:24px;margin-top:16px;}
      .box{border:1px solid #E6EAF0;border-radius:8px;padding:10px 16px;}
      .box b{display:block;font-size:16px;}
    </style></head><body>
    <h1>${state.settings.company_name}</h1>
    <p class="muted">${state.settings.warehouse_name} (${state.settings.warehouse_code}) — Laporan Rekap Stock Opname</p>
    <p class="muted">Dibuat: ${fmtDateTime(new Date().toISOString())}</p>
    <div class="summary">
      <div class="box"><b>${rows.length}</b>Total baris</div>
      <div class="box"><b>${(sesuai/rows.length*100).toFixed(1)}%</b>Akurasi</div>
      <div class="box"><b>${sesuai}</b>Sesuai</div>
    </div>
    <table><thead><tr><th>Tgl</th><th>No SO</th><th>SKU</th><th>Nama Produk</th><th>Lokasi</th><th>Operator</th><th>Sistem</th><th>Fisik</th><th>Selisih</th><th>Status</th></tr></thead>
    <tbody>${rows.map(r=>{
      const sku=safeSku(r.sku_id), loc=safeLoc(r.location_id);
      return `<tr><td>${fmtDate(r.tanggal)}</td><td>${r.so_number}</td><td>${sku.sku}</td><td>${sku.nama_produk}</td><td>${loc.code}</td><td>${safeStaff(r.operator_id).name}</td><td>${r.qty_system}</td><td>${r.qty_fisik}</td><td>${r.selisih}</td><td>${r.status}</td></tr>`;
    }).join('')}</tbody></table>
    </body></html>`);
  win.document.close();
  setTimeout(()=> win.print(), 300);
  logAudit('EXPORT', 'Rekap SO', `Export ${rows.length} baris ke PDF`);
  saveState();
}

/* ==========================================================================
   MASTER DATA
   ========================================================================== */

function initMaster(){
  document.querySelectorAll('#masterTabBar .tab-item').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      document.querySelectorAll('#masterTabBar .tab-item').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-'+tab.dataset.tab).classList.add('active');
    });
  });

  document.getElementById('barangSearch').addEventListener('input', debounce(()=>{ ui.barangPage=1; renderBarangTable(); },200));
  document.getElementById('barangKategoriFilter').addEventListener('change', ()=>{ ui.barangPage=1; renderBarangTable(); });
  document.getElementById('btnAddBarang').addEventListener('click', ()=> openBarangModal());
  document.getElementById('btnImportBarang').addEventListener('click', ()=> openImportModal('barang'));

  document.getElementById('lokasiSearch').addEventListener('input', debounce(()=>{ ui.lokasiPage=1; renderLokasiTable(); },200));
  document.getElementById('lokasiGudangFilter').addEventListener('change', ()=>{ ui.lokasiPage=1; renderLokasiTable(); });
  document.getElementById('lokasiJenisFilter').addEventListener('change', ()=>{ ui.lokasiPage=1; renderLokasiTable(); });
  document.getElementById('btnAddLokasi').addEventListener('click', ()=> openLokasiModal());
  document.getElementById('btnImportLokasi').addEventListener('click', ()=> openImportModal('lokasi'));

  document.getElementById('gudangSearch').addEventListener('input', debounce(renderGudangTable,200));
  document.getElementById('btnAddGudang').addEventListener('click', ()=> openGudangModal());

  document.getElementById('staffSearch').addEventListener('input', debounce(renderStaffTable,200));
  document.getElementById('btnAddStaff').addEventListener('click', ()=> openStaffModal());

  document.getElementById('supplierSearch').addEventListener('input', debounce(renderSupplierTable,200));
  document.getElementById('btnAddSupplier').addEventListener('click', ()=> openSupplierModal());

  document.getElementById('customerSearch').addEventListener('input', debounce(renderCustomerTable,200));
  document.getElementById('btnAddCustomer').addEventListener('click', ()=> openCustomerModal());
}

function renderMaster(){
  renderBarangTable();
  renderLokasiTable();
  renderGudangTable();
  renderStaffTable();
  renderSupplierTable();
  renderCustomerTable();
}

/* ---- Barang ---- */
function renderBarangTable(){
  const q = document.getElementById('barangSearch').value.trim().toLowerCase();
  const kat = document.getElementById('barangKategoriFilter').value;
  let rows = state.skus.filter(s=>{
    if (kat!=='all' && s.kategori!==kat) return false;
    if (q && !(s.sku.toLowerCase().includes(q) || s.nama_produk.toLowerCase().includes(q))) return false;
    return true;
  });
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length/pageSize));
  ui.barangPage = Math.min(ui.barangPage, totalPages);
  const pageRows = rows.slice((ui.barangPage-1)*pageSize, ui.barangPage*pageSize);

  document.querySelector('#barangTable tbody').innerHTML = pageRows.length ? pageRows.map(s=>`
    <tr>
      <td class="cell-strong">${s.sku}</td>
      <td class="cell-muted">${s.sku_induk || '—'}</td>
      <td>${s.nama_produk}</td>
      <td>${s.kategori}</td>
      <td>${s.unit}</td>
      <td><button class="toggle-status" data-id="${s.id}" data-kind="sku"><span class="badge ${s.is_active?'badge-success':'badge-neutral'}">${s.is_active?'Aktif':'Nonaktif'}</span></button></td>
      <td><div class="row-actions">
        <button class="row-action-btn" data-edit="sku" data-id="${s.id}"><span class="material-symbols-outlined" style="font-size:16px;">edit</span></button>
        <button class="row-action-btn danger" data-delete="sku" data-id="${s.id}"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>
      </div></td>
    </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;padding:26px;color:var(--text-muted);">Tidak ada barang yang cocok.</td></tr>`;

  bindRowActions('sku');
  renderPagination('barangPagination', ui.barangPage, totalPages, rows.length, p=>{ ui.barangPage=p; renderBarangTable(); });
}

/* ---- Lokasi ---- */
function renderLokasiTable(){
  const q = document.getElementById('lokasiSearch').value.trim().toLowerCase();
  const wh = document.getElementById('lokasiGudangFilter').value;
  const jenis = document.getElementById('lokasiJenisFilter').value;
  let rows = state.locations.filter(l=>{
    if (wh!=='all' && l.warehouse_id!==wh) return false;
    if (jenis!=='all' && l.location_type!==jenis) return false;
    if (q && !(l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q))) return false;
    return true;
  });
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(rows.length/pageSize));
  ui.lokasiPage = Math.min(ui.lokasiPage, totalPages);
  const pageRows = rows.slice((ui.lokasiPage-1)*pageSize, ui.lokasiPage*pageSize);

  document.querySelector('#lokasiTable tbody').innerHTML = pageRows.length ? pageRows.map(l=>`
    <tr>
      <td class="cell-strong">${l.code}</td>
      <td>${l.name}</td>
      <td class="cell-muted">${mWh[l.warehouse_id].name}</td>
      <td>${l.location_type}</td>
      <td><button class="toggle-status" data-id="${l.id}" data-kind="lokasi"><span class="badge ${l.is_active?'badge-success':'badge-neutral'}">${l.is_active?'Aktif':'Nonaktif'}</span></button></td>
      <td><div class="row-actions">
        <button class="row-action-btn" data-edit="lokasi" data-id="${l.id}"><span class="material-symbols-outlined" style="font-size:16px;">edit</span></button>
        <button class="row-action-btn danger" data-delete="lokasi" data-id="${l.id}"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>
      </div></td>
    </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;padding:26px;color:var(--text-muted);">Tidak ada lokasi yang cocok.</td></tr>`;

  bindRowActions('lokasi');
  renderPagination('lokasiPagination', ui.lokasiPage, totalPages, rows.length, p=>{ ui.lokasiPage=p; renderLokasiTable(); });
}

/* ---- Gudang ---- */
function renderGudangTable(){
  const q = document.getElementById('gudangSearch').value.trim().toLowerCase();
  let rows = state.warehouses.filter(w=> !q || w.code.toLowerCase().includes(q) || w.name.toLowerCase().includes(q));
  document.querySelector('#gudangTable tbody').innerHTML = rows.length ? rows.map(w=>`
    <tr>
      <td class="cell-strong">${w.code}</td>
      <td>${w.name}</td>
      <td class="cell-muted">${w.pic || '—'}</td>
      <td class="cell-muted">${w.phone || '—'}</td>
      <td><button class="toggle-status" data-id="${w.id}" data-kind="gudang"><span class="badge ${w.is_active?'badge-success':'badge-neutral'}">${w.is_active?'Aktif':'Nonaktif'}</span></button></td>
      <td><div class="row-actions">
        <button class="row-action-btn" data-edit="gudang" data-id="${w.id}"><span class="material-symbols-outlined" style="font-size:16px;">edit</span></button>
        <button class="row-action-btn danger" data-delete="gudang" data-id="${w.id}"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>
      </div></td>
    </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;padding:26px;color:var(--text-muted);">Tidak ada gudang yang cocok.</td></tr>`;
  bindRowActions('gudang');
}

/* ---- Staff ---- */
function renderStaffTable(){
  const q = document.getElementById('staffSearch').value.trim().toLowerCase();
  let rows = state.staff.filter(s=> !q || s.name.toLowerCase().includes(q) || s.email.toLowerCase().includes(q));
  document.querySelector('#staffTable tbody').innerHTML = rows.length ? rows.map(s=>`
    <tr>
      <td class="cell-strong">${s.name}</td>
      <td class="cell-muted">${s.email}</td>
      <td><span class="badge ${s.role==='Admin'?'badge-info':'badge-neutral'}">${s.role}</span></td>
      <td class="cell-muted">${mWh[s.warehouse_id] ? mWh[s.warehouse_id].name : '—'}</td>
      <td><button class="toggle-status" data-id="${s.id}" data-kind="staff"><span class="badge ${s.is_active?'badge-success':'badge-neutral'}">${s.is_active?'Aktif':'Nonaktif'}</span></button></td>
      <td><div class="row-actions">
        <button class="row-action-btn" data-edit="staff" data-id="${s.id}"><span class="material-symbols-outlined" style="font-size:16px;">edit</span></button>
        <button class="row-action-btn danger" data-delete="staff" data-id="${s.id}"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>
      </div></td>
    </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;padding:26px;color:var(--text-muted);">Tidak ada staff yang cocok.</td></tr>`;
  bindRowActions('staff');
}

/* ---- Supplier ---- */
function renderSupplierTable(){
  const q = document.getElementById('supplierSearch').value.trim().toLowerCase();
  let rows = state.suppliers.filter(s=> !q || s.name.toLowerCase().includes(q));
  document.querySelector('#supplierTable tbody').innerHTML = rows.length ? rows.map(s=>`
    <tr>
      <td class="cell-strong">${s.name}</td>
      <td class="cell-muted">${s.contact_person || '—'}</td>
      <td class="cell-muted">${s.phone || '—'}</td>
      <td class="cell-muted">${s.address || '—'}</td>
      <td><button class="toggle-status" data-id="${s.id}" data-kind="supplier"><span class="badge ${s.is_active?'badge-success':'badge-neutral'}">${s.is_active?'Aktif':'Nonaktif'}</span></button></td>
      <td><div class="row-actions">
        <button class="row-action-btn" data-edit="supplier" data-id="${s.id}"><span class="material-symbols-outlined" style="font-size:16px;">edit</span></button>
        <button class="row-action-btn danger" data-delete="supplier" data-id="${s.id}"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>
      </div></td>
    </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;padding:26px;color:var(--text-muted);">Tidak ada supplier yang cocok.</td></tr>`;
  bindRowActions('supplier');
}

/* ---- Customer ---- */
function renderCustomerTable(){
  const q = document.getElementById('customerSearch').value.trim().toLowerCase();
  let rows = state.customers.filter(c=> !q || c.name.toLowerCase().includes(q));
  document.querySelector('#customerTable tbody').innerHTML = rows.length ? rows.map(c=>`
    <tr>
      <td class="cell-strong">${c.name}</td>
      <td class="cell-muted">${c.contact_person || '—'}</td>
      <td class="cell-muted">${c.phone || '—'}</td>
      <td class="cell-muted">${c.address || '—'}</td>
      <td><button class="toggle-status" data-id="${c.id}" data-kind="customer"><span class="badge ${c.is_active?'badge-success':'badge-neutral'}">${c.is_active?'Aktif':'Nonaktif'}</span></button></td>
      <td><div class="row-actions">
        <button class="row-action-btn" data-edit="customer" data-id="${c.id}"><span class="material-symbols-outlined" style="font-size:16px;">edit</span></button>
        <button class="row-action-btn danger" data-delete="customer" data-id="${c.id}"><span class="material-symbols-outlined" style="font-size:16px;">delete</span></button>
      </div></td>
    </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;padding:26px;color:var(--text-muted);">Tidak ada customer yang cocok.</td></tr>`;
  bindRowActions('customer');
}

const MASTER_KIND_CONFIG = {
  sku:      { arr:()=>state.skus,       label:'barang',   module:'Master Barang',   render:renderBarangTable },
  lokasi:   { arr:()=>state.locations,  label:'lokasi',   module:'Master Lokasi',   render:renderLokasiTable },
  gudang:   { arr:()=>state.warehouses, label:'gudang',   module:'Master Gudang',   render:renderGudangTable },
  staff:    { arr:()=>state.staff,      label:'staff',    module:'Master Staff',    render:renderStaffTable },
  supplier: { arr:()=>state.suppliers,  label:'supplier', module:'Master Supplier', render:renderSupplierTable },
  customer: { arr:()=>state.customers,  label:'customer', module:'Master Customer', render:renderCustomerTable },
};

function bindRowActions(kind){
  const cfg = MASTER_KIND_CONFIG[kind];
  document.querySelectorAll(`.toggle-status[data-kind="${kind}"]`).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const item = cfg.arr().find(x=>x.id===btn.dataset.id);
      item.is_active = !item.is_active;
      logAudit('UPDATE', cfg.module, `Ubah status ${item.name||item.sku||item.code} menjadi ${item.is_active?'Aktif':'Nonaktif'}`);
      saveState();
      cfg.render();
    });
  });
  document.querySelectorAll(`[data-edit="${kind}"]`).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      if (kind==='sku') openBarangModal(btn.dataset.id);
      if (kind==='lokasi') openLokasiModal(btn.dataset.id);
      if (kind==='gudang') openGudangModal(btn.dataset.id);
      if (kind==='staff') openStaffModal(btn.dataset.id);
      if (kind==='supplier') openSupplierModal(btn.dataset.id);
      if (kind==='customer') openCustomerModal(btn.dataset.id);
    });
  });
  document.querySelectorAll(`[data-delete="${kind}"]`).forEach(btn=>{
    btn.addEventListener('click', ()=> confirmDeleteMaster(kind, btn.dataset.id));
  });
}

function confirmDeleteMaster(kind, id){
  const cfg = MASTER_KIND_CONFIG[kind];
  if (kind==='gudang'){
    const dependentLocs = state.locations.filter(l=>l.warehouse_id===id);
    if (dependentLocs.length){
      Swal.fire({ icon:'error', title:'Tidak bisa dihapus', text:`Gudang ini masih punya ${dependentLocs.length} lokasi terdaftar. Pindahkan atau hapus lokasi tersebut dulu.` });
      return;
    }
  }
  Swal.fire({
    title:`Hapus ${cfg.label} ini?`, text:'Data historis yang sudah tersimpan tidak akan terhapus.',
    icon:'warning', showCancelButton:true, confirmButtonText:'Ya, hapus', cancelButtonText:'Batal', confirmButtonColor:'#DC2626'
  }).then(res=>{
    if (!res.isConfirmed) return;
    const arr = cfg.arr();
    const idx = arr.findIndex(x=>x.id===id);
    if (idx>-1) arr.splice(idx,1);
    logAudit('DELETE', cfg.module, `Menghapus ${cfg.label} ${id}`);
    rebuildIndexes(); saveState();
    cfg.render();
    populateSharedFilters();
    toast(`${cfg.label[0].toUpperCase()+cfg.label.slice(1)} dihapus`);
  });
}

/* ---- Generic modal helper ---- */
function openModal(title, bodyHtml, onSubmit){
  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-overlay" id="genericModal">
      <div class="modal-box">
        <div class="modal-head"><h3>${title}</h3><button class="modal-close" id="genericModalClose"><span class="material-symbols-outlined">close</span></button></div>
        <form id="genericModalForm"><div class="modal-body">${bodyHtml}</div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline" id="genericModalCancel">Batal</button>
            <button type="submit" class="btn btn-primary">Simpan</button>
          </div>
        </form>
      </div>
    </div>`;
  const close = ()=> document.getElementById('modalRoot').innerHTML = '';
  document.getElementById('genericModalClose').addEventListener('click', close);
  document.getElementById('genericModalCancel').addEventListener('click', close);
  document.getElementById('genericModalForm').addEventListener('submit', (e)=>{
    e.preventDefault();
    onSubmit();
    close();
  });
}

function openBarangModal(id){
  const editing = id ? state.skus.find(s=>s.id===id) : null;
  const kategoriOptions = ['Kabel & Konektor','Charger & Adaptor','Power Bank','Hub & Docking Station','Audio','Networking','Aksesoris Elektronik'];
  openModal(editing ? 'Edit Barang' : 'Tambah Barang', `
    <div class="form-grid form-grid-2">
      <label class="field"><span class="field-label">SKU <span class="req">*</span></span><input type="text" id="mSkuCode" value="${editing?editing.sku:''}" required></label>
      <label class="field"><span class="field-label">SKU Induk</span><input type="text" id="mSkuInduk" value="${editing?editing.sku_induk:''}"></label>
    </div>
    <label class="field"><span class="field-label">Nama Produk <span class="req">*</span></span><input type="text" id="mSkuNama" value="${editing?editing.nama_produk:''}" required></label>
    <div class="form-grid form-grid-2">
      <label class="field"><span class="field-label">Kategori</span>
        <select id="mSkuKategori">${kategoriOptions.map(k=>`<option ${editing&&editing.kategori===k?'selected':''}>${k}</option>`).join('')}</select>
      </label>
      <label class="field"><span class="field-label">Unit</span><input type="text" id="mSkuUnit" value="${editing?editing.unit:'Pcs'}"></label>
    </div>
  `, ()=>{
    const sku = document.getElementById('mSkuCode').value.trim();
    const nama = document.getElementById('mSkuNama').value.trim();
    if (!sku || !nama){ toast('SKU dan Nama Produk wajib diisi','warning'); return; }
    if (editing){
      Object.assign(editing, { sku, sku_induk:document.getElementById('mSkuInduk').value.trim(), nama_produk:nama, kategori:document.getElementById('mSkuKategori').value, unit:document.getElementById('mSkuUnit').value.trim()||'Pcs' });
      logAudit('UPDATE','Master Barang',`Mengubah data ${sku}`);
    } else {
      state.skus.push({ id:'sku-'+Date.now(), sku, sku_induk:document.getElementById('mSkuInduk').value.trim(), nama_produk:nama, varian:'', kategori:document.getElementById('mSkuKategori').value, unit:document.getElementById('mSkuUnit').value.trim()||'Pcs', foto_url:'', is_active:true });
      logAudit('CREATE','Master Barang',`Menambahkan SKU baru ${sku}`);
    }
    rebuildIndexes(); saveState(); renderBarangTable(); populateSharedFilters();
    toast('Data barang tersimpan');
  });
}

function openLokasiModal(id){
  const editing = id ? state.locations.find(l=>l.id===id) : null;
  const jenisOptions = ['Picking','Simpan Stok','After Pick Sementara','Returan Sementara'];
  openModal(editing ? 'Edit Lokasi' : 'Tambah Lokasi', `
    <div class="form-grid form-grid-2">
      <label class="field"><span class="field-label">Kode Lokasi <span class="req">*</span></span><input type="text" id="mLocCode" value="${editing?editing.code:''}" required></label>
      <label class="field"><span class="field-label">Gudang</span>
        <select id="mLocWh">${state.warehouses.map(w=>`<option value="${w.id}" ${editing&&editing.warehouse_id===w.id?'selected':''}>${w.name}</option>`).join('')}</select>
      </label>
    </div>
    <label class="field"><span class="field-label">Nama Lokasi</span><input type="text" id="mLocName" value="${editing?editing.name:''}"></label>
    <label class="field"><span class="field-label">Jenis Lokasi</span>
      <select id="mLocType">${jenisOptions.map(j=>`<option ${editing&&editing.location_type===j?'selected':''}>${j}</option>`).join('')}</select>
    </label>
  `, ()=>{
    const code = document.getElementById('mLocCode').value.trim();
    if (!code){ toast('Kode Lokasi wajib diisi','warning'); return; }
    if (editing){
      Object.assign(editing, { code, warehouse_id:document.getElementById('mLocWh').value, name:document.getElementById('mLocName').value.trim(), location_type:document.getElementById('mLocType').value });
      logAudit('UPDATE','Master Lokasi',`Mengubah data ${code}`);
    } else {
      state.locations.push({ id:'loc-'+Date.now(), code, name:document.getElementById('mLocName').value.trim()||code, warehouse_id:document.getElementById('mLocWh').value, location_type:document.getElementById('mLocType').value, is_active:true });
      logAudit('CREATE','Master Lokasi',`Menambahkan lokasi baru ${code}`);
    }
    rebuildIndexes(); saveState(); renderLokasiTable(); populateSharedFilters();
    toast('Data lokasi tersimpan');
  });
}

function openStaffModal(id){
  const editing = id ? state.staff.find(s=>s.id===id) : null;
  openModal(editing ? 'Edit Staff' : 'Tambah Staff', `
    <label class="field"><span class="field-label">Nama <span class="req">*</span></span><input type="text" id="mStaffName" value="${editing?editing.name:''}" required></label>
    <label class="field"><span class="field-label">Email <span class="req">*</span></span><input type="email" id="mStaffEmail" value="${editing?editing.email:''}" required></label>
    <div class="form-grid form-grid-2">
      <label class="field"><span class="field-label">Role</span>
        <select id="mStaffRole"><option ${editing&&editing.role==='Admin'?'selected':''}>Admin</option><option ${editing&&editing.role==='Operator'?'selected':''}>Operator</option></select>
      </label>
      <label class="field"><span class="field-label">Gudang</span>
        <select id="mStaffWh">${state.warehouses.map(w=>`<option value="${w.id}" ${editing&&editing.warehouse_id===w.id?'selected':''}>${w.name}</option>`).join('')}</select>
      </label>
    </div>
  `, ()=>{
    const name = document.getElementById('mStaffName').value.trim();
    const email = document.getElementById('mStaffEmail').value.trim();
    if (!name || !email){ toast('Nama dan email wajib diisi','warning'); return; }
    if (editing){
      Object.assign(editing, { name, email, role:document.getElementById('mStaffRole').value, warehouse_id:document.getElementById('mStaffWh').value });
      logAudit('UPDATE','Master Staff',`Mengubah data ${name}`);
    } else {
      state.staff.push({ id:'staff-'+Date.now(), name, email, role:document.getElementById('mStaffRole').value, warehouse_id:document.getElementById('mStaffWh').value, is_active:true });
      logAudit('CREATE','Master Staff',`Menambahkan staff baru ${name}`);
    }
    rebuildIndexes(); saveState(); renderStaffTable(); populateSharedFilters();
    toast('Data staff tersimpan');
  });
}

function openGudangModal(id){
  const editing = id ? state.warehouses.find(w=>w.id===id) : null;
  openModal(editing ? 'Edit Gudang' : 'Tambah Gudang', `
    <div class="form-grid form-grid-2">
      <label class="field"><span class="field-label">Kode Gudang <span class="req">*</span></span><input type="text" id="mWhCode" value="${editing?editing.code:''}" required></label>
      <label class="field"><span class="field-label">Nama Gudang <span class="req">*</span></span><input type="text" id="mWhName" value="${editing?editing.name:''}" required></label>
    </div>
    <label class="field"><span class="field-label">Alamat</span><input type="text" id="mWhAddress" value="${editing?(editing.address||''):''}"></label>
    <div class="form-grid form-grid-2">
      <label class="field"><span class="field-label">PIC</span><input type="text" id="mWhPic" value="${editing?(editing.pic||''):''}"></label>
      <label class="field"><span class="field-label">Telepon</span><input type="text" id="mWhPhone" value="${editing?(editing.phone||''):''}"></label>
    </div>
  `, ()=>{
    const code = document.getElementById('mWhCode').value.trim();
    const name = document.getElementById('mWhName').value.trim();
    if (!code || !name){ toast('Kode dan Nama Gudang wajib diisi','warning'); return; }
    if (editing){
      Object.assign(editing, { code, name, address:document.getElementById('mWhAddress').value.trim(), pic:document.getElementById('mWhPic').value.trim(), phone:document.getElementById('mWhPhone').value.trim() });
      logAudit('UPDATE','Master Gudang',`Mengubah data ${code}`);
    } else {
      state.warehouses.push({ id:'wh-'+Date.now(), code, name, address:document.getElementById('mWhAddress').value.trim(), pic:document.getElementById('mWhPic').value.trim(), phone:document.getElementById('mWhPhone').value.trim(), is_active:true });
      logAudit('CREATE','Master Gudang',`Menambahkan gudang baru ${code}`);
    }
    rebuildIndexes(); saveState(); renderGudangTable(); populateSharedFilters();
    toast('Data gudang tersimpan');
  });
}

function openSupplierModal(id){
  const editing = id ? state.suppliers.find(s=>s.id===id) : null;
  openModal(editing ? 'Edit Supplier' : 'Tambah Supplier', `
    <label class="field"><span class="field-label">Nama Supplier <span class="req">*</span></span><input type="text" id="mSupName" value="${editing?editing.name:''}" required></label>
    <div class="form-grid form-grid-2">
      <label class="field"><span class="field-label">Kontak Person</span><input type="text" id="mSupContact" value="${editing?(editing.contact_person||''):''}"></label>
      <label class="field"><span class="field-label">Telepon</span><input type="text" id="mSupPhone" value="${editing?(editing.phone||''):''}"></label>
    </div>
    <label class="field"><span class="field-label">Alamat</span><input type="text" id="mSupAddress" value="${editing?(editing.address||''):''}"></label>
  `, ()=>{
    const name = document.getElementById('mSupName').value.trim();
    if (!name){ toast('Nama Supplier wajib diisi','warning'); return; }
    if (editing){
      Object.assign(editing, { name, contact_person:document.getElementById('mSupContact').value.trim(), phone:document.getElementById('mSupPhone').value.trim(), address:document.getElementById('mSupAddress').value.trim() });
      logAudit('UPDATE','Master Supplier',`Mengubah data ${name}`);
    } else {
      state.suppliers.push({ id:'sup-'+Date.now(), name, contact_person:document.getElementById('mSupContact').value.trim(), phone:document.getElementById('mSupPhone').value.trim(), address:document.getElementById('mSupAddress').value.trim(), is_active:true });
      logAudit('CREATE','Master Supplier',`Menambahkan supplier baru ${name}`);
    }
    rebuildIndexes(); saveState(); renderSupplierTable();
    toast('Data supplier tersimpan');
  });
}

function openCustomerModal(id){
  const editing = id ? state.customers.find(c=>c.id===id) : null;
  openModal(editing ? 'Edit Customer' : 'Tambah Customer', `
    <label class="field"><span class="field-label">Nama Customer <span class="req">*</span></span><input type="text" id="mCusName" value="${editing?editing.name:''}" required></label>
    <div class="form-grid form-grid-2">
      <label class="field"><span class="field-label">Kontak Person</span><input type="text" id="mCusContact" value="${editing?(editing.contact_person||''):''}"></label>
      <label class="field"><span class="field-label">Telepon</span><input type="text" id="mCusPhone" value="${editing?(editing.phone||''):''}"></label>
    </div>
    <label class="field"><span class="field-label">Alamat</span><input type="text" id="mCusAddress" value="${editing?(editing.address||''):''}"></label>
  `, ()=>{
    const name = document.getElementById('mCusName').value.trim();
    if (!name){ toast('Nama Customer wajib diisi','warning'); return; }
    if (editing){
      Object.assign(editing, { name, contact_person:document.getElementById('mCusContact').value.trim(), phone:document.getElementById('mCusPhone').value.trim(), address:document.getElementById('mCusAddress').value.trim() });
      logAudit('UPDATE','Master Customer',`Mengubah data ${name}`);
    } else {
      state.customers.push({ id:'cus-'+Date.now(), name, contact_person:document.getElementById('mCusContact').value.trim(), phone:document.getElementById('mCusPhone').value.trim(), address:document.getElementById('mCusAddress').value.trim(), is_active:true });
      logAudit('CREATE','Master Customer',`Menambahkan customer baru ${name}`);
    }
    rebuildIndexes(); saveState(); renderCustomerTable();
    toast('Data customer tersimpan');
  });
}

/* ---- Import wizard ---- */
function openImportModal(target){
  ui.importTarget = target; ui.importStep = 1; ui.lastImportResult = null;
  renderImportModal();
}

const IMPORT_TARGET_LABELS = { barang:'Master Barang', lokasi:'Master Lokasi', 'barang-masuk':'Barang Masuk (Massal)', 'barang-keluar':'Barang Keluar (Massal)' };

function renderImportModal(){
  const target = ui.importTarget;
  const pool = target==='barang' ? IMPORT_POOL_SKU : target==='lokasi' ? IMPORT_POOL_LOCATION : target==='barang-masuk' ? IMPORT_POOL_BARANG_MASUK : IMPORT_POOL_BARANG_KELUAR;
  const stepLabels = ['1. Unggah File','2. Pratinjau','3. Selesai'];
  const stepsHtml = stepLabels.map((l,i)=>`<div class="import-step ${ui.importStep===i+1?'active':ui.importStep>i+1?'done':''}">${l}</div>`).join('');

  let body = '';
  if (ui.importStep === 1){
    body = `
      <div class="import-steps">${stepsHtml}</div>
      <p class="text-muted-sm" style="margin-bottom:14px;">Unduh template, isi sesuai kolom, lalu unggah kembali. Sistem akan memvalidasi format, field wajib, duplikasi, dan referensi sebelum data masuk.</p>
      <button type="button" class="btn btn-outline btn-block" id="btnDownloadTemplate" style="margin-bottom:14px;"><span class="material-symbols-outlined">download</span> Unduh Template XLSX</button>
      <div class="dropzone">
        <span class="material-symbols-outlined">upload_file</span>
        <p style="margin-bottom:10px;">Tarik file ke sini atau klik untuk memilih</p>
        <input type="file" id="importFileInput" accept=".xlsx,.csv" style="max-width:240px;margin:0 auto;">
      </div>`;
  } else if (ui.importStep === 2){
    let headRow, bodyRows;
    if (target==='barang'){
      headRow = '<th>SKU</th><th>Nama Produk</th><th>Kategori</th>';
      bodyRows = pool.map(p=>`<tr><td class="cell-strong">${p.sku}</td><td>${p.nama_produk}</td><td>${p.kategori}</td></tr>`).join('');
    } else if (target==='lokasi'){
      headRow = '<th>Kode</th><th>Nama</th><th>Gudang</th><th>Jenis</th>';
      bodyRows = pool.map(p=>`<tr><td class="cell-strong">${p.code}</td><td>${p.name}</td><td>${p.warehouse_name}</td><td>${p.location_type}</td></tr>`).join('');
    } else if (target==='barang-masuk'){
      headRow = '<th>SKU</th><th>Nama Produk</th><th>Lokasi</th><th>Qty Masuk</th><th>Keterangan</th>';
      bodyRows = pool.map(p=>{
        const sku = p.sku_id ? safeSku(p.sku_id) : { sku:p.sku_code, nama_produk:p.nama_produk };
        const locLabel = p.location_id ? safeLoc(p.location_id).code : p.location_code;
        const tag = p.scenario==='update'
          ? '<span class="combo-tag combo-tag-ok">Update stok existing</span>'
          : '<span class="badge badge-info">SKU/Lokasi baru</span>';
        return `<tr><td class="cell-strong">${sku.sku}</td><td>${sku.nama_produk}</td><td>${locLabel}</td><td>${fmtNum(p.qty)}</td><td>${tag}</td></tr>`;
      }).join('');
    } else {
      // barang-keluar: simulate a running balance across the batch itself, since
      // two rows in the same file could target the same SKU+Lokasi in sequence.
      headRow = '<th>SKU</th><th>Nama Produk</th><th>Lokasi</th><th>Qty Keluar</th><th>Stok Tersedia</th><th>Status</th>';
      const running = {};
      bodyRows = pool.map(p=>{
        const sku = safeSku(p.sku_id), loc = safeLoc(p.location_id);
        const key = p.sku_id+'::'+p.location_id;
        if (!(key in running)) running[key] = getQtySystem(p.sku_id, p.location_id);
        const available = running[key];
        const ok = p.qty <= available;
        if (ok) running[key] -= p.qty;
        const status = ok ? '<span class="badge badge-success">OK</span>' : '<span class="badge badge-danger">Ditolak — stok tidak cukup</span>';
        return `<tr><td class="cell-strong">${sku.sku}</td><td>${sku.nama_produk}</td><td>${loc.code}</td><td>${fmtNum(p.qty)}</td><td>${fmtNum(available)}</td><td>${status}</td></tr>`;
      }).join('');
    }
    body = `
      <div class="import-steps">${stepsHtml}</div>
      <p class="text-muted-sm" style="margin-bottom:10px;">Pratinjau ${pool.length} baris dari file yang diunggah:</p>
      <div class="table-scroll" style="max-height:280px;">
        <table class="data-table"><thead><tr>${headRow}</tr></thead><tbody>${bodyRows}</tbody></table>
      </div>`;
  } else {
    const result = ui.lastImportResult || { ok: pool.length, rejected: 0 };
    body = `
      <div class="import-steps">${stepsHtml}</div>
      <div style="text-align:center;padding:20px 10px;">
        <span class="material-symbols-outlined" style="font-size:48px;color:var(--success);">check_circle</span>
        <h3 style="margin:12px 0 4px;">Import selesai</h3>
        <p class="text-muted-sm">${result.ok} baris berhasil${result.rejected ? `, ${result.rejected} baris ditolak (stok tidak cukup)` : ', 0 baris error'}. Tercatat di Audit Log.</p>
      </div>`;
  }

  document.getElementById('modalRoot').innerHTML = `
    <div class="modal-overlay" id="importModal">
      <div class="modal-box">
        <div class="modal-head"><h3>Import ${IMPORT_TARGET_LABELS[target]}</h3><button class="modal-close" id="importModalClose"><span class="material-symbols-outlined">close</span></button></div>
        <div class="modal-body">${body}</div>
        <div class="modal-footer" id="importModalFooter"></div>
      </div>
    </div>`;

  document.getElementById('importModalClose').addEventListener('click', ()=> document.getElementById('modalRoot').innerHTML='');

  const footer = document.getElementById('importModalFooter');
  if (ui.importStep === 1){
    footer.innerHTML = `<button type="button" class="btn btn-outline" id="impCancel">Batal</button><button type="button" class="btn btn-primary" id="impNext" disabled>Lanjut ke Pratinjau</button>`;
    document.getElementById('btnDownloadTemplate').addEventListener('click', ()=>{
      const headers = target==='barang' ? 'SKU;SKU Induk;Nama Produk;Varian;Kategori;Unit'
        : target==='lokasi' ? 'Kode Lokasi;Nama Lokasi;Gudang;Jenis Lokasi'
        : target==='barang-masuk' ? 'SKU;Kode Lokasi;Qty Masuk;No Referensi;Catatan'
        : 'SKU;Kode Lokasi;Qty Keluar;No Referensi;Catatan';
      const fname = target==='barang' ? 'Master_Barang' : target==='lokasi' ? 'Master_Lokasi' : target==='barang-masuk' ? 'Barang_Masuk_Massal' : 'Barang_Keluar_Massal';
      downloadBlob('\uFEFF'+headers+'\n', `Template_${fname}.csv`, 'text/csv;charset=utf-8;');
    });
    document.getElementById('importFileInput').addEventListener('change', (e)=>{
      document.getElementById('impNext').disabled = !e.target.files.length;
    });
    document.getElementById('impCancel').addEventListener('click', ()=> document.getElementById('modalRoot').innerHTML='');
    document.getElementById('impNext').addEventListener('click', ()=>{ ui.importStep = 2; renderImportModal(); });
  } else if (ui.importStep === 2){
    footer.innerHTML = `<button type="button" class="btn btn-outline" id="impBack">Kembali</button><button type="button" class="btn btn-primary" id="impConfirm">Konfirmasi Import</button>`;
    document.getElementById('impBack').addEventListener('click', ()=>{ ui.importStep=1; renderImportModal(); });
    document.getElementById('impConfirm').addEventListener('click', ()=>{
      if (target==='barang'){
        pool.forEach(p=> state.skus.push({ id:'sku-'+Date.now()+Math.random().toString(36).slice(2,6), sku:p.sku, sku_induk:p.sku_induk, nama_produk:p.nama_produk, varian:'', kategori:p.kategori, unit:p.unit, foto_url:'', is_active:true }));
        logAudit('IMPORT', 'Master Barang', `Import ${pool.length} baris data barang`);
        rebuildIndexes(); saveState(); renderBarangTable(); populateSharedFilters();
      } else if (target==='lokasi'){
        pool.forEach(p=>{
          const wh = state.warehouses.find(w=>w.name===p.warehouse_name) || state.warehouses[0];
          state.locations.push({ id:'loc-'+Date.now()+Math.random().toString(36).slice(2,6), code:p.code, name:p.name, warehouse_id:wh.id, location_type:p.location_type, is_active:true });
        });
        logAudit('IMPORT', 'Master Lokasi', `Import ${pool.length} baris data lokasi`);
        rebuildIndexes(); saveState(); renderLokasiTable(); populateSharedFilters();
      } else if (target==='barang-masuk'){
        // Barang Masuk massal: existing SKU+Lokasi pairs get a plain +qty movement
        // (updates stock); pairs that don't exist yet get created in Master Data first.
        const batchDoc = `BM-IMPORT-${todayStr().replace(/-/g,'')}-${Date.now().toString().slice(-4)}`;
        let added = 0, updated = 0;
        pool.forEach(p=>{
          let skuId = p.sku_id, locId = p.location_id;
          if (!skuId){
            const newSku = { id:'sku-'+Date.now()+Math.random().toString(36).slice(2,6), sku:p.sku_code, sku_induk:'', nama_produk:p.nama_produk, varian:'', kategori:p.kategori, unit:p.unit||'Pcs', foto_url:'', is_active:true };
            state.skus.push(newSku); skuId = newSku.id;
          }
          if (!locId){
            const wh = state.warehouses.find(w=>w.name===p.warehouse_name) || state.warehouses[0];
            const newLoc = { id:'loc-'+Date.now()+Math.random().toString(36).slice(2,6), code:p.location_code, name:p.location_name||p.location_code, warehouse_id:wh.id, location_type:p.location_type||'Simpan Stok', is_active:true };
            state.locations.push(newLoc); locId = newLoc.id;
          }
          rebuildIndexes();
          if (p.scenario==='update') updated++; else added++;
          postMovement({ tipe:'IN', sku_id:skuId, location_id:locId, qty:p.qty, ref_type:'Barang Masuk (Import Massal)', ref_doc:batchDoc, catatan:'Import massal dari file' });
        });
        logAudit('IMPORT', 'Barang Masuk', `Import massal ${batchDoc}: ${pool.length} baris (${added} SKU/lokasi baru ditambahkan, ${updated} stok existing di-update)`);
        rebuildIndexes(); saveState();
        renderBarangTable(); renderLokasiTable(); populateSharedFilters();
      } else {
        // Barang Keluar massal: same running-balance simulation as the preview —
        // rows that would exceed available stock are skipped, never allowed through.
        const batchDoc = `BK-IMPORT-${todayStr().replace(/-/g,'')}-${Date.now().toString().slice(-4)}`;
        const running = {};
        let ok = 0, rejected = 0;
        pool.forEach(p=>{
          const key = p.sku_id+'::'+p.location_id;
          if (!(key in running)) running[key] = getQtySystem(p.sku_id, p.location_id);
          if (p.qty > running[key]){ rejected++; return; }
          running[key] -= p.qty;
          postMovement({ tipe:'OUT', sku_id:p.sku_id, location_id:p.location_id, qty:-p.qty, ref_type:'Barang Keluar (Import Massal)', ref_doc:batchDoc, catatan:'Import massal dari file' });
          ok++;
        });
        logAudit('IMPORT', 'Barang Keluar', `Import massal ${batchDoc}: ${ok} baris berhasil, ${rejected} baris ditolak (stok tidak cukup)`);
        saveState();
        ui.lastImportResult = { ok, rejected };
        toast(rejected ? `${ok} baris berhasil, ${rejected} baris ditolak karena stok tidak cukup` : `${ok} baris berhasil diimport`, rejected ? 'warning' : 'success');
      }
      ui.importStep = 3; renderImportModal();
    });
  } else {
    footer.innerHTML = `<button type="button" class="btn btn-primary" id="impDone">Selesai</button>`;
    document.getElementById('impDone').addEventListener('click', ()=>{
      document.getElementById('modalRoot').innerHTML='';
      if (target==='barang-masuk') renderBmTodayFeed();
      if (target==='barang-keluar') renderBkTodayFeed();
    });
  }
}

/* ==========================================================================
   AUDIT LOG
   ========================================================================== */

function initAudit(){
  ['auditModule','auditAction','auditUser'].forEach(id=> document.getElementById(id).addEventListener('change', renderAudit));
  document.getElementById('auditSearch').addEventListener('input', debounce(renderAudit, 200));
}

function renderAudit(){
  const mod = document.getElementById('auditModule').value;
  const act = document.getElementById('auditAction').value;
  const usr = document.getElementById('auditUser').value;
  const q = document.getElementById('auditSearch').value.trim().toLowerCase();

  const rows = state.auditLogs.filter(a=>{
    if (mod!=='all' && a.module!==mod) return false;
    if (act!=='all' && a.action!==act) return false;
    if (usr!=='all' && mStaff[usr] && a.user_name!==mStaff[usr].name) return false;
    if (q && !a.detail.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a,b)=> b.created_at.localeCompare(a.created_at));

  const actionColor = { LOGIN:'badge-info', CREATE:'badge-success', UPDATE:'badge-warning', DELETE:'badge-danger', IMPORT:'badge-info', EXPORT:'badge-neutral', SO:'badge-success', SETTING:'badge-neutral' };
  document.querySelector('#auditTable tbody').innerHTML = rows.length ? rows.map(a=>`
    <tr>
      <td class="cell-muted">${fmtDateTime(a.created_at)}</td>
      <td class="cell-strong">${a.user_name}</td>
      <td><span class="badge ${actionColor[a.action]||'badge-neutral'}">${a.action}</span></td>
      <td>${a.module}</td>
      <td class="cell-muted">${a.detail}</td>
    </tr>`).join('') : `<tr><td colspan="5" style="text-align:center;padding:26px;color:var(--text-muted);">Tidak ada log yang cocok.</td></tr>`;
}

/* ==========================================================================
   SETTINGS
   ========================================================================== */

function applyBranding(){
  document.title = state.settings.app_name;
  document.getElementById('sidebarBrandName').textContent = state.settings.app_name;
}

function goToMasterTab(tab){
  goToPage('master');
  document.querySelectorAll('#masterTabBar .tab-item').forEach(t=>t.classList.toggle('active', t.dataset.tab===tab));
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.toggle('active', p.id==='tab-'+tab));
}

function initSettings(){
  document.getElementById('formCompany').addEventListener('submit', (e)=>{
    e.preventDefault();
    Object.assign(state.settings, {
      company_name: document.getElementById('setCompanyName').value.trim(),
      app_name: document.getElementById('setAppName').value.trim(),
    });
    logAudit('SETTING','Pengaturan','Memperbarui informasi perusahaan');
    saveState();
    applyBranding();
    toast('Pengaturan disimpan');
  });

  document.getElementById('formPreferensi').addEventListener('submit', (e)=>{
    e.preventDefault();
    Object.assign(state.settings, {
      default_warehouse_id: document.getElementById('setDefaultGudang').value,
      default_period_days: parseInt(document.getElementById('setDefaultPeriod').value,10),
      low_stock_threshold: Math.max(0, parseInt(document.getElementById('setLowStockThreshold').value,10) || 0),
    });
    logAudit('SETTING','Pengaturan','Memperbarui preferensi sistem (gudang default, periode dashboard, ambang stok menipis)');
    saveState();
    toast('Preferensi disimpan');
  });

  document.getElementById('btnResetData').addEventListener('click', doResetData);
}

function renderSettings(){
  document.getElementById('setCompanyName').value = state.settings.company_name;
  document.getElementById('setAppName').value = state.settings.app_name;
  fillSelect(document.getElementById('setDefaultGudang'), state.warehouses, { value:w=>w.id, label:w=>w.name, keepFirst:false });
  document.getElementById('setDefaultGudang').value = state.settings.default_warehouse_id || state.warehouses[0].id;
  document.getElementById('setDefaultPeriod').value = state.settings.default_period_days;
  document.getElementById('setLowStockThreshold').value = state.settings.low_stock_threshold ?? 5;

  const masterStats = [
    { label:'Barang', count: state.skus.length, tab:'barang' },
    { label:'Lokasi', count: state.locations.length, tab:'lokasi' },
    { label:'Gudang', count: state.warehouses.length, tab:'gudang' },
    { label:'Staff', count: state.staff.length, tab:'staff' },
    { label:'Supplier', count: state.suppliers.length, tab:'supplier' },
    { label:'Customer', count: state.customers.length, tab:'customer' },
  ];
  document.getElementById('masterSummaryGrid').innerHTML = masterStats.map(s=>`
    <button type="button" class="master-summary-item" data-goto-tab="${s.tab}">
      <span class="master-summary-value">${fmtNum(s.count)}</span>
      <span class="master-summary-label">${s.label}</span>
      <span class="master-summary-link">Kelola →</span>
    </button>`).join('');
  document.querySelectorAll('[data-goto-tab]').forEach(btn=>{
    btn.addEventListener('click', ()=> goToMasterTab(btn.dataset.gotoTab));
  });

  const modules = Object.keys(state.permissions);
  const table = document.getElementById('permissionTable');
  table.innerHTML = `<thead><tr><th>Modul</th><th colspan="4">Admin</th><th colspan="4">Operator</th></tr>
    <tr><th></th><th>Lihat</th><th>Tambah</th><th>Ubah</th><th>Hapus</th><th>Lihat</th><th>Tambah</th><th>Ubah</th><th>Hapus</th></tr></thead>
    <tbody>${modules.map(m=>{
      const p = state.permissions[m];
      const cell = (role,key,disabled)=>`<input type="checkbox" data-mod="${m}" data-role="${role}" data-key="${key}" ${p[role][key]?'checked':''} ${disabled?'disabled':''}>`;
      return `<tr><td class="cell-strong">${m}</td>
        <td>${cell('Admin','view',true)}</td><td>${cell('Admin','create',true)}</td><td>${cell('Admin','update',true)}</td><td>${cell('Admin','delete',true)}</td>
        <td>${cell('Operator','view')}</td><td>${cell('Operator','create')}</td><td>${cell('Operator','update')}</td><td>${cell('Operator','delete')}</td>
      </tr>`;
    }).join('')}</tbody>`;
  table.querySelectorAll('input[type=checkbox]:not([disabled])').forEach(cb=>{
    cb.addEventListener('change', ()=>{
      state.permissions[cb.dataset.mod][cb.dataset.role][cb.dataset.key] = cb.checked;
      logAudit('SETTING','Pengaturan',`Ubah hak akses ${cb.dataset.role} pada ${cb.dataset.mod}.${cb.dataset.key} = ${cb.checked}`);
      saveState();
    });
  });
}

function doResetData(){
  const scope = document.getElementById('resetScope').value;
  const val = document.getElementById('resetScopeValue').value.trim();
  if (!val){ toast('Isi nilai cakupan reset terlebih dahulu','warning'); return; }

  Swal.fire({
    title:'Reset data terjadwal?',
    html:`Cakupan: <b>${document.getElementById('resetScope').selectedOptions[0].textContent}</b> — <b>${val}</b><br>Tindakan ini tidak dapat dibatalkan.`,
    icon:'warning', showCancelButton:true, confirmButtonText:'Lanjutkan', cancelButtonText:'Batal', confirmButtonColor:'#DC2626'
  }).then(res=>{
    if (!res.isConfirmed) return;
    Swal.fire({
      title:'Ketik RESET untuk konfirmasi akhir', input:'text', inputPlaceholder:'RESET',
      showCancelButton:true, confirmButtonText:'Reset Sekarang', confirmButtonColor:'#DC2626',
      preConfirm:(v)=>{ if (v!=='RESET'){ Swal.showValidationMessage('Ketik persis: RESET'); return false; } return true; }
    }).then(res2=>{
      if (!res2.isConfirmed) return;
      let matchFn;
      if (scope==='periode'){
        const days = parseInt(val,10) || 0;
        const cutoff = daysAgoStr(days);
        matchFn = i => i.tanggal >= cutoff;
      } else if (scope==='gudang'){
        matchFn = i => safeWh(i.warehouse_id).name.toLowerCase() === val.toLowerCase() || safeWh(i.warehouse_id).code.toLowerCase() === val.toLowerCase();
      } else if (scope==='operator'){
        matchFn = i => safeStaff(i.operator_id).name.toLowerCase().includes(val.toLowerCase()) || safeStaff(i.operator_id).email.toLowerCase()===val.toLowerCase();
      } else {
        matchFn = i => i.so_number.toLowerCase() === val.toLowerCase();
      }
      const toRemove = state.soItems.filter(matchFn);
      const removedDocs = new Set(toRemove.map(i=>i.so_number));
      state.soItems = state.soItems.filter(i=>!matchFn(i));
      // A reset that only deleted the SO record but left its ledger correction in
      // place would silently leave Qty Stock wrong — remove both together.
      const movBefore = state.stockMovements.length;
      state.stockMovements = state.stockMovements.filter(m=> !(removedDocs.has(m.ref_doc) && m.tipe==='SO_ADJUSTMENT'));
      const movRemoved = movBefore - state.stockMovements.length;
      logAudit('DELETE','Pengaturan',`Reset data (${scope}: ${val}) — ${toRemove.length} baris SO + ${movRemoved} mutasi ledger terkait dihapus`);
      saveState();
      toast(`${toRemove.length} baris data SO (dan ${movRemoved} mutasi ledger terkait) direset`);
    });
  });
}

/* ==========================================================================
   INIT
   ========================================================================== */

function init(){
  state = loadState();
  rebuildIndexes();
  populateSharedFilters();
  initAuth();
  initNav();
  initDashboardFilters();
  initDashToggle();
  initDashUtamaFilters();
  initStockGudang();
  initInputSO();
  initBarangMasuk();
  initBarangKeluar();
  initTransferGudang();
  initTransferLokasi();
  initLaporanStock();
  initRekap();
  initMaster();
  initAudit();
  initSettings();
  document.getElementById('topbarDate').textContent = TODAY.toLocaleDateString('id-ID', { month:'long', year:'numeric' });
  applyBranding();
}

document.addEventListener('DOMContentLoaded', init);
