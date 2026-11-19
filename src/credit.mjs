// 把「这次调用值多少魔粒」写进响应的 usage.credit。
//
// magpie 的用量账本有一条 credits（internal/usage/ledger.go）：记录响应里
// usage.credit 说的「这一笔花了多少积分」，WorkBuddy 就是靠它按请求显示的。
// 魔搭的响应只有 token 用量，没有这个字段；但按次计费、单价已知（src/rates.mjs），
// 所以由插件补上 —— 对实测过的模型，这个数和厂商实际扣的一样。
//
// 只动成功响应；4xx/5xx 不扣魔粒，不写。没实测过单价的模型不写，不猜。

const TEXT = new TextEncoder()
const DECODE = new TextDecoder()

function rewriteLine(line, rate) {
  const cr = line.endsWith("\r")
  const raw = cr ? line.slice(0, -1) : line
  if (!raw.startsWith("data:")) return line
  const payload = raw.slice(5).trim()
  if (!payload || payload === "[DONE]") return line
  try {
    const chunk = JSON.parse(payload)
    if (chunk?.usage && typeof chunk.usage === "object") {
      chunk.usage.credit = rate
      return `data: ${JSON.stringify(chunk)}${cr ? "\r" : ""}`
    }
  } catch {
    // 不是 JSON 的事件原样放行
  }
  return line
}

function creditStream(body, rate) {
  let buffer = ""
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        buffer += DECODE.decode(chunk, { stream: true })
        let at
        while ((at = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, at)
          buffer = buffer.slice(at + 1)
          controller.enqueue(TEXT.encode(`${rewriteLine(line, rate)}\n`))
        }
      },
      flush(controller) {
        buffer += DECODE.decode()
        if (buffer) controller.enqueue(TEXT.encode(rewriteLine(buffer, rate)))
      },
    }),
  )
}

function bare(headers) {
  const out = new Headers(headers)
  // 正文重新编码过，长度和压缩标记都不再作数
  out.delete("content-length")
  out.delete("content-encoding")
  return out
}

export async function withCredit(res, rate) {
  if (!(rate > 0)) return res
  const type = res.headers.get("content-type") ?? ""
  if (type.includes("text/event-stream")) {
    return new Response(creditStream(res.body, rate), {
      status: res.status,
      statusText: res.statusText,
      headers: bare(res.headers),
    })
  }
  const text = await res.text()
  let body = text
  try {
    const json = JSON.parse(text)
    if (json?.usage && typeof json.usage === "object") {
      json.usage.credit = rate
      body = JSON.stringify(json)
    }
  } catch {
    // 不是 JSON：原样交回
  }
  return new Response(body, { status: res.status, statusText: res.statusText, headers: bare(res.headers) })
}

// 请求体里的模型 id；流式或表单体读不出来时返回 undefined。
export function requestModel(init) {
  if (typeof init?.body !== "string") return undefined
  try {
    const json = JSON.parse(init.body)
    return typeof json?.model === "string" ? json.model : undefined
  } catch {
    return undefined
  }
}

// 魔搭流式响应默认不带 usage（结尾那些块的 usage 是 null），要显式要
// stream_options.include_usage 才会在最后给一块带 token 用量的 usage。
// 只动 chat/completions，别的端点不碰。
export function withUsageOption(input, init) {
  if (typeof init?.body !== "string") return init
  if (!String(input).includes("/chat/completions")) return init
  try {
    const json = JSON.parse(init.body)
    if (json?.stream !== true) return init
    if (json.stream_options?.include_usage === true) return init
    json.stream_options = { ...json.stream_options, include_usage: true }
    return { ...init, body: JSON.stringify(json) }
  } catch {
    return init
  }
}
