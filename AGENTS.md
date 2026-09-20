# Xuye 开发约束

先读 docs/README.md、PRODUCT.md、PRODUCT-SPEC.md、TECHNICAL_DESIGN.md、DESIGN.md。以 v0.11 本地优先、同步可选、单一 Web 页面为依据，不采用旧云端主存储或独立 RN 页面方案。

当前不是完整应用。prototype/ 已有独立 Python 本地宿主和最小 Web 页面，提供单文件 Markdown 保存与恢复；不是上游完整编辑器或目标原生容器。运行方式见根 README。p0/pinned 是固定源码及明确标记的函数片段，p0/candidates 是候选，不得当作已集成实现。历史日志不是本次测试通过记录。上游目标读取 p0/upstream-target.json，取得完整 checkout 后记录真实 commit。

下一步先在获准的真实浏览器验证现有原型，再把已验证的读写边界接入完整上游页面或容器。管理员拒绝的访问不绕过；HTTP 测试不等于页面通过。保留可用页面与编辑器的目标不变，不把临时 textarea/Python 宿主包装为最终选型。不要以无限扩大上游审查代替产品开发。

不接真实知识库、不硬编码凭据、不公开项目；远端部署、可见性修改和破坏性操作需要明确授权。不要 force-push 或覆盖别人修改。统一写入口、版本条件、准确回执和失败保护仍须保留。

仅在真实完成执行后写通过；测试替身、函数测试、浏览器、真机、模型效果分别记录。没有证据时保留待验证，不编造实现状态。产品规则仅由 docs/PRODUCT-SPEC.md 维护，不新增平行 review-final 或 PRD。
