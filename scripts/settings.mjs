import { MODULE_ID, DEFAULT_XP_TABLE, DEFAULT_RANK_TABLE } from "./constants.mjs";
import { applyProgression, refreshActorsProgression } from "./progression.mjs";
import { refreshCharacterSheets } from "./sheet.mjs";
import { XpTableConfig } from "./apps/xp-table-config.mjs";
import { RankTableConfig } from "./apps/rank-table-config.mjs";
import { SiteSyncApp, sendXpTableToSite } from "./sync/sync-app.mjs";

export function registerSettings() {
  const S = "ZINTHARION.Settings";

  // Menus (só GM)
  game.settings.registerMenu(MODULE_ID, "xpTableMenu", {
    name: `${S}.XpMenu.Name`,
    label: `${S}.XpMenu.Label`,
    hint: `${S}.XpMenu.Hint`,
    icon: "fa-solid fa-chart-line",
    type: XpTableConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, "rankTableMenu", {
    name: `${S}.RankMenu.Name`,
    label: `${S}.RankMenu.Label`,
    hint: `${S}.RankMenu.Hint`,
    icon: "fa-solid fa-ranking-star",
    type: RankTableConfig,
    restricted: true
  });

  // Dados das tabelas (editados pelos menus acima)
  game.settings.register(MODULE_ID, "xpTable", {
    scope: "world",
    config: false,
    type: Object,
    default: { levels: [...DEFAULT_XP_TABLE] },
    onChange: () => {
      applyProgression();
      refreshActorsProgression();
      refreshCharacterSheets();
      // O site segue a tabela do Foundry.
      sendXpTableToSite({ notify: true });
    }
  });

  game.settings.register(MODULE_ID, "rankTable", {
    scope: "world",
    config: false,
    type: Object,
    default: { ranks: DEFAULT_RANK_TABLE.map(r => ({ ...r })) },
    onChange: () => refreshCharacterSheets()
  });

  // Emblemas encontrados na pasta assets/zintharion/ranks (preenchido pelo GM automaticamente).
  game.settings.register(MODULE_ID, "rankEmblems", {
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => refreshCharacterSheets()
  });

  // Aparência
  game.settings.register(MODULE_ID, "theme", {
    name: `${S}.Theme.Name`,
    hint: `${S}.Theme.Hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshCharacterSheets()
  });

  game.settings.register(MODULE_ID, "logoPath", {
    name: `${S}.Logo.Name`,
    hint: `${S}.Logo.Hint`,
    scope: "world",
    config: true,
    type: String,
    filePicker: "image",
    default: `modules/${MODULE_ID}/assets/zintharion-logo.webp`,
    onChange: () => refreshCharacterSheets()
  });

  game.settings.register(MODULE_ID, "showRank", {
    name: `${S}.ShowRank.Name`,
    hint: `${S}.ShowRank.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => refreshCharacterSheets()
  });

  // Regras
  game.settings.register(MODULE_ID, "maxSpellLevel", {
    name: `${S}.MaxSpellLevel.Name`,
    hint: `${S}.MaxSpellLevel.Hint`,
    scope: "world",
    config: true,
    type: Number,
    range: { min: 9, max: 20, step: 1 },
    default: 12,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, "exhaustionMax", {
    name: `${S}.ExhaustionMax.Name`,
    hint: `${S}.ExhaustionMax.Hint`,
    scope: "world",
    config: true,
    type: Number,
    range: { min: 6, max: 20, step: 1 },
    default: 10,
    requiresReload: true
  });

  // Integração com o site
  game.settings.registerMenu(MODULE_ID, "siteSyncMenu", {
    name: `${S}.SiteMenu.Name`,
    label: `${S}.SiteMenu.Label`,
    hint: `${S}.SiteMenu.Hint`,
    icon: "fa-solid fa-cloud",
    type: SiteSyncApp,
    restricted: false
  });

  game.settings.register(MODULE_ID, "siteUrl", {
    name: `${S}.SiteUrl.Name`,
    hint: `${S}.SiteUrl.Hint`,
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  // Token pessoal: cada usuário cola o seu (fica só neste computador).
  game.settings.register(MODULE_ID, "siteToken", {
    name: `${S}.SiteToken.Name`,
    hint: `${S}.SiteToken.Hint`,
    scope: "client",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "siteCheckOnLoad", {
    name: `${S}.SiteCheck.Name`,
    hint: `${S}.SiteCheck.Hint`,
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  // Concentração Expandida
  game.settings.register(MODULE_ID, "concentrationExpanded", {
    name: `${S}.ConcExpanded.Name`,
    hint: `${S}.ConcExpanded.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => game.actors?.forEach(a => { if ( a.type === "character" ) a.reset(); })
  });

  game.settings.register(MODULE_ID, "concentrationDcMods", {
    name: `${S}.ConcDcMods.Name`,
    hint: `${S}.ConcDcMods.Hint`,
    scope: "world",
    config: true,
    type: String,
    default: "0, 5, 10, 15, 20, 25"
  });

  game.settings.register(MODULE_ID, "anomalyTable", {
    name: `${S}.AnomalyTable.Name`,
    hint: `${S}.AnomalyTable.Hint`,
    scope: "world",
    config: true,
    type: String,
    default: ""
  });

  game.settings.register(MODULE_ID, "anomalyVisibility", {
    name: `${S}.AnomalyVisibility.Name`,
    hint: `${S}.AnomalyVisibility.Hint`,
    scope: "world",
    config: true,
    type: String,
    choices: {
      gm: `${S}.AnomalyVisibility.GM`,
      public: `${S}.AnomalyVisibility.Public`
    },
    default: "gm"
  });
}
