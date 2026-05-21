<template>
  <div class="app">
    <header class="app-header">
      <div class="header-left">
        <span class="logo">&#9889;</span>
        <h1>Auto Deploy</h1>
        <span class="version">v1.0</span>
      </div>
      <div class="header-right">
        <span class="config-path" v-if="configPath">{{ configPath }}</span>
      </div>
    </header>

    <nav class="tab-bar">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        :class="['tab', { active: activeTab === tab.key }]"
        @click="activeTab = tab.key"
      >
        <span class="tab-icon">{{ tab.icon }}</span>
        {{ tab.label }}
      </button>
    </nav>

    <main class="main-content">
      <DeployView v-show="activeTab === 'deploy'" :config-path="configPath" :visible="activeTab === 'deploy'" />
      <VersionsView v-show="activeTab === 'versions'" :config-path="configPath" :visible="activeTab === 'versions'" />
      <SettingsView
        v-show="activeTab === 'settings'"
        :config-path="configPath"
        @config-loaded="onConfigLoaded"
      />
    </main>

    <footer class="status-bar">
      <span class="status-dot" :class="connectionStatus"></span>
      <span>Auto Deploy v1.0</span>
      <span class="status-right">前端自动化部署工具</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import DeployView from './components/DeployView.vue'
import VersionsView from './components/VersionsView.vue'
import SettingsView from './components/SettingsView.vue'

const activeTab = ref('deploy')
const configPath = ref('deploy.config.json')
const connectionStatus = ref('idle')

const tabs = [
  { key: 'deploy', label: '部署', icon: '🚀' },
  { key: 'versions', label: '版本管理', icon: '📦' },
  { key: 'settings', label: '设置', icon: '⚙️' },
]

function onConfigLoaded(path: string) {
  configPath.value = path
}
</script>

<style>
:root {
  --primary: #4f6ef7;
  --primary-dark: #3b54d4;
  --bg: #f0f2f5;
  --card: #ffffff;
  --text: #1a1a2e;
  --text-secondary: #6b7280;
  --success: #10b981;
  --warning: #f59e0b;
  --error: #ef4444;
  --border: #e5e7eb;
  --radius: 8px;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
  user-select: none;
}

.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.app-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  height: 48px;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo {
  font-size: 20px;
}

.header-left h1 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.version {
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg);
  padding: 2px 6px;
  border-radius: 3px;
}

.header-right {
  -webkit-app-region: no-drag;
}

.config-path {
  font-size: 12px;
  color: var(--text-secondary);
}

.tab-bar {
  display: flex;
  background: var(--card);
  border-bottom: 1px solid var(--border);
  padding: 0 16px;
}

.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 20px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.15s;
}

.tab:hover {
  color: var(--text);
}

.tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
  font-weight: 500;
}

.tab-icon {
  font-size: 16px;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  height: 28px;
  background: var(--card);
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d1d5db;
}

.status-dot.idle { background: #d1d5db; }
.status-dot.connected { background: var(--success); }
.status-dot.error { background: var(--error); }
.status-dot.running { background: var(--warning); }

.status-right {
  margin-left: auto;
}
</style>
