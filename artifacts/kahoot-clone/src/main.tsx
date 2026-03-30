import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

const apiOrigin = import.meta.env.VITE_API_ORIGIN?.trim();

if (apiOrigin) {
  setBaseUrl(apiOrigin);
}

createRoot(document.getElementById("root")!).render(<App />);
