/**
 * Seções que abrem e fecham na ficha (inventário e diário).
 * O estado fica no navegador de cada pessoa, por ator — não mexe na ficha nem sincroniza com o site.
 */
import { MODULE_ID } from "../constants.mjs";

const storageKey = actor => `${MODULE_ID}.collapse.${actor.uuid}`;

function read(actor) {
  try { return JSON.parse(localStorage.getItem(storageKey(actor))) ?? {}; } catch { return {}; }
}

function write(actor, state) {
  try { localStorage.setItem(storageKey(actor), JSON.stringify(state)); } catch {}
}

/**
 * Lista de chaves guardada para um grupo ("inventory" = seções fechadas, "diary" = entradas abertas).
 * @returns {Set<string>|null}  null se nunca foi salvo.
 */
export function getCollapseSet(actor, group) {
  const list = read(actor)[group];
  return Array.isArray(list) ? new Set(list) : null;
}

export function setCollapseSet(actor, group, set) {
  const state = read(actor);
  state[group] = [...set];
  write(actor, state);
}

/* -------------------------------------------- */
/*  Inventário                                  */
/* -------------------------------------------- */

/** Chave estável da seção: atributos do sistema ou, sem eles, o nome (sem o contador). */
function sectionKey(section) {
  const data = { ...section.dataset };
  if ( Object.keys(data).length ) return JSON.stringify(data);
  const title = section.querySelector(".items-header .item-name");
  return title ? [...title.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join("").trim()
    || title.textContent.replace(/\d+$/, "").trim() : "";
}

function setSectionCollapsed(section, collapsed) {
  section.classList.toggle("zin-collapsed", collapsed);
  section.querySelector(".zin-collapse-toggle")?.setAttribute("aria-expanded", String(!collapsed));
}

/** Botões de abrir/fechar nas seções do inventário (Armas, Equipamento...). Roda a cada render. */
export function enhanceInventory(app) {
  const tab = app.element?.querySelector('.tab[data-tab="inventory"]');
  if ( !tab ) return;
  const actor = app.actor;
  const closed = getCollapseSet(actor, "inventory") ?? new Set();
  const sections = [...tab.querySelectorAll(".items-section")];

  const toggle = (section, collapsed) => {
    setSectionCollapsed(section, collapsed);
    const key = sectionKey(section);
    if ( collapsed ) closed.add(key);
    else closed.delete(key);
    setCollapseSet(actor, "inventory", closed);
  };

  for ( const section of sections ) {
    const header = section.querySelector(".items-header");
    const title = header?.querySelector(".item-name");
    if ( !title ) continue;
    if ( !title.querySelector(".zin-collapse-toggle") ) {
      // A seta fica dentro do título: o cabeçalho é alinhado com as colunas das linhas.
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zin-collapse-toggle always-interactive";
      button.setAttribute("aria-label", game.i18n.localize("ZINTHARION.Collapse.Toggle"));
      button.innerHTML = '<i class="fas fa-chevron-down" inert></i>';
      title.prepend(button);

      const count = section.querySelectorAll(".item-list > .item").length;
      if ( count ) {
        const badge = document.createElement("span");
        badge.className = "zin-count";
        badge.textContent = count;
        title.append(badge);
      }

      // Clicar em qualquer parte do cabeçalho abre/fecha (menos nos controles do sistema).
      header.classList.add("zin-collapsible-header");
      header.addEventListener("click", event => {
        if ( event.target.closest("a, input, select, [data-action]:not(.zin-collapse-toggle)") ) return;
        event.preventDefault();
        toggle(section, !section.classList.contains("zin-collapsed"));
      });
    }
    setSectionCollapsed(section, closed.has(sectionKey(section)));
  }

  // Abrir / fechar tudo, ao lado da busca do inventário.
  const bar = tab.querySelector(".inventory-element .middle");
  if ( bar && !bar.querySelector(".zin-collapse-all") ) {
    const group = document.createElement("div");
    group.className = "zin-collapse-all";
    for ( const mode of ["expand", "collapse"] ) {
      const label = game.i18n.localize(mode === "expand" ? "ZINTHARION.Collapse.ExpandAll" : "ZINTHARION.Collapse.CollapseAll");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "zin-tool always-interactive";
      button.dataset.tooltip = label;
      button.setAttribute("aria-label", label);
      button.innerHTML = `<i class="fas fa-angles-${mode === "expand" ? "down" : "up"}" inert></i>`;
      button.addEventListener("click", () => {
        for ( const section of tab.querySelectorAll(".items-section") ) toggle(section, mode === "collapse");
      });
      group.append(button);
    }
    bar.append(group);
  }
}
