import { Placeholder } from "../components/UI";

// Спека, раздел "Календарь и внешние интеграции" - ICS/webcal-фид на
// бэкенде уже есть (backend/src/routes/calendar.ts), экран ещё не собран -
// открытый вопрос приватности чужих поводов не решён.
export function CalendarRecipient() {
  return <Placeholder title="Календарь" backTo="/" />;
}
