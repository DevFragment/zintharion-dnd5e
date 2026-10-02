import { MODULE_ID } from "../constants.mjs";
import { getRank } from "../ranks.mjs";
import { addPlutoniumImportButton } from "../compat/plutonium.mjs";

const T = path => `modules/${MODULE_ID}/templates/sheet/${path}`;

/**
 * Cria a classe da ficha Zintharion. Precisa ser chamada depois do init do dnd5e,
 * porque estende a ficha de personagem do sistema.
 * @returns {typeof foundry.applications.api.ApplicationV2}
 */
export function createZintharionCharacterSheet() {
  const Base = dnd5e.applications.actor.CharacterActorSheet;

  return class ZintharionCharacterSheet extends Base {
    /** @override */
    static DEFAULT_OPTIONS = {
      classes: ["zintharion-layout"],
      position: { width: 1080, height: 940 }
    };

    /**
     * Partes da ficha: cabeçalho próprio + abas horizontais. As abas de conteúdo
     * continuam sendo as do dnd5e, então nenhuma função do sistema se perde.
     * @override
     */
    static PARTS = (() => {
      const base = foundry.utils.deepClone(Base.PARTS);
      const parts = {
        header: {
          template: T("header.hbs"),
          templates: [T("ability.hbs")]
        },
        tabs: {
          id: "tabs",
          classes: ["zin-tabs"],
          template: T("tabs.hbs")
        },
        // A antiga barra lateral vira a aba "Ficha" (favoritos, exaustão, morte).
        sidebar: {
          container: { classes: ["tab-body"], id: "tabs" },
          template: T("overview-tab.hbs"),
          templates: ["systems/dnd5e/templates/actors/character-sidebar.hbs"],
          scrollable: [""]
        }
      };
      for ( const [id, part] of Object.entries(base) ) {
        if ( ["header", "tabs", "sidebar", "abilityScores"].includes(id) ) continue;
        parts[id] = part;
      }
      return parts;
    })();

    /** @override */
    static TABS = [
      { tab: "sidebar", label: "ZINTHARION.Sheet.TabOverview", icon: "fas fa-scroll" },
      ...Base.TABS.map(t => {
        if ( t.tab === "details" ) return { ...t, label: "ZINTHARION.Sheet.TabCharacter", icon: "fas fa-user-shield" };
        return t;
      })
    ];

    /** Tamanho inicial maior que a ficha padrão (o layout é mais largo). */
    constructor(options={}) {
      options.position = { width: 1080, height: 940, ...(options.position ?? {}) };
      super(options);
    }

    /** Abre na aba "Personagem", como na referência. */
    tabGroups = { primary: "details" };

    /* -------------------------------------------- */

    /** Tira as abas verticais do sistema: aqui elas ficam na horizontal. */
    _initializeApplicationOptions(options) {
      const opts = super._initializeApplicationOptions(options);
      opts.classes = opts.classes.filter(c => c !== "vertical-tabs");
      return opts;
    }

    /* -------------------------------------------- */

    /** @inheritDoc */
    async _onRender(context, options) {
      // A aba "Ficha" reaproveita o bloco lateral do sistema só pelos favoritos.
      // O cartão antigo (retrato, vida, CA...) é removido do DOM: se ficasse, os campos
      // de vida apareceriam duas vezes no formulário e a ficha não salvaria.
      this.element.querySelectorAll(".zin-overview .sidebar > .card").forEach(el => el.remove());
      await super._onRender(context, options);
      try { addPlutoniumImportButton(this); } catch (err) { console.warn(`${MODULE_ID} | Plutonium Import`, err); }
    }

    /* -------------------------------------------- */

    /** @inheritDoc */
    async _preparePartContext(partId, context, options) {
      context = await super._preparePartContext(partId, context, options);
      if ( (partId === "header") && !this.actor.limited ) await this.#prepareZinHeader(context, options);
      if ( partId === "tabs" ) context.zinLogo = game.settings.get(MODULE_ID, "logoPath") || null;
      return context;
    }

    /* -------------------------------------------- */

    /**
     * Junta no cabeçalho o que antes ficava na barra lateral e nos atributos.
     * @param {object} context
     * @param {object} options
     */
    async #prepareZinHeader(context, options) {
      // Retrato, velocidade, exaustão e morte (mesmos dados da barra lateral do sistema).
      await this._prepareSidebarContext(context, options);

      const actor = this.actor;
      const system = actor.system;
      const level = system.details?.level ?? 0;

      context.zinAbilities = this._prepareAbilities(context).map(a => ({
        ...a,
        proficientSave: (a.proficient ?? 0) > 0
      }));

      // Linha de detalhes: classe, espécie, antecedente, tendência, deslocamento, sentidos.
      const bits = [];
      const species = actor.items.find(i => i.type === "race");
      const background = actor.items.find(i => i.type === "background");
      if ( species ) bits.push(species.name);
      if ( background ) bits.push(background.name);
      if ( system.details?.alignment ) bits.push(system.details.alignment);
      context.zinDetails = bits;

      const movement = [];
      for ( const [key, cfg] of Object.entries(CONFIG.DND5E.movementTypes ?? {}) ) {
        if ( cfg.hidden ) continue;
        const value = system.attributes?.movement?.speeds?.[key] ?? system.attributes?.movement?.[key];
        if ( value ) movement.push({ label: cfg.label, value, units: system.attributes.movement.units ?? "" });
      }
      context.zinMovement = movement;

      const rank = getRank(level);
      context.zinRank = rank;
      context.zinShowRank = game.settings.get(MODULE_ID, "showRank") && !!rank;
      context.zinRankTooltip = rank ? game.i18n.format("ZINTHARION.Sheet.Rank", { rank: rank.rank }) : "";
      context.zinLevel = level;
      context.zinHeaderArt = context.portrait?.src ?? actor.img;
      // Só mostra a CD se a ficha tiver atributo de conjuração (sem classe conjuradora sairia "CD 9 ()").
      context.zinSpellDC = system.attributes?.spellcasting ? (system.attributes?.spell?.dc ?? null) : null;
      context.zinSpellAbility = CONFIG.DND5E.abilities[system.attributes?.spellcasting]?.abbreviation ?? "";
    }
  };
}
