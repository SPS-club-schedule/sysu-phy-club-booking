# 物院社团时间预约

正式网站：https://sysu-phy-club-book.folderrewind.top/

GitHub Pages 备用入口：https://sps-club-schedule.github.io/sysu-phy-club-booking/

2026-10-30 起，前后端使用 Leafuke 账号中的 Cloudflare Worker `sysu-phy-club-booking`，预约和课表持久保存在 SQLite Durable Object，实时更新使用 Cloudflare WebSocket。GitHub Pages 使用同一后端；新网页不再依赖 uniCloud 或 uni-push。

已完整保留 11 条历史/未来预约及 57 条排课规则。原 uniCloud 数据保留为历史备份，旧 API 仅转发到 Cloudflare，避免旧页面继续写入另一份数据库。

源码位于 `club-booking/`，课表源为 `club-booking/data/timetables.json`。在源码目录运行 `npm run deploy` 发布 Cloudflare；`npm run build:pages` 生成 Pages 文件。公开课表接口只读，公开预约和二次确认取消规则不变。

部署、验证和回滚边界见 [迁移记录](club-booking/plans/cloudflare-migration-20261030.md)。
