import http from "node:http";
import os from "node:os";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, "public");
const WORDS = ["威猛", "粗犷", "整齐", "喜庆", "柔美", "勇武", "豪放", "热闹", "独舞", "祭祀"];
const rooms = new Map();
const args = process.argv.slice(2);
const TEACHER_PASSCODE = String(process.env.TEACHER_PASSCODE || "");
const PUBLIC_ORIGIN = String(process.env.PUBLIC_ORIGIN || "").replace(/\/$/, "");
function argument(name, fallback) {
  const exact = args.indexOf(name);
  if (exact >= 0 && args[exact + 1]) return args[exact + 1];
  const inline = args.find((item) => item.startsWith(`${name}=`));
  return inline ? inline.slice(name.length + 1) : fallback;
}
const port = Number(argument("--port", process.env.PORT || 7200));
const requestedHost = argument("--host", process.env.HOST || "0.0.0.0");
const host = ["localhost", "127.0.0.1"].includes(requestedHost) ? "0.0.0.0" : requestedHost;
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".wav": "audio/wav" };

function send(res, status, data, headers = {}) {
  const body = typeof data === "string" ? data : JSON.stringify(data);
  res.writeHead(status, { "Content-Type": typeof data === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  res.end(body);
}
function roomCode() {
  let code;
  do { code = String(crypto.randomInt(1000, 10000)); } while (rooms.has(code));
  return code;
}
function createRoom() {
  const code = roomCode();
  const room = { code, teacherKey: crypto.randomBytes(18).toString("hex"), phase: "idle", participants: new Map(), createdAt: Date.now(), round: 1 };
  rooms.set(code, room);
  return room;
}
function getRoom(code) { return rooms.get(String(code || "")); }
function activeCount(room) {
  const now = Date.now();
  return [...room.participants.values()].filter((person) => now - person.lastSeen < 15000).length;
}
function submittedCount(room) { return [...room.participants.values()].filter((person) => person.voted).length; }
function counts(room) {
  const result = Array(WORDS.length).fill(0);
  room.participants.forEach((person) => { if (person.voted) person.picks.forEach((index) => { result[index] += 1; }); });
  return result;
}
function state(room, sid = "", teacher = false) {
  const person = room.participants.get(sid);
  if (person) person.lastSeen = Date.now();
  const reveal = room.phase === "reveal";
  return {
    code: room.code,
    phase: room.phase,
    round: room.round,
    submitted: submittedCount(room),
    participants: room.participants.size,
    active: activeCount(room),
    voted: Boolean(person?.voted),
    my: person?.picks || [],
    ...(reveal || teacher ? { counts: counts(room) } : {}),
    ...(teacher ? { teacher: true } : {}),
  };
}
function teacherRoom(req, url, body = {}) {
  const room = getRoom(url.searchParams.get("code") || body.code);
  const key = url.searchParams.get("key") || body.key || req.headers["x-teacher-key"];
  if (!room || room.teacherKey !== key) return null;
  return room;
}
function lanAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  Object.entries(interfaces).forEach(([name, entries]) => {
    (entries || []).forEach((entry) => {
      if (entry.family === "IPv4" && !entry.internal) candidates.push({ name, address: entry.address });
    });
  });
  return (candidates.find((item) => /^en\d+$/.test(item.name)) || candidates[0])?.address || "127.0.0.1";
}
function classOrigin(req) {
  if (PUBLIC_ORIGIN) return PUBLIC_ORIGIN;
  const hostHeader = req.headers.host || `localhost:${port}`;
  const hostname = hostHeader.split(":")[0];
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto === "https" ? "https" : "http";
  if (!["localhost", "127.0.0.1", "0.0.0.0", "[::1]"].includes(hostname)) return `${protocol}://${hostHeader}`;
  return `http://${lanAddress()}:${port}`;
}
async function bodyJSON(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 16384) throw new Error("请求内容过大");
  }
  return text ? JSON.parse(text) : {};
}
async function api(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") return send(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/api/config") return send(res, 200, { origin: classOrigin(req), words: WORDS, passcodeRequired: Boolean(TEACHER_PASSCODE) });
  if (req.method === "POST" && url.pathname === "/api/teacher/create") {
    const body = await bodyJSON(req);
    if (TEACHER_PASSCODE && body.passcode !== TEACHER_PASSCODE) return send(res, 403, { error: "教师管理密码不正确" });
    const room = createRoom();
    return send(res, 200, { ...state(room, "", true), key: room.teacherKey, studentUrl: `${classOrigin(req)}/play?c=${room.code}` });
  }
  if (req.method === "GET" && url.pathname === "/api/teacher/state") {
    const room = teacherRoom(req, url);
    if (!room) return send(res, 403, { error: "教师身份已失效，请重新发起课堂" });
    return send(res, 200, { ...state(room, "", true), studentUrl: `${classOrigin(req)}/play?c=${room.code}` });
  }
  if (req.method === "POST" && url.pathname === "/api/teacher/action") {
    const body = await bodyJSON(req);
    const room = teacherRoom(req, url, body);
    if (!room) return send(res, 403, { error: "教师身份已失效，请重新发起课堂" });
    const transitions = { start: ["idle", "voting"], close: ["voting", "closed"], reveal: ["closed", "reveal"], reset: [room.phase, "idle"] };
    const next = transitions[body.action];
    if (!next || next[0] !== room.phase) return send(res, 409, { error: "当前环节不能执行此操作", ...state(room, "", true) });
    room.phase = next[1];
    if (body.action === "reset") {
      room.round += 1;
      room.participants.forEach((person) => { person.voted = false; person.picks = []; person.submittedAt = null; });
    }
    return send(res, 200, { ...state(room, "", true), studentUrl: `${classOrigin(req)}/play?c=${room.code}` });
  }
  if (req.method === "GET" && url.pathname === "/api/qr") {
    const room = getRoom(url.searchParams.get("code"));
    if (!room) return send(res, 404, { error: "房间不存在或已结束" });
    const studentUrl = `${classOrigin(req)}/play?c=${room.code}`;
    const dataUrl = await QRCode.toDataURL(studentUrl, { width: 440, margin: 2, errorCorrectionLevel: "M", color: { dark: "#17384b", light: "#fffdf7" } });
    return send(res, 200, { dataUrl, studentUrl });
  }
  if (req.method === "POST" && url.pathname === "/api/join") {
    const body = await bodyJSON(req);
    const room = getRoom(body.code);
    if (!room) return send(res, 404, { error: "房间码不对，或课堂已结束" });
    const sid = String(body.sid || "").slice(0, 60);
    if (!sid) return send(res, 400, { error: "学生身份无效，请刷新页面" });
    if (!room.participants.has(sid)) room.participants.set(sid, { picks: [], voted: false, joinedAt: Date.now(), lastSeen: Date.now(), submittedAt: null });
    return send(res, 200, state(room, sid));
  }
  if (req.method === "GET" && url.pathname === "/api/state") {
    const room = getRoom(url.searchParams.get("code"));
    if (!room) return send(res, 404, { error: "房间不存在或已结束" });
    return send(res, 200, state(room, url.searchParams.get("sid") || ""));
  }
  if (req.method === "POST" && url.pathname === "/api/vote") {
    const body = await bodyJSON(req);
    const room = getRoom(body.code);
    if (!room) return send(res, 404, { error: "房间不存在或已结束" });
    const sid = String(body.sid || "");
    const person = room.participants.get(sid);
    if (!person) return send(res, 403, { error: "请先进入课堂" });
    if (room.phase !== "voting") return send(res, 409, { error: room.phase === "idle" ? "老师还没有开始" : "本轮已经截止", ...state(room, sid) });
    const picks = [...new Set(body.picks)].filter((index) => Number.isInteger(index) && index >= 0 && index < WORDS.length);
    if (picks.length < 1 || picks.length > 3 || picks.length !== body.picks.length) return send(res, 400, { error: "请选择 1—3 个词" });
    person.picks = picks;
    person.voted = true;
    person.submittedAt = Date.now();
    person.lastSeen = Date.now();
    return send(res, 200, state(room, sid));
  }
  return send(res, 404, { error: "接口不存在" });
}
async function serveStatic(res, pathname) {
  const route = pathname === "/" || pathname === "/teacher" ? "/index.html" : pathname === "/play" ? "/play.html" : pathname;
  let decoded;
  try { decoded = decodeURIComponent(route); } catch { return send(res, 400, "路径无效"); }
  const file = path.resolve(PUBLIC, `.${decoded}`);
  if (!file.startsWith(`${PUBLIC}${path.sep}`)) return send(res, 403, "禁止访问");
  try {
    const content = await fs.readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'" });
    res.end(content);
  } catch { send(res, 404, "页面不存在"); }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else await serveStatic(res, url.pathname);
  } catch (error) {
    send(res, 500, { error: error instanceof SyntaxError ? "请求格式不正确" : "服务暂时繁忙，请重试" });
  }
});
const cleanup = setInterval(() => {
  const expiry = Date.now() - 4 * 60 * 60 * 1000;
  rooms.forEach((room, code) => { if (room.createdAt < expiry) rooms.delete(code); });
}, 30 * 60 * 1000);
cleanup.unref();
server.listen(port, host, () => {
  console.log(`英歌·一个词 已启动`);
  console.log(`教师端：http://localhost:${port}/teacher`);
  console.log(`局域网：http://${lanAddress()}:${port}/teacher`);
});
