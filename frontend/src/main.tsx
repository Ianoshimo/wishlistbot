import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { initTelegram } from "./telegram";
import "./theme.css";

// Диагностика пустого экрана (2026-10-02, см. index.html) - подтверждает,
// что этот файл реально начал выполняться, а не просто был запрошен.
(window as unknown as { __bootStarted: boolean }).__bootStarted = true;

initTelegram();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
