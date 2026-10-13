export const COLORS = ["butter", "peach", "rose", "lilac", "sky", "mint", "sage", "stone"] as const;
export type ColorId = (typeof COLORS)[number];

export const COLOR_NAMES: Record<ColorId, string> = {
  butter: "Butter",
  peach: "Peach",
  rose: "Rose",
  lilac: "Lilac",
  sky: "Sky",
  mint: "Mint",
  sage: "Sage",
  stone: "Stone",
};

export function nextColor(c: ColorId): ColorId {
  return COLORS[(COLORS.indexOf(c) + 1) % COLORS.length];
}
