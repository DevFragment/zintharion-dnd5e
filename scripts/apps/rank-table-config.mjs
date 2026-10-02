import { MODULE_ID, DEFAULT_RANK_TABLE } from "../constants.mjs";
import { getRankTable, getDetectedEmblem, detectRankEmblems, EMBLEM_FOLDER } from "../ranks.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Janela (só GM) para editar a tabela de ranks. */
export class RankTableConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "zintharion-rank-table",
    tag: "form",
    classes: ["zintharion", "zin-config"],
    window: {
      title: "ZINTHARION.Ranks.Title",
      icon: "fa-solid fa-ranking-star",
      resizable: true
    },
    position: { width: 620, height: "auto" },
    form: {
      handler: RankTableConfig.#onSubmit,
      closeOnSubmit: false,
      submitOnChange: false
    },
    actions: {
      addRow: RankTableConfig.#onAddRow,
      removeRow: RankTableConfig.#onRemoveRow,
      reset: RankTableConfig.#onReset,
      detect: RankTableConfig.#onDetect
    }
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/rank-table.hbs`, scrollable: [".zin-scroll"] },
    footer: { template: "templates/generic/form-footer.hbs" }
  };

  #rows = null;

  #invalid = new Set();

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.#rows ??= getRankTable().map(r => ({ ...r }));
    context.emblemFolder = EMBLEM_FOLDER;
    context.rows = this.#rows.map((r, i) => {
      const detected = getDetectedEmblem(r.rank);
      return {
        ...r,
        img: r.img ?? "",
        detected,
        emblemShown: r.img || detected || "",
        index: i,
        invalid: this.#invalid.has(i)
      };
    });
    context.buttons = [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "ZINTHARION.Ranks.Save" }];
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // Atualiza a prévia enquanto o GM digita ou escolhe cores.
    this.element.querySelectorAll("input[data-field]").forEach(input => {
      input.addEventListener("input", () => {
        const row = input.closest("tr");
        const chip = row?.querySelector(".zin-rank-chip");
        if ( !chip ) return;
        const get = f => row.querySelector(`input[data-field="${f}"]`)?.value;
        chip.textContent = get("rank");
        chip.style.background = get("bg");
        chip.style.color = get("fg");
      });
    });
  }

  #readForm() {
    if ( !this.element ) return;
    for ( const input of this.element.querySelectorAll("[data-field]") ) {
      const row = this.#rows[Number(input.dataset.index)];
      if ( !row ) continue;
      const field = input.dataset.field;
      const value = String(input.value ?? "");
      row[field] = (field === "min") ? Number(value) : value.trim();
    }
  }

  #validate() {
    this.#invalid.clear();
    const seen = new Set();
    this.#rows.forEach((r, i) => {
      const bad = !Number.isInteger(r.min) || (r.min < 0) || !r.rank || seen.has(r.min);
      seen.add(r.min);
      if ( bad ) this.#invalid.add(i);
    });
    return this.#invalid.size === 0;
  }

  static #onAddRow() {
    this.#readForm();
    const last = this.#rows.at(-1);
    this.#rows.push({ min: (last?.min ?? 0) + 1, rank: "?", bg: "#143842", fg: "#EDE6D3" });
    this.render();
  }

  static #onRemoveRow(event, target) {
    this.#readForm();
    const i = Number(target.dataset.index);
    if ( this.#rows.length <= 1 ) return;
    this.#rows.splice(i, 1);
    this.#invalid.clear();
    this.render();
  }

  static async #onDetect() {
    this.#readForm();
    await detectRankEmblems({ notify: true });
    this.render();
  }

  static #onReset() {
    this.#rows = DEFAULT_RANK_TABLE.map(r => ({ ...r }));
    this.#invalid.clear();
    this.render();
  }

  static async #onSubmit() {
    this.#readForm();
    if ( !this.#validate() ) {
      ui.notifications.error("ZINTHARION.Ranks.ErrorOrder", { localize: true });
      this.render();
      return;
    }
    const sorted = [...this.#rows].sort((a, b) => a.min - b.min);
    await game.settings.set(MODULE_ID, "rankTable", { ranks: sorted });
    ui.notifications.info("ZINTHARION.Ranks.Saved", { localize: true });
    this.close();
  }
}
