import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { markStartParamHandled, pendingStartRedirect } from "../telegram";
import { api } from "../api";
import { MyWishlist, MY_SLUG_KEY } from "./MyWishlist";
import { Onboarding } from "./Onboarding";

// Флоу-итерация-1.md: startapp=w_<slug> ведёт сразу на чужой вишлист,
// минуя свой собственный. Без параметра и без своего вишлиста ещё -
// показываем Onboarding (спека, п.6), а не сразу пустой список.
export function Home() {
  const navigate = useNavigate();
  // А-1/А-3: переход по start_param - один раз за сессию (см. telegram.ts).
  // Решаем в рендере, чтобы при переходе не монтировать MyWishlist зря.
  const startRedirect = pendingStartRedirect();
  // Беклог В-7: при useState(false) первый рендер отдавал <MyWishlist/>,
  // её эффект (дочерний, выполняется раньше родительского) успевал
  // дёрнуть POST /api/wishlists до того, как этот эффект решал показать
  // Onboarding - в БД оставался "осиротевший" вишлист. Ленивый
  // инициализатор решает это синхронно, на первом же рендере.
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem(MY_SLUG_KEY));
  // QA-3: localStorage мог очиститься (переустановка, автоочистка WebView),
  // а списки на сервере остались - тогда онбординг "Создать свой вишлист"
  // вводит в заблуждение. Пока проверяем, не показываем ничего; MyWishlist
  // монтируется только когда списки точно есть, поэтому В-7 не возвращается.
  const [checkingExisting, setCheckingExisting] = useState(() => showOnboarding && !startRedirect);
  useEffect(() => {
    if (!checkingExisting) return;
    api
      .getMyWishlists()
      .then((mine) => {
        if (mine.wishlists.length > 0) setShowOnboarding(false);
      })
      .catch(() => {})
      .finally(() => setCheckingExisting(false));
  }, [checkingExisting]);

  useEffect(() => {
    if (!startRedirect) return;
    markStartParamHandled();
    navigate(startRedirect, { replace: true });
  }, [startRedirect, navigate]);

  if (startRedirect) return null;
  if (checkingExisting) return null;

  if (showOnboarding) {
    return <Onboarding onStart={() => setShowOnboarding(false)} />;
  }

  return <MyWishlist />;
}
