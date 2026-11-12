/* Книга года — только поведение вёрстки:
   1) поля ответа (редактируемые блоки с пунктирными строками);
   2) подсветка текущего этапа в верхней панели и плавный переход к нему;
   3) видео на обложке.
   Сохранения ответов пока нет. */
(function () {
  "use strict";

  /* Хранилище ответов в браузере (localStorage). Всё остаётся только на этом устройстве
     и в этом браузере. Если хранилище недоступно (приватный режим и т. п.) — сайт просто
     работает без сохранения. */
  var LS = (function () {
    var P = "kniga-goda:v1:";
    return {
      get: function (k) { try { var v = localStorage.getItem(P + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
    };
  })();

  /* 0. Подпись дневника на обложке: синяя плашка по ширине написанного + класс .has-value
     (по нему CSS гасит подпись и линию, когда поле заполнено и курсор ушёл). */
  document.querySelectorAll(".cover-fields input").forEach(function (inp) {
    var lab = inp.closest("label");
    var m = document.createElement("i");
    m.className = "cover-measure";
    m.setAttribute("aria-hidden", "true");
    lab.appendChild(m);
    function fit() {
      var v = inp.value;
      lab.classList.toggle("has-value", v.trim() !== "");
      if (!v) { inp.style.width = ""; return; }
      m.textContent = v;
      var pad = parseFloat(getComputedStyle(inp).paddingLeft) * 2;
      inp.style.width = Math.min(lab.clientWidth, Math.ceil(m.getBoundingClientRect().width + pad + 8)) + "px";
    }
    inp.addEventListener("input", fit);
    window.addEventListener("resize", fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    fit();
  });

  /* 0б. Фон за листами: под каждым листом — оттенок цвета его этапа, между этапами —
     плавный градиент (точки цвета стоят в центрах листов, поэтому переход растягивается
     на последний лист прошлого этапа и первый лист нового). Пересчёт при изменении размеров. */
  var pagesBg = document.querySelector(".pages-bg");
  var mainEl = document.querySelector("main.wrap");
  function paintBg() {
    if (!pagesBg || !mainEl) return;
    var sheets = mainEl.querySelectorAll(".sheet");
    var top0 = pagesBg.offsetTop, h = pagesBg.offsetHeight;
    if (!sheets.length || h <= 0) return;
    var stops = [];
    var prev = null;
    sheets.forEach(function (s) {
      var cs = getComputedStyle(s);
      var c = cs.getPropertyValue("--bg-c").trim() || cs.getPropertyValue("--c").trim() || "#2e8560";   // --bg-c — особый цвет для фона, если задан
      var pos = Math.max(0, (s.offsetTop + s.offsetHeight / 2 - top0) / h * 100).toFixed(2);
      var tint = "color-mix(in oklab, " + c + " var(--tint-k), var(--ground))";
      if (prev === null) stops.push(tint + " 0%");
      if (prev !== null && prev.c !== c) {        // смена этапа: точка старого цвета в центре прошлого листа
        stops.push(prev.tint + " " + prev.pos + "%");
        stops.push(tint + " " + pos + "%");
      }
      prev = { c: c, tint: tint, pos: pos };
    });
    stops.push(prev.tint + " 100%");
    pagesBg.style.background = "linear-gradient(180deg, " + stops.join(", ") + ")";
  }
  paintBg();
  if (window.ResizeObserver && mainEl) new ResizeObserver(paintBg).observe(mainEl);
  else window.addEventListener("resize", paintBg);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(paintBg);

  /* 0в. Колесо Эмоций: квадратик — цвет эмоции, % — её доля; круг делится на цветные доли
     по порядку эмоций, нераспределённое остаётся белым. */
  var wheel = document.querySelector(".wheel");
  if (wheel) {
    var emos = [].slice.call(document.querySelectorAll(".emo"));
    var sumEl = document.querySelector(".wheel-sum");
    var paintWheel = function () {
      var at = 0, parts = [];
      emos.forEach(function (e) {
        var col = e.querySelector("input[type=color]").value;
        var p = Math.max(0, Math.min(100, parseFloat(e.querySelector(".emo-pct").value) || 0));
        if (!p || at >= 100) return;
        var to = Math.min(100, at + p);
        parts.push({ col: col, from: at, to: to });
        at = to;
      });
      var total = emos.reduce(function (s, e) { return s + (parseFloat(e.querySelector(".emo-pct").value) || 0); }, 0);
      if (at < 100) parts.push({ col: "#ffffff", from: at, to: 100 });
      // мягкие границы: каждый цвет держится сплошным в середине своей доли, а у краёв
      // плавно перетекает в соседний (зона перехода — до 0,2% круга: только сглаживает край, без размытия)
      var stops = [];
      parts.forEach(function (s, i) {
        var soft = Math.min(.2, (s.to - s.from) / 3);
        var a = i === 0 ? s.from : s.from + soft;
        var b = i === parts.length - 1 ? s.to : s.to - soft;
        stops.push(s.col + " " + a.toFixed(2) + "% " + b.toFixed(2) + "%");
      });
      // замыкаем круг: последний цвет мягко перетекает в первый через «0»
      if (parts.length > 1) {
        var f = parts[0], l = parts[parts.length - 1];
        var sf = Math.min(.2, (f.to - f.from) / 3), sl = Math.min(.2, (l.to - l.from) / 3);
        stops[0] = f.col + " " + sf.toFixed(2) + "% " + (f.to - sf).toFixed(2) + "%";
        stops[stops.length - 1] = l.col + " " + (l.from + sl).toFixed(2) + "% " + (100 - sl).toFixed(2) + "%";
        stops.unshift("color-mix(in oklab, " + l.col + ", " + f.col + ") 0%");
        stops.push("color-mix(in oklab, " + l.col + ", " + f.col + ") 100%");
      }
      wheel.style.background = parts.length > 1 || at > 0 ? "conic-gradient(" + stops.join(", ") + ")" : "";
      if (sumEl) {
        sumEl.textContent = total ? "Распределено " + Math.round(total) + "% из 100%" : "";
        sumEl.classList.toggle("over", total > 100);
      }
    };
    emos.forEach(function (e) {
      e.querySelectorAll("input").forEach(function (i) { i.addEventListener("input", paintWheel); });
    });
    paintWheel();
  }

  /* 0г. Колесо баланса: нажатие в секторе ставит оценку по кольцу (0–10), отметки
     в серединах секторов соединяются в фигуру. Клавиатура: Tab по секторам, стрелки ↑↓ (или ←→). */
  document.querySelectorAll("svg.bw").forEach(function (svg) {
    var cx = +svg.dataset.cx, cy = +svg.dataset.cy, R = +svg.dataset.r;
    var bwKey = "bw:" + ((svg.closest(".sheet") || {}).id || "0");
    var savedBw = LS.get(bwKey);
    var vals = Array.isArray(savedBw) && savedBw.length === 8 ? savedBw : [0, 0, 0, 0, 0, 0, 0, 0];
    var shape = svg.querySelector(".bw-shape");
    var dots = svg.querySelector(".bw-dots");
    var sectors = [].slice.call(svg.querySelectorAll(".bw-sector"));
    var NS = "http://www.w3.org/2000/svg";
    function pt(i, v) {
      var a = (i * 45 + 22.5) * Math.PI / 180, r = R * v / 10;
      return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
    }
    function draw() {
      var set = [];
      dots.textContent = "";
      vals.forEach(function (v, i) {
        sectors[i].setAttribute("aria-valuenow", v);
        if (!v) return;
        var p = pt(i, v);
        set.push(p[0].toFixed(2) + "," + p[1].toFixed(2));
        var c = document.createElementNS(NS, "circle");
        c.setAttribute("cx", p[0]); c.setAttribute("cy", p[1]); c.setAttribute("r", 2.6);
        dots.appendChild(c);
      });
      shape.setAttribute("points", set.length >= 2 ? set.join(" ") : "");
    }
    function setVal(i, v) { vals[i] = Math.max(0, Math.min(10, v)); draw(); LS.set(bwKey, vals); }
    svg.addEventListener("click", function (e) {
      var m = svg.getScreenCTM(); if (!m) return;
      var p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
      p = p.matrixTransform(m.inverse());
      var dx = p.x - cx, dy = cy - p.y, dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > R * 1.08) return;
      var ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      var i = Math.floor(ang / 45) % 8;
      var v = Math.max(1, Math.min(10, Math.ceil(dist / R * 10)));
      setVal(i, vals[i] === v ? 0 : v);       // повторное нажатие на ту же отметку снимает её
    });
    sectors.forEach(function (s, i) {
      s.addEventListener("keydown", function (e) {
        if (e.key === "ArrowUp" || e.key === "ArrowRight") { setVal(i, vals[i] + 1); e.preventDefault(); }
        else if (e.key === "ArrowDown" || e.key === "ArrowLeft") { setVal(i, vals[i] - 1); e.preventDefault(); }
        else if (e.key === "Home") { setVal(i, 0); e.preventDefault(); }
        else if (e.key === "End") { setVal(i, 10); e.preventDefault(); }
      });
    });
    draw();
  });

  /* 0д. Свой аудиоплеер (медитация): кнопка Play/Пауза, перемотка, время. */
  document.querySelectorAll(".aplayer").forEach(function (pl) {
    var au = pl.querySelector("audio"), btn = pl.querySelector(".ap-play");
    var seek = pl.querySelector(".ap-seek"), time = pl.querySelector(".ap-time");
    var fmt = function (s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); };
    var upd = function () {
      var d = au.duration || 0, p = d ? au.currentTime / d : 0;
      if (!seek.matches(":active")) seek.value = Math.round(p * 1000);
      seek.style.setProperty("--p", (p * 100).toFixed(2) + "%");
      time.textContent = fmt(au.currentTime) + " / " + (d ? fmt(d) : "12:01");
    };
    btn.addEventListener("click", function () {
      if (au.paused) { au.play(); } else { au.pause(); }
    });
    au.addEventListener("play", function () { pl.classList.add("is-playing"); btn.setAttribute("aria-label", "Пауза"); });
    au.addEventListener("pause", function () { pl.classList.remove("is-playing"); btn.setAttribute("aria-label", "Слушать медитацию"); });
    au.addEventListener("timeupdate", upd);
    au.addEventListener("loadedmetadata", upd);
    au.addEventListener("ended", function () { au.currentTime = 0; upd(); });
    seek.addEventListener("input", function () {
      if (au.duration) au.currentTime = seek.value / 1000 * au.duration;
      upd();
    });
  });

  /* 0е. Древо желаний: круги 1–10 — кнопки. Окно: текст желания + картинка (с устройства).
     Картинку можно приблизить (ползунок 1–3×) и сдвинуть перетаскиванием в круглом предпросмотре;
     масштаб и сдвиг применяются к кругу на Древе. Всё сохраняется в браузере. */
  var dlg = document.querySelector(".wish-dlg");
  if (dlg && dlg.showModal) {
    var wishKey = "wishes:" + ((dlg.closest(".sheet") || {}).id || "0");
    var wishes = LS.get(wishKey) || {};
    var saveWishes = function () { LS.set(wishKey, wishes); };
    var cur = null;
    var W = function (btn) { return wishes[btn.dataset.n] || (wishes[btn.dataset.n] = {}); };
    // картинку уменьшаем до 480px по длинной стороне (JPEG) — чтобы все 10 желаний поместились в браузере и в аккаунте (Firestore: до 1 МБ на запись)
    var shrink = function (dataUrl, done) {
      var im = new Image();
      im.onload = function () {
        var k = Math.min(1, 480 / Math.max(im.width, im.height));
        var c = document.createElement("canvas");
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        try { done(c.toDataURL("image/jpeg", 0.82)); } catch (e) { done(dataUrl); }
      };
      im.onerror = function () { done(dataUrl); };
      im.src = dataUrl;
    };
    var inp = dlg.querySelector(".wish-input"), file = dlg.querySelector("input[type=file]");
    var prev = dlg.querySelector(".wish-preview"), prevImg = prev.querySelector("img");
    var zoom = dlg.querySelector(".wish-zoom input"), zoomBox = dlg.querySelector(".wish-zoom");
    var nEl = dlg.querySelector(".wish-dlg-n");
    // применить картинку, масштаб и сдвиг к элементу-кругу (box) с <img> внутри
    var apply = function (box, img, w) {
      if (w.pic) img.src = w.pic; else img.removeAttribute("src");
      box.style.setProperty("--z", w.z || 1);
      box.style.setProperty("--px", (w.px || 0) + "%");
      box.style.setProperty("--py", (w.py || 0) + "%");
    };
    // текст без картинки не влезает в круг одной строкой — круг увеличивается (класс is-long, css/style.css)
    var markLong = function (btn) {
      btn.classList.remove("is-long");
      if (!btn.classList.contains("has-text") || btn.classList.contains("has-pic")) return;
      var t = btn.querySelector(".wish-txt");
      t.style.whiteSpace = "nowrap";
      var long = t.scrollWidth > t.clientWidth + 1;
      t.style.whiteSpace = "";
      btn.classList.toggle("is-long", long);
    };
    window.addEventListener("resize", function () { document.querySelectorAll(".wish").forEach(markLong); });
    var paint = function (btn) {
      var w = wishes[btn.dataset.n] || {};
      var box = btn.querySelector(".wish-pic");
      var img = box.querySelector("img") || box.appendChild(document.createElement("img"));
      img.alt = ""; img.draggable = false;
      apply(box, img, w);
      btn.querySelector(".wish-txt").textContent = w.text || "";
      btn.classList.toggle("has-pic", !!w.pic);
      btn.classList.toggle("has-text", !!(w.text && w.text.trim()));
      markLong(btn);
      btn.setAttribute("aria-label", "Желание " + btn.dataset.n + (w.text ? ": " + w.text : ": вписать желание и добавить картинку"));
    };
    var showPrev = function () {
      var w = cur ? (wishes[cur.dataset.n] || {}) : {};
      apply(prev, prevImg, w);
      prev.classList.toggle("has-img", !!w.pic);
      zoom.value = w.z || 1;
      zoomBox.classList.toggle("is-off", !w.pic);
    };
    document.querySelectorAll(".wish").forEach(function (btn) {
      btn.addEventListener("click", function () {
        cur = btn;
        nEl.textContent = btn.dataset.n;
        inp.value = (wishes[btn.dataset.n] || {}).text || "";
        file.value = "";
        showPrev();
        dlg.showModal();
        inp.focus();
      });
    });
    file.addEventListener("change", function () {
      var f = file.files && file.files[0];
      if (!f || !cur) return;
      var target = cur;
      var r = new FileReader();
      r.onload = function () {
        shrink(r.result, function (small) {
          var w = W(target);
          w.pic = small; w.z = 1; w.px = 0; w.py = 0;     // новая картинка — без приближения и сдвига
          if (cur === target) showPrev();
          paint(target);
          saveWishes();
        });
      };
      r.readAsDataURL(f);
    });
    dlg.querySelector(".wish-clear").addEventListener("click", function () {
      if (!cur) return;
      var w = W(cur);
      w.pic = ""; w.z = 1; w.px = 0; w.py = 0; file.value = "";
      showPrev(); paint(cur); saveWishes();
    });
    // масштаб
    zoom.addEventListener("input", function () {
      if (!cur) return;
      var w = W(cur);
      w.z = +zoom.value;
      showPrev(); paint(cur);
    });
    zoom.addEventListener("change", saveWishes);
    // сдвиг перетаскиванием (мышь и палец); сдвиг в % от размера круга, с учётом масштаба
    var drag = null;
    prev.addEventListener("pointerdown", function (e) {
      if (!cur || !(wishes[cur.dataset.n] || {}).pic) return;
      var w = W(cur);
      drag = { x: e.clientX, y: e.clientY, px: w.px || 0, py: w.py || 0, size: prev.clientWidth };
      prev.setPointerCapture(e.pointerId);
      prev.classList.add("dragging");
      e.preventDefault();
    });
    prev.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var w = W(cur), lim = 50 * (w.z || 1);           // не даём увести картинку целиком из круга
      w.px = Math.max(-lim, Math.min(lim, drag.px + (e.clientX - drag.x) / drag.size * 100));
      w.py = Math.max(-lim, Math.min(lim, drag.py + (e.clientY - drag.y) / drag.size * 100));
      showPrev(); paint(cur);
    });
    var endDrag = function () { if (!drag) return; drag = null; prev.classList.remove("dragging"); saveWishes(); };
    prev.addEventListener("pointerup", endDrag);
    prev.addEventListener("pointercancel", endDrag);
    dlg.addEventListener("close", function () {
      if (!cur) return;
      W(cur).text = inp.value;
      paint(cur);
      saveWishes();
      cur.focus();
    });
    document.querySelectorAll(".wish").forEach(paint);   // восстановить сохранённые желания
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });   // нажатие мимо окна — закрыть
  }
  /* 0ж. Закладка под панелью разделов: прячет панель и вытягивает обратно.
     Положение запоминается в браузере. */
  var barTab = document.querySelector(".bar-tab");
  if (barTab) {
    var barBox = barTab.closest(".bar");
    var setHidden = function (hidden) {
      barBox.classList.toggle("is-hidden", hidden);
      barTab.setAttribute("aria-expanded", hidden ? "false" : "true");
      barTab.setAttribute("aria-label", hidden ? "Показать панель разделов" : "Скрыть панель разделов");
      barBox.querySelectorAll(".chip").forEach(function (c) { c.tabIndex = hidden ? -1 : 0; });
    };
    setHidden(LS.get("bar-hidden") === true);
    barTab.addEventListener("click", function () {
      var hidden = !barBox.classList.contains("is-hidden");
      setHidden(hidden);
      LS.set("bar-hidden", hidden);
    });
  }

  /* 0з. Полоса над обложкой: показываем в ней тот верх картины, который обложка срезала
     (object-fit: cover; object-position: 50% 28%) — ручка кисти и небо продолжаются без шва. */
  var sky = document.querySelector(".top-sky");
  var introBox = document.querySelector(".intro");
  if (sky && introBox) {
    var IMG_W = 1920, IMG_H = 1072;
    var fitSky = function () {
      var r = introBox.getBoundingClientRect();
      var top = r.top + window.scrollY;            // высота полосы над обложкой
      var W = r.width, H = r.height;
      if (!W || !H) return;
      var k = Math.max(W / IMG_W, H / IMG_H);
      var dw = IMG_W * k, dh = IMG_H * k;
      var x = (W - dw) / 2, y = (H - dh) * 0.28;    // как у картины в обложке (object-position 50% 28%)
      sky.style.height = top + "px";
      sky.style.backgroundSize = dw + "px " + dh + "px";
      sky.style.backgroundPosition = x + "px " + (y + top) + "px";
    };
    fitSky();
    window.addEventListener("resize", fitSky);
    if (window.ResizeObserver) new ResizeObserver(fitSky).observe(introBox);
  }

  /* 1. Поля ответа — редактируемые блоки (не textarea), чтобы строки обтекали подпись шага,
     как в книге. Растут по высоте сами. Где «только текст» не поддерживается — обычный режим. */
  document.querySelectorAll(".lines").forEach(function (el) {
    if (el.contentEditable !== "plaintext-only") el.contentEditable = "true";
  });

  /* 3. Обложка: видео один раз при загрузке страницы, потом — картинка.
     - Видео запускается из скрипта, без autoplay/loop, поэтому браузер сам его не перезапускает.
     - Как только обложка целиком ушла с экрана (человек пролистал вниз), видео ставится
       на паузу и заменяется картинкой из img/. Вернувшись наверх, человек видит картинку.
       После перезагрузки страницы снова играет видео.
     - При «уменьшить движение» сразу картинка, без анимации. */
  var intro = document.querySelector(".intro");
  var video = document.querySelector(".intro-video");
  var still = document.querySelector(".intro-still");
  if (intro && video && still) {
    var reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    var loadStill = function () { if (!still.getAttribute("src")) still.src = still.dataset.src; };
    var stilled = false;
    var onScroll = function () {};   // настоящая проверка прокрутки назначается ниже
    var toStill = function () {
      if (stilled) return;
      stilled = true;
      window.removeEventListener("scroll", onScroll);
      loadStill();
      var show = function () {
        intro.classList.add("is-still");          // картинка плавно проявляется поверх видео (1 с)
        setTimeout(function () {                   // когда проявилась — видео больше не нужно
          video.pause();
          video.removeAttribute("src");            // освобождаем память и сеть
          video.load();
        }, 1100);
      };
      if (still.complete && still.naturalWidth) show();
      else { still.addEventListener("load", show, { once: true }); still.addEventListener("error", show, { once: true }); }
    };
    // видео доиграло — сразу возвращается заставка-картинка, без прокрутки
    video.addEventListener("ended", toStill);
    // пока видео грузится, видна картина (фон обложки); видео проявляется, когда пошло
    video.addEventListener("playing", function () { intro.classList.add("video-on"); }, { once: true });

    // показываем только отрезок видео: data-start … data-end (сейчас со 2-й секунды до конца)
    var vStart = parseFloat(video.dataset.start) || 0;
    var vEnd = parseFloat(video.dataset.end) || 0;
    var toStart = function () {
      if (vStart && video.currentTime < vStart - 0.05) video.currentTime = vStart;
    };
    if (video.readyState >= 1) toStart();
    else video.addEventListener("loadedmetadata", toStart, { once: true });
    if (vEnd) {
      var reachedEnd = function () {
        if (!stilled && video.currentTime >= vEnd - 0.05) { video.pause(); toStill(); return true; }
        return false;
      };
      video.addEventListener("timeupdate", reachedEnd);           // запасной вариант для всех браузеров
      if ("requestVideoFrameCallback" in video) {                 // точно по кадрам, где поддерживается
        var onFrame = function () { if (!reachedEnd() && !stilled) video.requestVideoFrameCallback(onFrame); };
        video.requestVideoFrameCallback(onFrame);
      }
      video.addEventListener("pause", function () {               // отрезок #t=…,конец браузер сам ставит на паузу в конце
        if (video.currentTime >= vEnd - 0.1) toStill();
      });
    }

    if (reduceMotion) {
      toStill();
    } else {
      video.muted = true;
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* автозапуск запрещён — остаётся первый кадр */ });
      // картинку подгружаем заранее, когда видео уже скачалось, чтобы при возврате не было пустоты
      video.addEventListener("canplaythrough", loadStill, { once: true });

      // обложка целиком скрылась за верхним краем экрана → дальше только картинка
      onScroll = function () {
        if (intro.getBoundingClientRect().bottom <= 0) toStill();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      onScroll(); // страница могла открыться уже прокрученной (браузер восстановил позицию)
    }
  }

  /* 2. Навигация по этапам */
  var nav = document.getElementById("chips");
  var chips = [].slice.call(document.querySelectorAll(".chip"));

  function setActive(stage) {
    var current = null;
    chips.forEach(function (a) {
      if (a.dataset.stage === stage) { a.setAttribute("aria-current", "true"); current = a; }
      else a.removeAttribute("aria-current");
    });
    if (current && nav) nav.scrollLeft = current.offsetLeft - nav.clientWidth / 2 + current.offsetWidth / 2;
    // глава «Начало» — шапка в синих картины обложки (класс .is-cover, см. .bar::before)
    var barEl = document.querySelector(".bar");
    if (barEl) barEl.classList.toggle("is-cover", stage === "intro");
    // фон шапки — оттенок этого этапа (цвет фона этапа --bg-c, иначе его основной цвет)
    if (current) {
      var cs = getComputedStyle(current);
      var bc = cs.getPropertyValue("--bg-c").trim() || cs.getPropertyValue("--c").trim();
      if (bc) document.documentElement.style.setProperty("--bar-c", bc);
      // «КНИГА ГОДА» — основным цветом этапа (зелёный, синий, …)
      var ink = cs.getPropertyValue("--acc").trim() || cs.getPropertyValue("--c").trim();
      if (ink) document.documentElement.style.setProperty("--bar-ink", ink);
    }
  }

  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var navLock = false, navLockT = 0;
  function unlockNav() { navLock = false; }
  // прокрутка закончилась — снова следим за тем, какой раздел на экране
  window.addEventListener("scrollend", function () { if (navLock) { clearTimeout(navLockT); navLockT = setTimeout(unlockNav, 80); } });
  chips.forEach(function (a) {
    a.addEventListener("click", function (e) {
      var target = document.querySelector(a.getAttribute("href"));
      if (!target) return;
      e.preventDefault();
      // выбранный раздел подсвечивается сразу, а не когда до него докрутится страница;
      // пока страница переходит к разделу, другие разделы подсветку не перехватывают
      setActive(a.dataset.stage);
      navLock = true;
      clearTimeout(navLockT);
      navLockT = setTimeout(unlockNav, 300);
      target.scrollIntoView({ behavior: "instant", block: "start" });   // сразу на нужную страницу, без прокрутки
      setToc(false);   // на телефоне список «Содержание» закрывается после выбора раздела
    });
  });

  /* 2а. Телефон: кнопка «Содержание» раскрывает список разделов (стили — css/style.css) */
  var tocBtn = document.querySelector(".toc-btn");
  var tocBar = tocBtn && tocBtn.closest(".bar");
  function setToc(open) {
    if (!tocBtn) return;
    tocBar.classList.toggle("toc-open", open);
    tocBtn.setAttribute("aria-expanded", String(open));
  }
  if (tocBtn) {
    tocBtn.addEventListener("click", function (e) { e.stopPropagation(); setToc(!tocBar.classList.contains("toc-open")); });
    // нажатие в любом месте экрана мимо списка сворачивает его (pointerdown — на iPhone «click» по пустому месту не приходит)
    document.addEventListener("pointerdown", function (e) { if (tocBar.classList.contains("toc-open") && !nav.contains(e.target) && !tocBtn.contains(e.target)) setToc(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && tocBar.classList.contains("toc-open")) { setToc(false); tocBtn.focus(); } });
    if (barTab) barTab.addEventListener("click", function () { setToc(false); });   // панель спрятали — список тоже
  }

  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      if (navLock) return;   // идёт переход по нажатию на раздел — подсветка уже стоит на выбранном
      entries.forEach(function (en) { if (en.isIntersecting) setActive(en.target.dataset.stage); });
    }, { rootMargin: "-25% 0px -65% 0px" });
    document.querySelectorAll("[data-stage].intro, [data-stage].sheet").forEach(function (s) { io.observe(s); });
  }
  if (chips[0]) setActive(chips[0].dataset.stage);
  /* 9. Сохранение полей в браузере: подпись на обложке, строки ответов, главное слово года,
     колесо эмоций. Ключ — страница + порядковый номер поля на ней. При открытии значения
     возвращаются, и поля получают событие input (обновляются плашки обложки и круг эмоций). */
  var FIELDS = ".cover-fields input, .word-box, .lines, .emo input, .rc input, .rc textarea";
  document.querySelectorAll(FIELDS).forEach(function (el) {
    var sheet = el.closest(".sheet");
    var group = sheet || document.querySelector(".cover-fields");
    var idx = [].indexOf.call(group.querySelectorAll(FIELDS), el);
    var key = "f:" + (sheet ? sheet.id : "cover") + ":" + idx;
    var editable = el.classList.contains("lines");
    var saved = LS.get(key);
    if (saved != null) {
      if (editable) el.textContent = saved; else el.value = saved;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.addEventListener("input", function () { LS.set(key, editable ? el.innerText : el.value); });
  });
  /* Ресурсный круг (стр. 51): человек нажимает в любом месте вокруг круга — там появляется
     надпись, и он пишет прямо в этом месте (шрифт и цвет ручки из настроек). Надписи хранятся
     как список {x, y, text} в процентах от блока — на любом экране стоят на тех же местах.
     Пустая надпись исчезает, когда курсор уходит. Старые ответы из прежних 12 строк
     переносятся в надписи на их места. */
  document.querySelectorAll(".rc").forEach(function (rc) {
    var sheet = rc.closest(".sheet");
    var key = "rc-notes:" + (sheet ? sheet.id : "0");
    var notes = LS.get(key);
    if (!Array.isArray(notes)) {
      notes = [];
      rc.querySelectorAll("textarea.rc-item").forEach(function (t) {   // перенос ответов из прежних строк
        if (t.value.trim()) notes.push({ x: parseFloat(t.style.getPropertyValue("--x")) || 50, y: parseFloat(t.style.getPropertyValue("--y")) || 50, text: t.value });
      });
      if (notes.length) LS.set(key, notes);
    }
    var save = function () { LS.set(key, notes.filter(function (n) { return n.text && n.text.trim(); })); };
    var make = function (n) {
      var el = document.createElement("div");
      el.className = "rc-note";
      el.setAttribute("contenteditable", "true");
      el.setAttribute("role", "textbox");
      el.setAttribute("aria-label", "Что меня наполняет");
      el.style.setProperty("--x", n.x + "%");
      el.style.setProperty("--y", n.y + "%");
      el.textContent = n.text || "";
      el.addEventListener("input", function () { n.text = el.innerText.replace(/\n$/, ""); save(); });
      el.addEventListener("blur", function () {
        if (!el.innerText.trim()) { notes.splice(notes.indexOf(n), 1); el.remove(); save(); }
      });
      rc.appendChild(el);
      return el;
    };
    notes.forEach(make);
    rc.addEventListener("click", function (e) {
      if (e.target !== rc) return;                                  // нажали по надписи или по кругу — не создаём новую
      var r = rc.getBoundingClientRect();
      var n = {
        x: Math.round(Math.min(90, Math.max(10, (e.clientX - r.left) / r.width * 100)) * 10) / 10,
        y: Math.round(Math.min(96, Math.max(4, (e.clientY - r.top) / r.height * 100)) * 10) / 10,
        text: ""
      };
      notes.push(n);
      make(n).focus();
    });
  });
  /* Ресурсный круг (стр. 51): места вокруг овала растут вниз — длинный текст переносится
     на дополнительные строки под первой. */
  document.querySelectorAll("textarea.rc-item").forEach(function (t) {
    var fit = function () {                       // высота — ровно целое число строк, иначе видна лишняя линия
      var lh = parseFloat(getComputedStyle(t).lineHeight) || 24;
      t.style.height = lh + "px";
      var n = Math.max(1, Math.round(t.scrollHeight / lh));
      t.style.height = n * lh + "px";
    };
    t.addEventListener("input", fit);
    window.addEventListener("resize", fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
    setTimeout(fit, 0);
  });
  /* Панель прозрачная, только пока под ней картина обложки (класс .over-cover). */
  (function () {
    var bar = document.querySelector(".bar"), cover = document.querySelector(".intro");
    if (!bar || !cover) return;
    var tick = false;
    var check = function () {
      tick = false;
      bar.classList.toggle("over-cover", cover.getBoundingClientRect().bottom > bar.offsetHeight);
    };
    window.addEventListener("scroll", function () { if (!tick) { tick = true; requestAnimationFrame(check); } }, { passive: true });
    window.addEventListener("resize", check);
    check();
  })();
})();
