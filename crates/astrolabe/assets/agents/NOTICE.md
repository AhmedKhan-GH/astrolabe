# Agent logo sources

These logos identify the corresponding third-party tools in Agent Monitor.
Product names and artwork remain the property of their respective owners.

Bundled PNGs are 128 × 128 pixels. Vector sources are retained alongside them.
Grok, OpenAI and Xiaomi MiMo use a light monochrome mark for the app's dark background;
Meta uses its blue mark for Meta / Muse Code. The OpenAI mark identifies Codex.
SVGs are rasterized with resvg 0.49.0, fitting the artwork inside a centered
104 × 104 area without changing its aspect ratio.

## Lobe Icons

The Grok, Meta, Gemini, Kimi, OpenAI, Antigravity, Mistral, MiniMax, DeepSeek,
Xiaomi MiMo and Tencent CodeBuddy vectors are adapted from
[Lobe Icons](https://github.com/lobehub/lobe-icons), retrieved 2026-11-17:

- `src/Grok/components/Mono.tsx`
- `src/Meta/components/Mono.tsx`
- `src/Gemini/components/Color.tsx`
- `src/Kimi/components/Color.tsx`
- `src/OpenAI/components/Mono.tsx`
- `src/Antigravity/components/Color.tsx`
- `src/Mistral/components/Color.tsx` → `mistral.svg`
- `src/Minimax/components/Color.tsx` → `minimax.svg`
- `src/DeepSeek/components/Color.tsx` → `deepseek.svg`
- `src/XiaomiMiMo/components/Mono.tsx` → `mimo.svg`
- `src/CodeBuddy/components/Color.tsx` → `codebuddy.svg`

React attributes and generated gradient IDs were converted to SVG attributes.
Geometry and color gradients are preserved. Monochrome `currentColor` is
resolved to `#EEEEEE` (`#0082FB` for Meta).

MIT License

Copyright (c) 2023 LobeHub

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Installed product assets

- Qwen: `@qwen-code/qwen-code/web-shell/assets/icon.svg`, from the installed
  official [Qwen Code](https://github.com/QwenLM/qwen-code) 0.28.0 package.
  Its Apache 2.0 license is included in `LICENSE-Qwen.txt`. The original SVG
  is unchanged; the PNG is a padded rasterization for the Monitor tile.
- Claude: `Claude.app/Contents/Resources/electron.icns`.
- ZCode: `ZCode.app/Contents/Resources/icon.icns`.
- Ollama: `Ollama.app/Contents/Resources/icon.icns`.
- OpenCode: `OpenCode.app/Contents/Resources/icon.icns`.

The four app icons were converted to PNG using macOS `sips -s format png -Z 128`.
Native app icons still take precedence when present and readable. Embedded
copies ensure CLI-only installations, missing apps and conversion failures
retain an identifiable logo without downloading anything at runtime.
