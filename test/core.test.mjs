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
    { type: "SPEND_CONFIRM", gmt_created: DAY, total_amount: 4, count: 2, model_tier: "ultra" },
    { type: "SPEND_CONFIRM", gmt_created: DAY, total_amount: 1, count: 1, model_tier: "standard" },
    { type: "EXPIRE", gmt_created: DAY, total_amount: 10 },
    row({ gmt_created: "2026-11-17", total_amount: 999 }),
  ]
  const s = summarize(rows, DAY)
  assert.equal(s.found, true)
  assert.equal(s.credit, 250)
  assert.equal(s.earned, 280)
  assert.equal(s.spent, 5)
  assert.equal(s.calls, 3)
  assert.deepEqual(s.tiers.ultra, { amount: 4, count: 2 })
  assert.deepEqual(s.tiers.standard, { amount: 1, count: 1 })
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

test("今日发放窗口把已花和档位单价说清楚", () => {
  const ledger = summarize(
    [
      row({ total_amount: 250, expire_days: 1 }),
      { type: "SPEND_CONFIRM", gmt_created: DAY, total_amount: 4, count: 2, model_tier: "ultra" },
      { type: "SPEND_CONFIRM", gmt_created: DAY, total_amount: 1, count: 1, model_tier: "standard" },
    ],
    DAY,
  )
  const card = usageCard(245, ledger.earned, 5, ledger, 3)
  const w = card.windows.find((x) => x.name === "今日发放")
  assert.match(w.display, /已花 5/)
  assert.match(w.display, /3 次/)
  assert.match(w.display, /旗舰 2×2/)
  assert.match(w.display, /标准 1×1/)
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

test("推理强度按文档覆盖：Nex-N2.5 三档、Qwen3.8-Flash-Next 三档", () => {
  const nex = modelEntry(AI, "nex-agi/Nex-N2.5-Pro")
  assert.equal(nex.capabilities.reasoning, true)
  assert.deepEqual(Object.keys(nex.variants), ["none", "medium", "high"])
  assert.deepEqual(nex.variants.high, { reasoningEffort: "high" })

  const qwen = modelEntry(CN, "Qwen/Qwen3.8-Flash-Next")
  assert.equal(qwen.capabilities.reasoning, true)
  assert.deepEqual(Object.keys(qwen.variants), ["low", "medium", "xhigh"])
})

test("实时目录里的思考模型不会因为查不到兜底就丢掉 reasoning", () => {
  // 这些 id 只存在于线上 /models，兜底里没有
  assert.equal(modelEntry(CN, "Qwen/Qwen3.5-397B-A17B").capabilities.reasoning, true)
  assert.equal(modelEntry(CN, "Qwen/Qwen3.8-27B").capabilities.reasoning, true)
  assert.equal(modelEntry(CN, "deepseek-ai/DeepSeek-V4-Pro-0813").capabilities.reasoning, true)
  assert.equal(modelEntry(CN, "ZhipuAI/GLM-4.7-Flash").capabilities.reasoning, true)
  // 没有文档依据的不猜档位、也不乱标思考
  assert.deepEqual(modelEntry(CN, "Qwen/Qwen3.5-27B").variants, {})
  assert.equal(modelEntry(CN, "MedAIBase/AntAngelMed").capabilities.reasoning, false)
  assert.deepEqual(modelEntry(CN, "MedAIBase/AntAngelMed").variants, {})
})

test("图片能力按魔搭 pipeline 标签覆盖", () => {
  // 视觉模型要收图，否则网关会把图先描述成文字
  for (const id of [
    "Qwen/Qwen3.8-27B",
    "Qwen/Qwen3.8-Flash-Next",
    "Qwen/Qwen3.5-27B",
    "deepseek-ai/DeepSeek-V4.1-Flash-1017",
    "PaddlePaddle/ERNIE-4.5-VL-28B-A3B-PT",
    "moonshotai/Kimi-K3.1-Pro",
    "stepfun-ai/Step-3.7-Flash",
  ]) {
    const entry = modelEntry(CN, id)
    assert.equal(entry.capabilities.input.image, true, id)
    assert.equal(entry.capabilities.attachment, true, id)
    assert.equal(entry.capabilities.output.text, true, id)
  }
  // 纯文本模型不硬写 image:false（那是「明确不收图」），只说自己是文本模型
  const text = modelEntry(CN, "deepseek-ai/DeepSeek-V4-Pro")
  assert.equal(text.capabilities.input.image, undefined)
  assert.equal(text.capabilities.attachment, false)
  // 图片编辑模型不是聊天模型：不产出文本，交给画图入口
  const edit = modelEntry(CN, "Qwen/Qwen-Image-Edit")
  assert.equal(edit.capabilities.output.text, false)
  assert.equal(edit.capabilities.output.image, true)
  // 目录里查不到的新 id 一样不硬写「不收图」
  assert.equal(modelEntry(CN, "early-access/EA-29B-A4B").capabilities.input.image, undefined)
})

test("魔粒倍率只写实测过的：旗舰 2、主流 1、轻量 0.5", () => {
  assert.equal(modelEntry(CN, "Qwen/Qwen3.8-27B").rate, 1)
  assert.equal(modelEntry(CN, "Qwen/Qwen3.5-397B-A17B").rate, 2)
  assert.equal(modelEntry(CN, "nex-agi/Nex-N2.5-mini").rate, 0.5)
  // 没测到的不给值，不拿别的模型猜
  assert.equal(modelEntry(CN, "moonshotai/Kimi-K3.1-Pro").rate, undefined)
  assert.equal(modelEntry(CN, "early-access/EA-29B-A4B").rate, undefined)
  // 国际站没有实测数据，不显示倍率
  assert.equal(modelEntry(AI, "deepseek-ai/DeepSeek-V4.1-Flash-1017").rate, undefined)
})

test("withCredit 把这一笔的魔粒写进 JSON 的 usage", async () => {
  const res = new Response(JSON.stringify({ model: "Qwen/Qwen3.8-27B", usage: { prompt_tokens: 3, completion_tokens: 1 } }), {
    headers: { "content-type": "application/json" },
  })
  const out = await _internal.withCredit(res, 1)
  const body = await out.json()
  assert.equal(body.usage.credit, 1)
  assert.equal(body.usage.prompt_tokens, 3)
})

test("withCredit 在 SSE 的 usage 块里补 credit，[DONE] 原样保留", async () => {
  const enc = new TextEncoder()
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(enc.encode('data: {"choices":[],"usage":{"total_tokens":2}}\n\n'))
      c.enqueue(enc.encode("data: [DONE]\n\n"))
      c.close()
    },
  })
  const out = await _internal.withCredit(new Response(stream, { headers: { "content-type": "text/event-stream" } }), 0.5)
  const text = await out.text()
  assert.match(text, /"usage":\{"total_tokens":2,"credit":0\.5\}/)
  assert.match(text, /data: \[DONE\]/)
})

test("requestModel 从请求体里认出模型；读不出来不硬猜", () => {
  assert.equal(_internal.requestModel({ body: JSON.stringify({ model: "ZhipuAI/GLM-5.2" }) }), "ZhipuAI/GLM-5.2")
  assert.equal(_internal.requestModel({ body: "not json" }), undefined)
  assert.equal(_internal.requestModel({}), undefined)
})

test("withUsageOption 只给流式 chat 请求补 include_usage", () => {
  const body = JSON.stringify({ model: "Qwen/Qwen3.8-27B", stream: true, messages: [] })
  const init = _internal.withUsageOption("https://api-inference.modelscope.cn/v1/chat/completions", { body, method: "POST" })
  const json = JSON.parse(init.body)
  assert.equal(json.stream_options.include_usage, true)
  // 非流式不动
  assert.equal(_internal.withUsageOption("https://x/v1/chat/completions", { body: JSON.stringify({ stream: false }) }).body, JSON.stringify({ stream: false }))
  // 别动非 chat 端点
  const other = { body }
  assert.equal(_internal.withUsageOption("https://x/v1/embeddings", other), other)
})

test("模型窗口按 config.json 覆盖：DeepSeek 1M、Qwen3.5/3.8 256K", () => {
  assert.equal(modelEntry(CN, "deepseek-ai/DeepSeek-V4.1-Flash-1017").limit.context, 1048576)
  assert.equal(modelEntry(CN, "Qwen/Qwen3.8-27B").limit.context, 262144)
  assert.equal(modelEntry(CN, "ZhipuAI/GLM-5.2").limit.context, 1048576)
  // 查不到的仍按 128K，不乱报
  assert.equal(modelEntry(CN, "early-access/EA-29B-A4B").limit.context, 128000)
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
