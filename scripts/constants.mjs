export const MODULE_ID = "zintharion-dnd5e";

/** XP total exigido para cada nível (índice 0 = nível 1). Tabela oficial de Zintharion (30 níveis). */
export const DEFAULT_XP_TABLE = [
  0, 500, 1000, 2500, 4500, 8000, 12500, 20500, 33000, 53500,
  86500, 140000, 300000, 400000, 600000, 1000000, 2000000, 3000000, 5000000, 7000000,
  11000000, 18000000, 28000000, 46000000, 72000000, 120000000, 200000000, 310000000, 500000000, 800000000
];

/** Tabela padrão anterior (D&D oficial + 21–30 provisórios). Mundos com ela salva são migrados para a nova. */
export const LEGACY_XP_TABLE = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
  85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
  405000, 455000, 505000, 555000, 605000, 655000, 705000, 755000, 805000, 855000
];

/** Ranks: cada um começa em `min` e vai até o nível anterior ao próximo rank. */
export const DEFAULT_RANK_TABLE = [
  { min: 1,  rank: "F",  bg: "#D9D9D9", fg: "#0A1A24" },
  { min: 4,  rank: "E",  bg: "#F4B183", fg: "#0A1A24" },
  { min: 7,  rank: "D",  bg: "#595959", fg: "#F5F0E4" },
  { min: 10, rank: "C",  bg: "#F2E500", fg: "#0A1A24" },
  { min: 13, rank: "B",  bg: "#4A7C8C", fg: "#F5F0E4" },
  { min: 16, rank: "A",  bg: "#2ECC40", fg: "#0A1A24" },
  { min: 19, rank: "S",  bg: "#B01818", fg: "#F5F0E4" },
  { min: 21, rank: "SS", bg: "#00E5E5", fg: "#0A1A24" },
  { min: 26, rank: "X",  bg: "#3B2A7A", fg: "#F5F0E4" },
  { min: 31, rank: "Ω",  bg: "#5A0F24", fg: "#F5F0E4" }
];

/** Diamante Astral: 1 DA = 10.000 PO. Conversão do dnd5e é "quantas desta moeda valem 1 PO". */
export const ASTRAL_DIAMOND = {
  key: "da",
  gpValue: 10000
};
