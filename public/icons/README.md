# Icon Placeholder

The icons for VanishMe should be created as PNG files. Here's a simple approach to create them:

## Option 1: Use an SVG and convert to PNG

Create an SVG icon with this design concept:
- Dark background (#1a1a1a)
- Shield or eye-with-slash symbol in green (#4caf50)
- Simple, recognizable at small sizes

## Option 2: Use an online icon generator

Visit a site like:
- https://www.favicon-generator.org/
- https://favicon.io/

Upload or create an icon with:
- Symbol: Shield with checkmark or eye with slash
- Colors: Dark background with green accent
- Export as 16x16, 32x32, 48x48, and 128x128 PNG

## Option 3: Use ImageMagick to generate placeholder icons

```bash
# Install ImageMagick first if needed
# macOS: brew install imagemagick

# Create simple green shield icons
convert -size 16x16 xc:#1a1a1a -fill "#4caf50" -draw "circle 8,8 8,3" public/icons/icon16.png
convert -size 32x32 xc:#1a1a1a -fill "#4caf50" -draw "circle 16,16 16,6" public/icons/icon32.png
convert -size 48x48 xc:#1a1a1a -fill "#4caf50" -draw "circle 24,24 24,9" public/icons/icon48.png
convert -size 128x128 xc:#1a1a1a -fill "#4caf50" -draw "circle 64,64 64,24" public/icons/icon128.png
```

## Temporary Placeholder

For now, you can create simple single-color PNG files as placeholders. The extension will still work, just with basic icons.
