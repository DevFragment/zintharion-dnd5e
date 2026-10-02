/**
 * Compatibilidade com o Plutonium.
 *
 * 1) Botão "Subir de nível": o Plutonium só coloca o botão em fichas que ele conhece,
 *    pelo nome da classe da ficha. Durante o aviso de render da ficha Zintharion,
 *    apresentamos a ficha com um nome que ele reconhece e cujo único alvo é o
 *    elemento `.level-information` — que existe só na nossa ficha, num espaço reservado.
 *    Assim o botão aparece no topo da ficha, ao lado dos descansos, sem afetar a ficha padrão.
 *
 * 2) Diamante Astral na Loja de Equipamentos: o Plutonium soma só PC/PP/PE/PO/PL ao calcular
 *    o dinheiro disponível, então o DA era ignorado (e podia até ser zerado após uma compra).
 *    Aqui incluímos as moedas extras do sistema (DA) nessa soma.
 */
import { MODULE_ID } from "../constants.mjs";

const PLUTONIUM_ID = "plutonium";

/** Nome de ficha que o Plutonium associa ao alvo `.level-information`. */
const LEVEL_UP_SHEET_ALIAS = "Tidy5eSheet";

const STANDARD_COINS = ["cp", "sp", "ep", "gp", "pp"];

const PATCHED = Symbol.for(`${MODULE_ID}.plutoniumPatched`);

const isPlutoniumActive = () => !!game.modules?.get(PLUTONIUM_ID)?.active;

/* -------------------------------------------- */
/*  Botão de subir de nível                     */
/* -------------------------------------------- */

const aliasCache = new WeakMap();

function getAlias(cls) {
  let alias = aliasCache.get(cls);
  if ( !alias ) {
    // Subclasse vazia: mesmos dados estáticos da ficha, só o nome muda.
    alias = class extends cls {};
    Object.defineProperty(alias, "name", { value: LEVEL_UP_SHEET_ALIAS });
    aliasCache.set(cls, alias);
  }
  return alias;
}

/**
 * Precisa ser chamado quando o script carrega (antes do "ready"), para rodar
 * antes do aviso de render do Plutonium, que é registrado no "ready" dele.
 */
export function registerPlutoniumLevelUp() {
  Hooks.on("renderActorSheetV2", app => {
    try {
      if ( !app?.options?.classes?.includes("zintharion-layout") ) return;
      if ( !isPlutoniumActive() ) return;
      const cls = app.constructor;
      Object.defineProperty(app, "constructor", { value: getAlias(cls), configurable: true, writable: true });
      // O Plutonium lê o nome na hora; depois do aviso a ficha volta ao normal.
      queueMicrotask(() => { delete app.constructor; });
    } catch (err) {
      console.warn(`${MODULE_ID} | Plutonium: botão de nível`, err);
    }
  });
}

/* -------------------------------------------- */
/*  Diamante Astral na loja                     */
/* -------------------------------------------- */

const extraCoins = () => Object.keys(CONFIG.DND5E.currencies ?? {}).filter(k => !STANDARD_COINS.includes(k));

/** Valor em peças de cobre das moedas extras (DA) guardadas no estado da loja. */
function extraCoinsAsCopper(state) {
  const currencies = CONFIG.DND5E.currencies;
  const cpPerGp = currencies.cp?.conversion ?? 100;
  let total = 0;
  for ( const coin of extraCoins() ) {
    const conversion = currencies[coin]?.conversion;
    if ( !conversion ) continue;
    total += (Number(state?.[coin]) || 0) * (cpPerGp / conversion);
  }
  return total;
}

/** Encontra o protótipo dono de `_getAvailableCp` e inclui o DA na soma. */
function patchCurrencyManager(instance) {
  let proto = Object.getPrototypeOf(instance);
  while ( proto && !Object.prototype.hasOwnProperty.call(proto, "_getAvailableCp") ) proto = Object.getPrototypeOf(proto);
  if ( !proto ) return false;

  const original = proto._getAvailableCp;
  if ( original[PATCHED] ) return true;
  // Se uma versão futura do Plutonium já somar todas as moedas do sistema, não mexe.
  if ( /getCurrencyDenominations|\bda\b/.test(String(original)) ) return true;

  const wrapped = function() {
    return original.call(this) + extraCoinsAsCopper(this._state);
  };
  wrapped[PATCHED] = true;
  proto._getAvailableCp = wrapped;
  console.log(`${MODULE_ID} | Plutonium: Diamante Astral incluído no dinheiro da Loja de Equipamentos.`);
  return true;
}

export function patchPlutoniumCurrency() {
  if ( !isPlutoniumActive() || !extraCoins().length ) return;
  const BaseComponent = globalThis.BaseComponent;
  const original = BaseComponent?.prototype?._proxyAssignSimple;
  if ( (typeof original !== "function") || original[PATCHED] ) return;

  let done = false;
  const wrapped = function(hookProp, ...args) {
    // A loja carrega o dinheiro do personagem por aqui; na primeira vez, corrigimos a soma.
    if ( !done && (hookProp === "state") && (typeof this?._getAvailableCp === "function")
      && (typeof this?.setCurrencyFromActor === "function") ) {
      try { done = patchCurrencyManager(this); } catch (err) {
        done = true;
        console.warn(`${MODULE_ID} | Plutonium: moedas`, err);
      }
    }
    return original.call(this, hookProp, ...args);
  };
  wrapped[PATCHED] = true;
  BaseComponent.prototype._proxyAssignSimple = wrapped;
}

/* -------------------------------------------- */
/*  Botão "Plutonium Import" no topo da janela  */
/* -------------------------------------------- */

/** Acha o controle "Plutonium Import" entre os controles do menu ⋮ da ficha. */
function findImportControl(app) {
  if ( typeof app._headerControlButtons !== "function" ) return null;
  for ( const control of app._headerControlButtons() ) {
    const icon = String(control.icon ?? "");
    if ( /\bfa-atom\b|\bfa-d-and-d\b/.test(icon) || (control.label === "Plutonium Import") ) return control;
  }
  return null;
}

/**
 * Abre o "Plutonium Import" desta ficha (usado pelo aviso de montagem de fichas vindas do site).
 * @returns {boolean} false se o Plutonium não estiver ativo ou a ficha não tiver o controle.
 */
export function openPlutoniumImport(app, event) {
  if ( !isPlutoniumActive() ) return false;
  const control = findImportControl(app);
  if ( typeof control?.onClick !== "function" ) return false;
  control.onClick(event);
  return true;
}

/**
 * Coloca o atalho do "Plutonium Import" na barra superior da janela, ao lado do menu ⋮.
 * O item continua existindo no menu; aqui é só um botão visível para ele.
 */
export function addPlutoniumImportButton(app) {
  const header = app.element?.querySelector(".window-header");
  if ( !header || header.querySelector(".zin-plut-import") ) return;
  if ( !isPlutoniumActive() || !app.isEditable ) return;

  const control = findImportControl(app);
  if ( !control ) return;

  const label = game.i18n.localize(control.label);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `header-control icon ${control.icon} zin-plut-import`;
  btn.dataset.tooltip = label;
  btn.setAttribute("aria-label", label);
  btn.addEventListener("pointerdown", event => event.stopPropagation());
  btn.addEventListener("dblclick", event => event.stopPropagation());
  btn.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    // Busca de novo na hora do clique (permissões podem ter mudado).
    const current = findImportControl(app);
    if ( typeof current?.onClick === "function" ) current.onClick(event);
  });

  const toggle = header.querySelector('[data-action="toggleControls"]');
  if ( toggle ) toggle.before(btn);
  else header.append(btn);
}
