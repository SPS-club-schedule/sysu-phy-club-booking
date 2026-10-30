# 物院社团时间预约

网站保持原 GitHub Pages 地址：https://sps-club-schedule.github.io/sysu-phy-club-booking/

Cloudflare 后端：https://sysu-phy-club-book.folderrewind.top

前端仅由 GitHub Pages 托管；Leafuke 域名仅提供 Cloudflare Worker API 和 WebSocket，访问其根路径会跳回 GitHub Pages。预约和课表持久保存在同一 SQLite Durable Object，新网页不再依赖 uniCloud 或 uni-push。

已完整保留 11 条历史/未来预约及 57 条排课规则。原 uniCloud 数据保留为历史备份，旧 API 仅转发到 Cloudflare，避免旧页面继续写入另一份数据库。

源码位于 `club-booking/`，课表源为 `club-booking/data/timetables.json`。在源码目录运行 `npm run deploy` 仅发布 Cloudflare 后端；`npm run build:pages` 生成前端文件，通过现有 GitHub Pages 工作流单独发布。不要向后端 Worker 上传静态网站文件。

公开课表接口只读，公开预约和二次确认取消规则不变。部署、验证和回滚边界见 [迁移记录](club-booking/plans/cloudflare-migration-20261030.md)。
