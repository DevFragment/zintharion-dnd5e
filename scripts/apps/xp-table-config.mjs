import { MODULE_ID, DEFAULT_XP_TABLE } from "../constants.mjs";
import { getXpTable } from "../progression.mjs";
import { getRank } from "../ranks.mjs";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Janela (só GM) para editar a tabela de experiência de Zintharion. */
export class XpTableConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "zintharion-xp-table",
    tag: "form",
    classes: ["zintharion", "zin-config"],
    window: {
      title: "ZINTHARION.XP.Title",
      icon: "fa-solid fa-chart-line",
      resizable: true
    },
    position: { width: 560, height: "auto" },
    form: {
      handler: XpTableConfig.#onSubmit,
      closeOnSubmit: false,
      submitOnChange: false
    },
    actions: {
      addRow: XpTableConfig.#onAddRow,
      removeRow: XpTableConfig.#onRemoveRow,
      reset: XpTableConfig.#onReset,
      importJson: XpTableConfig.#onImport,
      exportJson: XpTableConfig.#onExport
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/xp-table.hbs`, scrollable: [".zin-scroll"] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  /** Valores em edição (ainda não salvos). */
  #rows = null;

  /** Índices com erro na última validação. */
  #invalid = new Set();

  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.#rows ??= getXpTable();
    const rows = this.#rows;
    context.rows = rows.map((xp, i) => {
      const next = (i < rows.length - 1) ? (rows[i + 1] - xp) : null;
      return {
        index: i,
        level: i + 1,
        xp,
        first: i === 0,
        next: next === null ? "—" : next.toLocaleString(game.i18n.lang),
        rank: getRank(i + 1),
        provisional: i >= 20,
        invalid: this.#invalid.has(i)
      };
    });
    context.maxLevel = rows.length;
    context.buttons = [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "ZINTHARION.XP.Save" }];
    return context;
  }

  /* -------------------------------------------- */

  /** Lê os campos da janela para o estado interno. */
  #readForm() {
    if ( !this.element ) return;
    for ( const input of this.element.querySelectorAll("input[data-xp-index]") ) {
      const i = Number(input.dataset.xpIndex);
      const value = Number(input.value);
      this.#rows[i] = Number.isFinite(value) ? value : NaN;
    }
    this.#rows[0] = 0;
  }

  /** Valida: inteiros ≥ 0 e estritamente crescentes. */
  #validate() {
    this.#invalid.clear();
    this.#rows.forEach((xp, i) => {
      const bad = !Number.isInteger(xp) || (xp < 0) || ((i > 0) && !(xp > this.#rows[i - 1]));
      if ( bad ) this.#invalid.add(i);
    });
    return this.#invalid.size === 0;
  }

  /* -------------------------------------------- */

  static #onAddRow() {
    this.#readForm();
    const rows = this.#rows;
    const last = rows.at(-1) ?? 0;
    const step = rows.length >= 2 ? Math.max(1, last - rows.at(-2)) : 300;
    rows.push(last + step);
    this.render();
  }

  static #onRemoveRow() {
    this.#readForm();
    if ( this.#rows.length <= 1 ) {
      ui.notifications.warn("ZINTHARION.XP.ErrorMin", { localize: true });
      return;
    }
    this.#rows.pop();
    this.#invalid.delete(this.#rows.length);
    this.render();
  }

  static async #onReset() {
    const ok = await DialogV2.confirm({
      window: { title: "ZINTHARION.XP.Reset" },
      content: `<p>${game.i18n.localize("ZINTHARION.XP.ResetConfirm")}</p>`,
      rejectClose: false
    });
    if ( !ok ) return;
    this.#rows = [...DEFAULT_XP_TABLE];
    this.#invalid.clear();
    this.render();
  }

  static async #onImport() {
    this.#readForm();
    const text = await DialogV2.prompt({
      window: { title: "ZINTHARION.XP.Import" },
      content: `<p>${game.i18n.localize("ZINTHARION.XP.ImportPrompt")}</p>
        <textarea name="json" rows="8" style="width:100%">${JSON.stringify(this.#rows)}</textarea>`,
      ok: { label: "ZINTHARION.XP.Import", callback: (event, button) => button.form.elements.json.value },
      rejectClose: false
    });
    if ( !text ) return;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    if ( !Array.isArray(parsed) || !parsed.length || parsed.some(n => !Number.isFinite(Number(n))) ) {
      ui.notifications.error("ZINTHARION.XP.ErrorImport", { localize: true });
      return;
    }
    this.#rows = parsed.map(Number);
    this.#rows[0] = 0;
    this.#validate();
    this.render();
  }

  static #onExport() {
    this.#readForm();
    game.clipboard.copyPlainText(JSON.stringify(this.#rows));
    ui.notifications.info("ZINTHARION.XP.Copied", { localize: true });
  }

  static async #onSubmit() {
    this.#readForm();
    if ( !this.#validate() ) {
      ui.notifications.error("ZINTHARION.XP.ErrorOrder", { localize: true });
      this.render();
      return;
    }
    await game.settings.set(MODULE_ID, "xpTable", { levels: [...this.#rows] });
    ui.notifications.info(game.i18n.format("ZINTHARION.XP.Saved", { max: this.#rows.length }));
    this.close();
  }
}
