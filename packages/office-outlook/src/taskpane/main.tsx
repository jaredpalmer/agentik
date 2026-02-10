import { createRoot } from "react-dom/client";
import { App } from "./App.js";

void Office.onReady(() => {
  const root = createRoot(document.getElementById("root")!);
  root.render(<App />);
});
