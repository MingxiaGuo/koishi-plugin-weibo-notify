# koishi-plugin-weibo-notify

微博帖子更新推送插件：监听指定微博用户的新动态并推送到群聊，支持自动获取与定期刷新 Cookie（扫码登录），基于 Koishi 的浏览器服务。

## 特性

- 监听单人或多人微博主页，匹配关键词/屏蔽词
- 支持图文、视频、转发过滤
- 集成扫码登录，首次扫码后自动保存并复用 Cookie
- 可选周期性刷新 Cookie

## 安装

在你的 Koishi 项目中：

```bash
npm i koishi-plugin-weibo-notify
npm i koishi-plugin-puppeteer
```

在 Koishi 控制台启用：

- 启用浏览器服务：koishi-plugin-puppeteer
- 启用本插件：koishi-plugin-weibo-notify

## 配置

核心字段（在 Koishi 控制台或配置文件中设置）：

- basic: 基础设置
  - account：机器人账号（如 onebot 的账号 ID）
  - platform：适配器平台名（例如 onebot）
  - waitMinutes：轮询拉取最新微博间隔（分钟）
  - cookieRefreshIntervalHours：cookie自动刷新间隔（小时）
- subs：数组，配置监听与发送目标
  - weiboUID：微博用户 UID
  - forward：是否监听转发
  - blockwords：屏蔽词，分号分隔
  - keywords：关键词，分号分隔
  - groupID：需要发送的群组
  - sendAll：是否 @全体成员
- puppeteer（可选）：扫码登录设置
  - cookieFile：Cookie 保存路径，默认 data/weibo/cookies.json

示例（片段）：

```json
{
  "basic": {
    "account": "123456",
    "platform": "onebot",
    "waitMinutes": 3,
    "cookieRefreshIntervalHours": 72
  },
  "puppeteer": {
    "cookieFile": "data/weibo/cookies.json"
  },
  "subs": [
    {
      "weiboUID": "1234567890",
      "forward": false,
      "blockwords": "",
      "keywords": "",
      "groupID": "987654321",
      "sendAll": false
    }
  ]
}
```

## 使用说明

- 首次启动且没有 Cookie 文件时，会通过浏览器服务打开微博登录页；如未自动显示二维码，将尝试点击“扫码/二维码”入口；扫码成功即保存 Cookie。
- 后续启动直接复用保存的 Cookie，并按当前配置的刷新策略自动维护。

## 依赖

- Koishi v4
- koishi-plugin-puppeteer（浏览器服务）

## 感谢

[weibo-monitor](https://github.com/moehuhu/weibo-monitor) : 微博动态更新推送插件

[weibo-post-monitor](koishi-weibo-post-monitor): 微博帖子更新推送插件(cookie设置)

## License

MIT
