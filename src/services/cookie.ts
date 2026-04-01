import axios from 'axios'
import { USER_AGENT_LIST } from './constant'

let auto_cookie: string | null = null
let now_user_agent: string | null = null
let cookie_updater: (() => Promise<string | null>) | null = null

export function setCookie(cookie: string | null) {
  auto_cookie = cookie
}

export function getCookie(): string | null {
  return auto_cookie
}

export function setUserAgent(userAgent: string | null) {
  now_user_agent = userAgent
}

export function getUserAgent(): string | null {
  return now_user_agent
}

export function getRandomUserAgent(): string {
  return USER_AGENT_LIST[Math.floor(Math.random() * USER_AGENT_LIST.length)]
}

export function setCookieUpdater(updater: (() => Promise<string | null>) | null) {
  cookie_updater = updater
}

export function extractXSRFToken(cookie: string | null): string {
  if (!cookie) return ''
  const match = cookie.match(/XSRF-TOKEN=([^;]+)/i)
  return match ? match[1] : ''
}

const mergeCookies = (cookies: string[]): string => {
  return cookies.map(c => c.split(';')[0]).join('; ')
}

export async function fetchCookie(): Promise<string> {
  if (!now_user_agent) {
    now_user_agent = USER_AGENT_LIST[0]
  }

  const commonHeaders = {
    'user-agent': now_user_agent,
    'accept': '*/*',
    'origin': 'https://passport.weibo.com',
    'referer': 'https://passport.weibo.com/visitor/visitor'
  }

  let allCookies: string[] = []

  const step1Response = await axios.post('https://passport.weibo.com/visitor/genvisitor2', 'cb=visitor_gray_callback&ver=20250916&request_id=fb15e537349aef3542ed130a47d48eb8&tid=&from=weibo&webdriver=false&rid=01by624JxwbmsPak-53wiC9LGhR6I&return_url=https://weibo.com/', {
    headers: {
      ...commonHeaders,
      'content-type': 'application/x-www-form-urlencoded'
    },
    responseType: 'text'
  })

  const step1SetCookies = step1Response.headers['set-cookie'] || []
  allCookies.push(...step1SetCookies)

  const step1Body = step1Response.data
  let visitorId: string = ''
  try {
    const jsonMatch = step1Body.match(/visitor_gray_callback\s*\(\s*({[\s\S]*})\s*\)/)
    if (!jsonMatch || !jsonMatch[1]) {
      throw new Error('无法从响应中提取 JSON 对象')
    }

    const step1Data = JSON.parse(jsonMatch[1])
    visitorId = step1Data?.data?.tid || ''
    if (!visitorId) {
      throw new Error('未获取到 visitor id，响应数据: ' + JSON.stringify(step1Data))
    }
  } catch (error: any) {
    throw new Error('解析 genvisitor2 响应失败: ' + error.message + ', 响应体: ' + step1Body)
  }

  const step2Response = await axios.get(`https://passport.weibo.com/visitor/visitor?a=incarnate&t=${encodeURIComponent(visitorId)}`, {
    headers: {
      ...commonHeaders,
      'cookie': mergeCookies(allCookies)
    },
    responseType: 'text'
  })

  const step2SetCookies = step2Response.headers['set-cookie'] || []
  allCookies.push(...step2SetCookies)

  return mergeCookies(allCookies)
}

export async function refreshCookie(): Promise<string | null> {
  if (cookie_updater) {
    const nextCookie = await cookie_updater()
    if (nextCookie) {
      setCookie(nextCookie)
      return nextCookie
    }
  }

  const fallbackCookie = await fetchCookie()
  setCookie(fallbackCookie)
  return fallbackCookie
}
