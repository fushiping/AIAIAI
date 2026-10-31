# REST API 说明

## 通用约定

- 基础路径：访客 `/api/public`，后台 `/api/admin`
- 请求/响应格式：`application/json`
- 文件上传：`multipart/form-data`
- 后台鉴权：登录成功后写入 HttpOnly Cookie，浏览器自动携带
- 成功响应：

```json
{
  "success": true,
  "data": {}
}
```

- 失败响应：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "面向用户的中文错误说明"
  }
}
```

后台写请求会校验 `Origin`，并依赖 `SameSite=Strict` Cookie。正式环境必须使用 HTTPS，否则 `Secure` Cookie 无法写入。

## 访客接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/public/health` | 服务健康检查 |
| `GET` | `/api/public/bootstrap` | 站点设置、分类、已上架项目与汇总指标 |
| `GET` | `/api/public/projects/:id` | 单个已上架项目详情与文件元数据 |
| `POST` | `/api/public/track` | 记录 `visit` 或 `project_view` |
| `GET` | `/api/public/events` | 站点内容更新 SSE 实时事件流 |
| `POST` | `/api/public/inquiries` | 提交合作咨询；可关联项目或下载文件 |
| `POST` | `/api/public/downloads/:fileId/prepare` | 校验留资/IP 下载规则并签发下载令牌 |
| `GET` | `/api/public/downloads/:token` | 消费一次性令牌并下载文件 |

### 埋点示例

```json
{
  "type": "project_view",
  "projectId": 1,
  "path": "/#project-1"
}
```

### 咨询提交示例

```json
{
  "name": "王先生",
  "company": "示例科技",
  "phone": "13800138000",
  "wechat": "example",
  "message": "想了解项目部署方式与合作预算。",
  "projectId": 1,
  "sourceFileId": 2,
  "privacyConsent": true
}
```

当 `sourceFileId` 有效且站点开启“下载前需留资”时，提交成功会签发一个与文件绑定的短效留资凭证，再调用 `prepare` 即可下载。

### 下载准备结果

允许下载：

```json
{
  "success": true,
  "data": {
    "allowed": true,
    "downloadUrl": "/api/public/downloads/一次性令牌",
    "expiresAt": "2026-10-31T12:45:00.000Z",
    "remaining": 19
  }
}
```

需要留资：

```json
{
  "success": true,
  "data": {
    "allowed": false,
    "reason": "lead_required",
    "file": {
      "id": 2,
      "name": "项目合作说明.pdf",
      "type": "document"
    },
    "project": {
      "id": 1,
      "name": "项目名称"
    }
  }
}
```

一次性令牌 5 分钟过期、只能成功使用一次，并要求下载设备 IP 与申请令牌时一致。

### 实时内容更新

访客端连接 `GET /api/public/events`。后台修改项目、文件、分类或站点设置后，服务端会发送：

```text
event: site-update
data: {"reason":"settings-updated","at":"2026-10-31T13:00:00.000Z"}
```

前端收到事件后立即重新获取 `/api/public/bootstrap`。反向代理必须关闭该路径的缓冲，详见部署文档。

## 登录接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/admin/auth/login` | 管理员登录 |
| `POST` | `/api/admin/auth/logout` | 退出登录 |
| `GET` | `/api/admin/auth/me` | 当前管理员与权限 |
| `POST` | `/api/admin/auth/change-password` | 修改当前账号密码 |

登录示例：

```json
{
  "username": "admin",
  "password": "当前密码"
}
```

## 数据概览与统计

以下接口需要 `analytics` 权限：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/overview?range=7\|30\|90\|all` | 汇总、趋势、项目排行、最新咨询 |
| `GET` | `/api/admin/analytics/projects?range=7\|30\|90\|all` | 单项目访问、软件下载和资料下载 |

## 项目管理

以下接口需要 `projects` 权限：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/projects` | 支持 `search`、`categoryId`、`status`、`sort` |
| `GET` | `/api/admin/project-options` | 当前已上架项目选项，供首屏精选配置使用 |
| `GET` | `/api/admin/projects/:id` | 项目及文件详情 |
| `POST` | `/api/admin/projects` | 新增项目 |
| `PATCH` | `/api/admin/projects/:id` | 编辑项目或只切换 `published` |
| `DELETE` | `/api/admin/projects/:id` | 删除项目与关联文件 |
| `POST` | `/api/admin/projects/batch` | 批量上架/下架/删除 |
| `POST` | `/api/admin/upload/cover` | 上传 JPG/PNG/WEBP 项目封面 |
| `POST` | `/api/admin/upload/widget-image` | 上传悬浮联系二维码或管理员标识，需要 `settings` 权限 |
| `POST` | `/api/admin/projects/:projectId/files` | 上传软件或资料文件 |
| `POST` | `/api/admin/projects/:projectId/links` | 新增 HTTP/HTTPS 外部跳转链接 |

项目字段示例：

```json
{
  "name": "项目名称",
  "slogan": "一句话项目价值",
  "description": "详细项目介绍，支持换行",
  "highlights": ["能力亮点一", "能力亮点二"],
  "tags": ["标签一", "标签二"],
  "categoryId": 1,
  "coverUrl": "/media/covers/文件名.png",
  "sortWeight": 100,
  "published": true
}
```

批量操作：

```json
{
  "ids": [1, 2, 3],
  "action": "publish"
}
```

`action` 可取 `publish`、`unpublish`、`delete`。

上传项目文件时使用 `multipart/form-data`：

| 字段 | 说明 |
| --- | --- |
| `file` | 文件本体 |
| `type` | `software` 软件包或 `document` 资料 |
| `displayName` | 前台展示名称，可选 |

新增项目外部链接：

```json
{
  "displayName": "项目在线演示",
  "url": "https://example.com/project-demo",
  "sortOrder": 0
}
```

链接仅允许公开的 HTTP/HTTPS 地址。访客在项目详情中点击后会在新页面打开。

## 文件编辑

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `PATCH` | `/api/admin/files/:id` | `projects` | 修改展示名称 |
| `PUT` | `/api/admin/files/:id/replace` | `projects` | 替换文件本体 |
| `DELETE` | `/api/admin/files/:id` | `projects` | 删除文件 |
| `GET` | `/api/admin/files/:id/download` | `projects` | 管理员检查文件 |
| `PATCH` | `/api/admin/links/:id` | `projects` | 修改链接名称、地址或排序 |
| `DELETE` | `/api/admin/links/:id` | `projects` | 删除外部跳转链接 |

文件扩展名白名单：PDF、DOC/DOCX、XLS/XLSX、PPT/PPTX、TXT/MD/CSV、ZIP/RAR/7Z、EXE/MSI/DMG/PKG。

## 分类管理

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/categories` | `categories` 或 `projects` | 分类列表（项目编辑也需要读取分类） |
| `POST` | `/api/admin/categories` | `categories` | 新增分类 |
| `PATCH` | `/api/admin/categories/:id` | `categories` | 编辑分类、排序或显示状态 |
| `DELETE` | `/api/admin/categories/:id` | `categories` | 删除分类，关联项目变为未分类 |

## 咨询留言

以下接口需要 `inquiries` 权限：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/inquiries` | 支持 `search`、`status`、`read` 筛选 |
| `GET` | `/api/admin/inquiries/:id` | 单条咨询详情 |
| `PATCH` | `/api/admin/inquiries/:id` | 修改处理状态、已读状态和内部备注 |
| `DELETE` | `/api/admin/inquiries/:id` | 删除咨询 |

## 站点设置

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/admin/settings` | `settings` | 全部站点设置 |
| `PATCH` | `/api/admin/settings` | `settings` | 局部更新站点设置 |
| `GET` | `/api/admin/content-schema` | `settings` | 全站公共文字的分组与字段定义 |

下载规则字段：

```json
{
  "downloadRequireLead": true,
  "downloadDailyLimit": 10
}
```

`downloadDailyLimit` 为 `0` 表示不限制。

首屏精选项目通过设置字段指定；传 `null` 表示自动选择排序第一的已上架项目：

```json
{
  "featuredProjectId": 3
}
```

悬浮联系配置字段：

```json
{
  "floatingContactEnabled": true,
  "floatingContactLabel": "联系顾问",
  "floatingContactQrUrl": "/media/covers/二维码文件名.png",
  "floatingContactAdminImageUrl": "/media/covers/管理员图片名.png",
  "floatingContactAdminName": "项目顾问",
  "floatingContactAdminTitle": "项目合作顾问"
}
```

图片上传接口使用 `multipart/form-data`，字段名为 `file`。上传完成后将返回 URL 写入对应设置字段，SSE 会立即通知当前访客页面更新。

### 全站公共文字

`settings.uiText` 保存导航、按钮、表单占位提示、项目详情弹层、下载留资弹层、操作提示和页脚等公共文字。后台“全站文字”界面根据 `/api/admin/content-schema` 动态生成。

支持局部更新，未传入的字段保持原值：

```json
{
  "uiText": {
    "nav.cta": "预约项目沟通",
    "contact.submit": "提交需求",
    "messages.downloadStarted": "正在下载：{file}"
  }
}
```

提示文案中的 `{file}`、`{limit}` 为动态变量，请保留占位符。

## 管理员账号

以下接口仅总管理员可用：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/admin/admins` | 管理员列表 |
| `POST` | `/api/admin/admins` | 创建子管理员 |
| `PATCH` | `/api/admin/admins/:id` | 编辑权限、状态、姓名或重置密码 |
| `DELETE` | `/api/admin/admins/:id` | 删除子管理员 |

可分配权限：

- `projects`
- `categories`
- `analytics`
- `inquiries`
- `settings`

总管理员始终拥有全部权限，不能停用或删除。
