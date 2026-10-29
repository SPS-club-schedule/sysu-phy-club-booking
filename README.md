# 物院社团时间预约

网站：https://sps-club-schedule.github.io/sysu-phy-club-booking/

前端由 GitHub Pages 托管，后端使用 uniCloud 支付宝云。源码位于 `club-booking/`，课表源为 `club-booking/data/timetables.json`。

本次包含全部课表与显示修复，并取消定时轮询、合并重复读取、让写入响应携带最新快照以减少云函数调用。课表编辑仍仅限管理员，公共接口不开放课表写入。

部署说明见 `club-booking/plans/alipay-migration.md`。按用户要求直接发布，剩余线上写入和推送联调尚未完成。
