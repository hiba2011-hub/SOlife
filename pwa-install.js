/* LifeOS — installable PWA layer.
 *
 * Responsibilities
 *  1. Register the service worker (installability requires a controlled page).
 *  2. Capture `beforeinstallprompt` and offer a real one-click install button.
 *  3. Fall back to clear per-platform instructions when the browser has no
 *     install prompt (iOS Safari, Firefox, some in-app browsers).
 *  4. Hide every install affordance once the app is already installed.
 *  5. Surface service-worker updates instead of leaving stale code running.
 *  6. Support `?page=` deep links used by the home-screen shortcuts.
 *
 * This file is intentionally standalone: it injects its own UI so the rest of
 * the app does not need to know it exists.
 */
(function () {
  "use strict";

  // Nothing to do when already running as an installed app.
  var displayModes = ["standalone", "minimal-ui", "window-controls-overlay", "fullscreen"];
  var isStandalone =
    displayModes.some(function (mode) {
      return window.matchMedia("(display-mode: " + mode + ")").matches;
    }) || window.navigator.standalone === true;

  var ua = navigator.userAgent || "";
  var isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; the touch points give it away.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  // Chrome/Edge/Samsung support the install prompt; Firefox & iOS Safari do not.
  var supportsPrompt = "onbeforeinstallprompt" in window;

  var deferredPrompt = null;
  var installed = isStandalone;
  var bannerDismissed = false;

  function toast(message, isError) {
    if (typeof window.showToast === "function") {
      window.showToast(message, !!isError);
    }
  }

  /* ---------------------------------------------------------------- SW -- */

  var updateBar = null;

  function showUpdateBar() {
    if (!updateBar) {
      updateBar = document.createElement("div");
      updateBar.className = "pwa-update-bar";
      updateBar.setAttribute("role", "status");
      var text = document.createElement("span");
      text.textContent = "A new version of LifeOS is ready.";
      var button = document.createElement("button");
      button.type = "button";
      button.className = "pwa-update-btn";
      button.textContent = "Update";
      button.addEventListener("click", function () {
        button.textContent = "Updating…";
        button.disabled = true;
        // Ask the waiting worker to take over; activate handler then reloads.
        if (registration && registration.waiting) {
          registration.waiting.postMessage("skip-waiting");
        } else {
          window.location.reload();
        }
      });
      updateBar.appendChild(text);
      updateBar.appendChild(button);
      document.body.appendChild(updateBar);
    }
    updateBar.classList.add("show");
  }

  var registration = null;
  var refreshing = false;

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker
        .register("./sw.js", { scope: "./" })
        .then(function (reg) {
          registration = reg;

          // A worker is already waiting from a previous visit.
          if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar();

          reg.addEventListener("updatefound", function () {
            var installing = reg.installing;
            if (!installing) return;
            installing.addEventListener("statechange", function () {
              // "installed" + an existing controller == an update is ready.
              if (installing.state === "installed" && navigator.serviceWorker.controller) {
                showUpdateBar();
              }
            });
          });

          // Look for a new version whenever the app regains focus.
          document.addEventListener("visibilitychange", function () {
            if (document.visibilityState === "visible") reg.update().catch(function () {});
          });
        })
        .catch(function (error) {
          // Most commonly: the app is opened from file:// — installability and
          // offline support need http(s).
          console.warn("LifeOS: service worker registration failed.", error);
        });

      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (refreshing) return;
        refreshing = true;
        window.location.reload();
      });
    });
  }

  /* ------------------------------------------------------------- prompt -- */

  window.addEventListener("beforeinstallprompt", function (event) {
    // Stop the browser's own mini-infobar so our UI owns the moment.
    event.preventDefault();
    deferredPrompt = event;
    installed = false;
    refreshInstallUI();
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    installed = true;
    hideBanner(true);
    refreshInstallUI();
    toast("LifeOS installed. Launch it from your home screen 🎉");
  });

  /* --------------------------------------------------------------- UI -- */

  function publisher() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then(function (choice) {
        deferredPrompt = null;
        if (choice.outcome === "accepted") {
          hideBanner(true);
          refreshInstallUI();
        } else {
          // They said no for now — keep the buttons, drop the nagging banner.
          hideBanner(true);
          refreshInstallUI();
        }
      });
      return;
    }
    openInstallHelp();
  }

  // Sidebar entry, styled like a nav item.
  var sidebarBtn = null;
  function buildSidebarButton() {
    var footer = document.querySelector(".sidebar-footer");
    if (!footer) return;
    sidebarBtn = document.createElement("button");
    sidebarBtn.type = "button";
    sidebarBtn.className = "nav-item pwa-install-nav";
    sidebarBtn.innerHTML = '<span>⬇</span>Install app';
    sidebarBtn.addEventListener("click", function (event) {
      event.stopPropagation();
      publisher();
    });
    var settingsNav = footer.querySelector('[data-page="settings"]');
    footer.insertBefore(sidebarBtn, settingsNav || null);
  }

  // Settings card, injected into the existing settings grid.
  var settingsCard = null;
  function buildSettingsCard() {
    var grid = document.querySelector("#page-settings .settings-grid");
    if (!grid) return;
    settingsCard = document.createElement("article");
    settingsCard.className = "card setting-item pwa-install-card";
    settingsCard.innerHTML =
      '<div><h3>Install app</h3><p class="muted" data-pwa-copy>' +
      "Add LifeOS to your home screen and use it offline." +
      "</p></div>" +
      '<button class="secondary-btn" type="button" data-pwa-action>Install</button>';
    settingsCard
      .querySelector("[data-pwa-action]")
      .addEventListener("click", function (event) {
        event.stopPropagation();
        publisher();
      });
    grid.insertBefore(settingsCard, grid.firstChild);
  }

  // One-time bottom banner (most useful on mobile).
  var banner = null;
  function buildBanner() {
    banner = document.createElement("div");
    banner.className = "pwa-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-label", "Install LifeOS");
    banner.innerHTML =
      '<img class="pwa-banner-icon" src="icon-192.png" alt="" width="42" height="42" />' +
      '<div class="pwa-banner-copy">' +
      "<strong>Install LifeOS</strong>" +
      "<span>Add it to your home screen for a full-screen, offline app.</span>" +
      "</div>" +
      '<div class="pwa-banner-actions">' +
      '<button class="primary-btn" type="button" data-pwa-banner-install>Install</button>' +
      '<button class="pwa-banner-close" type="button" aria-label="Dismiss" data-pwa-banner-close>×</button>' +
      "</div>";
    banner
      .querySelector("[data-pwa-banner-install]")
      .addEventListener("click", publisher);
    banner
      .querySelector("[data-pwa-banner-close]")
      .addEventListener("click", function () {
        hideBanner(true);
      });
    document.body.appendChild(banner);
  }

  var BANNER_KEY = "lifeos_install_banner_v1";

  function bannerAlreadySeen() {
    try {
      return localStorage.getItem(BANNER_KEY) === "seen";
    } catch (e) {
      return false;
    }
  }

  function markBannerSeen() {
    try {
      localStorage.setItem(BANNER_KEY, "seen");
    } catch (e) {
      /* private mode — the banner may show again next launch, which is fine */
    }
  }

  function hideBanner(remember) {
    bannerDismissed = true;
    if (banner) banner.classList.remove("show");
    if (remember) markBannerSeen();
  }

  // iOS can never fire beforeinstallprompt, so the banner is the only nudge.
  // `promptChecked` turns on after a short wait so browsers that support the
  // prompt but never fire it (already installed elsewhere, criteria not met)
  // still get a "how to" path instead of nothing at all.
  var promptChecked = false;

  function canOfferInstall() {
    if (installed) return false;
    return !!deferredPrompt || isIOS || isAndroid || !supportsPrompt || promptChecked;
  }

  // The banner and the one-click wording are reserved for devices where a
  // real install really is one tap away.
  function canPromptNow() {
    return !!deferredPrompt || (!installed && (isIOS || isAndroid));
  }

  function refreshInstallUI() {
    var offer = canOfferInstall();

    [sidebarBtn, settingsCard].forEach(function (node) {
      if (!node) return;
      node.hidden = !offer;
    });
    if (settingsCard) {
      var copy = settingsCard.querySelector("[data-pwa-copy]");
      var action = settingsCard.querySelector("[data-pwa-action]");
      if (copy && action) {
        if (deferredPrompt) {
          copy.textContent = "Add LifeOS to your home screen and use it offline.";
          action.textContent = "Install";
        } else if (installed) {
          copy.textContent = "LifeOS is installed on this device.";
          action.textContent = "Installed";
        } else if (isIOS) {
          copy.textContent = "Add LifeOS to your home screen from the Share menu.";
          action.textContent = "How to";
        } else {
          copy.textContent = "Add LifeOS to your home screen and use it offline.";
          action.textContent = "How to";
        }
      }
    }

    if (!banner) return;
    if (canPromptNow() && !bannerDismissed && !bannerAlreadySeen()) {
      // Give the app a moment to paint before sliding the banner in.
      window.setTimeout(function () {
        if (!bannerDismissed && !installed) banner.classList.add("show");
      }, 2500);
    } else {
      banner.classList.remove("show");
    }
  }

  /* ------------------------------------------------------------- help -- */

  var helpModal = null;
  function buildHelpModal() {
    helpModal = document.createElement("div");
    helpModal.className = "modal-backdrop pwa-help";
    helpModal.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="pwaHelpTitle">' +
      '<div class="modal-head"><div>' +
      '<span class="eyebrow">INSTALL</span>' +
      '<h2 id="pwaHelpTitle">Add LifeOS to your device</h2>' +
      "</div>" +
      '<button class="icon-btn" type="button" data-pwa-close aria-label="Close">×</button>' +
      "</div>" +
      '<p class="modal-note" data-pwa-help-lead></p>' +
      '<ol class="pwa-steps" data-pwa-steps></ol>' +
      '<div class="form-actions"><button class="secondary-btn" type="button" data-pwa-close>Got it</button></div>' +
      "</div>";

    helpModal.addEventListener("click", function (event) {
      if (event.target === helpModal || event.target.closest("[data-pwa-close]")) {
        helpModal.classList.remove("open");
      }
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") helpModal.classList.remove("open");
    });
    document.body.appendChild(helpModal);
  }

  function stepsForCurrentDevice() {
    if (isIOS) {
      if (!/Safari/i.test(ua) || /CriOS|FxiOS|EdgiOS|OPiOS|GSA/i.test(ua)) {
        return {
          lead: "On iPhone and iPad, apps can only be installed from Safari.",
          steps: [
            "Copy this page's address.",
            "Open it in Safari.",
            "Tap Share, then Add to Home Screen.",
          ],
        };
      }
      return {
        lead: "Installing from Safari takes about five seconds.",
        steps: [
          "Tap the Share button (the square with an arrow) at the bottom of Safari.",
          "Scroll the menu and tap “Add to Home Screen”.",
          "Tap “Add” — LifeOS appears on your home screen like a normal app.",
        ],
      };
    }
    if (isAndroid) {
      return {
        lead: "On Android you can install LifeOS from Chrome, Edge or Samsung Internet.",
        steps: [
          "Tap the ⋮ menu in the top-right of the browser.",
          "Choose “Install app” or “Add to Home screen”.",
          "Confirm — LifeOS opens full screen with its own icon.",
        ],
      };
    }
    if (supportsPrompt) {
      return {
        lead: "Your browser can install LifeOS in one click.",
        steps: [
          "Look for the install icon at the right end of the address bar.",
          "Click it, then confirm “Install”.",
          "LifeOS opens in its own window and is pinned to your dock or app list.",
        ],
      };
    }
    return {
      lead: "This browser cannot install web apps yet — but Chrome, Edge or Safari can.",
      steps: [
        "Open this page in Chrome, Edge or Safari on this device.",
        "Use “Install app” (desktop) or Share → “Add to Home Screen” (iPhone/iPad).",
        "Your data stays on this device, so export a backup first if you switch browsers.",
      ],
    };
  }

  function openInstallHelp() {
    if (!helpModal) buildHelpModal();
    var info = stepsForCurrentDevice();
    helpModal.querySelector("[data-pwa-help-lead]").textContent = info.lead;
    var list = helpModal.querySelector("[data-pwa-steps]");
    list.innerHTML = "";
    info.steps.forEach(function (step) {
      var li = document.createElement("li");
      li.textContent = step;
      list.appendChild(li);
    });
    helpModal.classList.add("open");
  }

  /* ------------------------------------------------------- deep links -- */

  function applyDeepLink() {
    var params = new URLSearchParams(window.location.search);
    var page = params.get("page");

    // Also honour the hash form: index.html#dashboard
    if (!page && window.location.hash.length > 1) {
      page = window.location.hash.slice(1);
    }
    if (!page) return;

    var target = "page-" + page;
    if (!document.getElementById(target)) return;
    if (typeof window.pageNav === "function") {
      window.pageNav(page);
      // Keep the URL clean so a reload does not re-trigger navigation.
      try {
        window.history.replaceState({}, "", window.location.pathname);
      } catch (e) {
        /* ignore */
      }
    }
  }

  /* --------------------------------------------------------------- go -- */

  var initialised = false;

  function init() {
    // Defensive: DOMContentLoaded can be dispatched more than once (and the
    // app shell may be re-injected). Never build the UI twice.
    if (initialised) return;
    initialised = true;

    buildSidebarButton();
    buildSettingsCard();
    buildBanner();
    refreshInstallUI();
    applyDeepLink();

    // If the browser supports the install prompt but has not offered one yet,
    // stop waiting after a few seconds and show the manual path.
    if (supportsPrompt && !isStandalone) {
      window.setTimeout(function () {
        if (deferredPrompt || installed) return;
        promptChecked = true;
        refreshInstallUI();
      }, 5000);
    }

    // Keep the UI honest if the app is installed from the browser's own menu.
    window.matchMedia("(display-mode: standalone)").addEventListener?.(
      "change",
      function (event) {
        installed = event.matches;
        refreshInstallUI();
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
