/**
 * Aba "Diário": entradas com data, título e texto, guardadas em flags["zintharion-dnd5e"].diary
 * ({ [id]: { title, date, body, createdAt } }). Vão junto com a ficha para o site.
 *
 * O diário funciona no modo Jogar da ficha (não precisa abrir o cadeado): todos os controles
 * levam a classe `always-interactive`, senão o dnd5e os desativa.
 */
import { MODULE_ID } from "../constants.mjs";
import { getCollapseSet, setCollapseSet } from "./collapse.mjs";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** HTML antigo (do editor do Foundry) → texto com quebras de linha. */
function htmlToText(html) {
  const withBreaks = String(html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

const stripHtml = html => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** Remove uma chave de flag (v14: ForcedDeletion; v13: "-="). */
function deletionUpdate(path, key) {
  const Del = foundry.data?.operators?.ForcedDeletion;
  return Del ? { [`${path}.${key}`]: new Del() } : { [`${path}.-=${key}`]: null };
}

/** Contexto da aba: entradas mais recentes primeiro. */
export async function prepareDiaryContext(sheet) {
  const actor = sheet.actor;
  const raw = actor.getFlag(MODULE_ID, "diary") ?? {};
  const open = getCollapseSet(actor, "diary");
  const entries = Object.entries(raw)
    .filter(([, e]) => e && (typeof e === "object"))
    .map(([id, e]) => ({ id, title: e.title ?? "", date: e.date ?? "", body: e.body ?? "", createdAt: e.createdAt ?? 0 }))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt - a.createdAt));

  for ( const [i, entry] of entries.entries() ) {
    // Sem preferência salva: só a entrada mais recente começa aberta.
    entry.expanded = open ? open.has(entry.id) : (i === 0);
    const text = stripHtml(entry.body);
    entry.preview = text.length > 140 ? `${text.slice(0, 140)}…` : text;
    entry.dateLabel = entry.date ? new Date(`${entry.date}T12:00:00`).toLocaleDateString(game.i18n.lang) : "";
    entry.search = `${entry.title} ${entry.dateLabel} ${text}`.toLowerCase();
    entry.text = /<[a-z][\s\S]*>/i.test(entry.body) ? htmlToText(entry.body) : entry.body;
  }
  return { entries, count: entries.length, canEdit: sheet.isEditable };
}

/* -------------------------------------------- */
/*  Ações (this = ficha)                        */
/* -------------------------------------------- */

function rememberOpen(actor, ids, open) {
  const set = getCollapseSet(actor, "diary") ?? new Set();
  for ( const id of ids ) {
    if ( open ) set.add(id);
    else set.delete(id);
  }
  setCollapseSet(actor, "diary", set);
}

/** Guarda o estado atual da tela (quais entradas estão abertas) antes de mudar algo. */
function snapshotOpen(sheet) {
  const ids = [...sheet.element.querySelectorAll(".zin-diary-entry:not(.zin-collapsed)")].map(e => e.dataset.entryId);
  setCollapseSet(sheet.actor, "diary", new Set(ids));
}

export async function onDiaryAdd() {
  await flushDiary(this);
  const actor = this.actor;
  const id = foundry.utils.randomID();
  const count = Object.keys(actor.getFlag(MODULE_ID, "diary") ?? {}).length;
  snapshotOpen(this);
  rememberOpen(actor, [id], true);
  this._zinDiaryFocus = id;
  await actor.update({
    [`flags.${MODULE_ID}.diary.${id}`]: {
      title: game.i18n.format("ZINTHARION.Diary.DefaultTitle", { n: count + 1 }),
      date: today(),
      body: "",
      createdAt: Date.now()
    }
  });
}

export async function onDiaryDelete(event, target) {
  await flushDiary(this);
  const id = target.closest("[data-entry-id]")?.dataset.entryId;
  if ( !id ) return;
  const entry = this.actor.getFlag(MODULE_ID, `diary.${id}`);
  const title = foundry.utils.escapeHTML(entry?.title || game.i18n.localize("ZINTHARION.Diary.Untitled"));
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize("ZINTHARION.Diary.Delete"), icon: "fas fa-trash" },
    content: `<p>${game.i18n.format("ZINTHARION.Diary.DeleteConfirm", { title })}</p>`,
    rejectClose: false
  });
  if ( ok ) await this.actor.update(deletionUpdate(`flags.${MODULE_ID}.diary`, id));
}

/** Abre/fecha uma entrada. Abrir monta o editor dessa entrada (renderiza só a aba). */
export function onDiaryToggle(event, target) {
  const entry = target.closest(".zin-diary-entry");
  if ( !entry ) return;
  const opening = entry.classList.contains("zin-collapsed");
  snapshotOpen(this);
  rememberOpen(this.actor, [entry.dataset.entryId], opening);
  if ( opening && !entry.querySelector(".zin-diary-body") ) return this.render({ parts: ["diary"] });
  entry.classList.toggle("zin-collapsed", !opening);
  entry.querySelector(".zin-collapse-toggle")?.setAttribute("aria-expanded", String(opening));
}

export function onDiaryCollapse(event, target) {
  const open = target.dataset.mode === "expand";
  const ids = [...this.element.querySelectorAll(".zin-diary-entry")].map(e => e.dataset.entryId);
  setCollapseSet(this.actor, "diary", new Set(open ? ids : []));
  this.render({ parts: ["diary"] });
}

/** Busca, foco na entrada nova e atalhos. Roda a cada render. */
export function bindDiary(sheet) {
  const tab = sheet.element?.querySelector(".tab.zin-diary");
  if ( !tab ) return;

  const input = tab.querySelector("[data-zin-diary-search]");
  if ( input && !input.dataset.bound ) {
    input.dataset.bound = "1";
    const apply = () => {
      const query = input.value.trim().toLowerCase();
      let shown = 0;
      for ( const entry of tab.querySelectorAll(".zin-diary-entry") ) {
        const match = !query || entry.dataset.search.includes(query);
        entry.hidden = !match;
        if ( match ) shown++;
      }
      const none = tab.querySelector(".zin-diary-noresults");
      if ( none ) none.hidden = shown > 0;
    };
    input.addEventListener("input", apply);
    // Enter não envia o formulário da ficha; Esc limpa a busca.
    input.addEventListener("keydown", event => {
      if ( event.key === "Enter" ) event.preventDefault();
      if ( event.key === "Escape" && input.value ) {
        event.preventDefault();
        event.stopPropagation();
        input.value = "";
        apply();
      }
    });
    if ( sheet._zinDiaryQuery ) {
      input.value = sheet._zinDiaryQuery;
      apply();
    }
    input.addEventListener("change", event => {
      event.stopPropagation(); // a busca não é um campo da ficha
      sheet._zinDiaryQuery = input.value;
    });
  }

  bindAutosave(sheet, tab);

  // Entrada recém-criada: foco no título já selecionado.
  if ( sheet._zinDiaryFocus ) {
    const title = tab.querySelector(`.zin-diary-entry[data-entry-id="${sheet._zinDiaryFocus}"] input.zin-diary-title`);
    delete sheet._zinDiaryFocus;
    if ( title ) {
      title.scrollIntoView({ block: "nearest" });
      title.focus();
      title.select();
    }
  }
}

/* -------------------------------------------- */
/*  Salvar sozinho                              */
/* -------------------------------------------- */

const SAVE_DELAY = 700;

/**
 * Título, data e texto salvam sozinhos enquanto a pessoa digita, direto na flag do ator e
 * sem renderizar a ficha (não perde o foco nem o cursor). O formulário da ficha não vê
 * esses campos (sem "name" e com o "change" interrompido aqui).
 */
function bindAutosave(sheet, tab) {
  const timers = sheet._zinDiaryTimers ??= new Map();

  const save = async field => {
    const entry = field.closest(".zin-diary-entry");
    const id = entry?.dataset.entryId;
    const key = field.dataset.zinDiaryField;
    if ( !id || !key ) return;
    const status = entry.querySelector(".zin-diary-status");
    const value = field.value;
    if ( value === field.dataset.saved ) return;
    try {
      if ( status ) status.textContent = game.i18n.localize("ZINTHARION.Diary.Saving");
      await sheet.actor.update({ [`flags.${MODULE_ID}.diary.${id}.${key}`]: value }, { render: false });
      field.dataset.saved = value;
      if ( status ) status.textContent = game.i18n.localize("ZINTHARION.Diary.Saved");
      if ( key !== "date" ) entry.dataset.search = `${entry.dataset.search ?? ""} ${value}`.toLowerCase();
    } catch (err) {
      console.error(`${MODULE_ID} | Diário`, err);
      if ( status ) status.textContent = game.i18n.localize("ZINTHARION.Diary.SaveError");
    }
  };

  const flush = field => {
    const timer = timers.get(field);
    if ( timer ) clearTimeout(timer);
    timers.delete(field);
    return save(field);
  };

  for ( const field of tab.querySelectorAll("[data-zin-diary-field]") ) {
    if ( field.dataset.bound ) continue;
    field.dataset.bound = "1";
    field.dataset.saved = field.value;
    field.addEventListener("input", () => {
      clearTimeout(timers.get(field));
      timers.set(field, setTimeout(() => flush(field), SAVE_DELAY));
      const status = field.closest(".zin-diary-entry")?.querySelector(".zin-diary-status");
      if ( status ) status.textContent = "";
    });
    // Não deixa o formulário da ficha tratar esse campo (evita renderizar no meio da escrita).
    field.addEventListener("change", event => {
      event.stopPropagation();
      flush(field);
    });
    field.addEventListener("blur", () => flush(field));
    // Enter no título não envia nada; Ctrl+Enter no texto salva na hora.
    field.addEventListener("keydown", event => {
      if ( (event.key === "Enter") && (field.tagName === "INPUT") ) {
        event.preventDefault();
        flush(field);
      }
      if ( (event.key === "Enter") && (event.ctrlKey || event.metaKey) ) {
        event.preventDefault();
        flush(field);
      }
    });
  }
}

/** Salva o que estiver pendente (antes de fechar a ficha ou trocar de aba). */
export async function flushDiary(sheet) {
  const fields = sheet.element?.querySelectorAll("[data-zin-diary-field]") ?? [];
  for ( const field of fields ) {
    if ( field.value === field.dataset.saved ) continue;
    const id = field.closest(".zin-diary-entry")?.dataset.entryId;
    if ( !id ) continue;
    clearTimeout(sheet._zinDiaryTimers?.get(field));
    field.dataset.saved = field.value;
    await sheet.actor.update({ [`flags.${MODULE_ID}.diary.${id}.${field.dataset.zinDiaryField}`]: field.value }, { render: false });
  }
}
