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

// -----------------------------------------------------------------------------
// 以下为原 puppeteer-cookie.ts 的内容合并
// -----------------------------------------------------------------------------

type AnyCookie = any

const WEIBO_PASSPORT_URL = 'https://passport.weibo.com/'

export interface CookieResult {
  cookieString: string
  cookies: AnyCookie[]
  qrImageDataUrl?: string
  qrDetected?: boolean
}

export async function saveCookiesToDatabase(ctx: any, cookies: AnyCookie[]) {
  const now = new Date()
  const simplifiedCookies = cookies.map(c => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    updatedAt: now,
  }))

  // Koishi 的 ctx.database.upsert 默认行为就是：存在主键则更新，不存在则插入
  // 因为在 index.ts 中我们将 ['name', 'domain'] 设置为了复合主键
  await ctx.database.upsert('weibo_cookies', simplifiedCookies)
}

export async function loadCookiesFromDatabase(ctx: any): Promise<AnyCookie[] | null> {
  try {
    const cookies = await ctx.database.get('weibo_cookies', {})
    return cookies.length > 0 ? cookies : null
  } catch {
    return null
  }
}

export async function loadCookieStringFromDatabase(ctx: any): Promise<string | null> {
  try {
    const cookies = await loadCookiesFromDatabase(ctx)
    if (!cookies) return null
    return buildCookieString(cookies)
  } catch {
    return null
  }
}

function buildCookieString(cookies: AnyCookie[]): string {
  const filtered = cookies.filter(c =>
    c.domain.includes('weibo.com') || c.domain.includes('weibo.cn')
  )
  return filtered.map(c => `${c.name}=${c.value}`).join('; ')
}

async function gotoAndWait(page: any, url: string, timeoutMs: number) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: timeoutMs })
}

async function wait(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function isLoggedIn(page: any): Promise<boolean> {
  try {
    const cookies = await page.cookies()
    // 微博登录成功的核心标志是存在 SUB (Session User Badge) cookie
    const hasSub = cookies.some((c: any) => c.name === 'SUB')
    return hasSub
  } catch {
    return false
  }
}

export interface QrLoginOptions {
  timeoutMs?: number
  onPageCreated?: (page: any) => void | Promise<void>
  onQrCaptured?: (dataUrl: string | null) => void | Promise<void>
}

async function clickQrTabIfNeeded(page: any) {
  const clicked = await page.evaluate(() => {
    const keywords = ['扫码', '二维码', 'Scan', 'QR']
    const candidates = Array.from(document.querySelectorAll('button, a, div, span, li'))
    for (const el of candidates) {
      const text = (el as HTMLElement).innerText || ''
      const className = (el as HTMLElement).className || ''
      if (keywords.some(k => text.includes(k)) || className.includes('qr') || className.includes('Qr')) {
        (el as HTMLElement).click()
        return true
      }
    }
    return false
  })
  if (!clicked) {
    // try common selectors
    const sel = ['.qrcode', '.qr', '[class*="qr"]', '[class*="qrcode"]', 'li[class*="qr"]', 'div[role="tab"]', 'a[href*="qr"]']
    for (const s of sel) {
      const el = await page.$(s)
      if (el) {
        try { await el.click(); break } catch { }
      }
    }
  }
}

async function getQrElement(page: any) {
  const selectors = [
    // Common QR code selectors
    'img[src*="qr"]',
    'img[src*="qrcode"]',
    'img[alt*="二维码"]',
    'img[alt*="QR"]',
    'img[alt*="Scan"]',

    // Class-based selectors
    '.qrcode img',
    '.qr img',
    '[class*="qr"] img',
    '[class*="qrcode"] img',
    '[class*="QR"] img',
    '[class*="Qr"] img',

    // Canvas-based QR codes
    '[class*="qr"] canvas',
    '[class*="qrcode"] canvas',
    'canvas',

    // Container-based selectors
    '.qrcode',
    '.qr',
    '[class*="qr"]',
    '[class*="qrcode"]',

    // Weibo-specific selectors
    '[id*="qr"]',
    '[data-role="qrcode"]',
    '[data-type="qrcode"]',
    'div[class*="qrcode"]',
    'section[class*="qrcode"]'
  ]

  for (const sel of selectors) {
    const el = await page.$(sel)
    if (el) {
      // Check if this element is actually a QR code by looking at its size and content
      const boundingBox = await el.boundingBox()
      if (boundingBox && boundingBox.width > 100 && boundingBox.height > 100) {
        return el
      }
    }
  }

  // Try to find QR code by context
  const found = await page.evaluate(() => {
    const texts = ['扫描二维码登录', '打开微博手机APP', '扫一扫', 'Scan QR Code', 'QR Code']
    const elements = Array.from(document.querySelectorAll('div, section, article, form, main'))
    for (const el of elements) {
      const text = (el as HTMLElement).innerText || ''
      if (!texts.some(item => text.includes(item))) continue

      // Look for images or canvases in this context
      const target = el.querySelector('canvas, img, [class*="qr"], [class*="qrcode"]')
      if (target) {
        target.setAttribute('data-koishi-weibo-qr', 'true')
        return true
      }
    }
    return false
  })

  if (found) {
    const element = await page.$('[data-koishi-weibo-qr="true"]')
    if (element) return element
  }

  // As a last resort, try to find any image or canvas that looks like a QR code
  const allImages = await page.$$('img, canvas')
  for (const img of allImages) {
    const boundingBox = await img.boundingBox()
    if (boundingBox && boundingBox.width > 100 && boundingBox.height > 100) {
      // Check if it's roughly square
      const aspectRatio = boundingBox.width / boundingBox.height
      if (aspectRatio > 0.8 && aspectRatio < 1.2) {
        return img
      }
    }
  }

  return null
}

async function waitForQrElement(page: any, timeoutMs: number) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const element = await getQrElement(page)
    if (element) return element
    await wait(500)
  }
  return null
}

export async function captureQrFromPage(page: any, timeoutMs = 1500): Promise<{ dataUrl: string | null, detected: boolean }> {
  try {
    const element = await waitForQrElement(page, timeoutMs)
    if (!element) {
      return { dataUrl: null, detected: false }
    }
    const base64 = await element.screenshot({ encoding: 'base64' })
    return {
      dataUrl: `data:image/png;base64,${String(base64)}`,
      detected: true,
    }
  } catch {
    return { dataUrl: null, detected: false }
  }
}

export async function loginWithQrViaService(ctx: any, opts: QrLoginOptions = {}): Promise<CookieResult> {
  if (!ctx.puppeteer?.page) {
    throw new Error('未检测到可用的 Puppeteer 服务')
  }
  if (!ctx.puppeteer.browser && typeof ctx.puppeteer.start === 'function') {
    await ctx.puppeteer.start()
  }
  const page = await ctx.puppeteer.page()
  try {
    await opts.onPageCreated?.(page)
    await gotoAndWait(page, WEIBO_PASSPORT_URL, opts.timeoutMs || 120000)

    // Try to find and click QR tab multiple times
    for (let i = 0; i < 3; i++) {
      // 检查是否被重定向到了个人中心或首页 (说明已经登录了)
      const currentUrl = page.url()
      if (currentUrl.includes('my.sina.com.cn') || currentUrl.includes('weibo.com/u/')) {
        const cookies = await page.cookies()
        if (cookies.some((c: any) => c.name === 'SUB')) {
          return {
            cookieString: buildCookieString(cookies),
            cookies,
            qrDetected: true, // 伪装成已检测到，跳过报错
          }
        }
      }

      await clickQrTabIfNeeded(page)
      await wait(1000)
      const qrResult = await captureQrFromPage(page, 5000)
      if (qrResult.detected) break
    }

    // Wait a bit more for the page to load
    await wait(2000)

    // 检查是否已经存在 SUB 并且被重定向
    const currentUrl = page.url()
    if (currentUrl.includes('my.sina.com.cn') || currentUrl.includes('weibo.com/u/') || await isLoggedIn(page)) {
      const cookies = await page.cookies()
      return {
        cookieString: buildCookieString(cookies),
        cookies,
        qrImageDataUrl: undefined,
        qrDetected: true,
      }
    }

    const qrResult = await captureQrFromPage(page, 15000)
    if (!qrResult.detected) {
      // Take a screenshot for debugging
      const screenshot = await page.screenshot({ encoding: 'base64' })
      const screenshotDataUrl = `data:image/png;base64,${String(screenshot)}`
      console.error('QR code detection failed. Page screenshot:', screenshotDataUrl.substring(0, 100) + '...')

      // Try to get page content for debugging
      const pageContent = await page.content()
      console.error('Page content preview:', pageContent.substring(0, 500) + '...')

      throw new Error('未识别到微博二维码，请确认当前页面已进入扫码登录态。可能是微博登录页面结构已更新。')
    }

    await opts.onQrCaptured?.(qrResult.dataUrl)
    const start = Date.now()
    const limit = opts.timeoutMs || 120000
    while (Date.now() - start < limit) {
      if (await isLoggedIn(page)) break
      await wait(2000)
    }
    if (!(await isLoggedIn(page))) {
      throw new Error('扫码登录超时')
    }
    const cookies = await page.cookies()
    const cookieString = buildCookieString(cookies)
    return {
      cookieString,
      cookies,
      qrImageDataUrl: qrResult.dataUrl || undefined,
      qrDetected: qrResult.detected,
    }
  } finally {
    await page.close().catch(() => { })
  }
}

/**
 * 静默打开微博主页，利用已有的 Cookie 自动续期
 */
export async function renewCookiesViaService(ctx: any, existingCookies: AnyCookie[]): Promise<CookieResult> {
  if (!ctx.puppeteer?.page) {
    throw new Error('未检测到可用的 Puppeteer 服务')
  }
  if (!ctx.puppeteer.browser && typeof ctx.puppeteer.start === 'function') {
    await ctx.puppeteer.start()
  }

  const page = await ctx.puppeteer.page()
  try {
    // 注入现有的 Cookie
    if (existingCookies && existingCookies.length > 0) {
      // 过滤掉可能导致冲突的无效 cookie
      const validCookies = existingCookies.filter(c => c.name && c.value && c.domain)
      await page.setCookie(...validCookies)
    }

    // 访问微博首页，这通常会触发微博的鉴权和 Cookie 续期
    await gotoAndWait(page, 'https://weibo.com/', 60000)

    // 等待页面加载和可能的重定向完成
    await wait(3000)

    // 验证续期后是否仍然处于登录状态
    if (!(await isLoggedIn(page))) {
      throw new Error('续期失败，可能 Token 已失效，需要重新扫码登录')
    }

    // 提取续期后的最新 Cookie
    const cookies = await page.cookies()
    const cookieString = buildCookieString(cookies)

    return {
      cookieString,
      cookies,
    }
  } finally {
    await page.close().catch(() => { })
  }
}
