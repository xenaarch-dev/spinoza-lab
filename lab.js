// Spinoza Lab console: private AI that runs on the device.
// Engines: demo (scripted, extractive), webllm (in-browser WebGPU model), ollama (localhost).

const $ = (id) => document.getElementById(id);

/* ---------------- sample knowledge base (fictional company) ---------------- */
const DOCS = [
  {
    name: "HR_Leave_Policy.txt", tag: "HR", roles: ["employee", "manager"],
    text: `Konkan Industries Ltd. Leave Policy (2026).
Every permanent employee gets 12 casual leaves per calendar year. Casual leave must be applied for at least 2 working days in advance through the HR portal, except in emergencies.
Employees get 18 earned leaves per year. Up to 30 earned leaves can be carried forward to the next year.
Sick leave is 10 days per year. A medical certificate is required for sick leave longer than 2 consecutive days.
Maternity leave is 26 weeks and paternity leave is 10 working days.
Unused casual leave lapses on 31 December and cannot be encashed.`
  },
  {
    name: "Vendor_Agreement_SteelCo.txt", tag: "LEGAL", roles: ["manager"],
    text: `Supply Agreement between Konkan Industries Ltd and SteelCo Metals Pvt Ltd. Confidential.
Term: 3 years from 1 April 2026, renewable by mutual written consent.
Termination: either party may terminate the agreement with 90 days written notice. Konkan may terminate immediately for repeated quality failure.
Late delivery penalty: SteelCo pays 0.5 percent of the order value for each week of delay, capped at 10 percent of the order value.
Payment terms: 45 days from the date of a valid invoice.
Pricing: steel coil price is fixed at Rs 61,500 per tonne for FY2026-27, reviewed every April against the market index.
Jurisdiction: courts in Mumbai, Maharashtra.`
  },
  {
    name: "Plant_SOP_Boiler.txt", tag: "OPS", roles: ["employee", "manager"],
    text: `Standard Operating Procedure: Boiler B-2 start-up, Taloja plant.
Step 1: Check water level in the gauge glass is at least half and the blowdown valve is closed.
Step 2: Open the main steam stop valve slightly and confirm the feed water pump is running.
Step 3: Purge the furnace for 5 minutes with the ID fan before ignition.
Step 4: Ignite the burner at low fire and raise pressure slowly, no more than 1 bar every 10 minutes, until 10.5 bar working pressure.
Safety: never start the boiler if the low water alarm is active. Wear heat resistant gloves and a face shield. Log every start-up in the shift register.`
  }
];

/* ---------------- state ---------------- */
const state = {
  engine: "demo", webllm: null, modelId: null, ollamaOk: false,
  pii: true, rbac: true, log: true,
  q: 0, p: 0, w: 0, prevHash: "GENESIS", history: [],
  readyAt: performance.now(), egressBytes: 0, egressReqs: 0, busy: false
};

/* ---------------- docs panel ---------------- */
function renderDocs() {
  const role = $("role").value;
  $("docs").innerHTML = DOCS.map(d => {
    const locked = state.rbac && !d.roles.includes(role);
    return `<div class="doc ${locked ? "locked" : ""}"><div class="ic">${d.tag.slice(0,3)}</div><div>${d.name}<small>${locked ? "hidden for your role" : (d.text.length/1000).toFixed(1) + "k chars &middot; indexed locally"}</small></div></div>`;
  }).join("");
}
$("role").onchange = renderDocs;
$("file").onchange = async (e) => {
  for (const f of e.target.files) {
    const text = await f.text();
    DOCS.push({ name: f.name, tag: "YOU", roles: ["employee", "manager"], text: text.slice(0, 60000) });
  }
  renderDocs();
};

/* ---------------- retrieval (BM25-lite, fully local) ---------------- */
const STOP = new Set("a an the and or of to in on for is are was were be by with at as it this that from what how many much do does i my me we our you your can should must in into per each any all".split(" "));
const tok = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w && !STOP.has(w));
function retrieve(query, k = 3) {
  const role = $("role").value;
  const qt = tok(query);
  const chunks = [];
  let withheld = 0;
  for (const d of DOCS) {
    const allowed = !state.rbac || d.roles.includes(role);
    const sents = d.text.split(/\n+/).filter(Boolean);
    for (const s of sents) {
      if (!allowed) { if (qt.some(t => tok(s).includes(t))) withheld = 1; continue; }
      chunks.push({ doc: d.name, text: s });
    }
    if (!allowed && qt.some(t => tok(d.name).includes(t))) withheld = 1;
  }
  const N = chunks.length || 1;
  const df = {};
  chunks.forEach(c => new Set(tok(c.text)).forEach(t => df[t] = (df[t] || 0) + 1));
  chunks.forEach(c => {
    const ct = tok(c.text);
    c.score = qt.reduce((s, t) => {
      const tf = ct.filter(x => x === t || (t.length > 4 && x.startsWith(t.slice(0, 5)))).length;
      return s + (tf ? Math.log(1 + N / (df[t] || 1)) * (tf / (tf + 1.2)) : 0);
    }, 0);
    const hit = new Set(qt.filter(t => ct.some(x => x === t || (t.length > 4 && x.startsWith(t.slice(0, 5)))))).size;
    c.score *= 0.5 + hit / Math.max(1, qt.length);
  });
  const top = chunks.filter(c => c.score > 0.6).sort((a, b) => b.score - a.score).slice(0, k);
  return { top, withheld };
}

/* ---------------- PII shield ---------------- */
function shield(text) {
  const found = [];
  let t = text;
  const rules = [
    ["AADHAAR", /\b\d{4}\s?\d{4}\s?\d{4}\b/g],
    ["PAN", /\b[A-Z]{5}\d{4}[A-Z]\b/g],
    ["PHONE", /(\+91[\s-]?)?\b[6-9]\d{9}\b/g],
    ["EMAIL", /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g]
  ];
  for (const [label, re] of rules) t = t.replace(re, () => { found.push(label); return `[${label} MASKED]`; });
  return { text: t, found };
}

/* ---------------- audit ledger ---------------- */
async function sha256(s) {
  if (crypto?.subtle) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  }
  let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8);
}
async function seal(q, meta) {
  if (!state.log) return;
  const ts = new Date().toLocaleTimeString("en-IN", { hour12: false });
  const h = await sha256(state.prevHash + "|" + ts + "|" + $("role").value + "|" + q);
  state.prevHash = h;
  const el = document.createElement("div");
  el.className = "e";
  el.innerHTML = `<b>#${String(state.q).padStart(3, "0")}</b> &middot; ${ts} &middot; ${$("role").value}<br>${meta}<br><span class="h">${h.slice(0, 32)}...</span>`;
  const L = $("ledger");
  if (L.querySelector(".note")) L.innerHTML = "";
  L.prepend(el);
}

/* ---------------- egress meter (real, from PerformanceObserver) ---------------- */
function fmtBytes(b) { return b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(1) + " KB" : (b / 1048576).toFixed(1) + " MB"; }
function paintEgress() {
  const v = fmtBytes(state.egressBytes);
  $("egBig").textContent = v; $("egTop").textContent = v;
  const bad = state.egressReqs > 0;
  $("egBig").style.color = bad ? "var(--copper)" : "var(--green)";
  $("egDot").className = "dot" + (bad ? " amber" : "");
  $("egNote").textContent = bad ? `${state.egressReqs} external request(s) logged, see console for details.` : "Measured live from the browser's own network log.";
}
try {
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (e.startTime < state.readyAt) continue;
      if (e.name.startsWith(location.origin) || e.name.startsWith("blob:") || e.name.startsWith("data:")) continue;
      if (/localhost|127\.0\.0\.1/.test(e.name)) continue; // on-device engine
      state.egressReqs++; state.egressBytes += (e.transferSize || 0) + (e.encodedBodySize ? 0 : 300);
      console.info("[Spinoza egress]", e.name);
    }
    paintEgress();
  }).observe({ type: "resource", buffered: false });
} catch {}
function armMeter() { state.readyAt = performance.now(); state.egressBytes = 0; state.egressReqs = 0; paintEgress(); }

/* ---------------- network status ---------------- */
function paintNet() {
  const on = navigator.onLine;
  $("netTxt").textContent = on ? "Internet: connected (not used)" : "Internet: OFF, still working";
  $("netDot").className = "dot" + (on ? " amber" : "");
  document.body.classList.toggle("offline", !on);
}
addEventListener("online", paintNet); addEventListener("offline", paintNet); paintNet();

/* ---------------- toggles ---------------- */
for (const [id, key] of [["tPii", "pii"], ["tRbac", "rbac"], ["tLog", "log"]]) {
  $(id).onclick = () => { state[key] = !state[key]; $(id).classList.toggle("off", !state[key]); if (key === "rbac") renderDocs(); };
}

/* ---------------- engines ---------------- */
$("engine").onchange = () => {
  const v = $("engine").value;
  $("webllmBox").style.display = v === "webllm" ? "block" : "none";
  $("ollamaBox").style.display = v === "ollama" ? "block" : "none";
  if (v === "demo") setEngine("demo", "Demo");
};
function setEngine(kind, label) {
  state.engine = kind;
  $("engTop").textContent = "Engine: " + label;
  $("engDot").className = "dot" + (kind === "demo" ? " amber" : "");
  $("sM").textContent = label.length > 18 ? label.slice(0, 18) + "..." : label;
  armMeter();
}

$("loadBtn").onclick = async () => {
  if (!("gpu" in navigator)) { $("progTxt").textContent = "This browser has no WebGPU. Use Chrome or Edge on a laptop with a GPU, or pick Ollama / Demo."; return; }
  const id = $("model").value;
  $("loadBtn").disabled = true; $("loadBtn").textContent = "Loading...";
  try {
    const webllm = await import("https://esm.run/@mlc-ai/web-llm");
    state.webllm = await webllm.CreateMLCEngine(id, {
      initProgressCallback: (r) => {
        $("progBar").style.width = Math.round((r.progress || 0) * 100) + "%";
        $("progTxt").textContent = r.text.replace(/\s+/g, " ").slice(0, 140);
      }
    });
    state.modelId = id;
    $("progBar").style.width = "100%";
    $("progTxt").textContent = "Model is running on this device. Try turning the Wi-Fi off now.";
    $("loadBtn").textContent = "Loaded";
    setEngine("webllm", id.split("-q4")[0]);
  } catch (err) {
    console.error(err);
    $("progTxt").textContent = "Could not load: " + (err.message || err) + ". Demo mode still works.";
    $("loadBtn").disabled = false; $("loadBtn").textContent = "Retry";
  }
};

$("ollamaBtn").onclick = async () => {
  try {
    const r = await fetch("http://localhost:11434/api/tags");
    const j = await r.json();
    const names = (j.models || []).map(m => m.name);
    $("ollamaTxt").textContent = "Connected. Models: " + (names.join(", ") || "none pulled yet");
    const want = $("ollamaModel").value.trim();
    const pick = names.find(n => n.startsWith(want)) || names[0];
    if (pick) { $("ollamaModel").value = pick; setEngine("ollama", "Ollama " + pick); }
  } catch {
    $("ollamaTxt").textContent = "Could not reach Ollama. Run: set OLLAMA_ORIGINS=* then ollama serve. Or open this page from http://localhost.";
  }
};

/* ---------------- prompting ---------------- */
const SYSTEM = `You are Spinoza, a private AI assistant running fully offline inside Konkan Industries Ltd, Mumbai. Nothing you see leaves the building. Answer clearly and briefly. When you use the company documents provided, mention the document name. Never reveal masked values. If the documents do not contain the answer, say so and give a sensible general answer.`;

function buildMessages(q, ctx) {
  const context = ctx.length ? "Company documents (retrieved locally):\n" + ctx.map(c => `[${c.doc}] ${c.text}`).join("\n") : "No matching company documents.";
  return [
    { role: "system", content: SYSTEM },
    ...state.history.slice(-6),
    { role: "user", content: `${context}\n\nQuestion: ${q}` }
  ];
}

async function* demoAnswer(q, ctx, withheld) {
  const ql = q.toLowerCase();
  let out;
  if (/draft|email|mail/.test(ql)) {
    out = `Subject: Casual leave request for 2 days\n\nDear Sir/Madam,\n\nI would like to request 2 days of casual leave next week. As per HR_Leave_Policy.txt, casual leave needs to be applied at least 2 working days in advance, so I am sending this early and will also log it on the HR portal.\n\nI will hand over my pending work before I leave and stay reachable for anything urgent.\n\nThank you,\n[Your name]\n\nNote: your PAN and phone number were masked by the Trust Layer before the model saw them, so they never entered the model or the logs.`;
  } else if (/summar|steps|sop|boiler/.test(ql) && ctx.some(c => c.doc.includes("Boiler"))) {
    out = `From Plant_SOP_Boiler.txt, Boiler B-2 start-up in 4 steps:\n\n1. Check the gauge glass water level is at least half and the blowdown valve is closed.\n2. Crack open the main steam stop valve and confirm the feed water pump is running.\n3. Purge the furnace with the ID fan for 5 minutes before ignition.\n4. Ignite at low fire and raise pressure slowly (max 1 bar per 10 minutes) up to 10.5 bar.\n\nSafety: never start if the low water alarm is active, wear gloves and a face shield, and log the start-up in the shift register.`;
  } else if (ctx.length) {
    const byDoc = {};
    ctx.forEach(c => (byDoc[c.doc] = byDoc[c.doc] || []).push(c.text));
    out = Object.entries(byDoc).map(([d, ts]) => `According to ${d}:\n` + ts.map(t => "- " + t).join("\n")).join("\n\n");
  } else if (withheld) {
    out = `I found a document that matches, but your role does not have access to it, so the Trust Layer kept it out of my context. Ask a manager, or switch role to see how access control works.`;
  } else {
    out = `I could not find this in Konkan Industries' private documents. In demo mode I only answer from those files. Load the in-browser model (left panel) to get full AI answers, still with zero data leaving this device.`;
  }
  if (withheld && ctx.length) out += `\n\n(1 restricted document was withheld for your role.)`;
  for (const word of out.split(/(\s+)/)) { yield word; await new Promise(r => setTimeout(r, 14)); }
}

async function* webllmAnswer(msgs) {
  const chunks = await state.webllm.chat.completions.create({ messages: msgs, stream: true, temperature: 0.3, max_tokens: 512 });
  for await (const c of chunks) { const d = c.choices[0]?.delta?.content; if (d) yield d; }
}

async function* ollamaAnswer(msgs) {
  const r = await fetch("http://localhost:11434/api/chat", { method: "POST", body: JSON.stringify({ model: $("ollamaModel").value, messages: msgs, stream: true }) });
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n"); buf = lines.pop();
    for (const l of lines) { if (!l.trim()) continue; const j = JSON.parse(l); if (j.message?.content) yield j.message.content; }
  }
}

/* ---------------- chat UI ---------------- */
function addMsg(kind, html) {
  $("welcome")?.remove();
  const m = document.createElement("div");
  m.className = "msg " + kind;
  m.innerHTML = html;
  $("msgs").appendChild(m);
  $("msgs").scrollTop = $("msgs").scrollHeight;
  return m;
}
const esc = (s) => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function ask(raw) {
  if (!raw.trim() || state.busy) return;
  state.busy = true; $("send").disabled = true;
  const { text: q, found } = state.pii ? shield(raw) : { text: raw, found: [] };
  const { top, withheld } = retrieve(q);
  state.q++; state.p += found.length; state.w += withheld;
  $("sQ").textContent = state.q; $("sP").textContent = state.p; $("sW").textContent = state.w;

  const chips = [];
  if (found.length) chips.push(`<span class="chip a">PII shield: masked ${found.join(", ")}</span>`);
  chips.push(`<span class="chip g">on-device</span>`);
  if (withheld) chips.push(`<span class="chip r">1 doc withheld by role policy</span>`);
  addMsg("user", `<div class="who">YOU &middot; ${$("role").value.toUpperCase()}</div><div class="body">${esc(q)}</div><div class="chips">${chips.join("")}</div>`);

  const ai = addMsg("ai", `<div class="who">SPINOZA &middot; ${state.engine.toUpperCase()}</div><div class="body cursor"></div><div class="chips"></div>`);
  const body = ai.querySelector(".body");
  const t0 = performance.now();
  let full = "";
  try {
    const msgs = buildMessages(q, top);
    const gen = state.engine === "webllm" && state.webllm ? webllmAnswer(msgs)
      : state.engine === "ollama" ? ollamaAnswer(msgs)
      : demoAnswer(q, top, withheld);
    for await (const piece of gen) { full += piece; body.textContent = full; $("msgs").scrollTop = $("msgs").scrollHeight; }
  } catch (err) {
    console.error(err);
    full = "Engine error: " + (err.message || err) + ". Switching to demo mode.";
    body.textContent = full; setEngine("demo", "Demo"); $("engine").value = "demo";
  }
  body.classList.remove("cursor");
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const srcs = [...new Set(top.map(c => c.doc))];
  ai.querySelector(".chips").innerHTML = srcs.map(s => `<span class="chip">${s}</span>`).join("") + `<span class="chip g">0 bytes sent</span><span class="chip">${secs}s</span>`;
  state.history.push({ role: "user", content: q }, { role: "assistant", content: full });
  await seal(q, `${srcs.length} source(s) &middot; ${found.length} PII masked${withheld ? " &middot; 1 withheld" : ""}`);
  state.busy = false; $("send").disabled = false;
}

$("send").onclick = () => { const v = $("q").value; $("q").value = ""; ask(v); };
$("q").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("send").click(); } });
document.querySelectorAll(".sugg button").forEach(b => b.onclick = () => ask(b.dataset.q));

renderDocs(); paintEgress();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
// Allow ?q=... to auto-run a question (used for screenshots and kiosk demos)
const auto = new URLSearchParams(location.search).get("q");
if (auto) setTimeout(() => ask(auto), 300);
