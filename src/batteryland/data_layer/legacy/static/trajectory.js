"use strict";

window.TrajectoryOverview = (() => {
  const SITE = window.BatteryLifeConfig;
  const $ = (id) => document.getElementById(id);
  const keyOf = (cell) => `${cell.source}\u0000${cell.name}`;
  const fmt = (number) => Number(number).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
  const fmtCycle = (number) => Math.round(number).toLocaleString("zh-CN");
  const state = { cells: [], filtered: [], records: new Map(), ranks: new Map(), revision: "",
    cursor: 0, processed: 0, total: 0, drawable: 0, skipped: 0, failed: 0, running: false,
    maxCycle: null, hover: null, chart: null, timer: null, initialized: false };

  function buildRanks() {
    const bySource = new Map();
    for (const cell of state.cells) {
      if (!Number.isFinite(cell.label)) continue;
      if (!bySource.has(cell.source)) bySource.set(cell.source, []);
      bySource.get(cell.source).push(cell);
    }
    for (const cells of bySource.values()) {
      cells.sort((a, b) => a.label - b.label || a.name.localeCompare(b.name));
      cells.forEach((cell, index) => state.ranks.set(keyOf(cell), cells.length === 1 ? 0.5 : index / (cells.length - 1)));
    }
  }

  function groupOf(cell) { return String(cell[$("trajectoryGroup").value] ?? "未提供"); }

  function colorOf(cell, groups) {
    const index = groups.indexOf(groupOf(cell));
    const hue = SITE.chartColors.trajectoryHues[index % SITE.chartColors.trajectoryHues.length];
    const rank = state.ranks.get(keyOf(cell));
    const lightness = rank == null ? 48 : 61 - rank * 25;
    return `hsl(${hue} 62% ${lightness}%)`;
  }

  function segmentsOf(points) {
    const segments = [], current = [];
    for (const point of points || []) {
      if (point && Number.isFinite(point[0]) && Number.isFinite(point[1])) current.push(point);
      else if (current.length) segments.push(current.splice(0));
    }
    if (current.length) segments.push(current);
    return segments;
  }

  function visibleSeries() {
    return state.filtered.flatMap((cell) => {
      const record = state.records.get(keyOf(cell));
      return record?.status === "drawable" ? [{ cell, segments: record.segments }] : [];
    });
  }

  function updateProgress() {
    const visible = visibleSeries().length;
    $("trajectoryProgress").textContent =
      `当前筛选已绘制 ${fmt(visible)} / ${fmt(state.filtered.length)} 块；全库已处理 ${fmt(state.processed)} / ${fmt(state.total || state.cells.length)} 块，可绘制 ${fmt(state.drawable)} 块，无法绘制 ${fmt(state.skipped)} 块，读取失败 ${fmt(state.failed)} 块${state.running ? "，后台生成中…" : "。"}`;
    const issues = state.filtered.flatMap((cell) => {
      const record = state.records.get(keyOf(cell));
      return record && record.status !== "drawable" ? [`${cell.source} / ${cell.name}：${record.reason}`] : [];
    });
    $("trajectoryIssues").hidden = !issues.length;
    $("trajectoryIssuesTitle").textContent = `未绘制 ${fmt(issues.length)} 块（展开查看）`;
    $("trajectoryIssueList").replaceChildren(...issues.map((message) => {
      const item = document.createElement("li"); item.textContent = message; return item;
    }));
  }

  function renderLegend(series, groups) {
    const legend = $("trajectoryLegend"); legend.replaceChildren();
    for (const group of groups) {
      const cells = series.filter((item) => groupOf(item.cell) === group);
      const entry = document.createElement("span"), swatch = document.createElement("i");
      swatch.style.background = `hsl(${SITE.chartColors.trajectoryHues[groups.indexOf(group) % SITE.chartColors.trajectoryHues.length]} 62% 48%)`;
      entry.append(swatch, document.createTextNode(`${group} ${fmt(cells.length)}`));
      legend.append(entry);
    }
    if (series.some((item) => item.cell.label == null)) {
      const note = document.createElement("span"); note.textContent = "虚线：无寿命标签"; legend.append(note);
    }
  }

  function draw() {
    const canvas = $("trajectoryCanvas"), frame = $("trajectoryFrame");
    const width = frame.clientWidth, height = frame.clientHeight;
    if (!width || !height) return;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const series = visibleSeries();
    const groups = [...new Set(series.map((item) => groupOf(item.cell)))].sort((a, b) => a.localeCompare(b, "zh-CN"));
    renderLegend(series, groups);
    state.chart = null;
    if (!series.length) {
      ctx.fillStyle = SITE.chartColors.axis;
      ctx.font = "16px system-ui"; ctx.textAlign = "center";
      ctx.fillText(state.processed ? "当前筛选范围暂无可绘制曲线" : "正在准备曲线…", width / 2, height / 2);
      return;
    }
    const left = 72, right = 22, top = 22, bottom = 58;
    const pw = width - left - right, ph = height - top - bottom;
    const fullMax = Math.max(...series.flatMap((item) => item.segments.map((part) => part.at(-1)[0])));
    const xMax = state.maxCycle ?? fullMax;
    let low = Infinity, high = -Infinity;
    for (const item of series) for (const part of item.segments) for (const point of part) {
      if (point[0] > xMax) continue;
      low = Math.min(low, point[1]); high = Math.max(high, point[1]);
    }
    if (!Number.isFinite(low)) {
      ctx.fillStyle = SITE.chartColors.axis; ctx.font = "16px system-ui"; ctx.textAlign = "center";
      ctx.fillText("所选 Cycle 范围内没有容量点", width / 2, height / 2);
      return;
    }
    const pad = Math.max((high - low) * .09, 2), yMin = Math.max(0, low - pad), yMax = high + pad;
    const px = (x) => left + x / xMax * pw;
    const py = (y) => top + (yMax - y) / (yMax - yMin) * ph;
    ctx.strokeStyle = SITE.chartColors.grid; ctx.fillStyle = SITE.chartColors.axis;
    ctx.lineWidth = 1; ctx.font = "14px system-ui";
    for (let i = 0; i <= 5; i++) {
      const y = top + i * ph / 5;
      ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(width - right, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(fmt(yMax - i * (yMax - yMin) / 5), left - 9, y + 4);
      const x = left + i * pw / 5;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + ph); ctx.stroke();
      ctx.textAlign = "center"; ctx.fillText(fmtCycle(i * xMax / 5), x, top + ph + 23);
    }
    ctx.font = "15px system-ui";
    ctx.fillText("实际 Cycle 编号", left + pw / 2, height - 9);
    ctx.save(); ctx.translate(17, top + ph / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("相对首个有效放电容量 %", 0, 0); ctx.restore();
    const ordered = state.hover ? [...series.filter((item) => keyOf(item.cell) !== state.hover.key),
      ...series.filter((item) => keyOf(item.cell) === state.hover.key)] : series;
    for (const item of ordered) {
      const active = state.hover?.key === keyOf(item.cell);
      ctx.globalAlpha = state.hover ? active ? 1 : .08 : .29;
      ctx.strokeStyle = colorOf(item.cell, groups);
      ctx.lineWidth = active ? 3 : 1.3;
      ctx.setLineDash(item.cell.label == null ? [5, 4] : []);
      for (const part of item.segments) {
        ctx.beginPath(); let started = false;
        for (const [x, y] of part) {
          if (x > xMax) break;
          if (!started) { ctx.moveTo(px(x), py(y)); started = true; }
          else ctx.lineTo(px(x), py(y));
        }
        if (started && part.length === 1) {
          ctx.fillStyle = ctx.strokeStyle;
          ctx.beginPath(); ctx.arc(px(part[0][0]), py(part[0][1]), 2, 0, Math.PI * 2); ctx.fill();
        } else if (started) ctx.stroke();
      }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);
    state.chart = { series, left, top, pw, ph, xMax, px, py };
  }

  function hover(event) {
    const chart = state.chart, tip = $("trajectoryTooltip");
    if (!chart) return;
    const rect = $("trajectoryCanvas").getBoundingClientRect();
    const mx = event.clientX - rect.left, my = event.clientY - rect.top;
    if (mx < chart.left || mx > chart.left + chart.pw || my < chart.top || my > chart.top + chart.ph) {
      const hadHover = !!state.hover;
      state.hover = null; tip.hidden = true;
      if (hadHover) draw();
      return;
    }
    const cycle = (mx - chart.left) / chart.pw * chart.xMax;
    let best = null, distance = 11;
    for (const item of chart.series) for (const part of item.segments) {
      if (part.length < 2 || cycle < part[0][0] || cycle > part.at(-1)[0]) continue;
      let lo = 0, hi = part.length - 1;
      while (hi - lo > 1) {
        const middle = (lo + hi) >> 1;
        if (part[middle][0] <= cycle) lo = middle; else hi = middle;
      }
      const a = part[lo], b = part[hi];
      const fraction = b[0] === a[0] ? 0 : (cycle - a[0]) / (b[0] - a[0]);
      const y = chart.py(a[1] + fraction * (b[1] - a[1]));
      if (Math.abs(y - my) < distance) {
        distance = Math.abs(y - my);
        best = { cell: item.cell, key: keyOf(item.cell), x: mx, y };
      }
    }
    if (best) {
      const cell = best.cell;
      tip.textContent = `${cell.source} / ${cell.name.replace(/\.pkl$/, "")}\n最后详细记录 Cycle ${fmt(cell.last_cycle)}\n原有寿命标签：${cell.label == null ? "无" : fmt(cell.label)}${cell.label_beyond_detail ? "（超出详细记录）" : ""}`;
      tip.style.left = `${Math.min(mx + 14, rect.width - 315)}px`;
      tip.style.top = `${Math.max(4, Math.min(my + 12, rect.height - 100))}px`;
      tip.hidden = false;
    } else tip.hidden = true;
    if (state.hover?.key !== best?.key) { state.hover = best; draw(); }
    else state.hover = best;
  }

  async function poll() {
    try {
      const response = await fetch(`${SITE.api.trajectories}?after=${state.cursor}`);
      if (!response.ok) throw new Error(`请求失败：${response.status}`);
      const data = await response.json();
      if (!data.ready) { $("trajectoryProgress").textContent = data.message; return; }
      if (state.revision && data.revision !== state.revision) {
        state.records.clear(); state.cursor = 0; state.hover = null;
        state.revision = data.revision;
        state.timer = setTimeout(poll, 0);
        return;
      }
      state.revision = data.revision;
      state.total = data.total; state.processed = data.processed; state.drawable = data.drawable;
      state.skipped = data.skipped; state.failed = data.failed; state.running = data.running;
      if (data.items.length) {
        for (const item of data.items) state.records.set(keyOf(item), { ...item, segments: segmentsOf(item.points) });
        state.cursor = data.next;
        draw();
      }
      updateProgress();
      if (data.more) state.timer = setTimeout(poll, 0);
      else if (data.processed < data.total || data.running) state.timer = setTimeout(poll, 1200);
    } catch (error) {
      $("trajectoryProgress").textContent = `读取轨迹进度失败：${error.message}；稍后重试。`;
      state.timer = setTimeout(poll, 5000);
    }
  }

  function setRange(value) {
    state.maxCycle = value;
    $("trajectoryMaxCycle").value = value ?? "";
    document.querySelectorAll("[data-trajectory-limit]").forEach((button) =>
      button.classList.toggle("active", button.dataset.trajectoryLimit === String(value ?? "all")));
    state.hover = null; $("trajectoryTooltip").hidden = true; draw();
  }

  function init(cells) {
    if (state.initialized) return;
    state.initialized = true; state.cells = cells;
    buildRanks();
    $("trajectoryGroup").addEventListener("change", draw);
    document.querySelectorAll("[data-trajectory-limit]").forEach((button) => button.addEventListener("click", () =>
      setRange(button.dataset.trajectoryLimit === "all" ? null : Number(button.dataset.trajectoryLimit))));
    $("trajectoryRangeForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const raw = $("trajectoryMaxCycle").value;
      if (raw && (!Number.isSafeInteger(Number(raw)) || Number(raw) < 1)) {
        $("trajectoryMaxCycle").setCustomValidity("请输入至少为 1 的整数 Cycle 编号");
        $("trajectoryMaxCycle").reportValidity(); return;
      }
      $("trajectoryMaxCycle").setCustomValidity("");
      setRange(raw ? Number(raw) : null);
    });
    $("trajectoryMaxCycle").addEventListener("input", () => $("trajectoryMaxCycle").setCustomValidity(""));
    let frame = null;
    $("trajectoryCanvas").addEventListener("pointermove", (event) => {
      if (frame != null) return;
      frame = requestAnimationFrame(() => { frame = null; hover(event); });
    });
    $("trajectoryCanvas").addEventListener("pointerleave", () => {
      state.hover = null; $("trajectoryTooltip").hidden = true; draw();
    });
    new ResizeObserver(draw).observe($("trajectoryFrame"));
    poll();
  }

  function update(cells) {
    state.filtered = cells;
    state.hover = null; $("trajectoryTooltip").hidden = true;
    updateProgress(); draw();
  }

  return { init, update };
})();
