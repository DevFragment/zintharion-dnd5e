/**
 * Zintharion — módulo de regras e visual para a ficha do dnd5e.
 * Tema, brasão, rank por nível, tabela de XP editável, níveis acima de 20,
 * Diamante Astral, Exaustão configurável e sincronização com o site Zintharion.
 */
import { MODULE_ID, ASTRAL_DIAMOND } from "./constants.mjs";
import { registerSettings } from "./settings.mjs";
import { applyProgression, getXpTable, migrateXpTable } from "./progression.mjs";
import { getRank, getRankTable, registerRankHooks, syncRankFlag, detectRankEmblems } from "./ranks.mjs";
import { decorateCharacterSheet, refreshCharacterSheets } from "./sheet.mjs";
import { createZintharionCharacterSheet } from "./sheet/character-sheet.mjs";
import { registerPlutoniumLevelUp, patchPlutoniumCurrency } from "./compat/plutonium.mjs";
import { buildEnvelope, pullActor, pushActor, importSiteCharacter } from "./sync/sync.mjs";
import { SiteSyncApp } from "./sync/sync-app.mjs";
import { addSiteSyncButtons, addPendingBuildBanner } from "./sync/sheet-sync.mjs";
import { buildSummary } from "./sync/summary.mjs";
import { registerConcentration, triggerArcaneExplosion } from "./concentration.mjs";

// Plutonium: registrado já no carregamento, antes dos avisos do próprio Plutonium.
registerPlutoniumLevelUp();

Hooks.once("init", () => {
  if ( game.system.id !== "dnd5e" ) return;
  registerSettings();

  // Diamante Astral: aparece primeiro na bolsa (maior valor).
  const { key, gpValue } = ASTRAL_DIAMOND;
  CONFIG.DND5E.currencies = {
    [key]: {
      label: "ZINTHARION.Currency.DA",
      abbreviation: "ZINTHARION.Currency.DAAbbr",
      conversion: 1 / gpValue,
      icon: `modules/${MODULE_ID}/assets/diamante-astral.svg`
    },
    ...CONFIG.DND5E.currencies
  };

  // Exaustão: novo máximo, ícones numerados até 20 e morte só no último nível.
  const exhaustion = CONFIG.DND5E.conditionTypes?.exhaustion;
  if ( exhaustion ) {
    const max = game.settings.get(MODULE_ID, "exhaustionMax");
    exhaustion.levels = max;
    exhaustion.img = `modules/${MODULE_ID}/assets/exhaustion/exhaustion.svg`;
    // Regra de Zintharion: −1 no d20 e −1,5 m (5 pés) de deslocamento por nível.
    exhaustion.reduction = { ...(exhaustion.reduction ?? {}), rolls: 1, speed: 5 };
    // dnd5e 6.x: `conditions` define status por nível (padrão: morte no 6).
    if ( exhaustion.conditions ) {
      const deathStatuses = Object.values(exhaustion.conditions).flat();
      exhaustion.conditions = { [max]: deathStatuses.length ? deathStatuses : ["dead"] };
    }
  }

  // Círculos de magia além do 9º (10º até o máximo configurado).
  const maxSpellLevel = game.settings.get(MODULE_ID, "maxSpellLevel");
  for ( let level = 10; level <= maxSpellLevel; level++ ) {
    CONFIG.DND5E.spellLevels[level] = `DND5E.SpellLevel${level}`;
  }

  // XP e nível máximo
  applyProgression();

  registerRankHooks();

  // Concentração Expandida + Explosão Arcana
  try { registerConcentration(); } catch (err) {
    console.error(`${MODULE_ID} | Não foi possível ativar a Concentração Expandida`, err);
  }

  // Ficha "Zintharion": cabeçalho largo e abas horizontais. A ficha padrão continua disponível.
  try {
    const ZintharionCharacterSheet = createZintharionCharacterSheet();
    foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, ZintharionCharacterSheet, {
      types: ["character"],
      makeDefault: true,
      label: "ZINTHARION.Sheet.Label"
    });
  } catch (err) {
    console.error(`${MODULE_ID} | Não foi possível registrar a ficha Zintharion`, err);
  }

  // API pública para outros módulos/macros (ex.: sincronização com o site).
  game.modules.get(MODULE_ID).api = {
    getRank,
    getRankTable,
    getXpTable,
    syncRankFlag,
    detectRankEmblems,
    refreshCharacterSheets,
    triggerArcaneExplosion,
    // Site Zintharion
    site: {
      open: () => SiteSyncApp.open(),
      pull: actor => pullActor(actor),
      push: actor => pushActor(actor),
      importCharacter: importSiteCharacter,
      /** O que seria enviado ao site (para inspecionar/depurar). */
      envelope: actor => buildEnvelope(actor),
      summary: actor => buildSummary(actor)
    }
  };
});

// Rótulos dos espaços de magia 10º+ (o sistema só traduz até o 9º).
Hooks.once("i18nInit", () => {
  if ( game.system.id !== "dnd5e" ) return;
  for ( const model of Object.values(CONFIG.DND5E.spellcasting ?? {}) ) {
    if ( !model?.slots || model.isSingleLevel || (typeof model.getLabel !== "function") ) continue;
    const original = model.getLabel.bind(model);
    model.getLabel = (options={}) => {
      if ( options.level > 9 ) return game.i18n.localize(`DND5E.SpellLevel${options.level}`);
      return original(options);
    };
  }
});

Hooks.once("ready", () => {
  if ( game.system.id !== "dnd5e" ) return;
  // Garante a tabela certa mesmo se outro módulo mexer depois do init.
  applyProgression();
  // GM: troca a tabela padrão antiga salva no mundo pela de Zintharion (e o site recebe a nova).
  migrateXpTable().catch(err => console.warn(`${MODULE_ID} | Tabela de XP`, err));
  // GM: procura emblemas de rank na pasta assets/zintharion/ranks.
  if ( game.user.isGM ) detectRankEmblems().catch(err => console.warn(`${MODULE_ID} | Emblemas`, err));
  // Plutonium: Diamante Astral conta como dinheiro na Loja de Equipamentos.
  try { patchPlutoniumCurrency(); } catch (err) { console.warn(`${MODULE_ID} | Plutonium`, err); }
});

// Botão "Site Zintharion" na aba de Atores.
Hooks.on("renderActorDirectory", (app, element) => {
  if ( game.system.id !== "dnd5e" ) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const actions = root?.querySelector(".header-actions");
  if ( !actions || actions.querySelector(".zin-site-directory") ) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "zin-site-directory";
  button.innerHTML = `<i class="fa-solid fa-cloud" inert></i> ${game.i18n.localize("ZINTHARION.Sync.DirectoryButton")}`;
  button.addEventListener("click", () => SiteSyncApp.open());
  actions.append(button);
});

Hooks.on("renderCharacterActorSheet", (app, element) => {
  try {
    decorateCharacterSheet(app, element);
  } catch (err) {
    console.error(`${MODULE_ID} | Falha ao decorar a ficha`, err);
  }
  try {
    addSiteSyncButtons(app);
    addPendingBuildBanner(app);
  } catch (err) {
    console.error(`${MODULE_ID} | Site`, err);
  }
});
