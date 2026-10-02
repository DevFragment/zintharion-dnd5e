import { MODULE_ID } from "./constants.mjs";
import { getRank } from "./ranks.mjs";

/**
 * Decora a ficha de personagem do dnd5e: tema, brasão e selo de rank.
 * @param {foundry.applications.api.ApplicationV2} app
 * @param {HTMLElement} element
 */
export function decorateCharacterSheet(app, element) {
  const actor = app.actor ?? app.document;
  if ( actor?.type !== "character" ) return;

  // Tema (preferência de cada usuário)
  const themed = game.settings.get(MODULE_ID, "theme");
  element.classList.toggle("zintharion-theme", themed);

  const header = element.querySelector(".sheet-header");
  if ( !header ) return;

  const zinLayout = header.classList.contains("zin-header");

  // Ficha Zintharion: brasão e rank já vêm no próprio template. Só anima o "rank up".
  if ( zinLayout ) {
    const medal = header.querySelector(".zin-rank-medal");
    const rank = getRank(actor.system?.details?.level ?? 0)?.rank;
    const previous = lastRanks.get(actor.uuid);
    if ( medal && previous && rank && (previous !== rank) ) medal.classList.add("zin-rank-up");
    if ( rank ) lastRanks.set(actor.uuid, rank);
    return;
  }

  // Brasão
  element.querySelectorAll(".zin-logo").forEach(n => n.remove());
  const logoPath = game.settings.get(MODULE_ID, "logoPath");
  if ( logoPath ) {
    const img = document.createElement("img");
    img.className = "zin-logo";
    img.src = logoPath;
    img.alt = "";
    if ( zinLayout ) header.querySelector(".zin-name-row")?.prepend(img);
    else {
      header.prepend(img);
      header.classList.add("zin-has-logo");
    }
  } else {
    header.classList.remove("zin-has-logo");
  }

  // Rank
  element.querySelectorAll(".zin-rank-badge, .zin-rank-inline, .zin-rank-crest").forEach(n => n.remove());
  if ( !game.settings.get(MODULE_ID, "showRank") ) return;
  const level = actor.system?.details?.level ?? 0;
  const rank = getRank(level);
  if ( !rank ) return;
  const tooltip = game.i18n.format("ZINTHARION.Sheet.Rank", { rank: rank.rank });

  // 1) Indicador compacto ao lado da classe: "WIZARD 1 ◆ RANK F"
  const classLine = zinLayout ? header.querySelector(".zin-name-row") : header.querySelector(".left .class");
  if ( classLine ) {
    const inline = document.createElement("span");
    inline.className = "zin-rank-inline";
    inline.style.setProperty("--zin-rank-bg", rank.bg);
    inline.innerHTML = `<i class="fa-solid fa-diamond" inert></i> Rank <b></b>`;
    inline.querySelector("b").textContent = rank.rank;
    classLine.append(inline);
  }

  // 2) Brasão de rank sobre o retrato, estilo jogo
  const portrait = zinLayout
    ? header.querySelector(".zin-portrait")
    : element.querySelector(".sidebar .card .portrait");
  if ( !portrait ) return;
  const crest = document.createElement("div");
  crest.className = "zin-rank-crest";
  crest.style.setProperty("--zin-rank-bg", rank.bg);
  crest.style.setProperty("--zin-rank-fg", rank.fg);
  crest.dataset.tooltip = tooltip;
  crest.setAttribute("aria-label", tooltip);

  const aura = document.createElement("span");
  aura.className = "zin-rank-aura";
  crest.append(aura);

  if ( rank.img ) {
    const holder = document.createElement("span");
    holder.className = "zin-rank-emblem-holder";
    const emblem = document.createElement("img");
    emblem.className = "zin-rank-emblem";
    emblem.src = rank.img;
    emblem.alt = "";
    // Brilho que passa por cima do emblema, recortado no formato da imagem.
    const shine = document.createElement("span");
    shine.className = "zin-rank-shine";
    const url = `url("${encodeURI(rank.img)}")`;
    shine.style.maskImage = url;
    shine.style.webkitMaskImage = url;
    holder.append(emblem, shine);
    crest.append(holder);
  } else {
    const glyph = document.createElement("span");
    glyph.className = "zin-rank-glyph";
    glyph.textContent = rank.rank;
    crest.append(glyph);
  }

  const ribbon = document.createElement("span");
  ribbon.className = "zin-rank-ribbon";
  ribbon.innerHTML = `<small>Rank</small><b></b>`;
  ribbon.querySelector("b").textContent = rank.rank;
  crest.append(ribbon);

  // Animação de "rank up" quando o rank muda com a ficha aberta.
  const previous = lastRanks.get(actor.uuid);
  if ( previous && (previous !== rank.rank) ) crest.classList.add("zin-rank-up");
  lastRanks.set(actor.uuid, rank.rank);

  portrait.append(crest);
}

/** Último rank mostrado por ficha (para animar o rank up). */
const lastRanks = new Map();

/** Re-renderiza todas as fichas de personagem abertas. */
export function refreshCharacterSheets() {
  for ( const app of foundry.applications.instances.values() ) {
    const actor = app.actor ?? app.document;
    if ( (actor?.documentName === "Actor") && (actor.type === "character") && app.rendered ) app.render();
  }
}
