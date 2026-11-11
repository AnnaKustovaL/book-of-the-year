/* Окно «Сохраните ваши записи»: регистрация и вход по ССЫЛКЕ из письма (Firebase Authentication).
   Экраны (data-view на #syncModal):
     register — имя + почта → «Создать аккаунт» → на почту уходит письмо со ссылкой → экран code
     login    — почта → «Получить ссылку» → экран code
     code     — «Проверьте почту»: ссылка отправлена, можно отправить ещё раз или изменить почту
     confirm  — ссылку открыли на другом устройстве: ввести почту, чтобы завершить вход
     success  — «Готово, …!» → «Продолжить писать»
   Человек нажимает ссылку в письме → открывается сайт → вход завершается сам → экран success,
   книга подтягивается из Firestore (js/cloud.js).
   Окно появляется при каждом нажатии на поле для текста или числа, пока человек не вошёл.

   Firebase подключён в index.html (window.Firebase, событие "firebase:ready").
   В консоли Firebase должны быть включены: Authentication → Электронная почта/пароль → «Ссылка по
   электронной почте», а адрес сайта (kustovaannetta.github.io) — в «Авторизованных доменах».
   Ссылка работает только на опубликованном сайте (или localhost): при открытии файла с диска
   окно честно скажет, что вход недоступен. */
(function () {
  "use strict";
  var modal = document.getElementById("syncModal");
  if (!modal) return;
  var regForm = document.getElementById("syncForm");
  var loginForm = document.getElementById("syncLoginForm");
  var confirmForm = document.getElementById("syncConfirmForm");
  var hello = document.getElementById("syncHello");
  var successMsg = modal.querySelector(".sync-success__msg");
  var codeEmailEl = modal.querySelector(".sync-code-email");
  var linkError = modal.querySelector(".sync-link-error");
  var resendBtn = modal.querySelector("[data-sync-resend]");
  var resendTimer = modal.querySelector(".sync-resend-timer");
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var KEY = "kniga-goda:v1:syncUser";            // кто сейчас вошёл: { name, email, uid }
  var EMAIL_FOR_LINK = "kniga-goda:emailForSignIn";   // почта, на которую ушла ссылка (чтобы завершить вход без вопросов)
  var NAME_FOR_LINK = "kniga-goda:nameForSignIn";     // имя из регистрации — запишем в профиль после входа
  var lastFocus = null;
  var pending = null;            // { mode: "register"|"login", name, email }
  var cooldown = 0, cdTimer = 0;

  var BOOK_FIELDS = 'textarea, [contenteditable="true"], [contenteditable="plaintext-only"], ' +
    'input:not([type]), input[type="text"], input[type="number"], input[type="email"], input[type="tel"], input[type="search"]';

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function isRegistered() { return !!get(KEY); }

  /* ---------- Firebase: ждём, пока подключится (index.html) ---------- */
  var fbReady = new Promise(function (resolve) {
    if (window.Firebase) resolve(window.Firebase);
    else document.addEventListener("firebase:ready", function (e) { resolve(e.detail); }, { once: true });
  });
  function linkUrl() { return location.origin + location.pathname; }   // куда вернёт ссылка из письма — на эту же страницу

  var Auth = {
    // отправить письмо со ссылкой для входа
    sendLink: function (email, name) {
      if (location.protocol === "file:") return Promise.reject({ code: "local-file" });
      return fbReady.then(function (F) {
        return F.fb.sendSignInLinkToEmail(F.auth, email, { url: linkUrl(), handleCodeInApp: true });
      }).then(function () {
        set(EMAIL_FOR_LINK, email);
        set(NAME_FOR_LINK, name || null);
      });
    },
    // завершить вход по ссылке из адресной строки
    complete: function (email) {
      return fbReady.then(function (F) {
        return F.fb.signInWithEmailLink(F.auth, email, location.href).then(function (cred) {
          var u = cred.user, name = get(NAME_FOR_LINK) || u.displayName || "";
          var job = (name && name !== u.displayName) ? F.fb.updateProfile(u, { displayName: name }).catch(function () {}) : Promise.resolve();
          return job.then(function () {
            set(EMAIL_FOR_LINK, null); set(NAME_FOR_LINK, null);
            history.replaceState(null, "", linkUrl() + location.hash);   // убрать служебные параметры ссылки из адреса
            return { name: name, email: u.email, uid: u.uid };
          });
        });
      });
    },
    signOut: function () { return fbReady.then(function (F) { return F.fb.signOut(F.auth); }).catch(function () {}); }
  };

  function errorText(err) {
    var c = (err && err.code) || "";
    if (c === "local-file") return "Вход работает на опубликованном сайте. Откройте kustovaannetta.github.io/book-of-the-year и попробуйте там.";
    if (c.indexOf("invalid-email") >= 0) return "Похоже, в адресе почты опечатка.";
    if (c.indexOf("unauthorized-continue-uri") >= 0 || c.indexOf("unauthorized-domain") >= 0) return "Этот адрес сайта не добавлен в Firebase (Authentication → Настройки → Авторизованные домены).";
    if (c.indexOf("operation-not-allowed") >= 0) return "В Firebase не включён вход по ссылке (Authentication → Способ входа → Электронная почта → «Ссылка по электронной почте»).";
    if (c.indexOf("quota-exceeded") >= 0 || c.indexOf("too-many-requests") >= 0) return "Слишком много писем подряд. Попробуйте чуть позже.";
    if (c.indexOf("network") >= 0) return "Нет связи с интернетом. Проверьте подключение и попробуйте снова.";
    if (c.indexOf("invalid-action-code") >= 0 || c.indexOf("expired-action-code") >= 0) return "Ссылка устарела или уже использована. Запросите новую.";
    return "Не получилось отправить письмо. Попробуйте ещё раз.";
  }

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
    var first = { register: regForm.name, login: loginForm.email, confirm: confirmForm.email }[view];
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
    // курсор возвращаем в поле только после входа — иначе окно открылось бы снова
    if (isRegistered() && lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
  }
  function busy(form, on) {
    var b = form.querySelector(".sync-btn");
    b.disabled = on; b.classList.toggle("is-loading", on);
  }
  function setError(form, name, isError, text) {
    var f = form.querySelector('[data-field="' + name + '"]');
    f.classList.toggle("is-invalid", isError);
    if (text) f.querySelector(".field__error").textContent = text;
  }

  /* ---------- отправка ссылки ---------- */
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
  function sendLink(form) {
    busy(form, true);
    linkError.hidden = true;
    return Auth.sendLink(pending.email, pending.name).then(function () {
      codeEmailEl.textContent = pending.email;
      startCooldown();
      show("code");
    }, function (err) {
      if (form === modal) { linkError.textContent = errorText(err); linkError.hidden = false; return; }
      setError(form, "email", true, errorText(err));
    }).finally(function () { if (form !== modal) busy(form, false); });
  }

  regForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var name = regForm.name.value.trim(), email = regForm.email.value.trim();
    var okN = name.length >= 2, okE = EMAIL_RE.test(email);
    setError(regForm, "name", !okN); setError(regForm, "email", !okE, "Проверьте почту — похоже, в адресе опечатка");
    if (!okN || !okE) return;
    pending = { mode: "register", name: name, email: email };
    sendLink(regForm);
  });
  loginForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = loginForm.email.value.trim(), ok = EMAIL_RE.test(email);
    setError(loginForm, "email", !ok, "Проверьте почту — похоже, в адресе опечатка");
    if (!ok) return;
    pending = { mode: "login", name: "", email: email };
    sendLink(loginForm);
  });
  resendBtn.addEventListener("click", function () {
    if (!pending || resendBtn.disabled) return;
    Auth.sendLink(pending.email, pending.name).then(function () { linkError.hidden = true; startCooldown(); },
      function (err) { linkError.textContent = errorText(err); linkError.hidden = false; });
  });

  /* ---------- вход завершён ---------- */
  function signedIn(user, fresh) {
    set(KEY, JSON.stringify(user));
    hello.textContent = user.name || "друг";
    successMsg.textContent = fresh
      ? "Вы вошли в свою книгу. Записи сохраняются в вашем аккаунте — их можно открыть на любом устройстве."
      : "Вы вошли в свою книгу. Можно продолжать писать.";
    document.dispatchEvent(new CustomEvent("sync:success", { detail: user }));
  }

  // человек пришёл по ссылке из письма
  function finish(email, form) {
    if (form) busy(form, true);
    return Auth.complete(email).then(function (user) {
      signedIn(user, true);
      if (modal.classList.contains("is-open")) show("success"); else open(null, "success");
    }, function (err) {
      if (form) { setError(form, "email", true, errorText(err)); return; }
      open(null, "login");
      setTimeout(function () { setError(loginForm, "email", true, errorText(err)); }, 300);
    }).finally(function () { if (form) busy(form, false); });
  }
  confirmForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var email = confirmForm.email.value.trim(), ok = EMAIL_RE.test(email);
    setError(confirmForm, "email", !ok, "Проверьте почту — похоже, в адресе опечатка");
    if (ok) finish(email, confirmForm);
  });

  fbReady.then(function (F) {
    if (F.fb.isSignInWithEmailLink(F.auth, location.href)) {
      var email = get(EMAIL_FOR_LINK);
      if (email) finish(email); else open(null, "confirm");
      return;
    }
    // уже вошёл раньше (Firebase помнит вход) — или вышел в другом месте
    F.fb.onAuthStateChanged(F.auth, function (u) {
      var saved = null; try { saved = JSON.parse(get(KEY) || "null"); } catch (e) {}
      if (u && (!saved || saved.uid !== u.uid)) signedIn({ name: u.displayName || "", email: u.email, uid: u.uid }, false);
      if (!u && saved) set(KEY, null);     // вход больше не действует — окно снова попросит войти
    });
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
  [regForm, loginForm, confirmForm].forEach(function (f) {
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
    if (isRegistered() || modal.classList.contains("is-open")) return;   // показываем при каждом нажатии, пока человек не вошёл
    el.blur();
    open(el);
  });

  window.SyncModal = {
    open: function (view) { open(null, view); }, close: close, Auth: Auth,
    // выйти из аккаунта: ответы в этом браузере остаются
    reset: function () {
      set(KEY, null);
      Auth.signOut();
      [regForm, loginForm, confirmForm].forEach(function (f) { f.reset(); });
      pending = null;
    }
  };
  /* кнопка в шапке: выйти из аккаунта (для проверки регистрации и входа) */
  var resetBtn = document.querySelector(".sync-reset");
  if (resetBtn) resetBtn.addEventListener("click", function () {
    window.SyncModal.reset();
    resetBtn.classList.remove("is-done"); void resetBtn.offsetWidth; resetBtn.classList.add("is-done");
    resetBtn.setAttribute("aria-label", "Вы вышли из аккаунта");
    setTimeout(function () { resetBtn.setAttribute("aria-label", "Выйти из аккаунта"); }, 1500);
  });
})();
