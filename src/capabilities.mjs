// 模型的推理能力与推理强度。
//
// /v1/models 只回 id，回不了「这是不是思考模型」「支持哪几档推理强度」。
// 不补这张表，实时目录一拉到，兜底里那些 reasoning: true 就全丢了（线上
// 38 个模型都会变成非思考模型），选择器里也没有强度可选。
//
// 只写有出处的：模型卡上明确写了 reasoning_effort 档位、或明确说默认思考
// 的，才写进来。厂商没写、我们也没实测过的，一律不猜 —— 猜出来的档位在
// 请求里会被上游当未知字段忽略，用户选了「high」实际还是默认档，比没有
// 更糟。
//
// efforts 的形状照 OpenCode 给 AI SDK 的写法：{ <档位>: { reasoningEffort: <档位> } }，
// @ai-sdk/openai-compatible 会把它发成请求体的 reasoning_effort。

const FAMILIES = [
  {
    // 模型卡：reasoning_effort = none / medium（默认）/ high
    // https://www.modelscope.ai/models/nex-agi/Nex-N2.5-mini
    re: /^nex-agi\/Nex-N2\.5(-mini|-Pro)?$/,
    reasoning: true,
    efforts: ["none", "medium", "high"],
  },
  {
    // 模型卡：支持 enable_thinking / preserve_thinking / reasoning_effort，
    // 默认 xhigh，可调 xhigh、medium、low
    // https://www.modelscope.ai/models/Qwen/Qwen3.8-Flash-Next
    // https://www.modelscope.cn/models/Qwen/Qwen3.8-27B
    re: /^Qwen\/Qwen3\.8-/,
    reasoning: true,
    efforts: ["low", "medium", "xhigh"],
  },
  {
    // 模型卡：默认思考，enable_thinking 关/开；没有分档的 reasoning_effort
    // https://www.modelscope.ai/models/Qwen/Qwen3.5-397B-A17B
    re: /^Qwen\/Qwen3\.5-/,
    reasoning: true,
  },
  {
    // 思考模型：输出里带 reasoning_content（DeepSeek 一系）
    re: /^deepseek-ai\/DeepSeek-V4/,
    reasoning: true,
  },
  {
    // GLM 4.5 / 4.6 在 models.dev 的目录里就是 reasoning: true；5.2 同系
    re: /^ZhipuAI\/GLM-(4\.5|4\.6|4\.7|5\.2)/,
    reasoning: true,
  },
]

// 逐个 id 查表。找不到的返回 undefined，调用方按「不确定」处理，不写成 false。
export function familyOf(id) {
  return FAMILIES.find((f) => f.re.test(String(id || "")))
}

export function reasoningOf(id) {
  return familyOf(id)?.reasoning
}

export function effortsOf(id) {
  return familyOf(id)?.efforts ?? []
}

export function variantsOf(id) {
  return Object.fromEntries(effortsOf(id).map((e) => [e, { reasoningEffort: e }]))
}

export const FAMILY_TABLE = FAMILIES
