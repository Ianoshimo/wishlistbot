import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { appOpenedProps, initTelegram } from "./telegram";
import { trackEvent } from "./api";
import "./theme.css";

initTelegram();
trackEvent("app_opened", appOpenedProps());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
