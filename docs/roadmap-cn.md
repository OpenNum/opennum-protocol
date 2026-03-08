# OpenNum 协议 — 产品路线图

> **最后更新：** 2026年3月
> 本文档描述 OpenNum 协议从当前阶段到完整生态体系的发展路径。

---

## 项目愿景

OpenNum 的使命是将比特币 Ordinals 铭文编号发展为通用的身份层——简单、可验证、无需智能合约。铭文编号是比特币区块链上永久、全局唯一的整数。OpenNum 让这个编号成为可解析、可分享的身份标识。

**长期目标：** 铭文编号不仅代表资产，更代表身份——适用于个人、钱包、创作者与 AI Agent。

---

## 第一阶段 — 基础建设 ✅ 已基本完成
**时间节点：2026 年 Q1**

本阶段完成协议规范、公开文档，并在主网发布三个真实身份示例。

### 协议与文档
- [x] 协议规范 v1.0 发布（`spec-v1.0.md`）
- [x] 双锚点设计 — 每次注册同时绑定 `inscription_number`（人类可读）与 `inscription_txid`（比特币共识原语），使 OpenNum 对 indexer 版本争议免疫
- [x] 四状态身份机器定义 — **Active 🟢 / Dormant ⚫ / Cooling 🟠 / Flagged 🔵**
- [x] 注册消息格式 v1.0（个人身份）— 对规范消息的 secp256k1 签名
- [x] 注册消息格式 v1.1（AI Agent 身份）— `agent_wallet` + `agent_role` + `agent_label` 字段，由持有者签名
- [x] Cursed Inscription 支持 — `#c-1234` 格式，覆盖约 472,043 枚早期铭文，作为一等公民对待
- [x] `.btc` 显示别名 — SNS 域名铭文自动读取为人类可读别名
- [x] 白皮书发布（英文 / 中文 / 韩文）
- [x] GitHub 仓库开放：`github.com/OpenNum/opennum-protocol`

### 网站与身份页面
- [x] `opennum.org` 在 Vercel 上线
- [x] 三个真实身份页面：`opennum.org/n/2025`、`/n/9164`、`/n/60585`
- [x] 身份页面包含：状态标签、关联钱包、铭文 ID、状态机生命周期、分享文案、Resolver 字段
- [x] `opennum.org/explore` — Explorer 页面，含统计数据、身份列表、卡片网格、搜索功能、Resolver API 预览

---

## 第二阶段 — Resolver 与注册
**时间节点：2026 年 Q2**

本阶段使 OpenNum 成为一个真正运行的协议网络——支持真实注册与真实解析。

### Resolver API
- [ ] `GET /api/v1/resolve/:number` → 返回钱包地址 / 状态 / 铭文信息
- [ ] `GET /api/v1/profile/:number` → 完整个人资料元数据
- [ ] `GET /api/v1/agents/:number` → 列出该编号下注册的所有 Agent 钱包
- [ ] 参考 Indexer 部署上线，根据比特币链状态验证注册记录
- [ ] Explorer 接入真实 API 数据（替换当前静态演示数据）

### 注册页面
- [ ] `opennum.org/register` — 用户通过比特币钱包对规范消息签名完成注册
- [ ] 钱包连接流程（兼容 Unisat、Xverse、OKX Wallet）
- [ ] 页面内生成签名并提交 `POST /api/v1/register`
- [ ] 注册确认 — 编号从未注册状态转为 Active

### 防垃圾与有效性
- [ ] Indexer 执行所有有效性规则（规范 §5）：铭文持有权验证、签名校验、时间戳新鲜度、唯一性约束
- [ ] Indexer 应用层速率限制

---

## 第三阶段 — 生态集成
**时间节点：2026 年 Q3**

本阶段将 OpenNum 身份引入现有比特币与 Ordinals 应用生态。

### 钱包集成
- [ ] 推动主流钱包（Unisat、Xverse、OKX Wallet、Magic Eden Wallet）原生展示 OpenNum 身份
- [ ] 钱包界面在比特币地址旁显示 `#2025` 身份标签

### Ordinals Explorer 集成
- [ ] 推动现有 Ordinals Explorer（Ordiscan、Ord.io、Magic Eden Ordinals）在铭文数据旁展示 OpenNum 身份
- [ ] 用户可直接从 Explorer 页面跳转至 `opennum.org/n/2025`

### NFT Marketplace 集成
- [ ] NFT 交易市场（Magic Eden、OKX NFT）在卖家和买家信息旁展示 OpenNum 身份
- [ ] 钱包地址背后有了经过验证的身份标识，增加 Ordinals 挂单的可信度

### 开发者 SDK（早期版本）
- [ ] 开源 JavaScript/TypeScript SDK：`npm install opennum-sdk`
- [ ] 提供 `resolve(number)` / `register(message, signature)` / `verify(message)` 接口
- [ ] 第三方开发者可将 OpenNum 身份集成到自己的应用中

---

## 第四阶段 — 身份扩展
**时间节点：2026 年 Q4**

本阶段深化协议能力，扩展 OpenNum 身份所能代表的范畴。

### OpenNum Profile（完整个人资料）
- [ ] Profile 元数据字段：头像、简介、链接、社交账号
- [ ] `opennum.org/n/2025` 成为完整的公开个人主页，而不仅是一条身份记录
- [ ] `GET /api/v1/profile/:number` 返回完整的结构化 Profile 数据

### AI Agent 身份（完整生态）
- [ ] v1.1 Agent 身份委托大规模部署：持有者可将铭文背书的身份分配给自主 AI Agent
- [ ] 任何应用均可验证 Agent 身份：`agent_did`、`capabilities`、持有者签名
- [ ] AI 框架集成的工具链与文档（MCP Server、Agent 平台等）

### 去中心化 Indexer 网络
- [ ] 任何人都可以运行符合规范的 OpenNum Indexer（规范 §9）
- [ ] 多 Indexer 一致性：确定性验证规则确保独立 Indexer 收敛到相同状态
- [ ] P2P Gossip 网络（v2.0）实现注册消息的无中心化传播

### 社区与开发者生态
- [ ] 开发者文档站 `opennum.org/docs`
- [ ] 开源社区 Indexer 实现
- [ ] 第三方集成的资助或赏金计划

---

## 第五阶段 — 规模化
**时间节点：2027 年及以后**

本阶段将 OpenNum 从比特币原生协议拓展为更广泛的身份基础设施。

- [ ] 移动端优先的注册与身份管理体验
- [ ] 多语言支持（英文 / 中文 / 日文 / 韩文 / 西班牙文等）
- [ ] OpenNum 作为登录原语 — "用铭文签名登录"，适用于 Web 应用
- [ ] 跨链身份桥接（通过 OpenNum 记录绑定以太坊、Solana 地址）
- [ ] 全球推广：钱包、交易市场、社交平台、DeFi 协议

---

## 技术里程碑总览

| 阶段 | 时间节点 | 核心交付物 | 状态 |
|------|----------|-----------|------|
| **第一阶段 — 基础建设** | 2026 Q1 | 协议规范 · 双锚点 · 状态机 · AI Agent v1.1 · Cursed Inscriptions · 网站 · 身份页面 · Explorer | ✅ 已基本完成 |
| **第二阶段 — Resolver 与注册** | 2026 Q2 | Resolver API · 注册页面 · 上线 Indexer | 🔲 进行中 |
| **第三阶段 — 生态集成** | 2026 Q3 | 钱包 / Explorer / 交易市场集成 · SDK | 🔲 规划中 |
| **第四阶段 — 身份扩展** | 2026 Q4 | 完整 Profile · AI Agent 生态 · 去中心化 Indexer 网络 | 🔲 规划中 |
| **第五阶段 — 规模化** | 2027+ | 移动端 · 多语言 · 跨链 · 全球 | 🔲 远期 |

---

## OpenNum 的差异化优势

| 特性 | OpenNum | ENS / Unstoppable Domains | Ordinals 域名服务 |
|------|---------|--------------------------|-----------------|
| 身份锚点 | 铭文编号（永久整数） | 域名字符串 | 域名字符串 |
| 需要智能合约 | ❌ 无 | ✅ 以太坊智能合约 | 不一 |
| 比特币原生 | ✅ | ❌ | ✅ |
| 防版本争议 | ✅ 双锚点设计 | 不适用 | ❌ |
| AI Agent 委托 | ✅ v1.1 | ❌ | ❌ |
| Cursed Inscription 支持 | ✅ 一等公民 | 不适用 | 不一 |

---

*OpenNum 协议路线图 · MIT License · [opennum.org](https://opennum.org) · [@OpenNumBTC](https://twitter.com/OpenNumBTC)*
