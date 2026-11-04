"use strict";

(() => {
  const config = window.BatteryLifeConfig;
  if (!config) throw new Error("站点配置未加载");

  const currentPath = location.pathname.replace(/\/$/, "") || "/";

  function makeLink(item, variant) {
    const link = document.createElement("a");
    link.href = config.routes[item.key];
    link.textContent = item.label;
    if (variant === "detail") link.className = `overview-link${item.key === "detail" ? "" : " secondary"}`;
    if (currentPath === config.routes[item.key].replace(/\/$/, "")) link.setAttribute("aria-current", "page");
    return link;
  }

  function renderNavigation(target) {
    const variant = target.dataset.variant === "detail" ? "detail" : "standard";
    target.replaceChildren();

    for (const item of config.navigation.primary) target.append(makeLink(item, variant));
  }

  for (const target of document.querySelectorAll("[data-site-navigation]")) renderNavigation(target);

  for (const target of document.querySelectorAll("[data-route]")) {
    const route = config.routes[target.dataset.route];
    if (route) target.href = route;
  }
  for (const target of document.querySelectorAll("[data-download]")) {
    const path = config.downloads[target.dataset.download];
    if (path) target.href = path;
  }
})();
