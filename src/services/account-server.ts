import axios from 'axios'
import fs from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Context, Logger } from 'koishi'
import type { Config as PluginConfig } from './config'
import { USER_AGENT_LIST } from './constant'
import { getCookie, setCookie, setCookieUpdater, setUserAgent } from './cookie'
import { captureQrFromPage, loginWithQrViaService, renewCookiesViaService, loadCookieStringFromDatabase, loadCookiesFromDatabase, saveCookiesToDatabase } from './puppeteer-cookie'
import {
  ACCOUNT_API_PREFIX,
  ACCOUNT_LOGIN_URL,
  type LoginPanelState,
  type WeiboProfile,
} from './account'

export function applyAccountService(ctx: Context, config: PluginConfig, logger: Logger) {
  const cookieFile = 'Koishi Database (weibo_cookies)'
  let loginState: LoginPanelState['status'] = 'idle'
  let loginMessage = '等待操作'
  let lastCookieRefreshAt: number | null = null
  let lastQrUpdatedAt: number | null = null
  let lastError: string | null = null
  let loginTask: Promise<string | null> | null = null
  let loginTaskSerial = 0
  let consoleEntryRegistered = false
  let serverRoutesRegistered = false
  let currentProfile: WeiboProfile | null = null
  let currentQrImageDataUrl: string | null = null
  let activeLoginPage: any = null
  let qrCaptureTask: Promise<void> | null = null
  let qrPollingTimer: NodeJS.Timeout | null = null

  const stopQrPolling = () => {
    if (!qrPollingTimer) return
    clearInterval(qrPollingTimer)
    qrPollingTimer = null
  }

  const updateQrImage = (dataUrl: string | null | undefined) => {
    if (!dataUrl) return
    currentQrImageDataUrl = dataUrl
    lastQrUpdatedAt = Date.now()
    loginMessage = '二维码已生成，请使用微博 App 扫码登录'
  }

  const startQrPolling = (serial: number, page: any) => {
    stopQrPolling()
    qrPollingTimer = setInterval(() => {
      if (serial !== loginTaskSerial || activeLoginPage !== page || loginState !== 'pending') {
        stopQrPolling()
        return
      }
      if (qrCaptureTask) return
      qrCaptureTask = (async () => {
        try {
          const result = await captureQrFromPage(page, 1200)
          if (!result.detected) return
          updateQrImage(result.dataUrl)
        } catch {
        } finally {
          qrCaptureTask = null
        }
      })()
    }, 1500)
  }

  const readQrImageDataUrl = async () => {
    if (!currentQrImageDataUrl && loginState === 'pending' && activeLoginPage) {
      if (!qrCaptureTask) {
        qrCaptureTask = (async () => {
          try {
            const result = await captureQrFromPage(activeLoginPage, 2000)
            if (!result.detected) return
            updateQrImage(result.dataUrl)
          } catch {
          } finally {
            qrCaptureTask = null
          }
        })()
      }
      await qrCaptureTask
    }
    return currentQrImageDataUrl
  }

  const getQrUpdatedAt = async () => {
    return lastQrUpdatedAt
  }

  const getCookieUpdatedAt = async () => {
    if (lastCookieRefreshAt) return lastCookieRefreshAt
    try {
      // 尝试从数据库里拿到最新的 updatedAt
      const cookies = await ctx.database.get('weibo_cookies', {})
      if (cookies.length > 0 && cookies[0].updatedAt) {
        lastCookieRefreshAt = new Date(cookies[0].updatedAt).getTime()
      }
      return lastCookieRefreshAt
    } catch {
      return null
    }
  }

  const normalizeProfile = (user: any): WeiboProfile | null => {
    if (!user) return null
    const screenName = user.screen_name || user.screenName || null
    const rawAvatarUrl = user.avatar_hd || user.profile_image_url || user.avatar_large || user.avatar_url || null
    const avatarUrl = typeof rawAvatarUrl === 'string'
      ? (rawAvatarUrl.startsWith('//') ? `https:${rawAvatarUrl}` : rawAvatarUrl)
      : null
    const uid = user.id ? String(user.id) : (user.uid ? String(user.uid) : null)
    if (!screenName && !avatarUrl && !uid) return null
    if (uid === '1' && !screenName) return null
    return { screenName, avatarUrl, uid }
  }

  const parseProfileFromHtml = (html: string): WeiboProfile | null => {
    const pick = (...patterns: RegExp[]) => {
      for (const pattern of patterns) {
        const match = html.match(pattern)
        if (match?.[1]) {
          let value = match[1]
          // 解码Unicode转义序列
          value = value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
            return String.fromCharCode(parseInt(hex, 16))
          })
          // 处理其他转义字符
          value = value.replace(/\\n/g, '').replace(/\\r/g, '').replace(/\\t/g, '').replace(/\\/g, '')
          // 处理URL编码
          try {
            value = decodeURIComponent(value)
          } catch { }
          // 处理HTML实体
          value = value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          // 处理斜杠
          value = value.replace(/\//g, '/').replace(/\u002F/g, '/')
          // 去除多余的空格
          value = value.trim()
          return value
        }
      }
      return null
    }

    return normalizeProfile({
      screen_name: pick(
        /"screen_name":"([^"]+)"/,
        /"nick":"([^"]+)"/,
        /"name":"([^"]+)"/,
        /"uname":"([^"]+)"/,
        /<title>([^<]+?)<\/title>/,
        /<meta\s+name="description"\s+content="([^"]+)"/i,
        /<span[^>]+class="username"[^>]*>([^<]+)<\/span>/i
      ),
      avatar_hd: pick(
        /"avatar_hd":"([^"]+)"/,
        /"avatar_large":"([^"]+)"/,
        /"profile_image_url":"([^"]+)"/,
        /"avatar_url":"([^"]+)"/,
        /<meta\s+property="og:image"\s+content="([^"]+)"/i,
        /<img[^>]+src="([^"]+)"[^>]+avatar/i,
        /<img[^>]+class="[^>]*avatar[^>]*"[^>]+src="([^"]+)"/i,
        /<img[^>]+src="([^"]+)"[^>]+class="[^>]*avatar[^>]*"/i
      ),
      uid: pick(
        /"uid":"?(\d+)"?/,
        /"id":"?(\d+)"?/,
        /"user_id":"?(\d+)"?/,
        /"idstr":"?(\d+)"?/,
        /<a[^>]+href="\/u\/(\d+)"/i,
        /<a[^>]+href="\/([0-9a-zA-Z]+)"[^>]+class="[^>]*username[^>]*"/i
      ),
    })
  }

  const fetchAvatarDataUrl = async (avatarUrl: string, cookie: string | null): Promise<string> => {
    if (!avatarUrl || avatarUrl.startsWith('data:')) return avatarUrl
    try {
      const response = await axios.get<ArrayBuffer>(avatarUrl, {
        responseType: 'arraybuffer',
        headers: {
          ...(cookie ? { cookie } : {}),
          referer: 'https://weibo.com/',
          'user-agent': USER_AGENT_LIST[0],
          accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      })
      const mimeType = String(response.headers['content-type'] || 'image/jpeg').split(';')[0]
      const buffer = Buffer.from(response.data)
      return `data:${mimeType};base64,${buffer.toString('base64')}`
    } catch {
      return avatarUrl
    }
  }

  const enrichProfile = async (profile: WeiboProfile | null, cookie: string | null): Promise<WeiboProfile | null> => {
    if (!profile) return null
    if (!profile.avatarUrl) return profile
    return {
      ...profile,
      avatarUrl: await fetchAvatarDataUrl(profile.avatarUrl, cookie),
    }
  }

  const fetchWeiboProfile = async (cookie: string | null): Promise<WeiboProfile | null> => {
    if (!cookie) {
      return null
    }

    // 尝试从微博PC端获取用户信息
    try {
      const htmlResponse = await axios.get('https://weibo.com/', {
        responseType: 'text',
        headers: {
          cookie,
          referer: 'https://weibo.com/',
          'user-agent': USER_AGENT_LIST[0],
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      })
      const html = String(htmlResponse.data || '')

      // 尝试从window.$CONFIG获取用户信息
      const match = html.match(/window\.\$CONFIG\s*=\s*(\{[\s\S]*?\})\s*;/)
      if (match?.[1]) {
        try {
          const configData = JSON.parse(match[1])
          const profile = await enrichProfile(normalizeProfile(configData?.user), cookie)
          if (profile) {
            return profile
          }
        } catch (e) {
        }
      }

      // 尝试从HTML中解析用户信息
      const profile = await enrichProfile(parseProfileFromHtml(html), cookie)
      if (profile) {
        return profile
      }
    } catch (e) {
    }

    // 尝试从微博移动端获取用户信息
    try {
      const response = await axios.get('https://m.weibo.cn/api/config', {
        headers: {
          cookie,
          referer: 'https://m.weibo.cn/',
          'user-agent': USER_AGENT_LIST[0],
          accept: 'application/json, text/plain, */*',
        },
      })
      const profile = await enrichProfile(normalizeProfile(response.data?.data?.user), cookie)
      if (profile) {
        return profile
      }
    } catch (e) {
    }

    // 尝试从微博个人主页获取用户信息
    try {
      const response = await axios.get('https://weibo.com/ajax/profile/info', {
        headers: {
          cookie,
          referer: 'https://weibo.com/',
          'user-agent': USER_AGENT_LIST[0],
          accept: 'application/json, text/plain, */*',
        },
      })
      const profile = await enrichProfile(normalizeProfile(response.data?.data?.userInfo), cookie)
      if (profile) {
        return profile
      }
    } catch (e) {
    }

    // 尝试从微博API获取用户信息
    try {
      const response = await axios.get('https://api.weibo.com/2/users/show.json', {
        params: {
          uid: 'me',
        },
        headers: {
          cookie,
          referer: 'https://weibo.com/',
          'user-agent': USER_AGENT_LIST[0],
          accept: 'application/json, text/plain, */*',
        },
      })
      const profile = await enrichProfile(normalizeProfile(response.data), cookie)
      if (profile) {
        return profile
      }
    } catch (e) {
    }

    return null
  }

  const syncProfile = async (cookie: string | null) => {
    currentProfile = await fetchWeiboProfile(cookie)
  }

  const getCookieStatusText = () => {
    if (getCookie()) {
      return currentProfile ? 'Cookie 有效' : 'Cookie 已加载'
    }
    return '未加载 Cookie'
  }

  const getLoginPanelState = async (): Promise<LoginPanelState> => {
    const activeCookie = getCookie()
    if (!currentProfile && activeCookie && loginState === 'success') {
      await syncProfile(activeCookie)
    }

    // 添加 debug 打印，方便排查前端展示问题
    logger.debug(`[getLoginPanelState] loginState: ${loginState}, hasCookie: ${Boolean(activeCookie)}, currentProfile: ${currentProfile?.screenName || 'null'}`)

    return {
      status: loginState,
      message: loginMessage,
      lastError,
      hasCookie: Boolean(activeCookie),
      cookieStatusText: getCookieStatusText(),
      autoLoginEnabled: Boolean((ctx as any).puppeteer),
      qrImageDataUrl: await readQrImageDataUrl(),
      cookieFile: cookieFile,
      lastQrUpdatedAt: await getQrUpdatedAt(),
      lastCookieRefreshAt: await getCookieUpdatedAt(),
      profile: currentProfile,
      loginUrl: ACCOUNT_LOGIN_URL,
    }
  }

  const refreshCookieWithPuppeteer = async (force = false) => {
    if (force && activeLoginPage) {
      loginTaskSerial += 1
      const page = activeLoginPage
      activeLoginPage = null
      loginTask = null
      stopQrPolling()
      await page.close().catch(() => { })
    }

    if (loginTask) return loginTask

    const serial = ++loginTaskSerial
    const task = (async () => {
      if (!(ctx as any).puppeteer) {
        loginState = 'error'
        loginMessage = '未检测到 koishi-plugin-puppeteer'
        lastError = loginMessage
        logger.warn('未检测到 koishi-plugin-puppeteer，请安装并在 Koishi 中启用该插件以支持扫码登录。')
        return null
      }

      loginState = 'pending'
      loginMessage = '请使用微博 App 扫描二维码完成登录'
      lastError = null
      logger.info('开始微博扫码登录，请在浏览器中完成扫码。')
      const result = await loginWithQrViaService(ctx, {
        timeoutMs: 180000,
        onPageCreated: async (page) => {
          if (serial !== loginTaskSerial) {
            await page.close().catch(() => { })
            return
          }
          activeLoginPage = page
          startQrPolling(serial, page)
        },
        onQrCaptured: async (dataUrl) => {
          if (serial !== loginTaskSerial) return
          updateQrImage(dataUrl)
        },
      })

      if (serial !== loginTaskSerial) return null

      if (result.qrImageDataUrl) {
        updateQrImage(result.qrImageDataUrl)
      }
      await saveCookiesToDatabase(ctx, result.cookies)
      setCookie(result.cookieString)
      await syncProfile(result.cookieString)
      loginState = 'success'
      currentQrImageDataUrl = null // 扫码成功后清除二维码数据
      loginMessage = currentProfile?.screenName
        ? `扫码登录成功，欢迎 ${currentProfile.screenName}`
        : '扫码登录成功，Cookie 已更新'
      lastCookieRefreshAt = Date.now()
      logger.info(`更新cookie成功！已保存到：${cookieFile}`)
      return result.cookieString
    })()

    loginTask = task

    try {
      return await task
    } catch (error) {
      if (serial !== loginTaskSerial) return null
      loginState = 'error'
      loginMessage = '扫码登录失败'
      lastError = String(error)
      throw error
    } finally {
      if (loginTask === task) loginTask = null
      if (serial === loginTaskSerial) activeLoginPage = null
      stopQrPolling()
    }
  }

  const renewCookieSilently = async () => {
    if (!(ctx as any).puppeteer) {
      logger.warn('未检测到 koishi-plugin-puppeteer，无法自动续期 Cookie。')
      return
    }
    try {
      const existingCookies = await loadCookiesFromDatabase(ctx)
      if (!existingCookies || existingCookies.length === 0) {
        logger.warn('未找到现有的 Cookie，无法进行续期。')
        return
      }

      const result = await renewCookiesViaService(ctx, existingCookies)
      await saveCookiesToDatabase(ctx, result.cookies)
      setCookie(result.cookieString)
      await syncProfile(result.cookieString)

      lastCookieRefreshAt = Date.now()
      logger.info(`更新cookie成功！已保存到：${cookieFile}`)
    } catch (error) {
      logger.warn(`Cookie 静默续期失败: ${String(error)}`)
    }
  }

  setUserAgent(USER_AGENT_LIST[0])
  setCookieUpdater(refreshCookieWithPuppeteer)

  const registerConsoleEntry = () => {
    const consoleService = ctx.get('console') as any
    if (!consoleService || consoleEntryRegistered) return

    consoleService.addEntry({
      dev: resolve(__dirname, '../../client/index.ts'),
      prod: resolve(__dirname, '../../dist'),
    })

    consoleEntryRegistered = true
    logger.info('已注册微博登录控制台页面入口')
  }

  const registerServerRoutes = () => {
    const server = ctx.get('server') as any
    if (!server || serverRoutesRegistered) return

    server.get(`${ACCOUNT_API_PREFIX}/status`, async (koa: any) => {
      koa.body = await getLoginPanelState()
    })

    server.post(`${ACCOUNT_API_PREFIX}/start-login`, async (koa: any) => {
      const force = ['1', 'true', 'yes'].includes(String(koa.query?.force || '').toLowerCase())
      void refreshCookieWithPuppeteer(force).catch((error) => {
        logger.warn(`页面触发扫码登录失败: ${String(error)}`)
      })
      koa.body = await getLoginPanelState()
    })
    serverRoutesRegistered = true
  }

  registerConsoleEntry()
  registerServerRoutes()
  ctx.on('ready', registerConsoleEntry)
  ctx.on('ready', registerServerRoutes)
  ctx.on('internal/service', (name) => {
    if (name === 'console') registerConsoleEntry()
    if (name === 'server') registerServerRoutes()
  })

  const applyPromise = new Promise<void>((resolvePromise) => {
    ctx.on('ready', async () => {
      try {
        const loaded = await loadCookieStringFromDatabase(ctx)
        if (loaded) {
          setCookie(loaded)
          await syncProfile(loaded)
          loginState = 'success'
          loginMessage = currentProfile?.screenName
            ? `已加载 ${currentProfile.screenName} 的 Cookie`
            : '已加载本地 Cookie'
          lastCookieRefreshAt = await getCookieUpdatedAt()
          logger.info(currentProfile?.screenName ? `已加载 ${currentProfile.screenName} 的本地 Cookie` : '已加载本地 Cookie')
          resolvePromise()
        } else {
          logger.info('已开始首次 Cookie 获取流程')
          refreshCookieWithPuppeteer().catch((error) => {
            logger.warn(`初始化 Cookie 失败: ${String(error)}`)
          }).finally(() => {
            resolvePromise()
          })
        }
      } catch (error) {
        loginState = 'error'
        loginMessage = '初始化 Cookie 失败'
        lastError = String(error)
        logger.warn(`初始化 Cookie 失败: ${String(error)}`)
        resolvePromise()
      }
    })
  })

  if (config.basic.cookieRefreshIntervalHours && config.basic.cookieRefreshIntervalHours > 0) {
    ctx.setInterval(async () => {
      try {
        await renewCookieSilently()
      } catch (error) {
        logger.warn(`自动刷新 Cookie 失败: ${String(error)}`)
      }
    }, config.basic.cookieRefreshIntervalHours * 60 * 60 * 1000)
  }

  return applyPromise
}
