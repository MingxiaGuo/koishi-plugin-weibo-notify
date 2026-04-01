import { Context, Logger } from 'koishi'
import type { Config as PluginConfig } from './services/config'
export { Config } from './services/config'
import { applyAccountService } from './services/account-server'
import { getWeiboAndSendMessageToGroup } from './services/message'

export const name = 'weibo-notify'

export const logger = new Logger(name)

export const using = ['puppeteer', 'database']
export const inject = {
  required: ['database', 'puppeteer'],
  optional: ['console', 'server'],
}

declare module 'koishi' {
  interface Tables {
    weibo_cookies: WeiboCookie
  }
}

export interface WeiboCookie {
  name: string
  value: string
  domain: string
  updatedAt: Date
}

export function apply(ctx: Context, config: PluginConfig) {
  ctx.model.extend('weibo_cookies', {
    name: 'string',
    value: 'string',
    domain: 'string',
    updatedAt: 'timestamp',
  }, {
    primary: ['name', 'domain'],
  })

  const basic = config.basic || { account: '', platform: 'onebot', waitMinutes: 3, cookieRefreshIntervalHours: 72 }
  const subs = config.subs || []
  const commonConfig = {
    account: basic.account,
    platform: basic.platform,
    waitMinutes: basic.waitMinutes,
  }

  // 账户服务（主要是 Cookie 加载）初始化
  applyAccountService(ctx, config, logger)


  const intervalMs = basic.waitMinutes > 0 ? basic.waitMinutes * 60 * 1000 : 60000
  logger.info(`[weibo-notify] 插件已启动，配置了 ${subs.length} 个订阅，轮询间隔: ${intervalMs}ms`)

  ctx.setInterval(async () => {
    for (const singleConfig of subs) {
      const params = { ...commonConfig, ...singleConfig }
      getWeiboAndSendMessageToGroup(ctx, params)
    }
  }, intervalMs)

}
