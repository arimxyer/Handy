---
paths:
  - "src-tauri/**"
---

# Platform Notes

- **macOS**: Metal acceleration, accessibility permissions required for input simulation
- **Windows**: Vulkan acceleration, code signing required for distribution
- **Linux**: OpenBLAS + Vulkan, limited Wayland support, overlay disabled by default. Requires `libasound2-dev` for building.

## Debug Mode

Access debug features: `Cmd+Shift+D` (macOS) or `Ctrl+Shift+D` (Windows/Linux)
