import test from "node:test"
import assert from "node:assert/strict"

import { AI, CN } from "../src/sites.mjs"
import { beijingDay, bucketize, nextBeijingReset, summarize, vendorTime } from "../src/net.mjs"
import { usageCard } from "../src/usage.mjs"
import { displayName, fallbackEntries, modelEntry } from "../src/models.mjs"
import { ModelScopeAiPlugin, ModelScopeCnPlugin, _internal } from "../index.mjs"

const DAY = "2026-11-18"

function row(over = {}) {
  return { type: "EARN", rule_key: "daily_active", gmt_created: DAY, total_amount: 200, ...over }
}

test("vendorTime 按北京时间解析，不按本机时区", () => {
  assert.equal(vendorTime("2026-11-18 09:00:00"), "2026-11-18T01:00:00.000Z")
  assert.equal(vendorTime("2026-11-18T09:00"), "2026-11-18T01:00:00.000Z")
  assert.equal(vendorTime(""), "")
  assert.equal(vendorTime("not a time"), "")
})

test("beijingDay 跟着北京时间翻日", () => {
  // 2026-11-17 16:30Z 已经是北京时间 18 日 00:30
  assert.equal(beijingDay(Date.parse("2026-11-17T16:30:00Z")), "2026-11-18")
  assert.equal(beijingDay(Date.parse("2026-11-17T15:30:00Z")), "2026-11-17")
})

test("nextBeijingReset 落在下一个北京时间 00:35", () => {
  const at = Date.parse("2026-11-17T16:30:00Z") // 北京 18 日 00:30，已过 00:35 吗？没有
  const reset = Date.parse(nextBeijingReset(at))
  assert.equal(new Date(reset + 8 * 3600e3).toISOString().slice(11, 16), "00:35")
  assert.ok(reset > at)
})

test("summarize 只把当日行算进卡片，并把签到发放和普通奖励分开", () => {
  const rows = [
    row({ total_amount: 200, expire_days: 1, expire_at: "2026-11-19 00:10:00" }),
    row({ rule_key: "aliyun_bindlogin", total_amount: 50, expire_days: 1, expire_at: "2026-11-19 00:20:00" }),
    row({ rule_key: "invite", total_amount: 30, expire_days: 90, expire_at: "2027-02-01 00:00:00" }),
    { type: "SPEND_CONFIRM", gmt_created: DAY, total_amount: 4, count: 2 },
    { type: "EXPIRE", gmt_created: DAY, total_amount: 10 },
    row({ gmt_created: "2026-11-17", total_amount: 999 }),
  ]
  const s = summarize(rows, DAY)
  assert.equal(s.found, true)
  assert.equal(s.credit, 250)
  assert.equal(s.earned, 280)
  assert.equal(s.spent, 4)
  assert.equal(s.calls, 2)
  assert.equal(s.dailyGranted, 250)
  assert.equal(s.longGranted, 30)
  assert.equal(s.dailyExpiresAt, "2026-11-18T16:10:00.000Z")
  assert.equal(s.reset, "2026-11-18T16:10:00.000Z")
  assert.equal(s.dailyExpired, 10)
})

test("bucketize 在没有 expire_days 的老数据上靠规则名认当日发放", () => {
  const b = bucketize([row({ rule_key: "daily_active", total_amount: 200 })], DAY)
  assert.equal(b.dailyGranted, 200)
  const b2 = bucketize([row({ rule_key: "some_event", total_amount: 60 })], DAY)
  assert.equal(b2.dailyGranted, 0)
  assert.equal(b2.longGranted, 60)
})

test("usageCard 给参与路由的合计窗口：limit 是余额 + 今日已花", () => {
  const ledger = { ...summarize([row({ total_amount: 250, expire_days: 1 })], DAY) }
  const card = usageCard(100, ledger.earned, 50, ledger, 25)
  const total = card.windows.find((w) => w.name === "合计")
  assert.equal(total.limit, 150)
  assert.equal(total.amount, 50)
  assert.equal(total.used, 33)
  assert.equal(card.balance, "100")
  // 今日发放只展示，不参与路由
  const dayWindow = card.windows.find((w) => w.name === "今日发放")
  assert.equal(dayWindow.aside, true)
  assert.equal(dayWindow.limit, 250)
  assert.equal(dayWindow.used, 20)
})

test("usageCard 没有当日发放时画成钱包窗口，不编造百分比", () => {
  const card = usageCard(230, 0, 0, undefined, 0)
  assert.equal(card.windows.length, 1)
  assert.equal(card.windows[0].name, "合计")
  assert.equal(card.windows[0].balance, 230)
  assert.equal(card.windows[0].used, undefined)
})

test("usageCard 余额归零且今天没发东西时，给出到下一次发放的停用窗口", () => {
  const card = usageCard(0, 0, 0, undefined, 0)
  assert.equal(card.windows[0].used, 100)
  assert.equal(card.windows[0].span, 86400)
  assert.ok(Date.parse(card.windows[0].resetsAt) > Date.now())
})

test("modelEntry 是完整形态：能力、限额、发布日都在", () => {
  const entry = modelEntry(AI, "deepseek-ai/DeepSeek-V4.1-Flash-1017", 1780000000)
  assert.equal(entry.providerID, "modelscope-ai")
  assert.equal(entry.limit.context, 1048576)
  assert.equal(entry.capabilities.reasoning, true)
  assert.equal(entry.capabilities.input.image, true)
  assert.equal(entry.release_date.length, 10)
  assert.equal(entry.api.npm, "@ai-sdk/openai-compatible")
})

test("modelEntry 把实测不可调用的国际站模型标成 deprecated", () => {
  assert.equal(modelEntry(AI, "deepseek-ai/DeepSeek-V4-Pro").status, "deprecated")
  assert.equal(modelEntry(AI, "Qwen-Ambassador/Qwen3-8B").status, "deprecated")
  assert.equal(modelEntry(AI, "deepseek-ai/DeepSeek-V4-Pro-0813").status, "active")
  // 国内站没有黑名单，目录里列出来的一律可用
  assert.equal(modelEntry(CN, "Qwen/Qwen3-30B-A3B-Instruct-2507").status, "active")
})

test("displayName 把厂商 id 读成人看的名字", () => {
  assert.equal(displayName("deepseek-ai/DeepSeek-V4.1-Flash-1017"), "DeepSeek V4.1 Flash 1017")
  assert.equal(displayName("Qwen/Qwen3-Coder-30B-A3B-Instruct"), "Qwen3 Coder 30B A3B Instruct")
})

test("两个站点各自有一份兜底模型，且都认得自己的 provider id", () => {
  const cn = fallbackEntries(CN)
  const ai = fallbackEntries(AI)
  assert.equal(Object.keys(cn).length, 7)
  assert.equal(Object.keys(ai).length, 3)
  for (const m of Object.values(cn)) assert.equal(m.providerID, "modelscope-cn")
  for (const m of Object.values(ai)) assert.equal(m.providerID, "modelscope-ai")
})

test("插件导出两个实例，每个都带 config / auth（loader、usage、checkin）/ provider", async () => {
  const tagged = _internal.withSignIn(new Response("x", { status: 401 }), "expired")
  assert.equal(tagged.status, 401)
  assert.equal(tagged.headers.get("x-magpie-sign-in"), "expired")
  for (const [fn, id, name] of [
    [ModelScopeCnPlugin, "modelscope-cn", "魔搭 ModelScope（国内站）"],
    [ModelScopeAiPlugin, "modelscope-ai", "魔搭 ModelScope（国际站）"],
  ]) {
    const plugin = await fn({})
    assert.equal(plugin.auth.provider, id)
    assert.equal(typeof plugin.auth.loader, "function")
    assert.equal(typeof plugin.auth.usage, "function")
    assert.equal(typeof plugin.auth.checkin, "function")
    assert.equal(plugin.provider.id, id)
    const cfg = { provider: {} }
    await plugin.config(cfg)
    assert.equal(cfg.provider[id].name, name)
    assert.equal(cfg.provider[id].npm, "@ai-sdk/openai-compatible")
    assert.ok(Object.keys(cfg.provider[id].models).length >= 3)
  }
})
