/**
 * Concentração Expandida e Explosão Arcana (regra da casa de Zintharion).
 *
 * - Limite de magias mantidas = maior modificador de conjuração do personagem (mínimo 1).
 * - Um único teste de Concentração ao sofrer dano, com CD = max(10, dano/2) + modificador
 *   pelo número de magias mantidas (tabela configurável).
 * - Falhou: o sistema já oferece o botão "Quebrar concentração", que encerra TODAS as magias.
 * - Mantendo 2+ magias, resultado igual ou menor que CD − 10 é Falha Crítica → Explosão Arcana,
 *   resolvida automaticamente no computador de quem rolou o teste. Ex.: 2 magias, CD 15 → 5 ou menos.
 *
 * Tudo é feito em cima das peças do próprio dnd5e (efeitos de concentração, cartão de
 * teste, cartão de dano com aplicação, cartão de salvaguarda), sem reimplementar o rastreio.
 */
import { MODULE_ID } from "./constants.mjs";

export const EXPLOSION_RADIUS = 25;

const FLAG_INCAPACITATED = "explosionIncapacitated";

/* -------------------------------------------- */
/*  Configurações                               */
/* -------------------------------------------- */

export const isExpandedConcentration = () => {
  try { return !!game.settings.get(MODULE_ID, "concentrationExpanded"); } catch { return false; }
};

/** Modificadores de CD por número de magias mantidas (índice 0 = 1 magia). */
export function getDcModifiers() {
  let raw = "0,5,10,15,20,25";
  try { raw = String(game.settings.get(MODULE_ID, "concentrationDcMods") ?? raw); } catch {}
  const mods = raw.split(/[,;\s]+/).map(v => Number(v)).filter(Number.isFinite);
  return mods.length ? mods : [0];
}

/** Modificador de CD para `count` magias mantidas. Acima do fim da tabela, repete o último valor. */
export function getDcModifier(count) {
  if ( count < 1 ) return 0;
  const mods = getDcModifiers();
  return mods[Math.min(count, mods.length) - 1] ?? 0;
}

/* -------------------------------------------- */
/*  Limite de magias mantidas                   */
/* -------------------------------------------- */

/** Maior modificador entre as habilidades de conjuração das classes do personagem. */
export function getBestSpellcastingMod(system) {
  const actor = system.parent;
  const abilities = new Set();
  for ( const cls of Object.values(actor?.spellcastingClasses ?? {}) ) {
    const ability = cls.spellcasting?.ability ?? cls.system?.spellcasting?.ability;
    if ( ability ) abilities.add(ability);
  }
  if ( !abilities.size && system.attributes?.spellcasting ) abilities.add(system.attributes.spellcasting);
  let best = null;
  for ( const ability of abilities ) {
    const mod = system.abilities?.[ability]?.mod;
    if ( Number.isFinite(mod) ) best = best === null ? mod : Math.max(best, mod);
  }
  return best;
}

function patchConcentrationLimit() {
  const model = CONFIG.Actor?.dataModels?.character;
  if ( !model?.prototype?.prepareDerivedData ) {
    console.warn(`${MODULE_ID} | Concentração: modelo de personagem não encontrado.`);
    return;
  }
  const original = model.prototype.prepareDerivedData;
  model.prototype.prepareDerivedData = function(...args) {
    const result = original.apply(this, args);
    try {
      const concentration = this.attributes?.concentration;
      if ( concentration && isExpandedConcentration() ) {
        const best = getBestSpellcastingMod(this);
        // Só conjuradores ganham o limite expandido; valores maiores dados pelo Mestre são mantidos.
        if ( best !== null ) concentration.limit = Math.max(concentration.limit ?? 1, best, 1);
      }
    } catch (err) {
      console.warn(`${MODULE_ID} | Concentração: limite`, err);
    }
    return result;
  };
}

/* -------------------------------------------- */
/*  CD escalonada                               */
/* -------------------------------------------- */

/** Última CD calculada por ator, para mostrar o detalhamento no cartão do teste. */
const lastBreakdown = new WeakMap();

function patchConcentrationDC() {
  const Actor5e = CONFIG.Actor.documentClass;
  const original = Actor5e.prototype.getConcentrationDC;
  if ( typeof original !== "function" ) return;
  Actor5e.prototype.getConcentrationDC = function(damage) {
    const base = original.call(this, damage);
    if ( !isExpandedConcentration() || (this.type !== "character") ) return base;
    const count = this.concentration?.effects?.size ?? 0;
    const modifier = getDcModifier(count);
    const dc = base + modifier;
    lastBreakdown.set(this, { damage, base, count, modifier, dc });
    return dc;
  };

  // Teste de Concentração rolado pela ficha (sem cartão de dano): o dnd5e usaria CD 10 fixa.
  // Sem CD informada, usa a CD mínima com o acréscimo pelas magias mantidas (ex.: 2 magias → 15).
  const originalRoll = Actor5e.prototype.rollConcentration;
  if ( typeof originalRoll !== "function" ) return;
  Actor5e.prototype.rollConcentration = function(config={}, ...args) {
    if ( isExpandedConcentration() && (this.type === "character") && !Number.isFinite(Number(config?.target)) ) {
      config = { ...config, target: this.getConcentrationDC(0) };
    }
    return originalRoll.call(this, config, ...args);
  };
}

/** Guarda o detalhamento da CD no cartão de teste de Concentração criado pelo sistema. */
function onPreCreateChatMessage(message, data) {
  if ( data.type !== "prompt" ) return;
  const button = data.system?.buttons?.find?.(b => b.type === "concentration");
  if ( !button ) return;
  const actor = ChatMessage.implementation.getSpeakerActor(data.speaker ?? {});
  const breakdown = actor ? lastBreakdown.get(actor) : null;
  if ( !breakdown || (breakdown.dc !== button.dc) || (breakdown.count < 2) ) return;
  message.updateSource({ [`flags.${MODULE_ID}.concentration`]: breakdown });
}

/** Mostra "CD base + magias mantidas = CD final" no cartão do teste. */
function onRenderChatMessage(message, html) {
  const info = message.getFlag?.(MODULE_ID, "concentration");
  if ( !info ) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if ( !root || root.querySelector(".zin-conc-breakdown") ) return;
  const el = document.createElement("div");
  el.className = "zin-conc-breakdown";
  el.innerHTML = game.i18n.format("ZINTHARION.Concentration.Breakdown", {
    base: info.base, count: info.count, modifier: info.modifier, dc: info.dc
  });
  const content = root.querySelector(".message-content") ?? root;
  content.prepend(el);
}

/* -------------------------------------------- */
/*  Falha crítica: Explosão Arcana              */
/* -------------------------------------------- */

/** Nível (círculo) com que cada magia mantida foi conjurada. */
function getEffectSpellLevel(effect) {
  const base = Number(effect.getFlag("dnd5e", "spellLevel"));
  if ( !Number.isFinite(base) ) return 0;
  const scaling = Number(effect.getFlag("dnd5e", "scaling")) || 0;
  return base + Math.max(scaling, 0);
}

function getEffectSpellName(effect, actor) {
  const data = effect.getFlag("dnd5e", "item") ?? {};
  return actor.items.get(data.id)?.name ?? data.data?.name ?? effect.name;
}

/** Fórmula: 3d6 + (1d6 × círculo da maior magia) + (1d4 × número de magias). */
export function getExplosionFormula(highestLevel, count) {
  const parts = ["3d6"];
  if ( highestLevel > 0 ) parts.push(`${highestLevel}d6`);
  if ( count > 0 ) parts.push(`${count}d4`);
  return parts.join(" + ");
}

/** Tokens a até 25 pés do conjurador na cena atual (opcional, só para listar no cartão). */
function getTokensInRadius(actor) {
  try {
    const origin = actor.getActiveTokens?.(true)?.[0];
    if ( !origin || !canvas?.ready ) return [];
    return canvas.tokens.placeables.filter(t => {
      if ( (t === origin) || !t.actor || t.document.hidden ) return false;
      const distance = canvas.grid.measurePath([origin.center, t.center]).distance;
      return distance <= EXPLOSION_RADIUS;
    }).map(t => t.name);
  } catch (err) {
    console.warn(`${MODULE_ID} | Explosão Arcana: tokens na área`, err);
    return [];
  }
}

/** Posição (rodada/turno) em que o Incapacitado termina: fim do próximo turno do ator. */
function getIncapacitatedExpiry(actor) {
  const combat = game.combat;
  if ( !combat?.started ) return null;
  const turns = combat.turns ?? [];
  const index = turns.findIndex(c => c.actor === actor || c.actorId === actor.id);
  if ( index < 0 ) return null;
  const round = (index > combat.turn) ? combat.round : combat.round + 1;
  return { combat: combat.id, round, turn: index };
}

async function applyExplosionConditions(actor) {
  // Caído
  try { await actor.toggleStatusEffect("prone", { active: true }); } catch (err) {
    console.warn(`${MODULE_ID} | Explosão Arcana: Caído`, err);
  }

  // +4 de Exaustão (respeitando o máximo; a morte no último nível é do sistema)
  const max = CONFIG.DND5E.conditionTypes?.exhaustion?.levels ?? 6;
  const current = actor.system.attributes?.exhaustion ?? 0;
  await actor.update({ "system.attributes.exhaustion": Math.min(max, current + 4) });

  // Incapacitado até o fim do próximo turno
  const statuses = CONFIG.statusEffects ?? {};
  const status = Array.isArray(statuses) ? statuses.find(s => s.id === "incapacitated") : statuses.incapacitated;
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: `${game.i18n.localize(status?.name ?? "DND5E.ConIncapacitated")} — ${game.i18n.localize("ZINTHARION.Concentration.ExplosionShort")}`,
    img: status?.img ?? "icons/svg/stoned.svg",
    statuses: ["incapacitated"],
    description: game.i18n.localize("ZINTHARION.Concentration.IncapacitatedHint"),
    flags: { [MODULE_ID]: { [FLAG_INCAPACITATED]: getIncapacitatedExpiry(actor) ?? true } }
  }]);
}

async function postAnomaly(actor, spells) {
  const visibility = (() => { try { return game.settings.get(MODULE_ID, "anomalyVisibility"); } catch { return "gm"; } })();
  let suggestion = "";
  const uuid = (() => { try { return game.settings.get(MODULE_ID, "anomalyTable"); } catch { return ""; } })();
  if ( uuid ) {
    try {
      const table = await fromUuid(uuid);
      const draw = await table?.draw({ displayChat: false });
      const texts = (draw?.results ?? []).map(r => r.name || r.description || r.text).filter(Boolean);
      if ( texts.length ) suggestion = `<p><b>${game.i18n.localize("ZINTHARION.Concentration.AnomalySuggestion")}:</b> ${texts.join("; ")}</p>`;
    } catch (err) {
      console.warn(`${MODULE_ID} | Anomalia: tabela`, err);
    }
  }
  const list = spells.map(s => `<li>${foundry.utils.escapeHTML(s.name)}${s.level ? ` (${s.level}º)` : ""}</li>`).join("");
  const content = `
    <div class="zin-chat-card zin-anomaly">
      <header><i class="fas fa-hurricane" inert></i> ${game.i18n.localize("ZINTHARION.Concentration.AnomalyTitle")}</header>
      <p>${game.i18n.format("ZINTHARION.Concentration.AnomalyText", { name: foundry.utils.escapeHTML(actor.name) })}</p>
      <ul>${list}</ul>
      ${suggestion}
    </div>`;
  const data = { speaker: ChatMessage.implementation.getSpeaker({ actor }), content };
  if ( visibility !== "public" ) data.whisper = game.users.filter(u => u.isGM).map(u => u.id);
  await ChatMessage.implementation.create(data);
}

/**
 * Resolve a Explosão Arcana.
 * @param {Actor} actor
 * @param {{ spells: {name: string, level: number}[], dc: number, total: number }} state
 *   Estado guardado ANTES de encerrar as magias.
 */
export async function triggerArcaneExplosion(actor, state) {
  const { spells, dc, total } = state;
  const count = spells.length;
  const highest = Math.max(0, ...spells.map(s => s.level));

  // 1. Encerra todas as magias
  await actor.endConcentration();

  // 2. Dano de força
  const formula = getExplosionFormula(highest, count);
  const roll = new CONFIG.Dice.DamageRoll(formula, {}, { type: "force" });
  await roll.evaluate();
  const damage = roll.total;

  // 3. Dano no conjurador: ignora resistência a força, respeita imunidade
  try {
    await actor.applyDamage([{ value: damage, type: "force", properties: new Set() }], {
      ignore: { resistance: new Set(["force"]) }
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | Explosão Arcana: dano no conjurador`, err);
  }

  // 5. Condições
  await applyExplosionConditions(actor);

  // 7. Cartão principal
  const spellDC = actor.system.attributes?.spell?.dc ?? 10;
  const inArea = getTokensInRadius(actor);
  const speaker = ChatMessage.implementation.getSpeaker({ actor });
  const spellList = spells.map(s => `<li>${foundry.utils.escapeHTML(s.name)}${s.level ? ` <small>${s.level}º</small>` : ""}</li>`).join("");
  const areaList = inArea.length
    ? `<p><b>${game.i18n.localize("ZINTHARION.Concentration.InArea")}:</b> ${inArea.map(n => foundry.utils.escapeHTML(n)).join(", ")}</p>`
    : "";
  const content = `
    <div class="zin-chat-card zin-explosion">
      <header>💥 ${game.i18n.localize("ZINTHARION.Concentration.ExplosionTitle")}</header>
      <p class="zin-explosion-sub">${game.i18n.format("ZINTHARION.Concentration.FailedBy", { margin: dc - total, dc, total })}</p>
      <p><b>${game.i18n.localize("ZINTHARION.Concentration.SpellsLost")}:</b></p>
      <ul>${spellList}</ul>
      <div class="zin-explosion-damage">
        <span>${formula}</span>
        <b>${damage}</b>
        <small>${game.i18n.localize("ZINTHARION.Concentration.Force")}</small>
      </div>
      <p>${game.i18n.format("ZINTHARION.Concentration.SelfDamage", { name: foundry.utils.escapeHTML(actor.name) })}</p>
      <p>${game.i18n.format("ZINTHARION.Concentration.AreaSave", { radius: EXPLOSION_RADIUS, dc: spellDC })}</p>
      ${areaList}
      <p class="zin-explosion-conditions">${game.i18n.localize("ZINTHARION.Concentration.Conditions")}</p>
    </div>`;
  await ChatMessage.implementation.create({ speaker, content });

  // 4. Área: cartão de dano (com aplicar/metade) + botão de salvaguarda de Destreza para todos
  await CONFIG.Dice.DamageRoll.toMessage([roll], {
    type: "damage",
    speaker,
    flavor: `${game.i18n.localize("ZINTHARION.Concentration.ExplosionShort")} — ${game.i18n.localize("ZINTHARION.Concentration.AreaDamage")}`,
    system: { onSave: "half" }
  });
  await ChatMessage.implementation.create({
    speaker,
    type: "prompt",
    system: { broadcast: true, buttons: [{ type: "save", ability: "dex", dc: spellDC, format: "long" }] }
  });

  // 6. Anomalia Mágica Temporária
  await postAnomaly(actor, spells);
}

/** Falha Crítica: resultado igual ou menor que CD − 10 (ex.: CD 15 → 5 ou menos). */
export const isCriticalConcentrationFailure = (total, dc) => total <= (dc - 10);

/** Depois do teste de Concentração: detecta a Falha Crítica. */
async function onRollConcentration(rolls, { subject: actor }={}) {
  if ( !isExpandedConcentration() || !actor || (actor.type !== "character") ) return;
  const roll = rolls?.[0];
  const dc = Number(roll?.options?.target);
  if ( !roll || !Number.isFinite(dc) || !roll.isFailure ) return;

  const effects = Array.from(actor.concentration?.effects ?? []);
  // Falha comum (ou só 1 magia): o sistema oferece o botão de quebrar a concentração.
  if ( (effects.length < 2) || !isCriticalConcentrationFailure(roll.total, dc) ) return;

  const spells = effects.map(e => ({ name: getEffectSpellName(e, actor), level: getEffectSpellLevel(e) }));
  try {
    await triggerArcaneExplosion(actor, { spells, dc, total: roll.total });
  } catch (err) {
    console.error(`${MODULE_ID} | Explosão Arcana`, err);
    ui.notifications.error(game.i18n.localize("ZINTHARION.Concentration.ExplosionError"));
  }
}

/* -------------------------------------------- */
/*  Fim do Incapacitado                         */
/* -------------------------------------------- */

function isPast(combat, expiry) {
  if ( combat.round > expiry.round ) return true;
  return (combat.round === expiry.round) && (combat.turn > expiry.turn);
}

/** GM ativo remove o Incapacitado da Explosão ao fim do próximo turno do ator. */
async function onUpdateCombat(combat, changes) {
  if ( !game.users.activeGM?.isSelf ) return;
  if ( !("turn" in changes) && !("round" in changes) ) return;
  for ( const combatant of combat.combatants ) {
    const actor = combatant.actor;
    if ( !actor ) continue;
    const expired = actor.effects.filter(e => {
      const expiry = e.getFlag(MODULE_ID, FLAG_INCAPACITATED);
      return expiry && (typeof expiry === "object") && (expiry.combat === combat.id) && isPast(combat, expiry);
    });
    if ( expired.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", expired.map(e => e.id));
  }
}

/* -------------------------------------------- */

export function registerConcentration() {
  patchConcentrationLimit();
  patchConcentrationDC();
  Hooks.on("preCreateChatMessage", onPreCreateChatMessage);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  Hooks.on("dnd5e.rollConcentrationV2", (rolls, data) => { onRollConcentration(rolls, data); });
  Hooks.on("updateCombat", (combat, changes) => { onUpdateCombat(combat, changes); });
}
