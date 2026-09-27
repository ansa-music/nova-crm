import React from "react";
import ReactDOM from "react-dom/client";
import App from "@/App";
import "@/index.css";
import { initPwa } from "@/utils/pwa";
import { initVisualViewportVars } from "@/utils/visualViewportVars";

// Приложение без магазинов: событие установки и сервис-воркер — до React.
initPwa();
initVisualViewportVars();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
