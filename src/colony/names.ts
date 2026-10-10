// Names for colony bees: short, buzzy, never one of the three official bees' names. A name taken by a living bee
// gets the next roman numeral ("Pollen II").
import type { Rng } from "./genome.js";

const NAMES = [
  "Pollen", "Nectar", "Clover", "Thistle", "Marigold", "Saffron", "Juniper", "Basil", "Fennel", "Sorrel",
  "Hazel", "Willow", "Aster", "Poppy", "Tansy", "Yarrow", "Borage", "Lupin", "Heather", "Sage",
  "Comb", "Waxy", "Stinger", "Drone", "Humm", "Zuzu", "Bumble", "Fizz", "Whirr", "Dizzy",
  "Sunny", "Amber", "Honeydew", "Mead", "Propolis", "Jelly", "Buttercup", "Dandelion", "Lavender", "Mallow",
  "Pip", "Nib", "Zing", "Glim", "Rumble", "Dart", "Flick", "Scout", "Forager", "Nurse",
] as const;

const ROMAN = ["", " II", " III", " IV", " V", " VI", " VII", " VIII", " IX", " X"];

export function beeName(seq: number, rng: Rng, taken: Set<string>): string {
  const base = NAMES[Math.floor(rng() * NAMES.length)]!;
  for (const r of ROMAN) if (!taken.has(base + r)) return base + r;
  return `${base} #${seq}`;
}
