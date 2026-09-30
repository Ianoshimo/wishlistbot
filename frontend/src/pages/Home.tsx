import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getStartParam } from "../telegram";
import { MyWishlist, MY_SLUG_KEY } from "./MyWishlist";
import { Onboarding } from "./Onboarding";

// Флоу-итерация-1.md: startapp=w_<slug> ведёт сразу на чужой вишлист,
// минуя свой собственный. Без параметра и без своего вишлиста ещё -
// показываем Onboarding (спека, п.6), а не сразу пустой список.
export function Home() {
  const navigate = useNavigate();
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    const param = getStartParam();
    if (param?.startsWith("w_")) {
      navigate(`/w/${param.slice(2)}`, { replace: true });
      return;
    }
    if (param?.startsWith("p_")) {
      navigate(`/p/${param.slice(2)}`, { replace: true });
      return;
    }
    setShowOnboarding(!localStorage.getItem(MY_SLUG_KEY));
  }, [navigate]);

  if (showOnboarding) {
    return <Onboarding onStart={() => setShowOnboarding(false)} />;
  }

  return <MyWishlist />;
}
