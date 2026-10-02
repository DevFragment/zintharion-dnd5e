import { MODULE_ID, DEFAULT_XP_TABLE, LEGACY_XP_TABLE } from "./constants.mjs";

/** Tabela de XP salva (índice 0 = nível 1). */
export function getXpTable() {
  let table;
  try {
    table = game.settings.get(MODULE_ID, "xpTable")?.levels;
  } catch {
    table = null;
  }
  if ( !Array.isArray(table) || !table.length ) table = DEFAULT_XP_TABLE;
  return table.map(n => Math.max(0, Math.floor(Number(n) || 0)));
}

/**
 * Aplica a tabela de XP ao sistema dnd5e.
 * O número de níveis da tabela passa a ser o nível máximo do mundo.
 */
export function applyProgression() {
  const table = getXpTable();
  CONFIG.DND5E.CHARACTER_EXP_LEVELS = [...table];
  CONFIG.DND5E.maxLevel = table.length;
}

/** Recalcula os dados dos personagens para a barra de XP refletir a tabela nova. */
export function refreshActorsProgression() {
  for ( const actor of game.actors ?? [] ) {
    if ( actor.type !== "character" ) continue;
    actor.reset();
  }
}

/**
 * (GM) Mundos que ainda têm a tabela padrão antiga salva passam para a tabela de Zintharion.
 * Tabelas editadas à mão pelo mestre não são tocadas.
 */
export async function migrateXpTable() {
  if ( !game.user.isGM ) return;
  const saved = game.settings.get(MODULE_ID, "xpTable")?.levels;
  if ( !Array.isArray(saved) ) return;
  const same = (a, b) => (a.length === b.length) && a.every((n, i) => Number(n) === b[i]);
  if ( !same(saved, LEGACY_XP_TABLE) ) return;
  await game.settings.set(MODULE_ID, "xpTable", { levels: [...DEFAULT_XP_TABLE] });
  console.log(`${MODULE_ID} | Tabela de XP atualizada para a tabela de Zintharion.`);
}
