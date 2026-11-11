/* Сохранение книги в аккаунте человека (Firebase Firestore) + место, где он остановился.

   ЧТО СОХРАНЯЕТСЯ. Всё, что сайт хранит в браузере под префиксом kniga-goda:v1: —
   ответы в полях, отметки и выбор в интерактивах (колесо эмоций, ресурсный круг,
   Древо желаний…), выбранный шрифт и цвет ручки (hand, pen), спрятана ли шапка
   и место чтения (pos: страница и отступ внутри неё). Служебное — кто вошёл
   (syncUser) и список аккаунтов (accounts) — не отправляется.

   ГДЕ. Firestore, у каждого человека своё место (uid из Firebase Authentication):
     books/{uid}           — имя, почта, когда последний раз менялось (savedAt)
     books/{uid}/keys/{id} — по документу на каждую запись: { k: ключ, v: значение, t: когда изменено }
                             (удалённая запись хранится как v: null — чтобы не «воскресла» с другого устройства)

   КАК СИНХРОНИЗИРУЕТСЯ. Каждая запись сравнивается отдельно, по времени изменения:
     • правка в этом браузере → через 2 с уходит в аккаунт (и сразу, когда вкладку закрывают);
     • при открытии сайта, при входе и при возврате на вкладку — сверка с аккаунтом:
       что новее в аккаунте — подставляется сюда, что новее здесь — отправляется туда.
   Если с другого устройства пришли ответы, страница перезагружается и показывает их
   (не прямо во время письма — после того, как курсор уйдёт из поля). */
(function () {
  "use strict";
  var P = "kniga-goda:v1:";
  var USER = P + "syncUser";
  var SKIP = { syncUser: 1, accounts: 1 };            // не отправляем
  var CHANGED = "kniga-goda:localChangedAt";            // когда в этом браузере последний раз что-то менялось (вне префикса)
  var TIMES = "kniga-goda:keyTimes";                    // когда менялась каждая запись: { ключ: время } (вне префикса)
  var BIG = 100000;                                     // записи больше ~100 КБ (желания с картинками) — отдельными пачками
  var MAX = 950000;                                     // в документ Firestore влезает до 1 МБ
  var ls = window.localStorage;
  var origSet = Storage.prototype.setItem, origRemove = Storage.prototype.removeItem;

  function user() { try { return JSON.parse(ls.getItem(USER) || "null"); } catch (e) { return null; } }
  function synced(key) { return key && key.indexOf(P) === 0 && !SKIP[key.slice(P.length)]; }
  function docId(k) { return encodeURIComponent(k).replace(/\./g, "%2E"); }   // в id документа нельзя «/» и «.»
  function warn(msg, err) { if (window.console) console.warn(msg, err && (err.code || err.message || err)); }
  function times() { try { return JSON.parse(ls.getItem(TIMES) || "{}") || {}; } catch (e) { return {}; } }
  function saveTimes(t) { try { origSet.call(ls, TIMES, JSON.stringify(t)); } catch (e) {} }

  /* ---------- Firestore ---------- */
  function fb() { var F = window.Firebase; return F && F.auth && F.auth.currentUser ? F : null; }
  function uid() { var F = fb(); return F ? F.auth.currentUser.uid : null; }
  var Cloud = {
    // вся книга человека: { savedAt, items: [{ k, v, t }] }
    load: function (id) {
      var F = fb(); if (!F) return Promise.reject(new Error("not-signed-in"));
      var x = F.fb;
      return Promise.all([
        x.getDoc(x.doc(F.db, "books", id)),
        x.getDocs(x.collection(F.db, "books", id, "keys"))
      ]).then(function (r) {
        var items = [];
        r[1].forEach(function (d) { var v = d.data(); if (v && v.k != null) items.push({ k: v.k, v: v.v == null ? null : v.v, t: v.t || 0 }); });
        return { savedAt: (r[0].exists() && r[0].data().savedAt) || 0, items: items };
      });
    },
    // записать изменения: { ключ: { v: значение | null, t: время } }. Большие записи — каждая своей пачкой,
    // чтобы одна неудачная (например, слишком большая картинка) не мешала сохранить остальное.
    save: function (id, changes, meta) {
      var F = fb(); if (!F) return Promise.reject(new Error("not-signed-in"));
      var x = F.fb, small = [], big = [];
      Object.keys(changes).forEach(function (k) {
        var len = (changes[k].v || "").length;
        if (len > MAX) { warn("Запись слишком большая для аккаунта и не сохранится: " + k + " (" + Math.round(len / 1024) + " КБ)"); return; }
        (len > BIG ? big : small).push(k);
      });
      var put = function (batch, k) { batch.set(x.doc(F.db, "books", id, "keys", docId(k)), { k: k, v: changes[k].v, t: changes[k].t }); };
      var jobs = [], failed = [];
      for (var i = 0; i < small.length || i === 0; i += 400) {             // в одной пачке Firestore — до 500 действий
        var b = x.writeBatch(F.db), part = small.slice(i, i + 400);
        part.forEach(function (k) { put(b, k); });
        if (i === 0 && meta) b.set(x.doc(F.db, "books", id), meta, { merge: true });
        jobs.push(b.commit().catch(function (er) { failed = failed.concat(part); warn("Книга не сохранилась в аккаунте:", er); }));
      }
      big.forEach(function (k) {
        var b = x.writeBatch(F.db); put(b, k);
        jobs.push(b.commit().catch(function (er) { failed.push(k); warn("Не сохранилась запись " + k + ":", er); }));
      });
      return Promise.all(jobs).then(function () { return failed; });
    }
  };

  /* ---------- записи книги в этом браузере ---------- */
  function localData() {
    var data = {};
    for (var i = 0; i < ls.length; i++) { var k = ls.key(i); if (synced(k)) data[k.slice(P.length)] = ls.getItem(k); }
    return data;
  }
  var applying = false;
  function applyKey(k, v) {
    applying = true;
    try { if (v == null) origRemove.call(ls, P + k); else origSet.call(ls, P + k, v); } catch (e) {}
    applying = false;
  }

  /* ---------- отправка изменений (через 2 с после последней правки) ---------- */
  var dirty = {}, timer = 0;
  function push() {
    clearTimeout(timer); timer = 0;
    var id = uid(), u = user() || {};
    if (!id) return Promise.resolve();
    var keys = Object.keys(dirty);
    if (!keys.length) return Promise.resolve();
    var data = localData(), t = times(), changes = {};
    keys.forEach(function (k) { changes[k] = { v: data.hasOwnProperty(k) ? data[k] : null, t: t[k] || Date.now() }; });
    dirty = {};
    var F = fb();
    var meta = { email: u.email || F.auth.currentUser.email || "", name: u.name || F.auth.currentUser.displayName || "", savedAt: Number(ls.getItem(CHANGED)) || Date.now() };
    // только место чтения (листание) — отметку не трогаем, чтобы другие устройства не перечитывали книгу на каждую прокрутку
    if (keys.every(function (k) { return k === "pos"; })) meta = null;
    else known = meta.savedAt;                                // свою же запись в «живом» наблюдении не считаем чужой
    return Cloud.save(id, changes, meta).then(function (failed) {
      failed.forEach(function (k) { dirty[k] = 1; });                 // не получилось — попробуем со следующей правкой
    }, function (err) {
      keys.forEach(function (k) { dirty[k] = 1; });
      warn("Книга не сохранилась в аккаунте:", err);
    });
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(push, 2000); }

  // любое изменение записей книги — отметить время и запланировать отправку
  function touched(k) {
    var now = Date.now(), key = k.slice(P.length), t = times();
    t[key] = now; saveTimes(t);
    try { origSet.call(ls, CHANGED, String(now)); } catch (e) {}
    dirty[key] = 1;
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

  /* ---------- сверка с аккаунтом ---------- */
  var syncing = false, again = false, lastSync = 0, reloadPending = false, known = null;
  function typing() {
    var a = document.activeElement;
    return !!(a && (a.isContentEditable || /^(INPUT|TEXTAREA)$/.test(a.tagName)));
  }
  function reloadSoon() {
    var go = function () { try { sessionStorage.setItem("kg-autoreload", "1"); } catch (e) {} location.reload(); };
    if (!typing()) { go(); return; }
    if (reloadPending) return;
    reloadPending = true;                                     // человек пишет — обновим, когда курсор уйдёт из поля
    document.addEventListener("focusout", function wait() {
      setTimeout(function () {
        if (typing()) return;
        document.removeEventListener("focusout", wait);
        push().then(go);
      }, 300);
    });
  }
  function syncNow() {
    var id = uid();
    if (!id) return Promise.resolve();
    if (syncing) { again = true; return Promise.resolve(); }
    syncing = true; lastSync = Date.now();
    return Cloud.load(id).then(function (remote) {
      var local = localData(), t = times(), seen = {}, shown = false;
      known = remote.savedAt;
      var localNewer = (Number(ls.getItem(CHANGED)) || 0) > (remote.savedAt || 0);
      remote.items.forEach(function (r) {
        seen[r.k] = 1;
        if (SKIP[r.k]) return;
        var lt = t[r.k] || 0, has = local.hasOwnProperty(r.k), same = has ? local[r.k] === r.v : r.v == null;
        if (same) { if (r.t > lt) t[r.k] = r.t; return; }
        // что новее — то и остаётся; если время неизвестно (старые записи) — берём из аккаунта то, чего здесь нет
        var takeRemote = r.t > lt || (r.t === lt && (!has || !localNewer));
        if (takeRemote) {
          applyKey(r.k, r.v); t[r.k] = r.t;
          if (r.k !== "pos") shown = true;                    // место чтения подставляем молча, без перезагрузки
        } else {
          dirty[r.k] = 1;
        }
      });
      Object.keys(local).forEach(function (k) { if (!seen[k]) dirty[k] = 1; });   // есть только здесь — отправить
      saveTimes(t);
      if (shown) try { origSet.call(ls, CHANGED, String(Math.max(Number(ls.getItem(CHANGED)) || 0, remote.savedAt || 0))); } catch (e) {}
      return push().then(function () { if (shown) reloadSoon(); });
    }).catch(function (err) { warn("Не удалось сверить книгу с аккаунтом:", err); })
      .then(function () { syncing = false; if (again) { again = false; syncNow(); } });
  }

  // когда: при входе (js/sync.js), при открытии сайта уже вошедшим человеком и при возврате на вкладку
  document.addEventListener("sync:success", function () { setTimeout(syncNow, 300); });
  (function waitAuth() {
    var stop = null;
    var go = function (F) {
      F.fb.onAuthStateChanged(F.auth, function (u) {
        if (stop) { stop(); stop = null; }
        if (!u) return;
        syncNow();
        // «живое» наблюдение: другое устройство что-то сохранило (изменилась отметка savedAt) — сверяемся.
        // Читается один маленький документ; вся книга загружается, только когда правда что-то изменилось.
        stop = F.fb.onSnapshot(F.fb.doc(F.db, "books", u.uid), function (s) {
          if (!s.exists() || s.metadata.hasPendingWrites) return;
          var at = s.data().savedAt || 0;
          if (known !== null && at !== known) syncNow();
        }, function (err) { warn("Не удалось следить за изменениями в аккаунте:", err); });
      });
    };
    if (window.Firebase) go(window.Firebase); else document.addEventListener("firebase:ready", function (e) { go(e.detail); }, { once: true });
  })();
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") { if (timer) push(); return; }
    if (Date.now() - lastSync > 15000) syncNow();
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
  var auto = false;
  try { auto = sessionStorage.getItem("kg-autoreload") === "1"; sessionStorage.removeItem("kg-autoreload"); } catch (e) {}
  if (target && !location.hash && !auto) {   // после автообновления (пришли ответы с другого устройства) не предлагаем
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

  window.BookCloud = { push: push, sync: syncNow, Cloud: Cloud };
})();
