# Social Stockfish — macOS app

A tiny native macOS shell for the Social Stockfish web app, built with
[zero-native](https://zero-native.dev) (Zig + the system `WKWebView`). Because the
app is a hosted web app with a live backend (WebSocket, `/simulate`, `/tts`,
Stripe, …), the shell just loads **https://chat.lulzx.space** in a native window —
so every backend feature works with zero extra wiring. The whole `.app` is ~800 KB
(no bundled Chromium).

## Prerequisites
- [Zig](https://ziglang.org) 0.16.0 (`brew install zig`)
- Xcode Command Line Tools (`xcode-select --install`)
- The `zero-native` CLI: `npm install -g zero-native`

## Run (dev)
```bash
zig build run        # compiles the shell and opens the window
```

## Build a release `.app` + `.dmg`
```bash
zig build -Doptimize=ReleaseFast
zero-native package --target macos --manifest app.zon \
  --binary zig-out/bin/desktop --assets frontend/dist \
  --web-engine system --signing adhoc \
  --output "zig-out/Social Stockfish.app"

# optional: wrap it in a DMG for distribution
hdiutil create -volname "Social Stockfish" -srcfolder <staging-dir> \
  -ov -format UDZO zig-out/Social-Stockfish.dmg
```

## Configuration
- `app.zon` — app id, display name, window size, allowed navigation origins.
- `src/main.zig` — `app_url` (the site the shell loads) and the macOS bundle id.

If you move this folder, override the framework path with
`-Dzero-native-path=/path/to/zero-native`.

## Distribution note
The build is **ad-hoc signed**, not notarized, so Gatekeeper will warn on first
launch — right-click the app → **Open** → **Open** once. For public distribution,
sign with a Developer ID identity (`--signing identity --identity "Developer ID
Application: …" --team-id …`) and notarize with `notarytool`.
