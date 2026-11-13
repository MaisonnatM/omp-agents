import { createRoot } from "react-dom/client";
import { exchangePairingCode } from "./api";
import { App } from "./app";
import { SignedIn } from "./components/signed-in";
import { Toaster } from "./components/toaster";
import { TooltipProvider } from "./components/ui/tooltip";
import { startDesktopTitleBar } from "./desktop-title-bar";
import { startScrollFade } from "./scroll-fade";
import { startTheme } from "./theme";

startTheme();
startScrollFade();
startDesktopTitleBar();
await exchangePairingCode();

const root = document.getElementById("root");
if (!root) throw new Error("index.html is missing #root");
createRoot(root).render(
	<TooltipProvider>
		<SignedIn>
			<App />
		</SignedIn>
		<Toaster />
	</TooltipProvider>,
);
