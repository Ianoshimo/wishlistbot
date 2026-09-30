import { HashRouter, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { AddItem } from "./pages/AddItem";
import { ShareWishlist } from "./pages/ShareWishlist";
import { SharedWishlist } from "./pages/SharedWishlist";
import { ItemDetail } from "./pages/ItemDetail";
import { PoolCreate } from "./pages/PoolCreate";
import { SharePool } from "./pages/SharePool";
import { PoolProgress } from "./pages/PoolProgress";
import { Contribute } from "./pages/Contribute";
import { CalendarRecipient } from "./pages/CalendarRecipient";
import { CalendarGiver } from "./pages/CalendarGiver";
import { CalendarOrganizer } from "./pages/CalendarOrganizer";

// Карта маршрутов сверена с Продукт/флоу-итерация-1.md. Часть экранов
// макета - это состояния одного маршрута, а не отдельные страницы:
// Empty - состояние "/" при пустом списке, Onboarding как отдельная
// заглушка не заведена - см. комментарий в Home.tsx.
export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/w/:slug" element={<SharedWishlist />} />
        <Route path="/w/:slug/add" element={<AddItem />} />
        <Route path="/w/:slug/share" element={<ShareWishlist />} />
        <Route path="/item/:itemId" element={<ItemDetail />} />
        <Route path="/p/new" element={<PoolCreate />} />
        <Route path="/p/:id" element={<PoolProgress />} />
        <Route path="/p/:id/share" element={<SharePool />} />
        <Route path="/p/:id/contribute" element={<Contribute />} />
        <Route path="/calendar" element={<CalendarRecipient />} />
        <Route path="/calendar/giver" element={<CalendarGiver />} />
        <Route path="/calendar/organizer" element={<CalendarOrganizer />} />
      </Routes>
    </HashRouter>
  );
}
