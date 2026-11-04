# 物院社团预约 Android 1.0.0

日期：2026-11-04（北京时间）。用户要求把预约项目前端内置到 App，尽量直接访问既有后端获取课程与其他社团预约。按相邻 SPS 日程项目的 Android 交付方式实现。

## 最终实现

- 独立包 `org.spsclub.booking`，版本 `1.0.0` / code `1`，Android 8.0+，target/compile SDK 36，与 SPS 日程 App 并存。
- `scripts/export-android.mjs` 从已有页面、样式、在线入口和 Cloudflare 推送适配器生成单文件 assets；Gradle preBuild 自动运行导出，避免打入旧前端。HTML 为 273,979 bytes，包含全部运行库及样式，使用系统字体。
- WebViewAssetLoader 保留现有组织 Pages 源的专用 `__android__` 路径，本地拦截读取 APK，不访问 GitHub Pages 取网页。CORS 与 WebSocket Origin 继续使用已获允许的组织源，不修改后端配置。
- 数据直接经过公开 Cloudflare API 读取当前 SQLite Durable Object；没有额外代理、数据库副本或管理凭据。课表和预约不写死在包里，保留实时版本通知、增量刷新规则和原有冲突/取消确认。
- 外链进入系统浏览器，返回键先关闭网页弹窗，菜单重新加载提醒表单会清空。不开启原生 JS 桥或任意外部页面加载；release 禁用 WebView 调试。
- 共享 API 客户端增加 15 秒响应头超时和中文断网提示；写入结果不确定时提示先刷新确认，禁止因超时/普通网络错误自动重复提交。原有明确“尚未执行”的 uniCloud 网关重试逻辑保留以兼容旧目标。
- 已更新两个本地 HTML 和 Pages 构建产物，没有发布网页、修改生产数据库或推送 Git。原工作区修改保留。

## 验证证据

- Node：77 项全部通过，包含真实 workerd/SQLite 的并发、冲突、CORS、只读课表、实时通知、SPS 同步，以及新增超时/断网/取消信号和 Android 内置包 CSP/无远程资源检查。`outputs/android-node-tests-final.log`。
- TypeScript 无错误；12 项原子 SQL 冲突检查和地点往返通过；框架、Pages 和两个本地 HTML 构建通过。`outputs/android-framework-build.log`。
- Android URL 单元测试 2 项通过；`lintRelease` 0 错误、4 条工具/依赖可更新提示；release 构建成功。`outputs/android-build.log`。
- Android 15 / WebView 124.0.6367.219 模拟器，断网运行 3 项设备测试：真实内置 React 界面冷启动、替代 API 下其他社团与课程渲染/刷新、返回键关闭弹窗、横向不溢出、读取失败及重试。生产连接测试按参数跳过，全部测试数据留在离线模拟器。
- 恢复网络后单独运行生产只读设备测试：4 份年级课表读取成功，WebSocket 显示“实时更新已连接”。离线测试按参数跳过。`outputs/android-live-tests.log`。
- 正式 API 只读快照 revision46、4 份课表、57 条课程规则、当前窗口 2 条预约；返回精确 Pages CORS 源。`outputs/android/live-read.json`。这是本次检查的快照，后续以线上当前数据为准。
- 最终签名 release 实际安装、冷启动成功；包标志无 DEBUGGABLE；APK v2 签名验证通过。真实活动详情与“打开 SPS 任务”跳转 Chrome 已检查；未执行生产预约写入/取消。截图 `outputs/android/android-release-online.png`、`android-release-detail.png`。
- 精简源码包在独立目录执行 npm ci、前端导出、Android 单元测试与 assembleDebug 均成功，生成的 HTML 与交付版逐字节一致。日志保存在 `outputs/android/source-build.log`。

## 交付与维护

- `outputs/android/物院社团预约-1.0.0.apk`：签名正式安装包。
- `outputs/android/物院社团预约-1.0.0-源码.zip`：独立可构建前端和原生工程，不含密钥、生产数据、SDK、node_modules 或构建缓存。
- `outputs/android/安装说明.txt`、`SHA256SUMS.txt`。
- 本机专用发布签名与配置保存在仓库外 `/Users/grassman_number/.local/share/club-booking-android-signing/`，权限仅当前用户。升级必须沿用此签名并增加 versionCode，不向成员发送该目录。
- 线上课程/预约更新无需重打包；前端/原生功能更新需重建 APK。既有 GitHub Pages 与仅 API 的 Cloudflare 后端部署方式保持原样。

尚未完成实体手机验收；模拟器检查不代表所有厂商 WebView 和校园网络。此次没有执行生产写入验收，业务写入由现有本地集成测试覆盖。
