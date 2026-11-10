/* Сохранение книги в аккаунте человека + место, где он остановился.

   ЧТО СОХРАНЯЕТСЯ. Всё, что сайт хранит в браузере под префиксом kniga-goda:v1: —
   ответы в полях, отметки и выбор в интерактивах (колесо эмоций, ресурсный круг,
   Древо желаний…), выбранный шрифт и цвет ручки (hand, pen), спрятана ли шапка
   и место чтения (pos: страница и отступ внутри неё). Служебное — кто вошёл
   (syncUser) и список аккаунтов (accounts) — не отправляется.

   КАК. Пока человек вошёл в аккаунт (окно регистрации/входа, js/sync.js), любое
   изменение через пару секунд отправляется на сервер целым «снимком» книги.
   При входе на другом устройстве снимок с сервера подставляется в браузер, и
   страница перезагружается уже с ответами, шрифтом, цветом и местом чтения.
   Если в этом браузере изменения новее, чем на сервере, — наоборот, отправляются они.

   СЕРВЕР. Пока его нет, работает ДЕМО: «сервер» — отдельная запись в этом же браузере
   (kniga-goda:cloud:<почта>), так что вход с другого устройства в демо ничего не принесёт.
   Для настоящего сохранения замените две функции в объекте Cloud ниже на запросы
   к серверу (например, таблица workbooks в Supabase: email/user_id, data jsonb, updated_at). */
(function () {
  "use strict";
  var P = "kniga-goda:v1:";
  var USER = P + "syncUser";
  var SKIP = { syncUser: 1, accounts: 1 };            // не отправляем
  var CHANGED = "kniga-goda:localChangedAt";            // когда в этом браузере последний раз что-то менялось (вне префикса)
  var ls = window.localStorage;

  function user() { try { return JSON.parse(ls.getItem(USER) || "null"); } catch (e) { return null; } }
  function synced(key) { return key && key.indexOf(P) === 0 && !SKIP[key.slice(P.length)]; }

  /* ---------- «сервер» (заменить на настоящий) ---------- */
  var Cloud = {
    // вернуть снимок книги этого человека или null
    load: function (email) {
      // НАСТОЯЩИЙ ВАРИАНТ (Supabase):
      //   return supabase.from("workbooks").select("data").eq("email", email).maybeSingle().then(r => r.data && r.data.data);
      return new Promise(function (resolve) {
        setTimeout(function () { try { resolve(JSON.parse(ls.getItem("kniga-goda:cloud:" + email) || "null")); } catch (e) { resolve(null); } }, 300);
      });
    },
    // сохранить снимок
    save: function (email, snap) {
      // НАСТОЯЩИЙ ВАРИАНТ (Supabase):
      //   return supabase.from("workbooks").upsert({ email, data: snap, updated_at: new Date().toISOString() });
      return new Promise(function (resolve) {
        try { origSet.call(ls, "kniga-goda:cloud:" + email, JSON.stringify(snap)); } catch (e) {}
        setTimeout(resolve, 200);
      });
    }
  };

  /* ---------- снимок книги ---------- */
  function snapshot() {
    var data = {};
    for (var i = 0; i < ls.length; i++) {
      var k = ls.key(i);
      if (synced(k)) data[k.slice(P.length)] = ls.getItem(k);
    }
    return { v: 1, savedAt: Number(ls.getItem(CHANGED)) || Date.now(), data: data };
  }
  function hasAnswers(snap) {
    if (!snap || !snap.data) return false;
    return Object.keys(snap.data).some(function (k) { return k.indexOf("f:") === 0 || k.indexOf("wishes") === 0 || k.indexOf("bw:") === 0; });
  }
  var applying = false;
  function apply(snap) {
    applying = true;
    try {
      // убираем старые записи книги и ставим записи с сервера
      var old = [];
      for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (synced(k)) old.push(k); }
      old.forEach(function (k) { origRemove.call(ls, k); });
      Object.keys(snap.data).forEach(function (k) { if (!SKIP[k]) origSet.call(ls, P + k, snap.data[k]); });
      origSet.call(ls, CHANGED, String(snap.savedAt || Date.now()));
    } catch (e) {}
    applying = false;
  }

  /* ---------- отправка изменений (через 2 с после последнего) ---------- */
  var timer = 0;
  function push() {
    clearTimeout(timer);
    var u = user();
    if (!u || !u.email) return Promise.resolve();
    return Cloud.save(u.email, snapshot());
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(push, 2000); }

  // любое изменение записей книги — отметить время и запланировать отправку
  var origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (this === ls && !applying && synced(k)) { try { origSet.call(ls, CHANGED, String(Date.now())); } catch (e) {} schedule(); }
  };
  Storage.prototype.removeItem = function (k) {
    origRemove.call(this, k);
    if (this === ls && !applying && synced(k)) { try { origSet.call(ls, CHANGED, String(Date.now())); } catch (e) {} schedule(); }
  };
  // уходя со страницы — отправить сразу, не дожидаясь паузы
  addEventListener("pagehide", function () { if (timer) push(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && timer) push(); });

  /* ---------- вход: забрать книгу с сервера или отправить свою ---------- */
  document.addEventListener("sync:success", function (e) {
    var u = e.detail || user();
    if (!u || !u.email) return;
    var local = snapshot();
    Cloud.load(u.email).then(function (remote) {
      if (remote && hasAnswers(remote) && (!hasAnswers(local) || remote.savedAt > local.savedAt)) {
        apply(remote);
        location.reload();               // страница откроется с ответами, шрифтом, цветом и местом чтения с сервера
      } else {
        push();
      }
    });
  });

  /* ---------- место чтения ---------- */
  var bar = document.querySelector(".bar");
  function headerH() { return bar && !bar.classList.contains("is-hidden") ? bar.offsetHeight : 0; }
  var sheets = [].slice.call(document.querySelectorAll(".sheet[id]"));
  function currentPlace() {
    var edge = headerH() + 8;
    for (var i = 0; i < sheets.length; i++) {
      var r = sheets[i].getBoundingClientRect();
      if (r.bottom > edge) return r.top > innerHeight * .6 && i === 0 ? null : { id: sheets[i].id, off: Math.max(0, Math.round(edge - r.top)) };
    }
    return null;
  }
  function pageNo(id) { var m = /^p(\d+)$/.exec(id || ""); return m ? Number(m[1]) : null; }

  // при прокрутке — запомнить страницу (не чаще раза в полсекунды и только после того, как человек сам начал листать)
  var userScrolled = false, posT = 0;
  ["wheel", "touchmove", "keydown"].forEach(function (ev) { addEventListener(ev, function () { userScrolled = true; }, { passive: true }); });
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".chip, .bar-tab")) userScrolled = true; }, true);
  addEventListener("scroll", function () {
    if (!userScrolled) return;
    clearTimeout(posT);
    posT = setTimeout(function () {
      var place = currentPlace();
      var val = JSON.stringify(place ? { id: place.id, off: place.off } : { id: "top", off: 0 });
      if (ls.getItem(P + "pos") !== val) ls.setItem(P + "pos", val);
    }, 500);
  }, { passive: true });

  // при открытии — предложить вернуться туда, где остановились
  var saved = null;
  try { saved = JSON.parse(ls.getItem(P + "pos") || "null"); } catch (e) {}
  var target = saved && saved.id && saved.id !== "top" && document.getElementById(saved.id);
  if (target && !location.hash) {
    var n = pageNo(saved.id);
    var pill = document.createElement("div");
    pill.className = "resume";
    pill.setAttribute("role", "status");
    pill.innerHTML = '<span class="resume__txt">Вы остановились ' + (n !== null ? "на <b>" + n + "-й странице</b>" : "в середине книги") + '</span>' +
      '<button class="resume__go" type="button">Продолжить</button>' +
      '<button class="resume__x" type="button" aria-label="Закрыть"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
    document.body.appendChild(pill);
    requestAnimationFrame(function () { pill.classList.add("is-in"); });
    var hide = function () { pill.classList.remove("is-in"); setTimeout(function () { pill.remove(); }, 350); removeEventListener("scroll", onScroll); };
    var startY = scrollY;
    var onScroll = function () { if (userScrolled && Math.abs(scrollY - startY) > innerHeight) hide(); };   // сам ушёл далеко — подсказка не нужна
    addEventListener("scroll", onScroll, { passive: true });
    pill.querySelector(".resume__go").addEventListener("click", function () {
      userScrolled = true;
      var y = target.getBoundingClientRect().top + scrollY - headerH() - 8 + (saved.off || 0);
      scrollTo({ top: Math.max(0, y), behavior: "instant" });
      hide();
    });
    pill.querySelector(".resume__x").addEventListener("click", hide);
  }

  window.BookCloud = { push: push, snapshot: snapshot, Cloud: Cloud };
})();
