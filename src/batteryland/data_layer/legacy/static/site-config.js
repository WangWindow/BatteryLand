"use strict";

(() => {
  const freeze = (value) => Object.freeze(value);
  const theme = getComputedStyle(document.documentElement);
  const themeColor = (name) => theme.getPropertyValue(name).trim();

  const routes = freeze({
    detail: "/data-layer/",
    overview: "/data-layer/overview",
    trends: "/data-layer/trends",
  });
  // Existing browsers may still hold HTML cached before the no-store policy.
  const pageRevision = "20261105-1";

  const api = freeze({
    catalog: "/data-layer/api/catalog",
    overview: "/data-layer/api/overview",
    trajectories: "/data-layer/api/trajectories",
    deliveryStatus: "/data-layer/api/delivery-status",
    summary: "/data-layer/api/summary",
    cycle: "/data-layer/api/cycle",
    incrementalCapacity: "/data-layer/api/incremental-capacity",
  });

  const downloads = freeze({
    deliveryCsv: "/data-layer/download/delivery-manifest.csv",
    deliveryJson: "/data-layer/download/delivery-manifest.json",
  });

  const navigation = freeze({
    primary: freeze([
      freeze({ key: "detail", label: "电池详情" }),
      freeze({ key: "overview", label: "数据总览" }),
      freeze({ key: "trends", label: "多电池曲线" }),
    ]),
  });

  const chartColors = freeze({
    primary: themeColor("--chart-primary"),
    primaryDark: themeColor("--chart-primary-dark"),
    comparison: themeColor("--chart-comparison"),
    comparisonDark: themeColor("--chart-comparison-dark"),
    purple: themeColor("--chart-purple"),
    danger: themeColor("--chart-danger"),
    cycleSelection: themeColor("--chart-cycle-selection"),
    axis: themeColor("--chart-axis"),
    axisSoft: themeColor("--chart-axis-soft"),
    muted: themeColor("--chart-muted"),
    grid: themeColor("--chart-grid"),
    white: themeColor("--color-surface"),
    selection: themeColor("--chart-selection"),
    reference: themeColor("--chart-reference"),
    nominalReference: themeColor("--chart-nominal-reference"),
    comparisonEol: themeColor("--chart-comparison-eol"),
    comparisonLine: themeColor("--chart-comparison-line"),
    voltage: themeColor("--chart-voltage"),
    current: themeColor("--chart-current"),
    chargeCapacity: themeColor("--chart-charge-capacity"),
    dischargeCapacity: themeColor("--chart-discharge-capacity"),
    cycleGradient: freeze({
      low: themeColor("--chart-cycle-low"),
      mid: themeColor("--chart-cycle-mid"),
      high: themeColor("--chart-cycle-high"),
    }),
    comparisonSeries: freeze([
      themeColor("--chart-primary-dark"),
      themeColor("--chart-comparison-dark"),
      themeColor("--chart-purple"),
      themeColor("--chart-series-four"),
    ]),
    trajectoryHues: freeze([190, 25, 270, 140, 335, 205, 65, 285, 165, 10, 225, 100, 305, 45]),
    chemistry: freeze({
      "NMC / NCM": themeColor("--chart-chemistry-nmc"),
      LFP: themeColor("--chart-chemistry-lfp"),
      NCA: themeColor("--chart-chemistry-nca"),
      LCO: themeColor("--chart-chemistry-lco"),
      "LCO + NMC 混合": themeColor("--chart-chemistry-lco-nmc"),
      "NMC + NCA 混合": themeColor("--chart-chemistry-nmc-nca"),
      "未知": themeColor("--chart-chemistry-unknown"),
      "未分类": themeColor("--chart-chemistry-unknown"),
    }),
    compositionSource: themeColor("--chart-composition-source"),
    compositionForm: themeColor("--chart-composition-form"),
  });

  function appendQuery(path, params = {}) {
    const query = params instanceof URLSearchParams ? params : new URLSearchParams(params);
    const text = query.toString();
    return text ? `${path}?${text}` : path;
  }

  window.BatteryLifeConfig = freeze({
    routes,
    api,
    downloads,
    navigation,
    chartColors,
    routeUrl(name, params = {}) {
      if (!routes[name]) throw new Error(`未知页面地址：${name}`);
      const query = new URLSearchParams(params);
      query.set("v", pageRevision);
      return appendQuery(routes[name], query);
    },
    downloadUrl(name, params = {}) {
      if (!downloads[name]) throw new Error(`未知下载地址：${name}`);
      return appendQuery(downloads[name], params);
    },
  });
})();

// Detail and comparison pages share the same protocol labels, units and stage order.
window.BatteryLifeProtocol = (() => {
  const fields = [
    ["rate_in_C", "倍率", "C"], ["current_in_A", "电流", "A"],
    ["voltage_in_V", "电压", "V"], ["power_in_W", "功率", "W"],
    ["start_voltage_in_V", "起始电压", "V"], ["end_voltage_in_V", "结束电压", "V"],
    ["start_soc", "起始 SOC", ""], ["end_soc", "结束 SOC", ""],
  ];

  function stageText(stage) {
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) return "结构待核对";
    const values = fields.flatMap(([key, label, unit]) => {
      const value = stage[key];
      if (value == null || value === "") return [];
      if (typeof value === "number" && Number.isFinite(value)) {
        const number = value.toLocaleString("zh-CN", { maximumFractionDigits: 4 });
        return [`${label} ${number}${unit ? ` ${unit}` : ""}`];
      }
      return [`${label}字段原值 ${String(value)}`];
    });
    return values.join("、") || "控制字段未提供";
  }

  function render(target, protocol) {
    target.replaceChildren();
    if (protocol == null || Array.isArray(protocol) && !protocol.length) {
      target.textContent = "未提供";
      return;
    }
    if (!Array.isArray(protocol)) {
      target.textContent = "记录结构待核对";
      return;
    }
    const list = document.createElement("ol");
    list.className = "protocol-stages";
    protocol.forEach((stage, index) => {
      const item = document.createElement("li");
      item.className = "protocol-stage";
      const label = document.createElement("span");
      label.className = "protocol-stage-label";
      label.textContent = `阶段 ${index + 1}`;
      const value = document.createElement("span");
      value.className = "protocol-stage-value";
      value.textContent = stageText(stage);
      item.append(label, value);
      list.append(item);
    });
    target.append(list);
  }

  return { render };
})();
