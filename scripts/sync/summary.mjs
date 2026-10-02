/**
 * Resumo da ficha: os valores que o dnd5e calcula na hora e não salva
 * (modificadores, CA, CD de magia, perícias...). O site só exibe, sem reimplementar as regras.
 * Formato em src/lib/foundry/summary.ts (site).
 */
import { getRank } from "../ranks.mjs";

const loc = key => (key ? game.i18n.localize(key) : "");
const label = cfg => loc(cfg?.label ?? cfg ?? "");
const num = value => Number(value ?? 0) || 0;

export function buildSummary(actor) {
  const system = actor.system;
  const attrs = system.attributes ?? {};
  const level = num(system.details?.level);
  const cfg = CONFIG.DND5E;

  const classes = actor.items.filter(i => i.type === "class").map(cls => ({
    name: cls.name,
    identifier: cls.system.identifier ?? null,
    levels: num(cls.system.levels),
    subclass: cls.subclass?.name ?? null,
    hitDie: cls.system.hd?.denomination ?? null
  }));

  const abilities = {};
  for ( const [key, abl] of Object.entries(system.abilities ?? {}) ) {
    abilities[key] = {
      label: cfg.abilities[key]?.abbreviation ? loc(cfg.abilities[key].abbreviation) : key,
      value: num(abl.value),
      mod: num(abl.mod),
      save: num(abl.save?.value ?? abl.save),
      saveProficient: num(abl.proficient) > 0
    };
  }

  const skills = {};
  for ( const [key, skill] of Object.entries(system.skills ?? {}) ) {
    skills[key] = {
      label: label(cfg.skills[key]) || key,
      ability: skill.ability,
      total: num(skill.total),
      passive: num(skill.passive),
      proficient: num(skill.proficient ?? skill.value)
    };
  }

  const speed = [];
  for ( const [key, movement] of Object.entries(cfg.movementTypes ?? {}) ) {
    if ( movement.hidden ) continue;
    const value = attrs.movement?.speeds?.[key] ?? attrs.movement?.[key];
    if ( value ) speed.push({ label: label(movement), value: num(value), units: attrs.movement?.units ?? "" });
  }

  const senses = [];
  for ( const [key, sense] of Object.entries(cfg.senses ?? {}) ) {
    const value = attrs.senses?.ranges?.[key] ?? attrs.senses?.[key];
    if ( value && (typeof value === "number") ) senses.push(`${label(sense)} ${value} ${attrs.senses?.units ?? ""}`.trim());
  }

  const spellSlots = [];
  for ( const [key, slot] of Object.entries(system.spells ?? {}) ) {
    if ( !num(slot?.max) ) continue;
    const lvl = Number(key.replace(/\D/g, "")) || 0;
    spellSlots.push({
      level: lvl,
      label: key === "pact" ? loc("DND5E.PactMagic") : (loc(cfg.spellLevels?.[lvl]) || `${lvl}º`),
      value: num(slot.value),
      max: num(slot.max)
    });
  }
  spellSlots.sort((a, b) => a.level - b.level);

  const spells = actor.items.filter(i => i.type === "spell").map(spell => ({
    name: spell.name,
    level: num(spell.system.level),
    prepared: num(spell.system.prepared) > 0 || (spell.system.level === 0),
    school: label(cfg.spellSchools?.[spell.system.school]) || null
  })).sort((a, b) => (a.level - b.level) || a.name.localeCompare(b.name));

  const features = actor.items.filter(i => i.type === "feat").map(feat => ({
    name: feat.name,
    type: feat.system.type?.value ?? "",
    source: feat.system.type?.subtype || null
  }));

  const traitLabels = (trait, config) => [...(trait?.value ?? [])].map(v => label(config?.[v]) || v);

  const currency = {};
  for ( const key of Object.keys(cfg.currencies) ) currency[key] = num(system.currency?.[key]);

  const hp = attrs.hp ?? {};
  const xp = system.details?.xp;
  const spellAbility = attrs.spellcasting;

  return {
    version: 1,
    level,
    rank: getRank(level)?.rank ?? null,
    xp: xp ? { value: num(xp.value), min: num(xp.min), max: num(xp.max) } : null,
    classes,
    species: actor.items.find(i => i.type === "race")?.name ?? null,
    background: actor.items.find(i => i.type === "background")?.name ?? null,
    alignment: system.details?.alignment || null,
    hp: { value: num(hp.value), max: num(hp.effectiveMax ?? hp.max), temp: num(hp.temp), tempmax: num(hp.tempmax) },
    hitDice: attrs.hd ? { value: num(attrs.hd.value), max: num(attrs.hd.max) } : null,
    ac: attrs.ac?.value ?? null,
    initiative: attrs.init?.total ?? null,
    proficiency: num(attrs.prof),
    speed,
    senses,
    abilities,
    skills,
    spellcasting: spellAbility || spells.length
      ? { ability: spellAbility || null, dc: attrs.spell?.dc ?? null, attack: attrs.spell?.attack ?? null }
      : null,
    spellSlots,
    spells,
    features,
    languages: system.traits?.languages?.labels?.languages ?? traitLabels(system.traits?.languages, {}),
    proficiencies: {
      weapons: traitLabels(system.traits?.weaponProf, cfg.weaponProficiencies),
      armor: traitLabels(system.traits?.armorProf, cfg.armorProficiencies),
      tools: Object.keys(system.tools ?? {})
    },
    currency,
    exhaustion: num(attrs.exhaustion),
    inspiration: !!attrs.inspiration,
    deathSaves: { success: num(attrs.death?.success), failure: num(attrs.death?.failure) },
    conditions: [...(actor.statuses ?? [])].map(s => label(cfg.conditionTypes?.[s]) || s)
  };
}
