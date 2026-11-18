// ===== Tiện ích =====
const $ = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const opts = { ...options };
  if (opts.json !== undefined) {
    opts.body = JSON.stringify(opts.json);
    opts.headers = { "Content-Type": "application/json" };
    delete opts.json;
  }
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Lỗi ${res.status}`);
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

// Bọc handler: hiện lỗi bằng toast, khoá nút trong lúc chờ
function on(id, handler) {
  $(id).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await handler(); } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ===== Bước 1: Đăng nhập =====
function setLogin(state) {
  const el = $("loginState");
  if (state === true) { el.textContent = "✔ Đã đăng nhập"; el.className = "pill ok"; }
  else if (state === false) { el.textContent = "✖ Chưa đăng nhập"; el.className = "pill bad"; }
  else { el.textContent = "Trình duyệt chưa mở"; el.className = "pill"; }
}
on("btnOpenLogin", async () => {
  await api("/api/login/open", { method: "POST" });
  toast("Đã mở trình duyệt. Đăng nhập xong thì bấm 'Kiểm tra đăng nhập'.");
});
on("btnCheckLogin", async () => {
  const r = await api("/api/login/check", { method: "POST" });
  setLogin(r.logged_in);
});
on("btnCloseBrowser", async () => {
  await api("/api/browser/close", { method: "POST" });
  setLogin(null);
});

// ===== Bước 2: Nhóm =====
let groups = []; // [{url, checked}]

function renderGroups() {
  const ul = $("groupList");
  ul.innerHTML = "";
  groups.forEach((g, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<input type="checkbox" ${g.checked ? "checked" : ""}>
      <a href="${esc(g.url)}" target="_blank" rel="noopener">${esc(g.url)}</a>
      <button class="ghost" title="Xoá">✕</button>`;
    li.querySelector("input").onchange = (e) => { g.checked = e.target.checked; updateGroupCount(); };
    li.querySelector("button").onclick = () => { groups.splice(i, 1); renderGroups(); };
    ul.appendChild(li);
  });
  updateGroupCount();
}
function updateGroupCount() {
  const n = groups.filter((g) => g.checked).length;
  $("groupCount").textContent = `Đã chọn ${n}/${groups.length} nhóm`;
  $("checkAll").checked = groups.length > 0 && n === groups.length;
}
$("checkAll").onchange = (e) => { groups.forEach((g) => (g.checked = e.target.checked)); renderGroups(); };

on("btnParse", async () => {
  const r = await api("/api/groups/parse", { method: "POST", json: { text: $("groupInput").value } });
  const existing = new Set(groups.map((g) => g.url));
  const added = r.valid.filter((u) => !existing.has(u));
  added.forEach((url) => groups.push({ url, checked: true }));
  renderGroups();
  $("groupInput").value = r.invalid.join("\n"); // giữ lại link sai để bạn sửa
  $("parseMsg").textContent = `Thêm ${added.length} nhóm` + (r.invalid.length ? `, ${r.invalid.length} link sai (còn trong ô nhập)` : "");
});

async function loadGroupLists() {
  const lists = await api("/api/groups");
  const sel = $("listSelect");
  sel.innerHTML = `<option value="">— Danh sách đã lưu —</option>`;
  Object.entries(lists).forEach(([name, urls]) => {
    sel.innerHTML += `<option value="${esc(name)}">${esc(name)} (${urls.length})</option>`;
  });
  return lists;
}
on("btnLoadList", async () => {
  const name = $("listSelect").value;
  if (!name) return toast("Chọn 1 danh sách trước");
  const lists = await api("/api/groups");
  groups = (lists[name] || []).map((url) => ({ url, checked: true }));
  $("listName").value = name;
  renderGroups();
});
on("btnSaveList", async () => {
  const name = $("listName").value.trim();
  if (!name) return toast("Nhập tên danh sách");
  const r = await api("/api/groups", { method: "POST", json: { name, urls: groups.map((g) => g.url) } });
  await loadGroupLists();
  $("listSelect").value = name;
  toast(`Đã lưu ${r.count} nhóm vào "${name}"`);
});
on("btnDeleteList", async () => {
  const name = $("listSelect").value;
  if (!name || !confirm(`Xoá danh sách "${name}"?`)) return;
  await api(`/api/groups/${encodeURIComponent(name)}`, { method: "DELETE" });
  await loadGroupLists();
});

// ===== Nội dung: emoji + ảnh + mẫu =====
const EMOJIS = "😀😁😂🤣😊😍🥰😘😎🤩🤔😉🙏👍👏💪🎉🎁🔥💯✅❌⭐🌟✨💥❤️💙💚💛🧡💜📢📣📌📍📞☎️📱💬👉👈👇☝️⚡🏠🏡🚗🛒💰💵🆕🆓🔔⏰📅".match(/\p{Extended_Pictographic}️?/gu);
EMOJIS.forEach((em) => {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = em;
  b.onclick = () => {
    const ta = $("postText");
    const { selectionStart: s, selectionEnd: e, value } = ta;
    ta.value = value.slice(0, s) + em + value.slice(e);
    ta.focus();
    ta.selectionStart = ta.selectionEnd = s + em.length;
  };
  $("emojiBar").appendChild(b);
});

let images = []; // tên file trên server
function renderImages() {
  const box = $("imagePreview");
  box.innerHTML = "";
  images.forEach((name, i) => {
    const d = document.createElement("div");
    d.innerHTML = `<img src="/uploads/${encodeURIComponent(name)}" alt=""><button type="button" title="Bỏ ảnh">✕</button>`;
    d.querySelector("button").onclick = () => { images.splice(i, 1); renderImages(); };
    box.appendChild(d);
  });
}
$("imageInput").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  if (images.length + files.length > 10) return toast("Tối đa 10 ảnh");
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  try {
    const r = await api("/api/upload", { method: "POST", body: fd });
    images.push(...r.files);
    renderImages();
  } catch (err) { toast(err.message); }
};

async function loadTemplates() {
  const tpls = await api("/api/templates");
  const sel = $("tplSelect");
  sel.innerHTML = `<option value="">— Mẫu bài đã lưu —</option>`;
  Object.keys(tpls).forEach((name) => { sel.innerHTML += `<option value="${esc(name)}">${esc(name)}</option>`; });
  return tpls;
}
on("btnLoadTpl", async () => {
  const name = $("tplSelect").value;
  if (!name) return toast("Chọn 1 mẫu trước");
  const t = (await api("/api/templates"))[name];
  $("postText").value = t.text;
  images = [...t.images];
  $("tplName").value = name;
  renderImages();
});
on("btnSaveTpl", async () => {
  const name = $("tplName").value.trim();
  if (!name) return toast("Nhập tên mẫu");
  await api("/api/templates", { method: "POST", json: { name, text: $("postText").value, images } });
  await loadTemplates();
  $("tplSelect").value = name;
  toast("Đã lưu mẫu");
});
on("btnDeleteTpl", async () => {
  const name = $("tplSelect").value;
  if (!name || !confirm(`Xoá mẫu "${name}"?`)) return;
  await api(`/api/templates/${encodeURIComponent(name)}`, { method: "DELETE" });
  await loadTemplates();
});

// ===== Bước 3: Cấu hình =====
const SETTING_FIELDS = { mode: "mode", min_delay: "minDelay", max_delay: "maxDelay", daily_limit: "dailyLimit", start_hour: "startHour", end_hour: "endHour" };
function fillSettings(s) { Object.entries(SETTING_FIELDS).forEach(([k, id]) => ($(id).value = s[k])); }
function readSettings() {
  const s = {};
  Object.entries(SETTING_FIELDS).forEach(([k, id]) => (s[k] = k === "mode" ? $(id).value : Number($(id).value)));
  return s;
}
async function saveSettings() {
  const saved = await api("/api/settings", { method: "POST", json: readSettings() });
  fillSettings(saved); // server có thể đã chỉnh giá trị về mức an toàn
  return saved;
}
on("btnSaveSettings", async () => {
  const s = await saveSettings();
  $("settingsMsg").textContent = `Đã lưu: chờ ${s.min_delay}–${s.max_delay} phút/nhóm, tối đa ${s.daily_limit} bài/ngày`;
});

// ===== Chạy job =====
on("btnStart", async () => {
  const selected = groups.filter((g) => g.checked).map((g) => g.url);
  if (!selected.length) return toast("Chưa chọn nhóm nào");
  const s = await saveSettings();
  const modeText = s.mode === "auto" ? "TỰ ĐỘNG bấm Đăng" : "BÁN TỰ ĐỘNG (bạn bấm Đăng)";
  if (!confirm(`Đăng vào ${selected.length} nhóm, chế độ ${modeText}, giãn cách ${s.min_delay}–${s.max_delay} phút?`)) return;
  await api("/api/job/start", { method: "POST", json: { groups: selected, text: $("postText").value, images } });
  toast("Đã bắt đầu");
  refreshStatus();
});
["pause", "resume", "skip", "stop"].forEach((a) => {
  on("btn" + a[0].toUpperCase() + a.slice(1), async () => {
    if (a === "stop" && !confirm("Dừng job?")) return;
    await api(`/api/job/${a}`, { method: "POST" });
    refreshStatus();
  });
});

function countdown(iso) {
  if (!iso) return "";
  const sec = Math.max(0, Math.round((new Date(iso) - Date.now()) / 1000));
  return ` (còn ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")})`;
}

async function refreshStatus() {
  let st;
  try { st = await api("/api/status"); } catch { $("topStatus").textContent = "Mất kết nối tới tool"; return; }
  if (st.browser_open) setLogin(st.logged_in); else setLogin(null);
  const j = st.job;
  $("topStatus").textContent = `Hôm nay: ${st.today_count}/${st.daily_limit} bài` + (j.running ? (j.paused ? " · Tạm dừng" : " · Đang chạy") : "");
  $("jobMsg").textContent = (j.message || "Chưa chạy.") + countdown(j.next_at) + (j.paused ? " — ĐANG TẠM DỪNG" : "");
  $("btnStart").disabled = j.running;
  ["btnPause", "btnResume", "btnSkip", "btnStop"].forEach((id) => ($(id).disabled = !j.running));
  $("btnPause").disabled = !j.running || j.paused;
  $("btnResume").disabled = !j.running || !j.paused;
  $("jobItems").innerHTML = j.items.map((it, i) => `<tr>
      <td>${i + 1}</td><td title="${esc(it.url)}">${esc(it.url)}</td>
      <td class="st-${esc(it.status)}">${esc(it.label)}</td><td>${esc(it.time || "")}</td><td>${esc(it.message)}</td></tr>`).join("");
}

on("btnHistory", async () => {
  const rows = await api("/api/history");
  $("historyItems").innerHTML = rows.map((r) => `<tr><td>${esc(r.time)}</td><td title="${esc(r.url)}">${esc(r.url)}</td>
    <td class="st-${esc(r.status)}">${esc(r.status)}</td><td>${esc(r.message)}</td></tr>`).join("") ||
    `<tr><td colspan="4" class="hint">Chưa có lịch sử</td></tr>`;
});

// ===== Khởi động =====
(async () => {
  try {
    fillSettings(await api("/api/settings"));
    await loadGroupLists();
    await loadTemplates();
  } catch (err) { toast(err.message); }
  renderGroups();
  refreshStatus();
  setInterval(refreshStatus, 1000);
})();
