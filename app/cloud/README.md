# 云端文件服务（开发阶段）

已有邀请兑换、登录会话、每账号独立知识库、跨设备版本检查与知识库导出。身份验证使用 Supabase Auth 的邮箱/密码登录，应用不存密码；服务端使用 PostgreSQL 保存邀请、会话摘要与账号/库归属。**云端 AI 与 GitHub 同步接口禁用，不能把此文件服务当已具备 Agent 隔离的产品。**

当前入口只支持身份提供商中已经验证邮箱的账号；操作方需先在自己的 Supabase 项目完成账号开通/邮箱验证。应用没有公共注册、密码重置、邮箱投递或 OAuth 回调。不会替用户发送邀请邮件。管理员生成的 Corilo 邀请码是另一层应用准入，只能由绑定邮箱兑换，默认 72 小时有效。后续自助账号流程仍须联调完善。

## 启动

需要 Node 24、Git、PostgreSQL 和 Supabase Auth 项目。把下列环境变量放在部署环境的安全配置中，不能提交或贴到聊天：

| 变量 | 用途 |
|---|---|
| `DATABASE_URL` | 应用专用 PostgreSQL 连接串；远程连接使用验证证书的 TLS |
| `SUPABASE_URL` | 项目 HTTPS origin |
| `SUPABASE_PUBLISHABLE_KEY` | Supabase publishable/anon key；不用 service-role key |
| `CORILO_PUBLIC_ORIGIN` | 完整 HTTPS 公网 origin，不能含路径 |
| `CORILO_CLOUD_DATA` | 专用持久数据目录，知识库不放应用代码仓库内 |
| `PORT` | 网关 loopback 端口，默认 3000 |

```bash
npm ci --ignore-scripts
# 使用独立数据库/角色；只显式初始化，不在每次启动自动改 schema。
npm run start:cloud -- --migrate
# 输出一个敏感的邀请码，操作者自行安全转交，不记录到日志或 Git。
npm run start:cloud -- --invite recipient@example.com
npm run start:cloud
```

身份配置缺失时启动失败，不回退到测试身份或匿名用户。数据表位于 `corilo_private` schema，不应暴露到 Supabase 浏览器 Data API；控制数据库凭据只给服务端。邀请码和应用会话仅存 SHA-256 摘要。

网关只监听 `127.0.0.1`，由同机 HTTPS 反向代理接入，代理必须保留正确 Host，且不得缓存页面、API、登录响应和下载。网关严格检查配置的 Host、Origin，以及写请求来源；不相信客户端传来的用户 ID、内部宿主 token 或 X-Forwarded-For。生产会话使用 `__Host-`、HttpOnly、Secure、SameSite=Strict cookie，24 小时有效；退出撤销当前会话，停用账号在下一请求生效。HTTP 仅允许 `127.0.0.1` 开发用途，未增加生产不安全 cookie 模式。

每个账号创建的知识库由服务端生成 UUID 并在数据库中绑定归属，正文与状态分目录保存。底层复用本机文件宿主，网关内部注入宿主凭证，不把凭证交给浏览器。文件宿主在云端模式不实例化 Pi，不读取运营者的 Pi 密钥或调用 Git 同步。每实例当前最多保留 20 个文件宿主，直到正常退出；满额返回明确错误。不是多节点或自动扩容实现。

## 检查

```bash
# 指向可丢弃的测试数据库；真实密码从环境注入。
# 先单独配置 CORILO_TEST_DATABASE_URL，绝不要从生产 DATABASE_URL 直接复用。
npm run test:cloud
```

不要将上例指向生产数据库：测试会创建虚构账号和邀请。测试需要 Python Playwright/Chromium；安装方式见根 README。检查使用真实 PostgreSQL、真实文件宿主、真实 Chromium 登录/原话保存/下载/退出与第二设备刷新；只有身份提供商使用合成响应，另测试 Supabase adapter 的响应校验。测试替身只在测试文件中注入，正式 CLI 不提供绕过身份开关。

CI 使用独立 PostgreSQL 容器，见 `.github/workflows/cloud.yml`。工作流存在不等于远端已通过。

## 限制与下一步

- 未联调真实 Supabase、未上线 HTTPS、未实测 Android/iPhone 浏览器；390px Chromium 不是手机验收。
- 账号预开通、邀请撤销/禁用目前由操作方管理数据库；没有管理控制台，密码恢复依赖身份提供商。
- 单机文件服务；应用会话持久化，但正常重启以外的强杀仍可能留下旧宿主锁，不能盲目清除。任务执行隔离和恢复另行实现。
- 自动登录重定向只在未登录首页触发；编辑中会话过期保留草稿并显示重新登录错误，不强制丢弃页面。
- 已有文件写入 ETag 保护；删除/移动的跨设备版本条件、完善导入、账号删除、独立备份和历史恢复 UI 尚待补齐。完整 N01–N19 仍未验收。
- 登录限流每连接来源地址 5 分钟 30 次，在同机代理后可能共享额度；需在实际入口配置受信任的客户端限流。不要直接信任任意 forwarded headers。
- 现有 Files.md 适配依赖 inline scripts，公网安全审查及 CSP 收紧仍需完成。当前结果不代表可直接公开邀请上线。
