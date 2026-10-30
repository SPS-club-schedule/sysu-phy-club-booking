# 物院社团时间预约

## 当前部署：GitHub Pages 前端 + Cloudflare 后端（2026-10-30）

- 正式网站保持原 GitHub Pages 地址：https://sps-club-schedule.github.io/sysu-phy-club-booking/ 。
- 后端基址：https://sysu-phy-club-book.folderrewind.top ，仅提供 `/api/*`（包括 WebSocket），根路径302跳转到 GitHub Pages。沿用 Leafuke 账号中已有的 `sysu-phy-club-booking` Worker 和域名绑定，不托管静态前端。
- 预约、历史记录和公开课表保存在该 Worker 的 SQLite Durable Object `BookingState` 中；版本条件更新保证并发冲突重检。实时更新使用 Cloudflare WebSocket 和休眠机制，新网页不再连接 uniCloud 或 uni-push。
- 完整迁入 11 条预约（其中 3 条是迁移时仍在可预约窗口内的记录）、4 份年级课表、57 条排课规则。迁入前后完整数据逐项一致；原 uniCloud 数据保留为迁移时备份。
- GitHub Pages 通过上述自定义域名跨域访问 Cloudflare API，CORS 精确允许原 Pages 来源。旧 uniCloud API 仅为旧页面转发请求，不再读写原数据库；旧页面请刷新以启用新的实时连接。
- `npm run deploy` 仅上传和发布 Cloudflare 后端，使用 `wrangler.leafuke.jsonc`，保留已有域名及存储绑定。`npm run build:pages` 构建调用 Cloudflare API 的前端，再通过现有 GitHub Pages 工作流发布。两部分独立发布，不把前端传到 Worker。
- 公开预约和二次确认取消的权限不变；课表仍只读。两个本地 HTML 的存储 key 不变，仍仅保存在当前浏览器，不会自动同步到云端。
- 类型检查、72 项 Node 测试、12 项 SQL 冲突检查、构建和部署 dry-run 已通过；线上新增、重复拦截、旧 API 读取/取消、WebSocket 推送与测试数据清理已验证。详见 [迁移记录](plans/cloudflare-migration-20261030.md)。

下文均为历史部署记录，涉及 uniCloud、旧 D1、旧命令和旧 URL 的说明以本节为准。

## 2026-10-29 组织迁移

仓库迁至 https://github.com/SPS-club-schedule/sysu-phy-club-booking ，保持公开。网站地址改为 https://sps-club-schedule.github.io/sysu-phy-club-booking/ 。以下旧地址均为历史记录。uniCloud 支付宝云空间及数据保持原位；API 同时允许新旧 Pages 源以支持迁移。

## 当前部署：GitHub Pages + uniCloud 支付宝云（2026-10-09）

本节取代下方历史部署说明。保留原网址 https://farawayshore.github.io/sysu-phy-club-booking/ 。

- 后端空间 `sysu-club-booking-alipay`（`env-00jy6xwsp3aa`），API `https://env-00jy6xwsp3aa.dev-hz.cloudbasefunction.cn/booking-api`。
- 数据库 `club_booking_state/current` 保存预约及公开课表，保留原预约，录入当前57条排课规则；客户端数据库禁止直接读写，公开课表接口只读。管理员仍通过源文件及受管理账号保护的数据库控制台维护，尚无网站账号系统。
- 此次包含大二物理及拔尖班、大三物理/光信课表、课程分类、体育合并、课程宽度修复、两个月预约及完整手机周视图。
- 沿用 uni-push 2.0，变化时通知其他页面读取；没有定时云端轮询。首次读取、推送和手动刷新更新；返回前台/重连补查有60秒去重。写入成功直接返回最新快照，提交端无需另发GET；写入期间收到的推送按版本合并。
- `node scripts/build-unicloud.mjs` 默认生成 `outputs/unicloud-deploy/uniCloud-alipay/cloudfunctions/booking-api`，通过 HBuilderX CLI `--provider alipay` 上传。不要再次初始化已有数据库。
- `node scripts/export-pages.mjs` 默认使用支付宝云API。`node scripts/export-html.mjs` 更新本地HTML；本地预约仅保存在浏览器，存储key保持兼容。
- 免费空间当前到期2026-11-09，未开启按量或付费。默认域名仍有平台测试用途和限流限制。
- CloudBase尝试已停止，未作为正式数据源；历史代码/备份保留本地。发布证据与验证记录见 `plans/alipay-migration.md`。

---

以下为历史阶段记录，若与上述冲突以当前部署为准。

> 本地待同步（2026-10-09）：体育已统一合并显示并隐藏地点；课程宽度按各重叠时段计算，独占时段铺满当天一列。现已另加入大三光信课表，按专业独立排课，共享课程去重；量子光学按用户确认隐藏。新增大二物理学第6–16周截图课表，合并第二份大三物理学课表；人工智能导论为必修，现代物理导论仅随拔尖班开关显示。此次未更新云端和GitHub。详见 plans/timetable-import-20261009.json。

## 专业与班型课表筛选

2026-10-08 本地新增年级→专业→特殊班型叠加与必修/选修过滤。大一不分专业；大二有物理学/光信与拔尖班，大三、大四另可叠加理论物理国际班。特殊班型默认不勾选，无“普通班”开关。现有 25 条排课已按提供的 2024 级方案核对：8 门必修、4 门专业选修；经全部方案核对仍未提及的公共选修不显示，本次没有此类课程。培养方案原件放 `resources/program-plans/`，不参与网页、云函数打包或数据库上传。详见 `plans/curriculum-classification.md`。2026-10-09 前后端同步发布，部署验证见 plans/oct09-release.md。

## 2026-10-08 最新部署：GitHub Pages + uniCloud

本节取代下文 Cloudflare/D1 的当前部署说明；下文相关命令仅保留作旧后端维护参考。

- 前端网址不变：https://farawayshore.github.io/sysu-phy-club-booking/
- API：https://fc-mp-a5e7c91d-8504-4701-b37b-49e7c0c4158f.next.bspapp.com/booking-api
- uniCloud 空间 sysu-club-booking，阿里云开发者版。集合 club_booking_state 的 current 文档保存预约和公开课表；revision 条件更新保证并发冲突重检。客户端直连数据库权限全部关闭。
- unicloud/api.ts 为后端源码；node scripts/build-unicloud.mjs 打包到 outputs/unicloud-deploy，再用已登录的 HBuilderX 上传 booking-api。只发布云函数，不发布该目录的模板前端。
- 预约上限为今天起两个自然月（含截止日）；分页动态截止于最后一个可预约日期所在周，末周超出范围日期禁用。
- 预约与课表合并一次读取。线上已接入 uni-push 2.0：新增/取消成功后广播版本号，在线页面收到后读取一次；首次进入、重新连接和返回页面时补查，保留手动刷新，不再定时轮询。连接状态显示在日历底部。
- 课表无公共写入接口。管理更新须登录 uniCloud 数据库控制台，保留现有预约，检查并递增 revision；不要重跑初始化覆盖在线数据。原 db:import:curriculum 命令只会更新旧 D1，不能更新正式网站。
- 旧 Cloudflare API 只向 uniCloud 转发，D1 原始数据保留；切勿解除转发后直接使用过期 D1 作为主库。
- 免费空间当前到期日为2026-11-08，需要主动续期。默认域名官方定位为测试域名，长期使用应按平台要求绑定备案域名。没有开启付费套餐或按量计费。
- 迁移详情见 plans/unicloud-connection.md；实时推送实现、限额及验证见 plans/realtime-updates.md。

独立项目目录：`/Users/grassman_number/Projects/club booking project/club-booking`。旧路径 `/Users/grassman_number/Projects/club-booking` 保留为兼容符号链接。

React 前端部署到 GitHub Pages，uniCloud 云函数提供 API，云数据库保存预约和课表，附可直接打开的本地单文件 HTML。历史 Sites 配置仅保留归档，不参与当前构建或发布。

## 打开网页

线上网站：https://farawayshore.github.io/sysu-phy-club-booking/

直接打开 `outputs/物院社团时间预约.html`，无需启动服务。本地版预约及历史课表缓存保存在当前浏览器，与线上数据库不自动同步。网页和本地页均为课表只读；管理员修改 data/timetables.json 后重新导出，正式课表须经已登录的 uniCloud 控制台更新。当前尚未实现网站内的管理员登录。

迁移前的目录 `/Users/grassman_number/AI/ai_works/club-booking` 现在是指向本项目的兼容链接。已有本地预约或课表时，继续用原 HTML 地址打开；浏览器可能按 `file://` 地址分别保存数据，新地址不会自动继承旧地址的数据。迁移没有删除或修改浏览器存储。

## 开发和验证

使用 Node.js 22.13 或更新版本；迁移时已保留 node_modules。需要重新安装依赖时运行 `npm run install:ci`。

```sh
npm run dev
npm run build
npm run db:migrate:local
node scripts/export-html.mjs
node node_modules/typescript/bin/tsc --noEmit
node --test tests/*.test.mjs
python3 tests/conflicts.py
```

`npm run dev` 启动端口 5173。网站模式使用 D1；数据库结构在 `db/schema.ts`，迁移在 `drizzle/`。导出脚本把同一页面和样式打包到新旧两个 HTML 文件。

## 维护位置

- `app/page.tsx`、`app/globals.css`：网页和手机布局。
- `app/schedule.ts`：社团名单、日期规则、连续时间轴。
- `app/api/bookings/route.ts`：线上预约、冲突确认和取消接口。
- `offline/entry.tsx`：本地 HTML 的浏览器存储接口。
- `data/timetables.json`、`app/curriculum.ts`：学期课表与课程冲突逻辑。
- `app/timetable-editor.tsx`：本地课表编辑、导入、导出和调休设置。
- `outputs/`：可打开的 HTML、课表 JSON 和浏览器检查截图。
- `wrangler.api.jsonc`、`worker/api.ts`：正式 API 的 Cloudflare 配置及入口。
- `online/entry.tsx`、`scripts/export-pages.mjs`：GitHub Pages 前端构建。
- `wrangler.jsonc`、`build/cloudflare-worker.ts`：本地开发及原全栈构建配置。
- `plans/other/club-booking-handoff.md`：功能、测试和发布状态交接记录。

## 当前行为

手机日历同时展示一周七天，时间轴压缩为 1 px/min；活动块显示简短名称，点击可查看完整信息。桌面保持原有完整文字和 2 px/min 时间比例。

社团为 SPS、torchwood、学生会。可预约北京时间今天至两个自然月后的对应日期（含），月末日期自动取目标月份的最后一天；日历仅显示覆盖此区间的周，必须填写地点；同社团重叠禁止，其他社团重叠需确认。点击预约可查看详情并通过二次确认取消。

课表支持不筛选和多年级叠加，仅检查选中年级的课程冲突，确认后仍可预约。当前“大三”试用数据来自个人 2026 第一学期课表，不代表全年级；25 条授课规则、12 门课程，第一周星期一为 2026-09-07。线上课表从 D1 加载，本地 HTML 内置离线副本，运行不依赖原 AI 项目。

本地编辑课表仅影响当前浏览器。线上课表存放在 D1 的 `curriculum_documents`，仅公开读取。更新共享课表：修改 `data/timetables.json` 后，由已登录 Cloudflare 管理账号的本机执行 `npm run db:import:curriculum -- --remote --public`；脚本会验证格式、仅导入课表字段并回读校验，无需重新打包前端。导出模板位于 `outputs/大三-2026第一学期课表.json`。

## Cloudflare 后端发布

API 基址：https://physics-club-booking.sysu-physics-clubs.workers.dev

该地址的根路径会跳转到 GitHub Pages；`/api/bookings` 与 `/api/curriculum` 继续由 Worker 提供。

使用自己的 Cloudflare 账号，Worker 为 `physics-club-booking`，D1 数据库为 `physics-club-booking-db`。构建不调用 OpenAI Sites 或连接器，原 `.openai/hosting.json` 标识保持不变，仅作历史归档。

```sh
node node_modules/wrangler/bin/wrangler.js login
npm run db:migrate:remote
npm run deploy:api
```

首次部署先应用数据库迁移；后续迁移也应先审核 SQL，再执行。`npm run deploy:api` 使用 `wrangler.api.jsonc` 上传独立预约 API。原全栈构建仍可通过 `npm run build` 验证，产物在 `dist/`，发布与验证证据在 `outputs/deployment/`。

线上预约由 D1 共享保存，每 30 秒自动刷新，窗口重新获得焦点也会刷新。任何持链接者可查看、预约和通过二次确认取消预约，当前没有用户身份或预约归属限制。课表由 `/api/curriculum` 只读接口从 D1 加载，前端包不再内置个人课表。网页没有课表写入接口；浏览器课表编辑仍只用于本地 HTML。本地浏览器已有预约不会自动上传。用户账号系统和管理员网页编辑尚未实现；当前共享课表更新使用受 Cloudflare 管理凭据保护的本机命令。未开通付费套餐、未使用付费 API；邮件通知尚未实现。

## GitHub Pages 前端发布

用户指定仓库：`git@github.com:farawayshore/sysu-phy-club-booking.git`，用户已自行设为公开。Pages 已启用 main 分支根目录发布并强制 HTTPS，线上网页：https://farawayshore.github.io/sysu-phy-club-booking/ 。

```sh
npm run build:pages
```

产物为 `outputs/github-pages/index.html` 与 `.nojekyll`，使用与本地 HTML 相同的页面和 CSS，通过 HTTPS 调用 Cloudflare 预约 API。`BOOKING_API_BASE` 可在构建时指定后端基址。将这两个文件更新至仓库 main 根目录即可触发分支式 Pages 发布；本次发布克隆在 `outputs/pages-repo`。

后端独立配置为 `wrangler.api.jsonc`，允许前端来源 `https://farawayshore.github.io`。变更前端域名时要同时修改该来源与 `FRONTEND_URL`，再重新部署后端。更新页面后运行 `node scripts/export-html.mjs` 同步本地导出文件。

## 在 Codex 中继续

在 Codex 侧栏添加现有项目文件夹，选择本目录。添加前可先阅读本 README 和交接记录；当前迁移操作不创建新聊天，也不改变旧聊天所属项目。
