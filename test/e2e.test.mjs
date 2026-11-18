// 端到端：起一个假的魔搭站点，把插件的两个钩子（签到、用量）和模型列表跑通。
// 不碰真令牌、不联外网：站点地址用环境变量盖到本地 127.0.0.1。

import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"

import { CN } from "../src/sites.mjs"
import { beijingDay } from "../src/net.mjs"
import { _internal } from "../index.mjs"

const DAY = beijingDay()
const TOKEN = "ms-testtoken-0123456789"

// 站点状态：签到前账本里没有发放行，login/info 之后才有。
function makeSite() {
  const state = { checkedIn: false, balance: 238, calls: 1 }
  const earnRow = () => ({
    type: "EARN",
    rule_key: "daily_active",
    gmt_created: DAY,
    total_amount: 200,
    expire_days: 1,
    expire_at: `${DAY} 23:59:00`,
  })
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x")
    const send = (body, status = 200) => {
      res.writeHead(status, { "content-type": "application/json" })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === "/api/v1/users/login/info") {
      state.checkedIn = true
      return send({ Code: 200, Success: true, Data: { NickName: "测试用户", HavanaId: "u-1" } })
    }
    if (url.pathname === "/openapi/v1/users/me") {
      return send({ code: 200, success: true, data: { username: "测试用户" } })
    }
    if (url.pathname === "/openapi/v1/magicubes/balance") {
      return send({ Code: 200, Data: { available_balance: state.balance, total_balance: state.balance } })
    }
    if (url.pathname === "/openapi/v1/magicubes/transactions") {
      const records = []
      if (state.checkedIn) records.push(earnRow())
      records.push({ type: "SPEND_CONFIRM", gmt_created: DAY, total_amount: 2 * state.calls, count: state.calls })
      return send({ Code: 200, Data: { records } })
    }
    if (url.pathname === "/models") {
      return send({ data: [{ id: "test/model-a", created: 1780000000 }] })
    }
    send({ Code: 404, Message: "not found" }, 404)
  })
  return { state, server }
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return `http://127.0.0.1:${server.address().port}`
}

test("端到端：签到 → 到账 → 用量卡 → 模型列表", async (t) => {
  const { state, server } = makeSite()
  const site = await listen(server)
  const api = site // API-Inference 也指到这里，/models 走同一个服务
  process.env.MODELSCOPE_CN_SITE_URL = site
  process.env.MODELSCOPE_CN_API_BASE = api
  t.after(() => {
    delete process.env.MODELSCOPE_CN_SITE_URL
    delete process.env.MODELSCOPE_CN_API_BASE
    server.close()
  })

  _internal.resetLive()
  _internal.resetModelsCache()

  const written = []
  const plugin = await _internal.makePlugin(CN)({
    client: {
      auth: {
        set: async (args) => {
          written.push(args.body)
        },
      },
    },
  })
  const getAuth = async () => ({ type: "api", key: TOKEN })

  // 第一次：账本没有发放行 → 碰 login/info → 发放到账 → claimed
  const first = await plugin.auth.checkin(getAuth)
  assert.equal(first.outcome, "claimed")
  assert.equal(first.credit, 200)
  assert.equal(written.length, 1)
  assert.equal(written[0].accountId, "测试用户")
  assert.equal(written[0].key, TOKEN)

  // 第二次：账本里已有发放行 → done，不再碰 login/info
  const second = await plugin.auth.checkin(getAuth)
  assert.equal(second.outcome, "done")
  assert.equal(second.credit, 200)

  // 用量卡：余额 238，今日发放 200 / 已花 2，合计 limit = 238 + 2
  state.calls = 1 // 一次调用，2 魔粒
  const card = await plugin.auth.usage(getAuth)
  assert.equal(card.balance, "238")
  const total = card.windows.find((w) => w.name === "合计")
  assert.equal(total.limit, 240)
  assert.equal(total.amount, 2)
  const day = card.windows.find((w) => w.name === "今日发放")
  assert.equal(day.limit, 200)
  assert.equal(day.aside, true)

  // 模型列表：拉到厂商的 /models，并按站点 id 标注
  const models = await plugin.provider.models({ models: {} }, { auth: { type: "api", key: TOKEN } })
  assert.ok(models["test/model-a"])
  assert.equal(models["test/model-a"].providerID, "modelscope-cn")
})

test("端到端：令牌被拒时，签到和用量都把账号标成需要重新登录", async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(401, { "content-type": "application/json" })
    res.end(JSON.stringify({ Code: 401, Message: "unauthorized" }))
  })
  const site = await listen(server)
  process.env.MODELSCOPE_CN_SITE_URL = site
  process.env.MODELSCOPE_CN_API_BASE = site
  t.after(() => {
    delete process.env.MODELSCOPE_CN_SITE_URL
    delete process.env.MODELSCOPE_CN_API_BASE
    server.close()
  })

  _internal.resetLive()
  const plugin = await _internal.makePlugin(CN)({})
  const getAuth = async () => ({ type: "api", key: TOKEN })

  await assert.rejects(() => plugin.auth.checkin(getAuth), (err) => err.signIn === "expired")

  const card = await plugin.auth.usage(getAuth)
  assert.equal(card.signIn, "expired")
  assert.equal(card.windows.length, 0)
})
