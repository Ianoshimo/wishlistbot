import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { markStartParamHandled, pendingStartRedirect } from "../telegram";
import { api } from "../api";
import { MyWishlist, MY_SLUG_KEY } from "./MyWishlist";
import { Onboarding } from "./Onboarding";
import { Loading } from "../components/UI";

// Флоу-итерация-1.md: startapp=w_<slug> ведёт сразу на чужой вишлист,
// минуя свой собственный. Без параметра и без своего вишлиста ещё -
// показываем Onboarding (спека, п.6), а не сразу пустой список.
export function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  // А-1/А-3: переход по start_param - один раз за сессию (см. telegram.ts).
  // Решаем в рендере, чтобы при переходе не монтировать MyWishlist зря.
  const startRedirect = pendingStartRedirect();
  // А-3: "Хочу такой же вишлист" с чужого списка - сразу в свой список
  // (создаётся при первом заходе), без лишнего тапа на онбординге.
  const openOwn = Boolean((location.state as { openOwn?: boolean } | null)?.openOwn);
  // Беклог В-7: при useState(false) первый рендер отдавал <MyWishlist/>,
  // её эффект (дочерний, выполняется раньше родительского) успевал
  // дёрнуть POST /api/wishlists до того, как этот эффект решал показать
  // Onboarding - в БД оставался "осиротевший" вишлист. Ленивый
  // инициализатор решает это синхронно, на первом же рендере.
  const [showOnboarding, setShowOnboarding] = useState(() => !openOwn && !localStorage.getItem(MY_SLUG_KEY));
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

  // А-29: скелетон вместо пустого фона.
  if (startRedirect) return <Loading />;
  if (checkingExisting) return <Loading />;

  if (showOnboarding) {
    return <Onboarding onStart={() => setShowOnboarding(false)} />;
  }

  return <MyWishlist />;
}
