const { Client } = require('ssh2');
const fs = require('fs-extra');
const path = require('path');

class SSHClient {
  constructor(config) {
    this.config = config.server;
    this.client = new Client();
  }

  connect(retries = 3) {
    const doConnect = (attempt) => {
      return new Promise((resolve, reject) => {
        // Create a fresh client for each attempt
        if (attempt > 1) {
          this.client = new Client();
        }
        this.client.on('ready', () => {
          resolve();
        });
        this.client.on('error', (err) => {
          if (attempt < retries && (
            err.message.includes('Connection lost') ||
            err.message.includes('handshake') ||
            err.message.includes('Timed out') ||
            err.message.includes('connect ETIMEDOUT')
          )) {
            console.log(`  SSH 连接重试 (${attempt}/${retries})...`);
            setTimeout(() => doConnect(attempt + 1).then(resolve).catch(reject), 2000 * attempt);
          } else {
            reject(new Error(`SSH 连接失败: ${err.message}`));
          }
        });
        this.client.on('end', () => {});

        const opts = {
          host: this.config.host,
          port: this.config.port,
          username: this.config.username,
          readyTimeout: 30000,
          keepaliveInterval: 10000,
          algorithms: {
            kex: [
              'diffie-hellman-group-exchange-sha256',
              'diffie-hellman-group14-sha256',
              'diffie-hellman-group14-sha1',
              'ecdh-sha2-nistp256',
              'ecdh-sha2-nistp384',
              'ecdh-sha2-nistp521',
            ],
            cipher: [
              'aes128-ctr',
              'aes192-ctr',
              'aes256-ctr',
              'aes128-gcm@openssh.com',
              'aes256-gcm@openssh.com',
            ],
            serverHostKey: [
              'ssh-rsa',
              'rsa-sha2-512',
              'rsa-sha2-256',
              'ecdsa-sha2-nistp256',
              'ecdsa-sha2-nistp384',
              'ecdsa-sha2-nistp521',
              'ssh-ed25519',
            ],
          },
        };

        if (this.config.privateKey) {
          opts.privateKey = fs.readFileSync(this.config.privateKey);
          if (this.config.passphrase) opts.passphrase = this.config.passphrase;
        } else if (this.config.password) {
          opts.password = this.config.password;
        }

        this.client.connect(opts);
      });
    };
    return doConnect(1);
  }

  exec(command) {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
        stream.on('close', (code) => {
          if (code !== 0) reject(new Error(`命令执行失败 (exit ${code}): ${command}\n${stderr}`));
          else resolve(stdout.trim());
        });
      });
    });
  }

  uploadFile(localPath, remotePath) {
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        sftp.fastPut(localPath, remotePath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }

  disconnect() {
    this.client.end();
  }
}

module.exports = { SSHClient };
