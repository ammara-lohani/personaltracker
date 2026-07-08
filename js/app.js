/* ===== CONFIG — Supabase project URL and anon key ===== */
const SUPA_URL = "https://zsafcmbpisebbsclommy.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzYWZjbWJwaXNlYmJzY2xvbW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMjYzNTAsImV4cCI6MjA5ODgwMjM1MH0.9ccvZdj0-azN88YZc7NpcHC1-tDHh0eeAKRf67MhqL4";

/* ===== Supabase Client ===== */
const db = window.supabase.createClient(SUPA_URL, SUPA_KEY);

/* ===== DEFAULT CATEGORIES ===== */
const DEFAULT_CATEGORIES = [
  {id:"food",      label:"Food",      icon:"🍔", color:"#a1a1aa"},
  {id:"transport", label:"Transport", icon:"🚗", color:"#86efac"},
  {id:"shopping",  label:"Shopping",  icon:"🛍️", color:"#d4d4d8"},
  {id:"bills",     label:"Bills",     icon:"🧾", color:"#71717a"},
  {id:"health",    label:"Health",    icon:"💊", color:"#10b981"},
  {id:"fun",       label:"Fun",       icon:"🎬", color:"#e4e4e7"},
  {id:"home",      label:"Home",      icon:"🏠", color:"#52525b"},
  {id:"savings",   label:"Savings",   icon:"🏦", color:"#059669"},
  {id:"other",     label:"Other",     icon:"✨", color:"#3f3f46"},
];

let CATEGORIES = [...DEFAULT_CATEGORIES];
let catMap = Object.fromEntries(CATEGORIES.map(c=>[c.id,c]));

function updateCategoryMap() {
  catMap = Object.fromEntries(CATEGORIES.map(c=>[c.id,c]));
}

const PRESET_COLORS = ["#ef4444","#3b82f6","#10b981","#f59e0b","#8b5cf6","#ec4899","#06b6d4","#f97316","#6366f1","#64748b"];

/* ===== CUSTOM CATEGORIES ===== */
function loadCustomCategories() {
  CATEGORIES = [...DEFAULT_CATEGORIES];
  if (session && session.user_id) {
    try {
      const stored = localStorage.getItem("ledger_custom_categories_" + session.user_id);
      if (stored) {
        const custom = JSON.parse(stored);
        if (Array.isArray(custom)) {
          const otherIdx = CATEGORIES.findIndex(c => c.id === "other");
          if (otherIdx !== -1) {
            CATEGORIES.splice(otherIdx, 0, ...custom);
          } else {
            CATEGORIES.push(...custom);
          }
        }
      }
    } catch (e) { console.error("Error loading custom categories:", e); }
  }
  updateCategoryMap();
}

function mergeSupabaseCategories(supabaseCats) {
  let localCats = [];
  try {
    const stored = localStorage.getItem("ledger_custom_categories_" + session.user_id);
    if (stored) localCats = JSON.parse(stored);
  } catch (e) {}
  const combined = [...localCats];
  supabaseCats.forEach(sCat => {
    if (!combined.some(lCat => lCat.id === sCat.id)) combined.push(sCat);
  });
  localStorage.setItem("ledger_custom_categories_" + session.user_id, JSON.stringify(combined));
  loadCustomCategories();
}

function buildColorPicker() {
  const container = $("#new-cat-colors");
  if (!container) return;
  container.innerHTML = "";
  PRESET_COLORS.forEach((color, idx) => {
    const dot = document.createElement("div");
    dot.className = "color-dot" + (idx === 0 ? " selected" : "");
    dot.style.backgroundColor = color;
    dot.dataset.color = color;
    container.appendChild(dot);
  });
  container.addEventListener("click", e => {
    const dot = e.target.closest(".color-dot");
    if (!dot) return;
    $$(".color-dot").forEach(d => d.classList.remove("selected"));
    dot.classList.add("selected");
  });
}

function resolveUnknownCategories() {
  allTx.forEach(t => {
    if (t.category && !catMap[t.category]) {
      let label = t.category;
      if (label.startsWith("cat_")) label = "Custom";
      else label = label.charAt(0).toUpperCase() + label.slice(1);
      catMap[t.category] = { id: t.category, label, icon: "✨", color: "#3f3f46" };
    }
  });
}

/* ===== STATE ===== */
let session = null;
let allTx = [];
let selectedCategory = null;
let currentType = "expense";
let activeFilter = "all";
let searchQuery = "";
let pieChart = null, barChart = null;
let authMode = "login";

/* ===== HELPERS ===== */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const fmt  = n => "Rs. " + Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtS = n => "Rs. " + Number(n).toLocaleString(undefined,{maximumFractionDigits:0});

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

function showToast(msg) {
  const t = $("#toast"); t.textContent = msg;
  t.classList.add("show"); setTimeout(()=>t.classList.remove("show"), 2400);
}

function showErr(msg, color="var(--coral)") {
  const el = $("#auth-error");
  el.textContent = msg; el.style.color = color;
}

/* ===== FAB VISIBILITY ===== */
function showFab()  { $("#add-fab").classList.add("visible"); }
function hideFab()  { $("#add-fab").classList.remove("visible"); }

/* ===== SESSION ===== */
function saveSession(s)  { localStorage.setItem("ledger_session", JSON.stringify(s)); }
function loadSession()   { try { return JSON.parse(localStorage.getItem("ledger_session")); } catch(e) { return null; } }
function clearSession()  { localStorage.removeItem("ledger_session"); }

/* ===== AUTH TOGGLE ===== */
$("#auth-toggle-btn").addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  $("#auth-submit-btn").textContent = authMode === "login" ? "Log In" : "Sign Up";
  $("#auth-toggle-btn").textContent = authMode === "login" ? "Don't have an account? Sign up" : "Already have an account? Log in";
  showErr("");
});

/* ===== AUTH SUBMIT ===== */
$("#auth-submit-btn").addEventListener("click", async () => {
  const username = $("#auth-username").value.trim();
  const password = $("#auth-password").value;
  showErr("");

  if (!username)               { showErr("Enter your username."); return; }
  if (username.length < 3)     { showErr("Username must be at least 3 characters."); return; }
  if (!password || password.length < 6) { showErr("Password must be at least 6 characters."); return; }

  const btn = $("#auth-submit-btn");
  btn.disabled = true;
  btn.textContent = "Please wait...";

  try {
    const hash = await sha256(password);

    if (authMode === "signup") {
      const { data: existing } = await db.from("app_users").select("id").eq("username", username).maybeSingle();
      if (existing) { showErr("Username already taken — choose another."); return; }

      const { data: newUser, error: insertErr } = await db
        .from("app_users")
        .insert({ username, password_hash: hash })
        .select("id, username, created_at")
        .single();

      if (insertErr) { showErr("Sign up failed: " + insertErr.message); return; }

      session = { user_id: newUser.id, username: newUser.username, joined_at: newUser.created_at };
      saveSession(session);
      showToast("Welcome to SpendWise! 🎉");
      enterApp();

    } else {
      const { data: user, error: loginErr } = await db
        .from("app_users")
        .select("id, username, created_at")
        .eq("username", username)
        .eq("password_hash", hash)
        .maybeSingle();

      if (loginErr) { showErr("Login error: " + loginErr.message); return; }
      if (!user)    { showErr("Incorrect username or password."); return; }

      session = { user_id: user.id, username: user.username, joined_at: user.created_at };
      saveSession(session);
      enterApp();
    }
  } catch(err) {
    showErr("Unexpected error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = authMode === "login" ? "Log In" : "Sign Up";
  }
});

/* ===== ENTER APP ===== */
async function enterApp() {
  $("#auth-screen").style.display = "none";
  $("#main-screen").style.display = "";
  $(".sidebar-aside").style.display = "";
  showFab(); // ← Show + button only now

  $("#sidebar-greet-name").textContent = session.username;
  $("#profile-username").textContent   = "@" + session.username;
  $("#avatar-letter").textContent         = session.username[0].toUpperCase();
  $("#sidebar-avatar-letter").textContent = session.username[0].toUpperCase();

  const joined = session.joined_at ? new Date(session.joined_at) : new Date();
  $("#profile-since").textContent = joined.toLocaleDateString(undefined,{month:"short",year:"numeric"});

  loadCustomCategories();
  buildColorPicker();

  searchQuery = "";
  $("#tx-search-input").value = "";
  buildFilterChips();
  buildCategoryGrid();
  await loadTransactions();
}

/* ===== LOGOUT ===== */
function logout() {
  clearSession();
  session = null; allTx = [];
  CATEGORIES = [...DEFAULT_CATEGORIES];
  updateCategoryMap();
  hideFab(); // ← Hide + button on logout
  $("#main-screen").style.display = "none";
  $("#auth-screen").style.display = "flex";
  $("#auth-username").value = ""; $("#auth-password").value = "";
  closeSidebar();
  showErr("");
}

$("#logout-btn").addEventListener("click", logout);
$("#logout-btn-2").addEventListener("click", logout);
$("#sidebar-logout-btn").addEventListener("click", logout);

/* ===== TRANSACTIONS ===== */
async function loadTransactions() {
  const { data, error } = await db
    .from("transactions")
    .select("*")
    .eq("user_id", session.user_id)
    .order("created_at", {ascending: false});
  if (error) { showToast("Load error: " + error.message); return; }

  const rawTx = data || [];
  const txItems = [];
  const supabaseCustomCategories = [];

  rawTx.forEach(t => {
    if (t.category === "sys_category" && t.note) {
      try {
        const cat = JSON.parse(t.note);
        if (cat && cat.id && cat.label) supabaseCustomCategories.push(cat);
      } catch(e) {}
    } else {
      txItems.push(t);
    }
  });

  allTx = txItems;
  mergeSupabaseCategories(supabaseCustomCategories);
  resolveUnknownCategories();
  renderAll();
}

async function addTransaction() {
  const amount = parseFloat($("#amount-input").value);
  if (!amount || amount <= 0) { showToast("Enter a valid amount"); return; }
  if (!selectedCategory)      { showToast("Pick a category"); return; }
  const note = $("#note-input").value.trim();
  const btn  = $("#save-tx-btn");
  btn.disabled = true; btn.textContent = "Saving...";

  const { data, error } = await db
    .from("transactions")
    .insert({ user_id: session.user_id, category: selectedCategory, amount, type: "expense", note: note||null })
    .select().single();

  btn.disabled = false; btn.textContent = "Save Transaction";
  if (error) { showToast("Save failed: " + error.message); return; }
  allTx.unshift(data);
  renderAll();
  closeSheet();
  showToast("Transaction saved ✓");
}

/* ===== RENDER ===== */
function thisMonthTx() {
  const now = new Date();
  return allTx.filter(t => {
    const d = new Date(t.created_at);
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  });
}

function renderAll() { renderHero(); renderTxList(); renderPieChart(); renderBarChart(); renderProfileStats(); }

function renderHero() {
  const m = thisMonthTx();
  const expense = m.reduce((s,t)=>s+Number(t.amount), 0);
  $("#month-balance").textContent = fmt(expense);
  $("#month-balance").style.color = "var(--coral)";
  $("#month-spending-summary").textContent = m.length + (m.length===1?" expense tracked":" expenses tracked");
  const budget = 50000;
  const pct = Math.min(expense / budget, 1);
  $("#ring-fg").style.strokeDashoffset = 289 - pct*289;
  $("#ring-pct").textContent = fmtS(expense);
}

function buildFilterChips() {
  const wrap = $("#filter-chips"); wrap.innerHTML = "";
  const all = document.createElement("div");
  all.className = "chip active"; all.textContent = "All"; all.dataset.f = "all";
  wrap.appendChild(all);
  CATEGORIES.forEach(c => {
    const ch = document.createElement("div");
    ch.className = "chip";
    ch.innerHTML = `<span>${c.icon}</span> ${c.label}`;
    ch.dataset.f = c.id;
    wrap.appendChild(ch);
  });
  wrap.addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    $$(".chip").forEach(c=>c.classList.remove("active"));
    chip.classList.add("active");
    activeFilter = chip.dataset.f;
    renderTxList();
  });
}

function renderTxList() {
  const list = $("#tx-list"), count = $("#tx-count");
  let filtered = activeFilter==="all" ? allTx : allTx.filter(t=>t.category===activeFilter);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(t => {
      const cat = catMap[t.category] || catMap.other;
      return (t.note && t.note.toLowerCase().includes(q)) ||
             cat.label.toLowerCase().includes(q) ||
             t.amount.toString().includes(q);
    });
  }
  count.textContent = filtered.length + (filtered.length===1?" entry":" entries");
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><div class="glyph">🔍</div><p>No matching transactions found.</p></div>`;
    return;
  }
  list.innerHTML = filtered.slice(0, 60).map(t => {
    const cat = catMap[t.category] || catMap.other;
    const d   = new Date(t.created_at);
    const ds  = d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
    return `<div class="tx-item" data-id="${t.id}">
      <div class="tx-icon" style="background:${cat.color}18;color:${cat.color}">${cat.icon}</div>
      <div class="tx-body"><div class="tx-cat">${t.note||cat.label}</div><div class="tx-date">${cat.label} · ${ds}</div></div>
      <div class="tx-amt ${t.type}">${t.type==="expense"?"-":"+"}${fmt(t.amount)}</div>
      <button class="tx-delete-btn" title="Delete transaction">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
      </button>
    </div>`;
  }).join("");

  list.querySelectorAll(".tx-delete-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const txItem = btn.closest(".tx-item");
      const id = txItem.dataset.id;
      if (!confirm("Delete this transaction?")) return;
      btn.disabled = true;
      try {
        const { error } = await db.from("transactions").delete().eq("id", id);
        if (error) { showToast("Delete failed: " + error.message); btn.disabled = false; return; }
        allTx = allTx.filter(t=>t.id!==id);
        renderAll();
        showToast("Transaction deleted ✓");
      } catch(err) { showToast("Error: " + err.message); btn.disabled = false; }
    });
  });
}

function renderPieChart() {
  const monthExp = thisMonthTx().filter(t=>t.type==="expense");
  $("#pie-month-label").textContent = new Date().toLocaleDateString(undefined,{month:"long",year:"numeric"});
  const byCat = {};
  monthExp.forEach(t=>{ byCat[t.category]=(byCat[t.category]||0)+Number(t.amount); });
  const labels = Object.keys(byCat), values = Object.values(byCat);
  const colors = labels.map(l=>(catMap[l]||catMap.other).color);
  const legend = $("#pie-legend");
  legend.innerHTML = labels.length
    ? labels.map((l,i)=>{ const c=catMap[l]||catMap.other; return `<div class="legend-item"><span class="dot" style="width:8px;height:8px;border-radius:50%;background:${c.color}"></span>${c.label} <b>${fmtS(values[i])}</b></div>`; }).join("")
    : `<div style="color:var(--text-secondary);font-size:12px;padding:8px;">No expenses this month yet.</div>`;
  if (pieChart) pieChart.destroy();
  const hasData = values.length > 0;
  pieChart = new Chart($("#pieChart").getContext("2d"), {
    type: "doughnut",
    data: {
      labels: labels.map(l=>(catMap[l]||catMap.other).label),
      datasets: [{ data: hasData?values:[1], backgroundColor: hasData?colors:["rgba(255,255,255,0.04)"], borderWidth: 0, hoverOffset: hasData?6:0 }]
    },
    options: {
      cutout: "76%", responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: {display:false},
        tooltip: { enabled: hasData, backgroundColor:"#111118", titleFont:{family:"'Plus Jakarta Sans',sans-serif",size:11,weight:'bold'}, bodyFont:{family:"'Plus Jakarta Sans',sans-serif",size:11}, padding:8, cornerRadius:8, borderColor:"rgba(255,255,255,0.08)", borderWidth:1, callbacks:{label:c=>` ${fmt(c.raw)}`} }
      },
      animation: {duration:800}
    }
  });
}

function renderBarChart() {
  const now = new Date();
  const months = [];
  for (let i=11;i>=0;i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    months.push({key:d.getFullYear()+"-"+d.getMonth(), label:d.toLocaleDateString(undefined,{month:"short"})});
  }
  const exp = months.map(()=>0);
  allTx.forEach(t => {
    const d = new Date(t.created_at);
    const key = d.getFullYear()+"-"+d.getMonth();
    const idx = months.findIndex(m=>m.key===key);
    if (idx!==-1) exp[idx]+=Number(t.amount);
  });
  if (barChart) barChart.destroy();
  barChart = new Chart($("#barChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: months.map(m=>m.label),
      datasets: [{ label:"Expenses", data:exp, backgroundColor:"#ef4444", borderRadius:4, maxBarThickness:12 }]
    },
    options: {
      responsive:true, maintainAspectRatio:false, animation:{duration:800},
      scales: {
        x: { grid:{display:false}, ticks:{color:"#94a3b8",font:{family:"'Plus Jakarta Sans',sans-serif",size:10}} },
        y: { grid:{color:"rgba(255,255,255,0.03)"}, ticks:{color:"#94a3b8",font:{family:"'Plus Jakarta Sans',sans-serif",size:10},callback:v=>"Rs. "+v} }
      },
      plugins: {
        legend: { labels:{color:"#f8fafc",boxWidth:8,boxHeight:8,usePointStyle:true,font:{family:"'Plus Jakarta Sans',sans-serif",size:10.5,weight:'600'}} },
        tooltip: { backgroundColor:"#111118", titleFont:{family:"'Plus Jakarta Sans',sans-serif",size:11,weight:'bold'}, bodyFont:{family:"'Plus Jakarta Sans',sans-serif",size:11}, padding:8, cornerRadius:8, borderColor:"rgba(255,255,255,0.08)", borderWidth:1, callbacks:{label:c=>` ${c.dataset.label}: ${fmt(c.raw)}`} }
      }
    }
  });
}

function renderProfileStats() {
  $("#profile-total-tx").textContent = allTx.length;
  const total = allTx.reduce((s,t)=>s+Number(t.amount),0);
  $("#profile-net").textContent = fmtS(total);
  $("#profile-net").style.color = "var(--coral)";
}

/* ===== TABS ===== */
$$(".tab-btn").forEach(btn => btn.addEventListener("click", () => {
  const tab = btn.dataset.tab;
  $$(`.tab-btn[data-tab="${tab}"]`).forEach(b=>b.classList.add("active"));
  $$(`.tab-btn:not([data-tab="${tab}"])`).forEach(b=>b.classList.remove("active"));
  $$(".view").forEach(v => {
    if (v.id === "view-"+tab) {
      v.style.display = "";
      v.offsetHeight;
      v.classList.add("active");
    } else {
      v.classList.remove("active");
      v.style.display = "none";
    }
  });
  if (window.innerWidth < 768) closeSidebar();
}));

$$(".seg-control button").forEach(btn => btn.addEventListener("click", () => {
  $$(".seg-control button").forEach(b=>b.classList.remove("active")); btn.classList.add("active");
  const m = btn.dataset.stat==="monthly";
  $("#stat-monthly").style.display = m?"block":"none";
  $("#stat-overall").style.display  = m?"none":"block";
}));

/* ===== SEARCH ===== */
$("#tx-search-input").addEventListener("input", (e) => {
  searchQuery = e.target.value;
  renderTxList();
});

/* ===== CATEGORY GRID ===== */
function buildCategoryGrid() {
  const grid = $("#cat-grid"); grid.innerHTML = "";
  CATEGORIES.forEach(c => {
    const el = document.createElement("div");
    el.className = "cat-pill"; el.dataset.cat = c.id;
    el.innerHTML = `<span class="ic">${c.icon}</span><span>${c.label}</span>`;
    grid.appendChild(el);
  });
  const addPill = document.createElement("div");
  addPill.className = "cat-pill add-custom-pill";
  addPill.style.borderStyle = "dashed";
  addPill.style.borderColor = "var(--accent)";
  addPill.innerHTML = `<span class="ic" style="color:var(--accent)">➕</span><span style="color:var(--accent)">Add custom</span>`;
  grid.appendChild(addPill);
}

$("#cat-grid").addEventListener("click", e => {
  const pill = e.target.closest(".cat-pill");
  if (!pill) return;
  if (pill.classList.contains("add-custom-pill")) { openCategorySheet(); return; }
  $$(".cat-pill").forEach(p=>p.classList.remove("selected"));
  pill.classList.add("selected");
  selectedCategory = pill.dataset.cat;
});

function openCategorySheet() {
  $("#new-cat-label").value = "";
  $("#new-cat-icon").value  = "✨";
  const firstDot = $("#new-cat-colors .color-dot");
  if (firstDot) { $$(".color-dot").forEach(d=>d.classList.remove("selected")); firstDot.classList.add("selected"); }
  const backdrop = $("#category-sheet-backdrop");
  backdrop.style.display = "block"; backdrop.offsetHeight;
  backdrop.classList.add("show");
  $("#category-sheet").classList.add("open");
}

function closeCategorySheet() {
  $("#category-sheet").classList.remove("open");
  const backdrop = $("#category-sheet-backdrop");
  backdrop.classList.remove("show");
  setTimeout(()=>{ if (!$("#category-sheet").classList.contains("open")) backdrop.style.display="none"; }, 300);
}

async function saveCustomCategory() {
  const label = $("#new-cat-label").value.trim();
  const icon  = $("#new-cat-icon").value.trim() || "✨";
  const selectedDot = $("#new-cat-colors .color-dot.selected");
  const color = selectedDot ? selectedDot.dataset.color : PRESET_COLORS[0];
  if (!label) { showToast("Enter a category name"); return; }
  if (CATEGORIES.some(c=>c.label.toLowerCase()===label.toLowerCase())) { showToast("Category already exists"); return; }

  const id = "cat_" + Date.now();
  const newCat = { id, label, icon, color };
  const btn = $("#save-cat-btn");
  btn.disabled = true; btn.textContent = "Creating...";

  try {
    const { error } = await db.from("transactions").insert({
      user_id: session.user_id, category: "sys_category",
      amount: 0.01, type: "expense", note: JSON.stringify(newCat)
    });
    if (error) { showToast("Sync failed: " + error.message); btn.disabled=false; btn.textContent="Create"; return; }

    let custom = [];
    try {
      const stored = localStorage.getItem("ledger_custom_categories_" + session.user_id);
      if (stored) custom = JSON.parse(stored);
    } catch(e) {}
    custom.push(newCat);
    localStorage.setItem("ledger_custom_categories_" + session.user_id, JSON.stringify(custom));
    loadCustomCategories();
    buildCategoryGrid();
    selectedCategory = id;
    const newPill = $(`.cat-pill[data-cat="${id}"]`);
    if (newPill) { $$(".cat-pill").forEach(p=>p.classList.remove("selected")); newPill.classList.add("selected"); }
    buildFilterChips();
    closeCategorySheet();
    showToast("Category created ✓");
  } catch(err) {
    showToast("Error: " + err.message);
  } finally {
    btn.disabled = false; btn.textContent = "Create";
  }
}

$("#cancel-cat-btn").addEventListener("click", closeCategorySheet);
$("#category-sheet-backdrop").addEventListener("click", closeCategorySheet);
$("#save-cat-btn").addEventListener("click", saveCustomCategory);

/* ===== SHEET OPEN/CLOSE ===== */
function openSheet() {
  const backdrop = $("#sheet-backdrop");
  backdrop.style.display = "block"; backdrop.offsetHeight;
  backdrop.classList.add("show");
  $("#add-sheet").classList.add("open");
}
function closeSheet() {
  $("#add-sheet").classList.remove("open");
  const backdrop = $("#sheet-backdrop");
  backdrop.classList.remove("show");
  setTimeout(()=>{ if (!$("#add-sheet").classList.contains("open")) backdrop.style.display="none"; }, 300);
  $("#amount-input").value = ""; $("#note-input").value = "";
  $$(".cat-pill").forEach(p=>p.classList.remove("selected"));
  selectedCategory = null; setType("expense");
}

$("#add-fab").addEventListener("click", openSheet);
$("#sheet-backdrop").addEventListener("click", closeSheet);
$("#save-tx-btn").addEventListener("click", addTransaction);
function setType(t) { currentType = t; }

/* ===== HERO MOUSE GLOW ===== */
const heroCard = document.querySelector(".hero");
if (heroCard) {
  heroCard.addEventListener("mousemove", (e) => {
    const rect = heroCard.getBoundingClientRect();
    heroCard.style.setProperty("--mouse-x", `${e.clientX-rect.left}px`);
    heroCard.style.setProperty("--mouse-y", `${e.clientY-rect.top}px`);
  });
}

/* ===== SIDEBAR TOGGLES ===== */
const menuToggleBtn   = $("#menu-toggle-btn");
const sidebarAside    = $(".sidebar-aside");
const sidebarBackdrop = $("#sidebar-backdrop");

if (menuToggleBtn) {
  menuToggleBtn.addEventListener("click", () => {
    sidebarAside.classList.add("open");
    sidebarBackdrop.classList.add("show");
  });
}
if (sidebarBackdrop) {
  sidebarBackdrop.addEventListener("click", closeSidebar);
}
function closeSidebar() {
  sidebarAside.classList.remove("open");
  sidebarBackdrop.classList.remove("show");
}

/* ===== RESIZE ===== */
window.addEventListener("resize", () => {
  if (session && session.user_id && window.innerWidth >= 768) {
    closeSidebar();
    const activeView = $(".view.active");
    if (activeView && activeView.id === "view-home") activeView.style.display = "";
  }
});

/* ===== INIT ===== */
const saved = loadSession();
if (saved && saved.user_id) {
  session = saved;
  enterApp();
} else {
  $("#auth-screen").style.display = "flex";
  $("#main-screen").style.display = "none";
  $(".sidebar-aside").style.display = "none";
  hideFab(); // ensure FAB is hidden on load
}
