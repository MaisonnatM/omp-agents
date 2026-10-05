import { createRoot } from "react-dom/client";
import { App } from "./app";
import { startScrollFade } from "./scroll-fade";
import { startTheme } from "./theme";

startTheme();
startScrollFade();

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");
createRoot(root).render(<App />);
