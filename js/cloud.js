/* Сохранение книги в аккаунте человека (Firebase Firestore) + место, где он остановился.

   ЧТО СОХРАНЯЕТСЯ. Всё, что сайт хранит в браузере под префиксом kniga-goda:v1: —
   ответы в полях, отметки и выбор в интерактивах (колесо эмоций, ресурсный круг,
   Древо желаний…), выбранный шрифт и цвет ручки (hand, pen), спрятана ли шапка
   и место чтения (pos: страница и отступ внутри неё). Служебное — кто вошёл
   (syncUser) и список аккаунтов (accounts) — не отправляется.

   ГДЕ. Firestore, у каждого человека своё место (uid из Firebase Authentication):
     books/{uid}           — имя, почта, когда последний раз менялось (savedAt)
     books/{uid}/keys/{id} — по документу на каждую запись: { k: ключ, v: значение }
   Отправляются только изменившиеся записи, через 2 с после последней правки
   (и сразу, когда человек закрывает вкладку). Правила доступа в консоли Firebase
   пускают каждого только к своему books/{uid}.

   ВХОД НА ДРУГОМ УСТРОЙСТВЕ. После входа (js/sync.js, событие sync:success) книга из
   Firestore подставляется в браузер, и страница перезагружается уже с ответами,
   шрифтом, цветом и местом чтения. Если в этом браузере записи новее — наоборот,
   отправляются они. */
(function () {
  "use strict";
  var P = "kniga-goda:v1:";
  var USER = P + "syncUser";
  var SKIP = { syncUser: 1, accounts: 1 };            // не отправляем
  var CHANGED = "kniga-goda:localChangedAt";            // когда в этом браузере последний раз что-то менялось (вне префикса)
  var ls = window.localStorage;
  var origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem;

  function user() { try { return JSON.parse(ls.getItem(USER) || "null"); } catch (e) { return null; } }
  function synced(key) { return key && key.indexOf(P) === 0 && !SKIP[key.slice(P.length)]; }
  function docId(k) { return encodeURIComponent(k).replace(/\./g, "%2E"); }   // в id документа нельзя «/» и «.»

  /* ---------- Firestore ---------- */
  function fb() { var F = window.Firebase; return F && F.auth && F.auth.currentUser ? F : null; }
  var Cloud = {
    // вся книга человека: { savedAt, data: { ключ: значение } } или null
    load: function (uid) {
      var F = fb(); if (!F) return Promise.resolve(null);
      var x = F.fb;
      return Promise.all([
        x.getDoc(x.doc(F.db, "books", uid)),
        x.getDocs(x.collection(F.db, "books", uid, "keys"))
      ]).then(function (r) {
        if (!r[0].exists() && r[1].empty) return null;
        var data = {};
        r[1].forEach(function (d) { var v = d.data(); if (v && v.k != null) data[v.k] = v.v; });
        return { savedAt: (r[0].exists() && r[0].data().savedAt) || 0, data: data };
      });
    },
    // записать изменения: { ключ: значение | null (удалить) }
    save: function (uid, changes, meta) {
      var F = fb(); if (!F) return Promise.reject(new Error("not-signed-in"));
      var x = F.fb, keys = Object.keys(changes), jobs = [];
      for (var i = 0; i < keys.length || i === 0; i += 400) {             // в одной пачке Firestore — до 500 действий
        var batch = x.writeBatch(F.db);
        keys.slice(i, i + 400).forEach(function (k) {
          var ref = x.doc(F.db, "books", uid, "keys", docId(k));
          if (changes[k] == null) batch.delete(ref); else batch.set(ref, { k: k, v: changes[k] });
        });
        if (i === 0) batch.set(x.doc(F.db, "books", uid), meta, { merge: true });
        jobs.push(batch.commit());
      }
      return Promise.all(jobs);
    }
  };

  /* ---------- записи книги в этом браузере ---------- */
  function localData() {
    var data = {};
    for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (synced(k)) data[k.slice(P.length)] = ls.getItem(k); }
    return data;
  }
  function hasAnswers(data) {
    return !!data && Object.keys(data).some(function (k) { return k.indexOf("f:") === 0 || k.indexOf("wishes") === 0 || k.indexOf("bw:") === 0 || k.indexOf("rc-notes") === 0; });
  }
  var applying = false;
  function apply(remote) {
    applying = true;
    try {
      var old = [];
      for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (synced(k)) old.push(k); }
      old.forEach(function (k) { origRemove.call(ls, k); });
      Object.keys(remote.data).forEach(function (k) { if (!SKIP[k]) origSet.call(ls, P + k, remote.data[k]); });
      origSet.call(ls, CHANGED, String(remote.savedAt || Date.now()));
    } catch (e) {}
    applying = false;
  }

  /* ---------- отправка изменений (через 2 с после последней правки) ---------- */
  var dirty = {}, timer = 0;
  function push(all) {
    clearTimeout(timer); timer = 0;
    var u = user();
    if (!u || !u.uid || !fb()) return Promise.resolve();
    var data = localData(), changes = {};
    var keys = all ? Object.keys(data) : Object.keys(dirty);
    keys.forEach(function (k) { changes[k] = data.hasOwnProperty(k) ? data[k] : null; });
    if (!keys.length && !all) return Promise.resolve();
    var sent = dirty; dirty = {};
    var meta = { email: u.email || "", name: u.name || "", savedAt: Number(ls.getItem(CHANGED)) || Date.now() };
    return Cloud.save(u.uid, changes, meta).catch(function (err) {
      Object.keys(sent).forEach(function (k) { dirty[k] = 1; });      // не получилось — попробуем со следующей правкой
      if (window.console) console.warn("Книга не сохранилась в аккаунте:", err && (err.code || err.message));
    });
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(push, 2000); }

  // любое изменение записей книги — отметить, что изменилось, и запланировать отправку
  function touched(k) {
    try { origSet.call(ls, CHANGED, String(Date.now())); } catch (e) {}
    dirty[k.slice(P.length)] = 1;
    schedule();
  }
  Storage.prototype.setItem = function (k, v) {
    origSet.call(this, k, v);
    if (this === ls && !applying && synced(k)) touched(k);
  };
  Storage.prototype.removeItem = function (k) {
    origRemove.call(this, k);
    if (this === ls && !applying && synced(k)) touched(k);
  };
  // уходя со страницы — отправить сразу, не дожидаясь паузы
  addEventListener("pagehide", function () { if (timer) push(); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && timer) push(); });

  /* ---------- вход: забрать книгу из аккаунта или отправить свою ---------- */
  document.addEventListener("sync:success", function (e) {
    var u = e.detail || user();
    if (!u || !u.uid) return;
    var local = { savedAt: Number(ls.getItem(CHANGED)) || 0, data: localData() };
    Cloud.load(u.uid).then(function (remote) {
      if (remote && hasAnswers(remote.data) && (!hasAnswers(local.data) || remote.savedAt > local.savedAt)) {
        apply(remote);
        location.reload();               // страница откроется с ответами, шрифтом, цветом и местом чтения из аккаунта
      } else {
        push(true);
      }
    }).catch(function (err) { if (window.console) console.warn("Не удалось загрузить книгу из аккаунта:", err && (err.code || err.message)); });
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

  window.BookCloud = { push: push, Cloud: Cloud };
})();
