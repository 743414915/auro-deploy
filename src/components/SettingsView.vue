<template>
  <div class="settings-layout">
    <!-- Left: Settings Form -->
    <div class="settings-left">
      <div class="card">
        <div class="panel-header">
          <h2>部署配置</h2>
          <div class="header-actions">
            <button class="btn btn-secondary" @click="selectFile">选择文件</button>
            <button class="btn btn-primary" @click="saveConfig">保存</button>
          </div>
        </div>
        <div class="config-path-row">
          <span class="config-path-hint" :title="configFilePath">{{ configFilePath }}</span>
        </div>

        <div v-if="configError" class="config-error">
          <p>{{ configError }}</p>
          <button class="btn btn-create" @click="createDefaultConfig">创建默认配置文件</button>
        </div>

        <div class="form" v-show="!configError">
          <!-- Repo Tab Bar -->
          <div class="repo-tabs">
            <div class="repo-tabs-scroll">
              <button
                v-for="(repo, i) in form.repos"
                :key="i"
                :class="['repo-tab', { active: activeRepoIndex === i }]"
                @click="activeRepoIndex = i"
              >
                <span class="repo-tab-name">{{ repo.name || '未命名' }}</span>
                <span
                  v-if="form.repos.length > 1"
                  class="repo-tab-del"
                  @click.stop="removeRepo(i)"
                >x</span>
              </button>
            </div>
            <button class="repo-tab-add" @click="addRepo" title="添加仓库">+</button>
          </div>

          <!-- Repo Name -->
          <div class="repo-name-row">
            <label>仓库名称</label>
            <input
              v-model="form.repos[activeRepoIndex].name"
              class="input"
              placeholder="例如: 前端项目"
            />
          </div>

          <!-- Git -->
          <fieldset>
            <legend>Git 仓库</legend>
            <div class="form-row">
              <div class="form-group flex-1">
                <label>仓库地址</label>
                <input v-model="current.git.url" class="input" placeholder="https://gitee.com/user/repo.git 或 git@gitee.com:user/repo.git" />
              </div>
              <div class="form-group">
                <label>分支</label>
                <input v-model="current.git.branch" class="input" placeholder="main" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>本地缓存目录</label>
                <input v-model="current.git.cloneDir" class="input" placeholder="./.deploy-cache" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>用户名（HTTPS 时填写）</label>
                <input v-model="current.git.username" class="input" placeholder="Gitee/GitHub 用户名" />
              </div>
              <div class="form-group flex-1">
                <label>Token（HTTPS 时填写）</label>
                <input v-model="current.git.token" class="input" type="password" placeholder="私人令牌 / Personal Access Token" />
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn-outline" :disabled="testingGit" @click="testGit">
                {{ testingGit ? '测试中...' : '测试 Git 连接' }}
              </button>
              <span v-if="gitResult" :class="['test-inline', gitResult.success ? 'success' : 'error']">
                {{ gitResult.success ? '连接成功' : '失败' }}
              </span>
            </div>
          </fieldset>

          <!-- Build -->
          <fieldset>
            <legend>构建</legend>
            <div class="form-row">
              <div class="form-group flex-1">
                <label>构建命令</label>
                <input v-model="current.build.command" class="input" placeholder="npm run build" />
              </div>
              <div class="form-group">
                <label>产物目录</label>
                <input v-model="current.build.outputDir" class="input" placeholder="dist" />
              </div>
            </div>
          </fieldset>

          <!-- Server -->
          <fieldset>
            <legend>服务器连接</legend>
            <div class="form-row">
              <div class="form-group">
                <label>主机 IP</label>
                <input v-model="current.server.host" class="input" placeholder="192.168.1.100" />
              </div>
              <div class="form-group sm">
                <label>端口</label>
                <input v-model.number="current.server.port" class="input" type="number" placeholder="22" />
              </div>
              <div class="form-group">
                <label>用户名</label>
                <input v-model="current.server.username" class="input" placeholder="root" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>密码（密码登录）</label>
                <input v-model="current.server.password" class="input" type="password" placeholder="服务器密码" />
              </div>
              <div class="form-group flex-1">
                <label>私钥路径（密钥登录）</label>
                <input v-model="current.server.privateKey" class="input" placeholder="~/.ssh/id_rsa" />
              </div>
            </div>
            <div class="form-actions">
              <button class="btn btn-outline" :disabled="testingSsh" @click="testSsh">
                {{ testingSsh ? '测试中...' : '测试 SSH 连接' }}
              </button>
              <span v-if="sshResult" :class="['test-inline', sshResult.success ? 'success' : 'error']">
                {{ sshResult.success ? '连接成功' : '失败' }}
              </span>
            </div>
          </fieldset>

          <!-- Deploy path -->
          <fieldset>
            <legend>部署路径</legend>
            <div class="form-row">
              <div class="form-group flex-1">
                <label>远程部署路径</label>
                <input v-model="current.deploy.remotePath" class="input" placeholder="/var/www/myapp" />
              </div>
              <div class="form-group sm">
                <label>保留版本</label>
                <input v-model.number="current.deploy.backupKeep" class="input" type="number" placeholder="5" />
              </div>
            </div>
            <div class="form-row">
              <div class="form-group flex-1">
                <label>部署前命令</label>
                <textarea v-model="preDeployText" class="textarea" rows="2"></textarea>
              </div>
              <div class="form-group flex-1">
                <label>部署后命令</label>
                <textarea v-model="postDeployText" class="textarea" rows="2" placeholder="nginx -s reload"></textarea>
              </div>
            </div>
            <div class="override-section">
              <label>部署前文件覆盖（构建后写入产物目录）</label>
              <div v-for="(f, i) in current.deploy.preDeployFiles" :key="i" class="override-row">
                <input v-model="f.path" class="input" placeholder="文件路径，如 config.js" />
                <textarea v-model="f.content" class="textarea" rows="2" placeholder="文件内容" />
                <button class="btn btn-sm btn-del" @click="current.deploy.preDeployFiles.splice(i, 1)">x</button>
              </div>
              <button class="btn btn-sm btn-secondary" @click="current.deploy.preDeployFiles.push({ path: '', content: '' })">+ 添加文件</button>
            </div>
            <div class="form-actions">
              <button class="btn btn-outline" :disabled="testingDeploy" @click="testDeploy">
                {{ testingDeploy ? '测试中...' : '测试部署路径' }}
              </button>
              <span v-if="deployResult" :class="['test-inline', deployResult.success ? 'success' : 'error']">
                {{ deployResult.success ? deployPathMsg : '失败' }}
              </span>
            </div>
          </fieldset>
        </div>
      </div>
    </div>

    <!-- Right: Log Panel -->
    <div class="settings-right">
      <div class="card log-card">
        <div class="panel-header">
          <h2>测试日志</h2>
          <button class="btn btn-sm" @click="clearLogs" v-if="logs.length">清空</button>
        </div>
        <div class="log-body" ref="logBody">
          <div v-if="logs.length === 0" class="log-empty">
            <p>点击左侧测试按钮查看连接日志</p>
          </div>
          <div v-for="(log, i) in logs" :key="i" :class="['log-item', log.type]">
            <span class="log-icon">{{ log.type === 'success' ? 'OK' : log.type === 'error' ? '!!' : '--' }}</span>
            <span class="log-msg">{{ log.message }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

/** Strip Vue reactivity so IPC structured clone doesn't fail */
function toPlainForm(f: typeof form) {
  return JSON.parse(JSON.stringify(f))
}

const props = defineProps<{ configPath: string }>()
const emit = defineEmits<{ configLoaded: [path: string] }>()

const configFilePath = ref('')
const configError = ref('')
const logBody = ref<HTMLElement | null>(null)

interface RepoForm {
  name: string
  git: { url: string; branch: string; cloneDir: string; username: string; token: string }
  build: { command: string; outputDir: string }
  server: { host: string; port: number; username: string; password: string; privateKey: string }
  deploy: { remotePath: string; backupKeep: number; preDeployCommands: string[]; postDeployCommands: string[]; preDeployFiles: { path: string; content: string }[] }
}

function defaultRepo(): RepoForm {
  return {
    name: '',
    git: { url: '', branch: 'main', cloneDir: './.deploy-cache', username: '', token: '' },
    build: { command: 'npm run build', outputDir: 'dist' },
    server: { host: '', port: 22, username: 'root', password: '', privateKey: '' },
    deploy: { remotePath: '', backupKeep: 5, preDeployCommands: [], postDeployCommands: [] as string[], preDeployFiles: [] as { path: string; content: string }[] },
  }
}

const form = reactive<{ repos: RepoForm[] }>({
  repos: [defaultRepo()],
})

const activeRepoIndex = ref(0)
const current = computed(() => form.repos[activeRepoIndex.value] || form.repos[0])

const preDeployText = ref('')
const postDeployText = ref('')

const testingGit = ref(false)
const testingSsh = ref(false)
const testingDeploy = ref(false)

const gitResult = ref<{ success: boolean; error?: string } | null>(null)
const sshResult = ref<{ success: boolean; error?: string } | null>(null)
const deployResult = ref<{ success: boolean; error?: string; data?: string } | null>(null)
const deployPathMsg = ref('')

interface LogItem { message: string; type: string }
const logs = ref<LogItem[]>([])

function addLog(message: string, type: string) {
  logs.value.push({ message, type })
  nextTick(() => {
    if (logBody.value) logBody.value.scrollTop = logBody.value.scrollHeight
  })
}

function clearLogs() { logs.value = [] }

function syncTextToArray() {
  const repo = form.repos[activeRepoIndex.value]
  if (!repo) return
  repo.deploy.preDeployCommands = preDeployText.value.split('\n').filter((l) => l.trim())
  repo.deploy.postDeployCommands = postDeployText.value.split('\n').filter((l) => l.trim())
}

function syncArrayToText() {
  const repo = form.repos[activeRepoIndex.value]
  preDeployText.value = (repo.deploy.preDeployCommands || []).join('\n')
  postDeployText.value = (repo.deploy.postDeployCommands || []).join('\n')
}

function addRepo() {
  form.repos.push(defaultRepo())
  activeRepoIndex.value = form.repos.length - 1
  syncArrayToText()
  clearTestResults()
}

function removeRepo(index: number) {
  if (form.repos.length <= 1) return
  form.repos.splice(index, 1)
  if (activeRepoIndex.value >= form.repos.length) {
    activeRepoIndex.value = form.repos.length - 1
  }
  syncArrayToText()
  clearTestResults()
}

async function getConfigPath() {
  if (window.api) {
    const res = await window.api.getConfigPath?.()
    if (res) configFilePath.value = res
  }
}

async function selectFile() {
  if (!window.api) return
  const filePath = await window.api.selectConfigFile()
  if (filePath) {
    configFilePath.value = filePath
    await loadConfig(filePath)
    emit('configLoaded', filePath)
  }
}

async function loadConfig(customPath?: string) {
  if (!window.api) return
  configError.value = ''
  const pathToUse = customPath || props.configPath
  const res = await window.api.loadConfig(pathToUse)
  if (res.success && res.data) {
    if (res.data.repos && Array.isArray(res.data.repos)) {
      form.repos = res.data.repos.map((r: any) => {
        const d = defaultRepo()
        d.name = r.name || ''
        d.git = { ...d.git, ...r.git }
        d.build = { ...d.build, ...r.build }
        d.server = { ...d.server, ...r.server }
        d.deploy = { ...d.deploy, ...r.deploy }
        return d
      })
    }
    if (form.repos.length === 0) {
      form.repos = [defaultRepo()]
    }
    activeRepoIndex.value = 0
    syncArrayToText()
    clearTestResults()
  } else {
    configError.value = res.error || '加载失败'
  }
}

function clearTestResults() {
  gitResult.value = null; sshResult.value = null; deployResult.value = null
}

async function createDefaultConfig() {
  if (!window.api) return
  const defaultCfg = {
    repos: [
      {
        name: '默认仓库',
        git: { url: 'https://gitee.com/team/project.git', branch: 'main', cloneDir: './.deploy-cache', username: '', token: '' },
        build: { command: 'npm run build', outputDir: 'dist' },
        server: { host: '192.168.1.100', port: 22, username: 'root', password: '', privateKey: '' },
        deploy: { remotePath: '/var/www/myapp', backupKeep: 5, preDeployCommands: [], postDeployCommands: ['nginx -s reload'], preDeployFiles: [] },
      },
    ],
  }
  const res = await window.api.saveConfig(props.configPath, defaultCfg)
  if (res.success) { configError.value = ''; await loadConfig() }
}

async function saveConfig() {
  if (!window.api) return
  syncTextToArray()
  await window.api.saveConfig(props.configPath, toPlainForm(form))
  clearTestResults()
  addLog('配置已保存', 'success')
}

async function testGit() {
  if (!window.api) {
    addLog('window.api 未加载，请确认 preload 脚本正常', 'error')
    return
  }
  testingGit.value = true; gitResult.value = null
  syncTextToArray()
  addLog('─────────────────────', 'info')
  addLog('保存配置...', 'info')
  try {
    const saveRes = await window.api.saveConfig(props.configPath, toPlainForm(form))
    if (!saveRes.success) {
      addLog(`保存配置失败: ${saveRes.error}`, 'error')
      gitResult.value = { success: false, error: saveRes.error }
      testingGit.value = false
      return
    }
  } catch (saveErr: any) {
    addLog(`保存配置异常: ${saveErr.message}`, 'error')
    gitResult.value = { success: false, error: saveErr.message }
    testingGit.value = false
    return
  }
  addLog('开始测试 Git 连接...', 'info')
  try {
    const res = await window.api.testGitConnection(props.configPath, activeRepoIndex.value)
    if (res.logs && res.logs.length > 0) {
      res.logs.forEach((l: any) => addLog(l.message, l.type))
    } else {
      addLog('服务器未返回日志信息', 'error')
    }
    gitResult.value = { success: res.success, error: res.error }
  } catch (ipcErr: any) {
    addLog(`IPC 调用失败: ${ipcErr.message}`, 'error')
    gitResult.value = { success: false, error: ipcErr.message }
  }
  testingGit.value = false
}

async function testSsh() {
  if (!window.api) return
  testingSsh.value = true; sshResult.value = null
  addLog('─────────────────────', 'info')
  syncTextToArray()
  await window.api.saveConfig(props.configPath, toPlainForm(form))
  const res = await window.api.testSshConnection(props.configPath, activeRepoIndex.value)
  if (res.logs) { res.logs.forEach((l: any) => addLog(l.message, l.type)) }
  sshResult.value = { success: res.success, error: res.error }
  testingSsh.value = false
}

async function testDeploy() {
  if (!window.api) return
  testingDeploy.value = true; deployResult.value = null
  addLog('─────────────────────', 'info')
  syncTextToArray()
  await window.api.saveConfig(props.configPath, toPlainForm(form))
  const res = await window.api.testDeployPath(props.configPath, activeRepoIndex.value)
  if (res.logs) { res.logs.forEach((l: any) => addLog(l.message, l.type)) }
  deployResult.value = { success: res.success, error: res.error, data: res.data }
  deployPathMsg.value = res.data || ''
  testingDeploy.value = false
}

onMounted(() => {
  getConfigPath(); loadConfig()
})

onUnmounted(() => {})
</script>

<style scoped>
.settings-layout {
  display: flex;
  gap: 16px;
  height: calc(100vh - 160px);
}

.settings-left {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}

.settings-right {
  width: 340px;
  flex-shrink: 0;
}

.card {
  background: var(--card);
  border-radius: var(--radius);
  border: 1px solid var(--border);
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}

.panel-header h2 {
  font-size: 13px;
  font-weight: 600;
}

.header-actions { display: flex; gap: 6px; }

.config-path-row {
  padding: 6px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--bg);
}

.config-path-hint {
  font-size: 11px;
  color: var(--text-secondary);
}

.config-error { padding: 24px; text-align: center; }
.config-error p { color: var(--error); font-size: 13px; margin-bottom: 12px; }

/* Repo Tabs */
.repo-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 10px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
}

.repo-tabs-scroll {
  display: flex;
  gap: 2px;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: thin;
}

.repo-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--card);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.repo-tab:hover { border-color: var(--primary); color: var(--text); }
.repo-tab.active {
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
  background: rgba(79, 110, 247, 0.06);
}

.repo-tab-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }

.repo-tab-del {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 0 2px;
  border-radius: 2px;
}

.repo-tab-del:hover { color: var(--error); background: rgba(239, 68, 68, 0.1); }

.repo-tab-add {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border: 1px dashed var(--border);
  border-radius: 5px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 16px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.repo-tab-add:hover { border-color: var(--primary); color: var(--primary); }

/* Repo Name Row */
.repo-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.repo-name-row label {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
  white-space: nowrap;
}

.repo-name-row .input {
  flex: 1;
  max-width: 260px;
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: none;
  border-radius: 5px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--primary); color: #fff; }
.btn-primary:hover:not(:disabled) { background: var(--primary-dark); }
.btn-secondary { background: var(--bg); color: var(--text); }
.btn-secondary:hover:not(:disabled) { background: var(--border); }
.btn-outline { background: transparent; color: var(--primary); border: 1px solid var(--primary); }
.btn-outline:hover:not(:disabled) { background: rgba(79, 110, 247, 0.06); }
.btn-create { background: #dbeafe; color: #1e40af; }
.btn-create:hover { background: #bfdbfe; }
.btn-sm { padding: 3px 8px; font-size: 11px; background: var(--bg); color: var(--text-secondary); }

.form {
  padding: 12px 14px;
  max-height: calc(100vh - 290px);
  overflow-y: auto;
}

fieldset {
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 10px 14px;
  margin-bottom: 12px;
}

legend { font-size: 11px; font-weight: 600; color: var(--text-secondary); padding: 0 4px; }

.form-row { display: flex; gap: 10px; margin-bottom: 8px; }
.form-row:last-child { margin-bottom: 0; }

.form-group { display: flex; flex-direction: column; gap: 3px; }
.form-group.sm { width: 90px; }
.form-group.flex-1 { flex: 1; }
.form-group label { font-size: 11px; color: var(--text-secondary); font-weight: 500; }

.input {
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg);
  outline: none;
}

.input:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(79, 110, 247, 0.12); }

.textarea {
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 12px;
  color: var(--text);
  background: var(--bg);
  outline: none;
  resize: vertical;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
}

.textarea:focus { border-color: var(--primary); box-shadow: 0 0 0 2px rgba(79, 110, 247, 0.12); }

.form-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 2px;
}

.test-inline { font-size: 12px; }
.test-inline.success { color: var(--success); }
.test-inline.error { color: var(--error); }

/* ---- Right Log Panel ---- */
.log-card {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.log-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 12px;
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.7;
  background: #1a1a2e;
  color: #d1d5db;
  user-select: text;
}

.log-empty {
  color: #6b7280;
  font-size: 12px;
  text-align: center;
  padding: 12px 0;
}

.log-item {
  display: flex;
  gap: 8px;
  padding: 1px 0;
}

.log-item.info { color: #d1d5db; }
.log-item.success { color: #34d399; }
.log-item.error { color: #f87171; white-space: pre-wrap; word-break: break-all; }

.log-icon { flex-shrink: 0; width: 18px; text-align: center; }
.log-msg { word-break: break-all; }

.override-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.override-section > label {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 500;
}

.override-row {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.override-row .input {
  flex: 1;
  min-width: 120px;
}

.override-row .textarea {
  flex: 2;
  height: 40px;
  min-height: 32px;
}

.btn-del {
  padding: 3px 8px;
  color: var(--error) !important;
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.btn-del:hover { background: rgba(239, 68, 68, 0.1); border-radius: 4px; }
</style>
