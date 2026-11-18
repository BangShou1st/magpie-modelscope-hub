// 每日签到。
//
// ModelScope 没有签到接口：GET /api/v1/users/login/info 本身就是一次网页登录，
// 服务端把它算作当天的签到并发放魔粒（daily_active 200 + 绑定阿里云 50），
// 一天一次。所以流程是「先读账本 → 再登录 → 再读账本核对」，而不是直接
// 请求一个 claim 接口 —— 直接 touch 分不清「刚领到」和「早就领过」。
//
// magpie 自己每天每账号问一次、失败半小时后重问，插件里不再加节流。

import { PATHS } from "./sites.mjs"
import { beijingDay, dailyEarnings, siteGet } from "./net.mjs"
import { ensureName, saveAccountName } from "./account.mjs"
import { dropLive } from "./usage.mjs"

export async function checkinFor(profile, auth, client, signal) {
  const token = auth?.type === "api" ? String(auth.key || "").trim() : ""
  if (!token) throw new Error("缺少 ModelScope 访问令牌")
  const day = beijingDay()

  // 先看账本：今天的发放行已经在了，就是 done，不是 claimed。
  const before = await dailyEarnings(profile, token, day, signal)
  if (before?.found) {
    await ensureName(profile, client, auth, token, signal)
    dropLive(profile, token)
    return before.credit
      ? { outcome: "done", credit: before.credit, message: `今日已领取 ${before.credit} 魔粒` }
      : { outcome: "done", message: "今日已领取" }
  }

  try {
    const payload = await siteGet(profile, PATHS.loginInfo, token, "每日签到", "cookie", signal)
    await saveAccountName(profile, client, auth, payload)
  } catch (err) {
    if (err?.signIn === "expired") throw err
    return { outcome: "failed", message: err?.message || String(err) }
  }

  // 发放可能晚一拍到账，再读一次；仍没有就等 1.5 秒读第三次。
  let after = await dailyEarnings(profile, token, day, signal)
  if (before && !after?.found) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    after = await dailyEarnings(profile, token, day, signal)
  }
  if (after?.found) {
    dropLive(profile, token)
    return after.credit
      ? { outcome: "claimed", credit: after.credit, message: `签到到账 ${after.credit} 魔粒` }
      : { outcome: "claimed", message: "每日登录奖励已触发" }
  }
  // 账本读到了但今天没有发放行：登录确实触达了厂商，只是没发 —— 说清楚，
  // 别报一个不存在的到账。账本压根读不到是另一回事，留给宿主重试。
  if (after) return { outcome: "inactive", message: "登录已触达，但今天没有到账记录" }
  return { outcome: "failed", message: "签到已触发，但账单查询失败，稍后会自动重试" }
}
