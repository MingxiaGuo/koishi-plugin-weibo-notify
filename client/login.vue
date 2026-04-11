<template>
  <div v-if="props.name?.includes('weibo-notify')" style="margin-bottom: 1rem;">
    <div :class="['card']" data-weibo-notify-account-panel="schema">
      <div class="subtitle">
        {{ showProfileCard ? '当前微博账号' : '登录微博' }}
      </div>

      <div v-if="showProfileCard" class="panel-hero" style="margin-bottom: 16px;">
        <div class="panel-profile">
          <img v-if="current?.profile?.avatarUrl" :src="current.profile.avatarUrl" class="panel-avatar" />
          <div v-else class="panel-fallback">
            {{ current?.profile?.screenName?.slice(0, 1) || '微' }}
          </div>
          <div class="panel-name">{{ current?.profile?.screenName || '微博用户' }}</div>
          <div class="panel-uid">UID：{{ current?.profile?.uid || '暂无' }}</div>
        </div>
        <div class="panel-status">
          <div class="panel-info-list">
            <div class="panel-info">
              <span class="label">Cookie 状态</span>
              <span>{{ current?.cookieStatusText || '未加载' }}</span>
            </div>
            <div class="panel-info">
              <span class="label">Cookie 更新时间</span>
              <span>{{ formatTime(current?.lastCookieRefreshAt) }}</span>
            </div>
            <div v-if="current?.lastError" class="panel-info error">
              <span class="label">错误信息</span>
              <span>{{ current.lastError }}</span>
            </div>
            <div v-if="actionError" class="panel-info error">
              <span class="label">操作失败</span>
              <span>{{ actionError }}</span>
            </div>
            <div v-if="runtimeError" class="panel-info error">
              <span class="label">运行时错误</span>
              <span>{{ runtimeError }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="shouldShowQrBox" class="panel-hero">
        <div class="panel-profile">
          <div class="panel-fallback">
            扫
          </div>
          <div class="panel-name">扫码登录</div>
        </div>
        <div class="panel-status">
          <div class="qr-box">
            <img v-if="current?.qrImageDataUrl" :src="current.qrImageDataUrl" class="qr-image" />
            <div v-else class="placeholder">
              <template v-if="waitingForQr">
                正在从微博登录页提取二维码，请稍候…
              </template>
              <template v-else>
                当前还没有可用二维码。<br />
                稍后会自动拉取。<br />
                登录页地址：{{ current?.loginUrl || 'https://passport.weibo.com/' }}
              </template>
            </div>
          </div>
        </div>
      </div>

      <div class="button-row">
        <button
          :class="['button', { 'button-disabled': pending }]"
          :disabled="pending"
          @click="startLogin(true)"
        >
          {{ pending ? '请求中…' : '刷新二维码' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

const props = defineProps<{ name?: string }>()

const ACCOUNT_API_PREFIX = '/weibo-notify/api'

interface WeiboProfile {
  screenName: string | null
  avatarUrl: string | null
  uid: string | null
}

interface LoginPanelState {
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

const requestAccountApi = async <T>(path: string, init?: RequestInit): Promise<T> => {
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

const state = ref<LoginPanelState | null>(null)
const pending = ref(false)
const actionError = ref('')
const runtimeError = ref('')
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

const current = computed(() => state.value)
const isLoginSuccess = computed(() => current.value?.status === 'success' && current.value?.hasCookie)
const hasProfile = computed(() => Boolean(current.value?.profile?.screenName || current.value?.profile?.avatarUrl || current.value?.profile?.uid))
const showProfileCard = computed(() => (isLoginSuccess.value || hasProfile.value) && !waitingForQr.value)
const waitingForQr = computed(() => pending.value || current.value?.status === 'pending')
const shouldShowQrBox = computed(() => !showProfileCard.value || waitingForQr.value)

</script>

<style scoped>
.card {
  background: var(--card-bg, #fff);
  border: 1px solid var(--border, #d0d7de);
  border-radius: 18px;
  padding: 18px;
  box-shadow: 0 4px 16px rgba(31, 35, 40, 0.06);
}

.embed-card {
  width: 100%;
  background: linear-gradient(135deg, #fff2f7 0%, #f4f1ff 50%, #eef4ff 100%);
}

.subtitle {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 14px;
}

.qr-box {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  border-radius: 10px;
  background: rgba(255,255,255,0.86);
  border: 1px solid var(--border, #d8dee4);
  overflow: hidden;
  padding: 12px;
}

.qr-image {
  display: block;
  width: 100%;
  max-width: 320px;
  height: auto;
}

.placeholder {
  padding: 20px;
  font-size: 14px;
  color: var(--fg2, #57606a);
  text-align: center;
  line-height: 1.9;
}

.button-row {
  display: flex;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
  flex-wrap: wrap;
}

.button {
  appearance: none;
  border: none;
  background: linear-gradient(135deg, #ff6a9b 0%, #7a5cff 100%);
  color: #fff;
  padding: 11px 18px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  box-shadow: 0 8px 18px rgba(122, 92, 255, 0.22);
}

.button-disabled {
  background: #8c959f;
  box-shadow: none;
  cursor: not-allowed;
}

.label {
  display: inline-block;
  min-width: 104px;
  font-weight: 700;
}

.panel-hero {
  display: grid;
  grid-template-columns: minmax(200px, 248px) minmax(0, 1fr);
  gap: 12px;
  min-height: 220px;
  border: 1px dashed var(--border, #d0d7de);
  border-radius: 14px;
  background: linear-gradient(135deg, #fff2f7 0%, #f4f1ff 50%, #eef4ff 100%);
  padding: 14px 16px;
}

.panel-profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2px 0;
  text-align: center;
}

.panel-status {
  display: grid;
  gap: 8px;
  align-content: center;
}

.panel-avatar {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  object-fit: cover;
  box-shadow: 0 8px 16px rgba(31, 35, 40, 0.12);
}

.panel-fallback {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 700;
  background: linear-gradient(135deg, #ff6a9b 0%, #7a5cff 100%);
  color: #fff;
  box-shadow: 0 8px 16px rgba(122, 92, 255, 0.24);
}

.panel-name {
  margin-top: 10px;
  font-size: 20px;
  font-weight: 800;
  color: var(--fg1, #1f2328);
}

.panel-uid {
  margin-top: 4px;
  font-size: 13px;
  color: var(--fg2, #57606a);
}

.panel-info-list {
  display: grid;
  gap: 8px;
  width: 100%;
}

.panel-info {
  font-size: 13px;
  line-height: 1.6;
  text-align: left;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255,255,255,0.86);
  border: 1px solid var(--border, #d8dee4);
}

.error {
  color: #cf222e;
}
</style>
