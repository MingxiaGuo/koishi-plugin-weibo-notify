import { Context, h } from 'koishi'
import { getWeibo } from './weibo'
import { stripHtmlTags, to } from './utils'
import { parseDateString, checkWords } from './utils'
import axios from 'axios'
import { getCookie, getUserAgent, extractXSRFToken } from './cookie'
import { logger } from ".."

export async function getWeiboAndSendMessageToGroup(ctx: Context, params: any) {
  const [err, res] = await to(getWeibo(params))
  if (err) { ctx.logger.error(err); return }
  const data = res.data || {}
  const weiboList = data.list || []

  if (weiboList.length === 0) {
    ctx.logger.debug(`[getWeiboAndSendMessageToGroup] 未获取到微博列表数据，UID: ${params.weiboUID}`)
    return
  }

  const result = await getLastPost(params, weiboList)
  if (!result) { return }

  // 走到这里说明不仅抓取到了新微博，而且通过了时间检查和关键词过滤，准备发送
  ctx.logger.info(`[weibo-notify] 抓取到新微博！UID: ${params.weiboUID}, 准备推送到群组: ${params.groupID}`)

  let message = result
  if (params.sendAll) {
    message = h.at('all') + ' ' + message
  }
  const bot = ctx.bots[`${params.platform}:${params.account}`]
  if (!bot) {
    ctx.logger.warn(`未找到机器人实例: ${params.platform}:${params.account}`)
    return
  }
  ctx.logger.debug(`检测到新微博发出，准备推送到群组 ${params.groupID}`)
  bot.sendMessage(params.groupID, message)
}

async function getLastPost(params: any, weiboList: any): Promise<string | null> {
  for (const wb_element of weiboList) {
    const result = await getMessage(params, wb_element)
    if (!result) { continue }
    if (result.islast) { return result.post }
  }
  return null
}

async function getMessage(params: any, wbPost: any): Promise<{ post: string; islast: boolean } | null> {
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
  //获取微博类型0-视频，2-图文,1-转发微博
  if (wbPost?.page_info) {
    weiboType = 0
  }
  if (wbPost?.pic_infos && wbPost?.pic_ids && wbPost.pic_ids.length > 0) {
    weiboType = 2
  }
  if (wbPost?.retweeted_status) {
    weiboType = 1
  }
  let message_text = ''
  let tempMessage = ''

  if (!checkWords(params, wbPost?.text_raw)) { return null }

  if (weiboType == 0) {
    const pageInfo = wbPost?.page_info
    if (!pageInfo) { return null }
    const objType = pageInfo?.object_type || ''
    if (objType == 'video') {
      const video = pageInfo?.media_info?.h5_url || ''
      tempMessage += (screenName + " 发布了微博:\n{temp_text}\n" + video) || ''
    }
  }
  if (weiboType == 1) {
    if (params.forward) {
      tempMessage += (screenName + " 转发了微博:\n{temp_text}" || '')
    }
  }
  if (weiboType == 2) {
    const picIds = wbPost?.pic_ids || []
    const picInfos = wbPost?.pic_infos || {}
    const firstPicUrl = picInfos?.[picIds[0]]?.large?.url || ''
    const picture = h.image(firstPicUrl)
    tempMessage += (screenName + " 发布了微博:\n{temp_text}\n" + picture) || ''
  }
  const mid = wbPost?.mid || ''
  const url = `https://m.weibo.cn/statuses/extend?id=${mid}`

  const detailMessage = await getDetailMessage(url)
  if (detailMessage) {
    message_text = detailMessage
  }
  else {
    message_text = wbPost?.text_raw
  }
  const urlMessage = `\n微博链接：https://m.weibo.cn/status/${mid}`
  if (!checkWords(params, message_text)) { return null }

  let message = tempMessage.replace('{temp_text}', message_text)
  const wbpost = message ? message + urlMessage : (screenName + " 发布了微博:\n" + (message_text ? message_text : wbPost?.text_raw) + urlMessage) || ''
  return { post: wbpost, islast: true }
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
