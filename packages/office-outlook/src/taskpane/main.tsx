import "@agentik/office-common/src/ui/globals.css";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

void Office.onReady(() => {
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
});
