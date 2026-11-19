// magpie-modelscope-hub —— 一个插件包，两块魔搭站点，各自「能调用 + 能签到」。
//
// 背景：上游是两个互不相干的插件 —— msmoli 只做魔粒签到（cn + ai 两站，但
// 不提供模型），ms-ai 只做国际站的推理（顺带国际站签到）。用户的诉求是
// 装一个插件就把两件事都办了。
//
// 为什么是「一个包、两个 provider」而不是「一个 provider 通吃两站」：
// magpie host.js 的 info() 列出 provider 的模型时，只用 accountsOf(readAuth(),
// id)[0] —— 也就是**第一个账号** —— 的身份去问一次 provider.models 钩子。
// 一个 provider 里混装国内站和国际站的令牌，模型列表就只会反映第一个账号那
// 个站，另一个站的账号一调用就是 401。分两个 provider 各有自己的模型目录、
// 用量卡和签到，互不串味，而安装、卸载、升级仍然是一个插件。

import { AI, CN } from "./src/sites.mjs"
import { apiBase } from "./src/sites.mjs"
import { modelsFor } from "./src/models.mjs"
import { checkinFor } from "./src/checkin.mjs"
import { dropLive, noteCall, resetLive, usageFor } from "./src/usage.mjs"
import { resetModelsCache } from "./src/models.mjs"
import { rateOf } from "./src/rates.mjs"
import { requestModel, withCredit, withUsageOption } from "./src/credit.mjs"

// 魔搭的方块标（models.dev 那份），内联成 data URI：不联网也能画出来。
const ICON =
  "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCA0MCA0MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTYuNzc4MjUgMTAuNDk5OUgxNC4zMzMzVjE0LjI3ODJIMTAuNTU1MVYxOC4wNTVINi43NzgyNVYxNC45ODY1SDMuNzA4MzNWMTguMDU1SDYuNzc4MjVWMjEuODMzM0gzVjE0LjI3ODJINi43NzgyNVYxMC40OTk5Wk02Ljc3ODI1IDIxLjgzMzNIMTAuNTU1MVYyNS42MTE1SDE0LjMzMzNWMjkuMzg4NEg2Ljc3ODI1VjIxLjgzMzNaTTE0LjMzMzMgMTguMDU1SDE4LjExMTZWMjEuODMzM0gxNC4zMzMzVjE4LjA1NVpNMjEuODg4NCAyMS44MzMzVjI1LjYxMTVIMTguMTExNlYyMS44MzMzSDIxLjg4ODRaTTIxLjg4ODQgMjEuODMzM1YxOC4wNTVIMjUuNjY2N1YyMS44MzMzSDIxLjg4ODRaIiBmaWxsPSJjdXJyZW50Q29sb3IiLz4KPHBhdGggZD0iTTMzLjIyMTggMjEuODMzM1YxOC4wNTVIMjkuNDQ1VjE0LjI3ODJIMjUuNjY2N1YxMC40OTk5SDMzLjIyMThWMTQuMjc4MkgzNy4wMDAxVjIxLjgzMzNIMzMuMjIxOFpNMzMuMjIxOCAxOC4wNTVIMzYuMjkxOFYxNC45ODY1SDMzLjIyMThWMTguMDU1WiIgZmlsbD0iY3VycmVudENvbG9yIi8+CjxwYXRoIGQ9Ik0zMy4yMjE4IDIxLjgzMzNWMjkuMzg4NEgyNS42NjY3VjI1LjYxMTZIMjkuNDQ1VjIxLjgzMzNIMzMuMjIxOFoiIGZpbGw9ImN1cnJlbnRDb2xvciIvPgo8L3N2Zz4K"

// 一个站点的插件实例：config / auth（含 loader、usage、checkin）/ provider。
function makePlugin(profile) {
  return async function plugin(input = {}) {
    const client = input?.client
    return {
      // 先声明 provider 与兜底模型：登录之前、/models 拉不到时，选择器里也有东西。
      config: async (cfg) => {
        cfg.provider ??= {}
        cfg.provider[profile.id] ??= {
          name: profile.name,
          npm: "@ai-sdk/openai-compatible",
          api: apiBase(profile),
          models: profile.fallback,
        }
      },

      auth: {
        provider: profile.id,
        icon: ICON,
        methods: [{ type: "api", label: profile.keyLabel, placeholder: profile.keyHint }],

        // 推理请求：按账号令牌转发到该站的 API-Inference。
        // 答案本身原样交回，只额外说清它对「登录」意味着什么：
        //   401 令牌被拒（expired）
        //   402 魔粒用完（kept，同时丢弃用量缓存，下一张卡立刻停用）
        //   403 模型无权限 / 429 网关限流（kept，都不是登录问题）
        async loader(getAuth) {
          const auth = await getAuth()
          if (auth?.type !== "api") return {}
          return {
            baseURL: apiBase(profile),
            async fetch(input, init) {
              const headers = new Headers(init?.headers)
              headers.set("authorization", `Bearer ${auth.key}`)
              const prepared = withUsageOption(input, init)
              const rate = rateOf(profile, requestModel(prepared))
              const res = await fetch(input, { ...prepared, headers })
              if (res.status === 200) {
                noteCall(profile, auth.key)
                // 按次计费、单价已知：把这一笔的魔粒写进 usage.credit，
                // magpie 的用量页就能逐条显示（WorkBuddy 的 credit 同一个字段）。
                if (rate !== undefined) return withCredit(res, rate)
              }
              if (res.status === 401) return withSignIn(res, "expired")
              if (res.status === 403) return withSignIn(res, "kept")
              if (res.status === 402) {
                dropLive(profile, auth.key)
                return withSignIn(res, "kept")
              }
              if (res.status === 429) return withSignIn(res, "kept")
              return res
            },
          }
        },

        usage: (getAuth) => getAuth().then((auth) => usageFor(profile, auth)),
        checkin: (getAuth) => getAuth().then((auth) => checkinFor(profile, auth, client)),
      },

      provider: {
        id: profile.id,
        models: (given, { auth, signal } = {}) => modelsFor(profile, given?.models, auth, signal),
      },
    }
  }
}

function withSignIn(res, state) {
  const headers = new Headers(res.headers)
  headers.set("x-magpie-sign-in", state)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

export const ModelScopeCnPlugin = makePlugin(CN)
export const ModelScopeAiPlugin = makePlugin(AI)

// magpie 会把入口模块里每个导出函数都当成一个插件实例调用，所以测试用的
// 工具只能挂在这个对象上，不能单独导出成函数。
export const _internal = {
  CN,
  AI,
  makePlugin,
  resetLive,
  resetModelsCache,
  withSignIn,
  withCredit,
  requestModel,
  withUsageOption,
}
