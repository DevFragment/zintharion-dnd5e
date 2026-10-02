/**
 * Ficha de personagem: botões "Receber do site" / "Enviar ao site" na barra da janela
 * e o aviso de montagem pelo Plutonium para fichas criadas no site.
 */
import { MODULE_ID } from "../constants.mjs";
import { openPlutoniumImport } from "../compat/plutonium.mjs";
import { siteConfig } from "./api.mjs";
import { getLink, pullActor, pushActor } from "./sync.mjs";

const i18n = (key, data) => (data ? game.i18n.format(`ZINTHARION.Sync.${key}`, data) : game.i18n.localize(`ZINTHARION.Sync.${key}`));
const busy = new Set();

async function run(actor, button, fn) {
  if ( busy.has(actor.uuid) ) return;
  busy.add(actor.uuid);
  button?.classList.add("zin-busy");
  try {
    await fn(actor);
  } catch (err) {
    console.error(`${MODULE_ID} | Sincronização`, err);
    ui.notifications.error(err.message);
  } finally {
    busy.delete(actor.uuid);
    button?.classList.remove("zin-busy");
  }
}

function headerButton(icon, label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `header-control icon ${icon} zin-site-control`;
  btn.dataset.tooltip = label;
  btn.setAttribute("aria-label", label);
  btn.addEventListener("pointerdown", event => event.stopPropagation());
  btn.addEventListener("dblclick", event => event.stopPropagation());
  btn.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    onClick(btn);
  });
  return btn;
}

/** Botões na barra da janela da ficha (só para quem é dono do ator). */
export function addSiteSyncButtons(app) {
  const actor = app.actor ?? app.document;
  const header = app.element?.querySelector(".window-header");
  if ( !header || (actor?.type !== "character") || !actor.isOwner ) return;
  if ( !siteConfig().url || header.querySelector(".zin-site-control") ) return;

  const linked = !!getLink(actor)?.characterId;
  const pull = headerButton("fa-solid fa-cloud-arrow-down", i18n(linked ? "PullTooltip" : "PullTooltipUnlinked"),
    btn => run(actor, btn, a => pullActor(a)));
  const push = headerButton("fa-solid fa-cloud-arrow-up", i18n(linked ? "PushTooltip" : "PushTooltipUnlinked"),
    btn => run(actor, btn, a => pushActor(a)));

  const anchor = header.querySelector(".zin-plut-import") ?? header.querySelector('[data-action="toggleControls"]');
  if ( anchor ) anchor.before(pull, push);
  else header.append(pull, push);
}

/* -------------------------------------------- */
/*  Montagem pendente (ficha criada no site)    */
/* -------------------------------------------- */

const refLabel = ref => (ref ? `${ref.name} (${ref.source})` : "");

/** A montagem está completa quando o ator já tem classe, espécie e antecedente. */
function buildDone(actor, build) {
  const has = type => actor.items.some(i => i.type === type);
  const wantsSpecies = build.species || build.legacy?.race;
  const wantsBackground = build.background || build.legacy?.background;
  return has("class") && (!wantsSpecies || has("race")) && (!wantsBackground || has("background"));
}

/**
 * Depois que a classe entra pelo Plutonium, aplica o XP que a ficha tinha no site
 * (a ficha nasce "nível 0" para a montagem não brigar com o XP).
 */
function applyPendingXp(actor, build, update) {
  if ( build.xpApplied || !build.xp || !actor.items.some(i => i.type === "class") ) return;
  const current = Number(actor._source.system.details?.xp?.value) || 0;
  if ( build.xp > current ) update["system.details.xp.value"] = build.xp;
  update[`flags.${MODULE_ID}.pendingBuild.xpApplied`] = true;
}

export function addPendingBuildBanner(app) {
  const actor = app.actor ?? app.document;
  const build = actor?.getFlag(MODULE_ID, "pendingBuild");
  const content = app.element?.querySelector(".window-content");
  content?.querySelector(".zin-build-banner")?.remove();
  if ( !build || !content ) return;

  const update = {};
  if ( actor.isOwner ) applyPendingXp(actor, build, update);
  if ( buildDone(actor, build) ) {
    if ( actor.isOwner ) {
      delete update[`flags.${MODULE_ID}.pendingBuild.xpApplied`];
      update[`flags.${MODULE_ID}.-=pendingBuild`] = null;
      actor.update(update).then(() => ui.notifications.info(i18n("BuildFinished", { name: actor.name })));
    }
    return;
  }
  if ( !foundry.utils.isEmpty(update) ) actor.update(update);

  const steps = [];
  const legacy = build.legacy ?? {};
  if ( !build.classes?.length && legacy.class ) {
    steps.push({ done: actor.items.some(i => i.type === "class"), label: i18n("BuildClass"), text: legacy.class });
  }
  if ( !build.species && legacy.race ) {
    steps.push({ done: actor.items.some(i => i.type === "race"), label: i18n("BuildSpecies"), text: legacy.race });
  }
  if ( !build.background && legacy.background ) {
    steps.push({ done: actor.items.some(i => i.type === "background"), label: i18n("BuildBackground"), text: legacy.background });
  }
  for ( const cls of build.classes ?? [] ) {
    const sub = cls.subclass ? ` · ${refLabel(cls.subclass)}` : "";
    steps.push({ done: actor.items.some(i => i.type === "class"), label: i18n("BuildClass"), text: `${refLabel(cls)}, ${i18n("Level")} ${cls.level}${sub}` });
  }
  if ( build.species ) {
    const sub = build.species.subrace ? ` · ${refLabel(build.species.subrace)}` : "";
    steps.push({ done: actor.items.some(i => i.type === "race"), label: i18n("BuildSpecies"), text: `${refLabel(build.species)}${sub}` });
  }
  if ( build.background ) {
    steps.push({ done: actor.items.some(i => i.type === "background"), label: i18n("BuildBackground"), text: refLabel(build.background) });
  }

  // Faixa fina entre o cabeçalho e as abas (no topo ela ficaria atrás da barra da janela).
  const banner = document.createElement("section");
  banner.className = "zin-build-banner";
  banner.dataset.tooltip = i18n("BuildHint");
  banner.innerHTML = `
    <strong class="zin-build-title"><i class="fa-solid fa-hammer" inert></i> ${i18n("BuildTitle")}</strong>
    <ul class="zin-build-steps">${steps.map(s => `
      <li class="${s.done ? "done" : ""}">
        <i class="fa-solid ${s.done ? "fa-circle-check" : "fa-circle"}" inert></i>
        <span class="zin-build-label">${s.label}</span> ${s.text}
      </li>`).join("")}
    </ul>
    <div class="zin-build-actions">
      ${app.isEditable ? `<button type="button" data-zin="plutonium"><i class="fa-solid fa-atom" inert></i> ${i18n("BuildOpenPlutonium")}</button>` : ""}
      ${actor.isOwner ? `<button type="button" class="zin-build-dismiss" data-zin="dismiss" data-tooltip="${i18n("BuildDismiss")}" aria-label="${i18n("BuildDismiss")}"><i class="fa-solid fa-xmark" inert></i></button>` : ""}
    </div>`;
  banner.querySelector('[data-zin="plutonium"]')?.addEventListener("click", event => {
    if ( !openPlutoniumImport(app, event) ) ui.notifications.warn(i18n("BuildNoPlutonium"));
  });
  banner.querySelector('[data-zin="dismiss"]')?.addEventListener("click", () => actor.unsetFlag(MODULE_ID, "pendingBuild"));

  const header = content.querySelector(":scope > .sheet-header");
  if ( header ) header.after(banner);
  else content.prepend(banner);
}
