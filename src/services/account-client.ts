import { SchemaBase } from '@koishijs/client'
import { defineComponent, h, onMounted, onUnmounted, ref } from 'vue'
import {
  ACCOUNT_SCHEMA_ROLE,
  requestAccountApi,
  type LoginPanelState,
} from './account'

const formatTime = (value: number | null | undefined) => {
  if (!value) return '暂无'
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return formatter.format(new Date(value))
}

const styles = {
  card: 'background: var(--card-bg, #fff); border: 1px solid var(--border, #d0d7de); border-radius: 18px; padding: 18px; box-shadow: 0 4px 16px rgba(31, 35, 40, 0.06);',
  embedCard: 'width: 100%; background: linear-gradient(135deg, #fff2f7 0%, #f4f1ff 50%, #eef4ff 100%); border: 1px solid var(--border, #d0d7de); border-radius: 16px; padding: 18px; box-shadow: 0 4px 16px rgba(31, 35, 40, 0.06);',
  subtitle: 'font-size: 17px; font-weight: 700; margin-bottom: 14px;',
  qrBox: 'display: flex; align-items: center; justify-content: center; min-height: 340px; border: 1px dashed var(--border, #d0d7de); border-radius: 16px; background: linear-gradient(135deg, #fff2f7 0%, #f4f1ff 50%, #eef4ff 100%); overflow: hidden;',
  qrImage: 'display: block; width: 100%; max-width: 320px; height: auto;',
  placeholder: 'padding: 20px; font-size: 14px; color: var(--fg2, #57606a); text-align: center; line-height: 1.9;',
  buttonRow: 'display: flex; justify-content: center; gap: 12px; margin-top: 16px; flex-wrap: wrap;',
  button: 'appearance: none; border: none; background: linear-gradient(135deg, #ff6a9b 0%, #7a5cff 100%); color: #fff; padding: 11px 18px; border-radius: 10px; cursor: pointer; font-size: 14px; font-weight: 700; box-shadow: 0 8px 18px rgba(122, 92, 255, 0.22);',
  buttonDisabled: 'background: #8c959f; box-shadow: none; cursor: not-allowed;',
  label: 'display: inline-block; min-width: 104px; font-weight: 700;',
  panelHero: 'display: grid; grid-template-columns: minmax(200px, 248px) minmax(0, 1fr); gap: 12px; min-height: 220px; border: 1px dashed var(--border, #d0d7de); border-radius: 14px; background: linear-gradient(135deg, #fff2f7 0%, #f4f1ff 50%, #eef4ff 100%); padding: 14px 16px;',
  panelProfile: 'display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2px 0; text-align: center;',
  panelStatus: 'display: grid; gap: 8px; align-content: center;',
  panelAvatar: 'width: 72px; height: 72px; border-radius: 50%; object-fit: cover; box-shadow: 0 8px 16px rgba(31, 35, 40, 0.12);',
  panelFallback: 'width: 72px; height: 72px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 26px; font-weight: 700; background: linear-gradient(135deg, #ff6a9b 0%, #7a5cff 100%); color: #fff; box-shadow: 0 8px 16px rgba(122, 92, 255, 0.24);',
  panelName: 'margin-top: 10px; font-size: 20px; font-weight: 800; color: var(--fg1, #1f2328);',
  panelUid: 'margin-top: 4px; font-size: 13px; color: var(--fg2, #57606a);',
  panelInfoList: 'display: grid; gap: 8px; width: 100%;',
  panelInfo: 'font-size: 13px; line-height: 1.6; text-align: left; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,0.86); border: 1px solid var(--border, #d8dee4);',
  error: 'color: #cf222e;',
} as const

const useAccountPanelState = () => {
  const state = ref<LoginPanelState | null>(null)
  const pending = ref(false)
  const actionError = ref('')
  const runtimeError = ref('')
  const autoStarted = ref(false)
  let timer: number | null = null
  let dispose: (() => void) | null = null

  const captureRuntimeError = (error: unknown) => {
    const value = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    runtimeError.value = value
    actionError.value = value
  }

  const refresh = async () => {
    try {
      state.value = await requestAccountApi<LoginPanelState>('/status')
    } catch (error) {
      captureRuntimeError(error)
    }
  }

  const startLogin = async (force = true) => {
    pending.value = true
    actionError.value = ''
    try {
      state.value = await requestAccountApi<LoginPanelState>(force ? '/start-login?force=1' : '/start-login', {
        method: 'POST',
        body: '{}',
      })
    } catch (error) {
      captureRuntimeError(error)
    } finally {
      pending.value = false
      await refresh()
    }
  }

  onMounted(async () => {
    const onWindowError = (event: ErrorEvent) => {
      if (event.error || event.message) {
        captureRuntimeError(event.error || event.message)
      }
    }
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      captureRuntimeError(event.reason)
    }
    window.addEventListener('error', onWindowError)
    window.addEventListener('unhandledrejection', onUnhandledRejection)
    dispose = () => {
      window.removeEventListener('error', onWindowError)
      window.removeEventListener('unhandledrejection', onUnhandledRejection)
    }
    await refresh()
    timer = window.setInterval(() => {
      void refresh()
    }, 800)
  })

  onUnmounted(() => {
    if (timer) window.clearInterval(timer)
    dispose?.()
    dispose = null
  })

  return {
    state,
    pending,
    actionError,
    runtimeError,
    startLogin,
  }
}

const AccountPanelCard = defineComponent({
  name: 'WeiboAccountPanelCard',
  props: {
    embedded: Boolean,
  },
  setup(props) {
    const { state, pending, actionError, runtimeError, startLogin } = useAccountPanelState()

    return () => {
      const current = state.value
      // 修改判定条件：只要状态是 success 且有 Cookie，就认为是登录成功的账号展示界面
      const isLoginSuccess = current?.status === 'success' && current?.hasCookie
      const hasProfile = Boolean(current?.profile?.screenName || current?.profile?.avatarUrl || current?.profile?.uid)
      const showProfileCard = isLoginSuccess || hasProfile
      
      // 注意：后端的 status 在成功后会变成 success，pending.value 在前端请求完毕后也会变成 false
      // 这里确保登录成功后 waitingForQr 为 false
      const waitingForQr = pending.value || current?.status === 'pending'

      // 核心修改：明确在什么情况下需要展示底部的二维码容器
      // 1. 如果没有登录（没有 profile 且没显示成功），那肯定要展示
      // 2. 如果正在登录流程中（pending/waitingForQr），也要展示
      const shouldShowQrBox = !showProfileCard || waitingForQr

      return h('div', {
        style: props.embedded ? styles.embedCard : styles.card,
        'data-weibo-notify-account-panel': 'schema',
      }, [
        h('div', { style: styles.subtitle }, showProfileCard ? '当前微博账号' : '登录微博'),
        showProfileCard ? h('div', { style: styles.panelHero, 'style.marginBottom': '16px' }, [
          h('div', { style: styles.panelProfile }, [
            current?.profile?.avatarUrl
              ? h('img', { src: current.profile.avatarUrl, style: styles.panelAvatar })
              : h('div', { style: styles.panelFallback }, current?.profile?.screenName?.slice(0, 1) || '微'),
            h('div', { style: styles.panelName }, current?.profile?.screenName || '微博用户'),
            h('div', { style: styles.panelUid }, `UID：${current?.profile?.uid || '暂无'}`),
          ]),
          h('div', { style: styles.panelStatus }, [
            h('div', { style: styles.panelInfoList }, [
              h('div', { style: styles.panelInfo }, [
                h('span', { style: styles.label }, 'Cookie 状态'),
                h('span', null, current?.cookieStatusText || '未加载'),
              ]),
              h('div', { style: styles.panelInfo }, [
                h('span', { style: styles.label }, 'Cookie 更新时间'),
                h('span', null, formatTime(current?.lastCookieRefreshAt)),
              ]),
              current?.lastError
                ? h('div', { style: `${styles.panelInfo};${styles.error}` }, [
                  h('span', { style: styles.label }, '错误信息'),
                  h('span', null, current.lastError),
                ])
                : null,
              actionError.value
                ? h('div', { style: `${styles.panelInfo};${styles.error}` }, [
                  h('span', { style: styles.label }, '操作失败'),
                  h('span', null, actionError.value),
                ])
                : null,
              runtimeError.value
                ? h('div', { style: `${styles.panelInfo};${styles.error}` }, [
                  h('span', { style: styles.label }, '运行时错误'),
                  h('span', null, runtimeError.value),
                ])
                : null,
            ]),
          ]),
        ]) : null,

        shouldShowQrBox ? h('div', { style: styles.qrBox }, current?.qrImageDataUrl
          ? h('img', { src: current.qrImageDataUrl, style: styles.qrImage })
          : h('div', { style: styles.placeholder }, waitingForQr
            ? '正在从微博登录页提取二维码，请稍候…'
            : `当前还没有可用二维码。\n稍后会自动拉取。\n登录页地址：${current?.loginUrl || 'https://passport.weibo.com/'}`)) : null,

        h('div', { style: styles.buttonRow }, [
          h('button', {
            style: pending.value ? `${styles.button} ${styles.buttonDisabled}` : styles.button,
            disabled: pending.value,
            onClick: () => startLogin(true),
          }, pending.value ? '请求中…' : '刷新二维码'),
        ]),
      ])
    }
  },
})

const AccountConfigPanel = defineComponent({
  name: 'WeiboAccountConfigPanel',
  props: {
    schema: Object,
    modelValue: Object,
    initial: Object,
    disabled: Boolean,
    prefix: String,
    extra: Object,
  },
  setup(props) {
    return () => h(SchemaBase as any, {
      schema: props.schema,
      modelValue: props.modelValue,
      initial: props.initial,
      disabled: props.disabled,
      prefix: props.prefix,
      extra: props.extra,
    }, {
      title: () => '微博扫码登录',
      desc: () => '先扫码登录微博，再继续填写下面的基础设置、扫码登录设置与监听配置。',
      control: () => null,
      collapse: () => h('div', { style: 'margin-top: 12px;' }, [
        h(AccountPanelCard, { embedded: true }),
      ]),
    })
  },
})

const hasAccountSchemaExtension = Array.from((SchemaBase as any).extensions || []).some((extension: any) => {
  return extension.role === ACCOUNT_SCHEMA_ROLE
})

if (!hasAccountSchemaExtension) {
  ; (SchemaBase as any).extensions.add({
    type: 'object',
    role: ACCOUNT_SCHEMA_ROLE,
    component: AccountConfigPanel,
    validate: (value: any) => typeof value === 'object',
    important: true,
  })
}

export default () => { }
