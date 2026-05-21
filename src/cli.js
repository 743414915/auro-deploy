#!/usr/bin/env node

const { program } = require('commander');
const path = require('path');
const chalk = require('chalk');
const { load, getRepo } = require('./config');
const { checkout } = require('./git');
const { run: runBuild } = require('./build');
const { run: runDeploy } = require('./deploy');
const { rollback, listVersions } = require('./rollback');

program
  .name('auto-deploy')
  .description('前端自动化部署工具 - Git 拉取 → 构建 → SSH 部署')
  .version('1.0.0');

program
  .command('deploy')
  .description('执行部署: 拉取代码 → 构建 → 部署到生产服务器')
  .option('-c, --config <path>', '配置文件路径', './deploy.config.json')
  .option('-r, --repo <index>', '仓库索引 (默认 0)', '0')
  .option('-b, --branch <name>', '指定分支 (覆盖配置文件)')
  .option('-t, --tag <name>', '指定 tag (覆盖配置文件)')
  .action(async (options) => {
    console.log('');
    console.log(chalk.blue.bold('╔════════════════════════════════╗'));
    console.log(chalk.blue.bold('║     🚀 Auto Deploy 开始        ║'));
    console.log(chalk.blue.bold('╚════════════════════════════════╝'));
    console.log('');

    try {
      const configPath = path.resolve(options.config);
      const repoIndex = parseInt(options.repo, 10) || 0;
      console.log(chalk.gray(`配置文件: ${configPath}`));

      const fullConfig = load(configPath);
      const config = getRepo(fullConfig, repoIndex);
      console.log(chalk.gray(`仓库 (${repoIndex}): ${config.git.url}`));

      if (options.branch) config.git.branch = options.branch;
      if (options.tag) config.git.tag = options.tag;

      console.log(chalk.gray(`目标服务器: ${config.server.host}:${config.server.port}`));
      console.log(chalk.gray(`远程路径: ${config.deploy.remotePath}`));
      console.log('');

      // Step 1: 拉取代码
      console.log(chalk.blue('▶ 拉取代码...'));
      const commitInfo = await checkout(config);

      // Step 2: 构建
      await runBuild(config);

      // Step 3: 部署
      await runDeploy(config, commitInfo);

    } catch (err) {
      console.log('');
      console.log(chalk.red.bold('✗ 部署失败'));
      console.log(chalk.red(`  ${err.message}`));
      console.log('');
      process.exit(1);
    }
  });

program
  .command('rollback')
  .description('回滚到指定版本')
  .option('-c, --config <path>', '配置文件路径', './deploy.config.json')
  .option('-r, --repo <index>', '仓库索引 (默认 0)', '0')
  .option('-v, --version <name>', '目标版本号')
  .action(async (options) => {
    console.log('');
    console.log(chalk.yellow.bold('╔════════════════════════════════╗'));
    console.log(chalk.yellow.bold('║     ↩  版本回滚                 ║'));
    console.log(chalk.yellow.bold('╚════════════════════════════════╝'));
    console.log('');

    try {
      const configPath = path.resolve(options.config);
      const repoIndex = parseInt(options.repo, 10) || 0;
      const fullConfig = load(configPath);
      const config = getRepo(fullConfig, repoIndex);
      await rollback(config, options.version);
    } catch (err) {
      console.log('');
      console.log(chalk.red.bold('✗ 回滚失败'));
      console.log(chalk.red(`  ${err.message}`));
      console.log('');
      process.exit(1);
    }
  });

program
  .command('list')
  .description('查看远程服务器上的部署版本')
  .option('-c, --config <path>', '配置文件路径', './deploy.config.json')
  .option('-r, --repo <index>', '仓库索引 (默认 0)', '0')
  .action(async (options) => {
    try {
      const configPath = path.resolve(options.config);
      const repoIndex = parseInt(options.repo, 10) || 0;
      const fullConfig = load(configPath);
      const config = getRepo(fullConfig, repoIndex);
      await listVersions(config);
    } catch (err) {
      console.log(chalk.red(`错误: ${err.message}`));
      process.exit(1);
    }
  });

program.parse();
