# Desktop

`desktop/` holds the desktop shell; see [Desktop shell](../architecture/desktop-shell.md).
`desktop/main.ts` is its main process, with `desktop/shell-env.ts` and `desktop/updates.ts` for the packaged app, and `bun run desktop` at the root installs the package and starts it from the checkout through `desktop/launch.ts`; `scripts/build-desktop-artifact.ts` packages it (see [Packaging and releases](../architecture/desktop-shell.md#packaging-and-releases)).
`desktop/preload.ts` is the window's preload, which gives the page the `DesktopBridge`, and `desktop/attention.ts` takes what the page sends through it: the Dock badge's count and the session notifications, whose click shows the window on the session.
On macOS the launcher clones `node_modules/electron/dist/Electron.app` to `desktop/dist/omp agents.app`, sets its `CFBundleName`, `CFBundleDisplayName`, and `CFBundleIdentifier`, gives it an `.icns` that it renders from `icon.png` with `sips` and `iconutil`, signs it ad hoc, and runs that copy, because the Dock, the menu bar, and Cmd+Tab read an app's name and icon from its bundle.
It rebuilds the copy when Electron's version or `icon.png` changes.
`desktop/icon.svg` is the app icon, the logo mark on a macOS-style tile, and `desktop/icon.png` is that SVG rendered at 1024 px, because Electron reads no SVG; render it again after you change the SVG.
The page's favicon, `web/favicon.svg`, is the bare mark.
