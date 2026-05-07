import { Context, h, sleep } from 'koishi'
import 'koishi-plugin-puppeteer'
import { getWeibo } from './weibo'
import { stripHtmlTags, to } from './utils'
import { parseDateString, checkWords } from './utils'
import axios from 'axios'
import { getCookie, getUserAgent, extractXSRFToken } from './cookie'
import { logger } from ".."
import { tmpdir } from 'os'
import { join } from 'path'
import { promises as fs } from 'fs'

async function saveToTemp(buffer: Buffer | ArrayBuffer, ext: string): Promise<string> {
  const filename = `weibo-notify-${Date.now()}-${Math.floor(Math.random() * 10000)}${ext}`
  const filepath = join(tmpdir(), filename)
  await fs.writeFile(filepath, Buffer.from(buffer as ArrayBuffer))
  return `file://${filepath}`
}

async function getWeiboVideoCover(ctx: Context, url: string): Promise<Buffer | null> {
  if (!url) return null

  try {
    if (!ctx.puppeteer) {
      logger.warn('未安装或未启用 puppeteer 插件，无法使用网页截图功能获取视频封面')
      return null
    }

    const page = await ctx.puppeteer.page()
    try {
      // 访问视频页面，并等待网络闲置（确保视频播放器和首帧加载完成）
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 })

      // 可选：如果页面有播放按钮，可以等待一下确保 UI 渲染
      await sleep(2000)

      // 尝试寻找视频播放器容器元素，如果找到就只截取该元素，否则截取全屏
      let targetElement: any = page
      const videoSelectors = ['.video-player', 'video', '.m-weibo-video', '.card-video']
      for (const sel of videoSelectors) {
        const el = await page.$(sel)
        if (el) {
          targetElement = el
          break
        }
      }


      // 微博视频 H5 页面通常主体就是一个带黑边的视频播放器
      // 对目标元素进行截图
      const screenshotBuffer = await targetElement.screenshot()

      return screenshotBuffer as Buffer
    } finally {
      await page.close()
    }
  } catch (err) {
    logger.debug('使用 Puppeteer 截取视频封面失败:', err)
    return null
  }
}

export async function getWeiboAndSendMessageToGroup(ctx: Context, params: any) {
  const [err, res] = await to(getWeibo(params))
  if (err) { logger.error(err); return }
  const data = res?.data || {}
  const weiboList = data?.list || []

  if (weiboList.length === 0) {
    logger.debug(`[getWeiboAndSendMessageToGroup] 未获取到微博列表数据，UID: ${params.weiboUID}`)
    return
  }

  const postResult = await getLastPost(ctx, params, weiboList)
  if (!postResult) { return }

  // 走到这里说明不仅抓取到了新微博，而且通过了时间检查和关键词过滤，准备发送
  logger.info(`[weibo-notify] 抓取到新微博！UID: ${params.weiboUID}, 准备推送到群组: ${params.groupID}`)

  if (params.sendAll) {
    if (postResult.textBlock) {
      postResult.textBlock.children.unshift(h.at('all'), h.text(' '))
    } else {
      postResult.textBlock = h('p', h.at('all'), h.text(' '))
    }
  }
  const bot = ctx.bots[`${params.platform}:${params.account}`]
  if (!bot) {
    logger.warn(`未找到机器人实例: ${params.platform}:${params.account}`)
    return
  }
  logger.debug(`检测到新微博发出，准备推送到群组 ${params.groupID}`)

  await sendPost(bot, params.groupID, postResult, params.sub_useForward, params.sub_splitMessages)
}

async function sendPost(bot: any, channelId: string, postResult: { textBlock?: h; mediaBlocks: h[] }, useForward: boolean, splitMessages: boolean) {
  // 如果使用合并转发，则分条发送无效，直接组合发送
  if (useForward) {
    const elements = []
    if (postResult.textBlock) elements.push(postResult.textBlock)
    elements.push(...postResult.mediaBlocks)
    if (elements.length > 0) {
      try {
        // 使用 Koishi 标准的合并转发格式，兼容多平台
        const forwardNode = h('message', { forward: true }, h('message', ...elements))
        await bot.sendMessage(channelId, forwardNode)
      } catch (e) {
        // 回退到 figure 格式
        await bot.sendMessage(channelId, h('figure', {}, elements))
      }
    }
    return
  }

  // 如果开启了分条发送
  if (splitMessages) {
    if (postResult.textBlock) {
      await bot.sendMessage(channelId, postResult.textBlock)
      await sleep(500) // 每条消息之间加一点延迟
    }
    for (const media of postResult.mediaBlocks) {
      await bot.sendMessage(channelId, media)
      await sleep(500)
    }
  } else { // 否则，提取视频单独发送，其余组合发送
    const nonVideoElements = []
    const videoElements = []

    if (postResult.textBlock) nonVideoElements.push(postResult.textBlock)

    for (const media of postResult.mediaBlocks) {
      if (media.type === 'video') {
        videoElements.push(media)
      } else {
        nonVideoElements.push(media)
      }
    }

    // 1. 先发送非视频内容（文本、截图、图片、链接）
    if (nonVideoElements.length > 0) {
      try {
        await bot.sendMessage(channelId, h('message', ...nonVideoElements))
      } catch (e) {
        logger.error(`[weibo-notify] 组合发送非视频内容失败:`, e)
        logger.info(`[weibo-notify] 尝试回退到分条发送...`)
        if (postResult.textBlock) {
          await bot.sendMessage(channelId, postResult.textBlock).catch((err: any) => logger.error(`[weibo-notify] 回退发送文本失败:`, err))
          await sleep(500)
        }
        for (const media of postResult.mediaBlocks) {
          if (media.type !== 'video') {
            await bot.sendMessage(channelId, media).catch((err: any) => logger.error(`[weibo-notify] 回退发送媒体失败:`, err))
            await sleep(500)
          }
        }
      }
    }

    // 2. 再单独发送视频
    if (videoElements.length > 0) {
      await sleep(500)
      for (const video of videoElements) {
        await bot.sendMessage(channelId, video).catch((err: any) => logger.error(`[weibo-notify] 发送视频失败:`, err))
        await sleep(500)
      }
    }
  }
}

async function getLastPost(ctx: Context, params: any, weiboList: any): Promise<{ textBlock?: h; mediaBlocks: h[] } | null> {
  for (const wb_element of weiboList) {
    const result = await getMessage(ctx, params, wb_element)
    if (!result) { continue }
    if (result.islast) { return { textBlock: result.textBlock, mediaBlocks: result.mediaBlocks } }
  }
  return null
}

async function getMessage(ctx: Context, params: any, wbPost: any): Promise<{ textBlock?: h; mediaBlocks: h[]; islast: boolean } | null> {
  if (!wbPost) { return null }
  const { created_at, user } = wbPost
  const time = parseDateString(created_at)
  const lastCheckTime = Date.now() - (params.waitMinutes > 0 ? params.waitMinutes * 60 * 1000 : 60000)

  if (time.getTime() < lastCheckTime) {
    logger.debug(`[getMessage] 微博时间(${time.toISOString()})早于上次检查时间(${new Date(lastCheckTime).toISOString()})，跳过`)
    return null
  }

  const screenName = user?.screen_name || ''
  let weiboType = -1
  // 简化分类，主要为了兼容旧的文案前缀
  // 获取微博类型0-视频，2-图文,1-转发微博
  if (wbPost?.retweeted_status) {
    weiboType = 1
  } else if (wbPost?.page_info && wbPost.page_info.object_type === 'video') {
    weiboType = 0
  } else if (wbPost?.pic_infos && wbPost?.pic_ids && wbPost.pic_ids.length > 0) {
    weiboType = 2
  }

  let message_text = ''

  if (!checkWords(params, wbPost?.text_raw)) { return null }

  const mid = wbPost?.mid || ''
  const url = `https://m.weibo.cn/statuses/extend?id=${mid}`

  const detailMessage = await getDetailMessage(url)
  if (detailMessage) {
    message_text = detailMessage
  }
  else {
    message_text = wbPost?.text_raw
  }
  const urlMessage = `\n[微博链接]：https://m.weibo.cn/status/${mid}`
  if (!checkWords(params, message_text)) { return null }

  let textPart = ''
  if (weiboType == 1) {
    if (!params.forward) return null
    textPart = screenName + " 转发了微博:\n"
  } else {
    textPart = screenName + " 发布了微博:\n"
  }

  if (params.sub_sendText !== false) {
    textPart += (message_text ? message_text : wbPost?.text_raw)
  }

  let mediaBlocks: h[] = []
  let videoLinksForEnd: string[] = []

  // 提取图片和视频（如果是转发微博，只提取自己发的媒体，不提取原博媒体）
  const targetPost = wbPost

  if (params.sub_sendMedia !== false) {
    let hasFoundVideo = false

    const pageInfo = targetPost?.page_info
    if (pageInfo) {
      const objType = pageInfo?.object_type || pageInfo?.type || ''
      if (objType === 'video' || pageInfo?.media_info) {
        hasFoundVideo = true
        // 优先使用直链 mp4，否则使用 stream_url(可能需要转码)，最后才是 h5_url(是一个网页，机器人绝对播不了)
        const videoUrl = pageInfo?.media_info?.mp4_720p_mp4 || pageInfo?.media_info?.mp4_hd_url || pageInfo?.media_info?.mp4_sd_url || pageInfo?.media_info?.stream_url_hd || pageInfo?.media_info?.stream_url || ''

        let weiboVideoPageUrl = pageInfo?.media_info?.h5_url || ''
        if (!weiboVideoPageUrl && pageInfo?.object_id) {
          const match = String(pageInfo.object_id).match(/\d+:\d+/)
          weiboVideoPageUrl = match ? `https://m.weibo.cn/s/video/show?object_id=${match[0]}` : `https://m.weibo.cn/s/video/show?object_id=${pageInfo.object_id}`
        }
        if (!weiboVideoPageUrl) weiboVideoPageUrl = videoUrl

        if (videoUrl) {
          if (params.sub_sendVideoCover) {
            let coverUrl = pageInfo?.page_pic?.url || ''
            if (!coverUrl && weiboVideoPageUrl) {
              const h5CoverBuffer = await getWeiboVideoCover(ctx, weiboVideoPageUrl)
              if (h5CoverBuffer) {
                // 直接传入 Buffer 和 mimetype
                mediaBlocks.push(h.image(h5CoverBuffer, 'image/png'))
                coverUrl = 'handled' // 标记已处理，防止下面走 axios 下载
              }
            }
            if (coverUrl && coverUrl !== 'handled') {
              try {
                const response = await axios.get(coverUrl, { headers: { 'Referer': 'https://weibo.com/' }, responseType: 'arraybuffer' })
                const localUrl = await saveToTemp(response.data, '.jpg')
                mediaBlocks.push(h.image(localUrl))
              } catch (e) {
                logger.error('下载视频封面失败:', e)
              }
            } else {
              logger.warn(`未找到视频封面，weiboUID: ${params.weiboUID}, videoUrl: ${videoUrl}`)
            }
            mediaBlocks.push(h('p', `[视频链接]: ${weiboVideoPageUrl}`))
          } else if (/\.mp4(\?|$)/i.test(videoUrl) || /f\.video\.weibocdn\.com/i.test(videoUrl) || /g\.us\.sinaimg\.cn/i.test(videoUrl)) {
            try {
              const response = await axios.get(videoUrl, { headers: { 'Referer': 'https://weibo.com/' }, responseType: 'arraybuffer' })
              const contentType = String(response.headers['content-type'] || 'video/mp4')
              mediaBlocks.push(h.video(response.data, contentType))
            } catch (e) {
              logger.error('下载视频失败:', e)
            }
            videoLinksForEnd.push(`[视频链接]: ${weiboVideoPageUrl}`)
          } else {
            // 如果不是直链视频（比如只给了 H5 网页），退回为发送文本链接提示
            videoLinksForEnd.push(`[视频链接]: ${weiboVideoPageUrl}`)
          }
        }
      }
    }

    // 处理微博的混合媒体或多图 (可能存在于 mix_media_info)
    const mixMedia = targetPost?.mix_media_info?.items || []

    if (mixMedia.length > 0) {
      for (const item of mixMedia) {
        if (item.type === 'pic' && item.data?.large?.url) {
          const pUrl = item.data.large.url
          try {
            const response = await axios.get(pUrl, { headers: { 'Referer': 'https://weibo.com/' }, responseType: 'arraybuffer' })
            mediaBlocks.push(h.image(response.data, 'image/jpeg'))
          } catch (e) {
            logger.error('下载图片失败:', e)
          }
        } else if (item.type === 'video' && item.data?.media_info) {
          hasFoundVideo = true
          const vUrl = item.data.media_info.mp4_720p_mp4 || item.data.media_info.mp4_hd_url || item.data.media_info.mp4_sd_url || item.data.media_info.stream_url_hd || item.data.media_info.stream_url || ''

          let weiboVideoPageUrl = item.data.media_info?.h5_url || ''
          if (!weiboVideoPageUrl && item.data?.object_id) {
            const match = String(item.data.object_id).match(/\d+:\d+/)
            weiboVideoPageUrl = match ? `https://m.weibo.cn/s/video/show?object_id=${match[0]}` : `https://m.weibo.cn/s/video/show?object_id=${item.data.object_id}`
          }
          if (!weiboVideoPageUrl) weiboVideoPageUrl = vUrl

          if (vUrl) {
            if (params.sub_sendVideoCover) {

              let coverUrl = item.data?.page_pic?.url || ''
              if (!coverUrl && weiboVideoPageUrl) {
                const h5CoverBuffer = await getWeiboVideoCover(ctx, weiboVideoPageUrl)
                if (h5CoverBuffer) {
                  mediaBlocks.push(h.image(h5CoverBuffer, 'image/jpeg'))
                  coverUrl = 'handled'
                }
              }
              if (coverUrl && coverUrl !== 'handled') {
                try {
                  const response = await axios.get(coverUrl, { headers: { 'Referer': 'https://weibo.com/' }, responseType: 'arraybuffer' })
                  mediaBlocks.push(h.image(response.data, 'image/jpeg'))
                } catch (e) {
                  logger.error('下载视频封面失败:', e)
                }
              } else if (coverUrl !== 'handled') {
                logger.warn(`未找到视频封面，weiboUID: ${params.weiboUID}, videoUrl: ${vUrl}`)
              }
              mediaBlocks.push(h('p', `[视频链接]: ${weiboVideoPageUrl}`))
            } else if (/\.mp4(\?|$)/i.test(vUrl) || /f\.video\.weibocdn\.com/i.test(vUrl) || /g\.us\.sinaimg\.cn/i.test(vUrl)) {
              try {
                const response = await axios.get(vUrl, { headers: { 'Referer': 'https://weibo.com/' }, responseType: 'arraybuffer' })
                mediaBlocks.push(h.video(response.data, 'video/mp4'))
              } catch (e) {
                logger.error('下载视频失败:', e)
              }
              videoLinksForEnd.push(`[视频链接]: ${weiboVideoPageUrl}`)
            } else {
              // 如果不是直链视频（比如只给了 H5 网页），退回为发送文本链接提示
              videoLinksForEnd.push(`[视频链接]: ${weiboVideoPageUrl}`)
            }
          }
        }
      }
    } else {
      // 传统多图模式
      const picIds = targetPost?.pic_ids || []
      const picInfos = targetPost?.pic_infos || {}
      for (const id of picIds) {
        const pUrl = picInfos?.[id]?.large?.url || picInfos?.[id]?.mw2000?.url || picInfos?.[id]?.original?.url
        if (pUrl) {
          try {
            const response = await axios.get(pUrl, { headers: { 'Referer': 'https://weibo.com/' }, responseType: 'arraybuffer' })
            mediaBlocks.push(h.image(response.data, 'image/jpeg'))
          } catch (e) {
            logger.error('下载图片失败:', e)
          }
        }
      }
    }

    // 如果没有找到视频，但确实有视频链接存在，也可以增加一个警告逻辑，不过当前逻辑已经尽可能覆盖了。
  }

  // 截图逻辑放在媒体提取后面，确保即使截图失败也不影响正常媒体发送
  if (params.sub_showScreenshot !== false && ctx.puppeteer) {
    try {
      const page = await ctx.puppeteer.page()

      // 设置 cookie 以避免 PC 端强制登录墙
      let auto_cookie = getCookie()
      if (auto_cookie) {
        const cookies = auto_cookie.split(';').map(c => {
          const [name, ...valueParts] = c.trim().split('=')
          return { name, value: valueParts.join('='), domain: '.weibo.com', path: '/' }
        })
        await page.setCookie(...cookies)
      }

      // 组装 PC 端微博详情页链接: https://weibo.com/uid/mblogid
      const uid = params.weiboUID || user?.id
      const bid = wbPost?.mblogid || mid
      const pcWeiboUrl = `https://weibo.com/${uid}/${bid}`

      await page.goto(pcWeiboUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      const articleSelector = 'article' // PC 端微博正文容器
      await page.waitForSelector(articleSelector, { timeout: 15000 }).catch(() => { })
      const articleHandle = await page.$(articleSelector)
      if (articleHandle) {
        const screenshotBuffer = await articleHandle.screenshot()
        // 将网页长截图放在媒体数组的最前面
        mediaBlocks.unshift(h.image(screenshotBuffer, 'image/png'))
      } else {
        logger.warn(`未能在页面找到文章元素: ${pcWeiboUrl}`)
      }
      await page.close()
    } catch (e) {
      logger.error('获取PC端微博截图失败', e)
    }
  }

  let textBlock: h | undefined
  if (textPart.trim()) {
    textBlock = h('p', textPart.trim())
  }

  // 将微博链接单独作为一个块放在媒体数组的最后，确保它在推送内容的最底部
  if (urlMessage) {
    mediaBlocks.push(h('p', urlMessage))
  }

  // 如果有分离出来的视频链接，放在微博链接的后面
  if (videoLinksForEnd.length > 0) {
    for (const vLink of videoLinksForEnd) {
      mediaBlocks.push(h('p', '\n' + vLink.trim()))
    }
  }

  return { textBlock, mediaBlocks, islast: true }
}

async function getDetailMessage(wb_url: any): Promise<string | null> {
  try {
    let auto_cookie = getCookie()
    let now_user_agent = getUserAgent()

    if (!auto_cookie) {
      return null
    }

    const xsrfToken = extractXSRFToken(auto_cookie)

    // 从 URL 中提取微博 ID，用于构建 referer
    const urlMatch = wb_url.match(/id=(\d+)/)
    const weiboId = urlMatch ? urlMatch[1] : ''

    const headers: any = {
      "accept": "application/json, text/plain, */*",
      "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
      "cache-control": "no-cache",
      "mweibo-pwa": "1",
      "pragma": "no-cache",
      "priority": "u=1, i",
      "referer": weiboId ? `https://m.weibo.cn/status/${weiboId}` : "https://m.weibo.cn/",
      "sec-ch-ua": '"Chromium";v="142", "Microsoft Edge";v="142", "Not_A Brand";v="99"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "user-agent": now_user_agent,
      "x-requested-with": "XMLHttpRequest",
      "cookie": auto_cookie,
    }

    // 如果有 XSRF-TOKEN，添加到 headers
    if (xsrfToken) {
      headers["x-xsrf-token"] = xsrfToken
    }

    const response = await axios.get(wb_url, {
      headers,
      responseType: 'json',
      timeout: 10000
    })

    const responseData = response.data

    // logger.info("responseData = " + JSON.stringify(responseData))

    // 检查响应格式
    if (!responseData || responseData.ok !== 1 || !responseData.data) {
      logger.error('获取微博response返回报错: ' + JSON.stringify(responseData))
      return null
    }

    const longTextContent = responseData.data.longTextContent

    if (!longTextContent) {
      logger.error("获取微博返回的longTextContent为空")
      return null
    }

    // logger.info("longTextContent = " + JSON.stringify(longTextContent))

    // 将 HTML 转换为文本，保留格式
    const plainText = stripHtmlTags(longTextContent)

    return plainText
  } catch (error) {
    logger.error('获取微博详情失败:', error)
    return null
  }
}
