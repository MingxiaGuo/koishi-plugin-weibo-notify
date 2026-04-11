export const ACCOUNT_API_PREFIX = '/weibo-notify/api'
export const ACCOUNT_LOGIN_URL = 'https://passport.weibo.com/'
export const ACCOUNT_SCHEMA_ROLE = 'weibo-login-panel'

export interface WeiboProfile {
  screenName: string | null
  avatarUrl: string | null
  uid: string | null
}

export interface LoginPanelState {
  status: 'idle' | 'pending' | 'success' | 'error'
  message: string
  lastError: string | null
  hasCookie: boolean
  cookieStatusText: string
  autoLoginEnabled: boolean
  qrImageDataUrl: string | null
  cookieFile: string
  lastQrUpdatedAt: number | null
  lastCookieRefreshAt: number | null
  loginUrl: string
  profile: WeiboProfile | null
}

export const requestAccountApi = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const requestUrl = `${ACCOUNT_API_PREFIX}${path}`
  return await new Promise<T>((resolve, reject) => {
    const xhr = new window.XMLHttpRequest()
    xhr.open(init?.method || 'GET', requestUrl, true)
    xhr.responseType = 'json'
    xhr.setRequestHeader('content-type', 'application/json')
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as T)
      } else {
        reject(new Error(typeof xhr.response === 'string' ? xhr.response : xhr.responseText || `请求失败：${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('请求失败'))
    xhr.send(typeof init?.body === 'string' ? init.body : null)
  })
}
