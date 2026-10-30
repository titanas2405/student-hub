"use strict";
// Applies the chosen theme before the page is drawn, so it doesn't flash in the other one first.
(function () {
  try {
    var theme = localStorage.getItem("theme");
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
  } catch (e) {}
})();
