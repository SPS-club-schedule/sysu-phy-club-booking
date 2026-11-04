# 登录、社团权限与 Resend（2026-11-04）

## 用户确认与行为

- 注册绑定 SPS、torchwood 或学生会，必填用户名、密码和邮箱。社团为自主选择，无邀请或审核。每个用户名及邮箱唯一。邮箱验证完成后才可查看共享日历和预约。
- 后续仅用户名、密码登录；密码至少 10 字符。验证码 15 分钟有效、最多试错 5 次，重发间隔 1 分钟。找回密码要求用户名、已验证邮箱和邮件验证码；成功后撤销此前所有会话。
- 同社团成员可以创建及取消本社团全部普通预约；服务端每次写入校验归属，前端隐藏其他社团取消入口。SPS 同步任务仍由原任务管理。保留原有同社团冲突禁止和跨社团重叠确认。
- 预约成功和取消邮件仅发送到本次操作账号的已验证邮箱，不群发全体社团成员。
- 网站、App 共用账号。App 使用 Android Keystore AES-GCM 加密保存会话和可选密码，退出后清除。保存的密码只由原生固定 HTTPS 登录请求使用，不回传 WebView。菜单可单独清除密码。浏览器仅用 sessionStorage 保存会话。

## 后端与数据

沿用 `sysu-phy-club-booking` Worker、原域名、原 `BookingState` SQLite Durable Object 和 `club-booking-production` 实例。仅创建账号、验证码、会话、限流、邮件队列表，预约主表及课程不迁移、不重新初始化。正式网站继续 GitHub Pages，Worker 不托管页面。

密码在服务器使用独立随机盐的 scrypt（N=32768,r=8,p=3）保存。会话为随机 256 位令牌，服务器仅存 SHA-256，7 天到期。API 用 Bearer；WebSocket 用 60 秒单次票据，账号退出或重设密码后连接失效。生产课表、预约及实时通道必须登录并验证邮箱。`/api/activities` 为既有 SPS 互通继续公开，不含邮箱或课程；服务端 SPS 同步密钥独立保留。

账号服务限流覆盖 IP、用户名、验证码、邮件收件地址和预约写入。不会在网页/APK/源码包中放数据库管理密钥、Resend 密钥或现有预约数据。本地 HTML 保留独立离线行为与原存储 key。

## Resend 配置

- 用户明确确认创建专用 `physics-club-booking-production` 密钥，权限为 **Sending access**，仅 `sps-schedule.folderrewind.top` 域。
- 密钥经标准输入写入预约 Worker 的 `RESEND_API_KEY`；未写进项目文件、源码包或聊天。原 SPS 邮件密钥不变。
- 发件人：`物院社团预约 <booking@sps-schedule.folderrewind.top>`。`EMAIL_ENABLED=true`、`EMAIL_FROM`、`FRONTEND_URL` 在 `wrangler.leafuke.jsonc`。
- 邮箱验证、重设密码、预约成功、预约取消均通过 SQLite 持久队列与 DO alarm 投递。预约更新和对应通知同事务提交，邮件服务故障不撤销已成功预约。
- 网络错误、5xx、429、409 使用相同消息体和 Idempotency-Key 重试，最大间隔 5 分钟。验证码过期停止发送；预约通知最多保留 23 小时。永久 4xx 记录状态码后停止，日志不含收件地址或密码。
- 本 Worker 每 UTC 日最多尝试 50 次发信，达到后延后；验证码可能在等待中到期，需要重发。Resend 账号与 SPS 共用供应商额度，此限制不预留账号总额度，供应商限流仍会退避。没有升级付费计划。
- 官方测试收件地址的发送接口返回 200；这只证明发件域、权限与接口可用，不代表真实成员邮箱的投递/垃圾箱情况。注册后仍需成员实际输入收到的验证码。

运维：`wrangler secret list --config wrangler.leafuke.jsonc` 只检查密钥名称；不要读取/导出旧密钥。修改发件域须重新核对该域验证和密钥作用域。紧急停信可设置 `EMAIL_ENABLED=false`，此时新注册与发验证码返回暂不可用，已有已验证账号可继续预约。

## 验证与发布

测试与发布结果在本文件后续补充。所有业务写入测试使用隔离 Miniflare 数据库和断网模拟器；不使用真实账号、收件人或生产预约作测试。

Android 为 `org.spsclub.booking` 1.1.0 / versionCode 2，完整前端内置，沿用初版签名。后台新增认证后，初版 1.0.0 必须覆盖升级。源码包不含密钥、签名配置、私有数据、SDK 或构建缓存。
