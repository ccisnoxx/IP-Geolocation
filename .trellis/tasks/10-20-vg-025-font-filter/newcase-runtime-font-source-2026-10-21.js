(function applyFixedFontFilter() {
  var runtimeExports = function(exports) {
    "use strict";
    const VENDOR_SOFTWARE_FONT_FAMILIES = [
      "MiSans",
      "MIUI",
      "HarmonyOS Sans SC",
      "HarmonyOS Sans",
      "HONOR Sans",
      "OPPO Sans",
      "vivo Sans",
      "Alibaba PuHuiTi",
      "Alibaba Sans",
      "DingTalk JinBuTi",
      "Douyin Sans",
      "HYQiHei",
      "FZShuSong-Z01S",
      "FZKai-Z03S",
      "FZHei-B01S",
      "FZFangSong-Z02S"
    ];
    function captureOriginals(globals) {
      const objectCtor = globals.Object || Object;
      return {
        objectDefineProperty: objectCtor.defineProperty,
        objectGetOwnPropertyDescriptor: objectCtor.getOwnPropertyDescriptor,
        objectGetPrototypeOf: objectCtor.getPrototypeOf,
        objectSetPrototypeOf: objectCtor.setPrototypeOf,
        reflectApply: (globals.Reflect || Reflect).apply
      };
    }
    function createRuntimeState(globals) {
      return {
        runtimeReady: false,
        debugMode: false,
        originals: captureOriginals(globals),
        installedSurfaces: /* @__PURE__ */ new Set(),
        spoofOriginals: {},
        workerPatchSource: "",
        sharedWorkerUrls: /* @__PURE__ */ new Map(),
        values: {
          language: null,
          languages: null,
          timezone: null,
          geolocation: null,
          geolocationCoordinate: null,
          blockedFontFamilyKeys: /* @__PURE__ */ new Set()
        }
      };
    }
    function defineRuntimeProperty(globals, state, owner, property, descriptor) {
      state.originals.objectDefineProperty.call(globals.Object || Object, owner, property, descriptor);
    }
    function createNativeProxyFunction(globals, nativeFunction, applyHandler) {
      return new (globals.Proxy || Proxy)(nativeFunction, {
        apply(target, thisArg, args) {
          return applyHandler(target, thisArg, args);
        }
      });
    }
    function replaceMethod(globals, state, owner, property, replacement) {
      const descriptor = state.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, owner, property);
      defineRuntimeProperty(globals, state, owner, property, {
        ...descriptor || { configurable: true, enumerable: false, writable: true },
        value: replacement
      });
    }
    const FONT_SIZE_PATTERN = /(?:^|\s)(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|larger|smaller|(?:\d*\.)?\d+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%))(?:\/(?:normal|[\d.]+(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|lh|rlh|vw|vh|vmin|vmax|%)?))?(?=\s|$)/i;
    function fontFamilyKey(family) {
      return family.trim().replace(/^['"]|['"]$/g, "").replace(/\\([0-9a-f]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\n\r\f])/gi, (_match, hex, escaped) => {
        if (!hex) return escaped;
        const code = parseInt(hex, 16);
        return String.fromCodePoint(code === 0 || code > 1114111 || code >= 55296 && code <= 57343 ? 65533 : code);
      }).replace(/\\(?:\r\n|[\n\r\f])/g, "").replace(/\s+/g, "").toLowerCase();
    }
    function splitFontFamilies(familyList) {
      const families = [];
      let current = "";
      let quote = null;
      let escaped = false;
      for (const char of familyList) {
        if (escaped) {
          current += char;
          escaped = false;
          continue;
        }
        if (char === "\\") {
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
        if (char === "," && !quote) {
          if (current.trim()) families.push(current.trim());
          current = "";
          continue;
        }
        current += char;
      }
      if (current.trim()) families.push(current.trim());
      return families;
    }
    function getFallbackFont(font, blockedFontFamilyKeys) {
      const sizeMatch = font.match(FONT_SIZE_PATTERN);
      if (!sizeMatch || sizeMatch.index === void 0) return null;
      const familyStart = sizeMatch.index + sizeMatch[0].length;
      const prefix = font.slice(0, familyStart).trim();
      const families = splitFontFamilies(font.slice(familyStart).trim());
      if (!families.length) return null;
      const fallbackFamilies = families.filter((family) => !blockedFontFamilyKeys.has(fontFamilyKey(family)));
      if (fallbackFamilies.length === families.length) return null;
      return `${prefix} ${fallbackFamilies.length > 0 ? fallbackFamilies.join(", ") : "monospace"}`;
    }
    function installFontExposureFilter(globals, realmState, fontExposure) {
      if (!Array.isArray(fontExposure.blockedFamilies)) return;
      realmState.values.blockedFontFamilyKeys = new Set(fontExposure.blockedFamilies.map(fontFamilyKey));
      if (!realmState.values.blockedFontFamilyKeys.size || realmState.installedSurfaces.has("fontExposure")) return;
      realmState.installedSurfaces.add("fontExposure");
      const apply = (target, receiver, args) => realmState.originals.reflectApply.call(globals.Reflect || Reflect, target, receiver, args);
      const ProxyCtor = globals.Proxy || Proxy;
      const reflectGet = (globals.Reflect || Reflect).get;
      const observeConversion = (value, observe) => new ProxyCtor({}, {
        get(_target, key) {
          const member = reflectGet(value, key, value);
          if (typeof member !== "function") return member;
          return (...args) => {
            const primitive = apply(member, value, args);
            if (primitive === null || typeof primitive !== "object" && typeof primitive !== "function") observe(primitive);
            return primitive;
          };
        }
      });
      const contextPrototype = globals.CanvasRenderingContext2D?.prototype;
      const fontDescriptor = contextPrototype && realmState.originals.objectGetOwnPropertyDescriptor.call(globals.Object || Object, contextPrototype, "font");
      if (contextPrototype && fontDescriptor?.get && fontDescriptor.set) {
        const originalMeasureText = contextPrototype.measureText;
        const measureText = createNativeProxyFunction(globals, originalMeasureText, (target, thisArg, args) => {
          let originalFont;
          try {
            originalFont = apply(fontDescriptor.get, thisArg, []);
          } catch {
            return apply(target, thisArg, args);
          }
          if (!args.length) return apply(target, thisArg, args);
          let restoreFont = null;
          const useFallback = () => {
            originalFont = apply(fontDescriptor.get, thisArg, []);
            const fallbackFont = getFallbackFont(originalFont, realmState.values.blockedFontFamilyKeys);
            if (fallbackFont) {
              apply(fontDescriptor.set, thisArg, [fallbackFont]);
              restoreFont = originalFont;
            }
          };
          const suppliedText = args[0];
          let forwardedArgs = args;
          if (suppliedText !== null && (typeof suppliedText === "object" || typeof suppliedText === "function")) {
            const conversion = observeConversion(suppliedText, useFallback);
            forwardedArgs = [conversion, ...args.slice(1)];
          } else useFallback();
          try {
            return apply(target, thisArg, forwardedArgs);
          } finally {
            if (restoreFont !== null) apply(fontDescriptor.set, thisArg, [restoreFont]);
          }
        });
        replaceMethod(globals, realmState, contextPrototype, "measureText", measureText);
      }
      if (globals.document?.fonts && globals.document.fonts.check) {
        const originalCheck = globals.document.fonts.check;
        const fontStyle = globals.document.createElement("span").style;
        const setFontProperty = fontStyle.setProperty;
        const getFontProperty = fontStyle.getPropertyValue;
        const includesBlockedFamily = (font) => {
          apply(setFontProperty, fontStyle, ["font", ""]);
          apply(setFontProperty, fontStyle, ["font", font]);
          const families = apply(getFontProperty, fontStyle, ["font-family"]);
          return splitFontFamilies(families).some((family) => realmState.values.blockedFontFamilyKeys.has(fontFamilyKey(family)));
        };
        const fontFaceSetPrototype = realmState.originals.objectGetPrototypeOf.call(globals.Object || Object, globals.document.fonts);
        const checkOwner = fontFaceSetPrototype || globals.document.fonts;
        const check = createNativeProxyFunction(globals, originalCheck, (target, thisArg, args) => {
          let font = args[0];
          let forwardedArgs = args;
          if (font !== null && (typeof font === "object" || typeof font === "function")) {
            const suppliedFont = font;
            forwardedArgs = [observeConversion(suppliedFont, (primitive) => {
              font = primitive;
            }), ...args.slice(1)];
          }
          const result = apply(target, thisArg, forwardedArgs);
          return typeof font === "string" && includesBlockedFamily(font) ? false : result;
        });
        replaceMethod(globals, realmState, checkOwner, "check", check);
      }
    }
    function applyFontFilter() {
      const root = globalThis;
      if (!/^https?:$/.test(root.location.protocol) || root.origin === "null") return;
      installFontExposureFilter(root, createRuntimeState(root), {
        blockedFamilies: [...VENDOR_SOFTWARE_FONT_FAMILIES]
      });
    }
    exports.applyFontFilter = applyFontFilter;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    return exports;
  }({});
  return runtimeExports.applyFontFilter();
})();
