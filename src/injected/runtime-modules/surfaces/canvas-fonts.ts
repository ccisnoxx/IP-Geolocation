import type { RuntimePayload, RuntimeState } from '../types';
import { createNativeProxyFunction, defineRuntimeProperty, replaceMethod } from '../registry';

export const FONT_SIZE_PATTERN =
  /(?:^|\s)(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|(?:\d*\.)?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%))(?:\/(?:normal|[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%)?))?(?=\s|$)/i;

export function fontFamilyKey(family: string): string {
  return family.trim().replace(/^['"]|['"]$/g, '').replace(/\s+/g, '').toLowerCase();
}

export function splitFontFamilies(familyList: string): string[] {
  const families: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (const char of familyList) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      current += char;
      escaped = true;
      continue;
    }
    if ((char === '"' || char === "'") && !quote) {
      quote = char;
      current += char;
      continue;
    }
    if (quote && char === quote) {
      quote = null;
      current += char;
      continue;
    }
    if (char === ',' && !quote) {
      if (current.trim()) families.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) families.push(current.trim());
  return families;
}

export function getFallbackFont(font: string, targetFontKeys: Set<string>): string | null {
  const sizeMatch = font.match(FONT_SIZE_PATTERN);
  if (!sizeMatch || sizeMatch.index === undefined) return null;
  const familyStart = sizeMatch.index + sizeMatch[0].length;
  const prefix = font.slice(0, familyStart).trim();
  const families = splitFontFamilies(font.slice(familyStart).trim());
  if (!families.length) return null;
  const fallbackFamilies = families.filter((family) => !targetFontKeys.has(fontFamilyKey(family)));
  if (fallbackFamilies.length === families.length) return null;
  return `${prefix} ${fallbackFamilies.length > 0 ? fallbackFamilies.join(', ') : 'monospace'}`;
}

export function installCanvasSpoof(
  globals: typeof globalThis & Record<string, any>,
  realmState: RuntimeState,
  canvas: RuntimePayload['canvasConfig']
): void {
  if (!canvas || !canvas.enabled || !canvas.spoofFonts || !Array.isArray(canvas.targetFonts)) return;
  realmState.values.canvasTargetFontKeys = new Set(canvas.targetFonts.map(fontFamilyKey));
  if (realmState.installedSurfaces.has('canvas')) return;
  realmState.installedSurfaces.add('canvas');
  if (!globals.CanvasRenderingContext2D || !globals.HTMLCanvasElement) return;

  const originalMeasureText = globals.CanvasRenderingContext2D.prototype.measureText;
  const originalGetContext = globals.HTMLCanvasElement.prototype.getContext;

  function measureTextWithFontFallback(ctx: CanvasRenderingContext2D, text: string): TextMetrics {
    if (ctx.font && realmState.values.canvasTargetFontKeys.size > 0) {
      const fallbackFont = getFallbackFont(ctx.font, realmState.values.canvasTargetFontKeys);
      if (fallbackFont) {
        const originalFont = ctx.font;
        ctx.font = fallbackFont;
        try {
          return originalMeasureText.call(ctx, text);
        } finally {
          ctx.font = originalFont;
        }
      }
    }
    return originalMeasureText.call(ctx, text);
  }

  const getContext = createNativeProxyFunction(globals, originalGetContext, (target, thisArg, args) => (
    realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args)
  ));
  defineRuntimeProperty(globals, realmState, globals.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: getContext
  });

  replaceMethod(globals, realmState, globals.CanvasRenderingContext2D.prototype, 'measureText', function measureText(this: CanvasRenderingContext2D, text: string) {
    return measureTextWithFontFallback(this, text);
  });

  if (globals.document?.fonts && globals.document.fonts.check) {
    const originalCheck = globals.document.fonts.check;
    const fontFaceSetPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, globals.document.fonts);
    const checkOwner = fontFaceSetPrototype || globals.document.fonts;
    const check = createNativeProxyFunction(globals, originalCheck, (target, thisArg, args) => {
      const font = args[0] as string | undefined;
      if (font && typeof font === 'string' && getFallbackFont(font, realmState.values.canvasTargetFontKeys)) {
        return false;
      }
      return realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, thisArg, args);
    });
    defineRuntimeProperty(globals, realmState, checkOwner, 'check', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: check
    });
  }
}
