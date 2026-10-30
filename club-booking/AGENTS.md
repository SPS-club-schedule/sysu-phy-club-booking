# 物院社团时间预约

- 2026-10-30 起正式后端为 Leafuke 账号的 `sysu-phy-club-booking` Worker 和 SQLite Durable Object，配置 `wrangler.leafuke.jsonc`；前端唯一正式入口为 https://sps-club-schedule.github.io/sysu-phy-club-booking/ ，Leafuke 域名 https://sysu-phy-club-book.folderrewind.top 仅承载 API/WebSocket；不要向该 Worker 发布静态前端。旧 D1 / uniCloud 数据仅作历史备份，不可用它们覆盖当前数据库。详情见 plans/cloudflare-migration-20261030.md。

- 这是独立 Git 项目。先阅读 README.md 及 plans/other/club-booking-handoff.md。
- 保留已有工作区修改；未获要求不要重置、删除记录、创建替代线上站点或改变原 Sites 标识。
- 网页与本地 HTML 共用 app/page.tsx 和 app/globals.css；改动后运行 node scripts/export-html.mjs 更新两个导出文件。
- 当前本地预约及课表存储 key 必须保持兼容。不要把本地存储表述为跨设备共享数据。
- 不调用付费 API。用户界面使用中文；桌面与手机布局均需兼容。
- 课表源是 data/timetables.json。不要把外部 Dida 任务 ID、老师或学生个人信息混入导出数据。
- 计划、交接和决策文档放 plans/；网页及验证输出放 outputs/。
- 改动后执行与改动相关的类型检查、已有测试与构建；发布完成必须有实际部署证据。
