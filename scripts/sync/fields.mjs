/**
 * Campos sincronizados entre o Foundry e o site, no formato "mapa plano" (chave → valor).
 *
 * ESTE ARQUIVO TEM UM GÊMEO NO SITE: src/lib/foundry/fields.ts.
 * As regras de mesclagem precisam ser iguais dos dois lados.
 *
 * Mesclagem de três vias: compara o que chegou com a BASE (último estado combinado).
 * - Somáveis (XP, dinheiro em cobre, quantidade de itens): aplica a diferença.
 * - Demais: se mudou em relação à base, o valor novo substitui.
 */
import { MODULE_ID } from "../constants.mjs";

export const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

/** Campos de texto guardados em system.details (biography é tratado à parte, é HTML). */
export const DETAIL_FIELDS = [
  "alignment", "age", "height", "weight", "gender", "eyes", "hair", "skin", "faith",
  "appearance", "trait", "ideal", "bond", "flaw"
];

/** Tipos de item que contam como inventário (vão para o site). */
export const PHYSICAL_TYPES = ["weapon", "equipment", "consumable", "tool", "loot", "container"];

export const isItemQtyKey = key => /^item\.[^.]+\.qty$/.test(key);
export const isAdditiveKey = key => (key === "xp") || (key === "copper") || isItemQtyKey(key);
export const itemKey = (siteItemId, prop) => `item.${siteItemId}.${prop}`;

export function normalizeValue(value) {
  if ( (value === undefined) || (value === null) ) return null;
  if ( typeof value === "string" ) {
    const text = value.replace(/\r\n?/g, "\n").trim();
    return text === "" ? null : text;
  }
  if ( typeof value === "number" ) return Number.isFinite(value) ? value : null;
  if ( typeof value === "boolean" ) return value;
  return String(value);
}

const num = value => Number(value ?? 0) || 0;
const same = (a, b) => normalizeValue(a) === normalizeValue(b);

/**
 * Aplica em `target` o que mudou em `incoming` desde `base`.
 * @param {object} target
 * @param {object} incoming
 * @param {object|null} base   Base do envio; vazia/null = primeira sincronização (substitui tudo).
 * @returns {{next: object, changed: string[]}}
 */
export function mergeFields(target, incoming, base) {
  const firstSync = !base || !Object.keys(base).length;
  const next = { ...target };
  const changed = [];

  const keys = new Set(Object.keys(incoming));
  if ( !firstSync ) for ( const key of Object.keys(base) ) if ( isItemQtyKey(key) ) keys.add(key);

  for ( const key of keys ) {
    const value = (key in incoming) ? normalizeValue(incoming[key]) : (isItemQtyKey(key) ? 0 : undefined);
    if ( value === undefined ) continue;

    if ( firstSync ) {
      if ( !same(next[key], value) ) changed.push(key);
      next[key] = value;
      continue;
    }

    if ( isAdditiveKey(key) ) {
      const delta = num(value) - num(base[key]);
      if ( !delta ) continue;
      next[key] = Math.max(0, num(target[key]) + delta);
      changed.push(key);
      continue;
    }

    if ( (key in base) && same(value, base[key]) ) continue;
    if ( !same(next[key], value) ) changed.push(key);
    next[key] = value;
  }
  return { next, changed };
}

/* -------------------------------------------- */
/*  Texto ⇄ HTML (biografia)                    */
/* -------------------------------------------- */

export function htmlToText(html) {
  if ( !html ) return "";
  const withBreaks = String(html)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, "\n\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

export function textToHtml(text) {
  if ( !text ) return "";
  const escape = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return String(text).split(/\n{2,}/)
    .map(par => `<p>${escape(par).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/* -------------------------------------------- */
/*  Dinheiro                                    */
/* -------------------------------------------- */

/** Valor de 1 moeda em peças de cobre, pelas conversões do sistema (inclui o Diamante Astral). */
export function coinValueInCopper(key) {
  const currencies = CONFIG.DND5E.currencies;
  const cpPerGp = currencies.cp?.conversion ?? 100;
  const conversion = currencies[key]?.conversion;
  return conversion ? Math.round(cpPerGp / conversion) : 0;
}

export function currencyToCopper(currency={}) {
  let total = 0;
  for ( const key of Object.keys(CONFIG.DND5E.currencies) ) total += num(currency[key]) * coinValueInCopper(key);
  return total;
}

/**
 * Novas moedas para chegar ao total pedido, mexendo o mínimo nas moedas do jogador:
 * guarda as moedas maiores que cabem e faz o troco em PO/PP/PC.
 */
export function currencyForTotal(currency, totalCopper) {
  const keys = Object.keys(CONFIG.DND5E.currencies).sort((a, b) => coinValueInCopper(b) - coinValueInCopper(a));
  let remaining = Math.max(0, Math.round(totalCopper));
  const result = {};
  for ( const key of keys ) {
    const value = coinValueInCopper(key);
    const keep = value ? Math.min(num(currency[key]), Math.floor(remaining / value)) : 0;
    result[key] = keep;
    remaining -= keep * value;
  }
  // Troco em ouro, prata e cobre.
  for ( const key of ["gp", "sp", "cp"] ) {
    const value = coinValueInCopper(key);
    if ( !value ) continue;
    const add = Math.floor(remaining / value);
    result[key] = (result[key] ?? 0) + add;
    remaining -= add * value;
  }
  return result;
}

/* -------------------------------------------- */
/*  Ator → mapa                                 */
/* -------------------------------------------- */

export const siteItemIdOf = item => item.getFlag(MODULE_ID, "siteItemId") ?? null;
const isWebUrl = value => (typeof value === "string") && /^https?:\/\//i.test(value);

/** Estado salvo do ator (não o calculado) no formato do mapa plano. */
export function actorFields(actor) {
  const src = actor._source.system;
  const details = src.details ?? {};
  const fields = {
    name: actor._source.name,
    xp: num(details.xp?.value),
    copper: currencyToCopper(src.currency)
  };
  for ( const key of ABILITY_KEYS ) fields[`abilities.${key}`] = num(src.abilities?.[key]?.value);
  for ( const key of DETAIL_FIELDS ) fields[key] = normalizeValue(details[key]);
  fields.biography = normalizeValue(htmlToText(details.biography?.value));
  // Retrato só vai para o site se for um endereço da internet (caminhos do Foundry o site não abre).
  if ( isWebUrl(actor._source.img) ) fields.portrait = actor._source.img;

  for ( const item of actor.items ) {
    const sid = siteItemIdOf(item);
    if ( !sid ) continue;
    fields[itemKey(sid, "qty")] = num(item._source.system.quantity ?? 1);
    fields[itemKey(sid, "equipped")] = !!item._source.system.equipped;
    fields[itemKey(sid, "attuned")] = !!item._source.system.attuned;
  }
  return fields;
}

/** Converte os campos mudados em dados de atualização do ator (sem itens). */
export function actorUpdateFromFields(actor, next, changed) {
  const update = {};
  for ( const key of changed ) {
    const value = next[key];
    if ( key === "name" && value ) update.name = String(value);
    else if ( key === "xp" ) update["system.details.xp.value"] = Math.max(0, Math.round(num(value)));
    else if ( key === "copper" ) {
      const currency = currencyForTotal(actor._source.system.currency ?? {}, num(value));
      for ( const [coin, amount] of Object.entries(currency) ) update[`system.currency.${coin}`] = amount;
    }
    else if ( key === "portrait" && isWebUrl(value) ) {
      update.img = value;
      const tokenSrc = actor._source.prototypeToken?.texture?.src;
      if ( !tokenSrc || (tokenSrc === actor._source.img) || tokenSrc.includes("mystery-man") ) {
        update["prototypeToken.texture.src"] = value;
      }
    }
    else if ( key.startsWith("abilities.") ) {
      update[`system.abilities.${key.slice(10)}.value`] = Math.min(30, Math.max(1, Math.round(num(value) || 10)));
    }
    else if ( key === "biography" ) update["system.details.biography.value"] = textToHtml(value ?? "");
    else if ( DETAIL_FIELDS.includes(key) ) update[`system.details.${key}`] = value ?? "";
  }
  return update;
}
