import { createRoot } from "react-dom/client";
import { App } from "./app";

// The Fluid tokens switch on a `.dark` class; follow the OS setting.
const dark = window.matchMedia("(prefers-color-scheme: dark)");
const applyScheme = (): void => void document.documentElement.classList.toggle("dark", dark.matches);
applyScheme();
dark.addEventListener("change", applyScheme);

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");
createRoot(root).render(<App />);
