<template>
  <div class="deploy-view">
    <!-- Repo + Branch/Tag Selector -->
    <div class="card deploy-panel">
      <div class="panel-header">
        <h2>部署设置</h2>
      </div>
      <div class="deploy-controls">
        <div class="control-group">
          <label>仓库</label>
          <select v-model="repoIndex" class="input select" :disabled="deploying" @change="onRepoChange">
            <option v-for="(repo, i) in repos" :key="i" :value="i">{{ repo.name || '仓库 ' + (i + 1) }}</option>
          </select>
        </div>
        <div class="control-group">
          <label>分支</label>
          <div class="combo-box" ref="branchComboRef">
            <input
              v-model="branchText"
              type="text"
              class="input combo-input"
              placeholder="main"
              :disabled="!!tag || deploying"
              @focus="branchOpen = true"
              @input="filterBranches"
            />
            <button class="combo-refresh" :disabled="loadingBranches" @click="fetchBranches" title="刷新分支列表">&#x21bb;</button>
            <ul v-if="branchOpen && filteredBranches.length > 0" class="combo-dropdown">
              <li
                v-for="b in filteredBranches"
                :key="b.name"
                :class="['combo-option', { selected: branchText === b.name }]"
                @mousedown.prevent="selectBranch(b.name)"
              >
                {{ b.name }}
              </li>
            </ul>
          </div>
        </div>
        <div class="control-group">
          <label>Tag</label>
          <div class="combo-box" ref="tagComboRef">
            <input
              v-model="tag"
              type="text"
              class="input combo-input"
              placeholder="例如: v1.0.0"
              :disabled="deploying"
              @focus="tagOpen = true"
              @input="filterTags"
            />
            <button class="combo-refresh" :disabled="loadingTags" @click="fetchTags" title="刷新标签列表">&#x21bb;</button>
            <ul v-if="tagOpen && filteredTags.length > 0" class="combo-dropdown">
              <li
                v-for="t in filteredTags"
                :key="t.name"
                :class="['combo-option', { selected: tag === t.name }]"
                @mousedown.prevent="selectTag(t.name)"
              >
                {{ t.name }}
              </li>
            </ul>
          </div>
        </div>
        <button
          class="btn btn-outline-primary deploy-btn"
          :disabled="deploying"
          @click="startSimulate"
        >
          <span v-if="!deploying">模拟部署</span>
          <span v-else class="spinner"></span>
          <span v-if="deploying && simulating">模拟中...</span>
        </button>
        <button
          class="btn btn-primary deploy-btn"
          :disabled="deploying"
          @click="startDeploy"
        >
          <span v-if="!deploying">开始部署</span>
          <span v-else class="spinner"></span>
          <span v-if="deploying && !simulating">部署中...</span>
        </button>
      </div>
    </div>

    <div class="card progress-panel">
      <div class="panel-header">
        <h2>部署进度</h2>
      </div>
      <div class="steps">
        <div
          v-for="(step, i) in steps"
          :key="i"
          :class="['step', step.status]"
        >
          <div class="step-indicator">
            <span v-if="step.status === 'done'" class="step-check">&#x2713;</span>
            <span v-else-if="step.status === 'running'" class="step-spin"></span>
            <span v-else-if="step.status === 'error'" class="step-cross">&#x2717;</span>
            <span v-else class="step-num">{{ i + 1 }}</span>
          </div>
          <div class="step-info">
            <span class="step-name">{{ step.label }}</span>
            <span class="step-status">{{ statusText(step.status) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="card log-panel">
      <div class="panel-header">
        <h2>日志输出</h2>
        <button v-if="logs.length > 0" class="btn btn-sm" @click="logs = []">清空</button>
      </div>
      <div class="log-container" ref="logContainer">
        <div v-if="logs.length === 0" class="log-empty">点击"开始部署"开始...</div>
        <div
          v-for="(log, i) in logs"
          :key="i"
          :class="['log-line', log.type]"
        >
          <span class="log-time">{{ formatTime(log.time) }}</span>
          <span class="log-msg">{{ log.message }}</span>
        </div>
      </div>
    </div>

    <div v-if="result" :class="['result-banner', result.success ? 'success' : 'error']">
      <template v-if="result.success">
        <div class="result-icon">&#x2705;</div>
        <div class="result-text">
          <strong>部署成功!</strong>
          <span>版本: {{ result.info?.version }} | 提交: {{ result.info?.commit }}</span>
        </div>
      </template>
      <template v-else>
        <div class="result-icon">&#x274C;</div>
        <div class="result-text">
          <strong>部署失败</strong>
          <span>{{ result.info?.error }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'

const props = defineProps<{ configPath: string; visible: boolean }>()

const repos = ref<{ name: string }[]>([])
const repoIndex = ref(0)
const branchText = ref('')
const tag = ref('')
const deploying = ref(false)
const simulating = ref(false)
const logs = ref<LogEntry[]>([])
const result = ref<{ success: boolean; info: DeployResult } | null>(null)
const logContainer = ref<HTMLElement | null>(null)

const realStepNames = ['拉取代码', '构建项目', '压缩产物', '连接服务器', '备份旧文件', '上传文件', '部署前脚本', '解压部署', '部署后脚本']
const simStepNames = ['拉取代码', '构建项目', '压缩产物', '备份旧文件', '解压部署', '清理旧备份']
const stepNames = ref(realStepNames)
const steps = ref(realStepNames.map((label) => ({ label, status: 'pending' as const })))

// Branch/Tag autocomplete
interface RefItem { name: string; hash: string }
const branches = ref<RefItem[]>([])
const tags_ = ref<RefItem[]>([])
const loadingBranches = ref(false)
const loadingTags = ref(false)
const branchComboRef = ref<HTMLElement | null>(null)
const tagComboRef = ref<HTMLElement | null>(null)
const branchOpen = ref(false)
const tagOpen = ref(false)
const filteredBranches = ref<RefItem[]>([])
const filteredTags = ref<RefItem[]>([])

function formatTime(time: string) {
  return new Date(time).toLocaleTimeString('zh-CN')
}

function statusText(status: string) {
  const map: Record<string, string> = {
    pending: '等待中',
    running: '进行中...',
    done: '完成',
    error: '失败',
  }
  return map[status] || ''
}

function scrollToBottom() {
  nextTick(() => {
    if (logContainer.value) {
      logContainer.value.scrollTop = logContainer.value.scrollHeight
    }
  })
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

async function fetchBranches() {
  if (!window.api) return
  loadingBranches.value = true
  try {
    const res = await window.api.fetchBranches(props.configPath, repoIndex.value)
    if (res.success && res.data) {
      branches.value = res.data
      filteredBranches.value = res.data
    }
  } catch (_) {} finally {
    loadingBranches.value = false
  }
}

function filterBranches() {
  const q = branchText.value.toLowerCase()
  filteredBranches.value = branches.value.filter((b) => b.name.toLowerCase().includes(q))
  branchOpen.value = true
}

function selectBranch(name: string) {
  branchText.value = name
  branchOpen.value = false
}

async function fetchTags() {
  if (!window.api) return
  loadingTags.value = true
  try {
    const res = await window.api.fetchTags(props.configPath, repoIndex.value)
    if (res.success && res.data) {
      tags_.value = res.data
      filteredTags.value = res.data
    }
  } catch (_) {} finally {
    loadingTags.value = false
  }
}

function filterTags() {
  const q = tag.value.toLowerCase()
  filteredTags.value = tags_.value.filter((t) => t.name.toLowerCase().includes(q))
  tagOpen.value = true
}

function selectTag(name: string) {
  tag.value = name
  tagOpen.value = false
}

function onRepoChange() {
  branchText.value = ''
  tag.value = ''
  branches.value = []
  tags_.value = []
  filteredBranches.value = []
  filteredTags.value = []
}

async function startDeploy() {
  if (!window.api) {
    logs.value.push({ type: 'error', message: '请在 Electron 环境中运行', time: new Date().toISOString() })
    return
  }

  deploying.value = true
  simulating.value = false
  result.value = null
  logs.value = []
  stepNames.value = realStepNames
  steps.value = realStepNames.map((label) => ({ label, status: 'pending' as const }))

  const deployPromise = window.api.startDeploy(
    props.configPath,
    repoIndex.value,
    branchText.value || undefined,
    tag.value || undefined,
  )

  const eventHandler = (event: DeployEvent) => {
    if (event.type === 'log') {
      logs.value.push(event.data as LogEntry)
      scrollToBottom()
    } else if (event.type === 'progress') {
      const pdata = event.data as ProgressData
      const idx = stepNames.value.indexOf(pdata.step)
      if (idx >= 0) {
        steps.value[idx].status = pdata.status
        if (pdata.status === 'running') {
          for (let i = 0; i < idx; i++) {
            if (steps.value[i].status === 'pending') {
              steps.value[i].status = 'done'
            }
          }
        }
      }
    } else if (event.type === 'done') {
      const dinfo = event.data as { success: boolean; info: DeployResult }
      result.value = dinfo
      deploying.value = false
    }
  }

  window.api.onDeployEvent(eventHandler)

  try {
    const res = await deployPromise
    if (res.success) {
      result.value = { success: true, info: res.info }
    } else {
      result.value = { success: false, info: { error: res.error } }
    }
  } catch (err: any) {
    result.value = { success: false, info: { error: err.message } }
  } finally {
    deploying.value = false
  }

  window.api.removeDeployListener()
}

async function startSimulate() {
  if (!window.api) {
    logs.value.push({ type: 'error', message: '请在 Electron 环境中运行', time: new Date().toISOString() })
    return
  }

  deploying.value = true
  simulating.value = true
  result.value = null
  logs.value = []
  stepNames.value = simStepNames
  steps.value = simStepNames.map((label) => ({ label, status: 'pending' as const }))

  const deployPromise = window.api.simulateDeploy(
    props.configPath,
    repoIndex.value,
    branchText.value || undefined,
    tag.value || undefined,
  )

  const eventHandler = (event: DeployEvent) => {
    if (event.type === 'log') {
      logs.value.push(event.data as LogEntry)
      scrollToBottom()
    } else if (event.type === 'progress') {
      const pdata = event.data as ProgressData
      const idx = stepNames.value.indexOf(pdata.step)
      if (idx >= 0) {
        steps.value[idx].status = pdata.status
        if (pdata.status === 'running') {
          for (let i = 0; i < idx; i++) {
            if (steps.value[i].status === 'pending') {
              steps.value[i].status = 'done'
            }
          }
        }
      }
    } else if (event.type === 'done') {
      const dinfo = event.data as { success: boolean; info: DeployResult }
      result.value = dinfo
    }
  }

  window.api.onDeployEvent(eventHandler)

  try {
    const res = await deployPromise
    if (res.success) {
      result.value = { success: true, info: res.info }
    } else {
      result.value = { success: false, info: { error: res.error } }
    }
  } catch (err: any) {
    result.value = { success: false, info: { error: err.message } }
  } finally {
    deploying.value = false
    simulating.value = false
  }

  window.api.removeDeployListener()
}

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (branchComboRef.value && !branchComboRef.value.contains(target)) {
    branchOpen.value = false
  }
  if (tagComboRef.value && !tagComboRef.value.contains(target)) {
    tagOpen.value = false
  }
}

watch(() => props.visible, async (v) => {
  if (v) {
    await loadRepos()
    if (repos.value.length > 0) {
      fetchBranches()
      fetchTags()
    }
  }
})

onMounted(async () => {
  document.addEventListener('click', onDocumentClick)
  if (props.visible) {
    await loadRepos()
    if (repos.value.length > 0) {
      fetchBranches()
      fetchTags()
    }
  }
})

onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick)
  if (window.api) window.api.removeDeployListener()
})
</script>

<style scoped>
.deploy-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
}

.log-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 120px;
  overflow: hidden;
}

.deploy-panel,
.progress-panel {
  flex-shrink: 0;
}

.card {
  background: var(--card);
  border-radius: var(--radius);
  border: 1px solid var(--border);
  overflow: hidden;
}

.deploy-panel {
  overflow: visible;
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

.deploy-controls {
  display: flex;
  align-items: flex-end;
  gap: 16px;
  padding: 16px;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.control-group label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.input {
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  color: var(--text);
  background: var(--bg);
  outline: none;
  width: 200px;
}

.input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(79, 110, 247, 0.15);
}

.input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.select {
  cursor: pointer;
}

/* Combobox */
.combo-box {
  position: relative;
  display: flex;
  align-items: center;
}

.combo-input {
  width: 200px;
  padding-right: 32px;
}

.combo-refresh {
  position: absolute;
  right: 2px;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.combo-refresh:hover:not(:disabled) { color: var(--primary); }
.combo-refresh:disabled { opacity: 0.4; cursor: not-allowed; }

.combo-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: 200px;
  overflow-y: auto;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
  z-index: 100;
  list-style: none;
  padding: 4px;
  margin-top: 2px;
}

.combo-option {
  padding: 6px 10px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  border-radius: 4px;
}

.combo-option:hover { background: var(--bg); }
.combo-option.selected { background: rgba(79, 110, 247, 0.1); color: var(--primary); }

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--primary);
  color: #fff;
}

.btn-primary:hover:not(:disabled) {
  background: var(--primary-dark);
}

.btn-outline-primary {
  background: transparent;
  color: var(--primary);
  border: 1px solid var(--primary);
}

.btn-outline-primary:hover:not(:disabled) {
  background: rgba(79, 110, 247, 0.08);
}

.btn-sm {
  padding: 4px 10px;
  font-size: 12px;
  background: var(--bg);
  color: var(--text-secondary);
}

.deploy-btn {
  height: 36px;
  min-width: 140px;
  margin-left: auto;
}

.steps {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.step {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.step.running {
  background: rgba(79, 110, 247, 0.06);
}

.step-indicator {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 12px;
  flex-shrink: 0;
}

.step.pending .step-indicator {
  background: var(--bg);
  color: var(--text-secondary);
}

.step.running .step-indicator {
  background: var(--primary);
  color: #fff;
}

.step.done .step-indicator {
  background: var(--success);
  color: #fff;
}

.step.error .step-indicator {
  background: var(--error);
  color: #fff;
}

.step-info {
  display: flex;
  flex: 1;
  justify-content: space-between;
  align-items: center;
}

.step-name {
  font-size: 13px;
  font-weight: 500;
}

.step.pending .step-name { color: var(--text-secondary); }
.step.running .step-name { color: var(--primary); }
.step.done .step-name { color: var(--text); }
.step.error .step-name { color: var(--error); }

.step-status {
  font-size: 12px;
  color: var(--text-secondary);
}

.step.running .step-status { color: var(--primary); }
.step.done .step-status { color: var(--success); }
.step.error .step-status { color: var(--error); }

.step-spin {
  display: inline-block;
  width: 10px;
  height: 10px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.log-container {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px;
  background: #1a1a2e;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  user-select: text;
}

.log-empty {
  color: #6b7280;
  padding: 16px 0;
  text-align: center;
}

.log-line {
  display: flex;
  gap: 12px;
  padding: 2px 0;
  line-height: 1.6;
}

.log-line.info { color: #d1d5db; }
.log-line.success { color: #34d399; }
.log-line.error { color: #f87171; }
.log-line.warn { color: #fbbf24; }

.log-time {
  color: #6b7280;
  flex-shrink: 0;
}

.log-msg {
  word-break: break-all;
}

.result-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--radius);
  flex-shrink: 0;
}

.result-banner.success {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
}

.result-banner.error {
  background: #fef2f2;
  border: 1px solid #fecaca;
}

.result-icon {
  font-size: 24px;
}

.result-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
}
</style>
