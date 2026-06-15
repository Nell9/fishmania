/* КлёвГид — регистрация/вход и гейтинг AI.
   AI-анализ (/api/ai/*) сервер отдаёт только зарегистрированным. Этот скрипт:
   - хранит токен и anon-id в localStorage;
   - добавляет ко всем /api/-запросам заголовки X-Anon-Id и Authorization;
   - при 401 на /api/ai/* открывает окно регистрации;
   - рисует кнопку аккаунта и модалку. Подключается простым <script defer>. */
(function () {
  "use strict";
  var LS_TOKEN = "klev.token", LS_ANON = "klev.anon", LS_EMAIL = "klev.email";

  function anonId() {
    var a = localStorage.getItem(LS_ANON);
    if (!a) { a = (Date.now().toString(36) + Math.random().toString(36).slice(2, 10)); localStorage.setItem(LS_ANON, a); }
    return a;
  }
  function token() { return localStorage.getItem(LS_TOKEN) || ""; }
  function setSession(t, email) {
    if (t) localStorage.setItem(LS_TOKEN, t); else localStorage.removeItem(LS_TOKEN);
    if (email) localStorage.setItem(LS_EMAIL, email); else localStorage.removeItem(LS_EMAIL);
    renderBtn();
  }
  function isAuthed() { return !!token(); }

  /* перехват fetch: заголовки на /api/, и модалка при 401 на AI */
  var _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    init = init || {};
    var url = (typeof input === "string") ? input : (input && input.url) || "";
    var sameApi = url.indexOf("/api/") === 0 || url.indexOf("/api/") === (location.origin + "/api/").indexOf("/api/");
    if (/(^|\/)api\//.test(url) && !/^https?:\/\//.test(url) || url.indexOf(location.origin + "/api/") === 0) {
      var h = new Headers(init.headers || (typeof input !== "string" && input.headers) || {});
      h.set("X-Anon-Id", anonId());
      if (token()) h.set("Authorization", "Bearer " + token());
      init.headers = h;
    }
    var p = _fetch(input, init);
    if (/\/api\/ai\//.test(url)) {
      return p.then(function (r) {
        if (r.status === 401) { openModal("Зарегистрируйтесь, чтобы пользоваться AI-анализом"); }
        return r;
      });
    }
    return p;
  };

  /* ---------- UI ---------- */
  function el(tag, attrs, html) { var e = document.createElement(tag); if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]); if (html != null) e.innerHTML = html; return e; }

  function renderBtn() {
    var b = document.getElementById("klev-acct"); if (!b) return;
    var em = localStorage.getItem(LS_EMAIL);
    b.textContent = isAuthed() ? ("👤 " + (em || "аккаунт")) : "Войти / Регистрация";
  }

  function ensureUI() {
    if (document.getElementById("klev-acct")) return;
    var btn = el("button", { id: "klev-acct", type: "button",
      style: "position:fixed;right:14px;top:14px;z-index:9999;background:#15324f;color:#dceeff;border:1px solid #2c5f93;border-radius:20px;padding:8px 14px;font:13px system-ui;cursor:pointer;box-shadow:0 2px 10px #0004" });
    btn.onclick = function () { isAuthed() ? openAccount() : openModal(); };
    document.body.appendChild(btn);
    renderBtn();
  }

  function modalShell(title) {
    closeModal();
    var ov = el("div", { id: "klev-modal", style: "position:fixed;inset:0;z-index:10000;background:#0008;display:flex;align-items:center;justify-content:center;padding:16px" });
    var box = el("div", { style: "background:#fff;color:#13212e;max-width:380px;width:100%;border-radius:16px;padding:22px;font:14px/1.5 system-ui;box-shadow:0 12px 40px #0006" });
    box.appendChild(el("div", { style: "font-size:18px;font-weight:700;margin-bottom:4px" }, "🎣 " + title));
    ov.appendChild(box); ov.onclick = function (e) { if (e.target === ov) closeModal(); };
    document.body.appendChild(ov);
    return box;
  }
  function closeModal() { var m = document.getElementById("klev-modal"); if (m) m.remove(); }

  function openModal(note) {
    var box = modalShell("Вход в КлёвГид");
    var sub = el("div", { style: "color:#5b6b78;margin-bottom:14px;font-size:13px" }, note || "AI-анализ водоёма и тактика доступны после регистрации. Это бесплатно.");
    box.appendChild(sub);
    var inEmail = el("input", { type: "email", placeholder: "email", style: inpCss() });
    var inPass = el("input", { type: "password", placeholder: "пароль (мин. 6 символов)", style: inpCss() });
    var err = el("div", { style: "color:#c0392b;font-size:13px;min-height:18px;margin:2px 0 8px" });
    box.appendChild(inEmail); box.appendChild(inPass); box.appendChild(err);
    var row = el("div", { style: "display:flex;gap:10px" });
    var bReg = el("button", { type: "button", style: btnCss(true) }, "Зарегистрироваться");
    var bLog = el("button", { type: "button", style: btnCss(false) }, "Войти");
    row.appendChild(bReg); row.appendChild(bLog); box.appendChild(row);
    function go(path) {
      err.textContent = "";
      _fetch(path, { method: "POST", headers: { "Content-Type": "application/json", "X-Anon-Id": anonId() },
        body: JSON.stringify({ email: inEmail.value.trim(), password: inPass.value }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          if (!x.ok) { err.textContent = x.j.error || "Ошибка"; return; }
          setSession(x.j.token, x.j.email); closeModal();
          window.dispatchEvent(new CustomEvent("klev-auth", { detail: { authed: true } }));
        })
        .catch(function () { err.textContent = "Сеть недоступна"; });
    }
    bReg.onclick = function () { go("/api/auth/register"); };
    bLog.onclick = function () { go("/api/auth/login"); };
    inPass.onkeydown = function (e) { if (e.key === "Enter") go("/api/auth/login"); };
    inEmail.focus();
  }

  function openAccount() {
    var box = modalShell("Аккаунт");
    box.appendChild(el("div", { style: "margin-bottom:14px" }, "Вы вошли как <b>" + (localStorage.getItem(LS_EMAIL) || "") + "</b>"));
    var b = el("button", { type: "button", style: btnCss(false) }, "Выйти");
    b.onclick = function () {
      _fetch("/api/auth/logout", { method: "POST", headers: { "Authorization": "Bearer " + token() } }).finally(function () {
        setSession(null, null); closeModal();
      });
    };
    box.appendChild(b);
  }

  function inpCss() { return "width:100%;padding:10px 12px;margin-bottom:10px;border:1px solid #cdd6df;border-radius:9px;font-size:14px"; }
  function btnCss(primary) { return "flex:1;padding:10px;border-radius:9px;border:1px solid " + (primary ? "#1769b0" : "#cdd6df") + ";background:" + (primary ? "#1f86e0" : "#f3f6f9") + ";color:" + (primary ? "#fff" : "#13212e") + ";font-weight:600;cursor:pointer"; }

  window.KlevAuth = { isAuthed: isAuthed, open: openModal, anonId: anonId, token: token };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureUI);
  else ensureUI();

  /* подтянуть состояние с сервера */
  if (token()) {
    _fetch("/api/auth/me", { headers: { "Authorization": "Bearer " + token() } })
      .then(function (r) { if (r.status === 401) setSession(null, null); else return r.json(); })
      .then(function (u) { if (u && u.email) setSession(token(), u.email); })
      .catch(function () {});
  }
})();
