import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { ShareWishlist } from "./pages/ShareWishlist";
import { SharedWishlist } from "./pages/SharedWishlist";
import { ItemDetail } from "./pages/ItemDetail";
import { ErrorBanner, Header, Screen } from "./components/UI";
import { APP_NAME } from "./brand";

// QA-18: неизвестный адрес раньше давал полностью пустой экран.
function NotFound() {
  return (
    <Screen>
      <Header title={APP_NAME} backTo="/" />
      <div style={{ padding: 20 }}>
        <ErrorBanner code="page_not_found" screen="not_found" message="Такой страницы нет — вернитесь к своему вишлисту." />
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
        {/* Аудит 2026-10-08, А-2/А-44: экраны итерации 2 - сборы /p/*
            (PoolCreate, PoolProgress, SharePool, Contribute) и календари
            сборов /calendar* (CalendarRecipient/Giver/Organizer) - не
            подключены, пока итерация 2 выключена: по прямому адресу
            открывается "Такой страницы нет", а не заглушка со служебным
            текстом. Компоненты остались в pages/ как задел (в сборку не
            попадают - их никто не импортирует); бэкенд-роуты /api/pools*
            тоже не зарегистрированы. Вернуть - добавить Route сюда. */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
