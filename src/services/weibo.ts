import axios from 'axios'
import { getCookie, setCookie, getUserAgent, setUserAgent, getRandomUserAgent, refreshCookie, extractXSRFToken } from './cookie'
import { logger } from '..'

export async function getWeibo(config: any, callback?: any, retry: boolean = false): Promise<any> {
  const { weiboUID } = config
  if (!weiboUID) { return }

  let auto_cookie = getCookie()
  let now_user_agent = getUserAgent()

  if (!auto_cookie) {
    const randomUserAgent = getRandomUserAgent()
    setUserAgent(randomUserAgent)
    now_user_agent = randomUserAgent
    auto_cookie = await refreshCookie()
    setCookie(auto_cookie)
  }

  if (!auto_cookie) {
    const errorMsg = `[getWeibo] Cookie配置为空，请检查配置。weiboUID: ${weiboUID}`
    logger.error(errorMsg)
    throw new Error(errorMsg)
  }

  const xsrfToken = extractXSRFToken(auto_cookie)

  const headers: Record<string, string> = {
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
    "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "cache-control": "no-cache",
    "cookie": auto_cookie,
    "referer": "https://www.weibo.com/u/" + weiboUID,
    "user-agent": now_user_agent || '',
  }

  // 如果存在 XSRF-TOKEN，添加到 headers
  if (xsrfToken) {
    headers["x-xsrf-token"] = xsrfToken
  }

  const url = `https://www.weibo.com/ajax/statuses/mymblog?uid=${weiboUID}`

  logger.debug(`[getWeibo] 开始抓取微博动态. weiboUID: ${weiboUID}${retry ? ' (重试)' : ''}`)

  try {
    const response = await axios.get(url, {
      headers: headers,
      responseType: 'json',
      timeout: 10000
    })

    const returnData = response.data
    logger.debug(`[getWeibo] 抓取成功. weiboUID: ${weiboUID}, 动态列表长度: ${returnData?.data?.list?.length || 0}`)
    callback?.(returnData)
    return returnData
  } catch (error: any) {
    // 如果是 axios 错误，检查响应状态码
    if (error.response) {
      const statusCode = error.response.status
      const bodyPreview = JSON.stringify(error.response.data).substring(0, 200)
      const errorMsg = `[getWeibo] HTTP状态码错误: ${statusCode}`

      logger.error(`${errorMsg}, weiboUID: ${weiboUID}, 响应预览: ${bodyPreview}`)

      // 如果是 403 错误且还没有重试过，则更新cookie后重试一次
      if (statusCode === 403 && !retry) {
        logger.warn(`[getWeibo] 检测到403错误，尝试更新Cookie后重试。weiboUID: ${weiboUID}`)
        try {
          const randomUserAgent = getRandomUserAgent()
          setUserAgent(randomUserAgent)

          const newCookie = await refreshCookie()
          setCookie(newCookie)
          logger.info(`[getWeibo] Cookie更新成功，开始重试请求。weiboUID: ${weiboUID}`)

          // 重新请求一次
          const retryResult = await getWeibo(config, callback, true)
          return retryResult
        } catch (retryError: any) {
          const retryErrorMsg = `[getWeibo] 403错误重试失败。weiboUID: ${weiboUID}`
          logger.error(`${retryErrorMsg}, 原始错误: ${errorMsg}, 重试错误: ${retryError?.message || retryError}`)
          throw {
            error: new Error(`${retryErrorMsg}: ${retryError?.message || retryError}`),
            body: error.response.data,
            statusCode,
            retryError,
            errorType: 'HTTP_403_RETRY_FAILED'
          }
        }
      } else {
        const finalErrorMsg = statusCode === 403
          ? `[getWeibo] HTTP 403错误，已重试过，无法自动重试。weiboUID: ${weiboUID}`
          : `[getWeibo] HTTP ${statusCode}错误。weiboUID: ${weiboUID}`
        logger.error(`${finalErrorMsg}, 响应预览: ${bodyPreview}`)
        throw {
          error: new Error(finalErrorMsg),
          body: error.response.data,
          statusCode,
          errorType: statusCode === 403 ? 'HTTP_403_NO_RETRY' : `HTTP_${statusCode}`
        }
      }
    }


    // 网络错误或其他错误
    const networkErrorMsg = `[getWeibo] 网络请求错误`
    logger.error(`${networkErrorMsg}, weiboUID: ${weiboUID}, 错误: ${error?.message || error}`)
    throw {
      error: new Error(`${networkErrorMsg}: ${error?.message || error}`),
      originalError: error,
      errorType: 'NETWORK_ERROR'
    }
  }
}
