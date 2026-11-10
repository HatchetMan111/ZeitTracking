(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const MINUTE = 60000;
  const DAY = 86400000;
  const SNAP = 5 * MINUTE;
  const PX_PER_HOUR = 56;

  const state = {
    date: null,
    dayStart: 0,
    dayEnd: 0,
    now: Date.now(),
    clockOffset: 0,
    tz: "Europe/Berlin",
    dayStartHour: 0,
    categories: [],
    entries: [],
    totalMinutes: 0,
    running: null,
    daysWithData: [],
    tab: "day",
    report: null,
    version: "1.0.0",
    authRequired: false,
    sheet: null,
  };

  const api = {
    async request(path, options = {}) {
      const response = await fetch(`/api${path}`, {
        credentials: "same-origin",
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        ...options,
      });
      if (response.status === 401 && state.authRequired) {
        showLogin();
        throw new Error("Nicht angemeldet");
      }
      const isJson = (response.headers.get("content-type") || "").includes("application/json");
      const payload = isJson ? await response.json() : null;
      if (!response.ok) {
        throw new Error((payload && payload.error) || `HTTP ${response.status}`);
      }
      return payload;
    },
    get(path) {
      return api.request(path);
    },
    post(path, body) {
      return api.request(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
    },
    patch(path, body) {
      return api.request(path, { method: "PATCH", body: JSON.stringify(body) });
    },
    put(path, body) {
      return api.request(path, { method: "PUT", body: JSON.stringify(body) });
    },
    del(path) {
      return api.request(path, { method: "DELETE" });
    },
  };

  const serverNow = () => Date.now() + state.clockOffset;

  const pad = (n) => String(n).padStart(2, "0");

  function fmtDuration(minutes) {
    const total = Math.max(0, Math.round(minutes));
    const h = Math.floor(total / 60);
    const m = total % 60;
    if (h === 0) return `${m}m`;
    return `${h}h ${pad(m)}m`;
  }

  function fmtElapsed(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
    return `${m}:${pad(s)}`;
  }

  function localDateStr(ms, timeZone) {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  }

  function fmtClock(ms) {
    return new Intl.DateTimeFormat("de-DE", {
      timeZone: state.tz,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(ms));
  }

  function wallInput(ms) {
    const text = new Intl.DateTimeFormat("sv-SE", {
      timeZone: state.tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(ms));
    return text.replace(" ", "T");
  }

  function shiftDate(dateStr, days) {
    const d = new Date(`${dateStr}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  function dayDiff(a, b) {
    const first = Date.parse(`${a}T00:00:00Z`);
    const second = Date.parse(`${b}T00:00:00Z`);
    return Math.round((first - second) / DAY);
  }

  function snap(ms) {
    return Math.round(ms / SNAP) * SNAP;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function categoryById(id) {
    return state.categories.find((cat) => cat.id === id) || { name: "Unbekannt", color: "#8E8E93", icon: "dot" };
  }

  let toastTimer = null;
  function showToast(text, actionLabel, action) {
    const toast = $("#toast");
    const label = $("#toastText");
    const button = $("#toastAction");
    label.textContent = text;
    button.hidden = !actionLabel;
    button.textContent = actionLabel || "";
    button.onclick = action
      ? async () => {
          hideToast();
          await action();
        }
      : null;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5200);
  }

  function hideToast() {
    $("#toast").hidden = true;
    clearTimeout(toastTimer);
  }

  function showLogin() {
    $("#login").hidden = false;
    setTimeout(() => $("#loginPassword").focus(), 50);
  }

  function hideLogin() {
    $("#login").hidden = true;
    $("#loginError").textContent = "";
  }

  function findEntry(id) {
    return state.entries.find((entry) => entry.id === id) || null;
  }

  function renderHeader() {
    const today = localDateStr(serverNow(), state.tz);
    const diff = dayDiff(state.date, today);
    let main;
    if (diff === 0) main = "Heute";
    else if (diff === 1) main = "Gestern";
    else if (diff === -1) main = "Morgen";
    else {
      const label = new Intl.DateTimeFormat("de-DE", {
        weekday: "long",
        timeZone: "UTC",
      }).format(new Date(`${state.date}T12:00:00Z`));
      main = label.charAt(0).toUpperCase() + label.slice(1);
    }
    const sub = new Intl.DateTimeFormat("de-DE", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(new Date(`${state.date}T12:00:00Z`));
    $("#dateMain").textContent = main;
    $("#dateSub").textContent = sub;
  }

  function renderDayStrip() {
    const strip = $("#dayStrip");
    strip.innerHTML = "";
    const today = localDateStr(serverNow(), state.tz);
    const dates = [];
    for (let offset = -3; offset <= 3; offset += 1) {
      dates.push(shiftDate(state.date, offset));
    }
    for (const dateStr of dates) {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "day-pill";
      pill.dataset.date = dateStr;
      if (dateStr === state.date) pill.classList.add("active");
      if (dateStr === today) pill.classList.add("today");
      if (state.daysWithData.includes(dateStr)) pill.classList.add("has-data");
      const dow = new Intl.DateTimeFormat("de-DE", {
        weekday: "short",
        timeZone: "UTC",
      }).format(new Date(`${dateStr}T12:00:00Z`));
      const dayNumber = dateStr.slice(8, 10).replace(/^0/, "");
      pill.innerHTML = `<span class="dow"></span><span class="dnum"></span><span class="dot"></span>`;
      pill.querySelector(".dow").textContent = dow.replace(".", "");
      pill.querySelector(".dnum").textContent = dayNumber;
      strip.appendChild(pill);
    }
    const active = strip.querySelector(".day-pill.active");
    if (active && strip.scrollWidth > strip.clientWidth) {
      strip.scrollLeft = active.offsetLeft - strip.clientWidth / 2 + active.clientWidth / 2;
    }
  }

  function renderHero() {
    $("#heroTotal").textContent = fmtDuration(state.totalMinutes);
    $("#heroLive").textContent = state.running ? "läuft" : "";
  }

  function renderTimers() {
    const row = $("#timerRow");
    row.innerHTML = "";
    for (const cat of state.categories) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "timer-chip";
      chip.dataset.id = cat.id;
      chip.style.setProperty("--c", cat.color);
      const running = state.running && state.running.category_id === cat.id;
      if (running) chip.classList.add("running");
      chip.innerHTML = `<span class="cat-dot"></span><span class="chip-name"></span><span class="chip-time"></span>`;
      chip.querySelector(".chip-name").textContent = cat.name;
      const time = chip.querySelector(".chip-time");
      if (running) {
        time.textContent = fmtElapsed(serverNow() - state.running.started_at);
        time.dataset.elapsedFor = String(state.running.id);
      }
      row.appendChild(chip);
    }
    $("#runningHint").textContent = state.running
      ? `${categoryById(state.running.category_id).name} läuft`
      : "";
  }

  function renderTimeline() {
    const inner = $("#timelineInner");
    const hourLayer = $("#hourLayer");
    const blocksLayer = $("#blocks");
    const dayLen = state.dayEnd - state.dayStart;
    const hours = Math.max(1, Math.ceil(dayLen / 3600000));
    inner.style.height = `${hours * PX_PER_HOUR}px`;
    hourLayer.innerHTML = "";
    blocksLayer.innerHTML = "";

    let tick = state.dayStart;
    while (tick < state.dayEnd) {
      const ratio = (tick - state.dayStart) / dayLen;
      const line = document.createElement("div");
      line.className = "hour-line";
      line.style.top = `${ratio * 100}%`;
      const label = document.createElement("span");
      label.className = "hour-label";
      label.textContent = fmtClock(tick);
      label.style.top = `${ratio * 100}%`;
      hourLayer.append(line, label);
      tick += 3600000;
    }

    const timelineEntries = state.entries
      .filter((entry) => entry.kind === "timeline")
      .map((entry) => {
        const start = Math.max(entry.started_at, state.dayStart);
        const end = Math.min(entry.effective_end, state.dayEnd);
        return { ...entry, viewStart: start, viewEnd: end };
      })
      .filter((entry) => entry.viewEnd > entry.viewStart);

    assignLanes(timelineEntries);

    for (const entry of timelineEntries) {
      const cat = categoryById(entry.category_id);
      const top = ((entry.viewStart - state.dayStart) / dayLen) * 100;
      const height = Math.max(((entry.viewEnd - entry.viewStart) / dayLen) * 100, 0.9);
      const block = document.createElement("div");
      block.className = "block";
      block.dataset.id = entry.id;
      block.tabIndex = 0;
      block.setAttribute("role", "button");
      block.style.setProperty("--c", cat.color);
      block.style.top = `${top}%`;
      block.style.height = `${height}%`;
      block.style.left = `${entry.laneLeft}%`;
      block.style.width = `${entry.laneWidth}%`;
      if (state.running && state.running.id === entry.id) block.classList.add("running");
      if ((height / 100) * (hours * PX_PER_HOUR) < 46) block.classList.add("compact");
      const label = entry.note ? `${cat.name} · ${entry.note}` : cat.name;
      block.innerHTML = `<div class="block-title"></div><div class="block-meta"></div>
        <div class="handle handle-top" data-edge="start"></div>
        <div class="handle handle-bottom" data-edge="end"></div>`;
      block.querySelector(".block-title").textContent = label;
      block.querySelector(".block-meta").textContent =
        `${fmtClock(entry.viewStart)}–${fmtClock(entry.viewEnd)} · ${fmtDuration((entry.viewEnd - entry.viewStart) / MINUTE)}`;
      blocksLayer.appendChild(block);
    }

    const empty = $("#timelineEmpty");
    empty.hidden = timelineEntries.length > 0 || state.entries.some((entry) => entry.kind === "duration");
    renderNowLine();
  }

  function assignLanes(items) {
    items.sort((a, b) => a.viewStart - b.viewStart || b.viewEnd - a.viewEnd);
    let cluster = [];
    let clusterEnd = -Infinity;
    let laneCount = 0;
    const flush = () => {
      const total = Math.max(1, laneCount);
      for (const item of cluster) {
        item.laneLeft = (item.lane / total) * 100;
        item.laneWidth = (100 / total) - 0.6;
      }
      cluster = [];
      laneCount = 0;
    };
    for (const item of items) {
      if (item.viewStart >= clusterEnd) {
        flush();
        clusterEnd = item.viewEnd;
      }
      const used = new Set(cluster.filter((c) => c.viewEnd > item.viewStart).map((c) => c.lane));
      let lane = 0;
      while (used.has(lane)) lane += 1;
      item.lane = lane;
      laneCount = Math.max(laneCount, lane + 1);
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.viewEnd);
    }
    flush();
  }

  function renderNowLine() {
    const now = serverNow();
    const today = localDateStr(now, state.tz);
    const line = $("#nowLine");
    if (today !== state.date || now < state.dayStart || now > state.dayEnd) {
      line.hidden = true;
      return;
    }
    const ratio = (now - state.dayStart) / (state.dayEnd - state.dayStart);
    line.style.top = `${ratio * 100}%`;
    line.hidden = false;
    $("#nowLabel").textContent = fmtClock(now);
  }

  function renderDurations() {
    const list = $("#durationList");
    list.innerHTML = "";
    const durations = state.entries.filter((entry) => entry.kind === "duration");
    for (const entry of durations) {
      const cat = categoryById(entry.category_id);
      const row = document.createElement("div");
      row.className = "duration-row";
      row.style.setProperty("--c", cat.color);
      row.innerHTML = `<span class="cat-dot"></span>
        <div class="dur-main"><div class="dur-name"></div><div class="dur-note"></div></div>
        <span class="dur-value"></span>
        <button type="button" aria-label="Löschen">×</button>`;
      row.querySelector(".dur-name").textContent = cat.name;
      row.querySelector(".dur-note").textContent = entry.note || "Nachgetragene Zeit";
      row.querySelector(".dur-value").textContent = fmtDuration(entry.minutes || 0);
      row.querySelector("button").addEventListener("click", () => deleteEntry(entry.id));
      row.dataset.id = entry.id;
      row.addEventListener("click", (event) => {
        if (event.target.tagName === "BUTTON") return;
        openSheet("edit-duration", entry);
      });
      list.appendChild(row);
    }
    if (durations.length === 0) {
      const hint = document.createElement("p");
      hint.className = "muted";
      hint.style.fontSize = "13px";
      hint.style.margin = "2px 4px";
      hint.textContent = "Keine nachgetragenen Zeiten.";
      list.appendChild(hint);
    }
  }

  function renderAll() {
    renderHeader();
    renderHero();
    renderDayStrip();
    renderTimers();
    renderTimeline();
    renderDurations();
    if (state.tab === "reports" && state.report) renderReport();
    if (state.tab === "settings") renderSettings();
  }

  async function loadState() {
    const data = await api.get("/state");
    state.now = data.now;
    state.clockOffset = data.now - Date.now();
    state.tz = data.timezone;
    state.dayStartHour = data.day_start_hour;
    state.categories = data.categories;
    state.running = data.running_entry;
    state.version = data.version;
    state.authRequired = data.auth_required;
    $("#appVersion").textContent = `v${data.version}`;
    $("#logoutBtn").hidden = !data.auth_required;
    $("#runningHint").textContent = state.running
      ? `${categoryById(state.running.category_id).name} läuft`
      : "";
  }

  async function loadDay(date) {
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const data = await api.get(`/day${query}`);
    state.date = data.date;
    state.dayStart = data.start_ms;
    state.dayEnd = data.end_ms;
    state.now = data.now;
    state.clockOffset = data.now - Date.now();
    state.entries = data.entries;
    state.totalMinutes = data.total_minutes;
    state.daysWithData = data.days_with_data;
    renderAll();
    scrollToNow();
  }

  function scrollToNow() {
    const timeline = $("#timeline");
    if (localDateStr(serverNow(), state.tz) !== state.date) return;
    const ratio = (serverNow() - state.dayStart) / (state.dayEnd - state.dayStart);
    if (ratio < 0 || ratio > 1) return;
    const target = ratio * $("#timelineInner").clientHeight - timeline.clientHeight * 0.38;
    timeline.scrollTop = Math.max(0, target);
  }

  async function refreshAll() {
    await loadState();
    const scrollTop = $("#timeline").scrollTop;
    await loadDay(state.date);
    $("#timeline").scrollTop = scrollTop;
  }

  function tick() {
    if (state.running) {
      const node = document.querySelector(`[data-elapsed-for="${state.running.id}"]`);
      if (node) node.textContent = fmtElapsed(serverNow() - state.running.started_at);
      $("#heroLive").textContent = `läuft ${fmtElapsed(serverNow() - state.running.started_at)}`;
    }
    renderNowLine();
  }

  async function startTimer(categoryId) {
    try {
      const result = await api.post(`/timers/${categoryId}/start`);
      await refreshAll();
      showToast(result.action === "stopped" ? "Timer gestoppt" : "Timer gestartet");
    } catch (error) {
      showToast(`Fehler: ${error.message}`);
    }
  }

  async function deleteEntry(id) {
    const entry = findEntry(id);
    if (entry && entry.kind === "timeline" && !window.confirm("Diesen Zeitblock löschen?")) return;
    const snapshot = entry
      ? {
          kind: entry.kind,
          category_id: entry.category_id,
          started_at: entry.started_at,
          ended_at: entry.effective_end,
          minutes: entry.minutes,
          note: entry.note || "",
        }
      : null;
    try {
      await api.del(`/entries/${id}`);
      await refreshAll();
      showToast(
        "Eintrag gelöscht",
        snapshot ? "Rückgängig" : null,
        snapshot
          ? async () => {
              try {
                if (snapshot.kind === "duration") {
                  await api.post("/entries/duration", {
                    category_id: snapshot.category_id,
                    date: localDateStr(snapshot.started_at, state.tz),
                    minutes: snapshot.minutes,
                    note: snapshot.note,
                  });
                } else {
                  await api.post("/entries", {
                    category_id: snapshot.category_id,
                    started_at: snapshot.started_at,
                    ended_at: snapshot.ended_at,
                    note: snapshot.note,
                  });
                }
                await refreshAll();
                showToast("Wiederhergestellt");
              } catch (error) {
                showToast(`Fehler: ${error.message}`);
              }
            }
          : null
      );
    } catch (error) {
      showToast(`Fehler: ${error.message}`);
    }
  }

  let suppressClickUntil = 0;
  let dragState = null;

  function beginDrag(event, block, edge) {
    const entry = findEntry(Number(block.dataset.id));
    if (!entry) return;
    event.preventDefault();
    event.stopPropagation();
    const inner = $("#timelineInner");
    const dayLen = state.dayEnd - state.dayStart;
    const pxPerMs = inner.clientHeight / dayLen;
    const rectTop = inner.getBoundingClientRect().top;
    dragState = {
      entry,
      edge,
      block,
      inner,
      rectTop,
      dayLen,
      pxPerMs,
      startY: event.clientY,
      origStart: entry.started_at,
      origEnd: entry.effective_end,
      newStart: entry.started_at,
      newEnd: entry.effective_end,
      moved: false,
    };
    block.classList.add("dragging");
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd, { once: true });
    window.addEventListener("pointercancel", onDragEnd, { once: true });
  }

  function onDragMove(event) {
    if (!dragState) return;
    const { edge, block, dayLen, startY, origStart, origEnd } = dragState;
    const rawDelta = (event.clientY - startY) / dragState.pxPerMs;
    let newStart = origStart;
    let newEnd = origEnd;
    const minDur = 5 * MINUTE;
    if (edge === "start") {
      newStart = clamp(snap(origStart + rawDelta), state.dayStart, origEnd - minDur);
    } else {
      newEnd = clamp(snap(origEnd + rawDelta), origStart + minDur, state.dayEnd);
    }
    dragState.newStart = newStart;
    dragState.newEnd = newEnd;
    if (Math.abs(event.clientY - startY) > 2) dragState.moved = true;
    const top = ((newStart - state.dayStart) / dayLen) * 100;
    const height = ((newEnd - newStart) / dayLen) * 100;
    block.style.top = `${top}%`;
    block.style.height = `${height}%`;
    block.querySelector(".block-meta").textContent =
      `${fmtClock(newStart)}–${fmtClock(newEnd)} · ${fmtDuration((newEnd - newStart) / MINUTE)}`;
  }

  async function onDragEnd() {
    window.removeEventListener("pointermove", onDragMove);
    const drag = dragState;
    dragState = null;
    if (!drag) return;
    drag.block.classList.remove("dragging");
    if (!drag.moved) return;
    suppressClickUntil = Date.now() + 400;
    const previous = { started_at: drag.origStart, ended_at: drag.origEnd };
    try {
      await api.patch(`/entries/${drag.entry.id}`, {
        started_at: drag.newStart,
        ended_at: drag.newEnd,
      });
      await refreshAll();
      showToast("Zeitblock angepasst", "Rückgängig", async () => {
        await api.patch(`/entries/${drag.entry.id}`, previous);
        await refreshAll();
      });
    } catch (error) {
      showToast(`Fehler: ${error.message}`);
      await refreshAll();
    }
  }

  function openSheet(mode, entry = null, defaults = {}) {
    state.sheet = { mode, entryId: entry ? entry.id : null };
    const sheet = $("#sheet");
    const select = $("#entryCategory");
    select.innerHTML = "";
    const cats = [...state.categories];
    if (entry && !cats.some((cat) => cat.id === entry.category_id)) {
      const cat = categoryById(entry.category_id);
      cats.push({ ...cat, id: entry.category_id });
    }
    for (const cat of cats) {
      const option = document.createElement("option");
      option.value = String(cat.id);
      option.textContent = cat.name;
      select.appendChild(option);
    }

    const isDuration = mode.endsWith("duration");
    $("#minutesWrap").hidden = !isDuration;
    $("#dateWrap").hidden = !isDuration;
    $("#startWrap").hidden = isDuration;
    $("#endWrap").hidden = isDuration;
    $("#entryDelete").hidden = !entry;

    if (isDuration) {
      $("#sheetTitle").textContent = mode === "edit-duration" ? "Dauer bearbeiten" : "Dauer nachtragen";
      if (entry) {
        select.value = String(entry.category_id);
        $("#entryDate").value = localDateStr(entry.started_at, state.tz);
        $("#entryMinutes").value = entry.minutes || 30;
        $("#entryNote").value = entry.note || "";
      } else {
        select.value = String(defaults.categoryId || state.categories[0]?.id || "");
        $("#entryDate").value = defaults.date || state.date;
        $("#entryMinutes").value = 30;
        $("#entryNote").value = "";
      }
    } else {
      $("#sheetTitle").textContent = mode === "edit-timeline" ? "Zeitblock bearbeiten" : "Zeitblock";
      if (entry) {
        select.value = String(entry.category_id);
        $("#entryStart").value = wallInput(entry.started_at);
        $("#entryEnd").value = wallInput(entry.effective_end);
        $("#entryNote").value = entry.note || "";
      } else {
        select.value = String(defaults.categoryId || state.categories[0]?.id || "");
        $("#entryStart").value = wallInput(defaults.start ?? state.dayStart + 9 * 3600000);
        $("#entryEnd").value = wallInput(defaults.end ?? (defaults.start ?? state.dayStart + 9 * 3600000) + 30 * MINUTE);
        $("#entryNote").value = "";
      }
    }

    $("#sheetBackdrop").hidden = false;
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
  }

  function closeSheet() {
    state.sheet = null;
    $("#sheet").hidden = true;
    $("#sheetBackdrop").hidden = true;
  }

  async function submitSheet(event) {
    event.preventDefault();
    const mode = state.sheet?.mode;
    if (!mode) return;
    const categoryId = Number($("#entryCategory").value);
    const note = $("#entryNote").value;
    const body = { category_id: categoryId, note };
    try {
      if (mode === "edit-timeline" || mode === "new-timeline") {
        body.started_at = $("#entryStart").value;
        body.ended_at = $("#entryEnd").value;
        if (!body.started_at || !body.ended_at) throw new Error("Start und Ende sind erforderlich");
        if (new Date(body.ended_at) <= new Date(body.started_at)) throw new Error("Ende muss nach dem Start liegen");
      } else {
        body.date = $("#entryDate").value;
        body.minutes = Number($("#entryMinutes").value);
        if (!body.date) throw new Error("Datum ist erforderlich");
        if (!(body.minutes >= 1)) throw new Error("Dauer muss mindestens 1 Minute sein");
      }

      if (mode === "new-timeline") await api.post("/entries", body);
      else if (mode === "new-duration") await api.post("/entries/duration", body);
      else if (mode === "edit-timeline") await api.patch(`/entries/${state.sheet.entryId}`, body);
      else if (mode === "edit-duration") await api.patch(`/entries/${state.sheet.entryId}`, body);

      closeSheet();
      await refreshAll();
      showToast("Gespeichert");
    } catch (error) {
      showToast(`Fehler: ${error.message}`);
    }
  }

  function switchTab(tab) {
    state.tab = tab;
    $$(".tab").forEach((button) => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    $$(".panel").forEach((panel) => {
      panel.classList.toggle("active", panel.id === `panel-${tab}`);
    });
    if (tab === "reports") loadReport();
    if (tab === "settings") renderSettings();
  }

  async function loadReport() {
    const from = $("#reportFrom").value;
    const to = $("#reportTo").value;
    if (!from || !to) return;
    try {
      state.report = await api.get(`/stats?from=${from}&to=${to}`);
      renderReport();
    } catch (error) {
      showToast(`Fehler: ${error.message}`);
    }
  }

  function renderReport() {
    const report = state.report;
    if (!report) return;
    $("#reportTotal").textContent = fmtDuration(report.total_minutes);
    $("#reportRangeLabel").textContent = `${report.from.split("-").reverse().join(".")} – ${report.to
      .split("-")
      .reverse()
      .join(".")}`;
    const bars = $("#reportBars");
    bars.innerHTML = "";
    const max = Math.max(1, ...report.rows.map((row) => row.minutes));
    for (const row of report.rows) {
      const wrapper = document.createElement("div");
      wrapper.className = "bar-row";
      wrapper.innerHTML = `<div class="bar-head"><span class="bar-label"></span><span class="bar-value"></span></div>
        <div class="bar-track"><div class="bar-fill"></div></div>`;
      wrapper.querySelector(".bar-label").textContent = row.label;
      wrapper.querySelector(".bar-value").textContent = fmtDuration(row.minutes);
      const fill = wrapper.querySelector(".bar-fill");
      fill.style.setProperty("--c", row.color);
      fill.style.width = `${(row.minutes / max) * 100}%`;
      bars.appendChild(wrapper);
    }
    if (report.rows.length === 0) {
      bars.innerHTML = '<p class="muted" style="font-size:13px">Keine Daten im gewählten Zeitraum.</p>';
    }

    const days = $("#reportDays");
    days.innerHTML = "";
    const maxDay = Math.max(1, ...report.days.map((day) => day.minutes));
    for (const day of [...report.days].reverse()) {
      const row = document.createElement("div");
      row.className = "day-bar-row";
      const label = new Intl.DateTimeFormat("de-DE", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      }).format(new Date(`${day.date}T12:00:00Z`));
      row.innerHTML = `<span></span><div class="day-track"><div class="day-fill"></div></div><span class="day-value"></span>`;
      row.querySelector("span").textContent = label;
      row.querySelector(".day-fill").style.width = `${(day.minutes / maxDay) * 100}%`;
      row.querySelector(".day-value").textContent = day.minutes ? fmtDuration(day.minutes) : "–";
      days.appendChild(row);
    }
  }

  function renderSettings() {
    const select = $("#dayStartHour");
    if (select.options.length === 0) {
      for (let hour = 0; hour < 24; hour += 1) {
        const option = document.createElement("option");
        option.value = String(hour);
        option.textContent = `${pad(hour)}:00`;
        select.appendChild(option);
      }
    }
    select.value = String(state.dayStartHour);
    $("#timezone").value = state.tz;
    renderCategories();
  }

  function renderCategories() {
    const list = $("#catList");
    list.innerHTML = "";
    for (const cat of state.categories) {
      const row = document.createElement("div");
      row.className = "cat-row";
      row.dataset.id = cat.id;
      row.innerHTML = `<input type="color" value="${cat.color}" aria-label="Farbe">
        <input type="text" value="" maxlength="40" aria-label="Name">
        <input type="number" value="${cat.goal_minutes_week || 0}" min="0" step="30" aria-label="Wochenziel in Minuten">
        <button type="button" class="cat-archive" title="Archivieren" aria-label="Archivieren">×</button>`;
      row.querySelector('input[type="text"]').value = cat.name;
      row.querySelector('input[type="color"]').addEventListener("change", (event) => {
        updateCategory(cat.id, { color: event.target.value });
      });
      const nameInput = row.querySelector('input[type="text"]');
      nameInput.addEventListener("change", () => {
        if (nameInput.value.trim()) updateCategory(cat.id, { name: nameInput.value.trim() });
      });
      row.querySelector('input[type="number"]').addEventListener("change", (event) => {
        updateCategory(cat.id, { goal_minutes_week: Number(event.target.value) || 0 });
      });
      row.querySelector(".cat-archive").addEventListener("click", () => archiveCategory(cat.id));
      list.appendChild(row);
    }
  }

  async function updateCategory(id, body) {
    try {
      await api.patch(`/categories/${id}`, body);
      await loadState();
      renderAll();
      showToast("Kategorie gespeichert");
    } catch (error) {
      showToast(`Fehler: ${error.message}`);
    }
  }

  async function archiveCategory(id) {
    if (!window.confirm("Kategorie archivieren? Einträge bleiben erhalten.")) return;
    try {
      await api.del(`/categories/${id}`);
      await refreshAll();
      renderSettings();
      showToast("Kategorie archiviert");
    } catch (error) {
      showToast(`Fehler: ${error.message}`);
    }
  }

  function bindEvents() {
    $("#prevDay").addEventListener("click", () => loadDay(shiftDate(state.date, -1)));
    $("#nextDay").addEventListener("click", () => loadDay(shiftDate(state.date, 1)));
    $("#todayBtn").addEventListener("click", () => loadDay(null));

    $("#dayStrip").addEventListener("click", (event) => {
      const pill = event.target.closest(".day-pill");
      if (pill) loadDay(pill.dataset.date);
    });

    $("#timerRow").addEventListener("click", (event) => {
      const chip = event.target.closest(".timer-chip");
      if (chip) startTimer(Number(chip.dataset.id));
    });

    $("#blocks").addEventListener("pointerdown", (event) => {
      const handle = event.target.closest(".handle");
      if (!handle) return;
      beginDrag(event, handle.closest(".block"), handle.dataset.edge);
    });

    $("#blocks").addEventListener("click", (event) => {
      if (Date.now() < suppressClickUntil) return;
      const block = event.target.closest(".block");
      if (!block) return;
      const entry = findEntry(Number(block.dataset.id));
      if (entry) openSheet("edit-timeline", entry);
    });

    $("#blocks").addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const block = event.target.closest(".block");
      if (!block) return;
      event.preventDefault();
      const entry = findEntry(Number(block.dataset.id));
      if (entry) openSheet("edit-timeline", entry);
    });

    $("#timelineInner").addEventListener("click", (event) => {
      if (Date.now() < suppressClickUntil) return;
      if (event.target.closest(".block")) return;
      const inner = $("#timelineInner");
      const rect = inner.getBoundingClientRect();
      const ratio = clamp((event.clientY - rect.top) / rect.height, 0, 1);
      const start = clamp(snap(state.dayStart + ratio * (state.dayEnd - state.dayStart)), state.dayStart, state.dayEnd - 30 * MINUTE);
      openSheet("new-timeline", null, { start, end: start + 30 * MINUTE });
    });

    $("#addBlock").addEventListener("click", () => {
      const start = localDateStr(serverNow(), state.tz) === state.date ? snap(serverNow()) : state.dayStart + 9 * 3600000;
      openSheet("new-timeline", null, { start, end: start + 30 * MINUTE });
    });

    $("#addDuration").addEventListener("click", () => openSheet("new-duration", null, { date: state.date }));

    $("#entryForm").addEventListener("submit", submitSheet);
    $("#entryDelete").addEventListener("click", async () => {
      if (!state.sheet?.entryId) return;
      await deleteEntry(state.sheet.entryId);
      closeSheet();
    });
    $("#sheetBackdrop").addEventListener("click", closeSheet);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && state.sheet) closeSheet();
    });

    $$(".tab").forEach((button) => button.addEventListener("click", () => switchTab(button.dataset.tab)));

    $$(".preset-row .chip-btn").forEach((button) => {
      button.addEventListener("click", () => {
        $$(".preset-row .chip-btn").forEach((other) => other.classList.remove("active"));
        button.classList.add("active");
        const today = localDateStr(serverNow(), state.tz);
        const range = button.dataset.range;
        if (range === "today") {
          $("#reportFrom").value = today;
          $("#reportTo").value = today;
        } else if (range === "week") {
          $("#reportFrom").value = shiftDate(today, -6);
          $("#reportTo").value = today;
        } else {
          $("#reportFrom").value = shiftDate(today, -29);
          $("#reportTo").value = today;
        }
        loadReport();
      });
    });

    $("#reportRun").addEventListener("click", loadReport);
    $("#exportCsv").addEventListener("click", () => {
      const from = $("#reportFrom").value;
      const to = $("#reportTo").value;
      window.location.href = `/api/export.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    });

    $("#settingsForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        await api.put("/settings", {
          day_start_hour: Number($("#dayStartHour").value),
          timezone: $("#timezone").value.trim(),
        });
        await loadState();
        await loadDay(state.date);
        showToast("Einstellungen gespeichert");
      } catch (error) {
        showToast(`Fehler: ${error.message}`);
      }
    });

    $("#addCategory").addEventListener("click", () => {
      const box = $("#catNew");
      box.hidden = !box.hidden;
      if (!box.hidden) $("#catNewName").focus();
    });

    $("#catNewSave").addEventListener("click", async () => {
      const name = $("#catNewName").value.trim();
      if (!name) return;
      try {
        await api.post("/categories", { name, color: $("#catNewColor").value });
        $("#catNewName").value = "";
        $("#catNew").hidden = true;
        await loadState();
        renderAll();
        showToast("Kategorie angelegt");
      } catch (error) {
        showToast(`Fehler: ${error.message}`);
      }
    });

    $("#logoutBtn").addEventListener("click", async () => {
      await api.post("/logout");
      state.authRequired = true;
      showLogin();
    });

    $("#loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("#loginError").textContent = "";
      try {
        await api.post("/login", { password: $("#loginPassword").value });
        hideLogin();
        await boot();
      } catch (error) {
        $("#loginError").textContent = error.message;
      }
    });
  }

  async function silentSync() {
    if (document.hidden || !$("#sheet").hidden) return;
    try {
      const previousRunning = state.running ? state.running.id : null;
      const data = await api.get("/state");
      state.now = data.now;
      state.clockOffset = data.now - Date.now();
      state.categories = data.categories;
      state.running = data.running_entry;
      state.tz = data.timezone;
      state.dayStartHour = data.day_start_hour;
      const nextRunning = state.running ? state.running.id : null;
      if (previousRunning !== nextRunning) {
        await loadDay(state.date);
      } else {
        renderTimers();
        renderHero();
      }
    } catch (error) {
      if (state.authRequired) showLogin();
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (!(location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
      return;
    }
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  async function boot() {
    try {
      const auth = await api.get("/auth/status");
      state.authRequired = auth.required;
      if (auth.required && !auth.authenticated) {
        showLogin();
        return;
      }
      hideLogin();
      await loadState();
      if (!state.date) state.date = localDateStr(serverNow(), state.tz);
      const today = localDateStr(serverNow(), state.tz);
      $("#reportFrom").value = shiftDate(today, -6);
      $("#reportTo").value = today;
      await loadDay(state.date);
    } catch (error) {
      showToast(`Startfehler: ${error.message}`);
    }
  }

  function init() {
    bindEvents();
    boot();
    setInterval(tick, 1000);
    setInterval(silentSync, 30000);
    registerServiceWorker();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
