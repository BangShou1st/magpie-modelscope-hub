// 模型列表。
//
// provider.models 钩子每次列 provider 时被问一次（magpie 用该 provider 的
// 第一个账号身份来问），所以缓存按 token 存在，30 分钟内不重复打 /models。
// 登录前或不登录时，返回 config 里那份内置兜底 —— 账号卡片不会空着。
//
// 钩子返回的必须是「完整的 OpenCode 模型形态」：magpie 原样接收钩子的条目，
// 精简声明会被读成不支持推理、不支持工具、不能看图。

import { PATHS, TIMEOUT_MS, apiBase } from "./sites.mjs"
import { expiredError } from "./net.mjs"
import { familyOf, variantsOf } from "./capabilities.mjs"
import { modalitiesOf } from "./modalities.mjs"
import { rateOf } from "./rates.mjs"

const MODELS_TTL_MS = 30 * 60 * 1000
const STATE_MAX = 256
const modelsCache = new Map()

function remember(key, value) {
  modelsCache.set(key, { at: Date.now(), value })
  while (modelsCache.size > STATE_MAX) modelsCache.delete(modelsCache.keys().next().value)
  return value
}

export function resetModelsCache() {
  modelsCache.clear()
}

function isDeprecated(profile, id) {
  return profile.deprecated.includes(id) || profile.deprecatedPrefixes.some((p) => id.startsWith(p))
}

function releaseDate(created) {
  if (!created || !Number.isFinite(created)) return ""
  const d = new Date(created * 1000)
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10)
}

// "deepseek-ai/DeepSeek-V4.1-Flash-1017" → "DeepSeek V4.1 Flash 1017"。
// 尾巴上的四位数字是发布批次（0813、1017），留给 id，不进名字。
export function displayName(id) {
  const tail = id.split("/").pop() || id
  return tail
    .replace(/[-_]/g, " ")
    .replace(/\b(\d{4})$/, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

export function modelEntry(profile, id, created) {
  const known = profile.fallback[id]
  const family = familyOf(id) ?? {}
  const { input, output, attachment } = modalitiesOf(id, known)
  return {
    id,
    providerID: profile.id,
    name: known?.name ?? displayName(id),
    api: { id, url: apiBase(profile), npm: "@ai-sdk/openai-compatible" },
    status: isDeprecated(profile, id) ? "deprecated" : "active",
    limit: known?.limit ?? { context: 128000, output: 8192 },
    // 计费是魔粒按次扣，不按 token，所以成本字段报 0（和上游两个插件一致）。
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    options: {},
    headers: {},
    capabilities: {
      temperature: true,
      reasoning: known?.reasoning ?? family.reasoning ?? false,
      attachment,
      toolcall: known?.tool_call ?? true,
      input,
      output,
      interleaved: false,
    },
    release_date: releaseDate(created),
    // 推理强度：只有文档写明档位的模型才有。空对象表示「这个模型没有分档」，
    // 不是「还没做」。
    variants: variantsOf(id),
    // 魔粒倍率：调一次扣多少魔粒，只写实测过的。magpie 的模型选择器会把它
    // 画成「2×」这样的标签（和 WorkBuddy 的 credits 倍率同一个字段）。
    ...(rateOf(profile, id) !== undefined ? { rate: rateOf(profile, id) } : {}),
  }
}

// 未登录时的兜底列表，也是 /models 拉不到时保留列表的形状。
export function fallbackEntries(profile) {
  return Object.fromEntries(Object.keys(profile.fallback).map((id) => [id, modelEntry(profile, id, undefined)]))
}

export async function modelsFor(profile, providerModels, auth, signal) {
  const fallback = providerModels && Object.keys(providerModels).length ? providerModels : fallbackEntries(profile)
  const key = auth?.type === "api" ? String(auth.key || "").trim() : ""
  if (!key) return fallback
  const hit = modelsCache.get(key)
  if (hit && Date.now() - hit.at < MODELS_TTL_MS) return hit.value
  try {
    const res = await fetch(`${apiBase(profile)}${PATHS.models}`, {
      headers: { authorization: `Bearer ${key}`, "user-agent": "magpie-modelscope-hub" },
      signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
    })
    if (res.status === 401) throw expiredError(profile, "模型列表", res.status)
    // 403 是这把令牌没有列目录的权限，不是登录失效：退回兜底列表。
    if (!res.ok) return fallback
    const body = await res.json()
    const data = body?.data ?? body?.Data
    if (!Array.isArray(data) || data.length === 0) return fallback
    const out = Object.fromEntries(
      data
        .filter((m) => typeof m?.id === "string" && m.id)
        .map((m) => [m.id, modelEntry(profile, m.id, m.created)]),
    )
    if (!Object.keys(out).length) return fallback
    return remember(key, out)
  } catch (err) {
    if (err?.signIn === "expired") throw err
    return fallback
  }
}
