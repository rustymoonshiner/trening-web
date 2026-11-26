/* Trening – telefon. Dziennik jedzenia w telefonie; „Update” wysyła wpisy do programu Trening na komputerze
   przez domowe Wi-Fi (API: /api/ping, /api/catalog, /api/days, /api/entries). Dane trzymane w localStorage. */
"use strict";
const VERSION = "1.1";
// Android (Capacitor) łączy się zwykłym http na port 8765; iPhone (Safari, strona https) – https na port 8766
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const PORT_DEF = NATIVE ? 8765 : 8766;
const MEALS0 = ["Śniadanie", "Brunch", "Obiad", "Podwieczorek", "Kolacja", "Przekąski"];
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// ------------------------------------------------------------------ przechowywanie
const store = {
  get(k, d) { try { const v = localStorage.getItem("tr_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("tr_" + k, JSON.stringify(v)); } catch (e) { toast("Brak miejsca w pamięci telefonu"); } },
};
let cfg = store.get("cfg", { device: "", token: "", hosts: [], last: "" });
let catalog = store.get("catalog", { items: [], meals: MEALS0, made: "" });
let entries = store.get("entries", []);           // wpisy z telefonu
let days = store.get("days", {});                // migawki dni z komputera {data: {rows, kcal, goal, fetched}}
const save = () => { store.set("cfg", cfg); store.set("entries", entries); };

// ------------------------------------------------------------------ pomocnicze
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const fold = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ł/g, "l");
const num = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return isFinite(x) ? x : null; };
const r0 = (x) => Math.round(x || 0);
const meals = () => (catalog.meals && catalog.meals.length ? catalog.meals : MEALS0);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const DAYN = ["niedz.", "pon.", "wt.", "śr.", "czw.", "pt.", "sob."];
const MON = ["sty", "lut", "mar", "kwi", "maj", "cze", "lip", "sie", "wrz", "paź", "lis", "gru"];

function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hide");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add("hide"), ms);
}

/** Wartości dla ilości: produkt „g” – na 100 g, „porcja”/przepis – na porcję. */
function nutr(snap, amount) {
  const f = (snap.u === "g" || !snap.u) ? amount / 100 : amount;
  const v = (x) => (x == null ? null : x * f);
  return { k: (snap.k || 0) * f, p: (snap.p || 0) * f, f: (snap.f || 0) * f, c: (snap.c || 0) * f,
           su: v(snap.su), fi: v(snap.fi), sa: v(snap.sa) };
}

// ------------------------------------------------------------------ ciąża (laptop Sylwii w profilu „Ciąża”)
const LV_TXT = { nie: "odradzane w ciąży", uwaga: "uwaga w ciąży", info: "dobrze wiedzieć" };
let rulesC = null;
function pregRules() {      // reguły z programu (te same co w zakładce Sylwii) – dla skanów i ręcznych wpisów
  if (rulesC) return rulesC;
  rulesC = [];
  (catalog.rules || []).forEach(([pat, lvl, why]) => { try { rulesC.push([new RegExp(pat, "i"), lvl, why]); } catch (e) { /* */ } });
  return rulesC;
}
function pregCheck(it) {
  if (!catalog.preg) return null;
  if (it.lv) return { lv: it.lv, why: it.why || [] };
  if (!it.local) return { lv: "ok", why: [] };
  const name = (it.n || "") + " " + (it.b || "");
  const hits = pregRules().filter(([rx]) => rx.test(name));
  if (!hits.length) return { lv: "ok", why: [] };
  const order = { nie: 0, uwaga: 1, info: 2 };
  hits.sort((a, b) => order[a[1]] - order[b[1]]);
  return { lv: hits[0][1], why: hits.slice(0, 3).map((h) => h[2]) };
}
/** Insulinooporność: te same progi co w programie (ilość węglowodanów i cukrów w tej porcji). */
function irLevel(n) {
  if (!catalog.ir || n.c == null) return 0;
  const su = n.su || 0, fi = n.fi || 0;
  if (n.c > 60 || (su > 15 && fi < 4)) return 2;
  if (n.c > 45 || (su > 10 && fi < 3)) return 1;
  return 0;
}
const unitOf = (snap) => (snap.u === "g" || !snap.u) ? "g" : "porcji";

// ------------------------------------------------------------------ widoki
let curDate = today();
let addMeal = MEALS0[0];
function show(id) { $$(".view").forEach((v) => v.classList.toggle("on", v.id === id)); window.scrollTo(0, 0); }
$$("[data-back]").forEach((b) => b.addEventListener("click", () => { show("v-day"); renderDay(); }));

function dayLabel(d) {
  const t = today();
  if (d === t) return "Dziś";
  if (d === addDays(t, -1)) return "Wczoraj";
  if (d === addDays(t, 1)) return "Jutro";
  const x = new Date(d + "T12:00:00");
  return `${DAYN[x.getDay()]} ${x.getDate()} ${MON[x.getMonth()]}`;
}

/** Wiersze dnia: migawka z komputera (zawiera już wysłane wpisy) + wpisy z telefonu jeszcze nie wysłane. */
function dayRows(d) {
  const snap = days[d];
  const all = entries.filter((e) => e.date === d);
  const mine = all.filter((e) => !e.deleted);
  const rows = [];
  const pidToEntry = {};
  all.forEach((e) => { if (e.pid) pidToEntry[e.pid] = e; });
  if (snap) {
    snap.rows.forEach((r) => {
      const e = pidToEntry[r.pid];
      if (e && e.deleted) return;
      rows.push({ meal: r.meal, name: r.name, amount: r.amount, unit: r.unit, kcal: r.kcal, pc: !e, entry: e || null,
                  mac: null });
    });
  }
  mine.forEach((e) => {
    if (snap && e.pid && snap.rows.some((r) => r.pid === e.pid)) return;   // już w migawce
    const n = nutr(e.snap, e.amount);
    rows.push({ meal: e.meal, name: e.snap.n, amount: e.amount, unit: unitOf(e.snap), kcal: r0(n.k), entry: e,
                mac: n, pc: false });
  });
  return rows;
}

function renderDay() {
  $("#d-date").textContent = dayLabel(curDate);
  const rows = dayRows(curDate);
  const snap = days[curDate];
  let k = 0, p = 0, f = 0, c = 0;
  rows.forEach((r) => {
    k += r.kcal || 0;
    if (r.mac) { p += r.mac.p; f += r.mac.f; c += r.mac.c; }
  });
  if (snap) {   // makro z komputera dla wierszy z migawki
    const local = rows.filter((r) => r.mac);
    p = (snap.p || 0) + local.reduce((a, r) => a + r.mac.p, 0);
    f = (snap.f || 0) + local.reduce((a, r) => a + r.mac.f, 0);
    c = (snap.c || 0) + local.reduce((a, r) => a + r.mac.c, 0);
  }
  const goal = (snap && snap.goal) || cfg.goal || 0;
  $("#s-goal").textContent = goal ? r0(goal) : "–";
  $("#s-eaten").textContent = r0(k);
  $("#s-left").textContent = goal ? r0(goal - k) : "–";
  $("#s-mac").textContent = `B ${r0(p)} g · T ${r0(f)} g · W ${r0(c)} g`;
  const bar = $("#s-bar");
  bar.style.width = goal ? Math.min(100, (k / goal) * 100) + "%" : "0";
  bar.classList.toggle("over", goal && k > goal);

  const box = $("#meals"); box.innerHTML = "";
  meals().forEach((m) => {
    const mr = rows.filter((r) => r.meal === m);
    const sec = document.createElement("div"); sec.className = "meal";
    sec.innerHTML = `<h2>${esc(m)}<span>${mr.length ? r0(mr.reduce((a, r) => a + (r.kcal || 0), 0)) + " kcal" : ""}</span></h2>`;
    mr.forEach((r) => {
      const it = document.createElement("div"); it.className = "item" + (r.pc ? " pc" : "");
      let tag = "";
      if (r.entry && r.entry.error) tag = `<span class="tag err">${r.entry.unknown ? "uzupełnij" : "błąd"}</span>`;
      else if (r.entry && !r.entry.synced) tag = `<span class="tag wait">czeka</span>`;
      else if (r.pc) tag = `<span class="tag">komputer</span>`;
      it.innerHTML = `<div class="nm"><div>${esc(r.name)}</div><div class="muted small">${fmtAmount(r.amount, r.unit)} ${tag}</div></div>
                      <div class="kc">${r0(r.kcal)}</div>`;
      if (r.entry) it.addEventListener("click", () => openSheet({ entry: r.entry }));
      else it.addEventListener("click", () => toast("Ten wpis zmienisz w programie na komputerze"));
      sec.appendChild(it);
    });
    const add = document.createElement("button"); add.className = "add"; add.textContent = "DODAJ PRODUKT";
    add.addEventListener("click", () => openAdd(m));
    sec.appendChild(add);
    box.appendChild(sec);
  });
  const pend = entries.filter((e) => !e.synced).length;
  $("#pend").textContent = pend; $("#pend").classList.toggle("hide", !pend);
  $("#sync-info").textContent = cfg.token
    ? (cfg.lastSync ? `Ostatni Update: ${cfg.lastSync.replace("T", " ").slice(0, 16)} (${cfg.lastMachine || ""})` : "Jeszcze bez Update.")
    : "Najpierw sparuj telefon z programem: ⚙ Ustawienia.";
}
function fmtAmount(a, u) {
  const v = Math.round(a * 10) / 10;
  return u === "g" ? `${v} g` : `${v} ${v === 1 ? "porcja" : "porcji"}`;
}

$("#d-prev").addEventListener("click", () => { curDate = addDays(curDate, -1); renderDay(); });
$("#d-next").addEventListener("click", () => { curDate = addDays(curDate, 1); renderDay(); });
$("#d-date").addEventListener("click", () => { curDate = today(); renderDay(); });
$("#go-set").addEventListener("click", () => { fillSettings(); show("v-set"); });

// ------------------------------------------------------------------ wyszukiwanie
let tab = "recent";
function fillMealSelect(sel, val) {
  sel.innerHTML = meals().map((m) => `<option${m === val ? " selected" : ""}>${esc(m)}</option>`).join("");
}
function openAdd(meal) {
  addMeal = meal || guessMeal();
  fillMealSelect($("#a-meal"), addMeal);
  $("#q").value = ""; setTab("recent"); show("v-add");
}
$("#a-meal").addEventListener("change", (e) => { addMeal = e.target.value; });
function guessMeal() {
  const h = new Date().getHours();
  return h < 10 ? "Śniadanie" : h < 12 ? "Brunch" : h < 15 ? "Obiad" : h < 18 ? "Podwieczorek" : h < 21 ? "Kolacja" : "Przekąski";
}
function setTab(t) {
  tab = t; $$("#a-tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === t)); renderResults();
}
$$("#a-tabs button").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
$("#q").addEventListener("input", renderResults);

/** Własne produkty dodane w telefonie (jeszcze bez id z komputera) – też w wyszukiwarce. */
function localItems() {
  const seen = new Set(); const out = [];
  entries.slice().reverse().forEach((e) => {
    if (e.t === "f" && !e.id && e.snap && e.snap.n && !seen.has(e.snap.n)) { seen.add(e.snap.n); out.push({ ...e.snap, t: "f", local: true, a: e.amount }); }
  });
  return out;
}
function recentItems() {
  const map = new Map();
  entries.slice().reverse().forEach((e) => {
    const key = e.t + ":" + (e.id || e.snap.n);
    if (!map.has(key) && e.snap) map.set(key, { ...e.snap, t: e.t, id: e.id, a: e.amount, d: e.date });
  });
  catalog.items.filter((i) => i.d).sort((a, b) => (b.d > a.d ? 1 : -1)).slice(0, 60).forEach((i) => {
    const key = i.t + ":" + i.id; if (!map.has(key)) map.set(key, i);
  });
  return [...map.values()].slice(0, 60);
}
function search(q) {
  const words = fold(q).split(/\s+/).filter(Boolean);
  const pool = [...localItems(), ...catalog.items];
  const res = [];
  for (const it of pool) {
    const name = fold(it.n + " " + (it.b || ""));
    if (!words.every((w) => name.includes(w))) continue;
    let s = 0;
    if (name.startsWith(words[0])) s += 30;
    if (name.split(/\s+/).some((x) => x.startsWith(words[0]))) s += 10;
    s += Math.min(25, (it.x || 0) * 2) + (it.fav ? 15 : 0) + (it.d ? 10 : 0) + (it.t === "r" ? 3 : 0);
    if (it.s === "NEVO") s -= 5;
    res.push([s, it]);
  }
  return res.sort((a, b) => b[0] - a[0]).slice(0, 80).map((x) => x[1]);
}
function renderResults() {
  const q = $("#q").value.trim();
  let list;
  if (q) list = search(q);
  else if (tab === "fav") list = catalog.items.filter((i) => i.fav).sort((a, b) => (b.x || 0) - (a.x || 0));
  else if (tab === "recipes") list = catalog.items.filter((i) => i.t === "r").sort((a, b) => (b.x || 0) - (a.x || 0) || a.n.localeCompare(b.n, "pl"));
  else list = recentItems();
  const box = $("#results"); box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = `<div class="empty">${catalog.items.length ? (q ? "Nic nie znaleziono. Wpisz ręcznie albo zeskanuj kod." : "Pusto – zacznij od wyszukiwania.")
      : "Lista produktów pojawi się po pierwszym „Update” z komputerem.<br>Do tego czasu: wpisz ręcznie albo zeskanuj kod."}</div>`;
    return;
  }
  list.forEach((it) => {
    const row = document.createElement("div"); row.className = "res";
    const per = it.u === "g" || !it.u ? "100 g" : (it.t === "r" ? "porcja" : (it.pn || "porcja"));
    row.innerHTML = `<div class="nm"><div>${it.t === "r" ? "📖 " : ""}${esc(it.n)}</div>
        <div class="muted small">${esc(it.b || "")}${it.local ? " · z telefonu" : ""}</div></div>
      <div class="kc">${it.k != null ? r0(it.k) + " kcal" : "?"}<br>${per}</div><div class="plus">+</div>`;
    const pc = pregCheck(it);
    if (pc && pc.lv !== "ok") row.querySelector(".nm div:first-child").insertAdjacentHTML("beforeend",
      ` <span class="lv ${pc.lv}">${pc.lv === "info" ? "ⓘ" : LV_TXT[pc.lv]}</span>`);
    row.addEventListener("click", () => openSheet({ item: it }));
    box.appendChild(row);
  });
}

// ------------------------------------------------------------------ ilość (arkusz)
let sheet = null;
function openSheet(o) {
  const e = o.entry;
  const it = e ? { ...e.snap, t: e.t, id: e.id } : o.item;
  sheet = { item: it, entry: e || null, ean: o.ean || (e && e.ean) || "" };
  const u = unitOf(it);
  $("#m-name").textContent = (it.t === "r" ? "📖 " : "") + it.n;
  $("#m-info").textContent = it.k != null ? `${r0(it.k)} kcal na ${u === "g" ? "100 g" : "porcję"}` +
    (it.pg && u !== "g" ? ` (porcja ≈ ${r0(it.pg)} g)` : "") : "brak wartości – komputer uzupełni po kodzie";
  $("#m-unit").textContent = u;
  const pc = pregCheck(it), pb = $("#m-preg");
  if (pc) {
    pb.className = "pregbox " + pc.lv;
    pb.innerHTML = pc.lv === "ok" ? "✓ W ciąży bez zastrzeżeń"
      : `<b>${pc.lv === "nie" ? "✕ Odradzane w ciąży" : pc.lv === "uwaga" ? "⚠ Uwaga w ciąży" : "ⓘ Dobrze wiedzieć"}</b>` +
        `<ul>${pc.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>`;
  } else pb.className = "pregbox hide";
  const def = e ? e.amount : (it.a || (u === "g" ? (it.pg || 100) : 1));
  $("#m-amount").value = Math.round(def * 10) / 10;
  const chips = u === "g" ? [50, 100, 150, 200, 250] : [0.5, 1, 1.5, 2];
  if (u === "g" && it.pg && !chips.includes(r0(it.pg))) chips.unshift(r0(it.pg));
  $("#m-chips").innerHTML = chips.map((c) => `<button data-v="${c}">${c}${u === "g" ? " g" : ""}</button>`).join("");
  $$("#m-chips button").forEach((b) => b.addEventListener("click", () => { $("#m-amount").value = b.dataset.v; calcSheet(); }));
  fillMealSelect($("#m-meal"), e ? e.meal : addMeal);
  $("#m-ok").textContent = e ? "Zapisz" : "Dodaj";
  $("#m-del").classList.toggle("hide", !e);
  $("#sheet").classList.remove("hide");
  calcSheet();
}
function calcSheet() {
  const a = num($("#m-amount").value) || 0;
  const n = nutr(sheet.item, a);
  $("#m-kcal").textContent = sheet.item.k != null ? r0(n.k) : "?";
  $("#m-mac").textContent = sheet.item.k != null ? `B ${r0(n.p)} · T ${r0(n.f)} · W ${r0(n.c)}` : "";
  // szczegóły na tę ilość: cukry, błonnik, sól + ocena węglowodanów przy insulinooporności
  const det = [];
  if (sheet.item.k != null) {
    const ir = irLevel(n);
    det.push(`<span class="${ir === 2 ? "ir-hi" : ir === 1 ? "ir-mid" : ""}">węglowodany <b>${r0(n.c)} g</b></span>`);
    if (n.su != null) det.push(`cukry <b>${r0(n.su)} g</b>`);
    if (n.fi != null) det.push(`błonnik <b>${Math.round(n.fi * 10) / 10} g</b>`);
    if (n.sa != null) det.push(`sól <b>${Math.round(n.sa * 10) / 10} g</b>`);
    if (ir) det.push(`<br><span class="${ir === 2 ? "ir-hi" : "ir-mid"}">${ir === 2
      ? "dużo węglowodanów na raz – mniejsza porcja albo więcej warzyw/białka"
      : "umiarkowanie dużo węglowodanów"}</span>`);
  }
  $("#m-det").innerHTML = det.join(" · ").replace(" · <br>", "<br>");
}
$("#m-amount").addEventListener("input", calcSheet);
$("#m-minus").addEventListener("click", () => { const u = unitOf(sheet.item); const a = num($("#m-amount").value) || 0;
  $("#m-amount").value = Math.max(0, a - (u === "g" ? 10 : 0.5)); calcSheet(); });
$("#m-plus").addEventListener("click", () => { const u = unitOf(sheet.item); const a = num($("#m-amount").value) || 0;
  $("#m-amount").value = a + (u === "g" ? 10 : 0.5); calcSheet(); });
$("#m-cancel").addEventListener("click", () => { $("#sheet").classList.add("hide"); sheet = null; });
$("#sheet").addEventListener("click", (ev) => { if (ev.target.id === "sheet") $("#m-cancel").click(); });
$("#m-ok").addEventListener("click", () => {
  const a = num($("#m-amount").value);
  if (!a || a <= 0) { toast("Podaj ilość"); return; }
  const meal = $("#m-meal").value;
  if (sheet.entry) {
    const e = sheet.entry;
    if (e.synced) {        // zmiana wysłanego wpisu = usuń stary na komputerze + nowy wpis
      e.deleted = true; e.synced = false;
      entries.push(newEntry(e.snap, e.t, e.id, a, meal, e.date, e.ean));
    } else { e.amount = a; e.meal = meal; e.error = null; e.unknown = false; }
  } else {
    const it = sheet.item;
    const snap = { n: it.n, b: it.b || "", u: it.u || "g", pg: it.pg || null, pn: it.pn || null, k: it.k, p: it.p, f: it.f, c: it.c,
                   su: it.su ?? null, fi: it.fi ?? null, sa: it.sa ?? null, lv: it.lv, why: it.why, e: it.e || sheet.ean || "" };
    entries.push(newEntry(snap, it.t || "f", it.local ? null : it.id || null, a, meal, curDate, sheet.ean || it.e || ""));
    addMeal = meal;
  }
  save(); $("#sheet").classList.add("hide"); sheet = null;
  show("v-day"); renderDay(); toast("Dodano – wyślesz przyciskiem Update");
});
$("#m-del").addEventListener("click", () => {
  const e = sheet.entry;
  if (!confirm("Usunąć ten wpis?")) return;
  if (e.synced) { e.deleted = true; e.synced = false; }        // usunie też na komputerze przy Update
  else entries = entries.filter((x) => x !== e && !(x.uid === e.uid));
  save(); $("#sheet").classList.add("hide"); sheet = null; renderDay();
});
function newEntry(snap, t, id, amount, meal, date, ean) {
  return { uid: uid(), date, meal, t, id: id || null, amount, snap, ean: ean || "", created: new Date().toISOString(), synced: false };
}

// ------------------------------------------------------------------ ręczny wpis
$("#a-quick").addEventListener("click", () => openQuick({}));
function openQuick(pre) {
  $("#f-name").value = pre.name || ""; $("#f-ean").value = pre.ean || "";
  ["k", "p", "f", "c", "su", "fi", "sa", "pg"].forEach((k) => { $("#f-" + k).value = pre[k] ?? ""; });
  show("v-quick"); setTimeout(() => $(pre.name ? "#f-k" : "#f-name").focus(), 50);
}
$("#f-ok").addEventListener("click", () => {
  const n = $("#f-name").value.trim();
  const k = num($("#f-k").value);
  if (!n) { toast("Wpisz nazwę"); return; }
  if (k == null) { toast("Wpisz kcal na 100 g (z etykiety)"); return; }
  const it = { t: "f", local: true, n, u: "g", k, p: num($("#f-p").value) || 0, f: num($("#f-f").value) || 0,
               c: num($("#f-c").value) || 0, su: num($("#f-su").value), fi: num($("#f-fi").value), sa: num($("#f-sa").value),
               pg: num($("#f-pg").value), e: $("#f-ean").value.replace(/\D/g, "") };
  show("v-add"); openSheet({ item: it, ean: it.e });
});

// ------------------------------------------------------------------ kod kreskowy
let scanning = null;
$("#a-scan").addEventListener("click", startScan);
$("#a-scan2").addEventListener("click", startScan);
$("#scan-x").addEventListener("click", stopScan);
async function startScan() {
  $("#scan").classList.remove("hide"); $("#scan-msg").textContent = "Skieruj aparat na kod kreskowy";
  const video = $("#video");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } } });
    video.srcObject = stream; await video.play();
    scanning = { stream, stop: false };
    if ("BarcodeDetector" in window) {
      const det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] });
      const loop = async () => {
        if (!scanning || scanning.stop) return;
        try { const r = await det.detect(video); if (r.length) return gotCode(r[0].rawValue); } catch (e) { /* klatka */ }
        requestAnimationFrame(loop);
      };
      loop();
    } else if (window.ZXing) {
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.UPC_A, ZXing.BarcodeFormat.UPC_E]);
      const reader = new ZXing.BrowserMultiFormatReader(hints);
      scanning.reader = reader;
      reader.decodeFromVideoElementContinuously(video, (res) => { if (res && scanning && !scanning.stop) gotCode(res.getText()); });
    }
  } catch (e) {
    $("#scan-msg").textContent = "Brak dostępu do aparatu – zezwól w ustawieniach telefonu. Możesz wpisać cyfry ręcznie.";
    setTimeout(() => { stopScan(); const d = prompt("Cyfry spod kodu kreskowego:"); if (d) gotCode(d); }, 1800);
  }
}
function stopScan() {
  if (scanning) {
    scanning.stop = true;
    try { scanning.reader && scanning.reader.reset(); } catch (e) { /* */ }
    scanning.stream && scanning.stream.getTracks().forEach((t) => t.stop());
  }
  scanning = null; $("#scan").classList.add("hide");
}
async function gotCode(raw) {
  const ean = String(raw).replace(/\D/g, "");
  stopScan();
  if (navigator.vibrate) navigator.vibrate(60);
  if (ean.length < 8) { toast("Nieczytelny kod"); return; }
  const known = catalog.items.find((i) => i.e === ean) || localItems().find((i) => i.e === ean);
  if (known) { openSheet({ item: known, ean }); return; }
  toast("Szukam kodu " + ean + "…", 4000);
  const off = await offLookup(ean);
  if (off) { openSheet({ item: off, ean }); return; }
  // bez internetu albo nieznany: wpis z samym kodem – komputer sprawdzi go przy Update; albo wpisz z etykiety
  if (confirm(`Nie znam kodu ${ean}${navigator.onLine ? "" : " (brak internetu)"}.\n\nOK – wpiszę wartości z etykiety\nAnuluj – dodaj sam kod, komputer go sprawdzi`)) {
    openQuick({ ean });
  } else {
    openSheet({ item: { t: "f", local: true, n: "Produkt " + ean, u: "g", k: null, e: ean }, ean });
  }
}
async function offLookup(ean) {
  try {
    const r = await withTimeout(fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_pl,product_name_nl,brands,nutriments,serving_quantity`), 7000);
    const js = await r.json();
    if (js.status !== 1 || !js.product) return null;
    const p = js.product, n = p.nutriments || {};
    const k = n["energy-kcal_100g"] ?? (n["energy_100g"] != null ? n["energy_100g"] / 4.184 : null);
    if (k == null) return null;
    return { t: "f", local: true, n: p.product_name_pl || p.product_name || p.product_name_nl || ("Produkt " + ean),
             b: (p.brands || "").split(",")[0].trim(), u: "g", k: +k, p: +(n.proteins_100g || 0), f: +(n.fat_100g || 0),
             c: +(n.carbohydrates_100g || 0), su: num(n.sugars_100g), fi: num(n.fiber_100g), sa: num(n.salt_100g),
             pg: num(p.serving_quantity), e: ean };
  } catch (e) { return null; }
}

// ------------------------------------------------------------------ komunikacja z komputerem
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
}
async function api(host, path, body, ms = 8000) {
  const url = `${NATIVE ? "http" : "https"}://${host}${path}`;
  const opt = { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" } };
  if (cfg.token) opt.headers["X-Trening-Token"] = cfg.token;
  if (body) opt.body = JSON.stringify(body);
  const r = await withTimeout(fetch(url, opt), ms);
  let js = {};
  try { js = await r.json(); } catch (e) { /* */ }
  if (!r.ok) { const err = new Error(js.error || ("HTTP " + r.status)); err.status = r.status; throw err; }
  return js;
}
function hostList() {
  const list = [];
  if (cfg.last) list.push(cfg.last);
  (cfg.hosts || []).forEach((h) => {
    const port = NATIVE ? h.port : h.tls_port;
    if (!port) return;
    const a = `${h.ip}:${port}`; if (!list.includes(a)) list.push(a);
  });
  if (cfg.manual && !list.includes(cfg.manual)) list.push(cfg.manual);
  return list;
}
async function findHost() {
  const errors = [];
  for (const h of hostList()) {
    try { const js = await api(h, "/api/ping", null, 3500); return { host: h, ping: js }; }
    catch (e) { errors.push(e); if (e.status === 401) throw e; }
  }
  return null;
}

$("#b-sync").addEventListener("click", doSync);
async function doSync() {
  if (!cfg.token) { toast("Najpierw sparuj telefon: ⚙ Ustawienia"); fillSettings(); show("v-set"); return; }
  const btn = $("#b-sync"); btn.disabled = true; btn.firstChild.textContent = "⟳ Łączę… ";
  try {
    let found;
    try { found = await findHost(); }
    catch (e) { if (e.status === 401) { toast("Komputer nie zna już tego telefonu – sparuj ponownie", 4000); fillSettings(); show("v-set"); return; } throw e; }
    if (!found) { toast("Nie widzę komputera. Czy jesteś w domowym Wi-Fi i program Trening jest włączony?"
      + (NATIVE ? "" : " Na iPhonie: czy certyfikat programu jest zainstalowany i zaufany?"), 5000); return; }
    const { host, ping } = found;
    cfg.last = host; cfg.hosts = ping.hosts && ping.hosts.length ? ping.hosts : cfg.hosts;
    if (ping.meals) catalog.meals = ping.meals;
    btn.firstChild.textContent = "⟳ Wysyłam… ";
    // 1) wpisy (nowe, zmienione, usunięte)
    const pend = entries.filter((e) => !e.synced);
    let sent = 0, bad = 0;
    if (pend.length) {
      const res = await api(host, "/api/entries", { device: cfg.device, entries: pend.map((e) => e.deleted
        ? { uid: e.uid, deleted: true }
        : { uid: e.uid, date: e.date, meal: e.meal, t: e.t, id: e.id, amount: e.amount, ean: e.ean, snap: e.snap }) }, 60000);
      const by = {}; (res.results || []).forEach((r) => { by[r.uid] = r; });
      for (const e of pend) {
        const r = by[e.uid]; if (!r) continue;
        if (r.ok) {
          e.synced = true; e.error = null; e.unknown = false; sent++;
          if (r.pid) e.pid = r.pid;
          if (r.id && !e.deleted) { e.id = r.id; if (r.name && e.snap && !e.snap.k) e.snap.n = r.name; }
        } else { e.error = r.error || "błąd"; e.unknown = !!r.unknown; bad++; }
      }
      entries = entries.filter((e) => !(e.deleted && e.synced));
    }
    // 2) lista produktów
    btn.firstChild.textContent = "⟳ Pobieram… ";
    catalog = await api(host, "/api/catalog", null, 60000);
    store.set("catalog", catalog); rulesC = null;
    // 3) dni z komputera: ostatni tydzień + dni z wpisami
    const ds = new Set([today()]); for (let i = 1; i < 7; i++) ds.add(addDays(today(), -i));
    entries.forEach((e) => ds.add(e.date)); ds.add(curDate);
    const dl = [...ds].sort().reverse().slice(0, 14);
    try {
      const got = await api(host, "/api/days?dates=" + dl.join(","), null, 30000);
      Object.entries(got).forEach(([d, v]) => { v.fetched = new Date().toISOString(); days[d] = v; if (v.goal) cfg.goal = v.goal; });
    } catch (e) {                       // starszy program (v3.8) – tylko dziś, bez numerów wpisów
      try { const d1 = await api(host, "/api/day?date=" + today(), null, 15000); if (d1.goal) cfg.goal = d1.goal; } catch (e2) { /* */ }
    }
    // stare migawki precz
    Object.keys(days).forEach((d) => { if (d < addDays(today(), -30)) delete days[d]; });
    store.set("days", days);
    const n = new Date();
    cfg.lastSync = `${iso(n)} ${pad(n.getHours())}:${pad(n.getMinutes())}`; cfg.lastMachine = ping.machine;
    save();
    toast(`✓ ${ping.machine}: wysłano ${sent}${bad ? `, ${bad} do poprawy` : ""} · produktów: ${catalog.items.length}`, 4000);
  } catch (e) {
    toast("Update nieudany: " + (e.message === "timeout" ? "komputer nie odpowiada" : e.message), 4500);
  } finally {
    btn.disabled = false; btn.firstChild.textContent = "⟳ Update "; renderDay();
  }
}

// ------------------------------------------------------------------ ustawienia i parowanie
function fillSettings() {
  $("#p-host").value = cfg.manual || cfg.last || "";
  $("#p-dev").value = cfg.device || "";
  $("#p-pin").value = "";
  const st = $("#p-state");
  st.className = "note " + (cfg.token ? "ok" : "");
  st.textContent = cfg.token ? `Sparowany (${cfg.pairedWith || "komputer"}). Możesz sparować ponownie, jeśli trzeba.` : "Niesparowany.";
  $("#hosts").innerHTML = (cfg.hosts || []).length
    ? cfg.hosts.map((h) => `${esc(h.machine)} – ${esc(h.ip)}:${esc(NATIVE ? h.port : (h.tls_port || "brak https"))}`).join("<br>")
      + "<br>Update łączy się z tym, który jest włączony."
    : "Pojawią się po pierwszym Update.";
  const pend = entries.filter((e) => !e.synced).length;
  $("#stats").innerHTML = `Wpisów w telefonie: ${entries.length} (czeka na wysłanie: ${pend})<br>` +
    `Produktów i przepisów w wyszukiwarce: ${catalog.items.length}` + (catalog.made ? ` (lista z ${catalog.made.replace("T", " ").slice(0, 16)})` : "");
  $("#ver").textContent = "wersja " + VERSION;
}
$("#p-ok").addEventListener("click", async () => {
  let host = $("#p-host").value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (host && !host.includes(":")) host += ":" + PORT_DEF;
  const pin = $("#p-pin").value.replace(/\D/g, "");
  const dev = $("#p-dev").value.trim() || "Telefon";
  const st = $("#p-state");
  if (!host || pin.length !== 6) { st.className = "note bad"; st.textContent = "Wpisz adres komputera i 6 cyfr PIN-u."; return; }
  st.className = "note"; st.textContent = "Łączę z " + host + "…";
  try {
    const save_t = cfg.token; cfg.token = "";
    let js;
    try { js = await api(host, "/api/pair", { pin, device: dev }, 8000); }
    catch (e) { cfg.token = save_t; throw e; }
    cfg.token = js.token; cfg.device = dev; cfg.manual = host; cfg.last = host;
    cfg.hosts = js.hosts || []; cfg.pairedWith = js.machine;
    save();
    st.className = "note ok"; st.textContent = `✓ Sparowano z ${js.machine}. Teraz pierwszy Update…`;
    show("v-day"); doSync();
  } catch (e) {
    st.className = "note bad";
    const ip = host.split(":")[0];
    st.textContent = e.message === "timeout" || e.message.includes("Failed") || e.message.includes("fetch") || e.message.includes("Load failed")
      ? "Nie mogę połączyć się z " + host + ". Sprawdź Wi-Fi, adres i czy w programie włączony jest odbiór z telefonu."
        + (NATIVE ? "" : ` Na iPhonie potrzebny jest certyfikat programu: otwórz w Safari http://${ip}:${PORT_DEF - 1}/iphone`)
      : e.message;
  }
});
$("#p-clear").addEventListener("click", () => {
  const lim = addDays(today(), -14);
  const before = entries.length;
  entries = entries.filter((e) => !e.synced || e.date >= lim);
  save(); fillSettings(); toast(`Usunięto ${before - entries.length} starych wpisów (na komputerze zostają)`);
});

// ------------------------------------------------------------------ start
if (!cfg.device) cfg.device = NATIVE ? "Telefon" : "iPhone";
$("#p-host").placeholder = `192.168.1.20:${PORT_DEF}`;
if (!NATIVE && "serviceWorker" in navigator) {       // iPhone/Safari: działa bez internetu po dodaniu do ekranu
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
renderDay();
let openedOn = today();
document.addEventListener("visibilitychange", () => {   // aplikacja otwarta następnego dnia → pokaż nowy dzień
  if (document.hidden) return;
  if (today() !== openedOn) { if (curDate === openedOn) curDate = today(); openedOn = today(); }
  renderDay();
});
