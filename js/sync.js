/* Окно «Сохраните ваши записи»: регистрация и вход с кодом подтверждения из письма.
   Экраны (data-view на #syncModal):
     register — имя + почта → «Создать аккаунт» → на почту уходит код → экран code
     login    — почта → «Получить код» → экран code
     code     — 6 цифр из письма → «Подтвердить» → экран success
     success  — «Готово, …!» → «Продолжить писать» (курсор возвращается в поле)
   Окно появляется при каждом нажатии на поле для текста или числа, пока человек
   не зарегистрировался или не вошёл; после этого больше не появляется.

   ОТПРАВКА ПИСЕМ. Сайт сам письма слать не умеет — нужен сервер или сервис
   (например, Supabase Auth: signInWithOtp + verifyOtp дают ровно этот сценарий).
   Всё общение с сервером собрано в объекте Auth ниже: подставьте туда настоящие
   запросы. Пока сервера нет, работает ДЕМО-режим: код не отправляется, а показывается
   прямо в окне жёлтой подсказкой, и честно помечен как демо. */
(function () {
  "use strict";
  var modal = document.getElementById("syncModal");
  if (!modal) return;
  var regForm = document.getElementById("syncForm");
  var loginForm = document.getElementById("syncLoginForm");
  var codeForm = document.getElementById("syncCodeForm");
  var boxes = [].slice.call(codeForm.querySelectorAll(".code-box"));
  var hello = document.getElementById("syncHello");
  var successMsg = modal.querySelector(".sync-success__msg");
  var codeEmailEl = modal.querySelector(".sync-code-email");
  var demoHint = modal.querySelector(".sync-demo-hint");
  var resendBtn = modal.querySelector("[data-sync-resend]");
  var resendTimer = modal.querySelector(".sync-resend-timer");
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var KEY = "kniga-goda:v1:syncUser";            // кто сейчас вошёл (сбрасывается кнопкой в шапке)
  var ACCOUNTS = "kniga-goda:v1:accounts";       // известные аккаунты почта → имя (чтобы при входе поприветствовать по имени)
  var lastFocus = null;
  var pending = null;            // { mode: "register"|"login", name, email }
  var cooldown = 0, cdTimer = 0;

  var BOOK_FIELDS = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"], ' +
    'input:not([type]), input[type="text"], input[type="number"], input[type="email"], input[type="tel"], input[type="search"]';

  /* ---------- общение с сервером (заменить на настоящее) ---------- */
  var DEMO = true;
  var demoCodes = {};
  var Auth = {
    // отправить код на почту; mode — "register" или "login"
    sendCode: function (email, mode, name) {
      // НАСТОЯЩИЙ ВАРИАНТ (Supabase): return supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: mode === "register", data: { name } } });
      return new Promise(function (resolve) {
        demoCodes[email] = String(Math.floor(100000 + Math.random() * 900000));
        setTimeout(function () { resolve({ demoCode: demoCodes[email] }); }, 700);
      });
    },
    // проверить код; resolve(true/false)
    verifyCode: function (email, code) {
      // НАСТОЯЩИЙ ВАРИАНТ (Supabase): return supabase.auth.verifyOtp({ email, token: code, type: "email" }).then(r => !r.error);
      return new Promise(function (resolve) {
        setTimeout(function () { resolve(demoCodes[email] === code); }, 600);
      });
    }
  };

  function isRegistered() { try { return !!localStorage.getItem(KEY); } catch (e) { return false; } }

  /* ---------- звёзды ---------- */
  (function makeStars() {
    var sky = modal.querySelector(".sync-modal__stars");
    var rnd = function (a, b) { return a + Math.random() * (b - a); };
    var frag = document.createDocumentFragment(), i, s, size;
    for (i = 0; i < 45; i++) {
      s = document.createElement("span"); size = rnd(1, 2.6);
      s.className = "star" + (Math.random() < 0.3 ? " star--gold" : "");
      s.style.cssText = "left:" + rnd(0, 100) + "%;top:" + rnd(0, 100) + "%;width:" + size + "px;height:" + size + "px;" +
        "--d:" + rnd(2, 5).toFixed(2) + "s;--delay:" + rnd(0, 5).toFixed(2) + "s";
      frag.appendChild(s);
    }
    for (i = 0; i < 6; i++) {
      s = document.createElement("span"); s.className = "sparkle"; s.innerHTML = "<i></i>";
      s.style.cssText = "left:" + rnd(4, 96) + "%;top:" + rnd(4, 96) + "%;--s:" + rnd(10, 22).toFixed(0) + "px;" +
        "--d:" + rnd(3, 6).toFixed(2) + "s;--delay:" + rnd(0, 6).toFixed(2) + "s";
      frag.appendChild(s);
    }
    sky.appendChild(frag);
  })();

  /* ---------- экраны ---------- */
  function show(view) {
    modal.dataset.view = view;
    var first = { register: regForm.name, login: loginForm.email, code: boxes[0] }[view];
    if (first) setTimeout(function () { first.focus(); }, 60);
  }
  function open(target, view) {
    lastFocus = target || document.activeElement;
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    document.documentElement.style.overflow = "hidden";
    setTimeout(function () { show(view || "register"); }, 250);
  }
  function close() {
    if (!modal.classList.contains("is-open")) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
    // курсор возвращаем в поле только после регистрации/входа — иначе окно открылось бы снова
    if (isRegistered() && lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function busy(form, on) {
    var b = form.querySelector(".sync-btn");
    b.disabled = on; b.classList.toggle("is-loading", on);
  }
  function setError(form, name, isError) {
    form.querySelector('[data-field="' + name + '"]').classList.toggle("is-invalid", isError);
  }

  /* ---------- отправка кода ---------- */
  function startCooldown() {
    cooldown = 60;
    resendBtn.disabled = true;
    clearInterval(cdTimer);
    var tick = function () {
      resendTimer.textContent = cooldown > 0 ? "через " + cooldown + " с" : "";
      if (cooldown <= 0) { clearInterval(cdTimer); resendBtn.disabled = false; }
      cooldown--;
    };
    tick(); cdTimer = setInterval(tick, 1000);
  }
  function sendCode(form) {
    busy(form, true);
    return Auth.sendCode(pending.email, pending.mode, pending.name).then(function (res) {
      codeEmailEl.textContent = pending.email;
      boxes.forEach(function (b) { b.value = ""; });
      setError(codeForm, "code", false);
      if (DEMO && res && res.demoCode) {
        demoHint.hidden = false;
        demoHint.textContent = "Демо-режим: письма пока не отправляются (нет сервера). Ваш код — " + res.demoCode;
      } else demoHint.hidden = true;
      startCooldown();
      show("code");
    }).finally(function () { busy(form, false); });
  }

  regForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = regForm.name.value.trim(), email = regForm.email.value.trim();
    var okN = name.length >= 2, okE = EMAIL_RE.test(email);
    setError(regForm, "name", !okN); setError(regForm, "email", !okE);
    if (!okN || !okE) return;
    pending = { mode: "register", name: name, email: email };
    sendCode(regForm);
  });
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = loginForm.email.value.trim(), ok = EMAIL_RE.test(email);
    setError(loginForm, "email", !ok);
    if (!ok) return;
    pending = { mode: "login", name: "", email: email };
    sendCode(loginForm);
  });

  /* ---------- ввод кода: 6 ячеек, автопереход, вставка целиком ---------- */
  boxes.forEach(function (b, i) {
    b.addEventListener("input", function () {
      var d = b.value.replace(/\D/g, "");
      if (d.length > 1) {                                   // вставили сразу несколько цифр
        d.split("").slice(0, 6 - i).forEach(function (ch, k) { boxes[i + k].value = ch; });
        (boxes[Math.min(5, i + d.length)] || b).focus();
      } else {
        b.value = d;
        if (d && boxes[i + 1]) boxes[i + 1].focus();
      }
      setError(codeForm, "code", false);
      if (boxes.every(function (x) { return x.value; })) codeForm.requestSubmit();
    });
    b.addEventListener("keydown", function (e) {
      if (e.key === "Backspace" && !b.value && boxes[i - 1]) { boxes[i - 1].focus(); boxes[i - 1].value = ""; e.preventDefault(); }
      if (e.key === "ArrowLeft" && boxes[i - 1]) boxes[i - 1].focus();
      if (e.key === "ArrowRight" && boxes[i + 1]) boxes[i + 1].focus();
    });
    b.addEventListener("paste", function (e) {
      var t = (e.clipboardData || window.clipboardData).getData("text").replace(/\D/g, "").slice(0, 6);
      if (!t) return;
      e.preventDefault();
      t.split("").forEach(function (ch, k) { if (boxes[k]) boxes[k].value = ch; });
      (boxes[Math.min(5, t.length)] || b).focus();
      if (t.length === 6) codeForm.requestSubmit();
    });
  });
  codeForm.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!pending) return;
    var code = boxes.map(function (x) { return x.value; }).join("");
    if (code.length < 6) { setError(codeForm, "code", true); return; }
    busy(codeForm, true);
    Auth.verifyCode(pending.email, code).then(function (ok) {
      if (!ok) { setError(codeForm, "code", true); boxes.forEach(function (x) { x.value = ""; }); boxes[0].focus(); return; }
      var user = { name: pending.name, email: pending.email };
      try {
        var accs = JSON.parse(localStorage.getItem(ACCOUNTS) || "{}");
        if (!user.name && accs[user.email]) user.name = accs[user.email];
        if (user.name) accs[user.email] = user.name;
        localStorage.setItem(ACCOUNTS, JSON.stringify(accs));
        localStorage.setItem(KEY, JSON.stringify(user));
      } catch (er) {}
      hello.textContent = user.name || "друг";
      successMsg.textContent = pending.mode === "register"
        ? "Почта подтверждена, аккаунт создан. Можно продолжать писать."
        : "Вы вошли в свою книгу. Можно продолжать писать.";
      document.dispatchEvent(new CustomEvent("sync:success", { detail: user }));
      show("success");
    }).finally(function () { busy(codeForm, false); });
  });

  resendBtn.addEventListener("click", function () {
    if (!pending || resendBtn.disabled) return;
    sendCode(codeForm);
  });

  /* ---------- переходы, закрытие, клавиатура ---------- */
  modal.addEventListener("click", function (e) {
    var go = e.target.closest("[data-sync-go]");
    if (go) {
      if (go.dataset.syncGo === "login" && EMAIL_RE.test(regForm.email.value.trim())) loginForm.email.value = regForm.email.value.trim();
      show(go.dataset.syncGo);
    }
    if (e.target.closest("[data-sync-back]")) show(pending && pending.mode === "login" ? "login" : "register");
    if (e.target.closest("[data-sync-close]")) close();
  });
  [regForm, loginForm].forEach(function (f) {
    f.addEventListener("input", function (e) { var x = e.target.closest(".field"); if (x) x.classList.remove("is-invalid"); });
  });
  document.addEventListener("keydown", function (e) {
    if (!modal.classList.contains("is-open")) return;
    if (e.key === "Escape") close();
    if (e.key === "Tab") {
      var items = [].slice.call(modal.querySelectorAll("button, input")).filter(function (el) { return el.offsetParent && !el.disabled; });
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /* ---------- показ окна: человек ставит курсор в поле для текста или числа ---------- */
  document.addEventListener("focusin", function (e) {
    var el = e.target;
    if (modal.contains(el) || !el.matches || !el.matches(BOOK_FIELDS)) return;
    if (el.closest("dialog")) return;          // поля во всплывающих окнах сайта (желание на Древе)
    if (isRegistered() || modal.classList.contains("is-open")) return;   // показываем при каждом нажатии, пока нет данных
    el.blur();
    open(el);
  });

  window.SyncModal = {
    open: function (view) { open(null, view); }, close: close, Auth: Auth,
    // выйти из аккаунта (для демонстрации): ответы и список аккаунтов остаются
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) {}
      [regForm, loginForm].forEach(function (f) { f.reset(); });
      pending = null;
    }
  };
  /* кнопка в шапке справа: сбросить регистрацию (для демонстрации регистрации и входа) */
  var resetBtn = document.querySelector(".sync-reset");
  if (resetBtn) resetBtn.addEventListener("click", function () {
    window.SyncModal.reset();
    resetBtn.classList.remove("is-done"); void resetBtn.offsetWidth; resetBtn.classList.add("is-done");
    resetBtn.setAttribute("aria-label", "Регистрация сброшена");
    setTimeout(function () { resetBtn.setAttribute("aria-label", "Сбросить регистрацию"); }, 1500);
  });})();
