// 账号显示名：api 类型的登录只有一把 key，magpie 默认把它显示成
// "API key …a1b2"。读到站点的用户名后写回账号，选择器和卡片上就是人名了。
// 官方 /openapi/v1/users/me（Bearer、无副作用）优先；它答不出时才碰
// login/info —— 那个接口本身会触发当日发放，不能当普通查询用。

import { PATHS } from "./sites.mjs"
import { envelopeData, siteGet } from "./net.mjs"

const checkedAt = new Map()
const NAME_AGAIN_MS = 10 * 60 * 1000
const NAMES_MAX = 256

function firstText(data, keys) {
  for (const k of keys) {
    const v = data[k]
    if (v !== undefined && v !== null && String(v).trim()) return String(v).trim()
  }
  return ""
}

export async function saveAccountName(profile, client, auth, payload, uid) {
  const data = envelopeData(payload)
  const name = firstText(data, ["NickName", "Name", "nickname", "name", "username", "Username"])
  if (!name || !client?.auth?.set) return
  if (name === String(auth.accountId ?? "") && (!uid || uid === String(auth.uid ?? ""))) return
  try {
    await client.auth.set({
      path: { id: profile.id },
      body: { ...auth, accountId: name, ...(uid ? { uid } : {}) },
    })
  } catch {
    // 写回失败不影响签到或读账
  }
}

export async function ensureName(profile, client, auth, token, signal) {
  if (!auth || String(auth.accountId ?? "") || !client?.auth?.set) return
  const now = Date.now()
  if (now - (checkedAt.get(token) || 0) < NAME_AGAIN_MS) return
  checkedAt.set(token, now)
  while (checkedAt.size > NAMES_MAX) checkedAt.delete(checkedAt.keys().next().value)
  try {
    const me = await siteGet(profile, PATHS.usersMe, token, "账号信息", "bearer", signal)
    const data = envelopeData(me)
    const name = firstText(data, ["username", "Username", "NickName", "nickname", "name"])
    if (name) {
      await saveAccountName(profile, client, auth, { Data: { NickName: name } }, firstText(data, ["HavanaId"]))
      return
    }
  } catch {
    // 退回 login/info；它可能顺带签到，交给下面的调用
  }
  try {
    await saveAccountName(profile, client, auth, await siteGet(profile, PATHS.loginInfo, token, "账号信息", "cookie", signal))
  } catch {
    // 名字只是好看，读不到就算了
  }
}
