// 两个站点共用同一套接口：/api/v1/users/login/info（签到触发）、
// /openapi/v1/magicubes/balance（余额）、/openapi/v1/magicubes/transactions
// （魔粒账单）、/models（模型目录）。差别只有域名、模型目录和卡片上的字。
//
// 一个插件包里注册两个 provider，不是一个 provider 装两个站的账号：
// magpie 的 provider.models 钩子每次只在“第一个账号”的身份下被问一次
// （host.js 的 info()：accountsOf(readAuth(), id)[0]），一个 provider 混装
// 两个站的令牌，列出来的模型只会是其中一个站的，另一个站的账号一调用就 401。
// 两个 provider 各有自己的模型列表、用量卡和签到，互不影响。

export const CN = {
  id: "modelscope-cn",
  name: "魔搭 ModelScope（国内站）",
  plan: "魔搭社区",
  where: "国内站",
  site: "https://modelscope.cn",
  api: "https://api-inference.modelscope.cn/v1",
  keyLabel: "国内站 modelscope.cn 的访问令牌",
  keyHint: "ms-…（modelscope.cn 个人中心生成）",
  docs: "https://modelscope.cn/docs/model-service/API-Inference/intro",
  envApi: "MODELSCOPE_CN_API_BASE",
  envSite: "MODELSCOPE_CN_SITE_URL",
  // 令牌不是这一站的：这句会出现在 401 的报错里
  wrongSite: "令牌失效，或不是国内站 modelscope.cn 的令牌",
  // 内置兜底：models.dev 目录里 modelscope 一项的七个模型（未登录时也能列出来）。
  fallback: {
    "Qwen/Qwen3-30B-A3B-Instruct-2507": {
      name: "Qwen3 30B A3B Instruct 2507",
      limit: { context: 262144, output: 16384 },
      tool_call: true,
    },
    "Qwen/Qwen3-235B-A22B-Instruct-2507": {
      name: "Qwen3 235B A22B Instruct 2507",
      limit: { context: 262144, output: 131072 },
      tool_call: true,
    },
    "Qwen/Qwen3-235B-A22B-Thinking-2507": {
      name: "Qwen3 235B A22B Thinking 2507",
      limit: { context: 262144, output: 131072 },
      reasoning: true,
      tool_call: true,
    },
    "Qwen/Qwen3-30B-A3B-Thinking-2507": {
      name: "Qwen3 30B A3B Thinking 2507",
      limit: { context: 262144, output: 32768 },
      reasoning: true,
      tool_call: true,
    },
    "Qwen/Qwen3-Coder-30B-A3B-Instruct": {
      name: "Qwen3 Coder 30B A3B Instruct",
      limit: { context: 262144, output: 65536 },
      tool_call: true,
    },
    "ZhipuAI/GLM-4.6": {
      name: "GLM-4.6",
      limit: { context: 202752, output: 98304 },
      reasoning: true,
      tool_call: true,
    },
    "ZhipuAI/GLM-4.5": {
      name: "GLM-4.5",
      limit: { context: 131072, output: 98304 },
      reasoning: true,
      tool_call: true,
    },
  },
  // 国内站没有逐个实测过的死模型，留空；/models 列出来的一律当可用。
  deprecated: [],
  deprecatedPrefixes: [],
}

export const AI = {
  id: "modelscope-ai",
  name: "魔搭 ModelScope（国际站）",
  plan: "魔搭社区（国际版）",
  where: "国际站",
  site: "https://www.modelscope.ai",
  api: "https://api-inference.modelscope.ai/v1",
  keyLabel: "国际站 modelscope.ai 的访问令牌",
  keyHint: "ms-…（modelscope.ai 个人中心生成）",
  docs: "https://modelscope.ai/docs/model-service/API-Inference/intro",
  envApi: "MODELSCOPE_AI_API_BASE",
  envSite: "MODELSCOPE_AI_SITE_URL",
  wrongSite: "令牌失效，或不是国际站 modelscope.ai 的令牌",
  // 上游 ms-ai 插件 2026-11-02 逐个 provider test 过、确认可调用的旗舰模型。
  fallback: {
    "deepseek-ai/DeepSeek-V4.1-Flash-1017": {
      name: "DeepSeek V4.1 Flash 1017",
      limit: { context: 1048576, output: 393216 },
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    },
    "zai-org/GLM-5.2": {
      name: "GLM 5.2",
      limit: { context: 1048576, output: 131072 },
      reasoning: true,
      tool_call: true,
    },
    "nex-agi/Nex-N2.5-Pro": {
      name: "Nex N2.5 Pro",
      limit: { context: 262144, output: 235929 },
      reasoning: true,
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
    },
  },
  // /models 列出但计划调不动的：Ambassador 档 403、部分条目 400
  // "has no provider supported"。精确匹配，不是前缀 —— DeepSeek-V4-Pro 死了
  // 而 -0813 能调，前缀匹配会把能用的那个一起拖下水。
  deprecated: [
    "deepseek-ai/DeepSeek-V4-Pro",
    "deepseek-ai/DeepSeek-V4.1-Flash",
    "deepseek-ai/DeepSeek-V4-Flash-0731",
    "zai-org/GLM-5.3",
    "zai-org/GLM-5.3-Flash",
    "stepfun-ai/Step-5-Preview",
    "stepfun-ai/Step-3.5-Flash",
    "MiniMax/MiniMax-M3",
    "Menlo/Jan-nano",
    "early-access/EA-29B-A4B",
  ],
  deprecatedPrefixes: ["Qwen-Ambassador/"],
}

export const SITES = [CN, AI]

// 接口路径：两站同构。
export const PATHS = {
  loginInfo: "/api/v1/users/login/info",
  usersMe: "/openapi/v1/users/me",
  balance: "/openapi/v1/magicubes/balance",
  txns: "/openapi/v1/magicubes/transactions",
  models: "/models",
}

// 每日发放的规则名。这一档魔粒 24 小时过期，不累积。
export const DAILY_RULES = ["daily_active", "aliyun_bindlogin"]

// 国内站和国际站的站点地址、API 地址都可以用环境变量盖掉（测试与自建网关）。
export function apiBase(profile) {
  const v = process.env[profile.envApi]
  return (v || profile.api).replace(/\/+$/, "")
}

export function siteBase(profile) {
  const v = process.env[profile.envSite]
  return (v || profile.site).replace(/\/+$/, "")
}

// 站点自己的网页接口要求一个浏览器 UA：裸 fetch 的 UA 是被实测过
// 会拿到另一种回答的形态。这个字符串固定，指代一个浏览器版本而不是冒充。
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

// 单次请求等待上限；一个不答话的上游不该把用量卡或签到卡住。
export const TIMEOUT_MS = 20_000
// 账单一页最多 50 条（服务端对 page_size 有自己的上限），读 3 页足够覆盖到
// 今天的第一条 EARN 行；忙碌的账号一天几十条 SPEND 也只排在前面。
export const LEDGER_PAGE = 50
export const LEDGER_PAGES = 3
