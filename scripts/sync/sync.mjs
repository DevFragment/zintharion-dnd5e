/**
 * Enviar (Foundry → site) e Receber (site → Foundry).
 *
 * O vínculo fica no ator: flags["zintharion-dnd5e"].site.characterId.
 * Itens vindos do site levam flags["zintharion-dnd5e"].siteItemId.
 */
import { MODULE_ID } from "../constants.mjs";
import { siteRequest, SiteError } from "./api.mjs";
import {
  DETAIL_FIELDS, PHYSICAL_TYPES, actorFields, actorUpdateFromFields, htmlToText, itemKey, mergeFields, siteItemIdOf
} from "./fields.mjs";
import { buildSummary } from "./summary.mjs";

const { DialogV2 } = foundry.applications.api;
const i18n = (key, data) => (data ? game.i18n.format(`ZINTHARION.Sync.${key}`, data) : game.i18n.localize(`ZINTHARION.Sync.${key}`));
const escape = s => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "").replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

export const getLink = actor => actor?.getFlag(MODULE_ID, "site") ?? null;

async function setLink(actor, patch) {
  const current = getLink(actor) ?? {};
  await actor.setFlag(MODULE_ID, "site", { ...current, ...patch });
}

/* -------------------------------------------- */
/*  Escolher a ficha do site                    */
/* -------------------------------------------- */

/** Lista as fichas do site que o usuário pode sincronizar. */
export async function listSiteCharacters() {
  const { characters } = await siteRequest("/api/foundry/characters");
  return characters ?? [];
}

/** Pede para o usuário escolher a ficha do site correspondente ao ator. */
async function chooseSiteCharacter(actor) {
  const characters = await listSiteCharacters();
  if ( !characters.length ) {
    ui.notifications.warn(i18n("NoCharacters"));
    return null;
  }
  const guess = characters.find(c => c.name.toLowerCase() === actor.name.toLowerCase());
  const options = characters.map(c => {
    const linked = c.foundryActorId ? ` — ${i18n("AlreadyLinked")}` : "";
    const selected = (c.id === guess?.id) ? "selected" : "";
    return `<option value="${c.id}" ${selected}>${escape(c.name)} (${escape(c.owner)}, ${escape(c.class || "?")} ${c.level})${linked}</option>`;
  }).join("");

  const id = await DialogV2.prompt({
    window: { title: i18n("ChooseTitle"), icon: "fa-solid fa-link" },
    content: `<p>${i18n("ChooseHint", { name: escape(actor.name) })}</p>
      <div class="form-group"><select name="characterId">${options}</select></div>`,
    ok: { label: i18n("Link"), callback: (_event, button) => button.form.elements.characterId.value },
    rejectClose: false
  });
  if ( !id ) return null;
  await setLink(actor, { characterId: id });
  return id;
}

async function ensureLink(actor) {
  return getLink(actor)?.characterId ?? chooseSiteCharacter(actor);
}

async function confirm(title, content) {
  return DialogV2.confirm({ window: { title }, content, rejectClose: false });
}

/** Refaz a chamada com force=1 se o site disser que a ficha está ligada a outro ator. */
async function withLinkConflict(fn, { force=false }={}) {
  // Importar já é a escolha de trazer a ficha para este mundo: não pergunta de novo.
  if ( force ) return fn(true);
  try {
    return await fn(false);
  } catch (err) {
    if ( !(err instanceof SiteError) || (err.status !== 409) ) throw err;
    const ok = await confirm(i18n("ConflictTitle"), `<p>${i18n("ConflictHint")}</p>`);
    if ( !ok ) return null;
    return fn(true);
  }
}

/* -------------------------------------------- */
/*  Receber                                     */
/* -------------------------------------------- */

const ITEM_TYPES = {
  WEAPON: { type: "weapon" },
  ARMOR: { type: "equipment", system: { type: { value: "medium" } } },
  POTION: { type: "consumable", system: { type: { value: "potion" } } },
  SCROLL: { type: "consumable", system: { type: { value: "scroll" } } },
  TOOL: { type: "tool" },
  TREASURE: { type: "loot", system: { type: { value: "treasure" } } },
  CONSUMABLE: { type: "consumable" },
  WONDROUS: { type: "equipment", system: { type: { value: "trinket" } } },
  OTHER: { type: "loot" }
};
const RARITY = {
  COMMON: "common", UNCOMMON: "uncommon", RARE: "rare", VERY_RARE: "veryRare", LEGENDARY: "legendary", ARTIFACT: "artifact"
};

let itemIndexCache = null;

/** Procura um item pelo nome nos itens do mundo e nos compêndios de itens. */
async function findItemByName(name) {
  const target = name.trim().toLowerCase();
  const world = game.items.find(i => (i.name.toLowerCase() === target) && PHYSICAL_TYPES.includes(i.type));
  if ( world ) return world.toObject();

  if ( !itemIndexCache ) {
    itemIndexCache = [];
    // Compêndios do mundo primeiro, depois os do sistema (2024 antes de 2014).
    const packs = game.packs.filter(p => p.documentName === "Item")
      .sort((a, b) => {
        const rank = p => (p.metadata.packageType === "world" ? 0 : p.collection.endsWith("24") ? 1 : 2);
        return rank(a) - rank(b);
      });
    for ( const pack of packs ) {
      try {
        const index = await pack.getIndex({ fields: ["type"] });
        for ( const entry of index ) {
          if ( PHYSICAL_TYPES.includes(entry.type) ) itemIndexCache.push({ pack, id: entry._id, name: entry.name.toLowerCase() });
        }
      } catch (err) {
        console.warn(`${MODULE_ID} | Índice do compêndio ${pack.collection}`, err);
      }
    }
  }
  const hit = itemIndexCache.find(e => e.name === target);
  if ( !hit ) return null;
  const doc = await hit.pack.getDocument(hit.id);
  return doc ? game.items.fromCompendium(doc) : null;
}

/** Dados de um item novo no ator, a partir de um item do site. */
async function itemDataFromSite(siteItem) {
  let data = await findItemByName(siteItem.name);
  if ( !data ) {
    const base = ITEM_TYPES[siteItem.type] ?? ITEM_TYPES.OTHER;
    data = foundry.utils.mergeObject({
      name: siteItem.name,
      type: base.type,
      img: siteItem.img || undefined,
      system: {
        description: { value: siteItem.description ? `<p>${escape(siteItem.description).replace(/\n/g, "<br>")}</p>` : "" },
        rarity: RARITY[siteItem.rarity] ?? "",
        weight: siteItem.weight ? { value: siteItem.weight, units: "lb" } : undefined,
        price: siteItem.priceGp ? { value: siteItem.priceGp, denomination: "gp" } : undefined,
        attunement: siteItem.requiresAttunement ? "required" : ""
      }
    }, base.system ? { system: base.system } : {});
  }
  delete data._id;
  foundry.utils.mergeObject(data, {
    system: { quantity: siteItem.quantity, equipped: !!siteItem.equipped, attuned: !!siteItem.attuned },
    flags: { [MODULE_ID]: { siteItemId: siteItem.id } }
  });
  return data;
}

/** Aplica o "Receber" no ator e confirma para o site. */
export async function pullActor(actor, { silent=false, force=false }={}) {
  const characterId = await ensureLink(actor);
  if ( !characterId ) return false;

  const data = await withLinkConflict(force => siteRequest(`/api/foundry/characters/${characterId}/pull`, {
    query: { actorId: actor.id, worldId: game.world.id, force: force ? 1 : undefined }
  }), { force });
  if ( !data ) return false;

  let hasClass = actor.items.some(i => i.type === "class");

  // O site guarda a ficha completa do último envio. Se este ator não é o que enviou
  // (outro mundo, ator novo) ou está vazio, restaura a ficha inteira antes de mesclar.
  const sameActor = (data.character.foundryActorId === actor.id) && (data.character.foundryWorldId === game.world.id);
  let restored = false;
  if ( data.source && (!hasClass || !sameActor) ) {
    if ( hasClass && !silent ) {
      const ok = await confirm(i18n("RestoreTitle"), `<p>${i18n("RestoreHint", { name: escape(actor.name), site: escape(data.character.name) })}</p>`);
      if ( !ok ) return false;
    }
    await restoreFromSource(actor, data.source);
    hasClass = actor.items.some(i => i.type === "class");
    restored = true;
  }

  if ( data.firstSync && !restored ) {
    // Ficha já montada no Foundry: o Foundry vale. Primeiro envia, depois sincroniza normalmente.
    if ( hasClass ) {
      const ok = await confirm(i18n("ConfiguredTitle"), `<p>${i18n("ConfiguredHint", { name: escape(actor.name) })}</p>`);
      return ok ? pushActor(actor) : false;
    }
    // Ficha nova: nasce "nível 0" e é montada no Foundry.
    return createFromSite(actor, characterId, data, { silent });
  }

  const current = actorFields(actor);
  const { next, changed } = mergeFields(current, data.fields, data.baseline);

  // Ficha e dinheiro
  const update = actorUpdateFromFields(actor, next, changed);
  if ( !foundry.utils.isEmpty(update) ) await actor.update(update);

  // Itens
  const itemMap = await applySiteItems(actor, data, next, changed);

  await siteRequest(`/api/foundry/characters/${characterId}/ack`, {
    method: "POST",
    body: {
      token: data.token,
      actorId: actor.id,
      worldId: game.world.id,
      modifiedTime: actor._stats?.modifiedTime ?? null,
      itemMap
    }
  });
  await setLink(actor, { characterId, lastPullAt: Date.now() });

  const count = changed.length;
  if ( restored ) ui.notifications.info(i18n("Restored", { name: actor.name, count }));
  else if ( !silent ) ui.notifications.info(count ? i18n("PullDone", { name: actor.name, count }) : i18n("PullNothing", { name: actor.name }));
  return true;
}

/** Descomprime o ator completo que o site manda (gzip + base64). */
async function unpackSource(source) {
  if ( source.encoding !== "gzip-base64" ) throw new Error(`Formato de ficha desconhecido: ${source.encoding}`);
  const bytes = Uint8Array.from(atob(source.data), c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

/**
 * Substitui o ator pela ficha completa salva no site: classe, subclasse, espécie, antecedente,
 * características, magias, equipamento, efeitos, recursos, flags de módulos (Plutonium etc.).
 * Mantém o que é deste mundo: id, dono, pasta e vínculo com o site.
 */
async function restoreFromSource(actor, source) {
  const json = JSON.parse(await unpackSource(source));
  delete json._id;
  delete json.ownership;
  delete json.folder;
  delete json.sort;
  delete json._stats;
  if ( json.flags?.[MODULE_ID] ) {
    delete json.flags[MODULE_ID].site;
    delete json.flags[MODULE_ID].pendingBuild;
  }
  const link = getLink(actor);
  // importFromJSON migra os dados para a versão do sistema e aplica tudo de uma vez (itens e efeitos inclusos).
  await actor.importFromJSON(JSON.stringify(json));
  if ( link ) await actor.setFlag(MODULE_ID, "site", link);
}

/** Campos que uma ficha nova recebe do site: identidade e textos. O resto se monta no Foundry. */
const CREATION_FIELDS = ["name", "portrait", "biography", ...DETAIL_FIELDS];

/**
 * Primeira vez de uma ficha que ainda não tem classe no Foundry: cria "nível 0".
 * Atributos, perícias, XP, dinheiro e itens NÃO são aplicados; a pessoa monta tudo pelo Plutonium.
 * A base no site continua vazia, então o primeiro "Enviar" faz o site copiar a ficha montada.
 */
async function createFromSite(actor, characterId, data, { silent=false }={}) {
  const current = actorFields(actor);
  const changed = CREATION_FIELDS.filter(key => (key in data.fields) && (data.fields[key] !== current[key]));
  const update = actorUpdateFromFields(actor, data.fields, changed);

  // Referência do que foi escolhido no site (aviso na ficha). O XP entra quando a classe for importada.
  const character = data.character;
  update[`flags.${MODULE_ID}.pendingBuild`] = {
    ...(character.build ?? { classes: [] }),
    xp: Number(data.fields.xp) || 0,
    level: character.level ?? null,
    legacy: character.build ? null : { class: character.class || null, race: character.race || null, background: character.background || null }
  };
  await actor.update(update);

  await siteRequest(`/api/foundry/characters/${characterId}/ack`, {
    method: "POST",
    body: { token: data.token, actorId: actor.id, worldId: game.world.id, creation: true, itemMap: {} }
  });
  await setLink(actor, { characterId, lastPullAt: Date.now() });
  if ( !silent ) ui.notifications.info(i18n("CreatedLevel0", { name: actor.name }));
  return true;
}

/**
 * Cria, atualiza ou remove os itens vindos do site.
 * @returns {Record<string, string>} id do item no site → id no Foundry (itens presentes no ator).
 */
async function applySiteItems(actor, data, next, changed) {
  const bySiteId = new Map();
  for ( const item of actor.items ) {
    const sid = siteItemIdOf(item);
    if ( sid ) bySiteId.set(sid, item);
  }
  // Itens que o site já conhece pelo id do Foundry, mas sem a marca no ator.
  for ( const siteItem of data.items ) {
    if ( bySiteId.has(siteItem.id) || !siteItem.foundryItemId ) continue;
    const item = actor.items.get(siteItem.foundryItemId);
    if ( item ) bySiteId.set(siteItem.id, item);
  }
  // Primeira vez: liga itens de mesmo nome em vez de duplicar.
  if ( data.firstSync ) {
    const taken = new Set([...bySiteId.values()].map(i => i.id));
    for ( const siteItem of data.items ) {
      if ( bySiteId.has(siteItem.id) ) continue;
      const item = actor.items.find(i => !taken.has(i.id) && PHYSICAL_TYPES.includes(i.type) && !siteItemIdOf(i)
        && (i.name.toLowerCase() === siteItem.name.toLowerCase()));
      if ( item ) {
        bySiteId.set(siteItem.id, item);
        taken.add(item.id);
      }
    }
  }

  const changedSet = new Set(changed);
  const updates = [];
  const deletions = [];
  const creations = [];
  const siteIds = new Set([...data.items.map(i => i.id), ...Object.keys(next).map(k => /^item\.([^.]+)\.qty$/.exec(k)?.[1]).filter(Boolean)]);

  for ( const sid of siteIds ) {
    const qtyKey = itemKey(sid, "qty");
    if ( !(qtyKey in next) ) continue;
    const qty = Math.max(0, Math.round(Number(next[qtyKey]) || 0));
    const item = bySiteId.get(sid);
    const siteItem = data.items.find(i => i.id === sid);

    if ( item ) {
      if ( qty <= 0 ) {
        if ( changedSet.has(qtyKey) ) deletions.push(item.id);
        continue;
      }
      const patch = { _id: item.id };
      if ( siteItemIdOf(item) !== sid ) patch[`flags.${MODULE_ID}.siteItemId`] = sid;
      if ( changedSet.has(qtyKey) || (data.firstSync && (item._source.system.quantity !== qty)) ) patch["system.quantity"] = qty;
      for ( const prop of ["equipped", "attuned"] ) {
        const key = itemKey(sid, prop);
        if ( changedSet.has(key) ) patch[`system.${prop}`] = !!next[key];
      }
      if ( Object.keys(patch).length > 1 ) updates.push(patch);
    } else if ( (qty > 0) && siteItem ) {
      creations.push(await itemDataFromSite({ ...siteItem, quantity: qty }));
    }
  }

  if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
  if ( deletions.length ) await actor.deleteEmbeddedDocuments("Item", deletions);
  if ( creations.length ) await actor.createEmbeddedDocuments("Item", creations);

  const itemMap = {};
  for ( const item of actor.items ) {
    const sid = siteItemIdOf(item);
    if ( sid ) itemMap[sid] = item.id;
  }
  return itemMap;
}

/* -------------------------------------------- */
/*  Enviar                                      */
/* -------------------------------------------- */

/** Pacote enviado ao site: campos salvos, itens novos, resumo calculado, ator completo e controle. */
export function buildEnvelope(actor) {
  const newItems = actor.items
    .filter(i => PHYSICAL_TYPES.includes(i.type) && !siteItemIdOf(i) && (i.system.type?.value !== "natural"))
    .map(i => ({
      foundryItemId: i.id,
      name: i.name,
      type: i.type,
      quantity: Number(i._source.system.quantity ?? 1) || 0,
      equipped: !!i._source.system.equipped,
      attuned: !!i._source.system.attuned,
      description: htmlToText(i._source.system.description?.value ?? "").slice(0, 1000)
    }));

  return {
    control: {
      actorId: actor.id,
      worldId: game.world.id,
      worldTitle: game.world.title,
      foundryUser: game.user.name,
      foundryVersion: game.version,
      systemVersion: game.system.version,
      moduleVersion: game.modules.get(MODULE_ID)?.version ?? null,
      modifiedTime: actor._stats?.modifiedTime ?? null,
      exportedAt: new Date().toISOString()
    },
    fields: actorFields(actor),
    newItems,
    summary: buildSummary(actor),
    source: actor.toObject()
  };
}

export async function pushActor(actor, { silent=false }={}) {
  const characterId = await ensureLink(actor);
  if ( !characterId ) return false;

  const envelope = buildEnvelope(actor);
  const result = await withLinkConflict(force => siteRequest(`/api/foundry/characters/${characterId}/push`, {
    method: "POST",
    body: { ...envelope, force }
  }));
  if ( !result ) return false;

  if ( result.status === "applied" ) {
    // Marca os itens novos com o id que ganharam no site.
    const updates = Object.entries(result.itemLinks ?? {})
      .filter(([fid, sid]) => actor.items.get(fid) && (siteItemIdOf(actor.items.get(fid)) !== sid))
      .map(([fid, sid]) => ({ _id: fid, [`flags.${MODULE_ID}.siteItemId`]: sid }));
    if ( updates.length ) await actor.updateEmbeddedDocuments("Item", updates);
    await setLink(actor, { characterId, lastPushAt: Date.now() });
    if ( !silent ) ui.notifications.info(i18n("PushApplied", { name: actor.name, count: result.changed?.length ?? 0 }));
  } else {
    await setLink(actor, { characterId, lastPushAt: Date.now() });
    if ( !silent ) ui.notifications.info(i18n("PushPending", { name: actor.name }));
  }
  return true;
}

/* -------------------------------------------- */
/*  Ficha nova a partir do site                 */
/* -------------------------------------------- */

/** (GM) Cria um ator para uma ficha do site e faz o primeiro "Receber". */
export async function importSiteCharacter(siteCharacter) {
  const players = game.users.filter(u => !u.isGM);
  const guess = players.find(u => u.name.toLowerCase() === String(siteCharacter.owner ?? "").toLowerCase());
  const options = [`<option value="">${i18n("NoOwner")}</option>`,
    ...players.map(u => `<option value="${u.id}" ${u.id === guess?.id ? "selected" : ""}>${escape(u.name)}</option>`)].join("");

  const ownerId = await DialogV2.prompt({
    window: { title: i18n("ImportTitle", { name: siteCharacter.name }), icon: "fa-solid fa-user-plus" },
    content: `<p>${i18n("ImportHint")}</p><div class="form-group"><label>${i18n("Owner")}</label><select name="owner">${options}</select></div>`,
    ok: { label: i18n("Import"), callback: (_event, button) => button.form.elements.owner.value ?? "" },
    rejectClose: false
  });
  if ( ownerId === null || ownerId === undefined ) return null;

  const img = siteCharacter.portraitUrl || undefined;
  const actor = await Actor.implementation.create({
    name: siteCharacter.name,
    type: "character",
    img,
    ownership: ownerId ? { default: 0, [ownerId]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } : { default: 0 },
    prototypeToken: { actorLink: true, sight: { enabled: true }, texture: img ? { src: img } : undefined },
    flags: { [MODULE_ID]: { site: { characterId: siteCharacter.id } } }
  });
  if ( !actor ) return null;
  // O ator acabou de ser criado vazio: se o "Receber" falhar, avisa em vez de deixar parecer "nível 0".
  try {
    await pullActor(actor, { silent: true, force: true });
  } catch (err) {
    ui.notifications.error(i18n("ImportPullFailed", { name: actor.name, error: err.message }));
    throw err;
  }
  ui.notifications.info(i18n("Imported", { name: actor.name }));
  actor.sheet.render(true);
  return actor;
}
