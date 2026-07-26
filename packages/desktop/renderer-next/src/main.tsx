import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";
import "./styles/sidebar.css";
import "./styles/topbar.css";
import "./styles/git-panel.css";
import "./styles/trust-banner.css";
import "./styles/message.css";
import "./styles/message-list.css";
import "./styles/composer.css";
import "./styles/workbench.css";
import "./styles/statusbar.css";
import "./styles/retry-notice.css";
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
