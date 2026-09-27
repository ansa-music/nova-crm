/**
 * Клавиатура телефона и окна поверх страницы.
 *
 * На iPhone клавиатура не сжимает страницу: `position: fixed` считается от
 * всего окна, и диалог «по центру» или шторка «снизу» оказывались ПОД
 * клавиатурой — кнопка «В стол» / «Сохранить» не видна, пока не свернёшь
 * клавиатуру. Видимую часть знает только `visualViewport`: пока клавиатура
 * открыта, кладём её размеры в CSS-переменные на <html> и ставим
 * `data-keyboard="open"`, а index.css по ним ставит диалоги и шторки в
 * видимую часть. Клавиатура закрыта или щипок масштаба — переменных нет,
 * всё как было.
 */
export function initVisualViewportVars() {
  if (typeof window === "undefined") return;
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  let frame = 0;

  const apply = () => {
    frame = 0;
    const height = vv.height;
    const top = vv.offsetTop;
    const hidden = window.innerHeight - height;
    // Щипок масштаба — это не клавиатура (scale > 1), и мелкая разница
    // (панель Safari прячется при прокрутке) — тоже.
    const keyboard = vv.scale <= 1.01 && hidden > 120;
    if (keyboard) {
      root.style.setProperty("--vv-top", `${Math.round(top)}px`);
      root.style.setProperty("--vv-h", `${Math.round(height)}px`);
      root.style.setProperty("--vv-bottom", `${Math.max(0, Math.round(window.innerHeight - top - height))}px`);
      root.dataset.keyboard = "open";
    } else if (root.dataset.keyboard) {
      root.style.removeProperty("--vv-top");
      root.style.removeProperty("--vv-h");
      root.style.removeProperty("--vv-bottom");
      delete root.dataset.keyboard;
    }
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(apply);
  };
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
  window.addEventListener("orientationchange", schedule);
  apply();
}
