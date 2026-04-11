import { Schema } from 'koishi'

export interface SubscriptionItem {
  weiboUID: string
  forward: boolean
  blockwords: string
  keywords: string
  groupID: string
  sendAll: boolean
  sub_showScreenshot: boolean
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
  subs: Schema.array(Schema.object({
    weiboUID: Schema.string().description('微博用户UID'),
    weiboUserName: Schema.string().description('微博用户昵称'),
    forward: Schema.boolean().default(false).description('是否监听转发'),
    blockwords: Schema.string().default('').description('屏蔽词(多个屏蔽词用分号分隔)'),
    keywords: Schema.string().default('').description('关键词(多个关键词用分号分隔)'),
    groupID: Schema.string().description('需要发送的群组'),
    sendAll: Schema.boolean().default(false).description('@全体成员'),
    sub_showScreenshot: Schema.boolean().default(true).description('是否发送微博截图'),
  })).description('监听&发送配置'),
})

export const Config: Schema<Config> = ConfigBody as any
