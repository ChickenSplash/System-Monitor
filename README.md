# Tauri + Vanilla

This template should help get you started developing with Tauri in vanilla HTML, CSS and Javascript.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Development Setup (Arch-based systems)

These steps cover a fresh Arch install using the fish shell.

### 1. Install system dependencies

Tauri v2 needs the GTK WebKit web view plus the usual build tooling:

```fish
sudo pacman -S --needed \
  webkit2gtk-4.1 \
  base-devel \
  curl wget file \
  openssl \
  libappindicator-gtk3 \
  librsvg
```

### 2. Install Rust

```fish
sudo pacman -S --needed rustup
rustup default stable
```

### 3. Install Node.js and project dependencies

```fish
sudo pacman -S --needed nodejs npm
npm install
```

### 4. Run the dev app

```fish
env GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev
```

- `GDK_BACKEND=x11` — forces GTK to use X11 (via XWayland) instead of native Wayland. `webkit2gtk` doesn't like Wayland for some reason...
- `WEBKIT_DISABLE_DMABUF_RENDERER=1` — disables the DMABUF renderer that causes the blank window.

> Tip: if you don't want to type the flags every time, add an alias to your shell config, e.g. in `~/.config/fish/config.fish`:
>
> ```fish
> alias tauri-dev 'env GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev'
> ```
