import { Schema } from 'koishi'

export interface SubscriptionItem {
  weiboUID: string
  forward: boolean
  blockwords: string
  keywords: string
  groupID: string
  sendAll: boolean
  sub_sendText: boolean
  sub_showScreenshot: boolean
  sub_sendMedia: boolean
  sub_splitMessages: boolean
  sub_sendVideoCover: boolean
  sub_useForward: boolean
}

export interface Config {
  basic: {
    account: string
    platform: string
    waitMinutes: number
    cookieRefreshIntervalHours: number
  }
  subs: SubscriptionItem[]
}

const ConfigBody = Schema.object({
  basic: Schema.object({
    account: Schema.string().description('账号(qq号)'),
    platform: Schema.string().default('onebot').description('账号平台'),
    waitMinutes: Schema.number().default(3).min(1).description('隔多久拉取一次最新微博 (分钟)'),
    cookieRefreshIntervalHours: Schema.number().default(72).description('cookie自动刷新间隔（小时）'),
  }).description('基础设置'),
  subs: Schema.array(
    Schema.object({
      weiboUserName: Schema.string().description('昵称'),
      weiboUID: Schema.string().description('UID'),
      groupID: Schema.string().description('群号/频道号'),
      forward: Schema.boolean().default(false).description('监听转发'),
      sendAll: Schema.boolean().default(false).description('@全体'),
      sub_sendText: Schema.boolean().default(true).description('发文本'),
      sub_showScreenshot: Schema.boolean().default(true).description('发截图'),
      sub_sendMedia: Schema.boolean().default(true).description('发媒体'),
      sub_sendVideoCover: Schema.boolean().default(true).description('视频转封面'),
      sub_splitMessages: Schema.boolean().default(false).description('分条发送'),
      sub_useForward: Schema.boolean().default(false).description('合并转发'),
      blockwords: Schema.string().default('').description('屏蔽词(分号分隔)'),
      keywords: Schema.string().default('').description('关键词'),

    }),
  ).role('table').description('监听&发送配置'),
})

export const Config: Schema<Config> = ConfigBody as any
