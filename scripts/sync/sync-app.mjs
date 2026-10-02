import { MODULE_ID } from "../constants.mjs";
import { siteConfig, siteRequest, sitePage } from "./api.mjs";
import { getXpTable } from "../progression.mjs";
import { importSiteCharacter, listSiteCharacters, pullActor, pushActor } from "./sync.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const i18n = (key, data) => (data ? game.i18n.format(`ZINTHARION.Sync.${key}`, data) : game.i18n.localize(`ZINTHARION.Sync.${key}`));

/** Acha o ator deste mundo ligado a uma ficha do site. */
export function actorForSiteCharacter(siteCharacter) {
  const byFlag = game.actors.find(a => a.getFlag(MODULE_ID, "site")?.characterId === siteCharacter.id);
  if ( byFlag ) return byFlag;
  if ( siteCharacter.foundryWorldId !== game.world.id ) return null;
  return game.actors.get(siteCharacter.foundryActorId) ?? null;
}

/**
 * Janela "Site Zintharion": lista as fichas do site, mostra o que precisa sincronizar
 * e tem os botões Receber / Enviar / Importar.
 */
export class SiteSyncApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "zintharion-site-sync",
    classes: ["zintharion", "zin-config", "zin-sync-app"],
    window: { title: "ZINTHARION.Sync.AppTitle", icon: "fa-solid fa-cloud", resizable: true },
    position: { width: 760, height: "auto" },
    actions: {
      refresh: SiteSyncApp.#onRefresh,
      pull: SiteSyncApp.#onPull,
      push: SiteSyncApp.#onPush,
      importCharacter: SiteSyncApp.#onImport,
      openSheet: SiteSyncApp.#onOpenSheet,
      openSite: SiteSyncApp.#onOpenSite,
      sendXpTable: SiteSyncApp.#onSendXpTable,
      settings: SiteSyncApp.#onSettings
    }
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/sync-app.hbs`, scrollable: [".zin-scroll"] }
  };

  /** @type {object[]|null} */
  #characters = null;
  #error = null;
  #busy = new Set();

  /** Só uma janela por vez. */
  static open() {
    const existing = foundry.applications.instances.get(this.DEFAULT_OPTIONS.id);
    if ( existing ) {
      existing.refresh();
      return existing.bringToFront?.() ?? existing.render(true);
    }
    return new this().render(true);
  }

  async refresh() {
    this.#characters = null;
    this.#error = null;
    return this.render();
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const config = siteConfig();
    context.configured = config.ready;
    context.siteUrl = config.url;
    context.isGM = game.user.isGM;

    if ( config.ready && !this.#characters && !this.#error ) {
      try {
        this.#characters = await listSiteCharacters();
      } catch (err) {
        this.#error = err.message;
      }
    }
    context.error = this.#error;

    const rows = (this.#characters ?? []).map(c => {
      const actor = actorForSiteCharacter(c);
      const owner = !!actor?.isOwner;
      const tags = [];
      if ( c.hasFullSheet ) tags.push({ label: i18n("FullSheetTag"), css: "info" });
      if ( c.status !== "APPROVED" ) tags.push({ label: i18n("TagNotApproved"), css: "warn" });
      if ( !c.isAlive ) tags.push({ label: i18n("TagDead"), css: "dead" });
      if ( c.pullRequested ) tags.push({ label: i18n("TagPullRequested"), css: "info" });
      if ( c.siteChanged ) tags.push({ label: i18n("TagSiteChanged"), css: "info" });
      if ( c.pushRequested ) tags.push({ label: i18n("TagPushRequested"), css: "warn" });
      if ( c.foundryActorId && !actor ) tags.push({ label: i18n("TagOtherWorld"), css: "muted" });
      return {
        ...c,
        busy: this.#busy.has(c.id),
        actorId: actor?.id ?? null,
        actorName: actor && (actor.name !== c.name) ? actor.name : null,
        canPull: owner,
        canPush: owner,
        canImport: !actor && game.user.can("ACTOR_CREATE") && ((c.status === "APPROVED") || game.user.isGM),
        attention: !!actor && (c.pullRequested || c.siteChanged || c.pushRequested),
        tags,
        syncedAt: c.foundrySyncedAt ? new Date(c.foundrySyncedAt).toLocaleString() : null
      };
    });
    // Primeiro o que precisa de atenção, depois o que está neste mundo.
    rows.sort((a, b) => (b.attention - a.attention) || (!!b.actorId - !!a.actorId) || a.name.localeCompare(b.name));
    context.rows = rows;
    context.loading = config.ready && !this.#characters && !this.#error;
    return context;
  }

  async #run(characterId, fn) {
    if ( this.#busy.has(characterId) ) return;
    this.#busy.add(characterId);
    this.render();
    try {
      await fn();
    } catch (err) {
      console.error(`${MODULE_ID} | Sincronização`, err);
      ui.notifications.error(err.message);
    } finally {
      this.#busy.delete(characterId);
      this.#characters = null;
      this.render();
    }
  }

  #row(target) {
    const id = target.closest("[data-character-id]")?.dataset.characterId;
    return (this.#characters ?? []).find(c => c.id === id) ?? null;
  }

  static #onRefresh() {
    this.refresh();
  }

  static #onPull(_event, target) {
    const row = this.#row(target);
    const actor = row && actorForSiteCharacter(row);
    if ( actor ) this.#run(row.id, () => pullActor(actor));
  }

  static #onPush(_event, target) {
    const row = this.#row(target);
    const actor = row && actorForSiteCharacter(row);
    if ( actor ) this.#run(row.id, () => pushActor(actor));
  }

  static #onImport(_event, target) {
    const row = this.#row(target);
    if ( row ) this.#run(row.id, () => importSiteCharacter(row));
  }

  static #onOpenSheet(_event, target) {
    const row = this.#row(target);
    actorForSiteCharacter(row)?.sheet.render(true);
  }

  static #onOpenSite(_event, target) {
    const row = this.#row(target);
    window.open(sitePage(row ? `/characters/${row.id}` : "/characters"), "_blank", "noopener");
  }

  static async #onSendXpTable() {
    if ( game.user.isGM ) await sendXpTableToSite({ notify: true });
  }

  static #onSettings() {
    const app = new foundry.applications.settings.SettingsConfig();
    app.render(true).then?.(() => app.changeTab?.(MODULE_ID, "categories"));
  }
}

/* -------------------------------------------- */
/*  Tabela de XP (o Foundry é a referência)     */
/* -------------------------------------------- */

/** (GM) Manda a tabela de XP do mundo para o site, que passa a usar a mesma. */
export async function sendXpTableToSite({ notify=false }={}) {
  if ( !game.user.isGM || !siteConfig().ready ) return false;
  const levels = getXpTable();
  try {
    await siteRequest("/api/foundry/progression", { method: "POST", body: { levels } });
    if ( notify ) ui.notifications.info(i18n("XpDone", { max: levels.length }));
    return true;
  } catch (err) {
    ui.notifications.error(i18n("XpFailed", { error: err.message }));
    return false;
  }
}

/* -------------------------------------------- */
/*  Aviso ao entrar no mundo                    */
/* -------------------------------------------- */

/** Confere se há fichas para receber/enviar e avisa (uma vez por carregamento). */
export async function checkSiteInbox() {
  if ( !siteConfig().ready || !game.settings.get(MODULE_ID, "siteCheckOnLoad") ) return;
  let characters;
  try {
    characters = await listSiteCharacters();
  } catch (err) {
    console.warn(`${MODULE_ID} | Site: ${err.message}`);
    return;
  }
  let receive = 0;
  let send = 0;
  let newOnes = 0;
  for ( const c of characters ) {
    const actor = actorForSiteCharacter(c);
    if ( actor?.isOwner ) {
      if ( c.pullRequested || c.siteChanged ) receive++;
      if ( c.pushRequested ) send++;
    } else if ( !actor && !c.foundryActorId && c.pullRequested && game.user.can("ACTOR_CREATE") ) newOnes++;
  }
  if ( !(receive || send || newOnes) ) return;
  ui.notifications.info(i18n("InboxNotice", { receive, send, newOnes }));
  SiteSyncApp.open();
}
