/**
 * Chamadas ao site Zintharion. O endereço fica na configuração do mundo; o token é de cada usuário.
 */
import { MODULE_ID } from "../constants.mjs";

export class SiteError extends Error {
  constructor(message, status=0, data={}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

export function siteConfig() {
  const url = String(game.settings.get(MODULE_ID, "siteUrl") ?? "").trim().replace(/\/+$/, "");
  const token = String(game.settings.get(MODULE_ID, "siteToken") ?? "").trim();
  return { url, token, ready: !!(url && token) };
}

/** Endereço público de uma página do site (para abrir no navegador). */
export const sitePage = path => `${siteConfig().url}${path}`;

async function gzip(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Response(stream).arrayBuffer();
}

/**
 * @param {string} path              ex.: "/api/foundry/me"
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {object} [options.body]    Enviado como JSON (comprimido com gzip se for grande).
 * @param {object} [options.query]
 */
export async function siteRequest(path, { method="GET", body, query }={}) {
  const { url, token, ready } = siteConfig();
  if ( !ready ) throw new SiteError(game.i18n.localize("ZINTHARION.Sync.NotConfigured"), 0);

  const target = new URL(`${url}${path}`);
  for ( const [k, v] of Object.entries(query ?? {}) ) if ( (v !== undefined) && (v !== null) ) target.searchParams.set(k, v);

  const headers = { Authorization: `Bearer ${token}` };
  let payload;
  if ( body !== undefined ) {
    const text = JSON.stringify(body);
    headers["Content-Type"] = "application/json";
    if ( (text.length > 200_000) && (typeof CompressionStream === "function") ) {
      payload = await gzip(text);
      headers["X-Zin-Encoding"] = "gzip";
    } else payload = text;
  }

  let response;
  try {
    response = await fetch(target, { method, headers, body: payload });
  } catch (err) {
    console.error(`${MODULE_ID} | Site`, err);
    throw new SiteError(game.i18n.format("ZINTHARION.Sync.Unreachable", { url }), 0);
  }

  let data = {};
  try { data = await response.json(); } catch { data = {}; }
  if ( !response.ok ) throw new SiteError(data.error || `HTTP ${response.status}`, response.status, data);
  return data;
}
