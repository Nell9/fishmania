/* КлёвГид — аналитика посещений (для админ-статистики).
   Шлёт на /api/track: просмотр страницы, клики (что нажимали), время на сайте.
   IP и гео определяются на сервере по запросу. Подключается простым <script defer>. */
(function () {
  "use strict";
  var LS_ANON = "klev.anon";
  function anonId() {
    var a = localStorage.getItem(LS_ANON);
    if (!a) { a = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)); localStorage.setItem(LS_ANON, a); }
    return a;
  }

  var buf = [];
  var lastTick = Date.now();
  var active = true;

  function push(type, label, meta) {
    buf.push({ type: type, label: (label || "").slice(0, 180), path: location.pathname, meta: meta || null });
    if (buf.length >= 15) flush(false);
  }

  function elapsedMs() {
    var now = Date.now(), d = active ? (now - lastTick) : 0;
    lastTick = now;
    return Math.min(d, 5 * 60000); // не больше 5 мин за раз (защита от «уснувшей» вкладки)
  }

  function flush(useBeacon) {
    var ms = elapsedMs();
    if (!buf.length && ms < 1000) return;
    var events = buf.slice();
    if (ms >= 1000) events.push({ type: "time", label: "active", ms: ms });
    buf = [];
    var body = JSON.stringify({ anon: anonId(), events: events });
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {});
    }
  }

  /* клики — что нажимали */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("button, a, [data-track], .step, [role=button], label");
    if (!t) return;
    var label = (t.getAttribute("data-track") || t.id || (t.textContent || "").trim() || t.getAttribute("aria-label") || t.tagName).slice(0, 80);
    push("click", label, null);
  }, true);

  /* смена «шага» мастера, если приложение шлёт событие (необязательно) */
  window.addEventListener("klev-step", function (e) { push("step", (e.detail && e.detail.name) || "", null); });

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { flush(true); active = false; }
    else { active = true; lastTick = Date.now(); }
  });
  window.addEventListener("pagehide", function () { flush(true); });
  window.addEventListener("beforeunload", function () { flush(true); });
  setInterval(function () { flush(false); }, 15000);

  push("pageview", document.title, { ref: document.referrer || null, w: screen.width, h: screen.height });
  flush(false);
})();
