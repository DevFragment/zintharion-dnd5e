import { MODULE_ID, DEFAULT_RANK_TABLE } from "./constants.mjs";

/** Tabela de ranks salva, ordenada pelo nível inicial. */
export function getRankTable() {
  let table;
  try {
    table = game.settings.get(MODULE_ID, "rankTable")?.ranks;
  } catch {
    table = null;
  }
  if ( !Array.isArray(table) || !table.length ) table = DEFAULT_RANK_TABLE;
  return [...table].sort((a, b) => a.min - b.min);
}

/**
 * Rank correspondente a um nível de personagem.
 * @param {number} level
 * @returns {{min:number, rank:string, bg:string, fg:string}}
 */
export function getRank(level) {
  const table = getRankTable();
  let result = table[0];
  for ( const entry of table ) {
    if ( level >= entry.min ) result = entry;
  }
  if ( !result ) return result;
  return { ...result, img: result.img || getDetectedEmblem(result.rank) || getBuiltinEmblem(result.rank) || "" };
}

/* -------------------------------------------- */
/*  Emblemas                                    */
/* -------------------------------------------- */

/** Pasta (dentro de Data) onde o Mestre coloca as imagens dos emblemas. */
export const EMBLEM_FOLDER = "assets/zintharion/ranks";

const IMAGE_EXTENSIONS = [".png", ".webp", ".jpg", ".jpeg", ".svg", ".avif", ".gif"];

/** Normaliza nomes: "Rank-SS.png" → "ss", "omega.webp" → "ω". */
function normalizeRankKey(name) {
  let key = String(name ?? "").trim().toLowerCase();
  key = key.replace(/\.[a-z0-9]+$/, "");
  key = key.replace(/^rank[\s_-]*/, "");
  if ( ["omega", "ômega", "Ω".toLowerCase()].includes(key) ) key = "ω";
  return key;
}

/** Emblemas que já vêm com o módulo (usados quando a pasta do mundo não tem um). */
const BUILTIN_EMBLEMS = {
  f: "f", e: "e", d: "d", c: "c", b: "b", a: "a", s: "s", ss: "ss", x: "x", "ω": "omega"
};

/** Emblema padrão do módulo para um rank, se existir. */
export function getBuiltinEmblem(rank) {
  const file = BUILTIN_EMBLEMS[normalizeRankKey(rank)];
  return file ? `modules/${MODULE_ID}/assets/ranks/${file}.png` : null;
}

/** Emblema encontrado automaticamente na pasta para um rank. */
export function getDetectedEmblem(rank) {
  let map;
  try {
    map = game.settings.get(MODULE_ID, "rankEmblems") ?? {};
  } catch {
    map = {};
  }
  return map[normalizeRankKey(rank)] ?? null;
}

/**
 * (Só GM) Procura imagens na pasta de emblemas e salva o mapa rank → imagem.
 * Nome do arquivo = rank. Ex.: F.png, SS.webp, omega.png.
 * @param {object} [options]
 * @param {boolean} [options.notify=false]  Mostrar aviso com o resultado.
 */
export async function detectRankEmblems({ notify=false }={}) {
  if ( !game.user.isGM ) return null;
  const FP = foundry.applications.apps.FilePicker.implementation;
  let files = [];
  try {
    const result = await FP.browse("data", EMBLEM_FOLDER);
    files = result.files ?? [];
  } catch (err) {
    console.warn(`${MODULE_ID} | Pasta de emblemas não encontrada: ${EMBLEM_FOLDER}`, err);
  }
  const map = {};
  for ( const path of files ) {
    const file = decodeURIComponent(path.split("/").pop());
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    if ( !IMAGE_EXTENSIONS.includes(ext) ) continue;
    map[normalizeRankKey(file)] = path;
  }
  const current = game.settings.get(MODULE_ID, "rankEmblems") ?? {};
  if ( JSON.stringify(current) !== JSON.stringify(map) ) {
    await game.settings.set(MODULE_ID, "rankEmblems", map);
  }
  if ( notify ) {
    const found = getRankTable().filter(r => map[normalizeRankKey(r.rank)]).map(r => r.rank);
    ui.notifications.info(game.i18n.format("ZINTHARION.Ranks.EmblemsFound", {
      count: found.length, list: found.join(", ") || "—", folder: EMBLEM_FOLDER
    }));
  }
  return map;
}

/**
 * Guarda o rank atual numa flag do ator, para outros sistemas (ex.: sincronização com o site) lerem.
 * @param {Actor} actor
 */
export async function syncRankFlag(actor) {
  if ( actor?.type !== "character" || !actor.isOwner ) return;
  const level = actor.system?.details?.level ?? 0;
  const rank = getRank(level)?.rank ?? null;
  if ( actor.getFlag(MODULE_ID, "rank") === rank ) return;
  await actor.setFlag(MODULE_ID, "rank", rank);
}

/** Registra os hooks que mantêm a flag de rank atualizada. */
export function registerRankHooks() {
  const onItemChange = (item, _data, _options, userId) => {
    if ( userId !== game.user.id ) return;
    if ( item.type !== "class" ) return;
    syncRankFlag(item.parent);
  };
  Hooks.on("createItem", (item, options, userId) => onItemChange(item, null, options, userId));
  Hooks.on("updateItem", onItemChange);
  Hooks.on("deleteItem", (item, options, userId) => onItemChange(item, null, options, userId));
}
