// 网页接口的读取、信封解析和时间换算。
//
// 站点的信封两种写法都有：ModelScope 是 Code/Success/Data/Message，
// 国际站是 code/success/data/msg。两种都读。

import { DAILY_RULES, LEDGER_PAGE, LEDGER_PAGES, PATHS, TIMEOUT_MS, UA, siteBase } from "./sites.mjs"

export function envelopeData(payload) {
  const v = payload?.Data ?? payload?.data
  return v && typeof v === "object" && !Array.isArray(v) ? v : {}
}

// 有的接口（如 /v1/models 的网页版）把列表直接放在 Data.data 或 Data.records。
export function envelopeList(payload) {
  const d = envelopeData(payload)
  if (Array.isArray(d)) return d
  for (const key of ["records", "list", "items", "data"]) {
    if (Array.isArray(d?.[key])) return d[key]
  }
  return []
}

export function envelopeMessage(payload) {
  return String(payload?.Message || payload?.message || payload?.msg || "").trim()
}

export function envelopeOk(payload) {
  if (typeof payload?.Success === "boolean") return payload.Success
  if (typeof payload?.success === "boolean") return payload.success
  const code = payload?.Code ?? payload?.code
  if (code === undefined || code === null) return true
  return Number(code) === 200
}

export function maskToken(token) {
  const t = String(token || "")
  return t.length > 8 ? `${t.slice(0, 5)}…${t.slice(-3)}` : "ms-…"
}

// 令牌被这一站拒绝。magpie 读到 signIn: "expired" 才会把账号标成需要重新登录，
// 所以这个标记必须只在 401 上出现。
export function expiredError(profile, what, status) {
  return Object.assign(new Error(`${what}：${profile.wrongSite}（HTTP ${status}）`), {
    signIn: "expired",
  })
}

// 网页接口的一次 GET。
//   auth: "cookie" 用网页会话 m_session_id（签到/账单只能这样）
//   auth: "bearer" 用官方 Bearer（余额有公开契约，优先走这条）
// 401 才是令牌失效；403 是风控，账号通常没事，标成过期会把人送去重新登录。
export async function siteGet(profile, path, token, what, auth = "cookie", signal) {
  const base = siteBase(profile)
  const headers =
    auth === "bearer"
      ? { authorization: `Bearer ${token}`, "user-agent": UA, accept: "application/json" }
      : { cookie: `m_session_id=${token}`, "user-agent": UA, accept: "application/json" }
  const res = await fetch(base + path, {
    headers,
    signal: signal ?? AbortSignal.timeout(TIMEOUT_MS),
  })
  if (res.status === 401) throw expiredError(profile, what, res.status)
  if (res.status === 403) throw new Error(`${what}：被魔搭风控拒绝（HTTP 403）`)
  if (!res.ok) throw new Error(`${what}：HTTP ${res.status}`)
  let payload = {}
  try {
    payload = await res.json()
  } catch {
    throw new Error(`${what}：上游没有返回 JSON`)
  }
  if (!envelopeOk(payload)) {
    throw new Error(`${what}：${envelopeMessage(payload) || "上游返回失败"}`)
  }
  return payload
}

// 记账时刻是站点的北京时间，且没有时区后缀（"2026-10-29 01:02:24"）。
// 直接 new Date() 会按本机时区读，非 +8 的机器上过期时间会差 8 小时。
export function vendorTime(value) {
  const raw = String(value || "").trim()
  if (!raw) return ""
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/)
  if (!m) {
    const parsed = new Date(raw)
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString()
  }
  const [, y, mo, d, h, mi, s] = m
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 8, Number(mi), Number(s || "0"))
  return Number.isNaN(utc) ? "" : new Date(utc).toISOString()
}

// 北京日：账单里的 gmt_created 就是这一天，不靠本机时区猜。
export function beijingDay(now = Date.now()) {
  return new Date(now + 8 * 3600e3).toISOString().slice(0, 10)
}

// 下一次北京时间 00:35。给用量窗口的 resetsAt：magpie 用它计算账号什么时候
// 从“用完停用”里解冻，00:35 给签到雷打不动的半小时循环留出余量。
export function nextBeijingReset(now = Date.now()) {
  const bj = now + 8 * 3600e3
  const d = new Date(bj)
  const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  const wall = midnight + 35 * 60e3
  const target = wall <= bj ? wall + 86400e3 : wall
  return new Date(target - 8 * 3600e3).toISOString()
}

// 一个读不到的账号，下一次读之前先用它垫底，保证卡片有东西可画。
export const EMPTY_LEDGER = {
  found: false,
  credit: 0,
  earned: 0,
  spent: 0,
  calls: 0,
  dailyGranted: 0,
  dailyExpiresAt: "",
  dailyExpired: 0,
  longGranted: 0,
  longExpiresAt: "",
}

// 读一天的账单（当前页 + 往前几页）。
// 返回 null 表示账单读不到：它是签到的“证据”，不是“触发”，读不到不该算签到失败。
export async function dailyEarnings(profile, token, day, signal) {
  const rows = []
  try {
    for (let page = 1; page <= LEDGER_PAGES; page++) {
      const payload = await siteGet(
        profile,
        `${PATHS.txns}?page=${page}&page_size=${LEDGER_PAGE}`,
        token,
        "魔粒账单查询",
        "cookie",
        signal,
      )
      const data = envelopeData(payload)
      const list = Array.isArray(data.records) ? data.records : []
      for (const r of list) rows.push(r)
      if (list.length < LEDGER_PAGE) break
      const last = String(list[list.length - 1]?.gmt_created || "")
      if (last && last < day) break
    }
    return summarize(rows, day)
  } catch (err) {
    if (err?.signIn === "expired") throw err
    return null
  }
}

// 把当天的行合成卡片需要的几个数：签到发了多少（credit）、今天一共发了多少
// （earned，含活动奖励）、今天花了多少（spent）、今天用了多少次（calls），
// 以及按 expire_days 拆出来的“今日额度/长期额度”两个桶。
export function summarize(rows, day) {
  let credit = 0
  let earned = 0
  let spent = 0
  let calls = 0
  let found = false
  let reset
  const today = []
  for (const r of rows) {
    if (String(r?.gmt_created || "") !== day) continue
    today.push(r)
    const type = String(r?.type || "").toUpperCase()
    const amount = Number(r?.total_amount) || 0
    if (type === "EARN") {
      earned += amount
      if (DAILY_RULES.includes(String(r?.rule_key || "").toLowerCase())) {
        found = true
        credit += amount
        const expire = vendorTime(r?.expire_at)
        if (expire && (!reset || expire < reset)) reset = expire
      }
    } else if (type === "SPEND_CONFIRM" || type === "SPEND") {
      spent += amount
      calls += Number(r?.count) || 0
    }
  }
  const buckets = bucketize(today, day)
  const round = (n) => Math.round(n * 100) / 100
  return {
    found,
    credit: round(credit),
    earned: round(earned),
    spent: round(spent),
    calls,
    ...buckets,
    ...(reset ? { reset } : {}),
  }
}

// 账单按 (日期, 类型, 规则, 档位) 聚合成一行，EARN 行各自带过期方式：
// expire_days 1 是当日发放（24 小时过期），>1 是长期（一次性奖励）。
// 老数据没有 expire_days，靠规则名认。
export function bucketize(rows, day) {
  const b = {
    dailyGranted: 0,
    dailyExpiresAt: "",
    dailyExpired: 0,
    longGranted: 0,
    longExpiresAt: "",
  }
  for (const r of rows) {
    if (String(r?.gmt_created || "") !== day) continue
    const type = String(r?.type || "").toUpperCase()
    const amount = Number(r?.total_amount) || 0
    if (type === "EARN") {
      const days = Number(r?.expire_days)
      const isDaily =
        days === 1 || (!Number.isFinite(days) && DAILY_RULES.includes(String(r?.rule_key || "").toLowerCase()))
      const expire = vendorTime(r?.expire_at)
      if (isDaily) {
        b.dailyGranted += amount
        if (expire && (!b.dailyExpiresAt || expire < b.dailyExpiresAt)) b.dailyExpiresAt = expire
      } else {
        b.longGranted += amount
        if (expire && (!b.longExpiresAt || expire < b.longExpiresAt)) b.longExpiresAt = expire
      }
    } else if (type === "EXPIRE") {
      b.dailyExpired += amount
    }
  }
  b.dailyGranted = Math.round(b.dailyGranted * 100) / 100
  b.longGranted = Math.round(b.longGranted * 100) / 100
  return b
}
