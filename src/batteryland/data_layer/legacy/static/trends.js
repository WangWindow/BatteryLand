"use strict";

const SITE = window.BatteryLifeConfig;

const $ = (id) => document.getElementById(id);
const MAX_DRAW_POINTS = 1600;
const BASE_COLORS = SITE.chartColors.comparisonSeries;
const SVG_NS = "http://www.w3.org/2000/svg";
const CANDIDATE_FILTER_IDS = ["sourceFilter", "cathodeFilter", "formFilter", "capacityBandFilter",
  "chargeStageFilter", "chargeControlFilter", "dischargeStageFilter", "socGroupFilter",
  "chargeRateFilter", "dischargeRateFilter", "cellSearch"];
const state = {
  cells: [], selected: [], drawn: [], loading: false, unit: "relative", maxCycle: null,
  cache: new Map(), colors: new Map(), nextColor: 0, staleMessage: "", chart: null,
  controller: null, highlightKey: null, candidateLimit: 40, importWarning: "",
};

const keyOf = (cell) => `${cell.source}\u0000${cell.name}`;
const cellName = (cell) => cell.name.replace(/\.pkl$/, "");
function colorOf(cell) {
  const key = keyOf(cell);
  if (!state.colors.has(key)) {
    const index = state.nextColor++;
    state.colors.set(key, index < BASE_COLORS.length ? BASE_COLORS[index] :
      `hsl(${Math.round((index - BASE_COLORS.length) * 137.508 + 22) % 360} 68% 42%)`);
  }
  return state.colors.get(key);
}
const fmt = (value, digits = 1) => Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });
const capacityText = (value) => value == null || value === "" ? "未提供" :
  Number.isFinite(Number(value)) ? `${fmt(value, 3)} Ah` : `待核对：${value}`;
const singleStageRate = (protocol) => Array.isArray(protocol) && protocol.length === 1 &&
  typeof protocol[0]?.rate_in_C === "number" && Number.isFinite(protocol[0].rate_in_C) &&
  protocol[0].rate_in_C > 0 ? protocol[0].rate_in_C : null;

function renderConditionCards() {
  const container = $("conditionCards"); container.replaceChildren();
  if (!state.selected.length) {
    container.append(element("p", "empty-copy", "添加电池后显示其测试条件。"));
    return;
  }
  for (const cell of state.selected) {
    const card = element("article", "condition-card");
    card.append(element("h3", "", `${cell.source} / ${cellName(cell)}`));
    const facts = element("dl");
    for (const [title, value] of [
      ["充电协议", cell.charge_protocol],
      ["放电协议", cell.discharge_protocol],
      ["SOC 区间", `${cell.soc_interval_group}；原值 ${JSON.stringify(cell.soc_interval) ?? "未提供"}`],
    ]) {
      const dd = element("dd");
      if (title === "SOC 区间") dd.textContent = value;
      else window.BatteryLifeProtocol.render(dd, value);
      facts.append(element("dt", "", title), dd);
    }
    card.append(facts); container.append(card);
  }
}

function showStatus(message, tone = "info") {
  const full = [state.staleMessage, state.importWarning, message].filter(Boolean).join(" ");
  $("status").textContent = full;
  $("status").hidden = !full;
  $("status").classList.toggle("info", !!full && !state.staleMessage && !state.importWarning && tone === "info");
}

function importSelectionFromHash() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (!hash.has("cells")) return false;
  let pairs;
  try { pairs = JSON.parse(hash.get("cells")); }
  catch (_) { state.importWarning = "批量对比链接无法解析，请返回总览重新选择。"; return true; }
  if (!Array.isArray(pairs)) {
    state.importWarning = "批量对比链接格式有误，请返回总览重新选择。";
    return true;
  }
  const catalog = new Map(state.cells.map((cell) => [keyOf(cell), cell]));
  const seen = new Set();
  let skipped = 0;
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 ||
      typeof pair[0] !== "string" || typeof pair[1] !== "string") { skipped++; continue; }
    const key = keyOf({ source: pair[0], name: pair[1] });
    const cell = catalog.get(key);
    if (!cell || seen.has(key)) { skipped++; continue; }
    seen.add(key); colorOf(cell); state.selected.push(cell);
  }
  if (skipped) state.importWarning = `批量对比中有 ${skipped} 个无效、重复或目录中不存在的编号，已跳过。`;
  return true;
}

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

function svgElement(tag, attrs = {}, text = "") {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (text) node.textContent = text;
  return node;
}

function invalidateDrawing() {
  state.drawn = [];
  state.chart = null;
  renderFailures([]);
  $("detailRows").replaceChildren();
  const row = element("tr");
  const cell = element("td", "", "选择已更改，绘制曲线后显示记录信息。");
  cell.colSpan = 10; row.append(cell); $("detailRows").append(row);
  renderChart();
  showStatus(state.selected.length ? "选择已更改，请点击“绘制曲线”。" : "");
}

function renderCandidates() {
  const source = $("sourceFilter").value;
  const cathode = $("cathodeFilter").value;
  const form = $("formFilter").value;
  const capacityBand = $("capacityBandFilter").value;
  const chargeStage = $("chargeStageFilter").value;
  const chargeControl = $("chargeControlFilter").value;
  const dischargeStage = $("dischargeStageFilter").value;
  const socGroup = $("socGroupFilter").value;
  const chargeRate = $("chargeRateFilter").value;
  const dischargeRate = $("dischargeRateFilter").value;
  const query = $("cellSearch").value.trim().toLocaleLowerCase();
  const matches = state.cells.filter((cell) =>
    (!source || cell.source === source) &&
    (!cathode || cell.cathode === cathode) &&
    (!form || cell.form_factor === form) &&
    (!capacityBand || cell.capacity_band === capacityBand) &&
    (!chargeStage || cell.charge_stage_count === chargeStage) &&
    (!chargeControl || cell.charge_control_kind === chargeControl) &&
    (!dischargeStage || cell.discharge_stage_count === dischargeStage) &&
    (!socGroup || cell.soc_interval_group === socGroup) &&
    (!chargeRate || String(singleStageRate(cell.charge_protocol)) === chargeRate) &&
    (!dischargeRate || String(singleStageRate(cell.discharge_protocol)) === dischargeRate) &&
    (!query || `${cell.source} ${cell.name}`.toLocaleLowerCase().includes(query)));
  const visibleCount = Math.min(state.candidateLimit, matches.length);
  $("candidateCount").textContent = `匹配 ${fmt(matches.length, 0)} 块电池，已显示 ${fmt(visibleCount, 0)} 块。`;
  $("showMoreCandidates").hidden = visibleCount >= matches.length;
  const list = $("candidateList"), previousScroll = list.scrollTop; list.replaceChildren();
  if (!matches.length) { list.append(element("p", "empty-copy", "没有符合条件的电池。")); return; }
  const selectedKeys = new Set(state.selected.map(keyOf));
  for (const cell of matches.slice(0, visibleCount)) {
    const item = element("div", "candidate-item");
    const copy = element("div", "candidate-copy");
    copy.append(element("strong", "", `${cell.source} / ${cellName(cell)}`));
    const capacity = capacityText(cell.nominal_capacity_ah);
    copy.append(element("small", "", `${cell.cathode} · ${cell.form_factor} · ${capacity} · ${fmt(cell.cycle_count, 0)} 个详细 cycle`));
    const button = element("button", "", selectedKeys.has(keyOf(cell)) ? "已添加" : "添加");
    button.type = "button";
    button.disabled = state.loading || selectedKeys.has(keyOf(cell));
    button.addEventListener("click", () => addCell(cell));
    item.append(copy, button); list.append(item);
  }
  list.scrollTop = previousScroll;
}

function renderSelected() {
  const list = $("selectedList"), previousScroll = list.scrollTop; list.replaceChildren();
  $("selectedCount").textContent = `已选 ${fmt(state.selected.length, 0)} 块`;
  $("clearSelected").disabled = state.loading || !state.selected.length;
  if (!state.selected.length) list.append(element("p", "empty-copy", "尚未选择电池。"));
  for (const [index, cell] of state.selected.entries()) {
    const item = element("div", "selected-item");
    const swatch = element("span", "selected-swatch"); swatch.style.background = colorOf(cell);
    const copy = element("div", "selected-copy");
    copy.append(element("strong", "", `${cell.source} / ${cellName(cell)}`));
    copy.append(element("small", "", `${cell.cathode} · ${cell.form_factor} · ${cell.label == null ? "无原有寿命标签" : `原有寿命标签 ${fmt(cell.label, 0)}`}`));
    const actions = element("div", "selected-item-actions");
    const focus = element("button", state.highlightKey === keyOf(cell) ? "is-active" : "", "突出");
    focus.type = "button"; focus.setAttribute("aria-pressed", String(state.highlightKey === keyOf(cell)));
    focus.setAttribute("aria-label", `突出显示 ${cell.source} / ${cellName(cell)} 曲线`);
    focus.addEventListener("click", () => focusCurve(cell));
    const button = element("button", "", "移除");
    button.type = "button"; button.disabled = state.loading;
    button.addEventListener("click", () => {
      state.selected.splice(index, 1);
      state.cache.delete(keyOf(cell));
      if (state.highlightKey === keyOf(cell)) state.highlightKey = null;
      invalidateDrawing(); renderSelected(); renderCandidates();
    });
    actions.append(focus, button); item.append(swatch, copy, actions); list.append(item);
  }
  list.scrollTop = previousScroll;
  $("drawButton").disabled = state.loading || !state.selected.length;
  $("cancelDrawButton").hidden = !state.loading;
  renderConditionCards();
}

function addCell(cell) {
  if (state.loading || state.selected.some((selected) => keyOf(selected) === keyOf(cell))) return;
  colorOf(cell);
  state.selected.push(cell);
  invalidateDrawing(); renderSelected(); renderCandidates();
  $("selectedList").scrollTop = $("selectedList").scrollHeight;
}

function focusCurve(cell) {
  const key = keyOf(cell);
  state.highlightKey = state.highlightKey === key ? null : key;
  renderSelected(); renderLegend(state.chart?.series || []); drawCanvas();
}

function renderFailures(errors) {
  const details = $("loadFailures"); details.hidden = !errors.length;
  $("loadFailuresTitle").textContent = `读取失败 ${fmt(errors.length, 0)} 块（展开查看）`;
  const list = $("loadFailuresList"); list.replaceChildren();
  for (const error of errors) list.append(element("li", "", error));
}

async function getSummary(cell, signal) {
  const key = keyOf(cell);
  if (state.cache.has(key)) {
    const cached = state.cache.get(key);
    state.cache.delete(key); state.cache.set(key, cached);
    return cached;
  }
  const query = new URLSearchParams({ source: cell.source, cell: cell.name });
  const response = await fetch(`${SITE.api.summary}?${query}`, { signal });
  if (!response.ok) {
    let message = `请求失败：${response.status}`;
    try { message = (await response.json()).error || message; } catch (_) { /* Keep HTTP status. */ }
    throw new Error(message);
  }
  const summary = await response.json();
  state.cache.set(key, summary);
  return summary;
}

async function drawSelected() {
  if (state.loading || !state.selected.length) return;
  const selected = [...state.selected];
  const controller = new AbortController();
  state.controller = controller;
  state.loading = true; renderSelected(); renderCandidates(); renderFailures([]);
  const loaded = [], errors = [];
  try {
    for (const [index, cell] of selected.entries()) {
      if (controller.signal.aborted) break;
      showStatus(`正在读取 ${index + 1}/${selected.length}：${cell.source} / ${cellName(cell)}…`);
      try { loaded.push({ cell, summary: await getSummary(cell, controller.signal), color: colorOf(cell) }); }
      catch (error) {
        if (controller.signal.aborted || error.name === "AbortError") break;
        errors.push(`${cell.source} / ${cellName(cell)}：${error.message}`);
      }
    }
    state.drawn = loaded;
    renderChart(); renderDetails();
    renderFailures(errors);
    const result = controller.signal.aborted ? `已停止读取，绘制已读取的 ${loaded.length} 块电池。` :
      loaded.length ? `已绘制 ${loaded.length} / ${selected.length} 块电池。` : "没有可绘制的电池。";
    showStatus(errors.length ? `${result} ${errors.length} 块读取失败，可展开查看。` : result,
      errors.length || !loaded.length ? "warning" : "info");
  } finally {
    state.loading = false; state.controller = null; renderSelected(); renderCandidates();
  }
}

function capacitySeries(item) {
  const baseline = item.summary.first_discharge_ah;
  if (state.unit === "relative" && !(Number.isFinite(baseline) && baseline > 0)) return null;
  const points = [], segments = [];
  let segment = [];
  const flush = () => { if (segment.length) segments.push(segment); segment = []; };
  for (const row of item.summary.cycles) {
    const cycle = row[0], capacity = row[1];
    if (!Number.isFinite(cycle) || (state.maxCycle != null && cycle > state.maxCycle)) { flush(); continue; }
    if (!Number.isFinite(capacity) || capacity < 0) { flush(); continue; }
    const point = { x: cycle, y: state.unit === "relative" ? capacity / baseline * 100 : capacity };
    points.push(point); segment.push(point);
  }
  flush();
  return { ...item, points, segments };
}

function thinSegment(points) {
  if (points.length <= MAX_DRAW_POINTS) return points;
  const result = [points[0]];
  const buckets = Math.floor((MAX_DRAW_POINTS - 2) / 2);
  for (let bucket = 0; bucket < buckets; bucket++) {
    const start = 1 + Math.floor(bucket * (points.length - 2) / buckets);
    const end = 1 + Math.floor((bucket + 1) * (points.length - 2) / buckets);
    let low = start, high = start;
    for (let index = start + 1; index < end; index++) {
      if (points[index].y < points[low].y) low = index;
      if (points[index].y > points[high].y) high = index;
    }
    result.push(points[Math.min(low, high)]);
    if (high !== low) result.push(points[Math.max(low, high)]);
  }
  result.push(points.at(-1));
  return result;
}

function chartText(svg, width, height, message) {
  svg.append(svgElement("text", { x: width / 2, y: height / 2, "text-anchor": "middle", class: "axis-title" }, message));
}

function renderLegend(series) {
  const list = $("chartLegend"), previousScroll = list.scrollTop;
  const query = $("legendSearch").value.trim().toLocaleLowerCase();
  const visible = series.filter((item) => `${item.cell.source} ${item.cell.name}`.toLocaleLowerCase().includes(query));
  $("legendCount").textContent = `显示 ${fmt(visible.length, 0)} / ${fmt(series.length, 0)} 条`;
  list.replaceChildren();
  for (const item of visible) {
    const button = element("button", state.highlightKey === keyOf(item.cell) ? "is-active" : "");
    button.type = "button";
    button.setAttribute("aria-pressed", String(state.highlightKey === keyOf(item.cell)));
    button.setAttribute("aria-label", `突出显示 ${item.cell.source} / ${cellName(item.cell)} 曲线`);
    const swatch = element("i"); swatch.style.background = item.color;
    button.append(swatch, document.createTextNode(`${item.cell.source} / ${cellName(item.cell)}`));
    button.addEventListener("click", () => focusCurve(item.cell));
    list.append(button);
  }
  list.scrollTop = previousScroll;
}

function prepareCanvas(width, height) {
  const canvas = $("trendCanvas");
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  return context;
}

function drawCanvas() {
  const chart = state.chart;
  if (!chart) return;
  const context = $("trendCanvas").getContext("2d");
  context.clearRect(0, 0, chart.width, chart.height);
  const focused = chart.series.find((item) => keyOf(item.cell) === state.highlightKey);
  const ordered = focused ? [...chart.series.filter((item) => item !== focused), focused] : chart.series;
  context.lineJoin = "round"; context.lineCap = "round";
  for (const item of ordered) {
    const active = !focused || item === focused;
    context.globalAlpha = active ? 0.95 : 0.16;
    context.strokeStyle = item.color;
    context.fillStyle = item.color;
    context.lineWidth = item === focused ? 3.4 : 2.2;
    for (const segment of item.drawnSegments) {
      if (segment.length === 1) {
        context.beginPath(); context.arc(chart.px(segment[0].x), chart.py(segment[0].y), 3.3, 0, Math.PI * 2); context.fill();
        continue;
      }
      context.beginPath();
      segment.forEach((point, index) => {
        if (index) context.lineTo(chart.px(point.x), chart.py(point.y));
        else context.moveTo(chart.px(point.x), chart.py(point.y));
      });
      context.stroke();
    }
  }
  context.globalAlpha = 1;
}

function renderChart() {
  const frame = $("chartFrame"), svg = $("trendChart");
  const width = Math.max(320, frame.clientWidth), height = Math.max(300, frame.clientHeight);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren(); $("chartTooltip").hidden = true; state.chart = null;
  prepareCanvas(width, height);
  if (!state.drawn.length) {
    chartText(svg, width, height, "选择电池并点击“绘制曲线”");
    renderLegend([]);
    $("chartNote").textContent = "跨来源比较时，建议使用各自首个有效放电容量归一化；原有寿命标签不会用于对齐曲线。";
    return;
  }

  const unavailable = [];
  const series = state.drawn.map((item) => {
    const values = capacitySeries(item);
    if (!values) unavailable.push(`${item.cell.source} / ${cellName(item.cell)} 缺少有效基准容量`);
    return values;
  }).filter((item) => item && item.points.length);
  if (!series.length) {
    chartText(svg, width, height, "当前范围内没有可绘制的放电容量点");
    renderLegend([]);
    $("chartNote").textContent = unavailable.join("；") || "请扩大 Cycle 范围或选择其他电池。";
    return;
  }

  const left = width < 550 ? 60 : 75, right = 20, top = 27, bottom = 59;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const xMax = state.maxCycle ?? Math.max(...series.map((item) => item.points.at(-1).x));
  let min = Infinity, max = -Infinity;
  for (const item of series) for (const point of item.points) {
    if (point.y < min) min = point.y;
    if (point.y > max) max = point.y;
  }
  const pad = Math.max((max - min) * .09, state.unit === "relative" ? 2 : .02);
  const yMin = Math.max(0, min - pad), yMax = max + pad;
  const px = (x) => left + x / xMax * plotWidth;
  const py = (y) => top + (yMax - y) / (yMax - yMin) * plotHeight;

  for (let tick = 0; tick <= 5; tick++) {
    const y = top + tick / 5 * plotHeight;
    const value = yMax - tick / 5 * (yMax - yMin);
    svg.append(svgElement("line", { x1: left, y1: y, x2: width - right, y2: y, class: "grid-line" }));
    svg.append(svgElement("text", { x: left - 9, y: y + 4, "text-anchor": "end", class: "axis-tick" }, fmt(value, state.unit === "relative" ? 1 : 3)));
  }
  const xTicks = width < 550 ? 4 : 6;
  for (let tick = 0; tick <= xTicks; tick++) {
    const x = left + tick / xTicks * plotWidth;
    svg.append(svgElement("line", { x1: x, y1: top, x2: x, y2: height - bottom, class: "grid-line" }));
    svg.append(svgElement("text", { x, y: height - bottom + 23, "text-anchor": "middle", class: "axis-tick" }, fmt(xMax * tick / xTicks, 0)));
  }
  svg.append(svgElement("line", { x1: left, y1: height - bottom, x2: width - right, y2: height - bottom, class: "axis-line" }));
  svg.append(svgElement("line", { x1: left, y1: top, x2: left, y2: height - bottom, class: "axis-line" }));
  svg.append(svgElement("text", { x: left + plotWidth / 2, y: height - 9, "text-anchor": "middle", class: "axis-title" }, "实际 Cycle 编号"));
  svg.append(svgElement("text", { x: 16, y: top + plotHeight / 2, transform: `rotate(-90 16 ${top + plotHeight / 2})`, "text-anchor": "middle", class: "axis-title" },
    state.unit === "relative" ? "相对容量 %" : "放电容量 Ah"));

  let reduced = false;
  for (const item of series) {
    item.drawnSegments = item.segments.map((segment) => {
      const drawn = thinSegment(segment);
      if (drawn.length < segment.length) reduced = true;
      return drawn;
    });
  }
  const hover = svgElement("g"); svg.append(hover);
  state.chart = { width, height, left, right, top, bottom, plotWidth, plotHeight, xMax, px, py, series, hover };
  drawCanvas();
  renderLegend(series);
  const pieces = [state.unit === "relative" ? "每条曲线按本电池首个有效放电容量归一化。" : "显示原始放电容量 Ah；不同规格电池的数值不可直接代表相同退化程度。"];
  if (state.maxCycle != null) pieces.push(`只显示 Cycle ${fmt(state.maxCycle, 0)} 以内的记录。`);
  if (reduced) pieces.push(`长曲线绘图保留每段峰谷与端点，每段最多约 ${fmt(MAX_DRAW_POINTS, 0)} 个绘图点；悬停读数仍取完整的有效记录。`);
  if (unavailable.length) pieces.push(unavailable.join("；") + "，未绘入当前单位的图。" );
  pieces.push("寿命标签按来源原样列在下表，未用于对齐或重算曲线。");
  $("chartNote").textContent = pieces.join(" ");
}

function nearest(points, target) {
  let low = 0, high = points.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (points[middle].x < target) low = middle + 1;
    else high = middle;
  }
  const previous = Math.max(0, low - 1);
  return Math.abs(points[previous].x - target) <= Math.abs(points[low].x - target) ? points[previous] : points[low];
}

function showHover(event) {
  const chart = state.chart;
  if (!chart) return;
  const rect = $("trendChart").getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width * chart.width;
  const y = (event.clientY - rect.top) / rect.height * chart.height;
  const tooltip = $("chartTooltip");
  if (x < chart.left || x > chart.width - chart.right || y < chart.top || y > chart.height - chart.bottom) {
    chart.hover.replaceChildren(); tooltip.hidden = true; return;
  }
  const cycle = (x - chart.left) / chart.plotWidth * chart.xMax;
  let best = null;
  for (const item of chart.series) {
    if (cycle < item.points[0].x || cycle > item.points.at(-1).x) continue;
    const point = nearest(item.points, cycle);
    const distance = Math.hypot((chart.px(point.x) - x) * 0.35, chart.py(point.y) - y);
    if (!best || distance < best.distance) best = { item, point, distance };
  }
  if (!best || best.distance > 26) { chart.hover.replaceChildren(); tooltip.hidden = true; return; }
  const { item, point } = best;
  chart.hover.replaceChildren(
    svgElement("line", { x1: x, x2: x, y1: chart.top, y2: chart.height - chart.bottom,
      stroke: SITE.chartColors.axisSoft, "stroke-width": 1, "stroke-dasharray": "4 4" }),
    svgElement("circle", { cx: chart.px(point.x), cy: chart.py(point.y), r: 4.7,
      fill: item.color, stroke: SITE.chartColors.white, "stroke-width": 1.5 }),
  );
  tooltip.replaceChildren(element("strong", "", `${item.cell.source} / ${cellName(item.cell)}`),
    element("span", "", `Cycle ${fmt(point.x, 0)}：${fmt(point.y, state.unit === "relative" ? 2 : 4)} ${state.unit === "relative" ? "%" : "Ah"}`));
  tooltip.hidden = false;
  const tooltipWidth = Math.min(270, chart.width - 22);
  tooltip.style.left = `${Math.min(chart.width - tooltipWidth - 9, x + 13)}px`;
  tooltip.style.top = `${Math.min(chart.height - tooltip.offsetHeight - 9, y + 13)}px`;
}

function renderDetails() {
  const body = $("detailRows"); body.replaceChildren();
  if (!state.drawn.length) {
    const row = element("tr"), cell = element("td", "", "没有成功读取的曲线。");
    cell.colSpan = 10; row.append(cell); body.append(row); return;
  }
  for (const { cell, summary } of state.drawn) {
    const row = element("tr");
    const valid = summary.cycles.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]) && point[1] >= 0).length;
    for (const value of [cell.source, cellName(cell), cell.cathode, cell.form_factor,
      capacityText(cell.nominal_capacity_ah), fmt(valid, 0),
      summary.first_discharge_ah == null ? "未提供" : fmt(summary.first_discharge_ah, 4),
      summary.cycles.length ? fmt(summary.cycles.at(-1)[0], 0) : "未提供"])
      row.append(element("td", "", value));
    const label = element("td", "", cell.label == null ? "无标签" : fmt(cell.label, 0));
    if (cell.label_beyond_detail) label.append(element("span", "tag", "超出详细曲线"));
    row.append(label);
    const action = element("td");
    const link = element("a", "", "查看单电池 ↗");
    const query = new URLSearchParams({ source: cell.source, cell: cell.name });
    link.href = SITE.routeUrl("detail", query);
    link.target = "_blank"; link.rel = "noopener";
    link.title = "在新标签页打开";
    link.setAttribute("aria-label", "查看单电池（在新标签页打开）");
    action.append(link); row.append(action); body.append(row);
  }
}

function applySettings(event) {
  event.preventDefault();
  const text = $("maxCycleInput").value.trim();
  const limit = text ? Number(text) : null;
  if (text && (!Number.isInteger(limit) || limit < 1)) { showStatus("显示到 Cycle 请输入大于 0 的整数，或留空显示全程。", "warning"); return; }
  state.maxCycle = limit;
  state.unit = document.querySelector('input[name="unit"]:checked').value;
  document.querySelectorAll("[data-limit]").forEach((button) =>
    button.classList.toggle("active", button.dataset.limit === (limit == null ? "all" : String(limit))));
  renderChart();
  showStatus(state.drawn.length ? "显示范围已更新。" : "请先选择电池并绘制曲线。");
}

async function init() {
  for (const id of CANDIDATE_FILTER_IDS)
    $(id).addEventListener(id === "cellSearch" ? "input" : "change", () => {
      state.candidateLimit = 40;
      $("candidateList").scrollTop = 0;
      renderCandidates();
    });
  $("clearCandidateFilters").addEventListener("click", () => {
    for (const id of CANDIDATE_FILTER_IDS) $(id).value = "";
    state.candidateLimit = 40;
    $("candidateList").scrollTop = 0;
    renderCandidates();
  });
  $("showMoreCandidates").addEventListener("click", () => {
    state.candidateLimit += 40;
    renderCandidates();
  });
  $("drawButton").addEventListener("click", drawSelected);
  $("cancelDrawButton").addEventListener("click", () => state.controller?.abort());
  $("clearSelected").addEventListener("click", () => {
    if (state.loading) return;
    state.selected = []; state.cache.clear(); state.colors.clear(); state.nextColor = 0; state.highlightKey = null;
    state.importWarning = "";
    invalidateDrawing(); renderSelected(); renderCandidates();
  });
  $("legendSearch").addEventListener("input", () => renderLegend(state.chart?.series || []));
  $("chartSettings").addEventListener("submit", applySettings);
  document.querySelectorAll("[data-limit]").forEach((button) => button.addEventListener("click", () => {
    $("maxCycleInput").value = button.dataset.limit === "all" ? "" : button.dataset.limit;
    $("chartSettings").requestSubmit();
  }));
  document.querySelectorAll('input[name="unit"]').forEach((input) => input.addEventListener("change", applySettings));
  let hoverFrame = null, hoverEvent = null;
  $("trendChart").addEventListener("pointermove", (event) => {
    hoverEvent = event;
    if (hoverFrame != null) return;
    hoverFrame = requestAnimationFrame(() => { hoverFrame = null; if (hoverEvent) showHover(hoverEvent); });
  });
  $("trendChart").addEventListener("pointerleave", () => {
    hoverEvent = null;
    if (hoverFrame != null) cancelAnimationFrame(hoverFrame);
    hoverFrame = null;
    $("chartTooltip").hidden = true; state.chart?.hover.replaceChildren();
  });
  new ResizeObserver(() => renderChart()).observe($("chartFrame"));
  renderChart();
  try {
    const response = await fetch(SITE.api.overview);
    if (!response.ok) throw new Error(`目录请求失败：${response.status}`);
    const data = await response.json();
    if (!data.ready) { showStatus(data.message, "warning"); $("indexedAt").textContent = "目录未就绪"; return; }
    state.cells = data.cells;
    if (data.needs_refresh) state.staleMessage = "目录文件已变化。当前仍显示上次索引；请联系管理员更新数据层目录索引。";
    $("indexedAt").textContent = `目录核查时间：${new Date(data.indexed_at).toLocaleString("zh-CN")}`;
    for (const source of [...new Set(state.cells.map((cell) => cell.source))].sort((a, b) => a.localeCompare(b))) {
      const option = element("option", "", source); option.value = source; $("sourceFilter").append(option);
    }
    for (const [id, field] of [["cathodeFilter", "cathode"], ["formFilter", "form_factor"],
      ["capacityBandFilter", "capacity_band"], ["chargeStageFilter", "charge_stage_count"],
      ["chargeControlFilter", "charge_control_kind"], ["dischargeStageFilter", "discharge_stage_count"],
      ["socGroupFilter", "soc_interval_group"]]) {
      for (const value of [...new Set(state.cells.map((cell) => cell[field]))].sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }))) {
        const option = element("option", "", value); option.value = value; $(id).append(option);
      }
    }
    for (const [id, field] of [["chargeRateFilter", "charge_protocol"],
      ["dischargeRateFilter", "discharge_protocol"]]) {
      const rates = [...new Set(state.cells.map((cell) => singleStageRate(cell[field])).filter((rate) => rate != null))]
        .sort((a, b) => a - b);
      for (const rate of rates) {
        const option = element("option", "", `${fmt(rate, 4)} C`);
        option.value = String(rate); $(id).append(option);
      }
    }
    const imported = importSelectionFromHash();
    const params = new URLSearchParams(location.search);
    const initial = imported ? null : state.cells.find((cell) => cell.source === params.get("source") && cell.name === params.get("cell"));
    if (initial) { colorOf(initial); state.selected.push(initial); }
    renderSelected(); renderCandidates();
    showStatus(imported ? state.selected.length ? `已从数据总览加入 ${state.selected.length} 块电池，正在绘图。` : "没有可绘制的电池。" :
      initial ? "已加入一块电池，可继续添加后绘制。" : "");
    if (imported && state.selected.length) drawSelected();
  } catch (error) { showStatus(`读取电池目录失败：${error.message}`, "warning"); }
}

init();
