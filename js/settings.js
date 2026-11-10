/* Настройки письма: шрифт ответов и цвет ручки.
   Выбор сохраняется в localStorage (kniga-goda:v1:hand, kniga-goda:v1:pen)
   и ставится на <html> как data-hand / data-pen — стили в css/settings.css.
   Ранняя установка (без мигания шрифта) — маленький скрипт в <head> index.html. */
(function () {
  var KEY_HAND = "kniga-goda:v1:hand", KEY_PEN = "kniga-goda:v1:pen";
  var root = document.documentElement;
  var box = document.querySelector(".pen-set");
  if (!box) return;
  var btn = box.querySelector(".pen-set__btn");
  var panel = box.querySelector(".pen-panel");
  var tabs = box.querySelectorAll(".pen-tab");

  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function mark() {
    var hand = root.getAttribute("data-hand") || "badscript";
    var pen = root.getAttribute("data-pen") || "black";
    box.querySelectorAll(".pen-opt[data-hand]").forEach(function (o) {
      o.setAttribute("aria-checked", String(o.getAttribute("data-hand") === hand));
    });
    box.querySelectorAll(".pen-opt[data-pen]").forEach(function (o) {
      o.setAttribute("aria-checked", String(o.getAttribute("data-pen") === pen));
    });
    /* образцы шрифтов сами пишутся текущим цветом ручки, а образцы цветов — текущим шрифтом:
       переменные --pen и --hand-* наследуются от <html> */
  }

  function openTab(name) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-tab") === name && t.getAttribute("aria-expanded") !== "true";
      t.setAttribute("aria-expanded", String(on));
      box.querySelector('[data-list="' + t.getAttribute("data-tab") + '"]').hidden = !on;
    });
  }

  function setOpen(open) {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) mark();
  }

  btn.addEventListener("click", function (e) { e.stopPropagation(); setOpen(panel.hidden); });
  tabs.forEach(function (t) { t.addEventListener("click", function () { openTab(t.getAttribute("data-tab")); }); });

  box.addEventListener("click", function (e) {
    var o = e.target.closest(".pen-opt");
    if (!o) return;
    if (o.hasAttribute("data-hand")) { root.setAttribute("data-hand", o.getAttribute("data-hand")); save(KEY_HAND, o.getAttribute("data-hand")); }
    if (o.hasAttribute("data-pen"))  { root.setAttribute("data-pen", o.getAttribute("data-pen")); save(KEY_PEN, o.getAttribute("data-pen")); }
    mark();
  });

  /* закрыть по клику мимо панели или по Esc */
  // нажатие в любом месте экрана мимо окошка сворачивает его (pointerdown — на iPhone «click» по пустому месту не приходит)
  document.addEventListener("pointerdown", function (e) { if (!panel.hidden && !box.contains(e.target)) setOpen(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) { setOpen(false); btn.focus(); } });

  /* на случай, если ранний скрипт в <head> не сработал */
  if (!root.hasAttribute("data-hand") && load(KEY_HAND)) root.setAttribute("data-hand", load(KEY_HAND));
  if (!root.hasAttribute("data-pen") && load(KEY_PEN)) root.setAttribute("data-pen", load(KEY_PEN));
})();
