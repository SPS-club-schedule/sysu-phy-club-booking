# 物院社团时间预约

网站保持原 GitHub Pages 地址：https://sps-club-schedule.github.io/sysu-phy-club-booking/

Cloudflare 后端：https://sysu-phy-club-book.folderrewind.top

前端仅由 GitHub Pages 托管；Leafuke 域名仅提供 Cloudflare Worker API 和 WebSocket，访问其根路径会跳回 GitHub Pages。预约和课表持久保存在同一 SQLite Durable Object，新网页不再依赖 uniCloud 或 uni-push。

已完整保留 11 条历史/未来预约及 57 条排课规则。原 uniCloud 数据保留为历史备份，旧 API 仅转发到 Cloudflare，避免旧页面继续写入另一份数据库。

源码位于 `club-booking/`，课表源为 `club-booking/data/timetables.json`。在源码目录运行 `npm run deploy` 仅发布 Cloudflare 后端；`npm run build:pages` 生成前端文件，通过现有 GitHub Pages 工作流单独发布。不要向后端 Worker 上传静态网站文件。

网站和 Android App 共用账号。注册时选择社团并验证邮箱，以后仅用用户名和密码登录。成员可查看课程和其他社团安排，创建及取消本社团的普通预约。App 内置完整前端，可加密保存密码。预约成功、取消、邮箱验证、找回密码使用 Resend；预约邮件仅发给操作账号。详见[登录和邮件说明](club-booking/plans/accounts-resend-20261104.md)。

根目录的 `wrangler.jsonc` 专供 Workers Builds 识别 API 入口，不能改成静态文件部署。它由 `node club-booking/scripts/worker-build-config.mjs > wrangler.jsonc` 生成，Pages 工作流检查两份配置一致。后端要求保留邮件和 SPS 同步密钥及原数据库绑定。前端仍只发布到 GitHub Pages。
