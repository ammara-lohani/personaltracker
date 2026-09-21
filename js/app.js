/* ===== CONFIG — Supabase project URL and anon key ===== */
const SUPA_URL = "https://zsafcmbpisebbsclommy.supabase.co";
const SUPA_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpzYWZjbWJwaXNlYmJzY2xvbW15Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyMjYzNTAsImV4cCI6MjA5ODgwMjM1MH0.9ccvZdj0-azN88YZc7NpcHC1-tDHh0eeAKRf67MhqL4";

/* ===== Supabase Client ===== */
const db = window.supabase.createClient(SUPA_URL, SUPA_KEY);

/* ===== DEFAULT CATEGORIES ===== */
const DEFAULT_CATEGORIES = [
  { id: "food",          label: "Food",          icon: "🍔", color: "#f97316" },
  { id: "transport",     label: "Transport",     icon: "🚗", color: "#38bdf8" },
  { id: "shopping",      label: "Shopping",      icon: "🛍️", color: "#ec4899" },
  { id: "bills",         label: "Bills",         icon: "🧾", color: "#eab308" },
  { id: "health",        label: "Health",        icon: "💊", color: "#10b981" },
  { id: "entertainment", label: "Entertainment", icon: "🎬", color: "#a855f7" },
  { id: "education",     label: "Education",     icon: "🎓", color: "#6366f1" },
  { id: "home",          label: "Home",          icon: "🏠", color: "#14b8a6" },
  { id: "savings",       label: "Savings",       icon: "🏦", color: "#22c55e" },
  { id: "other",         label: "Other",         icon: "✨", color: "#71717a" },
];

const UNCATEGORIZED = { id: "uncategorized", label: "Uncategorized", icon: "📁", color: "#64748b" };

const PRESET_COLORS = [
  "#10b981", "#3b82f6", "#f43f5e", "#f59e0b",
  "#8b5cf6", "#ec4899", "#06b6d4", "#f97316",
  "#6366f1", "#14b8a6", "#84cc16", "#64748b"
];

/* ===== STATE ===== */
let session = null;
let allTx = []; // Actual expense items
let rawSysCategories = []; // Supabase sys_category records with sysTxId
let CATEGORIES = [...DEFAULT_CATEGORIES];
let catMap = {};

let selectedAddCategory = null;
let selectedEditCategory = null;
let activeFilter = "all";
let searchQuery = "";
let selectedMonth = ""; // e.g. "2026-07" or "all"
let availableMonthKeys = [];
let authMode = "login";

let dashTrendChart = null;
let trendChart = null;
let pieChart = null;

/* ===== DOM HELPERS ===== */
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

const fmt = n => "Rs. " + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtS = n => "Rs. " + Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

async function sha256(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function showToast(msg) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2600);
}

function showErr(msg, color = "var(--coral)") {
  const el = $("#auth-error");
  if (el) {
    el.textContent = msg;
    el.style.color = color;
  }
}

/* ===== SESSION MANAGEMENT ===== */
function saveSession(s) { localStorage.setItem("ledger_session", JSON.stringify(s)); }
function loadSession() { try { return JSON.parse(localStorage.getItem("ledger_session")); } catch (e) { return null; } }
function clearSession() { localStorage.removeItem("ledger_session"); }

/* ===== CATEGORY MANAGEMENT (Requirement 3) ===== */
function updateCategoryMap() {
  catMap = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
  catMap["uncategorized"] = UNCATEGORIZED;
}

function loadCategories() {
  CATEGORIES = [...DEFAULT_CATEGORIES];
  if (session && session.user_id) {
    try {
      const stored = localStorage.getItem("ledger_custom_categories_" + session.user_id);
      if (stored) {
        const custom = JSON.parse(stored);
        if (Array.isArray(custom)) {
          custom.forEach(cat => {
            if (!CATEGORIES.some(c => c.id === cat.id)) {
              CATEGORIES.push(cat);
            }
          });
        }
      }
    } catch (e) {
      console.error("Error reading custom categories:", e);
    }
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
    const idx = combined.findIndex(lCat => lCat.id === sCat.id);
    if (idx === -1) {
      combined.push(sCat);
    } else {
      combined[idx] = { ...combined[idx], ...sCat };
    }
  });

  localStorage.setItem("ledger_custom_categories_" + session.user_id, JSON.stringify(combined));
  loadCategories();
}

function resolveUnknownCategories() {
  allTx.forEach(t => {
    if (t.category && !catMap[t.category]) {
      let label = t.category;
      if (label.startsWith("cat_")) label = "Custom";
      else label = label.charAt(0).toUpperCase() + label.slice(1);
      const fallback = { id: t.category, label, icon: "✨", color: "#64748b" };
      catMap[t.category] = fallback;
      if (!CATEGORIES.some(c => c.id === t.category)) {
        CATEGORIES.push(fallback);
      }
    }
  });
}

function buildColorPicker(containerId, selectedColor) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = "";
  PRESET_COLORS.forEach(color => {
    const dot = document.createElement("div");
    dot.className = "color-dot" + (color.toLowerCase() === (selectedColor || PRESET_COLORS[0]).toLowerCase() ? " selected" : "");
    dot.style.backgroundColor = color;
    dot.dataset.color = color;
    dot.addEventListener("click", () => {
      container.querySelectorAll(".color-dot").forEach(d => d.classList.remove("selected"));
      dot.classList.add("selected");
    });
    container.appendChild(dot);
  });
}

function renderCategoryPills(gridId, selectedId, onSelectCallback) {
  const grid = $(gridId);
  if (!grid) return;
  grid.innerHTML = "";

  CATEGORIES.forEach(c => {
    const pill = document.createElement("div");
    pill.className = "cat-pill" + (c.id === selectedId ? " selected" : "");
    pill.dataset.cat = c.id;
    pill.innerHTML = `<span class="ic">${c.icon}</span><span>${c.label}</span>`;
    pill.addEventListener("click", () => {
      grid.querySelectorAll(".cat-pill").forEach(p => p.classList.remove("selected"));
      pill.classList.add("selected");
      if (onSelectCallback) onSelectCallback(c.id);
    });
    grid.appendChild(pill);
  });
}

function buildCategoriesView() {
  const grid = $("#categories-grid");
  if (!grid) return;
  grid.innerHTML = "";

  const counts = {};
  const totals = {};
  allTx.forEach(t => {
    const cat = t.category || "uncategorized";
    counts[cat] = (counts[cat] || 0) + 1;
    totals[cat] = (totals[cat] || 0) + Number(t.amount);
  });

  CATEGORIES.forEach(c => {
    const count = counts[c.id] || 0;
    const total = totals[c.id] || 0;
    const isDefault = DEFAULT_CATEGORIES.some(dc => dc.id === c.id);

    const card = document.createElement("div");
    card.className = "category-admin-card";
    card.dataset.id = c.id;

    card.innerHTML = `
      <div class="cat-admin-top">
        <div class="cat-badge-main">
          <div class="cat-icon-circle" style="background:${c.color}22; color:${c.color}; border: 1px solid ${c.color}44;">
            ${c.icon}
          </div>
          <div class="cat-details">
            <span class="cat-name">${c.label}</span>
            <span class="cat-type-label">${isDefault ? "Default Category" : "Custom Category"}</span>
          </div>
        </div>
        <div class="cat-admin-actions">
          <button class="action-icon-btn edit cat-edit-btn" title="Edit category" aria-label="Edit category ${c.label}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-icon-btn delete cat-delete-btn" title="Delete category" aria-label="Delete category ${c.label}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>
      <div class="cat-stats-row">
        <div class="cat-stat-unit">
          <span class="lbl">Transactions</span>
          <span class="val mono">${count}</span>
        </div>
        <div class="cat-stat-unit" style="text-align: right;">
          <span class="lbl">Total Spent</span>
          <span class="val mono" style="color:var(--coral);">${fmt(total)}</span>
        </div>
      </div>
    `;

    card.querySelector(".cat-edit-btn").addEventListener("click", () => openCategoryModal(c.id));
    card.querySelector(".cat-delete-btn").addEventListener("click", () => confirmDeleteCategory(c.id));

    grid.appendChild(card);
  });
}

function openCategoryModal(catId = null) {
  const isEdit = !!catId;
  $("#cat-modal-title").textContent = isEdit ? "Edit Category" : "Create Category";
  $("#save-cat-btn").textContent = isEdit ? "Save Changes" : "Create Category";
  $("#edit-cat-id").value = catId || "";

  if (isEdit) {
    const cat = catMap[catId] || CATEGORIES.find(c => c.id === catId);
    $("#new-cat-label").value = cat ? cat.label : "";
    $("#new-cat-icon").value = cat ? cat.icon : "✨";
    buildColorPicker("#new-cat-colors", cat ? cat.color : PRESET_COLORS[0]);
  } else {
    $("#new-cat-label").value = "";
    $("#new-cat-icon").value = "✨";
    buildColorPicker("#new-cat-colors", PRESET_COLORS[0]);
  }

  const backdrop = $("#category-sheet-backdrop");
  backdrop.style.display = "block";
  backdrop.offsetHeight;
  backdrop.classList.add("show");
  $("#category-sheet").classList.add("open");
}

function closeCategoryModal() {
  $("#category-sheet").classList.remove("open");
  const backdrop = $("#category-sheet-backdrop");
  backdrop.classList.remove("show");
  setTimeout(() => {
    if (!$("#category-sheet").classList.contains("open")) backdrop.style.display = "none";
  }, 250);
}

const emojiPicks = $("#emoji-quick-picks");
if (emojiPicks) {
  emojiPicks.addEventListener("click", e => {
    const span = e.target.closest("span");
    if (span) {
      $("#new-cat-icon").value = span.textContent.trim();
    }
  });
}

async function saveCategoryForm() {
  const catId = $("#edit-cat-id").value;
  const label = $("#new-cat-label").value.trim();
  const icon = $("#new-cat-icon").value.trim() || "✨";
  const selectedDot = $("#new-cat-colors .color-dot.selected");
  const color = selectedDot ? selectedDot.dataset.color : PRESET_COLORS[0];

  if (!label) {
    showToast("Please enter a category name");
    return;
  }

  const btn = $("#save-cat-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    if (catId) {
      const existing = CATEGORIES.find(c => c.id === catId);
      const updatedCat = { ...existing, label, icon, color };

      const sysCat = rawSysCategories.find(s => {
        try {
          const parsed = JSON.parse(s.note);
          return parsed.id === catId;
        } catch (e) { return false; }
      });

      if (sysCat) {
        await db.from("transactions").update({
          note: JSON.stringify(updatedCat)
        }).eq("id", sysCat.id);
      }

      let localCats = [];
      try {
        const stored = localStorage.getItem("ledger_custom_categories_" + session.user_id);
        if (stored) localCats = JSON.parse(stored);
      } catch (e) {}

      const lIdx = localCats.findIndex(c => c.id === catId);
      if (lIdx !== -1) {
        localCats[lIdx] = updatedCat;
      } else {
        localCats.push(updatedCat);
      }
      localStorage.setItem("ledger_custom_categories_" + session.user_id, JSON.stringify(localCats));

      const mIdx = CATEGORIES.findIndex(c => c.id === catId);
      if (mIdx !== -1) CATEGORIES[mIdx] = updatedCat;
      updateCategoryMap();

      showToast("Category updated ✓");
    } else {
      if (CATEGORIES.some(c => c.label.toLowerCase() === label.toLowerCase())) {
        showToast("A category with this name already exists");
        btn.disabled = false;
        btn.textContent = "Create Category";
        return;
      }

      const id = "cat_" + Date.now();
      const newCat = { id, label, icon, color };

      const { data, error } = await db.from("transactions").insert({
        user_id: session.user_id,
        category: "sys_category",
        amount: 0.01,
        type: "expense",
        note: JSON.stringify(newCat)
      }).select().single();

      if (error) {
        showToast("Sync failed: " + error.message);
        btn.disabled = false;
        btn.textContent = "Create Category";
        return;
      }

      if (data) {
        rawSysCategories.push(data);
        newCat.sysTxId = data.id;
      }

      let localCats = [];
      try {
        const stored = localStorage.getItem("ledger_custom_categories_" + session.user_id);
        if (stored) localCats = JSON.parse(stored);
      } catch (e) {}
      localCats.push(newCat);
      localStorage.setItem("ledger_custom_categories_" + session.user_id, JSON.stringify(localCats));

      CATEGORIES.push(newCat);
      updateCategoryMap();

      showToast("Category created ✓");
    }

    closeCategoryModal();
    buildFilterChips();
    buildCategoriesView();
    renderAll();
  } catch (err) {
    showToast("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = catId ? "Save Changes" : "Create Category";
  }
}

function confirmDeleteCategory(catId) {
  const cat = catMap[catId] || CATEGORIES.find(c => c.id === catId);
  if (!cat) return;

  const affectedExpenses = allTx.filter(t => t.category === catId);
  const count = affectedExpenses.length;

  let message = `Are you sure you want to remove the category "${cat.label}"?`;
  let warning = "";

  if (count > 0) {
    warning = `This category currently has ${count} expense${count === 1 ? "" : "s"}. These expenses will NOT be lost — they will be safely moved to "Uncategorized".`;
  }

  openConfirmDialog({
    title: "Delete Category",
    message,
    warning,
    confirmText: count > 0 ? "Move to Uncategorized & Delete" : "Delete Category",
    onConfirm: async () => {
      try {
        if (count > 0) {
          const { error: moveErr } = await db
            .from("transactions")
            .update({ category: "uncategorized" })
            .eq("user_id", session.user_id)
            .eq("category", catId);

          if (moveErr) {
            showToast("Failed to reassign expenses: " + moveErr.message);
            return;
          }

          allTx.forEach(t => {
            if (t.category === catId) t.category = "uncategorized";
          });
        }

        const sysCat = rawSysCategories.find(s => {
          try {
            const parsed = JSON.parse(s.note);
            return parsed.id === catId;
          } catch (e) { return false; }
        });

        if (sysCat) {
          await db.from("transactions").delete().eq("id", sysCat.id);
          rawSysCategories = rawSysCategories.filter(s => s.id !== sysCat.id);
        }

        try {
          const stored = localStorage.getItem("ledger_custom_categories_" + session.user_id);
          if (stored) {
            let localCats = JSON.parse(stored);
            localCats = localCats.filter(c => c.id !== catId);
            localStorage.setItem("ledger_custom_categories_" + session.user_id, JSON.stringify(localCats));
          }
        } catch (e) {}

        CATEGORIES = CATEGORIES.filter(c => c.id !== catId);
        updateCategoryMap();

        showToast(`Category removed${count > 0 ? ` (${count} expenses moved to Uncategorized)` : ""} ✓`);
        buildFilterChips();
        buildCategoriesView();
        renderAll();
      } catch (err) {
        showToast("Error: " + err.message);
      }
    }
  });
}

$("#btn-create-cat")?.addEventListener("click", () => openCategoryModal());
$("#shortcut-add-cat-btn")?.addEventListener("click", () => {
  closeAddSheet();
  openCategoryModal();
});
$("#dash-manage-cat-btn")?.addEventListener("click", () => switchTab("categories"));
$("#save-cat-btn")?.addEventListener("click", saveCategoryForm);
$("#cancel-cat-btn")?.addEventListener("click", closeCategoryModal);
$("#close-cat-sheet-btn")?.addEventListener("click", closeCategoryModal);
$("#category-sheet-backdrop")?.addEventListener("click", closeCategoryModal);

/* ===== CONFIRMATION DIALOG (Requirement 9) ===== */
let currentConfirmAction = null;

function openConfirmDialog({ title, message, warning, confirmText = "Delete", onConfirm }) {
  $("#confirm-title").textContent = title || "Are you sure?";
  $("#confirm-message").textContent = message || "This action cannot be undone.";

  const warnEl = $("#confirm-warning");
  if (warning) {
    warnEl.textContent = warning;
    warnEl.style.display = "block";
  } else {
    warnEl.style.display = "none";
  }

  const actBtn = $("#action-confirm-btn");
  actBtn.textContent = confirmText;

  currentConfirmAction = onConfirm;

  const backdrop = $("#confirm-backdrop");
  backdrop.style.display = "block";
  backdrop.offsetHeight;
  backdrop.classList.add("show");
  $("#confirm-dialog").classList.add("open");
}

function closeConfirmDialog() {
  $("#confirm-dialog").classList.remove("open");
  const backdrop = $("#confirm-backdrop");
  backdrop.classList.remove("show");
  setTimeout(() => {
    if (!$("#confirm-dialog").classList.contains("open")) backdrop.style.display = "none";
  }, 250);
  currentConfirmAction = null;
}

$("#cancel-confirm-btn")?.addEventListener("click", closeConfirmDialog);
$("#confirm-backdrop")?.addEventListener("click", closeConfirmDialog);
$("#action-confirm-btn")?.addEventListener("click", async () => {
  if (typeof currentConfirmAction === "function") {
    const actBtn = $("#action-confirm-btn");
    actBtn.disabled = true;
    actBtn.textContent = "Processing...";
    try {
      await currentConfirmAction();
    } finally {
      actBtn.disabled = false;
      closeConfirmDialog();
    }
  } else {
    closeConfirmDialog();
  }
});

/* ===== AUTHENTICATION ===== */
$("#auth-toggle-btn")?.addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  $("#auth-submit-btn").textContent = authMode === "login" ? "Log In" : "Sign Up";
  $("#auth-toggle-btn").textContent = authMode === "login" ? "Don't have an account? Sign up" : "Already have an account? Log in";
  showErr("");
});

$("#auth-submit-btn")?.addEventListener("click", async () => {
  const username = $("#auth-username").value.trim();
  const password = $("#auth-password").value;
  showErr("");

  if (!username) { showErr("Please enter your username or email."); return; }
  if (username.length < 3) { showErr("Username must be at least 3 characters."); return; }
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
      if (!user) { showErr("Incorrect username or password."); return; }

      session = { user_id: user.id, username: user.username, joined_at: user.created_at };
      saveSession(session);
      enterApp();
    }
  } catch (err) {
    showErr("Unexpected error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = authMode === "login" ? "Log In" : "Sign Up";
  }
});

/* ===== ENTER APP ===== */
async function enterApp() {
  $("#auth-screen").style.display = "none";
  $("#main-screen").style.display = "flex";
  $(".sidebar-aside").style.display = "flex";
  $("#add-fab").classList.add("visible");

  $("#sidebar-greet-name").textContent = session.username;
  $("#profile-username").textContent = "@" + session.username;
  const initial = session.username[0].toUpperCase();
  $("#avatar-letter").textContent = initial;
  $("#sidebar-avatar-letter").textContent = initial;

  const joined = session.joined_at ? new Date(session.joined_at) : new Date();
  $("#profile-since").textContent = joined.toLocaleDateString(undefined, { month: "short", year: "numeric" });

  loadCategories();
  buildColorPicker("#new-cat-colors", PRESET_COLORS[0]);

  searchQuery = "";
  $("#tx-search-input").value = "";

  const todayStr = new Date().toISOString().split("T")[0];
  $("#expense-date").value = todayStr;

  buildFilterChips();
  await loadTransactions();
}

/* ===== LOGOUT ===== */
function logout() {
  clearSession();
  session = null;
  allTx = [];
  rawSysCategories = [];
  CATEGORIES = [...DEFAULT_CATEGORIES];
  updateCategoryMap();
  $("#add-fab").classList.remove("visible");
  $("#main-screen").style.display = "none";
  $(".sidebar-aside").style.display = "none";
  $("#auth-screen").style.display = "flex";
  $("#auth-username").value = "";
  $("#auth-password").value = "";
  closeSidebar();
  showErr("");
}

$("#logout-btn")?.addEventListener("click", logout);
$("#logout-btn-2")?.addEventListener("click", logout);
$("#sidebar-logout-btn")?.addEventListener("click", logout);

/* ===== TRANSACTIONS DATA LOADING ===== */
async function loadTransactions() {
  const { data, error } = await db
    .from("transactions")
    .select("*")
    .eq("user_id", session.user_id)
    .order("created_at", { ascending: false });

  if (error) {
    showToast("Load error: " + error.message);
    return;
  }

  const rawTx = data || [];
  const txItems = [];
  const supabaseCustomCategories = [];
  rawSysCategories = [];

  rawTx.forEach(t => {
    if (t.category === "sys_category" && t.note) {
      rawSysCategories.push(t);
      try {
        const cat = JSON.parse(t.note);
        if (cat && cat.id && cat.label) {
          cat.sysTxId = t.id;
          supabaseCustomCategories.push(cat);
        }
      } catch (e) {}
    } else {
      txItems.push(t);
    }
  });

  allTx = txItems;
  mergeSupabaseCategories(supabaseCustomCategories);
  resolveUnknownCategories();

  // Populate month selectors & auto-select latest month with data
  populateMonthSelectors();

  renderAll();
}

/* ===== EXPENSE MANAGEMENT: ADD, EDIT, DELETE ===== */

function openAddSheet(presetDate = null) {
  $("#amount-input").value = "";
  $("#note-input").value = "";
  const dateField = $("#expense-date");
  if (presetDate) {
    dateField.value = presetDate;
  } else if (!dateField.value) {
    dateField.value = new Date().toISOString().split("T")[0];
  }

  selectedAddCategory = CATEGORIES[0] ? CATEGORIES[0].id : "food";
  renderCategoryPills("#cat-grid", selectedAddCategory, id => {
    selectedAddCategory = id;
  });

  const backdrop = $("#sheet-backdrop");
  backdrop.style.display = "block";
  backdrop.offsetHeight;
  backdrop.classList.add("show");
  $("#add-sheet").classList.add("open");
}

function closeAddSheet() {
  $("#add-sheet").classList.remove("open");
  const backdrop = $("#sheet-backdrop");
  backdrop.classList.remove("show");
  setTimeout(() => {
    if (!$("#add-sheet").classList.contains("open")) backdrop.style.display = "none";
  }, 250);
}

async function addTransaction() {
  const amount = parseFloat($("#amount-input").value);
  if (!amount || amount <= 0) {
    showToast("Please enter a valid amount");
    return;
  }
  if (!selectedAddCategory) {
    showToast("Please select a category");
    return;
  }
  const dateVal = $("#expense-date").value;
  if (!dateVal) {
    showToast("Please select an expense date");
    return;
  }

  const note = $("#note-input").value.trim();
  const btn = $("#save-tx-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const createdAt = new Date(dateVal + "T12:00:00Z").toISOString();
    const { data, error } = await db
      .from("transactions")
      .insert({
        user_id: session.user_id,
        category: selectedAddCategory,
        amount,
        type: "expense",
        note: note || null,
        created_at: createdAt
      })
      .select()
      .single();

    if (error) {
      showToast("Save failed: " + error.message);
      return;
    }

    allTx.unshift(data);
    allTx.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    populateMonthSelectors();
    renderAll();
    closeAddSheet();
    showToast("Expense recorded ✓");
  } catch (err) {
    showToast("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Expense";
  }
}

function openEditExpense(txId) {
  const tx = allTx.find(t => t.id === txId);
  if (!tx) return;

  $("#edit-tx-id").value = tx.id;
  $("#edit-amount-input").value = tx.amount;
  $("#edit-note-input").value = tx.note || "";

  const d = new Date(tx.created_at);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  $("#edit-expense-date").value = `${year}-${month}-${day}`;

  selectedEditCategory = tx.category;
  renderCategoryPills("#edit-cat-grid", selectedEditCategory, id => {
    selectedEditCategory = id;
  });

  const backdrop = $("#edit-sheet-backdrop");
  backdrop.style.display = "block";
  backdrop.offsetHeight;
  backdrop.classList.add("show");
  $("#edit-sheet").classList.add("open");
}

function closeEditSheet() {
  $("#edit-sheet").classList.remove("open");
  const backdrop = $("#edit-sheet-backdrop");
  backdrop.classList.remove("show");
  setTimeout(() => {
    if (!$("#edit-sheet").classList.contains("open")) backdrop.style.display = "none";
  }, 250);
}

async function updateTransaction() {
  const id = $("#edit-tx-id").value;
  const amount = parseFloat($("#edit-amount-input").value);
  if (!amount || amount <= 0) {
    showToast("Please enter a valid amount");
    return;
  }
  if (!selectedEditCategory) {
    showToast("Please select a category");
    return;
  }
  const dateVal = $("#edit-expense-date").value;
  if (!dateVal) {
    showToast("Please select an expense date");
    return;
  }

  const note = $("#edit-note-input").value.trim();
  const btn = $("#update-tx-btn");
  btn.disabled = true;
  btn.textContent = "Updating...";

  try {
    const createdAt = new Date(dateVal + "T12:00:00Z").toISOString();
    const { data, error } = await db
      .from("transactions")
      .update({
        amount,
        category: selectedEditCategory,
        note: note || null,
        created_at: createdAt
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      showToast("Update failed: " + error.message);
      return;
    }

    const idx = allTx.findIndex(t => t.id === id);
    if (idx !== -1) {
      allTx[idx] = data;
      allTx.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    populateMonthSelectors();
    renderAll();
    closeEditSheet();
    showToast("Expense updated ✓");
  } catch (err) {
    showToast("Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Save Changes";
  }
}

function confirmDeleteTransaction(txId) {
  const tx = allTx.find(t => t.id === txId);
  if (!tx) return;

  const cat = catMap[tx.category] || catMap.other;
  const noteDesc = tx.note ? ` ("${tx.note}")` : "";

  openConfirmDialog({
    title: "Delete Expense",
    message: `Delete expense of ${fmt(tx.amount)} for ${cat.label}${noteDesc}?`,
    confirmText: "Delete Expense",
    onConfirm: async () => {
      const { error } = await db.from("transactions").delete().eq("id", txId);
      if (error) {
        showToast("Delete failed: " + error.message);
        return;
      }
      allTx = allTx.filter(t => t.id !== txId);
      populateMonthSelectors();
      renderAll();
      showToast("Expense deleted ✓");
    }
  });
}

$("#add-fab")?.addEventListener("click", () => openAddSheet());
$("#dash-add-btn")?.addEventListener("click", () => openAddSheet());
$("#close-add-sheet-btn")?.addEventListener("click", closeAddSheet);
$("#cancel-add-tx-btn")?.addEventListener("click", closeAddSheet);
$("#sheet-backdrop")?.addEventListener("click", closeAddSheet);
$("#save-tx-btn")?.addEventListener("click", addTransaction);

$("#close-edit-sheet-btn")?.addEventListener("click", closeEditSheet);
$("#cancel-edit-tx-btn")?.addEventListener("click", closeEditSheet);
$("#edit-sheet-backdrop")?.addEventListener("click", closeEditSheet);
$("#update-tx-btn")?.addEventListener("click", updateTransaction);

/* ===== FILTER CHIPS (DASHBOARD) ===== */
function buildFilterChips() {
  const wrap = $("#filter-chips");
  if (!wrap) return;
  wrap.innerHTML = "";

  const all = document.createElement("div");
  all.className = "chip" + (activeFilter === "all" ? " active" : "");
  all.textContent = "All";
  all.dataset.f = "all";
  all.addEventListener("click", () => {
    activeFilter = "all";
    wrap.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
    all.classList.add("active");
    renderTxList();
  });
  wrap.appendChild(all);

  CATEGORIES.forEach(c => {
    const ch = document.createElement("div");
    ch.className = "chip" + (activeFilter === c.id ? " active" : "");
    ch.innerHTML = `<span>${c.icon}</span> ${c.label}`;
    ch.dataset.f = c.id;
    ch.addEventListener("click", () => {
      activeFilter = c.id;
      wrap.querySelectorAll(".chip").forEach(cp => cp.classList.remove("active"));
      ch.classList.add("active");
      renderTxList();
    });
    wrap.appendChild(ch);
  });
}

$("#tx-search-input")?.addEventListener("input", e => {
  searchQuery = e.target.value;
  renderTxList();
});

/* ===== MONTH SELECTORS & QUICK PILLS (Requirement 4 & User Request) ===== */

function formatMonthKeyLabel(monthKey) {
  if (monthKey === "all") return "All Time";
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function populateMonthSelectors() {
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  // Tally spending per month
  const monthSums = {};
  const monthCounts = {};
  allTx.forEach(t => {
    const d = new Date(t.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthSums[key] = (monthSums[key] || 0) + Number(t.amount);
    monthCounts[key] = (monthCounts[key] || 0) + 1;
  });

  const monthKeysSet = new Set([currentMonthKey, prevMonthKey]);
  Object.keys(monthSums).forEach(k => monthKeysSet.add(k));

  // Sort descending by date
  availableMonthKeys = Array.from(monthKeysSet).sort((a, b) => b.localeCompare(a));

  // Determine smart default month selection:
  // If current selection is valid, keep it; otherwise pick the latest month that HAS transactions!
  if (!selectedMonth || !availableMonthKeys.includes(selectedMonth)) {
    const latestWithData = availableMonthKeys.find(k => (monthCounts[k] || 0) > 0);
    selectedMonth = latestWithData || currentMonthKey;
  }

  // Populate Dropdown Options
  const renderOptions = (includeAllTime = false) => {
    let opts = "";
    if (includeAllTime) {
      opts += `<option value="all">🌟 All Time (${allTx.length} expenses)</option>`;
    }
    opts += availableMonthKeys.map(k => {
      const label = formatMonthKeyLabel(k);
      const count = monthCounts[k] || 0;
      const sum = monthSums[k] || 0;
      const tag = k === currentMonthKey ? " (Current)" : "";
      const info = count > 0 ? ` — ${fmtS(sum)} (${count} tx)` : " — Rs. 0";
      return `<option value="${k}">${label}${tag}${info}</option>`;
    }).join("");
    return opts;
  };

  const aSelect = $("#analytics-month-select");
  if (aSelect) {
    aSelect.innerHTML = renderOptions(false);
    aSelect.value = selectedMonth === "all" ? availableMonthKeys[0] : selectedMonth;
  }

  const dSelect = $("#dash-month-select");
  if (dSelect) {
    dSelect.innerHTML = renderOptions(true);
    dSelect.value = selectedMonth;
  }

  // Build Quick Switch Month Pills
  buildQuickMonthPills();
}

function buildQuickMonthPills() {
  const targets = ["#dash-quick-pills", "#stats-quick-pills"];
  targets.forEach(selector => {
    const container = $(selector);
    if (!container) return;
    container.innerHTML = "";

    availableMonthKeys.slice(0, 5).forEach(k => {
      const d = new Date(k.split("-")[0], Number(k.split("-")[1]) - 1, 1);
      const shortLabel = d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
      const txCount = allTx.filter(t => {
        const td = new Date(t.created_at);
        return `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, "0")}` === k;
      }).length;

      const chip = document.createElement("button");
      chip.className = "month-quick-chip" + (selectedMonth === k ? " active" : "");
      chip.textContent = `${shortLabel} (${txCount})`;
      chip.title = `${formatMonthKeyLabel(k)}: ${txCount} expenses`;
      chip.addEventListener("click", () => setMonth(k));
      container.appendChild(chip);
    });
  });
}

function setMonth(newMonthKey) {
  selectedMonth = newMonthKey;

  const aSelect = $("#analytics-month-select");
  if (aSelect) {
    if (newMonthKey !== "all") aSelect.value = newMonthKey;
  }

  const dSelect = $("#dash-month-select");
  if (dSelect) dSelect.value = newMonthKey;

  buildQuickMonthPills();
  renderAll();
}

function stepMonth(direction) {
  const currentIdx = availableMonthKeys.indexOf(selectedMonth === "all" ? availableMonthKeys[0] : selectedMonth);
  if (currentIdx === -1) return;

  // direction: -1 (newer / next), +1 (older / prev) because array is sorted descending
  const newIdx = currentIdx + direction;
  if (newIdx >= 0 && newIdx < availableMonthKeys.length) {
    setMonth(availableMonthKeys[newIdx]);
  }
}

// Attach Prev / Next Month listeners
$("#stats-prev-month-btn")?.addEventListener("click", () => stepMonth(1));
$("#stats-next-month-btn")?.addEventListener("click", () => stepMonth(-1));

$("#dash-prev-month-btn")?.addEventListener("click", () => stepMonth(1));
$("#dash-next-month-btn")?.addEventListener("click", () => stepMonth(-1));

$("#dash-all-time-btn")?.addEventListener("click", () => setMonth("all"));

$("#analytics-month-select")?.addEventListener("change", e => setMonth(e.target.value));
$("#dash-month-select")?.addEventListener("change", e => setMonth(e.target.value));

$("#dash-to-analytics-btn")?.addEventListener("click", () => switchTab("stats"));
$("#dash-open-analytics-btn")?.addEventListener("click", () => switchTab("stats"));

$("#jump-to-data-month-btn")?.addEventListener("click", () => {
  const latestWithData = availableMonthKeys.find(k => {
    return allTx.some(t => {
      const d = new Date(t.created_at);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === k;
    });
  });
  if (latestWithData) setMonth(latestWithData);
});

/* ===== RENDER TRANSACTIONS LIST & TABLE ===== */
function renderTxList() {
  const list = $("#tx-list");
  const countBadge = $("#tx-count");
  if (!list) return;

  // Filter by selected month if not "all"
  let filtered = allTx;
  if (selectedMonth && selectedMonth !== "all") {
    filtered = filtered.filter(t => {
      const d = new Date(t.created_at);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === selectedMonth;
    });
  }

  // Filter by category
  if (activeFilter !== "all") {
    filtered = filtered.filter(t => t.category === activeFilter);
  }

  // Filter by search query
  if (searchQuery) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter(t => {
      const cat = catMap[t.category] || catMap.other;
      return (t.note && t.note.toLowerCase().includes(q)) ||
             (cat && cat.label.toLowerCase().includes(q)) ||
             t.amount.toString().includes(q);
    });
  }

  if (countBadge) {
    countBadge.textContent = filtered.length + (filtered.length === 1 ? " entry" : " entries");
  }

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="glyph">🔍</div>
        <p class="empty-title">No transactions found</p>
        <p class="empty-sub">No expenses matching the current filters for ${selectedMonth === "all" ? "all time" : formatMonthKeyLabel(selectedMonth)}.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = filtered.slice(0, 100).map(t => {
    const cat = catMap[t.category] || catMap.other;
    const d = new Date(t.created_at);
    const dateFormatted = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const noteText = t.note ? escapeHtml(t.note) : "";

    return `
      <div class="tx-item" data-id="${t.id}">
        <!-- Mobile Layout View -->
        <div class="mobile-tx-top" style="display:none;">
          <div class="cat-badge" style="background:${cat.color}1a; color:${cat.color}; border:1px solid ${cat.color}33;">
            <span>${cat.icon}</span> ${cat.label}
          </div>
          <div class="col-date">${dateFormatted}</div>
        </div>
        <div class="mobile-tx-mid" style="display:none;">
          ${noteText ? noteText : `<span class="col-desc empty-desc">No description</span>`}
        </div>
        <div class="mobile-tx-bot" style="display:none;">
          <div class="col-amt ${t.type}">-${fmt(t.amount)}</div>
          <div class="col-act">
            <button class="action-icon-btn edit tx-edit-btn" title="Edit expense" aria-label="Edit expense">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="action-icon-btn delete tx-delete-btn" title="Delete expense" aria-label="Delete expense">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
            </button>
          </div>
        </div>

        <!-- Desktop Layout Row -->
        <div class="col-date desktop-only">${dateFormatted}</div>
        <div class="col-cat desktop-only">
          <div class="cat-badge" style="background:${cat.color}1a; color:${cat.color}; border:1px solid ${cat.color}33;">
            <span>${cat.icon}</span> ${cat.label}
          </div>
        </div>
        <div class="col-desc desktop-only ${noteText ? "" : "empty-desc"}">
          ${noteText || "No description"}
        </div>
        <div class="col-amt desktop-only ${t.type}">
          -${fmt(t.amount)}
        </div>
        <div class="col-act desktop-only">
          <button class="action-icon-btn edit tx-edit-btn" title="Edit expense" aria-label="Edit expense">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-icon-btn delete tx-delete-btn" title="Delete expense" aria-label="Delete expense">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".tx-edit-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.closest(".tx-item").dataset.id;
      openEditExpense(id);
    });
  });

  list.querySelectorAll(".tx-delete-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      const id = btn.closest(".tx-item").dataset.id;
      confirmDeleteTransaction(id);
    });
  });

  updateMobileLayout();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function updateMobileLayout() {
  const isMobile = window.innerWidth < 768;
  $$(".mobile-tx-top, .mobile-tx-mid, .mobile-tx-bot").forEach(el => {
    el.style.display = isMobile ? "flex" : "none";
  });
  $$(".desktop-only").forEach(el => {
    el.style.display = isMobile ? "none" : "";
  });
}

window.addEventListener("resize", updateMobileLayout);

/* ===== DASHBOARD METRICS SUMMARY CARDS (Requirement 6) ===== */
function renderDashboardMetrics() {
  const isAllTime = selectedMonth === "all";
  const activeMonthKey = isAllTime ? null : selectedMonth;

  let totalLifetimeExpenses = 0;
  let activePeriodExpenses = 0;
  let activePeriodCount = 0;
  const catTotals = {};

  allTx.forEach(t => {
    const amt = Number(t.amount);
    totalLifetimeExpenses += amt;

    const d = new Date(t.created_at);
    const mKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

    if (isAllTime || mKey === activeMonthKey) {
      activePeriodExpenses += amt;
      activePeriodCount++;
      catTotals[t.category] = (catTotals[t.category] || 0) + amt;
    }
  });

  let topCatId = null;
  let topCatAmt = 0;
  Object.entries(catTotals).forEach(([catId, amt]) => {
    if (amt > topCatAmt) {
      topCatAmt = amt;
      topCatId = catId;
    }
  });

  // 1. Total Expenses Card
  $("#dash-total-expenses").textContent = fmt(totalLifetimeExpenses);
  $("#dash-total-count").textContent = `${allTx.length} lifetime transaction${allTx.length === 1 ? "" : "s"}`;

  // 2. Selected Period Spending Card
  const labelEl = $("#dash-selected-month-lbl");
  if (labelEl) {
    labelEl.textContent = isAllTime ? "All-Time Spending" : `${formatMonthKeyLabel(selectedMonth)} Spend`;
  }
  $("#dash-month-expenses").textContent = fmt(activePeriodExpenses);
  $("#dash-month-summary").textContent = `${activePeriodCount} expense${activePeriodCount === 1 ? "" : "s"} in this period`;

  // 3. Transactions Count Card
  $("#dash-tx-count").textContent = activePeriodCount;
  $("#dash-tx-sub").textContent = isAllTime ? "Across all records" : `In ${formatMonthKeyLabel(selectedMonth)}`;

  // 4. Top Category Card
  const topCatObj = topCatId ? (catMap[topCatId] || catMap.other) : null;
  if (topCatObj && topCatAmt > 0) {
    $("#dash-top-category").textContent = topCatObj.label;
    $("#dash-top-cat-icon").textContent = topCatObj.icon;
    $("#dash-top-cat-icon").style.backgroundColor = topCatObj.color + "22";
    $("#dash-top-cat-icon").style.color = topCatObj.color;
    $("#dash-top-category-amt").textContent = `${fmt(topCatAmt)} spent`;
  } else {
    $("#dash-top-category").textContent = "None";
    $("#dash-top-cat-icon").textContent = "✨";
    $("#dash-top-cat-icon").style.backgroundColor = "";
    $("#dash-top-cat-icon").style.color = "";
    $("#dash-top-category-amt").textContent = "Rs. 0.00 spent";
  }

  // Render Dashboard Spending Trend Chart
  renderDashboardTrendChart();
}

/* ===== DASHBOARD TREND CHART ===== */
function renderDashboardTrendChart() {
  const canvas = $("#dashTrendChart");
  if (!canvas) return;

  const now = new Date();
  const timelineMonths = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    timelineMonths.push({ key, label });
  }

  const monthlyTotals = timelineMonths.map(m => {
    return allTx.reduce((sum, t) => {
      const d = new Date(t.created_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return k === m.key ? sum + Number(t.amount) : sum;
    }, 0);
  });

  const barColors = timelineMonths.map(m => {
    return m.key === selectedMonth ? "#10b981" : "rgba(16, 185, 129, 0.4)";
  });
  const borderColors = timelineMonths.map(m => {
    return m.key === selectedMonth ? "#ffffff" : "transparent";
  });

  if (dashTrendChart) dashTrendChart.destroy();

  const ctx = canvas.getContext("2d");
  dashTrendChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: timelineMonths.map(m => m.label),
      datasets: [{
        label: "Spending",
        data: monthlyTotals,
        backgroundColor: barColors,
        borderColor: borderColors,
        borderWidth: 1.5,
        borderRadius: 5,
        maxBarThickness: 26
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (e, elements) => {
        if (elements && elements.length > 0) {
          const clickedIndex = elements[0].index;
          const clickedMonth = timelineMonths[clickedIndex].key;
          setMonth(clickedMonth);
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#94a3b8", font: { family: "'Plus Jakarta Sans', sans-serif", size: 10.5 } }
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: {
            color: "#94a3b8",
            font: { family: "'Plus Jakarta Sans', sans-serif", size: 10.5 },
            callback: v => "Rs. " + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#111827",
          titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: "bold" },
          bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
          padding: 10,
          cornerRadius: 8,
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          callbacks: {
            label: c => ` Spent: ${fmt(c.raw)} (Click to view)`
          }
        }
      }
    }
  });
}

/* ===== ANALYTICS SECTION (Requirements 4 & 5) ===== */

function renderAnalytics() {
  const activeMonthKey = (selectedMonth === "all" || !selectedMonth) ? availableMonthKeys[0] : selectedMonth;

  const monthTx = allTx.filter(t => {
    const d = new Date(t.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    return key === activeMonthKey;
  });

  const monthLabel = formatMonthKeyLabel(activeMonthKey);
  $("#pie-month-title").textContent = `Category Spending — ${monthLabel}`;

  // Calculate Monthly Metrics
  let monthTotal = 0;
  const catTotals = {};
  monthTx.forEach(t => {
    const amt = Number(t.amount);
    monthTotal += amt;
    catTotals[t.category] = (catTotals[t.category] || 0) + amt;
  });

  const count = monthTx.length;
  const avg = count > 0 ? (monthTotal / count) : 0;

  let topCatId = null;
  let topCatAmt = 0;
  Object.entries(catTotals).forEach(([catId, amt]) => {
    if (amt > topCatAmt) {
      topCatAmt = amt;
      topCatId = catId;
    }
  });

  $("#stat-month-total").textContent = fmt(monthTotal);
  $("#stat-month-count").textContent = count;
  $("#stat-month-avg").textContent = fmt(avg);

  if (topCatId) {
    const topCatObj = catMap[topCatId] || catMap.other;
    $("#stat-month-top-cat").textContent = `${topCatObj.icon} ${topCatObj.label}`;
    $("#stat-month-top-amt").textContent = `${fmt(topCatAmt)} spent`;
  } else {
    $("#stat-month-top-cat").textContent = "—";
    $("#stat-month-top-amt").textContent = "Rs. 0.00";
  }

  // Calculate Trend comparison vs preceding month
  const [selYear, selMonthNum] = activeMonthKey.split("-").map(Number);
  const prevDate = new Date(selYear, selMonthNum - 2, 1);
  const prevMonthKey = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  const prevMonthTx = allTx.filter(t => {
    const d = new Date(t.created_at);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === prevMonthKey;
  });

  const prevMonthTotal = prevMonthTx.reduce((s, t) => s + Number(t.amount), 0);
  const trendBadge = $("#stat-month-trend-badge");

  if (prevMonthTotal > 0) {
    const diffPct = ((monthTotal - prevMonthTotal) / prevMonthTotal) * 100;
    if (diffPct > 0) {
      trendBadge.className = "stat-trend up";
      trendBadge.innerHTML = `▲ +${diffPct.toFixed(1)}% vs last month`;
    } else if (diffPct < 0) {
      trendBadge.className = "stat-trend down";
      trendBadge.innerHTML = `▼ ${diffPct.toFixed(1)}% vs last month`;
    } else {
      trendBadge.className = "stat-trend neutral";
      trendBadge.textContent = "Same as last month";
    }
  } else {
    trendBadge.className = "stat-trend neutral";
    trendBadge.textContent = count > 0 ? "Baseline month" : "No expenses";
  }

  // ALWAYS Render Monthly Spending Trend Chart
  renderSpendingTrendChart(activeMonthKey);

  // Render Category Donut Chart
  renderCategoryPieChart(catTotals, monthTotal);
}

/* Category Spending Donut Chart */
function renderCategoryPieChart(catTotals, monthTotal) {
  const canvas = $("#pieChart");
  const wrapper = $("#pie-chart-wrapper");
  const emptyState = $("#pie-empty-state");
  const legend = $("#pie-legend");
  if (!canvas) return;

  const entries = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    if (wrapper) wrapper.style.display = "none";
    if (emptyState) emptyState.style.display = "block";
    if (legend) legend.innerHTML = "";
    $("#pie-cat-count-tag").textContent = "0 Categories";
    return;
  }

  if (wrapper) wrapper.style.display = "block";
  if (emptyState) emptyState.style.display = "none";

  const labels = entries.map(([id]) => (catMap[id] || catMap.other).label);
  const values = entries.map(([, amt]) => amt);
  const colors = entries.map(([id]) => (catMap[id] || catMap.other).color);

  $("#pie-cat-count-tag").textContent = `${entries.length} Categor${entries.length === 1 ? "y" : "ies"}`;

  if (legend) {
    legend.innerHTML = entries.map(([id, amt]) => {
      const cat = catMap[id] || catMap.other;
      const pct = monthTotal > 0 ? ((amt / monthTotal) * 100).toFixed(1) : 0;
      return `
        <div class="legend-item">
          <span class="legend-dot" style="background:${cat.color}"></span>
          <span>${cat.icon} ${cat.label}</span>
          <b>${fmtS(amt)}</b>
          <span style="font-size:10.5px;color:var(--text-dim);">(${pct}%)</span>
        </div>
      `;
    }).join("");
  }

  if (pieChart) pieChart.destroy();

  const ctx = canvas.getContext("2d");
  pieChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: "#111827",
        hoverOffset: 6
      }]
    },
    options: {
      cutout: "68%",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#111827",
          titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: "bold" },
          bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
          padding: 10,
          cornerRadius: 8,
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          callbacks: {
            label: context => {
              const val = context.raw || 0;
              const pct = monthTotal > 0 ? ((val / monthTotal) * 100).toFixed(1) : 0;
              return ` ${context.label}: ${fmt(val)} (${pct}%)`;
            }
          }
        }
      },
      animation: { duration: 600 }
    }
  });
}

/* Monthly Spending Trend Chart (Analytics) */
function renderSpendingTrendChart(activeMonthKey) {
  const canvas = $("#trendChart");
  if (!canvas) return;

  const now = new Date();
  const timelineMonths = [];

  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    timelineMonths.push({ key, label });
  }

  const monthlyTotals = timelineMonths.map(m => {
    return allTx.reduce((sum, t) => {
      const d = new Date(t.created_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return k === m.key ? sum + Number(t.amount) : sum;
    }, 0);
  });

  const barColors = timelineMonths.map(m => {
    return m.key === activeMonthKey ? "#f43f5e" : "rgba(244, 63, 94, 0.4)";
  });

  const borderColors = timelineMonths.map(m => {
    return m.key === activeMonthKey ? "#ffffff" : "transparent";
  });

  if (trendChart) trendChart.destroy();

  const ctx = canvas.getContext("2d");
  trendChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: timelineMonths.map(m => m.label),
      datasets: [{
        label: "Total Expenses",
        data: monthlyTotals,
        backgroundColor: barColors,
        borderColor: borderColors,
        borderWidth: 1.5,
        borderRadius: 6,
        maxBarThickness: 28
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      onClick: (e, elements) => {
        if (elements && elements.length > 0) {
          const clickedIndex = elements[0].index;
          const clickedMonth = timelineMonths[clickedIndex].key;
          setMonth(clickedMonth);
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            color: "#94a3b8",
            font: { family: "'Plus Jakarta Sans', sans-serif", size: 10.5 }
          }
        },
        y: {
          grid: { color: "rgba(255, 255, 255, 0.04)" },
          ticks: {
            color: "#94a3b8",
            font: { family: "'Plus Jakarta Sans', sans-serif", size: 10.5 },
            callback: v => "Rs. " + (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#111827",
          titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: "bold" },
          bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12 },
          padding: 10,
          cornerRadius: 8,
          borderColor: "rgba(255,255,255,0.1)",
          borderWidth: 1,
          callbacks: {
            label: c => ` Spent: ${fmt(c.raw)} (Click to select)`
          }
        }
      }
    }
  });
}

/* ===== PROFILE STATS ===== */
function renderProfileStats() {
  $("#profile-total-tx").textContent = allTx.length;
  const total = allTx.reduce((s, t) => s + Number(t.amount), 0);
  $("#profile-net").textContent = fmtS(total);
}

/* ===== MASTER RENDER FUNCTION ===== */
function renderAll() {
  renderDashboardMetrics();
  renderTxList();
  renderAnalytics();
  buildCategoriesView();
  renderProfileStats();
}

/* ===== NAVIGATION TABS (SIDEBAR + MOBILE BOTTOM NAV) ===== */
function switchTab(targetTab) {
  $$(".tab-btn, .bottom-nav-item").forEach(btn => {
    if (btn.dataset.tab === targetTab) btn.classList.add("active");
    else btn.classList.remove("active");
  });

  $$(".view").forEach(v => {
    if (v.id === "view-" + targetTab) {
      v.style.display = "block";
      v.offsetHeight;
      v.classList.add("active");
    } else {
      v.classList.remove("active");
      v.style.display = "none";
    }
  });

  if (window.innerWidth < 768) closeSidebar();

  // Resize charts smoothly
  setTimeout(() => {
    if (dashTrendChart) dashTrendChart.resize();
    if (trendChart) trendChart.resize();
    if (pieChart) pieChart.resize();
  }, 100);
}

$$(".tab-btn, .bottom-nav-item").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

/* ===== SIDEBAR DRAWER CONTROLS ===== */
const menuToggleBtn = $("#menu-toggle-btn");
const sidebarAside = $(".sidebar-aside");
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

/* ===== INITIALIZATION ON PAGE LOAD ===== */
const saved = loadSession();
if (saved && saved.user_id) {
  session = saved;
  enterApp();
} else {
  $("#auth-screen").style.display = "flex";
  $("#main-screen").style.display = "none";
  $(".sidebar-aside").style.display = "none";
  $("#add-fab").classList.remove("visible");
}
