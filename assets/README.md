# Assets

`logo.png` is the source of truth for the application icon. Regenerate the
platform icon set after replacing it:

```bash
sips -s format png -z 1024 1024 assets/logo.png --out /tmp/bookee-source.png
pnpm tauri icon /tmp/bookee-source.png
rm -rf src-tauri/icons/android src-tauri/icons/ios   # desktop only

# The in-app mark is a downscaled copy, kept small enough to bundle.
sips -s format png -z 128 128 assets/logo.png --out src/assets/logo-mark.png
```

`icon.svg` is the earlier drawn mark, kept for reference only; it is not used.
