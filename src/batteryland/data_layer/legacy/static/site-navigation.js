"use strict";

(() => {
  const config = window.BatteryLifeConfig;
  if (!config) throw new Error("站点配置未加载");

  const currentPath = location.pathname.replace(/\/$/, "") || "/";

  function makeLink(item) {
    const link = document.createElement("a");
    link.href = config.routes[item.key];
    link.textContent = item.label;
    if (currentPath === config.routes[item.key].replace(/\/$/, "")) link.setAttribute("aria-current", "page");
    return link;
  }

  function renderNavigation(target) {
    target.replaceChildren();

    for (const item of config.navigation.primary) target.append(makeLink(item));
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
