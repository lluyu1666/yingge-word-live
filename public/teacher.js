import { $, $$, WORDS, PHASES, post, request, renderResults, sticksIcon, topSummary } from "/shared.js";

let code = "";
let key = "";
let phase = "idle";
let studentUrl = "";
let qrData = "";
let pollId = 0;
let busy = false;
let renderedReveal = "";
let latestRoster = [];
$("#brandIcon").innerHTML = sticksIcon();

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.hidden = false;
  clearTimeout(element.hideTimer);
  element.hideTimer = setTimeout(() => { element.hidden = true; }, 2800);
}
function saveSession() { localStorage.setItem("yg_live_teacher", JSON.stringify({ code, key })); }
async function loadQr() {
  const data = await request(`/api/qr?code=${code}`);
  qrData = data.dataUrl;
  studentUrl = data.studentUrl;
  $("#qrImage").src = qrData;
  $("#studentLink").textContent = studentUrl;
}
function enterClass(data) {
  $("#welcomeView").hidden = true;
  $("#classView").hidden = false;
  $("#roomCode").textContent = code;
  render(data);
  loadQr().catch(() => toast("二维码生成失败，请检查网络"));
  clearInterval(pollId);
  pollId = setInterval(refresh, 1200);
}
async function refresh() {
  if (!code || !key) return;
  try {
    const data = await request(`/api/teacher/state?code=${encodeURIComponent(code)}&key=${encodeURIComponent(key)}`);
    studentUrl = data.studentUrl;
    $("#connectionText").textContent = "实时同步中";
    render(data);
  } catch (error) {
    $("#connectionText").textContent = "正在重新连接";
    if (error.status === 403) {
      clearInterval(pollId);
      localStorage.removeItem("yg_live_teacher");
      $("#classView").hidden = true;
      $("#welcomeView").hidden = false;
      toast("上一课堂已结束，请重新发起");
    }
  }
}
function renderRoster(data) {
  latestRoster = data.counts || [];
  const summary = topSummary(latestRoster);
  const max = Math.max(0, ...latestRoster);
  $("#liveTop").textContent = summary.top.join("、") || "等待提交";
  $("#liveTopCount").textContent = max ? `${max} 票 · 随提交实时更新` : "学生提交后实时更新";
  $("#exportData").disabled = data.submitted === 0;
  $("#rosterTotal").textContent = `已进入 ${data.participants} 人 · 已提交 ${data.submitted} 人 · 不收集姓名`;
  const tbody = $("#rosterRows");
  tbody.replaceChildren();
  WORDS.forEach((word, index) => {
    const row = document.createElement("tr");
    const wordCell = document.createElement("td");
    wordCell.className = "roster-name";
    wordCell.textContent = word;
    const countCell = document.createElement("td");
    countCell.textContent = `${latestRoster[index] || 0} 人`;
    const percentCell = document.createElement("td");
    percentCell.textContent = data.submitted ? `${Math.round((latestRoster[index] || 0) / data.submitted * 100)}%` : "—";
    row.append(wordCell, countCell, percentCell);
    tbody.appendChild(row);
  });
}
function render(data) {
  phase = data.phase;
  if (Array.isArray(data.counts)) renderRoster(data);
  $("#activeCount").textContent = data.active;
  $("#submittedCount").textContent = data.submitted;
  $("#phaseText").textContent = PHASES[phase];
  $("#teacherTip").textContent = {
    idle: data.participants ? `已有 ${data.participants} 位学生进入，准备好后开始选词。` : "先让学生扫码入场，准备好后开始选词。",
    voting: `学生正在选择，已提交 ${data.submitted} 人。点击“截止提交”后，答案将不能修改。`,
    closed: "本轮已经截止。可以请学生说说选择理由，再揭晓全班词频。",
    reveal: "词频已经同步到学生手机。结合最多人选和无人选择的词展开讨论。",
  }[phase];
  $("#startVote").disabled = busy || phase !== "idle";
  $("#closeVote").disabled = busy || phase !== "voting";
  $("#revealVote").disabled = busy || phase !== "closed";
  $("#resetRound").disabled = busy || phase === "idle";
  const order = ["idle", "voting", "closed", "reveal"];
  $$(".phase-track span").forEach((item) => {
    const index = order.indexOf(item.dataset.phase);
    item.classList.toggle("active", item.dataset.phase === phase);
    item.classList.toggle("complete", index < order.indexOf(phase));
  });
  $("#teacherResults").hidden = phase !== "reveal";
  if (phase === "reveal" && renderedReveal !== `${code}-${data.round}`) {
    renderedReveal = `${code}-${data.round}`;
    renderResults($("#teacherResultRows"), data.counts);
    const summary = topSummary(data.counts);
    $("#resultTotal").textContent = `共 ${data.submitted} 人提交`;
    $("#teacherSummary").innerHTML = `<span>最多人选：<strong>${summary.top.join("、") || "—"}</strong></span><span>无人选择：<strong>${summary.unchosen.join("、") || "—"}</strong></span>`;
  }
}
async function createClass() {
  busy = true;
  $("#createBtn").disabled = true;
  $("#createBtn").textContent = "正在生成课堂…";
  try {
    const data = await post("/api/teacher/create", { passcode: $("#teacherPasscode").value });
    code = data.code;
    key = data.key;
    studentUrl = data.studentUrl;
    renderedReveal = "";
    saveSession();
    enterClass(data);
  } catch (error) { toast(error.message); }
  finally {
    busy = false;
    $("#createBtn").disabled = false;
    $("#createBtn").textContent = "生成课堂与二维码";
  }
}
async function action(name) {
  if (busy) return;
  busy = true;
  render({ phase, active: Number($("#activeCount").textContent), submitted: Number($("#submittedCount").textContent), participants: 0, counts: [], round: 0 });
  try {
    const data = await post("/api/teacher/action", { code, key, action: name });
    if (name === "reset") renderedReveal = "";
    render(data);
    toast({ start: "选词已开始，学生可以提交了", close: "已截止提交", reveal: "全班结果已同步揭晓", reset: "新一轮已准备好" }[name]);
  } catch (error) { toast(error.message); refresh(); }
  finally { busy = false; refresh(); }
}
$("#createBtn").addEventListener("click", createClass);
$("#startVote").addEventListener("click", () => action("start"));
$("#closeVote").addEventListener("click", () => action("close"));
$("#revealVote").addEventListener("click", () => action("reveal"));
$("#resetRound").addEventListener("click", () => action("reset"));
$("#downloadQr").addEventListener("click", () => {
  if (!qrData) return;
  const link = document.createElement("a");
  link.href = qrData;
  link.download = `英歌一个词_房间${code}.png`;
  link.click();
  toast("二维码已保存");
});
$("#copyLink").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(studentUrl); }
  catch {
    const input = document.createElement("textarea");
    input.value = studentUrl; document.body.appendChild(input); input.select(); document.execCommand("copy"); input.remove();
  }
  toast("学生链接已复制");
});
$("#exportData").addEventListener("click", () => {
  if (!latestRoster.length) return;
  const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = [
    ["词汇", "选择人数"],
    ...latestRoster.map((count, index) => [WORDS[index], count]),
  ];
  const blob = new Blob([`\ufeff${rows.map((row) => row.map(cell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `英歌一个词_房间${code}_词频统计.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("词频统计已导出");
});
const previous = localStorage.getItem("yg_live_teacher");
if (previous) {
  try {
    const saved = JSON.parse(previous);
    code = saved.code; key = saved.key;
    request(`/api/teacher/state?code=${encodeURIComponent(code)}&key=${encodeURIComponent(key)}`).then(enterClass).catch(() => { localStorage.removeItem("yg_live_teacher"); code = ""; key = ""; });
  } catch { localStorage.removeItem("yg_live_teacher"); }
}
