import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

const apiOrigin = import.meta.env.VITE_API_ORIGIN?.trim();

if (apiOrigin) {
  setBaseUrl(apiOrigin);
}

// Restore the path saved by 404.html when the static host 404s on a deep URL.
const spaRedirect = sessionStorage.getItem("__spa_redirect");
if (spaRedirect) {
  sessionStorage.removeItem("__spa_redirect");
  window.history.replaceState(null, "", spaRedirect);
}

createRoot(document.getElementById("root")!).render(<App />);
