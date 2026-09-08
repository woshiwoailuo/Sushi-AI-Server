# Vercel 会员库持久化方案（Neon Postgres）

## 当前实现

当环境变量 `DATABASE_URL` 存在时，服务端使用 `@neondatabase/serverless` 连接 Neon/Postgres，并执行幂等 migration，创建/补齐表：

- `users`
- `gen_logs`
- `audit_logs`
- `email_codes`
- `app_releases`

主键使用 `BIGSERIAL`；`banned` / `email_verified` / `force_update` 继续用整数 `0/1`，与现有 SQLite 查询兼容。

未设置 `DATABASE_URL` 时，行为不变：本地/Render 继续走 `better-sqlite3` 或 `sql.js` 磁盘库。

## `durable` 语义（重要）

`GET /api/health` 的 `db.durable`：

| 场景 | durable | provider |
|------|---------|----------|
| 已设置 `DATABASE_URL` 且实际进入 Postgres 模式 | `true` | `postgres` |
| Vercel 且无 `DATABASE_URL`（/tmp SQLite） | `false` | `vercel-tmp` |
| 本地/Render SQLite 磁盘 | `true` | `local-disk` |

**仅设置 `SUSHI_DB_PERSISTENCE=external` 不会让 `durable` 变成 true。**  
该标志只是运维备注；若在未启用 Postgres 时设置，健康检查会带上 `persistence_flag_ignored: true`。

## Vercel + Neon 配置步骤

1. 在 [Neon](https://neon.tech) 创建项目，复制连接串（建议用 pooled / serverless 连接串，带 `sslmode=require`）。
2. 在 Vercel 项目 → Settings → Environment Variables → Production（以及需要的 Preview）添加：
   - `DATABASE_URL` = Neon 连接串
   - （可选）`SUSHI_DB_PERSISTENCE` = `external`（仅作备注，须在 `DATABASE_URL` 生效后设置）
   - 确认已有：`JWT_SECRET`、`ADMIN_EMAIL`、`ADMIN_PASSWORD`、SMTP 相关变量
3. 重新部署 Vercel（改环境变量后必须 Redeploy）。
4. 验证：
   ```bash
   curl -sS https://YOUR_DOMAIN/api/health | jq .db
   ```
   期望类似：
   ```json
   {
     "durable": true,
     "mode": "postgres",
     "provider": "postgres",
     "external_flag": true,
     "persistence_flag_ignored": false
   }
   ```
5. 再做一次注册/登录冒烟；确认重启/冷启动后账号仍在。
6. 数据迁移（如有旧 Render SQLite）：先导出旧库用户数据，导入 Neon 后再切换客户端流量；保留 Render 只读回滚窗口，**不要删除旧数据**。

## 本地开发

```bash
# 默认：无 DATABASE_URL → SQLite（data/app.db）
npm start

# 可选：连 Neon 做联调
export DATABASE_URL='postgresql://...'
npm start
```

测试不需要 Postgres：`npm test` 在无 `DATABASE_URL` 时走 SQLite，并对 adapter 做单元测试。

## 不能替代的做法

- 不能把 `app.db` / `.env` / 密钥提交到 Git。
- 不能依赖 Vercel `/tmp`、函数内定时保存或单实例内存保存会员数据。
- 不能在没有外部数据库的情况下仅凭 `SUSHI_DB_PERSISTENCE=external` 宣称数据已持久化。
