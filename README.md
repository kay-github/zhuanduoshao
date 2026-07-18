# 赚多少

面向中国 A 股持仓用户的收益推演工具。当前固定支持：

- `300502` 新易盛
- `300308` 中际旭创

用户可以录入持仓数量、成本价和持仓基准日，查看当前市值与收益，并按目标总市值推演未来股价、持仓市值和收益。已实施的现金分红、送股和转增会按照持仓基准日自动计入。

## 功能

- 展示最新价、涨跌幅、总市值和行情更新时间
- A 股交易时段内每 30 秒自动刷新行情，并显示交易时段状态
- 保存每个账号在两只股票上的独立持仓
- 未登录时将持仓草稿保存在当前浏览器；登录后合并同步，不会覆盖未保存的本地录入
- 自动应用基准日之后、当前日期之前已实施的分红送转
- 现金分红按所选持股期限档位扣减红利税（超 1 年免税、1 个月-1 年 10%、不足 1 个月 20%）
- 使用预设目标总市值或自定义目标进行收益情景推演；自定义目标支持按市值（万亿元）或按股价（元）输入
- 反向推演：输入目标总收益（万元），反推所需股价、距离现价涨幅和对应总市值
- 行情与公司行动接口异常时优先使用最近成功快照
- 移动端优先，同时适配桌面浏览器

推演使用总市值口径。自定义目标在界面中以“万亿元”或“元/股”输入，内部计算统一换算为“亿元”。预测只使用已经实施的公司行动，不假设参与配股，也不预测尚未公告的未来分红送转。所有数据与推演结果仅供估算参考，不构成投资建议。

## 技术栈

- 前端：Vue 3、TypeScript、Vite
- API：Vercel Functions
- 数据库：PostgreSQL、Drizzle ORM
- 认证：用户名与密码、bcryptjs、HttpOnly JWT Cookie
- 行情源：东方财富、腾讯、新浪公开接口
- 公司行动源：Tushare Pro（可选）和东方财富公开接口

## 本地启动

要求 Node.js `20.19+` 或 `22.12+`，以及可访问的 PostgreSQL 数据库。

```bash
npm install
copy .env.example .env.local
```

编辑 `.env.local` 后初始化数据库：

```bash
npm run db:push -- --force
```

完整功能需要通过 Vercel CLI 启动，因为普通 Vite 开发服务器不会运行 `/api/*` Functions：

```bash
npx vercel dev
```

如果只需查看不依赖 API 的前端布局，可以运行：

```bash
npm run dev
```

已链接 Vercel 项目时，也可以先拉取远端环境变量：

```bash
npx vercel env pull .env.local
```

## 环境变量

| 变量 | 必填 | 用途 |
| --- | --- | --- |
| `POSTGRES_URL` | 是 | PostgreSQL 连接字符串；也兼容 Vercel 集成生成的 `*_POSTGRES_URL` / `*_DATABASE_URL` |
| `AUTH_SECRET` | 是 | 签发账号会话的高强度随机密钥 |
| `TUSHARE_TOKEN` | 否 | 配置后优先使用 Tushare Pro 获取分红送转；留空时使用东方财富 |

请勿提交真实密钥或包含凭据的连接字符串。

## 验证

提交前至少执行：

```bash
npm run check
git diff --check
```

修改行情或公司行动适配器后，还应分别执行实时冒烟检查：

```bash
npx tsx -e "import { listQuotes } from './lib/server/quote-service.ts'; listQuotes().then(console.log)"
npx tsx -e "import { listDividends } from './lib/server/dividend-service.ts'; listDividends().then(console.log)"
```

涉及页面布局时，应额外检查约 `390px` 宽视口，并确认页面没有横向溢出。涉及认证、数据库或持仓接口时，应通过 `vercel dev` 或已部署环境验证注册、登录、保存、刷新恢复和退出流程。

## 部署

项目按 Vercel 前端与 Functions 同仓部署设计：

1. 在 Vercel 项目中配置 `POSTGRES_URL`、`AUTH_SECRET`，按需配置 `TUSHARE_TOKEN`。
2. 使用生产数据库环境变量执行 `npm run db:push -- --force`，确保数据库结构与代码一致。
3. 执行 `npx vercel --prod`，或由已连接的 Git 分支触发生产部署。
4. 部署后检查 `/api/quotes`、`/api/dividends`、`/api/auth/me`，并完成一次持仓保存与恢复。

`.vercel/` 是本机项目链接信息，已被忽略，不应提交到仓库。

## 数据源与限制

- 免费公开行情和公司行动接口不提供交易所级 SLA，字段和可用性可能变化。
- 行情服务按股票合并多个供应商结果；实时源失败时使用数据库中的最近成功快照，最后才使用内置回退值。
- 公司行动优先使用已配置的 Tushare Pro，否则使用东方财富；源异常时使用最近快照，最后按无公司行动记录处理。
- 页面会显示当前数据状态。缓存或内置回退适合估算，不应视为交易依据。
- 推演结果未计入税费、交易费用、未来增减仓以及尚未实施的公司行动。

## 目录

```text
api/                 Vercel Functions
lib/server/          数据库、认证、行情和公司行动服务
shared/              前后端共享的股票定义与类型
src/components/      页面展示组件
src/lib/             持仓与情景推演的纯计算逻辑
src/utils/           前端通用格式化工具
drizzle/             数据库迁移记录
```

产品规则和实现交接分别记录在 `AGENTS.md` 与 `HANDOFF.md`。
