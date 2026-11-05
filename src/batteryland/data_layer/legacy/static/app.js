"use strict";

const SITE = window.BatteryLifeConfig;

const $ = (id) => document.getElementById(id);
const state = {
  catalog: null, source: null, cell: null, summary: null,
  protocolCells: null,
  compareSource: null, compare: null, compareSummary: null, unit: "relative", window: "all",
  visibleCycles: 100, capacityZoom: null,
  capacityOrder: [], capacityPreviewIndex: null, capacityPendingIndex: null,
  capacityPointerId: null, capacitySelectionError: "",
  summaryToken: 0, compareToken: 0, cycleToken: 0, currentCycleIndex: null,
  currentCycleData: null, compareCycleIndex: null, compareCycleData: null, compareCycleToken: 0,
  cycleMode: "multi", multiToken: 0, multiAbortController: null, multiSelection: [], multiRecords: [],
  multiAvailableCount: 0, multiFinishedCount: 0, multiCapacitySignal: "discharge", multiFullRange: null,
  incrementalPhase: "charge", incrementalToken: 0, incrementalController: null,
  incrementalCurrent: null, incrementalReference: null, incrementalErrors: {}, incrementalCache: new Map(),
};
const fmt = (value, digits = 0) => value == null || !Number.isFinite(Number(value))
  ? "—" : Number(value).toLocaleString("zh-CN", { maximumFractionDigits: digits });

function formatMetadata(value) {
  if (Array.isArray(value)) return value.length ? value.map(formatMetadata).join(" ～ ") : "未提供";
  if (value == null) return "未提供";
  if (typeof value === "number") return Number.isFinite(value) ? fmt(value, 3) : "未提供";
  if (typeof value === "string") {
    const text = value.trim();
    return !text || /^[—–-]+$/.test(text) ? "未提供" : text;
  }
  return String(value);
}

function notice(message, error = false) {
  const element = $("notice");
  element.textContent = message;
  element.classList.toggle("error", error);
  element.hidden = !message;
}

async function api(path, params = {}, signal) {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = await fetch(url, { signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "数据读取失败");
  return data;
}

function nearestPoint(points, x) {
  if (!points.length) return null;
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] < x) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[Math.max(0, lo - 1)];
  return Math.abs(a[0] - x) < Math.abs(b[0] - x) ? a : b;
}

class LineChart {
  constructor(id) {
    this.canvas = $(id);
    this.frame = this.canvas.parentElement;
    this.crosshair = this.frame.querySelector(".chart-crosshair");
    this.tooltip = this.frame.querySelector(".chart-tooltip");
    this.spec = null;
    this.bounds = null;
    this.canvas.addEventListener("mousemove", (event) => this.hover(event));
    this.canvas.addEventListener("mouseleave", () => this.hideHover());
    new ResizeObserver(() => this.draw()).observe(this.frame);
  }

  set(spec) { this.spec = spec; this.hideHover(); this.draw(); }
  hideHover() { this.crosshair.hidden = true; this.tooltip.hidden = true; }

  draw() {
    const canvas = this.canvas;
    const width = this.frame.clientWidth;
    const height = this.frame.clientHeight;
    if (!width || !height) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const pad = { left: width < 380 ? 56 : 64, right: 21, top: 24, bottom: 41 };
    const plotWidth = Math.max(1, width - pad.left - pad.right);
    const plotHeight = Math.max(1, height - pad.top - pad.bottom);
    const spec = this.spec;
    if (!spec || !spec.series.some((series) => series.points.length)) {
      context.fillStyle = SITE.chartColors.axis;
      context.font = "16px Segoe UI, sans-serif";
      context.textAlign = "center";
      context.fillText("暂无曲线数据", width / 2, height / 2);
      this.bounds = null;
      return;
    }

    const xValues = [], yValues = [];
    for (const series of spec.series) {
      for (const [x, y] of series.points) {
        if (Number.isFinite(x) && Number.isFinite(y) && (!spec.xDomain || x >= spec.xDomain[0] && x <= spec.xDomain[1])) {
          xValues.push(x); yValues.push(y);
        }
      }
    }
    if ((!xValues.length || !yValues.length) && !(spec.showEmptyDomain && spec.xDomain &&
        spec.series.some((series) => series.points.some(([x, y]) => Number.isFinite(x) && Number.isFinite(y))))) {
      context.fillStyle = SITE.chartColors.axis;
      context.font = "16px Segoe UI, sans-serif";
      context.textAlign = "center";
      context.fillText("所选范围没有曲线数据", width / 2, height / 2);
      this.bounds = null;
      return;
    }
    let minX = spec.xDomain ? spec.xDomain[0] : spec.startAtZero ? 0 : Infinity;
    let maxX = spec.xDomain ? spec.xDomain[1] : -Infinity;
    let minY = Infinity, maxY = -Infinity;
    if (!spec.xDomain) for (const x of xValues) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    const capacityYValues = yValues.length ? yValues : spec.series.flatMap((series) =>
      series.points.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([, y]) => y));
    for (const y of capacityYValues) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    if (spec.zeroLine) { minY = Math.min(0, minY); maxY = Math.max(0, maxY); }
    if (maxX <= minX) maxX = minX + 1;
    const spread = Math.max(maxY - minY, Math.abs(maxY) * .02, .001);
    minY -= spread * .08; maxY += spread * .08;
    if (spec.nonnegative) minY = Math.max(0, minY);
    const toX = (x) => pad.left + (x - minX) / (maxX - minX) * plotWidth;
    const toY = (y) => pad.top + (maxY - y) / (maxY - minY) * plotHeight;
    this.bounds = { minX, maxX, pad, plotWidth, plotHeight, width, height, toX, toY };

    if (spec.shadeUntil != null && spec.shadeUntil > minX) {
      context.fillStyle = SITE.chartColors.selection;
      context.fillRect(pad.left, pad.top, Math.min(plotWidth, toX(spec.shadeUntil) - pad.left), plotHeight);
    }
    context.font = "14px Segoe UI, sans-serif";
    const yTickStep = (maxY - minY) / 4;
    const yTickDigits = yTickStep < .001 ? 4 : yTickStep < .01 ? 3 : yTickStep < .1 ? 2 : yTickStep < 1 ? 1 : 0;
    context.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + plotHeight * i / 4;
      const value = maxY - (maxY - minY) * i / 4;
      context.strokeStyle = SITE.chartColors.grid;
      context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke();
      context.fillStyle = SITE.chartColors.axis;
      context.textAlign = "right";
      context.fillText(fmt(value, yTickDigits), pad.left - 7, y + 4);
    }
    const xTickCount = width < 300 ? 2 : 4;
    for (let i = 0; i <= xTickCount; i++) {
      const x = pad.left + plotWidth * i / xTickCount;
      context.fillStyle = SITE.chartColors.axis;
      context.textAlign = i === 0 ? "left" : i === xTickCount ? "right" : "center";
      context.fillText(fmt(minX + (maxX - minX) * i / xTickCount,
        spec.xDigits ?? (maxX < 30 ? 1 : 0)), x, height - 11);
    }
    if (!xValues.length) {
      context.fillStyle = SITE.chartColors.axis;
      context.font = "14px Segoe UI, sans-serif";
      context.textAlign = "left";
      context.fillText("此范围无详细容量记录", pad.left + 8, pad.top + plotHeight - 12);
    }
    const markers = (spec.vertical || []).filter((marker) =>
      Number.isFinite(marker.value) && marker.value >= minX && marker.value <= maxX);
    for (const [index, marker] of markers.entries()) {
      const x = toX(marker.value);
      context.save(); context.setLineDash([4, 4]); context.strokeStyle = marker.color; context.lineWidth = 1.4;
      const middle = marker.secondColor ? pad.top + plotHeight / 2 : pad.top + plotHeight;
      context.beginPath(); context.moveTo(x, pad.top); context.lineTo(x, middle); context.stroke();
      if (marker.secondColor) {
        context.strokeStyle = marker.secondColor;
        context.beginPath(); context.moveTo(x, middle); context.lineTo(x, pad.top + plotHeight); context.stroke();
      }
      context.restore();
      context.fillStyle = marker.color; context.font = "13px Segoe UI, sans-serif";
      context.textAlign = "left";
      const labelWidth = context.measureText(marker.label).width;
      const rightEdge = width - pad.right;
      const preferredLeft = x + 4 + labelWidth <= rightEdge ? x + 4 : x - 4 - labelWidth;
      const labelLeft = Math.max(pad.left, Math.min(preferredLeft, rightEdge - labelWidth));
      context.fillText(marker.label, labelLeft, pad.top + 11 + index * 18);
    }
    for (const series of spec.series) {
      context.save();
      context.beginPath(); context.strokeStyle = series.color; context.lineWidth = series.lineWidth || 1.8;
      context.globalAlpha = series.opacity ?? 1;
      if (series.dash) context.setLineDash(series.dash);
      context.lineJoin = "round"; context.lineCap = "round";
      let started = false;
      for (const [x, y] of series.points) {
        if (spec.xDomain && (x < minX || x > maxX)) { started = false; continue; }
        if (!Number.isFinite(x) || !Number.isFinite(y)) { started = false; continue; }
        if (!started) { context.moveTo(toX(x), toY(y)); started = true; }
        else context.lineTo(toX(x), toY(y));
      }
      context.stroke();
      context.restore();
    }
    for (const [point, preview] of [[spec.selectedPoint, false], [spec.previewPoint, true]]) {
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) ||
          point.x < minX || point.x > maxX) continue;
      const x = toX(point.x), y = toY(point.y);
      context.save();
      context.beginPath(); context.arc(x, y, preview ? 8 : 7, 0, Math.PI * 2);
      context.fillStyle = preview ? SITE.chartColors.white : SITE.chartColors.cycleSelection;
      context.strokeStyle = preview ? SITE.chartColors.cycleSelection : SITE.chartColors.white;
      context.lineWidth = preview ? 3 : 3.5;
      context.fill(); context.stroke();
      if (!preview) {
        context.beginPath(); context.arc(x, y, 7, 0, Math.PI * 2);
        context.strokeStyle = SITE.chartColors.cycleSelection;
        context.lineWidth = 1.5; context.stroke();
      }
      context.restore();
    }
  }

  hover(event) {
    if (!this.bounds || !this.spec) return;
    const b = this.bounds;
    const rect = this.canvas.getBoundingClientRect();
    const pixel = event.clientX - rect.left;
    if (pixel < b.pad.left || pixel > b.width - b.pad.right) { this.hideHover(); return; }
    const x = b.minX + (pixel - b.pad.left) / b.plotWidth * (b.maxX - b.minX);
    const nearestOnly = this.spec.hoverMode === "nearest";
    const pointerY = event.clientY - rect.top;
    if (nearestOnly && (pointerY < b.pad.top || pointerY > b.pad.top + b.plotHeight)) { this.hideHover(); return; }
    const lines = [];
    let closest = null;
    for (const series of this.spec.series) {
      const point = nearestPoint(series.points, x);
      if (point && Number.isFinite(point[1]) && (!this.spec.xDomain || point[0] >= b.minX && point[0] <= b.maxX)) {
        if (nearestOnly && Math.abs(point[0] - x) > (b.maxX - b.minX) * .03) continue;
        const label = `${series.name}  ${fmt(point[1], this.spec.valueDigits ?? 2)}  ·  ${fmt(point[0], this.spec.xDigits ?? 1)} ${this.spec.xUnit || ""}`;
        if (nearestOnly) {
          const distance = Math.abs(b.toY(point[1]) - pointerY);
          if (distance <= 28 && (!closest || distance < closest.distance)) closest = { distance, label };
        } else lines.push(label);
      }
    }
    if (closest) lines.push(closest.label);
    if (!lines.length) { this.hideHover(); return; }
    this.crosshair.hidden = false; this.tooltip.hidden = false;
    this.crosshair.style.left = `${pixel}px`;
    this.tooltip.textContent = lines.join("\n");
    const tipWidth = this.tooltip.offsetWidth;
    this.tooltip.style.left = `${Math.max(5, Math.min(pixel + 12, b.width - tipWidth - 6))}px`;
    this.tooltip.style.top = `${Math.max(4, Math.min(event.clientY - rect.top - 8, b.height - this.tooltip.offsetHeight - 4))}px`;
  }
}

const charts = {
  capacity: new LineChart("capacityChart"),
  voltage: new LineChart("voltageChart"),
  current: new LineChart("currentChart"),
  cycleCapacity: new LineChart("cycleCapacityChart"),
  incremental: new LineChart("incrementalChart"),
};

function currentCells() { return state.catalog?.sources[state.source] || []; }

function renderCellList() {
  const query = $("cellSearch").value.trim().toLowerCase();
  const sort = $("cellSort").value;
  const cells = currentCells().filter((cell) => cell.name.toLowerCase().includes(query));
  if (sort !== "name") {
    cells.sort((a, b) => {
      if (a.label == null) return 1;
      if (b.label == null) return -1;
      return sort === "label-asc" ? a.label - b.label : b.label - a.label;
    });
  }
  $("visibleCount").textContent = fmt(cells.length);
  const list = $("cellList"); list.replaceChildren();
  if (!cells.length) {
    const empty = document.createElement("div"); empty.className = "empty-list";
    empty.textContent = "没有匹配的电池"; list.append(empty); return;
  }
  const fragment = document.createDocumentFragment();
  for (const cell of cells) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "cell-item" + (cell.name === state.cell ? " active" : "");
    button.title = cell.name; button.setAttribute("role", "option");
    button.setAttribute("aria-selected", cell.name === state.cell ? "true" : "false");
    const name = document.createElement("span"); name.className = "name"; name.textContent = cell.name.replace(/\.pkl$/, "");
    const sub = document.createElement("span"); sub.className = "sub";
    const life = document.createElement("span"); life.textContent = cell.label == null ? "无寿命标签" : `EOL ${fmt(cell.label)}`;
    const size = document.createElement("span"); size.textContent = `${fmt(cell.size_mb, 1)} MB`;
    sub.append(life, size); button.append(name, sub);
    button.addEventListener("click", () => selectCell(cell.name));
    fragment.append(button);
  }
  list.append(fragment);
  list.querySelector(".active")?.scrollIntoView({ block: "nearest" });
}

function renderCompareChoices() {
  const select = $("compareSelect"); select.replaceChildren();
  const first = document.createElement("option"); first.value = ""; first.textContent = "不对照"; select.append(first);
  for (const cell of state.catalog.sources[state.compareSource] || []) {
    if (state.compareSource === state.source && cell.name === state.cell) continue;
    const option = document.createElement("option"); option.value = cell.name;
    option.textContent = cell.name.replace(/\.pkl$/, ""); select.append(option);
  }
  select.value = state.compare || "";
}

async function selectSource(source, preferredCell = null) {
  state.source = source;
  state.compareSource = source;
  ++state.compareToken;
  state.compare = null; state.compareSummary = null;
  $("sourceSelect").value = source;
  $("compareSourceSelect").value = source;
  $("sourceCount").textContent = `${fmt(currentCells().length)} 块电池 · ${fmt(currentCells().filter((c) => c.label != null).length)} 块有标签`;
  $("cellSearch").value = "";
  const cells = currentCells();
  const first = cells.find((c) => c.name === preferredCell)?.name || cells[0]?.name;
  if (first) await selectCell(first);
}

async function selectCell(cell) {
  const token = ++state.summaryToken;
  clearTimeout(cycleTimer);
  ++state.cycleToken;
  ++state.compareCycleToken;
  cancelMultiCycleLoad();
  state.cell = cell; state.summary = null;
  resetBatteryDisplay();
  if (state.compareSource === state.source && state.compare === cell) {
    ++state.compareToken;
    state.compare = null; state.compareSummary = null;
  }
  renderCellList(); renderCompareChoices();
  $("cellTitle").textContent = cell.replace(/\.pkl$/, "");
  $("cellSubtitle").textContent = `${state.source} · 正在读取原始文件…`;
  notice("正在读取电池文件。较大的文件可能需要几秒钟。", false);
  try {
    const summary = await api(SITE.api.summary, { source: state.source, cell });
    if (token !== state.summaryToken) return;
    state.summary = summary;
    state.capacityOrder = recordedCyclesInRange(summary, -Infinity, Infinity);
    renderSummary(); renderCapacity();
    $("cycleSlider").max = String(Math.max(0, summary.cycle_count - 1));
    $("cycleSlider").value = "0";
    $("cycleSlider").disabled = !summary.cycle_count;
    const recorded = recordedCyclesInRange(summary, 1, Number.MAX_SAFE_INTEGER);
    state.multiFullRange = recorded.length
      ? { start: recorded[0].number, end: recorded.at(-1).number, count: recorded.length } : null;
    $("multiStartInput").value = state.multiFullRange ? String(state.multiFullRange.start) : "";
    $("multiEndInput").value = state.multiFullRange ? String(state.multiFullRange.end) : "";
    $("multiFullRange").textContent = state.multiFullRange
      ? `完整详细记录范围：Cycle ${fmt(state.multiFullRange.start)}–${fmt(state.multiFullRange.end)}（共 ${fmt(state.multiFullRange.count)} 个已记录编号）。`
      : "当前电池没有可用的实际 Cycle 编号。";
    updateMultiResetButton();
    notice("");
    if (state.cycleMode === "multi") await loadMultiCycles();
    else await loadCycle(0);
  } catch (error) {
    if (token === state.summaryToken) {
      $("cellSubtitle").textContent = `${state.source} · 读取失败`;
      $("cycleNote").textContent = "当前电池的详细记录未能读取，请选择其他电池或重试。";
      notice(error.message, true);
    }
  }
}

function resetBatteryDisplay() {
  cancelIncrementalLoad();
  state.incrementalCache.clear();
  $("incrementalPanel").open = false;
  $("incrementalPanel").hidden = state.cycleMode !== "single";
  state.capacityZoom = null;
  state.capacityOrder = [];
  state.capacityPreviewIndex = null;
  state.capacityPendingIndex = null;
  state.capacitySelectionError = "";
  if (state.capacityPointerId != null && $("capacityChart").hasPointerCapture(state.capacityPointerId))
    $("capacityChart").releasePointerCapture(state.capacityPointerId);
  state.capacityPointerId = null;
  $("capacityZoomStatus").textContent = "鼠标置于容量图内，滚轮向上放大、向下缩小 Cycle 范围。";
  $("capacityZoomReset").hidden = true;
  for (const id of ["metricEol", "metricCycles", "metricFirst", "metricNominal", "selectedCycle"]) $(id).textContent = "—";
  $("metricEol").nextElementSibling.hidden = false;
  $("metadataGrid").replaceChildren();
  $("capacityNote").textContent = "正在读取当前电池的容量记录…";
  $("cycleNote").textContent = "正在读取当前电池的采样记录…";
  $("cycleJumpMessage").textContent = "";
  $("cycleNumberInput").value = "";
  $("cycleCompareMessage").textContent = "";
  $("cycleCompareInput").value = "";
  $("cycleCompareClear").disabled = true;
  $("cycleCompareLegend").hidden = true;
  $("multiCycleMessage").textContent = "正在读取采样记录…";
  $("multiFullRange").textContent = "";
  $("multiCycleDetails").hidden = true;
  $("multiCycleDetails").open = false;
  $("multiCycleNumbers").textContent = "";
  $("multiCycleColorbar").hidden = true;
  $("multiStartInput").value = "";
  $("multiEndInput").value = "";
  $("multiRangeReset").disabled = true;
  state.multiFullRange = null;
  state.multiSelection = [];
  state.multiRecords = [];
  state.multiAvailableCount = 0;
  state.multiFinishedCount = 0;
  $("cycleSlider").value = "0";
  $("cycleSlider").max = "0";
  $("cycleSlider").disabled = true;
  $("eolLegend").hidden = true;
  $("compareEolLegend").hidden = true;
  $("compareLegend").hidden = true;
  state.currentCycleIndex = null;
  state.currentCycleData = null;
  state.compareCycleIndex = null;
  state.compareCycleData = null;
  for (const chart of Object.values(charts)) chart.set({ series: [] });
  $("incrementalStatus").textContent = "展开后按完整采样记录计算。";
  updateCapacitySelectionStatus();
}

function renderSummary() {
  const s = state.summary; if (!s) return;
  $("cellTitle").textContent = s.name.replace(/\.pkl$/, "");
  $("cellSubtitle").textContent = `${s.source} · ${s.label == null ? "无寿命标签" : "已有寿命标签"}`;
  $("metricEolLabel").textContent = "数据集 EOL 标签";
  $("metricEol").textContent = s.label == null ? "无标签" : fmt(s.label);
  $("metricEol").nextElementSibling.hidden = s.label == null;
  $("metricCycles").textContent = fmt(s.cycle_count);
  $("metricFirst").textContent = fmt(s.first_discharge_ah, 4);
  $("metricNominal").textContent = fmt(s.metadata.nominal_capacity_in_Ah, 3);
  const labels = {
    form_factor: "电池形态", cathode_material: "正极材料", anode_material: "负极材料",
    electrolyte_material: "电解液", nominal_capacity_in_Ah: "标称容量 (Ah)",
    SOC_interval: "SOC 区间",
    min_voltage_limit_in_V: "最低电压 (V)", max_voltage_limit_in_V: "最高电压 (V)",
    charge_protocol: "充电协议", discharge_protocol: "放电协议",
  };
  const grid = $("metadataGrid"); grid.replaceChildren();
  for (const [key, label] of Object.entries(labels)) {
    const box = document.createElement("div"); const dt = document.createElement("dt"); const dd = document.createElement("dd");
    box.className = key.endsWith("_protocol") ? "metadata-fact metadata-protocol" : "metadata-fact";
    dt.textContent = label;
    const value = s.metadata[key];
    if (key.endsWith("_protocol")) {
      const indexed = state.protocolCells?.get(`${s.source}\u0000${s.name}`);
      if (indexed) window.BatteryLifeProtocol.render(dd, indexed[key]);
      else if (state.protocolCells) window.BatteryLifeProtocol.render(dd, value);
      else dd.textContent = "正在读取协议…";
    }
    else if (key === "SOC_interval") dd.textContent = value == null || Array.isArray(value) && !value.length
      ? "未提供" : JSON.stringify(value);
    else dd.textContent = formatMetadata(value);
    box.append(dt, dd); grid.append(box);
  }
}

function capacityPoints(summary) {
  if (!summary) return [];
  const divisor = state.unit === "relative" ? summary.first_discharge_ah : 1;
  if (!divisor) return [];
  return summary.cycles.filter((row) => Number.isFinite(row[0]) && Number.isFinite(row[1]))
    .map((row) => [row[0], state.unit === "relative" ? row[1] / divisor * 100 : row[1]]);
}

function capacityPointForIndex(index) {
  const summary = state.summary;
  const row = summary?.cycles[index];
  if (!row || !Number.isFinite(row[0]) || !Number.isFinite(row[1])) return null;
  const divisor = state.unit === "relative" ? summary.first_discharge_ah : 1;
  if (!Number.isFinite(divisor) || divisor <= 0) return null;
  return { x: row[0], y: state.unit === "relative" ? row[1] / divisor * 100 : row[1] };
}

function capacityValueDescription(index) {
  const point = capacityPointForIndex(index);
  return point ? state.unit === "relative"
    ? `相对首个有效放电容量 ${fmt(point.y, 1)}%`
    : `最大放电容量 ${fmt(point.y, 4)} Ah`
    : "该圈无有效放电容量，容量图不显示红点";
}

function updateCapacitySelectionStatus() {
  const canvas = $("capacityChart");
  const order = state.capacityOrder;
  const selected = state.cycleMode === "single" ? state.currentCycleIndex : null;
  const pending = state.capacityPendingIndex;
  const preview = state.capacityPreviewIndex;
  const current = pending ?? preview ?? selected;
  canvas.tabIndex = order.length ? 0 : -1;
  canvas.setAttribute("aria-disabled", String(!order.length));
  if (order.length) {
    canvas.setAttribute("aria-valuemin", String(order[0].number));
    canvas.setAttribute("aria-valuemax", String(order.at(-1).number));
    canvas.setAttribute("aria-valuenow", String(state.summary.cycles[current ?? order[0].index][0]));
    canvas.setAttribute("aria-valuetext", `Cycle ${fmt(state.summary.cycles[current ?? order[0].index][0])}`);
  } else {
    for (const name of ["aria-valuemin", "aria-valuemax", "aria-valuenow", "aria-valuetext"])
      canvas.removeAttribute(name);
  }
  $("capacitySelectionLegend").hidden = selected == null || !capacityPointForIndex(selected);
  const status = $("capacitySelectionStatus");
  if (!state.summary) status.textContent = "选择电池后，可在容量图中点击或拖动选圈。";
  else if (!order.length) status.textContent = "当前电池没有可选的实际 Cycle 编号。";
  else if (state.capacitySelectionError) status.textContent = state.capacitySelectionError;
  else if (pending != null) status.textContent = `正在读取 Cycle ${fmt(state.summary.cycles[pending][0])}；读取成功后红点和下方采样曲线将同步更新。`;
  else if (preview != null) status.textContent = `预览 Cycle ${fmt(state.summary.cycles[preview][0])} · ${capacityValueDescription(preview)}；点击或拖动后松开以查看采样。`;
  else if (selected != null) status.textContent = `当前 Cycle ${fmt(state.summary.cycles[selected][0])} · ${capacityValueDescription(selected)}；下方显示该圈采样。`;
  else status.textContent = "在当前电池曲线附近悬停预览实际 Cycle，点击或拖动选圈；聚焦图表后可用左右方向键逐圈查看。";
}

function capacityFullMax(series, vertical = []) {
  let max = 0;
  for (const item of series) for (const [x, y] of item.points) {
    if (Number.isFinite(x) && Number.isFinite(y)) max = Math.max(max, x);
  }
  const markerMax = Math.max(0, ...vertical.map((marker) => marker.value));
  return markerMax > max ? markerMax + Math.max(1, markerMax * .02) : max;
}

function clampCapacityZoom(domain, fullMax) {
  if (!domain || !(fullMax > 0)) return null;
  const span = Math.min(domain[1] - domain[0], fullMax);
  if (!(span > 0)) return null;
  const min = Math.max(0, Math.min(domain[0], fullMax - span));
  return [min, min + span];
}

function updateCapacityZoomControls() {
  const bounds = charts.capacity.bounds;
  $("capacityZoomReset").hidden = !state.capacityZoom;
  $("capacityZoomStatus").textContent = bounds
    ? `${state.capacityZoom ? "局部缩放" : "当前范围"}：Cycle ${fmt(bounds.minX, 1)}–${fmt(bounds.maxX, 1)}；图内滚轮向上放大、向下缩小。`
    : "鼠标置于容量图内，滚轮向上放大、向下缩小 Cycle 范围。";
}

function zoomCapacity(event) {
  const bounds = charts.capacity.bounds;
  if (!state.summary || !bounds || !event.deltaY) return;
  const rect = charts.capacity.canvas.getBoundingClientRect();
  const pixelX = event.clientX - rect.left;
  const pixelY = event.clientY - rect.top;
  if (pixelX < bounds.pad.left || pixelX > bounds.width - bounds.pad.right ||
      pixelY < bounds.pad.top || pixelY > bounds.height - bounds.pad.bottom) return;
  const currentPoints = capacityPoints(state.summary);
  if (currentPoints.length < 2) return;
  const fullMax = Math.max(capacityFullMax(charts.capacity.spec.series, charts.capacity.spec.vertical),
    detailedCycleEnd(state.summary) || 0);
  if (!(fullMax > 0)) return;
  event.preventDefault();
  const ratio = (pixelX - bounds.pad.left) / bounds.plotWidth;
  const span = bounds.maxX - bounds.minX;
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1);
  const step = Math.max(-1, Math.min(1, delta / 100));
  const nextSpan = Math.min(fullMax, span * Math.pow(1.2, step));
  const anchor = bounds.minX + ratio * span;
  const nextDomain = clampCapacityZoom([anchor - ratio * nextSpan, anchor + (1 - ratio) * nextSpan], fullMax);
  if (!nextDomain || currentPoints.filter(([x]) => x >= nextDomain[0] && x <= nextDomain[1]).length < 2) return;
  if (Math.abs(nextDomain[0] - bounds.minX) < 1e-8 && Math.abs(nextDomain[1] - bounds.maxX) < 1e-8) return;
  state.capacityZoom = state.window === "all" && nextDomain[0] === 0 && nextDomain[1] === fullMax ? null : nextDomain;
  renderCapacity();
}

function eolWithinDetailedRange(summary) {
  if (summary?.label == null || !Number.isFinite(Number(summary.label))) return false;
  let first = Infinity, last = -Infinity;
  for (const row of summary.cycles) {
    if (!Number.isFinite(row[0])) continue;
    first = Math.min(first, row[0]); last = Math.max(last, row[0]);
  }
  return Number(summary.label) >= first && Number(summary.label) <= last;
}

function validEolCycle(summary) {
  const label = Number(summary?.label);
  return summary?.label != null && Number.isFinite(label) && label > 0 ? label : null;
}

function detailedCycleEnd(summary) {
  let last = null;
  for (const row of summary?.cycles || []) {
    if (Number.isFinite(row[0])) last = last == null ? row[0] : Math.max(last, row[0]);
  }
  return last;
}

function renderCapacity() {
  const s = state.summary;
  if (!s) { charts.capacity.set({ series: [] }); updateCapacityZoomControls(); updateCapacitySelectionStatus(); return; }
  const isCalb = s.source === "CALB";
  const relative = state.unit === "relative";
  const baseline = s.first_discharge_ah;
  const currentEol = validEolCycle(s);
  const compareEol = validEolCycle(state.compareSummary);
  const currentEolRecorded = eolWithinDetailedRange(s);
  const vertical = [];
  if (currentEol != null && compareEol != null && currentEol === compareEol) {
    vertical.push({ value: currentEol, color: SITE.chartColors.primary,
      secondColor: SITE.chartColors.comparisonLine, label: `两电池 EOL：${fmt(s.label)}` });
  } else {
    if (currentEol != null) vertical.push({ value: currentEol, color: SITE.chartColors.primary, label: "EOL" });
    if (compareEol != null) vertical.push({ value: compareEol,
      color: SITE.chartColors.comparisonLine, label: "对照 EOL" });
  }
  const series = [{ name: `${s.source} / ${s.name.replace(/\.pkl$/, "")}`, color: SITE.chartColors.primary, points: capacityPoints(s), lineWidth: 1.9 }];
  if (state.compareSummary) series.push({ name: `${state.compareSummary.source} / ${state.compareSummary.name.replace(/\.pkl$/, "")}`, color: SITE.chartColors.comparisonLine, points: capacityPoints(state.compareSummary), lineWidth: 1.8 });
  const eolWindowAvailable = currentEol != null;
  document.querySelector('[data-window="eol"]').disabled = !eolWindowAvailable;
  document.querySelector('[data-jump="eol"]').disabled = !currentEolRecorded;
  if (state.window === "eol" && !eolWindowAvailable) state.window = "early";
  document.querySelector('[data-window="early"]').textContent = `前 ${fmt(state.visibleCycles)} cycle`;
  const recordedMax = Math.max(capacityFullMax(series), detailedCycleEnd(s) || 0);
  const fullMax = capacityFullMax(series, vertical);
  const domainMax = Math.max(fullMax, recordedMax);
  state.capacityZoom = clampCapacityZoom(state.capacityZoom, domainMax);
  document.querySelectorAll("[data-window]").forEach((button) => button.classList.toggle("active", !state.capacityZoom && button.dataset.window === state.window));
  const xDomain = state.capacityZoom || (state.window === "early" ? [0, state.visibleCycles]
    : state.window === "eol" ? [Math.max(0, currentEol - 200), currentEol + 200]
      : domainMax > capacityFullMax(series) ? [0, domainMax] : null);
  const selectedIndex = state.cycleMode === "single" ? state.currentCycleIndex : null;
  const previewIndex = state.capacityPendingIndex ?? state.capacityPreviewIndex;
  charts.capacity.set({ series, vertical, shadeUntil: state.visibleCycles, startAtZero: true, nonnegative: true,
    xUnit: "cycle", valueDigits: relative ? 1 : 4, xDomain, showEmptyDomain: true,
    selectedPoint: selectedIndex == null ? null : capacityPointForIndex(selectedIndex),
    previewPoint: previewIndex == null || previewIndex === selectedIndex ? null : capacityPointForIndex(previewIndex) });
  updateCapacityZoomControls();
  updateCapacitySelectionStatus();
  $("eolLegend").hidden = !eolWindowAvailable || (xDomain != null && (currentEol < xDomain[0] || currentEol > xDomain[1]));
  $("compareEolLegend").hidden = compareEol == null ||
    (xDomain != null && (compareEol < xDomain[0] || compareEol > xDomain[1]));
  $("compareLegend").hidden = !state.compareSummary;
  $("compareLegendName").textContent = state.compareSummary ? `对照：${state.compareSummary.source}` : "对照电池";
  const last = detailedCycleEnd(s);
  let note;
  if (isCalb) {
    const first = s.cycles[0]?.[0];
    const range = first == null || last == null ? "暂无详细曲线" : `详细曲线仅覆盖 Cycle ${fmt(first)}–${fmt(last)}（${fmt(s.cycle_count)} 条）`;
    note = `${range}。仓库提供的 CALB 标签提取方法使用另一份容量记录与 90% SOH；现有标签文件未记录逐电池生成方式。`;
    if (currentEol != null && last != null && currentEol > last) note += ` EOL 标签位于 Cycle ${fmt(currentEol)}；Cycle ${fmt(last)} 之后至标签位置没有详细容量记录。`;
  } else {
    note = currentEol != null && last != null && currentEol > last
      ? `当前电池详细曲线到 Cycle ${fmt(last)}；EOL 标签位于 Cycle ${fmt(currentEol)}，其间没有详细容量记录。`
      : "";
  }
  const compareLast = detailedCycleEnd(state.compareSummary);
  if (compareEol != null && compareLast != null && compareEol > compareLast)
    note += ` 对照电池详细曲线到 Cycle ${fmt(compareLast)}；对照 EOL 标签位于 Cycle ${fmt(compareEol)}，其间没有详细容量记录。`;
  if (eolWindowAvailable) note += " 绿色竖虚线表示当前电池原有 EOL 标签。";
  else if (s.label == null) note += " 数据集未提供 EOL 标签。";
  if (compareEol != null) note += " 黄色系竖虚线表示对照电池原有 EOL 标签。";
  if (vertical.length) note += " 虚线不是容量测量点。";
  if (xDomain && !series.some((item) => item.points.some(([x]) => x >= xDomain[0] && x <= xDomain[1])))
    note += " 此范围无详细容量记录。";
  if (!baseline && relative) note += " 当前电池没有有效放电容量，无法计算相对容量。";
  if (state.window === "early" && !state.capacityZoom) note += " 前 N 个 cycle 视图保留曲线细节。";
  if (state.compareSummary && state.compareSummary.source !== s.source) {
    note += relative
      ? " 跨来源曲线按各自首个有效放电容量归一化；测试条件仍可能不同。"
      : " 跨来源电池的容量规格可能不同，建议切换到“相对首个有效放电容量 %”查看。";
  }
  $("capacityNote").textContent = note.trim();
}

function applyChartSettings() {
  const cyclesText = $("visibleCyclesInput").value.trim();
  const visibleCycles = Number(cyclesText);
  const message = $("chartSettingsMessage");
  if (!cyclesText || !Number.isInteger(visibleCycles) || visibleCycles < 1 || visibleCycles > 1000000) {
    message.textContent = "可见 cycle 数请输入 1～1,000,000 之间的整数。";
    return;
  }
  if (visibleCycles !== state.visibleCycles) state.window = "early";
  state.visibleCycles = visibleCycles;
  state.capacityZoom = null;
  message.textContent = "";
  renderCapacity();
}

async function selectCompare(cell) {
  const token = ++state.compareToken;
  const source = state.compareSource;
  state.compare = cell || null; state.compareSummary = null;
  renderCapacity();
  if (!cell) return;
  notice("正在读取对照电池…");
  try {
    const summary = await api(SITE.api.summary, { source, cell });
    if (token !== state.compareToken) return;
    state.compareSummary = summary; renderCapacity(); notice("");
  } catch (error) {
    if (token === state.compareToken) { notice(error.message, true); state.compare = null; $("compareSelect").value = ""; }
  }
}

function selectCompareSource(source) {
  ++state.compareToken;
  state.compareSource = source;
  state.compare = null;
  state.compareSummary = null;
  renderCompareChoices();
  renderCapacity();
  notice("");
}

let cycleTimer = null;

function cancelMultiCycleLoad() {
  ++state.multiToken;
  state.multiAbortController?.abort();
  state.multiAbortController = null;
}

function setCycleMode(mode, preferredIndex = null) {
  if (mode !== "multi" && mode !== "single") return;
  if (state.cycleMode !== mode) {
    cancelMultiCycleLoad();
    cancelIncrementalLoad();
    ++state.cycleToken;
    ++state.compareCycleToken;
    clearTimeout(cycleTimer);
  }
  state.capacityPreviewIndex = null;
  if (mode === "multi") state.capacityPendingIndex = null;
  state.cycleMode = mode;
  $("multiCycleControls").hidden = mode !== "multi";
  $("singleCycleControls").hidden = mode !== "single";
  $("incrementalPanel").hidden = mode !== "single";
  $("cycleDetailGrid").classList.toggle("multi-view", mode === "multi");
  $("multiCycleColorbar").hidden = mode !== "multi" || !state.multiSelection.length;
  $("cycleCompareLegend").hidden = mode !== "single" || !state.compareCycleData;
  document.querySelectorAll("[data-cycle-mode]").forEach((button) => {
    const active = button.dataset.cycleMode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  $("cycleCapacityHeading").textContent = mode === "single" ? "充放电容量"
    : state.multiCapacitySignal === "charge" ? "充电容量" : "放电容量";
  renderCapacity();
  if (!state.summary) return;
  if (mode === "multi") loadMultiCycles();
  else if (preferredIndex != null && preferredIndex !== state.currentCycleIndex) loadCycle(preferredIndex);
  else if (preferredIndex != null && !state.currentCycleData) loadCycle(preferredIndex);
  else if (state.currentCycleData) { renderCycleCharts(); updateCycleNote(); loadIncrementalData(); }
  else loadCycle(0);
}

function capacityCurveY(number) {
  const points = charts.capacity.spec?.series?.[0]?.points || [];
  if (!points.length || number < points[0][0] || number > points.at(-1)[0]) return null;
  let lo = 0, hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] < number) lo = mid + 1;
    else hi = mid;
  }
  const right = points[lo], left = points[Math.max(0, lo - 1)];
  if (right === left || right[0] === left[0]) return right[1];
  const fraction = Math.max(0, Math.min(1, (number - left[0]) / (right[0] - left[0])));
  return left[1] + (right[1] - left[1]) * fraction;
}

function capacityIndexAtPointer(event, dragging = false) {
  const bounds = charts.capacity.bounds;
  const order = state.capacityOrder;
  if (!state.summary || !bounds || !order.length) return null;
  const rect = charts.capacity.canvas.getBoundingClientRect();
  const pixelX = event.clientX - rect.left;
  const pixelY = event.clientY - rect.top;
  if (pixelX < bounds.pad.left || pixelX > bounds.width - bounds.pad.right ||
      pixelY < bounds.pad.top || pixelY > bounds.pad.top + bounds.plotHeight) return null;
  const number = bounds.minX + (pixelX - bounds.pad.left) / bounds.plotWidth * (bounds.maxX - bounds.minX);
  if (number < order[0].number || number > order.at(-1).number) return null;
  if (!dragging) {
    const curveY = capacityCurveY(number);
    if (!Number.isFinite(curveY) || Math.abs(bounds.toY(curveY) - pixelY) > 28) return null;
  }
  let lo = 0, hi = order.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (order[mid].number < number) lo = mid + 1;
    else hi = mid;
  }
  const previous = Math.max(0, lo - 1);
  return Math.abs(order[previous].number - number) <= Math.abs(order[lo].number - number)
    ? order[previous].index : order[lo].index;
}

function previewCapacityIndex(index) {
  if (state.capacityPreviewIndex === index) return;
  state.capacityPreviewIndex = index;
  if (index != null) state.capacitySelectionError = "";
  if (charts.capacity.spec) {
    charts.capacity.spec.previewPoint = index == null || index === state.currentCycleIndex && state.cycleMode === "single"
      ? null : capacityPointForIndex(index);
    charts.capacity.draw();
  }
  updateCapacitySelectionStatus();
}

function chooseCapacityIndex(index) {
  if (!state.summary || !state.capacityOrder.some((row) => row.index === index)) return;
  clearTimeout(cycleTimer);
  state.capacityPreviewIndex = null;
  state.capacitySelectionError = "";
  if (state.cycleMode !== "single") setCycleMode("single", index);
  else if (index === state.currentCycleIndex && state.currentCycleData) {
    ++state.cycleToken;
    state.capacityPendingIndex = null;
    $("cycleSlider").value = String(index);
    $("cycleNumberInput").value = String(state.summary.cycles[index][0]);
    renderCapacity();
  } else loadCycle(index);
}

function capacityPointerDown(event) {
  if (event.button !== 0 || state.capacityPointerId != null) return;
  const index = capacityIndexAtPointer(event);
  if (index == null) return;
  state.capacityPointerId = event.pointerId;
  $("capacityChart").focus({ preventScroll: true });
  $("capacityChart").setPointerCapture(event.pointerId);
  previewCapacityIndex(index);
  event.preventDefault();
}

function capacityPointerMove(event) {
  if (state.capacityPointerId != null && event.pointerId !== state.capacityPointerId) return;
  const index = capacityIndexAtPointer(event, state.capacityPointerId != null);
  if (index != null || state.capacityPointerId == null) previewCapacityIndex(index);
}

function capacityPointerEnd(event) {
  if (event.pointerId !== state.capacityPointerId) return;
  const index = capacityIndexAtPointer(event, true) ?? state.capacityPreviewIndex;
  state.capacityPointerId = null;
  if ($("capacityChart").hasPointerCapture(event.pointerId))
    $("capacityChart").releasePointerCapture(event.pointerId);
  previewCapacityIndex(null);
  if (index != null) chooseCapacityIndex(index);
}

function capacityPointerCancel(event) {
  if (event.pointerId !== state.capacityPointerId) return;
  state.capacityPointerId = null;
  previewCapacityIndex(null);
}

function scheduleCapacityCycle(index) {
  const summary = state.summary;
  if (!summary || state.cycleMode !== "single") return;
  clearTimeout(cycleTimer);
  ++state.cycleToken;
  state.capacityPendingIndex = index;
  state.capacityPreviewIndex = null;
  state.capacitySelectionError = "";
  $("cycleSlider").value = String(index);
  $("cycleNumberInput").value = String(summary.cycles[index][0]);
  $("cycleNote").textContent = `正在选择 Cycle ${fmt(summary.cycles[index][0])}…`;
  renderCapacity();
  cycleTimer = setTimeout(() => {
    if (state.summary === summary && state.cycleMode === "single") loadCycle(index);
  }, 110);
}

function capacityKeyDown(event) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  const order = state.capacityOrder;
  if (!order.length) return;
  event.preventDefault();
  const base = state.capacityPendingIndex ?? state.currentCycleIndex;
  const position = base == null ? -1 : order.findIndex((row) => row.number === state.summary.cycles[base][0]);
  const next = base == null ? 0 : Math.max(0, Math.min(order.length - 1,
    position + (event.key === "ArrowRight" ? 1 : -1)));
  const index = order[next].index;
  if (index === base && state.currentCycleData && state.capacityPendingIndex == null) return;
  if (state.cycleMode !== "single") chooseCapacityIndex(index);
  else scheduleCapacityCycle(index);
}

function ensureCapacitySelectionVisible(index) {
  const bounds = charts.capacity.bounds;
  const number = state.summary?.cycles[index]?.[0];
  if (!bounds || !Number.isFinite(number) || number >= bounds.minX && number <= bounds.maxX) return false;
  const fullMax = Math.max(capacityFullMax(charts.capacity.spec.series, charts.capacity.spec.vertical),
    detailedCycleEnd(state.summary) || 0);
  const span = Math.min(bounds.maxX - bounds.minX, fullMax);
  if (!(span > 0)) return false;
  const start = number < bounds.minX ? number - span * .12 : number - span * .88;
  state.capacityZoom = clampCapacityZoom([start, start + span], fullMax);
  renderCapacity();
  return true;
}

function recordedCyclesInRange(summary, start, end) {
  const rows = summary.cycles.map((row, index) => ({ number: row[0], index }))
    .filter((row) => Number.isInteger(row.number) && row.number >= start && row.number <= end)
    .sort((a, b) => a.number - b.number || a.index - b.index);
  return rows.filter((row, index) => index === 0 || row.number !== rows[index - 1].number);
}

function updateMultiResetButton() {
  const range = state.multiFullRange;
  $("multiRangeReset").disabled = !range ||
    ($("multiStartInput").value === String(range.start) &&
      $("multiEndInput").value === String(range.end));
}

function restoreMultiRange() {
  const range = state.multiFullRange;
  if (!range) return;
  $("multiStartInput").value = String(range.start);
  $("multiEndInput").value = String(range.end);
  updateMultiResetButton();
  loadMultiCycles();
}

function selectRecordedCycles(available, count = 100) {
  if (available.length <= count) return available;
  const chosen = new Set();
  for (let i = 0; i < count; i++) {
    const target = available[0].number + (available.at(-1).number - available[0].number) * i / (count - 1);
    let best = -1;
    for (let j = 0; j < available.length; j++) {
      if (chosen.has(j)) continue;
      if (best < 0 || Math.abs(available[j].number - target) < Math.abs(available[best].number - target)) best = j;
    }
    chosen.add(best);
  }
  return [...chosen].sort((a, b) => a - b).map((index) => available[index]);
}

function multiColor(number) {
  const selected = state.multiSelection;
  const first = selected[0]?.number ?? number;
  const last = selected.at(-1)?.number ?? number;
  const position = last === first ? 0 : Math.max(0, Math.min(1, (number - first) / (last - first)));
  const palette = SITE.chartColors.cycleGradient;
  const from = position <= .5 ? palette.low : palette.mid;
  const to = position <= .5 ? palette.mid : palette.high;
  const fraction = position <= .5 ? position * 2 : (position - .5) * 2;
  const channels = [1, 3, 5].map((offset) => Math.round(
    parseInt(from.slice(offset, offset + 2), 16) * (1 - fraction) +
    parseInt(to.slice(offset, offset + 2), 16) * fraction,
  ));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function updateMultiSelectionDisplay() {
  const selected = state.multiSelection;
  $("multiCycleDetails").hidden = !selected.length;
  $("multiCycleNumbers").textContent = selected.map((item) => fmt(item.number)).join("、");
  $("multiCycleColorbar").hidden = !selected.length || state.cycleMode !== "multi";
  if (!selected.length) return;
  const first = selected[0].number, last = selected.at(-1).number;
  $("multiCycleColorbar").classList.toggle("single", first === last);
  $("multiColorbarMin").textContent = fmt(first);
  $("multiColorbarMid").textContent = first === last ? "" : fmt(Math.round((first + last) / 2));
  $("multiColorbarMax").textContent = first === last ? "" : fmt(last);
  $("multiCycleColorbar").setAttribute("aria-label", `Cycle 编号色条：蓝色 Cycle ${fmt(first)}，红色 Cycle ${fmt(last)}`);
}

function updateMultiMessage(loading) {
  const selectedCount = state.multiSelection.length;
  const fields = [1, 2, state.multiCapacitySignal === "charge" ? 3 : 4];
  const drawn = state.multiRecords.filter((entry) => entry.cycle &&
    fields.some((field) => multiPlotPoints(entry.cycle, field).length >= 2)).length;
  const failed = state.multiRecords.filter((entry) => entry.error);
  let message = `已绘制 ${fmt(drawn)} 条／范围内 ${fmt(state.multiAvailableCount)} 条已记录 Cycle`;
  if (state.multiAvailableCount > selectedCount) message += `（均匀选取 ${fmt(selectedCount)} 条）`;
  if (loading) message += `；已读取 ${fmt(state.multiFinishedCount)}/${fmt(selectedCount)} 条`;
  message += "。";
  if (failed.length) message += ` 读取失败：${failed.map((entry) => `Cycle ${fmt(entry.number)}`).join("、")}。`;
  $("multiCycleMessage").textContent = message;
}

function hasMinuteData(cycle) {
  if (cycle.time_unit !== "min") return false;
  let valid = 0;
  for (const row of cycle.points) if (Number.isFinite(row[0]) && ++valid >= 2) return true;
  return false;
}

function multiPlotPoints(cycle, field) {
  if (!hasMinuteData(cycle)) return [];
  return cycle.points.map((row) => [row[0], row[field]])
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

function setCycleAxisLabels(text) {
  document.querySelectorAll("#cycleDetailGrid .mini-axis-label").forEach((label) => { label.textContent = text; });
}

function renderMultiCycleCharts() {
  if (state.cycleMode !== "multi") return;
  const field = state.multiCapacitySignal === "charge" ? 3 : 4;
  let maxMinute = 0;
  const timedDurations = [];
  for (const entry of state.multiRecords) {
    if (!entry.cycle || !hasMinuteData(entry.cycle)) continue;
    if (![1, 2, field].some((column) => multiPlotPoints(entry.cycle, column).length >= 2)) continue;
    let lastMinute = 0;
    for (const row of entry.cycle.points) {
      if (Number.isFinite(row[0]) && [1, 2, field].some((column) => Number.isFinite(row[column]))) {
        lastMinute = Math.max(lastMinute, row[0]);
      }
    }
    maxMinute = Math.max(maxMinute, lastMinute);
    timedDurations.push({ number: entry.number, minutes: lastMinute });
  }
  const xDomain = [0, Math.max(1, maxMinute)];
  const series = (column, label) => state.multiRecords.filter((entry) => entry.cycle).map((entry) => ({
    name: `Cycle ${fmt(entry.number)} · ${label}`,
    color: multiColor(entry.number),
    points: multiPlotPoints(entry.cycle, column), lineWidth: 1.15, opacity: .5,
  })).filter((entry) => entry.points.length >= 2);
  charts.voltage.set({ series: series(1, "电压"), xDomain, xUnit: "分钟", valueDigits: 3, hoverMode: "nearest" });
  charts.current.set({ series: series(2, "电流"), xDomain, zeroLine: true, xUnit: "分钟", valueDigits: 3, hoverMode: "nearest" });
  charts.cycleCapacity.set({ series: series(field, state.multiCapacitySignal === "charge" ? "充电容量" : "放电容量"),
    xDomain, nonnegative: true, xUnit: "分钟", valueDigits: 4, hoverMode: "nearest" });
  setCycleAxisLabels("时间 / 分钟");
  $("cycleCapacityHeading").textContent = state.multiCapacitySignal === "charge" ? "充电容量" : "放电容量";
  const missingTime = state.multiRecords.filter((entry) => entry.cycle && !hasMinuteData(entry.cycle))
    .map((entry) => fmt(entry.number));
  const missing = [
    ["电压", 1], ["电流", 2], [state.multiCapacitySignal === "charge" ? "充电容量" : "放电容量", field],
  ].map(([label, column]) => ({ label, numbers: state.multiRecords.filter((entry) =>
    entry.cycle && hasMinuteData(entry.cycle) && multiPlotPoints(entry.cycle, column).length < 2)
    .map((entry) => fmt(entry.number)) }))
    .filter((item) => item.numbers.length);
  let note = "颜色由蓝色（较小 Cycle）过渡到红色（较大 Cycle），色条标注实际 Cycle 编号。横轴为每圈从首个采样时间起计算的分钟数，保留各圈实际时长；每圈最多展示约 1,800 个采样点。";
  if (timedDurations.length >= 3) {
    const sorted = timedDurations.map((item) => item.minutes).sort((a, b) => a - b);
    const middle = sorted[Math.floor(sorted.length / 2)];
    if (middle > 0 && maxMinute > middle * 2) {
      const longest = timedDurations.find((item) => item.minutes === maxMinute);
      note += ` Cycle ${fmt(longest.number)} 的时间范围约 ${fmt(maxMinute, 1)} 分钟，较短曲线会集中在左侧。`;
    }
  }
  if (missingTime.length) note += ` 缺少可用分钟时间（未绘制）：Cycle ${missingTime.join("、")}。`;
  if (missing.length) note += ` 缺少可显示信号：${missing.map((item) => `${item.label}（Cycle ${item.numbers.join("、")}）`).join("；")}。`;
  $("cycleNote").textContent = note;
}

async function loadMultiCycles() {
  updateMultiResetButton();
  cancelMultiCycleLoad();
  const token = state.multiToken;
  state.multiSelection = [];
  state.multiRecords = [];
  state.multiAvailableCount = 0;
  state.multiFinishedCount = 0;
  updateMultiSelectionDisplay();
  for (const chart of [charts.voltage, charts.current, charts.cycleCapacity]) chart.set({ series: [] });
  setCycleAxisLabels("时间 / 分钟");
  const summary = state.summary;
  const message = $("multiCycleMessage");
  if (!summary?.cycle_count || state.cycleMode !== "multi") { message.textContent = "当前电池没有详细 Cycle 记录。"; return; }
  const start = Number($("multiStartInput").value);
  const end = Number($("multiEndInput").value);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    message.textContent = "请输入有效的起止 Cycle，且起始编号不大于结束编号。";
    $("cycleNote").textContent = "修改范围后点击“显示曲线”。";
    return;
  }
  const available = recordedCyclesInRange(summary, start, end);
  const selected = selectRecordedCycles(available);
  state.multiAvailableCount = available.length;
  state.multiSelection = selected;
  updateMultiSelectionDisplay();
  if (!selected.length) {
    message.textContent = `Cycle ${fmt(start)}–${fmt(end)} 内没有详细记录，请调整范围。`;
    $("cycleNote").textContent = "只会读取实际记录的 Cycle，不补齐缺失编号。";
    return;
  }
  state.multiRecords = selected.map((item) => ({ ...item, cycle: null, error: null }));
  updateMultiMessage(true);
  $("cycleNote").textContent = "正在读取所选 Cycle 的采样记录…";
  const controller = new AbortController();
  state.multiAbortController = controller;
  const active = () => token === state.multiToken && state.summary === summary &&
    state.cycleMode === "multi" && !controller.signal.aborted;
  async function readCycle(item) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await api(SITE.api.cycle,
          { source: summary.source, cell: summary.name, index: item.index }, controller.signal);
      } catch (error) {
        if (!active() || !(error instanceof TypeError) || attempt >= 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  }
  let next = 0;
  async function worker() {
    while (active() && next < selected.length) {
      const order = next++;
      const item = selected[order];
      try {
        const cycle = await readCycle(item);
        if (!active()) return;
        state.multiRecords[order].cycle = cycle;
      } catch (error) {
        if (!active()) return;
        state.multiRecords[order].error = error.message || "读取失败";
      }
      if (!active()) return;
      ++state.multiFinishedCount;
      if (state.multiFinishedCount % 25 === 0 || state.multiFinishedCount === selected.length) {
        updateMultiMessage(state.multiFinishedCount < selected.length);
        renderMultiCycleCharts();
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, selected.length) }, worker));
  if (active()) state.multiAbortController = null;
}

function cyclePlotPoints(cycle, field, useSampleNumbers) {
  return cycle.points.map((row, index) => [
    useSampleNumbers ? (cycle.sample_indices?.[index] ?? index) : row[0], row[field],
  ]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

function renderCycleCharts() {
  if (state.cycleMode !== "single") return;
  const current = state.currentCycleData;
  if (!current) return;
  const reference = state.compareCycleData;
  const useSampleNumbers = !!reference && (current.time_unit !== "min" || reference.time_unit !== "min");
  const xUnit = useSampleNumbers || current.time_unit !== "min" ? "采样点" : "分钟";
  setCycleAxisLabels(xUnit === "分钟" ? "时间 / 分钟" : "采样点");
  const series = (field, color, label) => [
    { name: `当前 Cycle ${fmt(current.number)} · ${label}`, color,
      points: cyclePlotPoints(current, field, useSampleNumbers), lineWidth: 2 },
    ...(reference ? [{ name: `对照 Cycle ${fmt(reference.number)} · ${label}`, color,
      points: cyclePlotPoints(reference, field, useSampleNumbers), lineWidth: 1.9, dash: [7, 4] }] : []),
  ];
  charts.voltage.set({ series: series(1, SITE.chartColors.voltage, "电压"), startAtZero: true, xUnit, valueDigits: 3 });
  charts.current.set({ series: series(2, SITE.chartColors.current, "电流"), startAtZero: true, zeroLine: true, xUnit, valueDigits: 3 });
  charts.cycleCapacity.set({ series: [
    ...series(3, SITE.chartColors.chargeCapacity, "充电容量"),
    ...series(4, SITE.chartColors.dischargeCapacity, "放电容量"),
  ], startAtZero: true, nonnegative: true, xUnit, valueDigits: 4 });
  $("cycleCompareLegend").hidden = !reference;
  if (reference) {
    $("cycleCurrentLegendText").textContent = `当前 Cycle ${fmt(current.number)} · 实线`;
    $("cycleReferenceLegendText").textContent = `对照 Cycle ${fmt(reference.number)} · 虚线`;
  }
}

function cancelIncrementalLoad() {
  ++state.incrementalToken;
  state.incrementalController?.abort();
  state.incrementalController = null;
  state.incrementalCurrent = null;
  state.incrementalReference = null;
  state.incrementalErrors = {};
}

function incrementalStatusText(role, cycle, data, error) {
  if (!cycle) return "当前 Cycle：尚未选择。";
  const prefix = `${role} Cycle ${fmt(cycle.number)}`;
  if (error) return `${prefix}：${error}`;
  if (!data) return `${prefix}：正在从完整采样记录计算…`;
  return ["charge", "discharge"].map((phase) => {
    const value = data[phase];
    const label = phase === "charge" ? "充电" : "放电";
    return value.status === "ready"
      ? `${label}可绘制（${fmt(value.sample_count)} 个采样点，电压 ${fmt(value.voltage_range_V[0], 3)}–${fmt(value.voltage_range_V[1], 3)} V，${fmt(value.derivative_bins)} 个连续差分区间）`
      : `${label}不可计算：${value.reason}`;
  }).map((description) => `${prefix} · ${description}`).join("\n");
}

function renderIncrementalChart() {
  const phase = state.incrementalPhase;
  const discharge = phase === "discharge";
  $("incrementalFormula").textContent = discharge ? "放电 −dQ/dV（Ah/V，显示正值）" : "充电 dQ/dV（Ah/V）";
  $("incrementalCurrentLegend").textContent = state.currentCycleData
    ? `当前 Cycle ${fmt(state.currentCycleData.number)} · 实线` : "当前 Cycle";
  $("incrementalReferenceLegend").hidden = !state.compareCycleData;
  $("incrementalReferenceText").textContent = state.compareCycleData
    ? `对照 Cycle ${fmt(state.compareCycleData.number)} · 虚线` : "对照 Cycle";
  document.querySelectorAll("[data-incremental-phase]").forEach((button) => {
    const active = button.dataset.incrementalPhase === phase;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const series = [];
  for (const [role, cycle, data, color, dash] of [
    ["当前", state.currentCycleData, state.incrementalCurrent, SITE.chartColors.primary, null],
    ["对照", state.compareCycleData, state.incrementalReference, SITE.chartColors.comparisonLine, [7, 4]],
  ]) {
    const result = data?.[phase];
    if (cycle && result?.status === "ready") {
      series.push({ name: `${role} Cycle ${fmt(cycle.number)}`, color,
        points: result.points, lineWidth: 2.2, dash });
    }
  }
  charts.incremental.set({ series, nonnegative: true, xUnit: "V", xDigits: 3,
    valueDigits: 4, hoverMode: "nearest" });
  const status = $("incrementalStatus");
  status.replaceChildren();
  if (state.capacityPendingIndex != null && state.cycleMode === "single") {
    const pending = state.summary?.cycles[state.capacityPendingIndex]?.[0];
    const item = document.createElement("p");
    item.textContent = `正在读取 Cycle ${fmt(pending)} 的采样；新记录读取完成后计算 dQ/dV。`;
    status.append(item);
    return;
  }
  for (const [role, cycle, data, error] of [
    ["当前", state.currentCycleData, state.incrementalCurrent, state.incrementalErrors.current],
    ["对照", state.compareCycleData, state.incrementalReference, state.incrementalErrors.reference],
  ]) {
    if (role === "对照" && !cycle) continue;
    for (const line of incrementalStatusText(role, cycle, data, error).split("\n")) {
      const item = document.createElement("p");
      item.textContent = line;
      status.append(item);
    }
  }
}

function loadIncrementalData() {
  cancelIncrementalLoad();
  if (state.cycleMode !== "single" || !$("incrementalPanel").open) return;
  const summary = state.summary;
  const current = state.currentCycleData;
  const reference = state.compareCycleData;
  if (!summary || !current) { renderIncrementalChart(); return; }
  const token = state.incrementalToken;
  const controller = new AbortController();
  state.incrementalController = controller;
  const requests = [
    ["current", state.currentCycleIndex],
    ...(reference ? [["reference", state.compareCycleIndex]] : []),
  ];
  renderIncrementalChart();
  for (const [role, index] of requests) {
    const key = `${summary.source}\u0000${summary.name}\u0000${index}`;
    const cached = state.incrementalCache.get(key);
    if (cached) {
      if (role === "current") state.incrementalCurrent = cached;
      else state.incrementalReference = cached;
      renderIncrementalChart();
      continue;
    }
    api(SITE.api.incrementalCapacity, { source: summary.source, cell: summary.name, index }, controller.signal)
      .then((result) => {
        if (token !== state.incrementalToken || state.summary !== summary || !$("incrementalPanel").open) return;
        state.incrementalCache.set(key, result);
        if (state.incrementalCache.size > 24) state.incrementalCache.delete(state.incrementalCache.keys().next().value);
        if (role === "current") state.incrementalCurrent = result;
        else state.incrementalReference = result;
        renderIncrementalChart();
      })
      .catch((error) => {
        if (token !== state.incrementalToken || error.name === "AbortError") return;
        state.incrementalErrors[role] = `读取失败：${error.message}`;
        renderIncrementalChart();
      });
  }
}

function updateCycleNote() {
  if (state.cycleMode !== "single") return;
  const current = state.currentCycleData;
  if (!current) return;
  const reference = state.compareCycleData;
  let note = `当前 Cycle ${fmt(current.number)} 有 ${fmt(current.point_count)} 个原始采样点；每个 Cycle 的图中最多展示约 1,800 个点。`;
  if (reference) {
    note += ` 对照 Cycle ${fmt(reference.number)} 有 ${fmt(reference.point_count)} 个原始采样点；实线为当前，虚线为对照。`;
    note += current.time_unit === "min" && reference.time_unit === "min"
      ? " 横轴按各自 Cycle 起点计算分钟，不拉伸不同长度的记录。"
      : " 至少一个 Cycle 没有可用的分钟横轴，统一按原始采样序号叠加；采样间隔可能不同。";
  }
  note += " 容量图中紫色为充电容量，青绿色为放电容量。";
  $("cycleNote").textContent = note;
}

function clearCycleCompare() {
  ++state.compareCycleToken;
  state.compareCycleIndex = null;
  state.compareCycleData = null;
  $("cycleCompareInput").value = "";
  $("cycleCompareMessage").textContent = "";
  $("cycleCompareClear").disabled = true;
  $("cycleCompareLegend").hidden = true;
  renderCycleCharts();
  updateCycleNote();
  loadIncrementalData();
}

async function setCycleCompare() {
  const token = ++state.compareCycleToken;
  const summary = state.summary;
  const input = $("cycleCompareInput");
  const message = $("cycleCompareMessage");
  const raw = input.value.trim();
  const target = Number(raw);
  if (!summary?.cycle_count) { message.textContent = "请先选择电池。"; return; }
  if (!raw || !Number.isInteger(target) || target < 1) {
    message.textContent = "请输入大于 0 的整数 Cycle 编号。";
    return;
  }
  const index = summary.cycles.findIndex((row) => row[0] === target);
  if (index < 0) {
    const nearest = summary.cycles.reduce((best, row) =>
      Math.abs(row[0] - target) < Math.abs(best - target) ? row[0] : best, summary.cycles[0][0]);
    message.textContent = `未记录 Cycle ${fmt(target)}；最近的是 Cycle ${fmt(nearest)}。`;
    return;
  }
  if (state.compareCycleIndex === index && state.compareCycleData) {
    message.textContent = "该 Cycle 已作为对照。";
    return;
  }
  message.textContent = `正在读取对照 Cycle ${fmt(target)}…`;
  try {
    const cycle = await api(SITE.api.cycle, { source: summary.source, cell: summary.name, index });
    if (token !== state.compareCycleToken || state.summary !== summary) return;
    state.compareCycleIndex = index;
    state.compareCycleData = cycle;
    input.value = String(cycle.number);
    $("cycleCompareClear").disabled = false;
    message.textContent = "";
    renderCycleCharts();
    updateCycleNote();
    loadIncrementalData();
  } catch (error) {
    if (token !== state.compareCycleToken || state.summary !== summary) return;
    input.value = state.compareCycleData ? String(state.compareCycleData.number) : "";
    message.textContent = `对照 Cycle ${fmt(target)} 读取失败：${error.message}；已保留原有曲线。`;
  }
}

async function loadCycle(index) {
  const s = state.summary;
  if (!s?.cycle_count) return false;
  index = Math.max(0, Math.min(index, s.cycle_count - 1));
  const token = ++state.cycleToken;
  const number = s.cycles[index]?.[0] ?? index + 1;
  state.capacityPendingIndex = index;
  state.capacityPreviewIndex = null;
  state.capacitySelectionError = "";
  cancelIncrementalLoad();
  $("cycleSlider").value = String(index);
  $("cycleNumberInput").value = String(number);
  $("cycleJumpMessage").textContent = "";
  if (state.cycleMode === "single") $("cycleNote").textContent = `正在读取 Cycle ${fmt(number)} 的采样记录…`;
  renderCapacity();
  if ($("incrementalPanel").open) renderIncrementalChart();
  try {
    const c = await api(SITE.api.cycle, { source: s.source, cell: s.name, index });
    if (token !== state.cycleToken || state.summary !== s || state.cycleMode !== "single") return false;
    state.currentCycleData = c;
    state.currentCycleIndex = index;
    state.capacityPendingIndex = null;
    renderCycleCharts();
    $("selectedCycle").textContent = fmt(c.number);
    if (!ensureCapacitySelectionVisible(index)) renderCapacity();
    updateCycleNote();
    loadIncrementalData();
    return true;
  } catch (error) {
    if (token === state.cycleToken && state.cycleMode === "single") {
      const previous = state.currentCycleIndex;
      state.capacityPendingIndex = null;
      state.capacitySelectionError = `Cycle ${fmt(number)} 读取失败；红点和下方采样仍停留在${previous == null ? "空白状态" : ` Cycle ${fmt(s.cycles[previous][0])}`}。`;
      $("cycleSlider").value = String(previous ?? 0);
      $("cycleNumberInput").value = previous == null ? "" : String(s.cycles[previous][0]);
      $("cycleNote").textContent = `Cycle ${fmt(number)} 读取失败：${error.message}${previous == null ? "；当前没有可显示的采样曲线。" : `；下方仍显示 Cycle ${fmt(s.cycles[previous][0])}。`}`;
      renderCapacity();
      loadIncrementalData();
    }
    return false;
  }
}

function jumpTo(number) {
  const s = state.summary; if (!s?.cycle_count) return;
  clearTimeout(cycleTimer);
  const target = number === "eol" ? s.label : Number(number);
  if (!Number.isFinite(target)) return;
  let lo = 0, hi = s.cycles.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.cycles[mid][0] < target) lo = mid + 1;
    else hi = mid;
  }
  const previous = Math.max(0, lo - 1);
  const index = Math.abs(s.cycles[previous][0] - target) < Math.abs(s.cycles[lo][0] - target) ? previous : lo;
  loadCycle(index);
}

function jumpToExactCycle() {
  clearTimeout(cycleTimer);
  const s = state.summary;
  const target = Number($("cycleNumberInput").value);
  const message = $("cycleJumpMessage");
  if (!s?.cycle_count) { message.textContent = "请先选择电池。"; return; }
  if (!Number.isInteger(target) || target < 1) { message.textContent = "请输入大于 0 的整数 cycle 编号。"; return; }
  const index = s.cycles.findIndex((row) => row[0] === target);
  if (index < 0) {
    const nearest = s.cycles.reduce((best, row) => Math.abs(row[0] - target) < Math.abs(best - target) ? row[0] : best, s.cycles[0][0]);
    message.textContent = `未记录 Cycle ${fmt(target)}；最近的是 Cycle ${fmt(nearest)}。`;
    return;
  }
  message.textContent = "";
  loadCycle(index);
}

async function init() {
  $("sourceSelect").addEventListener("change", (event) => selectSource(event.target.value));
  $("cellSearch").addEventListener("input", renderCellList);
  $("cellSort").addEventListener("change", renderCellList);
  $("compareSourceSelect").addEventListener("change", (event) => selectCompareSource(event.target.value));
  $("compareSelect").addEventListener("change", (event) => selectCompare(event.target.value));
  $("chartSettings").addEventListener("submit", (event) => { event.preventDefault(); applyChartSettings(); });
  $("capacityChart").addEventListener("wheel", zoomCapacity, { passive: false });
  $("capacityChart").addEventListener("pointerdown", capacityPointerDown);
  $("capacityChart").addEventListener("pointermove", capacityPointerMove);
  $("capacityChart").addEventListener("pointerup", capacityPointerEnd);
  $("capacityChart").addEventListener("pointercancel", capacityPointerCancel);
  $("capacityChart").addEventListener("pointerleave", () => {
    if (state.capacityPointerId == null) previewCapacityIndex(null);
  });
  $("capacityChart").addEventListener("keydown", capacityKeyDown);
  $("capacityZoomReset").addEventListener("click", () => { state.capacityZoom = null; renderCapacity(); });
  $("cycleJumpForm").addEventListener("submit", (event) => { event.preventDefault(); jumpToExactCycle(); });
  $("cycleCompareForm").addEventListener("submit", (event) => { event.preventDefault(); setCycleCompare(); });
  $("cycleCompareClear").addEventListener("click", clearCycleCompare);
  $("incrementalPanel").addEventListener("toggle", () => {
    if ($("incrementalPanel").open) loadIncrementalData();
    else {
      cancelIncrementalLoad();
      charts.incremental.set({ series: [] });
      $("incrementalStatus").textContent = "展开后按完整采样记录计算。";
    }
  });
  document.querySelectorAll("[data-incremental-phase]").forEach((button) => button.addEventListener("click", () => {
    state.incrementalPhase = button.dataset.incrementalPhase;
    renderIncrementalChart();
  }));
  document.querySelectorAll("[data-cycle-mode]").forEach((button) => button.addEventListener("click", () => setCycleMode(button.dataset.cycleMode)));
  $("multiCycleForm").addEventListener("submit", (event) => { event.preventDefault(); loadMultiCycles(); });
  for (const id of ["multiStartInput", "multiEndInput"])
    $(id).addEventListener("input", updateMultiResetButton);
  $("multiRangeReset").addEventListener("click", restoreMultiRange);
  $("multiCapacitySignal").addEventListener("change", (event) => {
    state.multiCapacitySignal = event.target.value;
    renderMultiCycleCharts();
    if (state.multiSelection.length) updateMultiMessage(state.multiFinishedCount < state.multiSelection.length);
  });
  document.querySelectorAll("[data-window]").forEach((button) => button.addEventListener("click", () => {
    state.window = button.dataset.window; state.capacityZoom = null; renderCapacity();
  }));
  $("unitRelative").addEventListener("click", () => changeUnit("relative"));
  $("unitAbsolute").addEventListener("click", () => changeUnit("absolute"));
  $("cycleSlider").addEventListener("input", (event) => {
    const index = Number(event.target.value);
    scheduleCapacityCycle(index);
  });
  document.querySelectorAll("[data-jump]").forEach((button) => button.addEventListener("click", () => jumpTo(button.dataset.jump)));
  try {
    api(SITE.api.overview).then((overview) => {
      state.protocolCells = new Map((overview.cells || []).map((cell) =>
        [`${cell.source}\u0000${cell.name}`, cell]));
      if (state.summary) renderSummary();
    }).catch(() => {
      state.protocolCells = new Map();
      if (state.summary) renderSummary();
    });
    state.catalog = await api(SITE.api.catalog);
    const sources = Object.keys(state.catalog.sources);
    if (!sources.length) throw new Error("数据目录中没有 .pkl 电池文件");
    $("datasetBadge").textContent = `${fmt(sources.length)} 个来源 · ${fmt(sources.reduce((sum, source) => sum + state.catalog.sources[source].length, 0))} 块去重后电池`;
    for (const source of sources) {
      const option = document.createElement("option"); option.value = source; option.textContent = source;
      $("sourceSelect").append(option);
      $("compareSourceSelect").append(option.cloneNode(true));
    }
    const params = new URLSearchParams(location.search);
    const requestedSource = params.get("source");
    const source = requestedSource && sources.includes(requestedSource) ? requestedSource
      : sources.includes("ISU_ILCC") ? "ISU_ILCC" : sources[0];
    const preferred = params.get("cell") || (source === "ISU_ILCC" ? "ISU-ILCC_G59C3.pkl" : null);
    if (["all", "early", "eol"].includes(params.get("view"))) state.window = params.get("view");
    await selectSource(source, preferred);
  } catch (error) { notice(error.message, true); }
}

function changeUnit(unit) {
  state.unit = unit;
  $("unitRelative").classList.toggle("active", unit === "relative");
  $("unitAbsolute").classList.toggle("active", unit === "absolute");
  renderCapacity();
}

init();
