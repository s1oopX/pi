import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";
import "./styles/topbar.css";
import "./styles/message.css";
import "./styles/message-list.css";
import "./styles/composer.css";
import "./styles/statusbar.css";
import "./styles/dialog.css";
import "./styles/settings.css";
import "./styles/diff.css";
import "./styles/terminal.css";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
