// Аудит 2026-10-08, А-50: копирование в буфер с запасным путём. В части
// WebView (старый Android, iOS без разрешения) navigator.clipboard нет или
// он бросает - раньше на экране "Поделиться" это было необработанное
// исключение: кнопка не реагировала. Запасной путь - скрытое поле +
// execCommand("copy") (устаревший, но в WebView работает). false - не
// получилось никак: вызывающий показывает "скопируйте вручную".
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // пробуем запасной путь
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
