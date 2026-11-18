// 用量卡：两个锚点（余额、当日账单）各按自己的时钟刷新，两次读之间用这个
// 插件亲眼看见的调用做估算 —— 每笔都按旗舰档 2 魔粒算，只会高估消耗、
// 不会高估余额，方向是安全的（最坏结果是提前去问一次厂商）。
//
// 卡片形状：今日发放（aside，只展示）/ 长期魔粒（aside）/ 合计（参与路由）。
// 合计的 limit 是「余额 + 今日已花」，即这笔钱真实的总额；余额归零时
// used:100 + 下一个 resetsAt，magpie 会把账号停用到那天再恢复。

import { PATHS } from "./sites.mjs"
import { EMPTY_LEDGER, dailyEarnings, envelopeData, nextBeijingReset, siteGet } from "./net.mjs"

const USAGE_TTL_MS = 30 * 60 * 1000 // 余额半小时读一次
const CALL_COST = 2 // 两站都按旗舰档 2 魔粒/次估算
const SYNC_AT_SPENT = 0.8 // 估算花掉锚点的 80% 就提前问一次
const SYNC_BELOW = 4 // 剩不到 4 魔粒（两次旗舰调用）就不再信估算
const STATE_MAX = 256

const liveCache = new Map()
const keyOf = (profile, token) => `${profile.id}|${token}`

function prune(map) {
  while (map.size > STATE_MAX) map.delete(map.keys().next().value)
}

export function noteCall(profile, token) {
  if (!token) return
  const key = keyOf(profile, token)
  const live = liveCache.get(key)
  if (live) {
    live.sinceBalance++
    live.sinceLedger++
    return
  }
  liveCache.set(key, {
    at: 0,
    available: NaN,
    total: NaN,
    sinceBalance: 1,
    ledgerAt: 0,
    day: "",
    ledger: { ...EMPTY_LEDGER },
    sinceLedger: 0,
  })
  prune(liveCache)
}

export function dropLive(profile, token) {
  if (token) liveCache.delete(keyOf(profile, token))
}

export function resetLive() {
  liveCache.clear()
}

function stubLive(day) {
  return {
    at: 0,
    available: NaN,
    total: NaN,
    sinceBalance: 0,
    ledgerAt: 0,
    day,
    ledger: { ...EMPTY_LEDGER },
    sinceLedger: 0,
  }
}

export function estLeft(live) {
  return Math.max(0, live.available - CALL_COST * live.sinceBalance)
}

async function readBalance(profile, token, signal) {
  try {
    return envelopeData(await siteGet(profile, PATHS.balance, token, "魔粒余额查询", "bearer", signal))
  } catch (err) {
    if (err?.signIn !== "expired") throw err
    // 官方 Bearer 被拒就退到网页会话 Cookie：同一个路径两种鉴权都认。
    return envelopeData(await siteGet(profile, PATHS.balance, token, "魔粒余额查询", "cookie", signal))
  }
}

export async function refreshLive(profile, token, signal) {
  const key = keyOf(profile, token)
  let live = liveCache.get(key)
  const now = Date.now()
  const day = new Date(now + 8 * 3600e3).toISOString().slice(0, 10)
  if (live && live.day && live.day !== day) {
    live.ledger = { ...EMPTY_LEDGER }
    live.day = day
    live.sinceLedger = 0
    live.ledgerAt = 0
  }
  const needBalance =
    !live ||
    now - live.at >= USAGE_TTL_MS ||
    (live.sinceBalance > 0 &&
      (estLeft(live) <= SYNC_BELOW || CALL_COST * live.sinceBalance >= SYNC_AT_SPENT * live.available))
  if (needBalance) {
    const data = await readBalance(profile, token, signal)
    live = liveCache.get(key) || live || stubLive(day)
    live.at = now
    live.available = Number(data.available_balance)
    live.total = Number(data.total_balance)
    live.sinceBalance = 0
    liveCache.set(key, live)
    prune(liveCache)
  }
  if (!live) live = stubLive(day)
  const spentEst = live.ledger.spent + CALL_COST * live.sinceLedger
  const needLedger =
    !live.ledgerAt ||
    (live.day === day && live.sinceLedger > 0 && live.ledger.earned > 0 && spentEst >= live.ledger.earned && now - live.ledgerAt > 5 * 60_000)
  if (needLedger) {
    const ledger = await dailyEarnings(profile, token, day, signal)
    if (ledger) live.ledger = ledger
    live.day = day
    live.ledgerAt = now
    live.sinceLedger = 0
  }
  liveCache.set(key, live)
  return live
}

// 余额用完时的窗口：used:100 + 未来的 resetsAt，magpie 的 heldUp 读到它
// 就把账号停到下一个发放时刻，签到到账后自动恢复。
function exhaustedWindow() {
  return [{ name: "魔粒", used: 100, span: 86400, resetsAt: nextBeijingReset(), display: "今日魔粒已用完" }]
}

export function usageCard(available, earned, spent, ledger, calls) {
  const card = { plan: "魔粒", windows: [] }
  if (!Number.isFinite(available)) return card
  const round = (n) => Math.round(n * 100) / 100
  card.balance = String(available)
  const dayGranted = ledger?.dailyGranted ?? 0
  const dayExpiresAt = ledger?.dailyExpiresAt ?? ""
  const longGranted = ledger?.longGranted ?? 0
  const longExpiresAt = ledger?.longExpiresAt ?? ""
  const hasDay = dayGranted > 0
  if (!hasDay && available <= 0) {
    card.windows.push(...exhaustedWindow())
    return card
  }
  const dayLeft = Math.max(0, dayGranted - Math.max(0, spent))
  if (hasDay) {
    const daySpent = Math.max(0, dayGranted - dayLeft)
    const usedPct = Math.min(99, Math.max(0, Math.round((100 * daySpent) / dayGranted)))
    card.windows.push({
      name: "今日发放",
      used: available <= 0 ? 100 : usedPct,
      amount: round(daySpent),
      limit: round(dayGranted),
      unit: "魔粒",
      display: `${round(dayLeft)} / ${round(dayGranted)}${calls ? ` · ${calls} 次调用` : ""}`,
      span: 86400,
      resetsAt: nextBeijingReset(),
      ...(dayExpiresAt && dayLeft > 0 ? { runsOutAt: dayExpiresAt, runsOut: round(dayLeft) } : {}),
      aside: true,
    })
  }
  if (longGranted > 0) {
    card.windows.push({
      name: "长期魔粒",
      used: 0,
      amount: 0,
      limit: round(longGranted),
      unit: "魔粒",
      display: `${round(longGranted)} 结余`,
      span: 0,
      ...(longExpiresAt ? { runsOutAt: longExpiresAt } : {}),
      ...(hasDay ? { aside: true } : {}),
    })
  }
  if (!hasDay) {
    // 没有当日发放可读（账单读不到，或今天只有长期池）：余额就是全部，
    // 它是钱包不是配额，画成 balance 窗口（"230 魔粒 left"，没有百分比）。
    if (available > 0) {
      card.windows.push({
        name: "合计",
        balance: round(available),
        unit: "魔粒",
        display: `${round(available)} 可用`,
        span: 0,
      })
    }
    return card
  }
  const spentToday = Math.max(0, dayGranted - dayLeft)
  const totalCap = round(available + spentToday)
  const totalSpent = round(spentToday)
  const usedTotal =
    available <= 0 ? 100 : totalCap > 0 ? Math.min(99, Math.max(0, Math.round((100 * totalSpent) / totalCap))) : 0
  card.windows.push({
    name: "合计",
    used: usedTotal,
    amount: totalSpent,
    limit: totalCap,
    unit: "魔粒",
    display: `${round(available)} 可用`,
    span: 86400,
    resetsAt: nextBeijingReset(),
    ...(dayExpiresAt && dayLeft > 0
      ? { runsOutAt: dayExpiresAt, runsOut: round(Math.min(available, dayLeft)) }
      : {}),
  })
  return card
}

export async function usageFor(profile, auth, signal) {
  const token = auth?.type === "api" ? String(auth.key || "").trim() : ""
  if (!token) return { error: "缺少 ModelScope 访问令牌", windows: [] }
  try {
    const live = await refreshLive(profile, token, signal)
    const spent = live.ledger.spent + CALL_COST * live.sinceLedger
    const calls = live.ledger.calls + live.sinceLedger
    return usageCard(estLeft(live), live.ledger.earned, spent, live.ledger, calls)
  } catch (err) {
    if (err?.signIn === "expired") return { error: err.message, signIn: "expired", windows: [] }
    return { error: err?.message || String(err), windows: [] }
  }
}
