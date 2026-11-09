import { $, $$, WORDS, PHASES, post, request, renderResults, sessionId, sticksIcon, topSummary } from "/shared.js";

let code = new URLSearchParams(location.search).get("c") || "";
const sid = sessionId();
let phase = "idle";
let round = 0;
let picks = new Set();
let submitted = false;
let editing = false;
let finished = false;
let pollId = 0;
let joining = false;
let currentView = "";
const music = $("#bgMusic");
let musicWanted = true;
music.volume = 0.3;
$("#brandIcon").innerHTML = sticksIcon();
function paintMusic() {
  const playing = !music.paused;
  $("#musicText").textContent = playing ? "音乐开" : "开启音乐";
  $("#musicToggle").setAttribute("aria-pressed", String(playing));
}
async function startMusic() {
  if (!musicWanted) return;
  try { await music.play(); } catch { /* 手机未允许自动播放时，保留明显的音乐开关 */ }
  paintMusic();
}
$("#musicToggle").addEventListener("click", () => {
  if (music.paused) { musicWanted = true; startMusic(); }
  else { musicWanted = false; music.pause(); paintMusic(); }
});
music.addEventListener("play", paintMusic);
music.addEventListener("pause", paintMusic);
music.addEventListener("error", () => { $("#musicText").textContent = "音乐不可用"; $("#musicToggle").disabled = true; });
document.addEventListener("click", (event) => {
  if (event.target.closest("#finishView")) { musicWanted = false; music.pause(); paintMusic(); return; }
  const joinClick = event.target.closest("#joinBtn");
  const validJoin = joinClick && /^\d{4}$/.test($("#codeInput").value);
  if ((validJoin || event.target.closest(".word-card")) && musicWanted && music.paused) startMusic();
});
paintMusic();

function toast(message) {
  const element = $("#toast");
  element.textContent = message; element.hidden = false;
  clearTimeout(element.hideTimer); element.hideTimer = setTimeout(() => { element.hidden = true; }, 2600);
}
function view(name) {
  const changed = currentView !== name;
  currentView = name;
  ["join", "play", "wait", "reveal", "finished"].forEach((item) => { $(`#${item}View`).hidden = item !== name; });
  if (changed) window.scrollTo({ top: 0, behavior: "smooth" });
}
function buildWords() {
  WORDS.forEach((word, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word-card";
    button.dataset.index = index;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `<span class="word-index">${String(index + 1).padStart(2, "0")}</span><span class="word-text">${word}</span><span class="word-check"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
    button.addEventListener("click", () => toggle(index, button));
    $("#wordGrid").appendChild(button);
  });
}
function toggle(index, button) {
  if (phase !== "idle" && phase !== "voting") return;
  if (picks.has(index)) picks.delete(index);
  else {
    if (picks.size >= 3) {
      button.classList.remove("shake"); void button.offsetWidth; button.classList.add("shake");
      toast("最多选择 3 个词，可以先取消一个");
      return;
    }
    picks.add(index);
  }
  if (navigator.vibrate) navigator.vibrate(8);
  paintPicks();
}
function paintPicks() {
  $$(".word-card").forEach((button) => {
    const selected = picks.has(Number(button.dataset.index));
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  $("#selectedCount").textContent = picks.size;
  $("#selectionFill").style.width = `${picks.size / 3 * 100}%`;
  $("#selectionHint").textContent = picks.size ? `已选：${[...picks].map((index) => WORDS[index]).join("、")}` : "点选词汇，再次点击可取消。";
  const submit = $("#submitVote");
  submit.disabled = picks.size === 0 || phase !== "voting";
  submit.textContent = phase === "voting" ? (submitted || editing ? "确认修改并提交" : "击槌提交我的选择") : "等老师开始";
  $("#playKicker").textContent = PHASES[phase];
  $("#playDesc").textContent = phase === "idle" ? "可以先选好，等老师开始后提交。" : "从下列词汇中，选出最能描述它的 1—3 个词。";
}
function render(data) {
  const nextRound = data.round;
  if (round && nextRound !== round) {
    submitted = false; editing = false; finished = false; picks = new Set();
  }
  round = nextRound;
  phase = data.phase;
  $("#roundBadge").textContent = `第${["一", "二", "三", "四", "五"][Math.min(round - 1, 4)] || round}轮`;
  $("#studentRoom").textContent = `房间 ${code}`;
  $("#studentConnection").textContent = PHASES[phase];
  $(".connection-dot").classList.add("online");
  $("#classSubmitted").textContent = `全班已提交 ${data.submitted} 人`;
  $("#waitSubmitted").textContent = `全班已提交 ${data.submitted} 人`;
  if (data.voted && !editing) {
    submitted = true;
    if (data.my.length) picks = new Set(data.my);
  }
  if (phase === "idle") {
    submitted = false; editing = false; finished = false;
    view("play"); paintPicks();
  } else if (phase === "voting") {
    finished = false;
    if ((submitted || data.voted) && !editing) showWait("选择已送达", "你的答案，已汇入全班。", "等老师截止并揭晓结果。", true);
    else { view("play"); paintPicks(); }
  } else if (phase === "closed") {
    showWait("本轮已截止", "选择已经落定。", "等老师揭晓全班结果。", false);
  } else if (phase === "reveal") {
    if (finished) { view("finished"); return; }
    view("reveal");
    renderResults($("#studentResultRows"), data.counts, data.my);
    const summary = topSummary(data.counts);
    $("#revealTotal").textContent = `共 ${data.submitted} 人提交 · 标记“我的选择”的是你投出的词`;
    $("#studentSummary").innerHTML = `<span>最多人选<strong>${summary.top.join("、") || "—"}</strong></span><span>无人选择<strong>${summary.unchosen.join("、") || "—"}</strong></span>`;
  }
}
function showWait(kicker, title, desc, canModify) {
  view("wait");
  $("#waitKicker").textContent = kicker;
  $("#waitTitle").textContent = title;
  $("#waitDesc").textContent = desc;
  $("#chosenWords").innerHTML = [...picks].map((index) => `<span>${WORDS[index]}</span>`).join("");
  $("#modifyVote").hidden = !canModify;
}
async function join() {
  if (joining || !/^\d{4}$/.test(code)) return;
  joining = true;
  $("#joinBtn").disabled = true;
  $("#joinError").textContent = "";
  try {
    const data = await post("/api/join", { code, sid });
    history.replaceState(null, "", `/play?c=${code}`);
    render(data);
    clearInterval(pollId);
    pollId = setInterval(refresh, 1100);
  } catch (error) {
    view("join");
    $("#joinError").textContent = error.message;
  } finally { joining = false; $("#joinBtn").disabled = false; }
}
async function refresh() {
  try {
    const data = await request(`/api/state?code=${code}&sid=${encodeURIComponent(sid)}`);
    render(data);
  } catch (error) {
    $("#studentConnection").textContent = "重新连接中";
    $(".connection-dot").classList.remove("online");
    if (error.status === 404) {
      clearInterval(pollId); view("join"); $("#joinError").textContent = error.message;
    }
  }
}
async function submit() {
  if (!picks.size || phase !== "voting") return;
  $("#submitVote").disabled = true;
  $("#submitVote").textContent = "正在提交…";
  try {
    const data = await post("/api/vote", { code, sid, picks: [...picks] });
    submitted = true; editing = false;
    if (navigator.vibrate) navigator.vibrate([12, 40, 12]);
    render(data);
  } catch (error) {
    toast(error.message);
    if (error.data?.phase) render(error.data);
    paintPicks();
  }
}
$("#joinBtn").addEventListener("click", () => {
  code = $("#codeInput").value.replace(/\D/g, "").slice(0, 4);
  if (code.length !== 4) { $("#joinError").textContent = "请输入四位房间码"; return; }
  join();
});
$("#codeInput").addEventListener("input", (event) => { event.target.value = event.target.value.replace(/\D/g, "").slice(0, 4); });
$("#codeInput").addEventListener("keydown", (event) => { if (event.key === "Enter") $("#joinBtn").click(); });
$("#submitVote").addEventListener("click", submit);
$("#modifyVote").addEventListener("click", () => { submitted = false; editing = true; view("play"); paintPicks(); });
$("#finishView").addEventListener("click", () => { finished = true; view("finished"); });
buildWords();
$("#codeInput").value = code;
if (/^\d{4}$/.test(code)) join();
else view("join");
