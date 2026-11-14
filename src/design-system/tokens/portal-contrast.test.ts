import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TOKENS_DIR = path.join(process.cwd(), "src/design-system/tokens");
const WCAG_AA_BODY = 4.5;

function readDeclarations(file: string) {
  const source = readFileSync(path.join(TOKENS_DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const declarations = new Map<string, string>();
  for (const match of source.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    declarations.set(match[1], match[2].trim());
  }
  return declarations;
}

const tokens = new Map([...readDeclarations("portal.css"), ...readDeclarations("semantic-portal.css")]);

function resolveHex(name: string, seen = new Set<string>()): string {
  const value = tokens.get(name);
  if (!value) {
    throw new Error(`Token ${name} is not declared`);
  }
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  if (reference) {
    if (seen.has(reference[1])) {
      throw new Error(`Token cycle at ${name}`);
    }
    return resolveHex(reference[1], new Set([...seen, name]));
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Token ${name} is not an opaque hex colour: ${value}`);
  }
  return value;
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

const SURFACES = [
  "--surface-canvas",
  "--surface-default",
  "--surface-subtle",
  "--surface-sunken",
  "--surface-overlay",
];

const TEXT_ON_SURFACES = [
  "--text-primary",
  "--text-secondary",
  "--text-tertiary",
  "--text-link",
  "--text-brand",
  "--text-placeholder",
  "--portal-text-soft",
  "--portal-label",
  "--portal-tab-active",
  "--portal-badge-neutral",
];

const FILLED_ACTIONS = [
  "--action-primary",
  "--action-primary-hover",
  "--action-primary-active",
  "--action-danger",
  "--action-danger-hover",
];

describe("portal colour tokens meet WCAG AA", () => {
  for (const text of TEXT_ON_SURFACES) {
    for (const surface of SURFACES) {
      it(`${text} on ${surface}`, () => {
        expect(contrast(resolveHex(text), resolveHex(surface))).toBeGreaterThanOrEqual(WCAG_AA_BODY);
      });
    }
  }

  for (const action of FILLED_ACTIONS) {
    it(`--text-on-brand on ${action}`, () => {
      expect(contrast(resolveHex("--text-on-brand"), resolveHex(action))).toBeGreaterThanOrEqual(
        WCAG_AA_BODY,
      );
    });
  }

  it("--text-on-brand on every stop of the primary gradient", () => {
    const stops = tokens.get("--portal-gradient-primary")?.match(/#[0-9a-f]{6}/gi) ?? [];
    expect(stops.length).toBeGreaterThan(1);
    for (const stop of stops) {
      expect(contrast(resolveHex("--text-on-brand"), stop)).toBeGreaterThanOrEqual(WCAG_AA_BODY);
    }
  });

  it("Overview hero glass pill text on every stop, over the brightest possible scene", () => {
    const portalCss = readFileSync(path.join(process.cwd(), "src/app/qos-portal.css"), "utf8");
    const rule = portalCss.match(/\.qosp-btn\[data-variant="primary"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    const color = rule.match(/(?:^|;|\s)color:\s*([^;]+);/)?.[1].trim() ?? "";
    const reference = color.match(/^var\((--[\w-]+)\)$/);
    const literal = /^#[0-9a-f]{3}$/i.test(color)
      ? `#${[...color.slice(1)].map((digit) => digit + digit).join("")}`
      : color;
    const textHex = reference ? resolveHex(reference[1]) : literal;
    expect(textHex).toMatch(/^#[0-9a-f]{6}$/i);

    const background = rule.match(/background:\s*([^;]+);/)?.[1] ?? "";
    const tint = background.match(/radial-gradient\([^,]+,\s*(#[0-9a-f]{8})/i)?.[1];
    const stops = background.match(/linear-gradient\(([^)]*)\)/)?.[1].match(/#[0-9a-f]{6,8}\b/gi) ?? [];
    expect(stops.length).toBeGreaterThan(1);

    const rgba = (hex: string) => [1, 3, 5, 7].map((offset, index) =>
      index === 3 && hex.length === 7 ? 1 : Number.parseInt(hex.slice(offset, offset + 2), 16) / (index === 3 ? 255 : 1),
    );
    const over = (top: string, bottom: string) => {
      const [r, g, b, a] = rgba(top);
      const base = rgba(bottom);
      return `#${[r, g, b].map((channel, index) =>
        Math.round(channel * a + base[index] * (1 - a)).toString(16).padStart(2, "0"),
      ).join("")}`;
    };

    for (const stop of stops) {
      const pill = over(stop, "#ffffff");
      const surface = tint ? over(tint, pill) : pill;
      expect(contrast(textHex, surface)).toBeGreaterThanOrEqual(WCAG_AA_BODY);
    }
  });
});
