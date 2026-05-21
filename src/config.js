const path = require('path');
const os = require('os');
const fs = require('fs-extra');

const REPO_SCHEMA = {
  git: ['url'],
  build: ['command', 'outputDir'],
  server: ['host', 'port', 'username'],
  deploy: ['remotePath'],
};

function resolveHome(filepath) {
  if (!filepath) return filepath;
  if (filepath.startsWith('~')) {
    return path.join(os.homedir(), filepath.slice(1));
  }
  return filepath;
}

function validateRepo(repo, index) {
  const prefix = `repos[${index}]`;
  if (!repo.name || !repo.name.trim()) {
    throw new Error(`${prefix}: 缺少仓库名称 (name)`);
  }
  for (const [section, keys] of Object.entries(REPO_SCHEMA)) {
    if (!repo[section]) {
      throw new Error(`${prefix}: 缺少 "${section}" 配置`);
    }
    for (const key of keys) {
      if (repo[section][key] === undefined) {
        throw new Error(`${prefix}: 缺少 "${section}.${key}" 字段`);
      }
    }
  }
  // Server auth — only validate if at least one is provided
  const hasPassword = repo.server.password && repo.server.password.trim();
  const hasKey = repo.server.privateKey && repo.server.privateKey.trim();
  if (hasPassword || hasKey) {
    if (hasKey) {
      const keyPath = resolveHome(repo.server.privateKey);
      if (!fs.existsSync(keyPath)) {
        throw new Error(`${prefix}: SSH 私钥不存在: ${keyPath}`);
      }
    }
  }
}

function normalizeRepo(raw) {
  const hasPassword = raw.server.password && raw.server.password.trim();
  const hasKey = raw.server.privateKey && raw.server.privateKey.trim();
  return {
    name: raw.name || '未命名仓库',
    git: {
      url: raw.git.url,
      branch: raw.git.branch || 'main',
      tag: raw.git.tag || null,
      cloneDir: path.resolve(raw.git.cloneDir || './.deploy-cache'),
      username: raw.git.username || '',
      token: raw.git.token || '',
    },
    build: {
      command: raw.build.command,
      outputDir: raw.build.outputDir,
    },
    server: {
      host: raw.server.host,
      port: raw.server.port || 22,
      username: raw.server.username,
      password: hasPassword ? raw.server.password : undefined,
      privateKey: hasKey ? resolveHome(raw.server.privateKey) : undefined,
      passphrase: raw.server.passphrase || undefined,
    },
    deploy: {
      remotePath: raw.deploy.remotePath.replace(/\/+$/, ''),
      backupKeep: raw.deploy.backupKeep || 5,
      preDeployCommands: raw.deploy.preDeployCommands || [],
      postDeployCommands: raw.deploy.postDeployCommands || [],
      preDeployFiles: raw.deploy.preDeployFiles || [],
    },
  };
}

function load(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(`配置文件不存在: ${configPath}`);
  }

  const raw = fs.readJsonSync(configPath);

  // Migrate old single-repo format → new repos[] format
  if (!raw.repos) {
    const migrated = {
      repos: [
        normalizeRepo({
          name: '默认仓库',
          git: raw.git || {},
          build: raw.build || {},
          server: raw.server || {},
          deploy: raw.deploy || {},
        }),
      ],
    };
    // Validate migrated
    for (let i = 0; i < migrated.repos.length; i++) {
      validateRepo(migrated.repos[i], i);
    }
    // Auto-write back
    fs.writeJsonSync(configPath, migrated, { spaces: 2 });
    return migrated;
  }

  if (!Array.isArray(raw.repos) || raw.repos.length === 0) {
    throw new Error('配置文件中 "repos" 必须是非空数组');
  }

  const repos = raw.repos.map(normalizeRepo);
  for (let i = 0; i < repos.length; i++) {
    validateRepo(repos[i], i);
  }

  return { repos };
}

/** Extract a single repo's config for use by deploy/git/ssh modules */
function getRepo(config, index) {
  if (!config.repos || index >= config.repos.length) {
    throw new Error(`仓库索引 ${index} 不存在`);
  }
  const repo = config.repos[index];
  return {
    git: { ...repo.git },
    build: { ...repo.build },
    server: { ...repo.server },
    deploy: { ...repo.deploy },
  };
}

module.exports = { load, getRepo };
