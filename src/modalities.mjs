// 模型吃不吃图片、吐不吐图片。
//
// /v1/models 只回 id，所以之前的写法是给每个模型都填 image:false、pdf:false……
// 这在 magpie 里不是「不知道」，而是**明确的「不支持」**：网关看到模型声明
// 不收图，就会把图先描述成文字再发过去（或者干脆 400），视觉模型也用不上
// 自家的眼睛。
//
// 依据是魔搭模型页的 pipeline 标签（`/api/v1/models/<id>` 的 Tasks），
// 2026-11-18 对国内站 38 个模型逐个核过：
//   image-text-to-text  → 收图，出文本
//   text-generation     → 只吃文本
//   image-to-image      → 只收图、只出图（这类不是聊天模型，输出里没有 text，
//                         magpie 会把它从聊天列表里摘掉，只在画图入口出现）
// 表里没有的新 id 不硬写「不支持」，只报它是文本模型、不声明图片能力，
// 这样将来上的视觉模型仍然能收到图，而不是被本地网关先挡掉。

const IMAGE_ONLY = new Set([
  "Qwen/Qwen-Image-Edit",
  "MusePublic/Qwen-Image-Edit",
])

const VISION = new Set([
  "deepseek-ai/DeepSeek-V4.1-Flash",
  "deepseek-ai/DeepSeek-V4.1-Flash-1017",
  "MiniMax/MiniMax-M3",
  "moonshotai/Kimi-K3.1-Pro",
  "OpenGVLab/InternVL3_5-241B-A28B",
  "PaddlePaddle/ERNIE-4.5-VL-28B-A3B-PT",
  "Qwen/Qwen3.5-122B-A10B",
  "Qwen/Qwen3.5-27B",
  "Qwen/Qwen3.5-35B-A3B",
  "Qwen/Qwen3.5-397B-A17B",
  "Qwen/Qwen3.8-27B",
  "Qwen/Qwen3.8-Flash-Next",
  "Shanghai_AI_Laboratory/Intern-S1",
  "Shanghai_AI_Laboratory/Intern-S1-mini",
  "Shanghai_AI_Laboratory/Intern-S2-Preview",
  "stepfun-ai/Step-3.7-Flash",
])

// 表里没有、但明摆着是视觉模型的命名，也按收图处理。
const VISION_RULES = [
  /^Qwen\/Qwen3\.(5|8)-/, // Qwen3.5 / 3.8 起原生视觉语言
  /^Shanghai_AI_Laboratory\/Intern-S/, // Intern-S 一系是多模态科学模型
  /\/[^/]*VL[^/]*$/, // …VL…：ERNIE-4.5-VL、InternVL3_5
  /^moonshotai\/Kimi-K[3-9]/, // K3 起带视觉
  /^MiniMax\/MiniMax-M[3-9]/,
]

const IMAGE_ONLY_RULES = [/Image-Edit$/i, /-Image$/i]

export function kindOf(id) {
  const key = String(id || "")
  if (IMAGE_ONLY.has(key) || IMAGE_ONLY_RULES.some((re) => re.test(key))) return "image"
  if (VISION.has(key) || VISION_RULES.some((re) => re.test(key))) return "vision"
  return "text"
}

// 返回 capabilities.input / output 该写什么，以及 attachment。
// text 只写 true，不写 false：false 表示「这个模型不产出文本」，聊天模型
// 不该这么说自己。
export function modalitiesOf(id, known) {
  const kind = kindOf(id)
  if (kind === "image") {
    return {
      input: { image: true },
      output: { text: false, image: true },
      attachment: true,
    }
  }
  if (kind === "vision") {
    return {
      input: { text: true, image: true },
      output: { text: true },
      attachment: true,
    }
  }
  // 兜底数据里明确写了多模态的（models.dev 那份），以它为准。
  const knownInput = known?.modalities?.input
  if (knownInput?.length) {
    const input = { text: true }
    for (const k of knownInput) if (k === "image" || k === "video" || k === "pdf") input[k] = true
    return {
      input,
      output: { text: true },
      attachment: input.image === true,
    }
  }
  return { input: { text: true }, output: { text: true }, attachment: false }
}
