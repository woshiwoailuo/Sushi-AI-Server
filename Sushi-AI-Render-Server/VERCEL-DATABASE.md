# Vercel 会员库持久化方案

## 当前状态

Vercel 函数的本地文件系统不是持久盘。当前 SQLite 代码在 Vercel 上只允许使用 `/tmp/sushi-data`，因此适合临时验收，不适合承载真实会员账号、验证码、额度和审计记录。

`GET /api/health` 会返回 `db.durable: false` 和明确警告，避免误把临时库当成生产库。

## 推荐落地方案：Neon Postgres

1. 在 Neon 创建生产数据库，并把连接串以 Vercel 的 `DATABASE_URL` 环境变量保存到 Production。
2. 以现有表结构为基线，把 `users`、`gen_logs`、`audit_logs`、`email_codes`、`app_releases` 迁移为 Postgres 表；SQLite 的 `INTEGER PRIMARY KEY AUTOINCREMENT` 改为 `BIGSERIAL`，布尔字段改为 `BOOLEAN` 或继续使用整数兼容层。
3. 将当前同步 `db.prepare(...).run/get/all` 封装替换为异步 repository，启动时执行幂等 migration；不要把 Postgres 连接池放入请求函数内部重复创建。
4. 迁移完成后设置 `SUSHI_DB_PERSISTENCE=external`，并用 `/api/health` 确认 `db.durable: true` 后再开放注册。
5. 先导出旧 Render SQLite 数据，导入 Neon 后再切换 DNS/客户端；保留 Render 只读回滚窗口，不删除旧数据。

## 不能替代的做法

- 不能把 `app.db` 提交到 Git。
- 不能依赖 Vercel `/tmp`、函数内定时保存或单实例内存来保存会员数据。
- 不能在没有外部数据库的情况下仅凭 `SUSHI_DB_PERSISTENCE=external` 宣称数据已持久化；该变量只应在数据库适配器上线后启用。

