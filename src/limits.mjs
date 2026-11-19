// 每个模型能吃多长的上下文。
//
// /v1/models 只回 id，模型详情接口也不说窗口大小。之前所有线上模型的
// limit.context 都吃默认 128000 —— 对 DeepSeek-V4.1 / GLM-5.2 这种 1M
// 窗口的模型，等于骗了客户端：magpie 的 dsh 按「窗口 - 72K」当压缩阈值，
// 128K 窗口只剩 54272 令牌，一条 66K 的对话就压不动、切不过去（2026-11-19
// 用户报的错）。窗口按模型仓库里的 config.json 读：
//   max_position_embeddings，或 text_config / llm_config 里的同名键。
//
// 只有 config 里读得到的才写；读不到的不猜。MiniMax-M1-80k 的 config 写
// 10M（外推位置），实际服务窗口按名字是 80K，单独按 81920 算。
// 输出上限没有可靠的按模型来源，统一留 8192。

export const CONTEXTS = {
  "deepseek-ai/DeepSeek-V4-Flash-0731": 1048576,
  "deepseek-ai/DeepSeek-V4-Pro": 1048576,
  "deepseek-ai/DeepSeek-V4-Pro-0813": 1048576,
  "deepseek-ai/DeepSeek-V4.1-Flash": 1048576,
  "deepseek-ai/DeepSeek-V4.1-Flash-1017": 1048576,

  "MiniMax/MiniMax-M1-80k": 81920,
  "MiniMax/MiniMax-M3": 1048576,
  "mistralai/Mistral-Large-Instruct-2407": 131072,
  "moonshotai/Kimi-K3.1-Pro": 1048576,

  "nex-agi/Nex-N2.5-mini": 262144,
  "nex-agi/Nex-N2.5-Pro": 262144,
  "opencompass/CompassJudger-1-32B-Instruct": 32768,
  "OpenGVLab/InternVL3_5-241B-A28B": 40960,

  "PaddlePaddle/ERNIE-4.5-0.3B-PT": 131072,
  "PaddlePaddle/ERNIE-4.5-21B-A3B-PT": 131072,
  "PaddlePaddle/ERNIE-4.5-300B-A47B-PT": 131072,
  "PaddlePaddle/ERNIE-4.5-VL-28B-A3B-PT": 131072,

  "Qwen/Qwen3.5-122B-A10B": 262144,
  "Qwen/Qwen3.5-27B": 262144,
  "Qwen/Qwen3.5-35B-A3B": 262144,
  "Qwen/Qwen3.5-397B-A17B": 262144,
  "Qwen/Qwen3.8-27B": 262144,
  "Qwen/Qwen3.8-Flash-Next": 262144,

  "Shanghai_AI_Laboratory/Intern-S1": 65536,
  "Shanghai_AI_Laboratory/Intern-S1-mini": 65536,
  "Shanghai_AI_Laboratory/Intern-S2-Preview": 262144,

  "stepfun-ai/Step-3.5-Flash": 262144,
  "stepfun-ai/Step-3.7-Flash": 262144,
  "stepfun-ai/Step-5-Preview": 1048576,

  "XGenerationLab/XiYanSQL-QwenCoder-32B-2412": 32768,
  "XGenerationLab/XiYanSQL-QwenCoder-32B-2504": 32768,
  "ZhipuAI/GLM-4.7-Flash": 202752,
  "ZhipuAI/GLM-5.2": 1048576,
}

export function contextOf(id) {
  return CONTEXTS[id]
}
