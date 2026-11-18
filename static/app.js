// ================= Tiện ích =================
const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];

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

// Gắn sự kiện click: tự khoá nút khi đang xử lý, lỗi thì hiện toast
function on(id, handler) {
  $(id).addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await handler(); } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  });
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?facebook\.com\//, "").replace(/\/$/, "");
const hhmm = (d) => d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });

// ================= Trạng thái trang =================
let step = 1;
let groups = [];          // [{url, checked}]
let images = [];          // tên file ảnh trên server
let status = null;        // kết quả /api/status gần nhất
let dismissedRun = false; // đã bấm "tạo lượt đăng mới"
let wasLoggedIn = null;

// Lưu nháp vào trình duyệt để tải lại trang không mất dữ liệu
const DRAFT_KEY = "fbposter.draft";
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, groups, images, text: $("postText").value })); } catch {}
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
    groups = Array.isArray(d.groups) ? d.groups : [];
    images = Array.isArray(d.images) ? d.images : [];
    $("postText").value = d.text || "";
    return d.step || 1;
  } catch { return 1; }
}

const selectedGroups = () => groups.filter((g) => g.checked).map((g) => g.url);
const hasContent = () => $("postText").value.trim() !== "" || images.length > 0;

// ================= Điều hướng các bước =================
function goStep(n) {
  step = n;
  $$("[data-panel]").forEach((p) => (p.hidden = Number(p.dataset.panel) !== n));
  $$("#steps button").forEach((b) => b.classList.toggle("active", Number(b.dataset.step) === n));
  $("btnBack").style.visibility = n === 1 ? "hidden" : "visible";
  $("btnNext").hidden = n === 4;
  $("nav").hidden = false;
  $("emojiBar").hidden = true;
  if (n === 4) renderSummary();
  saveDraft();
}
function markDone() {
  const done = { 1: status?.logged_in === true, 2: selectedGroups().length > 0, 3: hasContent() };
  $$("#steps button").forEach((b) => b.classList.toggle("done", !!done[b.dataset.step]));
}
$$("#steps button").forEach((b) => (b.onclick = () => goStep(Number(b.dataset.step))));
$("btnBack").onclick = () => goStep(Math.max(1, step - 1));
$("btnNext").onclick = () => {
  if (step === 2 && !selectedGroups().length) return toast("Hãy thêm và chọn ít nhất 1 nhóm");
  if (step === 3 && !hasContent()) return toast("Hãy nhập nội dung hoặc thêm ảnh");
  goStep(step + 1);
};

// ================= 1. Đăng nhập =================
function renderLogin() {
  const s = status;
  const chip = $("chipLogin");
  let icon, title, hint, cls;
  if (s.logged_in === true) {
    [icon, title, cls] = ["✅", "Đã đăng nhập", "ok"];
    hint = "Phiên đăng nhập được lưu lại, lần sau không cần đăng nhập nữa.";
  } else if (s.browser_open) {
    [icon, title, cls] = ["⏳", "Đang chờ bạn đăng nhập…", "bad"];
    hint = "Đăng nhập trong cửa sổ Chrome vừa mở. Tool tự kiểm tra sau vài giây.";
  } else {
    [icon, title, cls] = ["🔒", "Chưa mở Facebook", ""];
    hint = "Bấm nút bên dưới, cửa sổ Chrome sẽ mở ra. Nếu trước đây đã đăng nhập, tool tự nhận lại.";
  }
  $("loginIcon").textContent = icon;
  $("loginTitle").textContent = title;
  $("loginHint").textContent = hint;
  $("loginBox").classList.toggle("ok", cls === "ok");
  $("btnLogin").textContent = s.browser_open ? "Mở lại trang Facebook" : "Mở Facebook để đăng nhập";
  $("btnCloseBrowser").hidden = !s.browser_open || s.job.running;
  chip.className = "chip " + cls;
  chip.querySelector("span").textContent = s.logged_in === true ? "Đã đăng nhập" : s.browser_open ? "Chưa đăng nhập" : "Chưa mở Facebook";

  // Vừa đăng nhập xong khi đang ở bước 1 => tự sang bước 2
  if (wasLoggedIn === false && s.logged_in === true && step === 1) {
    toast("Đăng nhập thành công!");
    goStep(2);
  }
  if (s.browser_open) wasLoggedIn = s.logged_in === true;
}
on("btnLogin", async () => {
  await api("/api/login/open", { method: "POST" });
  wasLoggedIn = false;
  toast("Đã mở Chrome. Hãy đăng nhập trong cửa sổ đó.");
});
on("btnCloseBrowser", async () => { await api("/api/browser/close", { method: "POST" }); });

// Tự kiểm tra đăng nhập mỗi 3 giây khi trình duyệt đang mở mà chưa đăng nhập
let lastCheck = 0, checking = false;
async function autoCheckLogin() {
  if (!status?.browser_open || status.logged_in === true || status.job.running) return;
  if (checking || Date.now() - lastCheck < 3000) return;
  checking = true;
  lastCheck = Date.now();
  try { await api("/api/login/check", { method: "POST" }); } catch {} finally { checking = false; }
}

// ================= 2. Chọn nhóm =================
function renderGroups() {
  $("groupList").innerHTML = groups.map((g, i) => `
    <li><label><input type="checkbox" data-i="${i}" ${g.checked ? "checked" : ""}><span title="${esc(g.url)}">${esc(shortUrl(g.url))}</span></label>
    <button class="x" data-del="${i}" title="Xoá khỏi danh sách">✕</button></li>`).join("");
  const n = selectedGroups().length;
  $("checkAllRow").hidden = groups.length === 0;
  $("checkAll").checked = groups.length > 0 && n === groups.length;
  $("groupCount").textContent = `Đã chọn ${n}/${groups.length} nhóm`;
  markDone();
  saveDraft();
}
$("groupList").addEventListener("change", (e) => {
  const i = e.target.dataset.i;
  if (i !== undefined) { groups[i].checked = e.target.checked; renderGroups(); }
});
$("groupList").addEventListener("click", (e) => {
  const i = e.target.dataset.del;
  if (i !== undefined) { groups.splice(Number(i), 1); renderGroups(); }
});
$("checkAll").onchange = (e) => { groups.forEach((g) => (g.checked = e.target.checked)); renderGroups(); };

async function addGroups() {
  const text = $("groupInput").value;
  if (!text.trim()) return;
  const r = await api("/api/groups/parse", { method: "POST", json: { text } });
  const have = new Set(groups.map((g) => g.url));
  const added = r.valid.filter((u) => !have.has(u));
  added.forEach((url) => groups.push({ url, checked: true }));
  $("groupInput").value = r.invalid.join("\n"); // giữ lại link sai để sửa
  const msg = $("parseMsg");
  if (r.invalid.length) { msg.className = "msg warn"; msg.textContent = `Đã thêm ${added.length} nhóm. ${r.invalid.length} link không phải link nhóm, xem lại ở ô trên.`; }
  else { msg.className = "msg ok"; msg.textContent = added.length ? `✓ Đã thêm ${added.length} nhóm` : "Các nhóm này đã có trong danh sách"; }
  renderGroups();
}
on("btnAddGroups", addGroups);
$("groupInput").addEventListener("paste", () => setTimeout(() => addGroups().catch((e) => toast(e.message)), 50));

async function loadGroupLists(selected = "") {
  const lists = await api("/api/groups");
  $("listSelect").innerHTML = `<option value="">📂 Danh sách đã lưu</option>` +
    Object.entries(lists).map(([name, urls]) => `<option value="${esc(name)}">${esc(name)} (${urls.length})</option>`).join("");
  $("listSelect").value = selected;
  $("btnDeleteList").hidden = !selected;
  return lists;
}
$("listSelect").onchange = async () => {
  const name = $("listSelect").value;
  $("btnDeleteList").hidden = !name;
  if (!name) return;
  const lists = await api("/api/groups");
  groups = (lists[name] || []).map((url) => ({ url, checked: true }));
  $("parseMsg").textContent = "";
  renderGroups();
};
on("btnSaveList", async () => {
  if (!groups.length) return toast("Chưa có nhóm nào để lưu");
  const name = prompt("Đặt tên cho danh sách nhóm:", $("listSelect").value)?.trim();
  if (!name) return;
  await api("/api/groups", { method: "POST", json: { name, urls: groups.map((g) => g.url) } });
  await loadGroupLists(name);
  toast(`Đã lưu danh sách "${name}"`);
});
on("btnDeleteList", async () => {
  const name = $("listSelect").value;
  if (!name || !confirm(`Xoá danh sách "${name}"?`)) return;
  await api(`/api/groups/${encodeURIComponent(name)}`, { method: "DELETE" });
  await loadGroupLists();
});

// ================= 3. Nội dung =================
const EMOJIS = "😀😁😂🤣😊😍🥰😘😎🤩🤔😉🙏👍👏💪🎉🎁🔥💯✅❌⭐🌟✨💥❤️💙💚💛🧡💜📢📣📌📍📞☎️📱💬👉👈👇☝️⚡🏠🏡🚗🛒💰💵🆕🆓🔔⏰📅".match(/\p{Extended_Pictographic}️?/gu);
$("emojiBar").innerHTML = EMOJIS.map((e) => `<button type="button">${e}</button>`).join("");
$("emojiBar").addEventListener("click", (e) => {
  if (e.target.tagName !== "BUTTON") return;
  const ta = $("postText"), em = e.target.textContent;
  const { selectionStart: s, selectionEnd: end, value } = ta;
  ta.value = value.slice(0, s) + em + value.slice(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = s + em.length;
  markDone(); saveDraft();
});
$("btnEmoji").onclick = (e) => { e.stopPropagation(); $("emojiBar").hidden = !$("emojiBar").hidden; };
document.addEventListener("click", (e) => { if (!$("emojiBar").contains(e.target)) $("emojiBar").hidden = true; });
$("postText").addEventListener("input", () => { markDone(); saveDraft(); });

function renderImages() {
  $("imagePreview").innerHTML = images.map((name, i) =>
    `<div><img src="/uploads/${encodeURIComponent(name)}" alt=""><button type="button" data-i="${i}" title="Bỏ ảnh">✕</button></div>`).join("");
  $("imgCount").textContent = images.length ? `${images.length}/10 ảnh` : "";
  markDone(); saveDraft();
}
$("imagePreview").addEventListener("click", (e) => {
  if (e.target.dataset.i !== undefined) { images.splice(Number(e.target.dataset.i), 1); renderImages(); }
});
$("imageInput").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  if (images.length + files.length > 10) return toast("Tối đa 10 ảnh");
  const fd = new FormData();
  files.forEach((f) => fd.append("files", f));
  try { images.push(...(await api("/api/upload", { method: "POST", body: fd })).files); renderImages(); }
  catch (err) { toast(err.message); }
};

async function loadTemplates(selected = "") {
  const tpls = await api("/api/templates");
  $("tplSelect").innerHTML = `<option value="">📂 Mẫu đã lưu</option>` +
    Object.keys(tpls).map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  $("tplSelect").value = selected;
  $("btnDeleteTpl").hidden = !selected;
}
$("tplSelect").onchange = async () => {
  const name = $("tplSelect").value;
  $("btnDeleteTpl").hidden = !name;
  if (!name) return;
  const t = (await api("/api/templates"))[name];
  $("postText").value = t.text;
  images = [...t.images];
  renderImages();
};
on("btnSaveTpl", async () => {
  if (!hasContent()) return toast("Nội dung đang trống");
  const name = prompt("Đặt tên cho mẫu bài:", $("tplSelect").value)?.trim();
  if (!name) return;
  await api("/api/templates", { method: "POST", json: { name, text: $("postText").value, images } });
  await loadTemplates(name);
  toast(`Đã lưu mẫu "${name}"`);
});
on("btnDeleteTpl", async () => {
  const name = $("tplSelect").value;
  if (!name || !confirm(`Xoá mẫu "${name}"?`)) return;
  await api(`/api/templates/${encodeURIComponent(name)}`, { method: "DELETE" });
  await loadTemplates();
});

// ================= 4. Cấu hình + chạy =================
const NUM_FIELDS = { min_delay: "minDelay", max_delay: "maxDelay", daily_limit: "dailyLimit", start_hour: "startHour", end_hour: "endHour" };
function fillSettings(s) {
  $$('input[name="mode"]').forEach((r) => (r.checked = r.value === s.mode));
  Object.entries(NUM_FIELDS).forEach(([k, id]) => ($(id).value = s[k]));
  syncSpeed();
}
function readSettings() {
  const s = { mode: $$('input[name="mode"]').find((r) => r.checked)?.value || "semi" };
  Object.entries(NUM_FIELDS).forEach(([k, id]) => (s[k] = Number($(id).value)));
  return s;
}
function syncSpeed() { // tick nút Chậm/Vừa/Nhanh nếu khớp với số phút đang nhập
  const key = `${Number($("minDelay").value)}-${Number($("maxDelay").value)}`;
  $$('input[name="speed"]').forEach((r) => (r.checked = r.value === key));
}
$$('input[name="speed"]').forEach((r) => (r.onchange = () => {
  const [a, b] = r.value.split("-");
  $("minDelay").value = a; $("maxDelay").value = b;
  renderSummary();
}));
$$('input[name="mode"]').forEach((r) => (r.onchange = renderSummary));
Object.values(NUM_FIELDS).forEach((id) => $(id).addEventListener("input", () => { syncSpeed(); renderSummary(); }));

function renderSummary() {
  const s = readSettings();
  const n = selectedGroups().length;
  const problems = [];
  if (status?.logged_in === false) problems.push([1, "Chưa đăng nhập Facebook"]);
  if (!n) problems.push([2, "Chưa chọn nhóm nào"]);
  if (!hasContent()) problems.push([3, "Chưa có nội dung bài đăng"]);
  let html;
  if (problems.length) {
    html = `<ul class="bad">${problems.map(([st, t]) => `<li>${t} → <a data-go="${st}">sửa ở bước ${st}</a></li>`).join("")}</ul>`;
  } else {
    const min = s.mode === "auto" ? Math.max(3, s.min_delay) : s.min_delay;
    const avg = (min + Math.max(min, s.max_delay)) / 2;
    const end = new Date(Date.now() + ((n - 1) * avg + n) * 60000);
    const left = Math.max(0, s.daily_limit - (status?.today_count || 0));
    html = `Đăng <b>${n} nhóm</b>, mỗi nhóm cách nhau <b>${min}–${Math.max(min, s.max_delay)} phút</b>` +
      (n > 1 ? `, xong khoảng <b>${hhmm(end)}</b>.` : ".") +
      (n > left ? `<br><span class="bad">Hôm nay chỉ còn đăng được ${left} bài (giới hạn ${s.daily_limit}/ngày).</span>` : "") +
      (s.mode === "semi" ? `<br><span class="muted">Mỗi nhóm bạn có tối đa 15 phút để bấm Đăng.</span>` : "");
  }
  $("summary").innerHTML = html;
  $("btnStart").disabled = problems.length > 0;
}
$("summary").addEventListener("click", (e) => { if (e.target.dataset.go) goStep(Number(e.target.dataset.go)); });

on("btnStart", async () => {
  const saved = await api("/api/settings", { method: "POST", json: readSettings() });
  fillSettings(saved);
  await api("/api/job/start", { method: "POST", json: { groups: selectedGroups(), text: $("postText").value, images } });
  dismissedRun = false;
  await refreshStatus();
});
on("btnPauseResume", async () => {
  await api(`/api/job/${status.job.paused ? "resume" : "pause"}`, { method: "POST" });
  await refreshStatus();
});
on("btnSkip", async () => { await api("/api/job/skip", { method: "POST" }); });
on("btnStop", async () => {
  if (!confirm("Dừng đăng bài?")) return;
  await api("/api/job/stop", { method: "POST" });
  await refreshStatus();
});
$("btnNewJob").onclick = () => { dismissedRun = true; renderRun(); renderSummary(); };

const ICON = { waiting: "○", running: "⏳", posted: "✅", manual_posted: "✅", skipped: "⏭", error: "❌", cancelled: "⛔" };
function itemsHtml(items) {
  return items.map((it) => `<li class="${esc(it.status)}">
      <span class="ic">${ICON[it.status] || "•"}</span>
      <div class="body"><div class="url" title="${esc(it.url)}">${esc(shortUrl(it.url))}</div>
        ${it.status !== "waiting" ? `<div class="note">${esc(it.label || it.status)}${it.message ? " · " + esc(it.message) : ""}</div>` : ""}</div>
      <span class="when">${esc(it.time || "")}</span></li>`).join("");
}
function countdown(iso) {
  if (!iso) return "";
  const sec = Math.max(0, Math.round((new Date(iso) - Date.now()) / 1000));
  return ` · còn ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}
function renderRun() {
  const j = status.job;
  const show = j.running || (j.items.length > 0 && !dismissedRun);
  $("runView").hidden = !show;
  $("setupView").hidden = show;
  $("nav").hidden = show && step === 4;
  if (!show) return;
  const total = j.items.length;
  const finished = j.items.filter((i) => !["waiting", "running"].includes(i.status)).length;
  const ok = j.items.filter((i) => ["posted", "manual_posted"].includes(i.status)).length;
  $("runTitle").textContent = j.running ? (j.paused ? "⏸ Đã tạm dừng" : "Đang đăng…") : "Đã xong";
  $("runCount").textContent = `${ok} thành công · ${finished}/${total} nhóm`;
  $("progressBar").style.width = `${total ? (finished / total) * 100 : 0}%`;
  $("callout").hidden = !(j.running && !j.paused && j.mode === "semi" && j.items.some((i) => i.status === "running"));
  $("jobMsg").textContent = (j.message || "Đang chuẩn bị…") + countdown(j.next_at);
  $("runActions").hidden = !j.running;
  $("btnNewJob").hidden = j.running;
  $("btnPauseResume").textContent = j.paused ? "▶ Tiếp tục" : "⏸ Tạm dừng";
  $("jobItems").innerHTML = itemsHtml(j.items);
}

// ================= Lịch sử =================
const LABEL = { posted: "Đã đăng", manual_posted: "Đã đăng (thủ công)", skipped: "Bỏ qua", error: "Lỗi", cancelled: "Đã huỷ" };
$("btnHistory").onclick = async () => {
  try {
    const rows = await api("/api/history");
    $("historyItems").innerHTML = rows.length
      ? itemsHtml(rows.map((r) => ({ ...r, label: LABEL[r.status] || r.status, time: (r.time || "").replace("T", " ").slice(0, 16) })))
      : `<li class="muted">Chưa có lịch sử</li>`;
    $("historyDlg").showModal();
  } catch (err) { toast(err.message); }
};
$("btnCloseHistory").onclick = () => $("historyDlg").close();

// ================= Cập nhật trạng thái mỗi giây =================
async function refreshStatus() {
  try { status = await api("/api/status"); }
  catch { $("chipLogin").querySelector("span").textContent = "Mất kết nối tới tool"; $("chipLogin").className = "chip bad"; return; }
  $("chipToday").textContent = `Hôm nay ${status.today_count}/${status.daily_limit} bài`;
  renderLogin();
  if (status.job.running && step !== 4) goStep(4);
  renderRun();
  markDone();
  if (step === 4 && $("runView").hidden) renderSummary();
  autoCheckLogin();
}

// ================= Khởi động =================
(async () => {
  const startStep = loadDraft();
  renderGroups();
  renderImages();
  try {
    fillSettings(await api("/api/settings"));
    await Promise.all([loadGroupLists(), loadTemplates()]);
  } catch (err) { toast(err.message); }
  await refreshStatus();
  goStep(status?.job.running ? 4 : startStep);
  setInterval(refreshStatus, 1000);
})();
