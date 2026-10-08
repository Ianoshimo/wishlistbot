// Аудит 2026-10-08, А-18: то же правило номера для СБП, что на бэкенде
// (backend/src/services/phone.ts - держать одинаковыми): оставляем цифры,
// 8/7 в начале 11-значного номера - код России, 10 цифр - номер без кода,
// результат +7XXXXXXXXXX. null - номер не подходит для СБП.
const ALLOWED = /^[\d\s()+\-.]{1,30}$/;

export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!ALLOWED.test(raw)) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits[0] === "7" || digits[0] === "8")) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return null;
}

// Единый вид номера в СБП-карточке: +7 900 123-45-67. Номер, сохранённый
// до нормализации, тоже приводится к этому виду; совсем нестандартный -
// как есть.
export function formatPhone(input: string): string {
  const n = normalizePhone(input);
  if (!n) return input;
  const d = n.slice(2);
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}
