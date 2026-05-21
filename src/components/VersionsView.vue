<template>
  <div class="versions-view">
    <div class="card">
      <div class="panel-header">
        <h2>已部署版本</h2>
        <div class="header-actions">
          <select v-model="repoIndex" class="input select" @change="loadVersions">
            <option v-for="(repo, i) in repos" :key="i" :value="i">{{ repo.name || '仓库 ' + (i + 1) }}</option>
          </select>
          <span v-if="loading" class="loading-text">加载中...</span>
          <button class="btn btn-secondary" :disabled="loading" @click="loadVersions">
            刷新
          </button>
        </div>
      </div>

      <div v-if="error" class="error-msg">
        <p class="error-title">获取版本列表失败</p>
        <p class="error-detail">{{ error }}</p>
        <p class="error-hint">请检查「设置」页面的配置文件是否正确</p>
      </div>

      <div v-if="!loading && versions.length === 0 && !error" class="empty">
        暂无部署版本，请先执行部署
      </div>

      <div v-if="versions.length > 0" class="version-table-wrapper">
        <table class="version-table">
          <thead>
            <tr>
              <th></th>
              <th>备份版本</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(v, i) in versions"
              :key="v"
              :class="{ current: isCurrent(v) }"
            >
              <td class="col-status">
                <span v-if="isCurrent(v)" class="badge badge-current">当前</span>
              </td>
              <td class="col-version">
                <span class="version-name">{{ v }}</span>
              </td>
              <td class="col-actions">
                <button
                  v-if="!isCurrent(v) && !rollingBack"
                  class="btn btn-rollback"
                  @click="confirmRollback(v)"
                >
                  回滚到此版本
                </button>
                <span v-if="isCurrent(v)" class="current-label">运行中</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-if="rollbackResult" :class="['result-banner', rollbackResult.success ? 'success' : 'error']">
      <template v-if="rollbackResult.success">
        <span>OK</span> 回滚成功
      </template>
      <template v-else>
        <span>!!</span> {{ rollbackResult.error }}
      </template>
    </div>

    <div class="card log-panel" v-if="rollbackLogs.length > 0 || rollingBack">
      <div class="panel-header">
        <h2>回滚日志</h2>
        <button class="btn btn-sm" @click="rollbackLogs = []">清空</button>
      </div>
      <div class="log-container" ref="rollbackLogContainer">
        <div v-for="(log, i) in rollbackLogs" :key="i" :class="['log-line', log.type]">
          <span class="log-time">{{ formatTime(log.time) }}</span>
          <span class="log-msg">{{ log.message }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'

const props = defineProps<{ configPath: string; visible: boolean }>()

const repos = ref<{ name: string }[]>([])
const repoIndex = ref(0)
const versions = ref<string[]>([])
const current = ref('')
const loading = ref(false)
const error = ref('')
const rollingBack = ref(false)
const rollbackResult = ref<{ success: boolean; error?: string } | null>(null)
const rollbackLogs = ref<{ type: string; message: string; time: string }[]>([])
const rollbackLogContainer = ref<HTMLElement | null>(null)

function formatTime(time: string) {
  return new Date(time).toLocaleTimeString('zh-CN')
}

function isCurrent(v: string) {
  return current.value && current.value === v
}

async function loadRepos() {
  if (!window.api) return
  try {
    const res = await window.api.loadConfig(props.configPath)
    if (res.success && res.data && res.data.repos) {
      repos.value = res.data.repos
    }
  } catch (_) {}
}

async function loadVersions() {
  if (!window.api) {
    error.value = '请在 Electron 环境中运行'
    return
  }

  loading.value = true
  error.value = ''

  try {
    const res = await window.api.listVersions(props.configPath, repoIndex.value)
    if (res.success && res.data) {
      versions.value = res.data.versions
      current.value = res.data.current
    } else {
      error.value = res.error || '获取版本列表失败'
    }
  } catch (err: any) {
    error.value = err.message
  } finally {
    loading.value = false
  }
}

async function confirmRollback(version: string) {
  rollbackResult.value = null
  rollbackLogs.value = []

  if (!window.api) return

  rollingBack.value = true

  const eventHandler = async (event: any) => {
    if (event.type === 'log') {
      rollbackLogs.value.push(event.data)
      nextTick(() => {
        if (rollbackLogContainer.value) {
          rollbackLogContainer.value.scrollTop = rollbackLogContainer.value.scrollHeight
        }
      })
    } else if (event.type === 'done') {
      if (event.data.success) {
        rollbackResult.value = { success: true }
      } else {
        rollbackResult.value = { success: false, error: event.data.error }
      }
      rollingBack.value = false
    }
  }

  window.api.onRollbackEvent(eventHandler)

  try {
    const res = await window.api.rollback(props.configPath, repoIndex.value, version)
    if (res.success) {
      // Update current version immediately from the rollback result
      current.value = version
      await loadVersions()
    } else if (!rollbackResult.value) {
      rollbackResult.value = { success: false, error: res.error }
    }
  } catch (err: any) {
    if (!rollbackResult.value) {
      rollbackResult.value = { success: false, error: err.message }
    }
  } finally {
    rollingBack.value = false
    nextTick(() => {
      window.api.removeRollbackListener()
    })
  }
}

watch(() => props.visible, async (v) => {
  if (v) {
    await loadRepos()
    loadVersions()
  }
})

onMounted(async () => {
  if (props.visible) {
    await loadRepos()
    loadVersions()
  }
})

onUnmounted(() => {
  if (window.api) window.api.removeRollbackListener()
})
</script>

<style scoped>
.versions-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.card {
  background: var(--card);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}

.panel-header h2 {
  font-size: 14px;
  font-weight: 600;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.loading-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.select {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg);
  outline: none;
  cursor: pointer;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg);
  color: var(--text);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--border);
}

.btn-rollback {
  background: #fef3c7;
  color: #92400e;
  font-size: 12px;
}

.btn-rollback:hover:not(:disabled) {
  background: #fde68a;
}

.error-msg {
  padding: 24px;
  text-align: center;
}

.error-title {
  color: var(--error);
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 8px;
}

.error-detail {
  color: var(--text-secondary);
  font-size: 13px;
  margin-bottom: 8px;
}

.error-hint {
  color: var(--text-secondary);
  font-size: 12px;
  background: var(--bg);
  display: inline-block;
  padding: 4px 10px;
  border-radius: 4px;
}

.empty {
  padding: 32px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.version-table-wrapper {
  max-height: 400px;
  overflow-y: auto;
}

.version-table {
  width: 100%;
  border-collapse: collapse;
}

.version-table th {
  text-align: left;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  border-bottom: 1px solid var(--border);
}

.version-table td {
  padding: 10px 16px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
}

tr.current {
  background: #eff6ff;
}

tr:hover {
  background: var(--bg);
}

.col-status {
  width: 60px;
}

.col-actions {
  width: 140px;
  text-align: right;
}

.version-name {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 500;
}

.badge-current {
  background: #dbeafe;
  color: #1e40af;
}

.current-label {
  font-size: 12px;
  color: #10b981;
  font-weight: 500;
}

.result-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-radius: var(--radius);
  font-size: 13px;
}

.result-banner.success {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #065f46;
}

.result-banner.error {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #991b1b;
}

.log-panel {
  display: flex;
  flex-direction: column;
}

.log-container {
  height: 200px;
  overflow-y: auto;
  padding: 8px 12px;
  background: #1a1a2e;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  user-select: text;
}

.log-line {
  display: flex;
  gap: 10px;
  padding: 2px 0;
  line-height: 1.6;
}

.log-line.info { color: #d1d5db; }
.log-line.success { color: #34d399; }
.log-line.error { color: #f87171; }

.log-time {
  color: #6b7280;
  flex-shrink: 0;
}

.log-msg {
  word-break: break-all;
}

.btn-sm {
  padding: 3px 8px;
  font-size: 11px;
  background: var(--bg);
  color: var(--text-secondary);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
</style>
