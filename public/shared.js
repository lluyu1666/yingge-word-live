export const WORDS = ["威猛", "粗犷", "整齐", "喜庆", "柔美", "勇武", "豪放", "热闹", "独舞", "祭祀"];
export const $ = (selector) => document.querySelector(selector);
export const $$ = (selector) => [...document.querySelectorAll(selector)];
export const PHASES = { idle: "等待开始", voting: "选词进行中", closed: "等待揭晓", reveal: "结果已揭晓" };

export async function request(url, options = {}) {
  const response = await fetch(url, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "连接失败，请稍后重试");
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}
export function post(url, data = {}) {
  return request(url, { method: "POST", body: JSON.stringify(data) });
}
export function sticksIcon(className = "") {
  return `<svg class="${className}" viewBox="0 0 64 64" aria-hidden="true"><path d="M15 47 43 12M23 53 52 20" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/><path d="M8 41c6-4 13-1 15 6-6 6-13 4-15-6ZM37 8c6-4 13-1 15 6-6 6-13 4-15-6Z" fill="currentColor"/></svg>`;
}
export function renderResults(container, counts, my = []) {
  const mine = new Set(my);
  const order = WORDS.map((word, index) => ({ word, index, count: counts[index] || 0 })).sort((a, b) => b.count - a.count || a.index - b.index);
  const max = Math.max(1, ...counts);
  container.replaceChildren();
  order.forEach((item, rank) => {
    const row = document.createElement("div");
    row.className = `result-row${mine.has(item.index) ? " mine" : ""}${item.count === 0 ? " zero" : ""}`;
    row.innerHTML = `<span class="result-rank">${String(rank + 1).padStart(2, "0")}</span><span class="result-word">${item.word}${mine.has(item.index) ? "<small>我的选择</small>" : ""}</span><span class="result-track"><i style="--bar:${Math.round(item.count / max * 100)}%"></i></span><strong class="result-count">${item.count}<small>票</small></strong>`;
    container.appendChild(row);
  });
  return order;
}
export function topSummary(counts) {
  const max = Math.max(0, ...counts);
  return {
    top: WORDS.filter((_, index) => max > 0 && counts[index] === max),
    unchosen: WORDS.filter((_, index) => counts[index] === 0),
  };
}
export function sessionId() {
  const key = "yg_live_sid";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `s_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now()}`;
    localStorage.setItem(key, id);
  }
  return id;
}
