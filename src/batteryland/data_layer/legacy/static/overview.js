"use strict";

const SITE = window.BatteryLifeConfig;

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 30;
const COLORS = SITE.chartColors.chemistry;
const FLOW_DIMENSIONS = [
  { key: "source", label: "数据来源", filter: "sourceFilter" },
  { key: "cathode", label: "正极体系", filter: "cathodeFilter" },
  { key: "anode", label: "负极材料", filter: "anodeFilter" },
  { key: "form_factor", label: "电池形态", filter: "formFilter" },
  { key: "capacity_band", label: "容量档位", filter: "capacityBandFilter" },
  { key: "charge_stage_count", label: "充电阶段数", filter: "chargeStageFilter" },
  { key: "charge_control_kind", label: "充电控制方式", filter: "chargeControlFilter" },
  { key: "discharge_stage_count", label: "放电阶段数", filter: "dischargeStageFilter" },
  { key: "soc_interval_group", label: "SOC 区间类型", filter: "socGroupFilter" },
];
const FLOW_PRESETS = {
  material: ["source", "cathode", "anode", "form_factor", "capacity_band"],
  condition: ["source", "charge_stage_count", "charge_control_kind", "discharge_stage_count", "soc_interval_group"],
};
const DIMENSION_BY_KEY = new Map(FLOW_DIMENSIONS.map((dimension) => [dimension.key, dimension]));
const FIELD_FILTERS = FLOW_DIMENSIONS.map((dimension) => [dimension.filter, dimension.key]);
const ALL_FILTER_IDS = [...FIELD_FILTERS.map(([id]) => id), "capacityFilter", "labelFilter", "cellSearch"];
let allCells = [];
let filtered = [];
let currentPage = 0;
let activeFlowDimensions = [...FLOW_PRESETS.material];
let filterHistory = [];
let lastAppliedFilters = null;
let searchBurst = false;
let flowControlsRenderToken = 0;
let selectedCompare = [];
const FILTER_HISTORY_LIMIT = 30;
const compareKey = (cell) => `${cell.source}\u0000${cell.name}`;

const fmt = (value) => Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 1 });

function showStatus(message) {
  $("status").textContent = message;
  $("status").hidden = !message;
}

function addOptions(select, values) {
  for (const value of [...new Set(values)].sort((a, b) => a.localeCompare(b, "zh-CN"))) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

function addCapacityOptions(select, values) {
  for (const value of [...new Set(values)].filter((value) => value != null && value !== "" && Number.isFinite(Number(value))).sort((a, b) => Number(a) - Number(b))) {
    const option = document.createElement("option");
    option.value = String(value);
    option.textContent = `${Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 3 })} Ah`;
    select.append(option);
  }
}

function matches(cell) {
  for (const [id, field] of FIELD_FILTERS) {
    if ($(id).value && String(cell[field] ?? "未提供") !== $(id).value) return false;
  }
  if ($("capacityFilter").value && (cell.nominal_capacity_ah == null || cell.nominal_capacity_ah === "" ||
    Number(cell.nominal_capacity_ah) !== Number($("capacityFilter").value))) return false;
  const label = $("labelFilter").value;
  if (label === "with" && cell.label == null) return false;
  if (label === "without" && cell.label != null) return false;
  if (label === "beyond" && !cell.label_beyond_detail) return false;
  const search = $("cellSearch").value.trim().toLocaleLowerCase();
  return !search || `${cell.source} ${cell.name}`.toLocaleLowerCase().includes(search);
}

function captureFilters() {
  return Object.fromEntries(ALL_FILTER_IDS.map((id) => [id, $(id).value]));
}

function sameFilters(left, right) {
  return left && right && ALL_FILTER_IDS.every((id) => left[id] === right[id]);
}

function updateFilterActions() {
  const canUndo = filterHistory.length > 0;
  const canClear = ALL_FILTER_IDS.some((id) => $(id).value.trim());
  for (const id of ["undoFlowFilters", "undoFilters"]) $(id).disabled = !canUndo;
  for (const id of ["clearFlowFilters", "clearFilters"]) $(id).disabled = !canClear;
}

function changeFilters({ search = false } = {}) {
  const next = captureFilters();
  if (sameFilters(next, lastAppliedFilters)) return;
  if (lastAppliedFilters && (!search || !searchBurst)) {
    filterHistory.push(lastAppliedFilters);
    if (filterHistory.length > FILTER_HISTORY_LIMIT) filterHistory.shift();
  }
  if (search && sameFilters(next, filterHistory.at(-1))) {
    filterHistory.pop();
    searchBurst = false;
  } else {
    searchBurst = search;
  }
  update();
}

function undoFilters() {
  if (!filterHistory.length) return;
  const previous = filterHistory.pop();
  for (const id of ALL_FILTER_IDS) $(id).value = previous[id];
  searchBurst = false;
  update();
}

function clearFilters() {
  if (!ALL_FILTER_IDS.some((id) => $(id).value.trim())) return;
  for (const id of ALL_FILTER_IDS) $(id).value = "";
  changeFilters();
}

function renderActiveFilters() {
  const container = $("activeFilters");
  container.replaceChildren();
  for (const id of ALL_FILTER_IDS) {
    const control = $(id);
    const value = control.value.trim();
    if (!value) continue;
    const label = control.closest("label")?.firstChild?.textContent?.trim() || "搜索编号";
    const display = control.tagName === "SELECT" ? control.selectedOptions[0]?.textContent : value;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.textContent = `${label}：${display} ×`;
    button.setAttribute("aria-label", `移除筛选：${label} ${display}`);
    button.addEventListener("click", () => { control.value = ""; changeFilters(); });
    container.append(button);
  }
  container.hidden = !container.childElementCount;
}

function sortCells(cells) {
  const sortBy = $("sortBy").value;
  return [...cells].sort((a, b) => {
    if (sortBy === "eol-asc" || sortBy === "eol-desc") {
      if (a.label == null) return b.label == null ? 0 : 1;
      if (b.label == null) return -1;
      const diff = sortBy === "eol-asc" ? a.label - b.label : b.label - a.label;
      if (diff) return diff;
    }
    if (sortBy === "cycles-desc" && a.cycle_count !== b.cycle_count) return b.cycle_count - a.cycle_count;
    return a.source.localeCompare(b.source) || a.name.localeCompare(b.name, "zh-CN", { numeric: true });
  });
}

function renderStats() {
  $("cellCount").textContent = fmt(filtered.length);
  $("sourceCount").textContent = fmt(new Set(filtered.map((cell) => cell.source)).size);
  $("labeledCount").textContent = fmt(filtered.filter((cell) => cell.label != null).length);
  $("beyondCount").textContent = fmt(filtered.filter((cell) => cell.label_beyond_detail).length);
  $("filterCount").textContent = `当前筛选显示 ${fmt(filtered.length)} 块电池，共 ${fmt(allCells.length)} 块去重后电池。`;
  const hasFilters = ALL_FILTER_IDS.some((id) => $(id).value.trim());
  $("flowFilterStatus").textContent = hasFilters
    ? `筛选中：${fmt(filtered.length)} / ${fmt(allCells.length)} 块电池`
    : `全部 ${fmt(allCells.length)} 块电池`;
}

function appendCell(parent, text, className = "") {
  const element = document.createElement("td");
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function renderCompareSelection() {
  const selectedKeys = new Set(selectedCompare.map(compareKey));
  $("selectedCompareCount").textContent = `待对比 ${fmt(selectedCompare.length)} 块`;
  $("clearCompare").disabled = !selectedCompare.length;
  const link = $("openCompare");
  link.hidden = !selectedCompare.length;
  if (selectedCompare.length) {
    const pairs = selectedCompare.map((cell) => [cell.source, cell.name]);
    link.href = `${SITE.routeUrl("trends")}#${new URLSearchParams({ cells: JSON.stringify(pairs) })}`;
    link.setAttribute("aria-label", `对比所选 ${selectedCompare.length} 块电池（在新标签页打开并自动绘图）`);
  } else link.removeAttribute("href");
  const list = $("selectedCompareList"), previousScroll = list.scrollTop;
  list.replaceChildren();
  if (!selectedCompare.length) {
    const empty = document.createElement("p");
    empty.className = "compare-cart-empty"; empty.textContent = "尚未选择电池。";
    list.append(empty);
  }
  for (const cell of selectedCompare) {
    const item = document.createElement("div"); item.className = "compare-cart-item";
    const label = document.createElement("span");
    label.textContent = `${cell.source} / ${cell.name.replace(/\.pkl$/, "")}`;
    const remove = document.createElement("button");
    remove.type = "button"; remove.textContent = "移除";
    remove.setAttribute("aria-label", `移除 ${cell.source} / ${cell.name}`);
    remove.addEventListener("click", () => {
      selectedCompare = selectedCompare.filter((selected) => compareKey(selected) !== compareKey(cell));
      renderCompareSelection();
    });
    item.append(label, remove); list.append(item);
  }
  list.scrollTop = previousScroll;
  for (const button of document.querySelectorAll("#cellRows .compare-add")) {
    const selected = selectedKeys.has(compareKey(button.dataset));
    button.disabled = selected;
    button.textContent = selected ? "已加入" : "加入待对比";
    button.setAttribute("aria-label", `${selected ? "已加入待对比" : "加入待对比"}：${button.dataset.source} / ${button.dataset.name}`);
  }
}

function addCompareCell(cell) {
  if (selectedCompare.some((selected) => compareKey(selected) === compareKey(cell))) return;
  selectedCompare.push(cell);
  renderCompareSelection();
}

function renderTable() {
  const sorted = sortCells(filtered);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, totalPages - 1);
  const body = $("cellRows"); body.replaceChildren();
  for (const cell of sorted.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)) {
    const row = document.createElement("tr");
    appendCell(row, cell.source);
    appendCell(row, cell.name.replace(/\.pkl$/, ""), "name");
    const chemistry = appendCell(row, cell.cathode);
    chemistry.title = `原始记录：${cell.cathode_raw ?? "未提供"}`;
    const capacityValue = cell.nominal_capacity_ah;
    const capacity = appendCell(row, capacityValue == null || capacityValue === "" ? "未提供" :
      Number.isFinite(Number(capacityValue)) ? Number(capacityValue).toLocaleString("zh-CN", { maximumFractionDigits: 3 }) : "待核对");
    capacity.title = `原始记录：${cell.nominal_capacity_ah ?? "未提供"} Ah；负极：${cell.anode_raw ?? "未提供"}`;
    const form = appendCell(row, cell.form_factor);
    form.title = `原始记录：${cell.form_factor_raw ?? "未提供"}`;
    appendCell(row, fmt(cell.cycle_count ?? 0));
    const label = appendCell(row, cell.label == null ? "无标签" : fmt(cell.label));
    if (cell.label_beyond_detail) {
      const badge = document.createElement("span");
      badge.className = "tag"; badge.textContent = "超出曲线";
      badge.title = `详细曲线最大记录到 Cycle ${fmt(cell.last_cycle)}`;
      label.append(badge);
    }
    const linkCell = document.createElement("td");
    linkCell.className = "row-actions";
    const link = document.createElement("a");
    const params = new URLSearchParams({ source: cell.source, cell: cell.name });
    link.href = SITE.routeUrl("detail", params); link.textContent = "查看曲线 ↗";
    link.target = "_blank"; link.rel = "noopener";
    link.title = "在新标签页打开";
    link.setAttribute("aria-label", "查看曲线（在新标签页打开）");
    const compare = document.createElement("button");
    compare.type = "button"; compare.className = "compare-add";
    compare.dataset.source = cell.source; compare.dataset.name = cell.name;
    compare.textContent = "加入待对比";
    compare.setAttribute("aria-label", `加入待对比：${cell.source} / ${cell.name}`);
    compare.addEventListener("click", () => addCompareCell(cell));
    linkCell.append(link, compare); row.append(linkCell); body.append(row);
  }
  if (!sorted.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td"); cell.colSpan = 8; cell.textContent = "没有符合条件的电池，请调整筛选。";
    row.append(cell); body.append(row);
  }
  $("pageInfo").textContent = sorted.length ? `第 ${currentPage + 1} / ${totalPages} 页，每页最多 ${PAGE_SIZE} 块` : "0 块电池";
  $("previousPage").disabled = currentPage === 0;
  $("nextPage").disabled = currentPage >= totalPages - 1;
  $("downloadFilteredCsv").disabled = !sorted.length;
  renderCompareSelection();
}

function downloadFilteredCsv() {
  if (!filtered.length) return;
  const columns = [
    ["source", "数据来源"], ["name", "电池编号"], ["cathode", "正极体系"],
    ["anode", "负极材料"], ["form_factor", "电池形态"],
    ["nominal_capacity_ah", "标称容量_Ah"], ["capacity_band", "容量档位"],
    ["charge_stage_count", "充电阶段数"], ["charge_control_kind", "充电控制方式"],
    ["discharge_stage_count", "放电阶段数"], ["soc_interval_group", "SOC区间类型"],
    ["cycle_count", "详细cycle数"], ["first_cycle", "首个详细cycle"],
    ["last_cycle", "末个详细cycle"], ["label", "原有寿命标签_cycle"],
    ["label_beyond_detail", "标签超出详细曲线"],
  ];
  const csvValue = (value) => {
    let text = value == null ? "" : String(value);
    if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [columns.map(([, title]) => csvValue(title)).join(",")];
  for (const cell of sortCells(filtered)) {
    rows.push(columns.map(([field]) => csvValue(field === "label_beyond_detail" ?
      (cell[field] ? "是" : "否") : cell[field])).join(","));
  }
  const url = URL.createObjectURL(new Blob(["\ufeff", rows.join("\r\n"), "\r\n"], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "BatteryLife-当前筛选目录.csv";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function svgElement(name, attrs = {}, label = "") {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
  if (label) element.textContent = label;
  return element;
}

function addTitle(node, title) {
  node.append(svgElement("title", {}, title));
  return node;
}

function renderFlowControls({ revealIndex = null, resetScroll = false, afterAdd = false } = {}) {
  const renderToken = ++flowControlsRenderToken;
  const sameAs = (preset) => activeFlowDimensions.length === FLOW_PRESETS[preset].length &&
    activeFlowDimensions.every((key, index) => key === FLOW_PRESETS[preset][index]);
  for (const [preset, id] of [["material", "flowMaterialPreset"], ["condition", "flowConditionPreset"]]) {
    const active = sameAs(preset);
    $(id).classList.toggle("active", active);
    $(id).setAttribute("aria-pressed", String(active));
  }
  const controls = $("flowDimensionControls");
  const previousScroll = controls.scrollLeft;
  controls.replaceChildren();
  for (const [index, key] of activeFlowDimensions.entries()) {
    const item = document.createElement("div"); item.className = "flow-dimension";
    const label = document.createElement("label"); label.textContent = `第 ${index + 1} 轴`;
    const select = document.createElement("select");
    select.className = "flow-dimension-select";
    select.setAttribute("aria-label", `第 ${index + 1} 轴维度`);
    select.dataset.index = String(index);
    for (const dimension of FLOW_DIMENSIONS) {
      const option = document.createElement("option");
      option.value = dimension.key; option.textContent = dimension.label;
      option.disabled = dimension.key !== key && activeFlowDimensions.includes(dimension.key);
      option.selected = dimension.key === key;
      select.append(option);
    }
    select.addEventListener("change", () => {
      if (activeFlowDimensions.includes(select.value) && select.value !== key) return;
      activeFlowDimensions[index] = select.value;
      renderFlowControls(); renderFlow();
    });
    label.append(select); item.append(label);
    for (const [direction, symbol, name] of [[-1, "←", "左移"], [1, "→", "右移"]]) {
      const button = document.createElement("button");
      button.type = "button"; button.className = "flow-axis-button";
      button.textContent = symbol; button.title = `${name}${DIMENSION_BY_KEY.get(key).label}`;
      button.setAttribute("aria-label", `${name}第 ${index + 1} 轴`);
      button.disabled = index + direction < 0 || index + direction >= activeFlowDimensions.length;
      button.addEventListener("click", () => {
        const other = index + direction;
        [activeFlowDimensions[index], activeFlowDimensions[other]] = [activeFlowDimensions[other], activeFlowDimensions[index]];
        renderFlowControls({ revealIndex: other }); renderFlow();
      });
      item.append(button);
    }
    const remove = document.createElement("button");
    remove.type = "button"; remove.className = "flow-axis-button";
    remove.textContent = "×"; remove.title = `移除${DIMENSION_BY_KEY.get(key).label}`;
    remove.setAttribute("aria-label", `移除第 ${index + 1} 轴`);
    remove.disabled = activeFlowDimensions.length <= 3;
    remove.addEventListener("click", () => {
      activeFlowDimensions.splice(index, 1);
      renderFlowControls({ revealIndex: Math.min(index, activeFlowDimensions.length - 1) }); renderFlow();
    });
    item.append(remove); controls.append(item);
  }
  const add = document.createElement("button");
  add.type = "button"; add.className = "plain-button flow-add-dimension";
  add.textContent = "+ 添加维度";
  add.hidden = activeFlowDimensions.length >= FLOW_DIMENSIONS.length;
  add.addEventListener("click", () => {
    const next = FLOW_DIMENSIONS.find((dimension) => !activeFlowDimensions.includes(dimension.key));
    if (!next) return;
    activeFlowDimensions.push(next.key);
    renderFlowControls({ afterAdd: true }); renderFlow();
  });
  controls.append(add);
  controls.scrollLeft = resetScroll ? 0 : previousScroll;
  if (afterAdd) {
    queueMicrotask(() => {
      if (renderToken !== flowControlsRenderToken) return;
      const focusTarget = add.hidden ? controls.querySelector(".flow-dimension:last-of-type .flow-dimension-select") : add;
      controls.scrollLeft = controls.scrollWidth - controls.clientWidth;
      focusTarget?.focus({ preventScroll: true });
    });
    return;
  }
  if (revealIndex != null) {
    const axis = controls.children[revealIndex];
    const viewport = controls.getBoundingClientRect(), card = axis.getBoundingClientRect();
    if (card.left < viewport.left) controls.scrollLeft += card.left - viewport.left;
    else if (card.right > viewport.right) controls.scrollLeft += card.right - viewport.right;
  }
}

function bindFlowAction(node, action) {
  node.setAttribute("role", "button");
  node.setAttribute("tabindex", "0");
  node.addEventListener("click", action);
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); }
  });
}

function applyFlowFilters(entries) {
  for (const [key, value] of entries) {
    const control = $(DIMENSION_BY_KEY.get(key).filter);
    control.value = value;
    if (control.closest("#conditionFilters")) $("conditionFilters").open = true;
  }
  changeFilters();
}

function fitFlowLabel(element, fullText, maxWidth) {
  element.textContent = fullText;
  if (element.getComputedTextLength() <= maxWidth) return;
  const chars = [...fullText];
  for (let length = chars.length - 1; length > 0; length--) {
    element.textContent = `${chars.slice(0, length).join("")}…`;
    if (element.getComputedTextLength() <= maxWidth) return;
  }
  element.textContent = "…";
}

function addFlowTitle(svg, label, x, maxWidth) {
  const group = svgElement("g");
  const title = svgElement("text", { x, y: 33, class: "flow-title", "text-anchor": "middle" }, label);
  group.append(svgElement("title", {}, label), title);
  svg.append(group);
  if (title.getComputedTextLength() <= maxWidth) return;
  const chars = [...label];
  let split = 1, shortest = Infinity;
  for (let index = 1; index < chars.length; index++) {
    title.textContent = chars.slice(0, index).join("");
    const firstWidth = title.getComputedTextLength();
    title.textContent = chars.slice(index).join("");
    const secondWidth = title.getComputedTextLength();
    const widest = Math.max(firstWidth, secondWidth);
    if (widest < shortest) { shortest = widest; split = index; }
  }
  title.replaceChildren(
    svgElement("tspan", { x, y: 28 }, chars.slice(0, split).join("")),
    svgElement("tspan", { x, y: 47 }, chars.slice(split).join("")),
  );
}

function renderFlow() {
  const svg = $("compositionFlow"); svg.replaceChildren();
  const dimensions = activeFlowDimensions.map((key) => DIMENSION_BY_KEY.get(key));
  const width = Math.max(320, svg.parentElement.clientWidth);
  const margin = Math.min(150, Math.max(70, width * .105));
  const step = (width - margin * 2) / (dimensions.length - 1);
  svg.setAttribute("aria-label", `${dimensions.map((dimension) => dimension.label).join("、")}的电池组成桑基图`);
  $("flowDescription").textContent = `${dimensions.map((dimension) => dimension.label).join(" → ")}；当前统计 ${fmt(filtered.length)} 块电池。`;
  if (!filtered.length) {
    svg.setAttribute("viewBox", `0 0 ${width} 150`);
    svg.style.height = "150px";
    svg.append(svgElement("text", { x: width / 2, y: 80, "text-anchor": "middle", class: "flow-label" }, "没有符合条件的电池"));
    return;
  }
  const valueOf = (cell, field) => String(cell[field] ?? "未提供");
  const group = (field) => {
    const counts = new Map();
    for (const cell of filtered) {
      const value = valueOf(cell, field);
      counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"));
  };
  const groups = dimensions.map((dimension) => group(dimension.key));
  const height = Math.max(540, ...groups.map((items) => items.length * 54 + 125));
  const top = 80, available = height - top - 35;
  const gap = 22;
  const scale = Math.min(12, ...groups.map((items) =>
    (available - (items.length - 1) * gap) / filtered.length));
  const positions = groups.map((items) => {
    const used = filtered.length * scale + (items.length - 1) * gap;
    let y = top + (available - used) / 2;
    const map = new Map();
    for (const [key, count] of items) {
      map.set(key, { y, height: count * scale, inOffset: 0, outOffset: 0, count });
      y += count * scale + gap;
    }
    return map;
  });
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.style.height = `${height}px`;
  const x = dimensions.map((_, column) => margin + column * step);
  for (let column = 0; column < dimensions.length; column++) {
    addFlowTitle(svg, dimensions[column].label, x[column], step - 10);
  }
  const drawEdges = (leftIndex) => {
    const rightIndex = leftIndex + 1;
    const leftField = dimensions[leftIndex].key, rightField = dimensions[rightIndex].key;
    const counts = new Map();
    for (const cell of filtered) {
      const key = JSON.stringify([valueOf(cell, leftField), valueOf(cell, rightField)]);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const edges = [...counts].map(([key, count]) => ({ names: JSON.parse(key), count }));
    edges.sort((a, b) => positions[leftIndex].get(a.names[0]).y - positions[leftIndex].get(b.names[0]).y ||
      positions[rightIndex].get(a.names[1]).y - positions[rightIndex].get(b.names[1]).y);
    for (const edge of edges) {
      const [leftName, rightName] = edge.names;
      const left = positions[leftIndex].get(leftName), right = positions[rightIndex].get(rightName);
      const thickness = edge.count * scale;
      const y1 = left.y + left.outOffset + thickness / 2;
      const y2 = right.y + right.inOffset + thickness / 2;
      left.outOffset += thickness; right.inOffset += thickness;
      const x1 = x[leftIndex] + 8, x2 = x[rightIndex] - 8, middle = (x1 + x2) / 2;
      const chemistry = leftField === "cathode" ? leftName : rightField === "cathode" ? rightName : "";
      const path = svgElement("path", {
        d: `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`,
        stroke: COLORS[chemistry] || SITE.chartColors.compositionSource,
        "stroke-width": Math.max(1, thickness), class: "flow-edge",
        "data-left-dimension": leftField, "data-left-value": leftName,
        "data-right-dimension": rightField, "data-right-value": rightName,
        "data-flow-count": edge.count,
      });
      path.setAttribute("aria-label", `${dimensions[leftIndex].label} ${leftName} 到 ${dimensions[rightIndex].label} ${rightName}：${fmt(edge.count)} 块电池，点击筛选`);
      bindFlowAction(path, () => applyFlowFilters([[leftField, leftName], [rightField, rightName]]));
      svg.append(addTitle(path, `${leftName} → ${rightName}：${fmt(edge.count)} 块电池`));
    }
  };
  for (let column = 0; column < dimensions.length - 1; column++) drawEdges(column);
  for (let column = 0; column < dimensions.length; column++) {
    for (const [name, node] of positions[column]) {
      const color = dimensions[column].key === "cathode" ? (COLORS[name] || COLORS["未分类"]) :
        column === 0 ? SITE.chartColors.compositionSource : SITE.chartColors.compositionForm;
      const action = svgElement("g", { class: "flow-node-action", "data-flow-dimension": dimensions[column].key,
        "data-flow-value": name, "data-flow-count": node.count });
      action.setAttribute("aria-label", `${dimensions[column].label} ${name}：${fmt(node.count)} 块电池，点击筛选`);
      bindFlowAction(action, () => applyFlowFilters([[dimensions[column].key, name]]));
      action.append(svgElement("title", {}, `${name}：${fmt(node.count)} 块电池`));
      action.append(addTitle(svgElement("rect", {
        x: x[column] - 8, y: node.y, width: 16, height: Math.max(2, node.height), fill: color, class: "flow-node",
      }), `${name}：${fmt(node.count)} 块电池`));
      const anchor = column === 0 ? "end" : "start";
      const labelX = column === 0 ? x[column] - 15 : x[column] + 15;
      const label = svgElement("text", {
        x: labelX, y: node.y + node.height / 2 + 5,
        "text-anchor": anchor, class: "flow-label",
      }, name);
      action.append(label);
      svg.append(action);
      fitFlowLabel(label, name, column === 0 ? margin - 23 :
        column === dimensions.length - 1 ? margin - 23 : step - 31);
    }
  }
}

function addOrderedOptions(select, values, order) {
  const rank = new Map(order.map((value, index) => [value, index]));
  for (const value of [...new Set(values)].sort((a, b) =>
    (rank.get(a) ?? 100) - (rank.get(b) ?? 100) || a.localeCompare(b, "zh-CN"))) {
    const option = document.createElement("option");
    option.value = value; option.textContent = value;
    select.append(option);
  }
}

function update() {
  filtered = allCells.filter(matches);
  currentPage = 0;
  renderStats(); renderActiveFilters(); renderFlow(); renderTable();
  window.TrajectoryOverview?.update(filtered);
  lastAppliedFilters = captureFilters();
  updateFilterActions();
}

async function loadDeliveryStatus() {
  try {
    const response = await fetch(SITE.api.deliveryStatus);
    if (!response.ok) throw new Error("清单状态接口无法访问。");
    const status = await response.json();
    if (!status.ready) {
      $("deliveryStatus").textContent = status.message;
      return;
    }
    $("deliveryStatus").textContent = `清单已就绪：${fmt(status.summary.unique_cells)} 块去重电池，生成时间 ${new Date(status.generated_at).toLocaleString("zh-CN")}。`;
    $("deliveryCsv").hidden = false;
    $("deliveryJson").hidden = false;
  } catch (error) { $("deliveryStatus").textContent = `暂时无法核对统一清单：${error.message}`; }
}

async function init() {
  let lastFlowWidth = 0;
  new ResizeObserver((entries) => {
    const width = Math.round(entries[0].contentRect.width);
    if (width === lastFlowWidth) return;
    lastFlowWidth = width;
    requestAnimationFrame(renderFlow);
  }).observe($("compositionFlow").parentElement);
  $("openFilters").addEventListener("click", () => $("filterDialog").showModal());
  $("closeFilters").addEventListener("click", () => $("filterDialog").close());
  for (const id of ALL_FILTER_IDS)
    $(id).addEventListener(id === "cellSearch" ? "input" : "change", () => changeFilters({ search: id === "cellSearch" }));
  $("cellSearch").addEventListener("blur", () => { searchBurst = false; });
  $("cellSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") searchBurst = false;
  });
  $("sortBy").addEventListener("change", () => { currentPage = 0; renderTable(); });
  $("downloadFilteredCsv").addEventListener("click", downloadFilteredCsv);
  $("clearCompare").addEventListener("click", () => { selectedCompare = []; renderCompareSelection(); });
  for (const id of ["undoFlowFilters", "undoFilters"]) $(id).addEventListener("click", undoFilters);
  for (const id of ["clearFlowFilters", "clearFilters"]) $(id).addEventListener("click", clearFilters);
  $("flowMaterialPreset").addEventListener("click", () => {
    activeFlowDimensions = [...FLOW_PRESETS.material]; renderFlowControls({ resetScroll: true }); renderFlow();
  });
  $("flowConditionPreset").addEventListener("click", () => {
    activeFlowDimensions = [...FLOW_PRESETS.condition];
    $("conditionFilters").open = true;
    renderFlowControls({ resetScroll: true }); renderFlow();
  });
  $("resetFlowAxes").addEventListener("click", () => {
    activeFlowDimensions = [...FLOW_PRESETS.material]; renderFlowControls({ resetScroll: true }); renderFlow();
  });
  $("previousPage").addEventListener("click", () => { currentPage--; renderTable(); });
  $("nextPage").addEventListener("click", () => { currentPage++; renderTable(); });
  renderFlowControls();
  try {
    const response = await fetch(SITE.api.overview);
    if (!response.ok) throw new Error(`请求失败：${response.status}`);
    const data = await response.json();
    if (!data.ready) { showStatus(data.message); return; }
    allCells = data.cells;
    window.TrajectoryOverview?.init(allCells);
    const notices = [];
    if (data.needs_refresh) notices.push("数据目录在上次核查后发生变化。当前页面仍显示上次结果，请联系管理员更新数据层目录索引。");
    if (data.errors) notices.push(`有 ${fmt(data.errors)} 个文件未能解析，未纳入总览。请查看审计报告。`);
    showStatus(notices.join(" "));
    addOptions($("sourceFilter"), allCells.map((cell) => cell.source));
    addOptions($("cathodeFilter"), allCells.map((cell) => cell.cathode));
    addOptions($("anodeFilter"), allCells.map((cell) => cell.anode));
    addOptions($("formFilter"), allCells.map((cell) => cell.form_factor));
    addCapacityOptions($("capacityFilter"), allCells.map((cell) => cell.nominal_capacity_ah));
    addOrderedOptions($("capacityBandFilter"), allCells.map((cell) => cell.capacity_band),
      ["<0.5 Ah", "0.5～<1.5 Ah", "1.5～<3 Ah", "3～<10 Ah", "≥10 Ah", "未提供", "其他/待核对"]);
    const stageOrder = ["1 阶段", "2 阶段", "3 阶段", "4 阶段", "未提供", "其他/待核对"];
    addOrderedOptions($("chargeStageFilter"), allCells.map((cell) => cell.charge_stage_count), stageOrder);
    addOrderedOptions($("chargeControlFilter"), allCells.map((cell) => cell.charge_control_kind),
      ["倍率", "电流", "电压", "功率", "混合控制", "未识别数值控制", "未提供", "其他/待核对"]);
    addOrderedOptions($("dischargeStageFilter"), allCells.map((cell) => cell.discharge_stage_count), stageOrder);
    addOrderedOptions($("socGroupFilter"), allCells.map((cell) => cell.soc_interval_group),
      ["0～100%", "20～80%", "其他固定区间", "百分制待核对", "未提供", "其他/待核对"]);
    update();
    loadDeliveryStatus();
  } catch (error) { showStatus(`读取数据总览失败：${error.message}`); }
}

init();
