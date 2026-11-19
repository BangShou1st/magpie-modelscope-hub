// 每个模型「调一次扣多少魔粒」。
//
// 官方只公布三档价格（轻量 0.5、主流 1、旗舰 2），却没有「哪个模型属于
// 哪档」的接口：/v1/models 只回 id，模型详情 API 里没有价格或档位字段，
// 模型页上那句「预计消耗魔粒」是前端算的。所以这张表是实测出来的：
// 对每个模型各打一次最小请求，再读当天账单，看 SPEND_CONFIRM 里哪个
// model_tier 的 count 加了 1，加的钱数就是这个模型的单价。
//
// 只写实测过的。没测到的（返回 "has no provider supported" / 401 的）
// 不给值 —— 没数就不显示倍率，不拿别的模型的价来猜。
//
// 重测办法：node _probe/rate-sweep.mjs，结果写 _probe/rate-map.json。

export const RATES = {
  // 轻量 0.5 魔粒/次
  "nex-agi/Nex-N2.5-mini": 0.5,

  // 主流 1 魔粒/次
  "MiniMax/MiniMax-M1-80k": 1,
  "mistralai/Mistral-Large-Instruct-2407": 1,
  "nex-agi/Nex-N2.5-Pro": 1,
  "opencompass/CompassJudger-1-32B-Instruct": 1,
  "Qwen/Qwen3.5-122B-A10B": 1,
  "Qwen/Qwen3.5-27B": 1,
  "Qwen/Qwen3.5-35B-A3B": 1,
  "Qwen/Qwen3.8-27B": 1,
  "Qwen/Qwen3.8-Flash-Next": 1,
  "Shanghai_AI_Laboratory/Intern-S2-Preview": 1,
  "XGenerationLab/XiYanSQL-QwenCoder-32B-2412": 1,
  "XGenerationLab/XiYanSQL-QwenCoder-32B-2504": 1,

  // 旗舰 2 魔粒/次
  "deepseek-ai/DeepSeek-V4-Pro-0813": 2,
  "deepseek-ai/DeepSeek-V4.1-Flash-1017": 2,
  "Qwen/Qwen3.5-397B-A17B": 2,
  "ZhipuAI/GLM-5.2": 2,
}

// 国际站还没登录、也没测过，不给价；以后在那边实测了再按站点分开写。
export function rateOf(profile, id) {
  if (profile?.id !== "modelscope-cn") return undefined
  return RATES[id]
}
