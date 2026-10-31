# 生产部署说明

## 当前线上实例

- 地址：`https://www.yijianbaowen.cn/vip/`
- 管理后台：`https://www.yijianbaowen.cn/vip/admin/`
- 应用目录：`/opt/fushi-ai-vip`
- systemd 服务：`fushi-ai-vip`
- 内部端口：`127.0.0.1:4176`
- Nginx 子路径：`/vip/`
- 运行数据：`/opt/fushi-ai-vip/data`、`/opt/fushi-ai-vip/storage`

## 1. 运行环境

- Linux / Windows 均可
- Node.js 22.5 或更高版本，推荐 Node.js 24 LTS 环境
- 一个可用的域名
- 生产环境必须启用 HTTPS
- 建议使用 Nginx 或同类反向代理

## 2. 准备应用

```bash
npm ci --omit=dev
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```ini
PORT=18930
NODE_ENV=production
PUBLIC_ORIGIN=https://vip.example.com
APP_BASE_PATH=/
TRUST_PROXY=1
ADMIN_USERNAME=admin
ADMIN_PASSWORD=请替换为首次初始化强密码
ADMIN_DISPLAY_NAME=超级管理员
SESSION_HOURS=12
MAX_PROJECT_FILE_MB=200
MAX_COVER_FILE_MB=5
```

注意：

1. `ADMIN_PASSWORD` 只在数据库首次创建总管理员时生效。
2. 首次登录后应立即在后台修改密码。
3. `NODE_ENV=production` 时登录 Cookie 带 `Secure`，必须通过 HTTPS 访问。
4. 如果反向代理与 Node 不在同一台机器，或代理前方还有 CDN，请按实际可信代理层数调整 `TRUST_PROXY`。
5. 如果必须部署在子目录（例如 `/vip/`），设置 `APP_BASE_PATH=/vip/`，并在 Nginx 把 `/vip/` 去掉前缀后代理到 Node。

子目录代理示例：

```nginx
location = /vip {
    return 301 /vip/;
}

location /vip/ {
    client_max_body_size 210m;
    proxy_pass http://127.0.0.1:18930/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Prefix /vip;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1800s;
}
```

## 3. 启动

直接启动：

```bash
npm start
```

使用 PM2 常驻：

```bash
npm install -g pm2
pm2 start server/index.js --name fushi-vip --update-env
pm2 save
pm2 startup
```

首次启动会自动创建：

```text
data/app.db
data/.jwt-secret
storage/files/
storage/covers/
```

## 4. Nginx 反向代理

```nginx
server {
    listen 80;
    server_name vip.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name vip.example.com;

    ssl_certificate     /etc/letsencrypt/live/vip.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vip.example.com/privkey.pem;

    client_max_body_size 210m;

    location = /api/public/events {
        proxy_pass http://127.0.0.1:18930;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
    }

    location / {
        proxy_pass http://127.0.0.1:18930;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

应用已经处理以下安全头：

- Content Security Policy
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options`
- Referrer Policy
- 生产环境 HSTS

## 5. 文件与数据备份

必须备份：

```text
data/app.db
data/app.db-wal（运行中可能存在）
data/app.db-shm（运行中可能存在）
storage/
```

推荐使用 SQLite 在线备份，而不是在服务运行时直接抓取单个数据库文件：

```bash
sqlite3 data/app.db ".backup '/backup/fushi-vip-$(date +%F).db'"
tar -czf /backup/fushi-storage-$(date +%F).tar.gz storage/
```

建议每日备份，至少保留 7 个版本，并定期在独立环境验证恢复流程。

## 6. 更新应用

```bash
pm2 stop fushi-vip
npm ci --omit=dev
pm2 start fushi-vip
```

更新代码前先备份数据库和上传目录。表结构使用幂等 `CREATE TABLE IF NOT EXISTS` 初始化；后续如增加复杂字段迁移，应新增独立迁移脚本，不建议修改历史迁移文件。

## 7. 本地文件存储与对象存储扩展

当前上传文件位于：

```text
storage/files/  软件包和资料
storage/covers/ 项目封面
```

数据库只保存随机文件名和 `storage_key`，下载接口通过权限校验和一次性令牌读取文件，不直接把 `storage/files` 暴露为静态目录。

对象存储预留的扩展位置是 `server/services/storage.js`。迁移 OSS/COS/S3 时：

1. 上传完成后保存对象键到 `project_files.storage_key`。
2. 项目封面的公开 URL 直接使用对象存储 CDN 地址。
3. 把访客下载令牌校验通过后的文件流替换为短效签名 URL。
4. 保留下载记录写入和单 IP 限制逻辑。

## 8. 运维检查

```bash
curl https://vip.example.com/api/public/health
pm2 logs fushi-vip
```

健康接口应返回：

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "storage": "local"
  }
}
```

上线前检查：

- 默认管理员密码已经修改
- `.env` 已切换为生产模式
- HTTPS 证书有效
- 备案号已替换为实际信息
- 合作电话、微信与响应时间真实可用
- 示例项目与演示文件已替换为正式内容
- 数据库、上传目录已纳入备份计划
- 上传目录不允许通过 Web 服务器直接访问
- 下载规则、每日 IP 限制符合业务预期

## 9. 常见问题

### 后台一直跳回登录页

检查：

- 是否通过 HTTPS 访问
- `PUBLIC_ORIGIN` 是否与浏览器地址完全一致
- 反向代理是否正确传递 `Host` 和 `X-Forwarded-Proto`
- 服务器时间是否准确

### 下载返回 IP 不一致

反向代理需要正确传递 `X-Real-IP` 和 `X-Forwarded-For`，且 `TRUST_PROXY` 配置必须与代理层数相符。

### 上传大文件失败

同时检查 `.env` 的 `MAX_PROJECT_FILE_MB` 和 Nginx 的 `client_max_body_size`。

### 端口被占用

修改 `.env` 的 `PORT` 后重启应用，并同步修改 Nginx `proxy_pass` 端口。
