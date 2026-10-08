import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { ShareWishlist } from "./pages/ShareWishlist";
import { SharedWishlist } from "./pages/SharedWishlist";
import { ItemDetail } from "./pages/ItemDetail";
import { CalendarRecipient } from "./pages/CalendarRecipient";
import { CalendarGiver } from "./pages/CalendarGiver";
import { CalendarOrganizer } from "./pages/CalendarOrganizer";
import { ErrorBanner, Header, Screen } from "./components/UI";

// QA-18: неизвестный адрес раньше давал полностью пустой экран.
function NotFound() {
  return (
    <Screen>
      <Header title="Вишлист-бот" backTo="/" />
      <div style={{ padding: 20 }}>
        <ErrorBanner code="page_not_found" screen="not_found" message="Такой страницы нет - вернитесь к своему вишлисту." />
      </div>
    </Screen>
  );
}

// Карта маршрутов сверена с Продукт/флоу-итерация-1.md. Часть экранов
// макета - это состояния одного маршрута, а не отдельные страницы:
// Empty - состояние "/" при пустом списке, Onboarding как отдельная
// заглушка не заведена - см. комментарий в Home.tsx.
export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/w/:slug" element={<SharedWishlist />} />
        <Route path="/w/:slug/share" element={<ShareWishlist />} />
        <Route path="/item/:itemId" element={<ItemDetail />} />
        {/* Аудит 2026-10-08, А-2: экраны сборов /p/* (PoolCreate, PoolProgress,
            SharePool, Contribute) не подключены, пока итерация 2 выключена -
            бэкенд-роуты /api/pools* тоже не зарегистрированы. Компоненты
            остались в pages/ как задел. */}
        <Route path="/calendar" element={<CalendarRecipient />} />
        <Route path="/calendar/giver" element={<CalendarGiver />} />
        <Route path="/calendar/organizer" element={<CalendarOrganizer />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
