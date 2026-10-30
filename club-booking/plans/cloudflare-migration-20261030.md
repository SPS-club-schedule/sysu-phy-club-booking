# uniCloud → Cloudflare 迁移（2026-10-30）

## 线上状态

- 网站保持 GitHub Pages 原地址： https://sps-club-schedule.github.io/sysu-phy-club-booking/
- 仅后端使用 Leafuke 域名： https://sysu-phy-club-book.folderrewind.top ，根路径302跳转到 Pages，`/api/*` 和 WebSocket 仍由 Worker 处理；Worker 不再绑定或上传静态前端。
- GitHub： https://github.com/SPS-club-schedule/sysu-phy-club-booking
- Leafuke Cloudflare 账号：`9b780cdb0cd2a083330601598d3ea9dc`。
- 沿用已有 Worker：`sysu-phy-club-booking`；沿用域名及 `sysu-phy-club-booking.zhuolin-yew.workers.dev`。
- SQLite Durable Object：类 `BookingState`，绑定 `BOOKINGS`，命名实例 `club-booking-production`；namespace `f5a6bd11e6d14e9ab72ea18b890da854`。
- 初次完整迁移后清除临时密钥的线上版本：`c2013d41-f8d9-46b1-8995-99230dc6c03a`，100% 流量。随后加入 Cloudflare 连接测试接口，最终发布版本 `bc1c9fb6-ad01-4f03-b3f9-97ed7e9ecdb1`。后续发布请以 Cloudflare deployments 查询为准。

## 数据与行为

冻结原 uniCloud 写入并等待旧请求结束后，导出 `club_booking_state/current` 的完整 state 和 revision34；不是只导出公开 API 中按日期过滤后的预约。

共 11 条历史/未来预约、4 份年级课表、57 条排课规则，完整导入新存储后回读逐项比较，公开快照也与原接口完全一致。迁移导入只允许空库初始化，重复导入返回409，不能覆盖已有数据库。

Worker 不向 uniCloud 发请求。共享业务规则位于 `app/booking-handler.ts`，Cloudflare 存储及路由位于 `worker/cloudflare.ts`。新增/取消依靠一条条件 UPDATE 比较 revision；发生并发竞争时重新读取并校验冲突。SQLite 存储在 Worker 重启后持久保存。

`/api/updates` 使用 Durable Object 休眠 WebSocket；通知只有 revision，客户端收到后读取可信 API。心跳由 Cloudflare 自动响应，无定时数据库轮询。连接断开自动重连，连接时发送当前版本以补查遗漏。`online/cloudflare-push.ts` 替换旧 uni-push SDK，Cloudflare 前端构建明确检查不包含该 SDK。

旧 uniCloud `booking-api` 已改为向 Cloudflare 转发，只供仍打开旧页面的用户过渡使用；不再使用旧数据库。旧页面需刷新后才能使用新的实时连接。支付宝云到期不会影响新前端及 Cloudflare 后端。

原 uniCloud 数据库和早期 D1 未删除。它们仅是历史备份，不能作为迁移后的主库，也不能直接用于回滚新产生的预约。

## 发布与维护

```sh
npm run deploy
# 或 npm run deploy:cloudflare
npm run build:pages
```

`scripts/deploy-cloudflare.mjs` 仅执行后端的 `wrangler versions upload`，取得明确版本 ID 后 `versions deploy <id>@100 --yes`。前端由 `npm run build:pages` 生成，通过仓库现有 GitHub Pages 工作流单独发布。它不会修改现有域名绑定。初次创建 Durable Object 需要执行带 migration 的首次上传，此步骤已完成，不要创建第二个生产实例。

当前成员角色是 Individual Workers Admin：可以发布这个 Worker 及其绑定；账号级 namespace 列表、D1 列表、域名列表和 workers.dev 子域名查询会被拒绝。普通 `wrangler deploy` 曾在成功上传和激活后因查询账号子域名报错，已通过部署记录核实实际成功；后续采用版本发布避免该无关步骤。无需为了本次已完成的迁移扩大权限。

生产配置：`wrangler.leafuke.jsonc`。旧 `wrangler.api.jsonc` / `wrangler.jsonc` 保留历史/框架构建用途，不是当前生产存储。默认 uniCloud 构建模式现在是 `forward`；不要重新发布 `normal` 模式造成两个数据库独立写入。

临时 `/__migration` 管理导入/导出仅在 `MIGRATION_TOKEN` 存在时开放。迁移结束已删除该密钥及 `BOOKING_MAINTENANCE`，拆分前后端后仅保留 `ALLOWED_ORIGINS`、`FRONTEND_URL`、`BOOKINGS` 三个绑定。敏感值未写入仓库。需要未来备份或维护时，管理者应使用受保护的管理通道，不要增加公开课表写入接口。

Cloudflare 跨版本发布会保留秘密变量；切换到上传于秘密变量创建前的版本不会自动删除它们。必须显式删除并核实当前绑定。存在未部署的最新版本时，普通 secret 修改会报10215；先明确部署最新版本，再删除临时秘密变量。

## 验证

- 72 项 Node 测试，包括真实 workerd/SQLite 的持久性、受保护导入、并发冲突、取消、快照、实时通知、心跳及旧接口桥接。
- TypeScript、12 项 SQLite 原子冲突检查、现有框架构建和 Worker dry-run 通过。
- 线上新增临时测试预约 → 同社团重复409 → 旧 API 可读取 → 从旧 API 二次确认取消 → 新 API 原3条预约与57条规则保持一致；WebSocket 收到提交版本，最终 revision36，测试数据已清理。
- Chrome 打开正式域名，显示原预约、四个年级和“实时更新已连接”。
- 完整数据备份和部署/验证回执仅在忽略的 `outputs/cloudflare-migration/`，不提交在线预约数据。

## 回滚边界

切换前失败可以恢复原 uniCloud 函数，并保持 Cloudflare 禁止写入。切换后已经有新写入时，不能直接恢复原 uniCloud 数据库或旧 D1；应保留当前 Durable Object，回退兼容的 Worker 代码，或冻结写入后完整导出最新数据再进行反向迁移。

## 用户澄清：保留原 GitHub Pages 前端

用户明确要求原 GitHub Pages 域名继续作为网站，Leafuke 域名仅供免费 Cloudflare 后端访问。之前同域同时托管前端是对用户意图的误解，已移除 `assets` 配置和 `ASSETS` 绑定；根路径跳回 Pages。数据库和已迁移数据不变，不重新初始化、不反向迁移。无需更换前端 API 地址。

当前机器上禁用 curl 的显式代理后，后端健康接口返回200；这只能证明本机的这次请求，不能保证所有校园网/运营商均可直连。

拆分发布版本：`7993ba05-3503-4046-b3be-3870d1b905fd`，100%流量。线上验证后端根路径302至原Pages、`/index.html` 返回404、Pages来源CORS预检及WebSocket正常；公开数据完整一致，revision36未改变。回执：`outputs/cloudflare-migration/backend-only-verification.json`。
