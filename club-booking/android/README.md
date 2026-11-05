# 物院社团预约 · Android

完整 React 页面、CSS、图标与运行库内置在 APK。启动无需访问 GitHub Pages，不下载网页或外部字体。Android 8.0（API 26）以上，建议使用更新的 Android System WebView / Chrome。

首次注册选择社团，填写用户名、密码及邮箱，完成邮箱验证码验证后使用；以后仅输入用户名和密码。与网页版共用账号和数据，所有成员可管理本社团全部普通预约，查看其他社团活动。课表需勾选“叠加年级课表”，可继续按专业、班型与课程性质筛选。SPS 自动同步活动通过详情里的“打开 SPS 任务”进入浏览器管理。

登录时默认勾选“在此手机保存密码，下次自动登录”，可取消。密码和会话使用 Android Keystore 的 AES-GCM 加密保存在应用私有空间；原生代码在会话过期后直接登录固定后端，不将保存的密码回传网页。退出登录撤销当前会话并清除本机保存；菜单可单独清除保存密码。网页登录仅在 sessionStorage 保留短期会话，不保存密码。

登录后在日历上方点「填写主负责人邮箱」或「修改主负责人邮箱」。普通预约由其他成员创建时，邮件发给本社团主负责人。确认跨社团时间冲突后，已有预约的创建者和双方负责人收到协商提醒。取消活动会通知本社团负责人；由其他成员代取消时，原预约人也收到通知。同一事件按邮箱去重。

## 数据路径

`APK 内置页面 → HTTPS /api/bookings → 现有 Cloudflare Worker → SQLite Durable Object`

- 后端固定为 `https://sysu-phy-club-book.folderrewind.top`，首次读取一次获得预约和全部公开年级课表；旧接口响应缺少课表时才补读 `/api/curriculum`。
- 复用 `/api/updates` WebSocket，以登录后的单次短效凭证连接，只接收版本通知，变化时再读取最新快照；写入响应自带最新快照。没有新增定时数据库轮询、代理服务或数据库副本。
- App 包不含课程记录、预约记录、数据库管理密钥和云端写入密钥。课程、社团预约和 SPS 同步活动更新无需重发 APK；页面功能更新需重建并升级 APK。
- 初次断网仍能打开页面，但无法获取日历数据。读取失败保留已经显示的内容并提供重试；冷启动不以过期数据代替最新安排。不做离线提交，写入网络失败不会自动重发，以免重复预约。
- API 请求 15 秒无响应头则中止并提示重试。写入失败提示先刷新确认结果。现有网站和本地 HTML 共用此网络错误处理。

## 本地页面与安全边界

使用 Android 官方 [WebViewAssetLoader](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content) 在项目拥有的 Pages 源下保留专用路径：`https://sps-club-schedule.github.io/sysu-phy-club-booking/__android__/index.html`。该地址只由 App 拦截并读取 APK assets，不是另一个在线网站。这样现有精确 CORS 白名单和 WebSocket Origin 校验无需改动。

- WebView 只打开上述本地入口；页面以外的 Github Pages 请求不会透传网络，缺失资源也不从互联网补载。
- 外链交给系统浏览器，WebView 内只允许固定后端的预约、课表、连接检查及账号端点；CSP 仅允许编译脚本的 SHA-256 和固定 API / WebSocket 源。账号消息桥只接受固定来源、主框架及内置入口，密码不会从原生存储返回页面。
- 禁止 HTTP、混合内容、文件 URL、content URL、第三方 cookies；不绕过证书错误。release 关闭调试，仅申请普通联网/网络状态权限，关闭系统备份和设备迁移。
- Android 返回键先关闭页面详情或确认弹窗，再回到桌面；菜单重新加载会提示未提交表单会清空。日历的“刷新”只更新数据。

## 构建与签名

工具版本：Node.js 22.13+、JDK 17、Android SDK 36、Build Tools 35.0.0、Gradle 8.13、Android Gradle Plugin 8.13.2。Gradle Wrapper 校验固定发行包 SHA-256。先在项目根目录安装 npm 依赖，再设置 `JAVA_HOME`、`ANDROID_HOME`，或者在忽略的 `android/local.properties` 设置 `sdk.dir`。

```sh
npm ci
npm run build:android:web
cd android
./gradlew testDebugUnitTest assembleDebug
```

Gradle `preBuild` 自动运行 `scripts/export-android.mjs`，直接从现有 `app/page.tsx`、`app/globals.css` 和 Cloudflare 在线入口打包，避免只更新源码却交付旧页面。生成的 `assets/www` 不提交 Git。

release 签名配置由环境变量 `BOOKING_ANDROID_SIGNING_PROPERTIES` 指向仓库外的属性文件，包含 `storeFile`、`storePassword`、`keyAlias`、`keyPassword`；也支持被忽略的 `android/signing.properties`。无签名配置时产物为 unsigned，不能直接分发。

```sh
./gradlew testDebugUnitTest lintRelease assembleRelease
```

包名 `org.spsclub.booking`，当前版本 `1.2.0` / code `3`，与 `org.spsclub.schedule` 并存。沿用 1.0.0 签名，可覆盖升级。后端新增登录保护后旧 App 必须升级。备份签名密钥和配置，不要把它们发给成员或放进源码包。

## 验证

```sh
node --test tests/*.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```

设备测试仅在测试模拟器运行。先关闭模拟器 Wi-Fi 和移动数据，`./gradlew connectedDebugAndroidTest` 验证 APK 内置真实 React 页面在断网时可打开、替代 API 的课程/其他社团活动渲染、刷新新课程、弹窗返回键、读取失败重试、横向布局不溢出；测试数据不发送生产服务器。

账号设备测试还覆盖：登录失败不保存密码、加密落盘、未勾选保存、重载恢复会话、退出失败保留登录、退出成功清理和原生自动登录。恢复模拟器网络后，`./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.live=true` 验证未登录时进入内置登录页，不创建生产账号或预约。实体手机的 WebView 和网络仍需实际安装检查。1.0 历史验证见 [初版记录](../plans/android-app-20261104.md)，当前版本见 [账号与邮件](../plans/accounts-resend-20261104.md)。
