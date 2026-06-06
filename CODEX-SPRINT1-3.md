# Codex 交接报告 — OpenNum Sprint 1 安全 + Sprint 3 产品

**背景：** opennum.org 是基于 Bitcoin Ordinals 的身份协议网站。用户持有 inscription #X → 注册为 OpenNum #X → 得到一个 profile 页面（类似 Linktree）。注册后端用 Supabase PostgreSQL + Vercel Serverless，BIP322 签名验证，inscription 所有权通过 ordinals.com 软验证。

**代码仓库：** 当前目录（Vercel 部署，每次 push main 自动上线）
**Sprint 2 前端部分已完成**（commit `688d94a`），本文件只涉及 Sprint 1 安全 + Sprint 3 产品。

---

## Sprint 0 — 产品规则补丁（必须最先做）

### 任务 0：一钱包只能有一个 OpenNum

**产品决策（已由 Vince 确认）：** 一个钱包 = 一个 OpenNum，严格一对一。
卖出 inscription → 旧注册自动变 dormant → 新钱包来 claim。
一个钱包不能同时持有多个 active OpenNum。

**文件：** `api/register.js`

在写入数据库之前，插入以下检查（放在 inscription_num 冲突检查之后，INSERT 之前）：

```js
// Enforce one-wallet-one-OpenNum rule
const { data: walletConflict } = await supabase
  .from('registrations')
  .select('inscription_num')
  .eq('wallet_address', wallet)
  .eq('status', 'active')
  .maybeSingle();

if (walletConflict) {
  return res.status(409).json({
    error: `This wallet already owns OpenNum #${walletConflict.inscription_num}. Transfer that inscription before registering a new number.`,
    existing_num: walletConflict.inscription_num
  });
}
```

**transfer（inscription 转移）场景也要检查：** 当 ordinals.com 确认新钱包是当前链上 owner，允许 UPDATE 转移注册记录时，同样要检查新钱包是否已有 active 注册：

```js
// Before updating existing registration to new wallet:
const { data: newWalletConflict } = await supabase
  .from('registrations')
  .select('inscription_num')
  .eq('wallet_address', wallet)  // new owner's wallet
  .eq('status', 'active')
  .neq('inscription_num', inscription_num)  // exclude the current one being transferred
  .maybeSingle();

if (newWalletConflict) {
  return res.status(409).json({
    error: `The receiving wallet already owns OpenNum #${newWalletConflict.inscription_num}. It must release that number before claiming this one.`,
    existing_num: newWalletConflict.inscription_num
  });
}
```

---

## Sprint 1 — 安全修复（优先级 P0/P1）

### 任务 1：加 HTTP 安全响应头

**文件：** `vercel.json`

在现有 JSON 的顶层，`routes` / `rewrites` 之前加入：

```json
"headers": [
  {
    "source": "/(.*)",
    "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      {
        "key": "Content-Security-Policy",
        "value": "default-src 'self'; script-src 'self' 'unsafe-inline'; img-src * data: blob:; connect-src *; style-src 'self' 'unsafe-inline'; font-src 'self' data:;"
      }
    ]
  }
],
```

注意：`img-src *` 是必须的，inscription 图片来自 ordinals.com 和 Satflow 等外部域名。

---

### 任务 2：CORS 限制为 opennum.org

**文件：** `api/register.js`、`api/update.js`、`api/guestbook.js` 以及其他 API 文件中所有 `Access-Control-Allow-Origin: *`

当前写法：
```js
res.setHeader('Access-Control-Allow-Origin', '*');
```

改为：
```js
const allowedOrigin = process.env.NODE_ENV === 'production' ? 'https://opennum.org' : '*';
res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
```

---

### 任务 3：速率限制 Middleware

**新建文件：** `middleware.js`（项目根目录）

```js
import { NextResponse } from 'next/server';

const RATE_LIMITS = {
  '/api/register':  { max: 10, windowMs: 60 * 60 * 1000 },
  '/api/update':    { max: 30, windowMs: 60 * 60 * 1000 },
  '/api/guestbook': { max: 30, windowMs: 60 * 60 * 1000 },
};

const store = new Map();

export function middleware(req) {
  const path = req.nextUrl.pathname;
  const limit = RATE_LIMITS[path];
  if (!limit || req.method === 'GET') return NextResponse.next();

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  const key = `${ip}:${path}`;
  const now = Date.now();
  const entry = store.get(key) || { count: 0, reset: now + limit.windowMs };

  if (now > entry.reset) { entry.count = 0; entry.reset = now + limit.windowMs; }
  entry.count++;
  store.set(key, entry);

  if (entry.count > limit.max) {
    return new NextResponse(JSON.stringify({ error: 'Too many requests. Try again later.' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(Math.ceil((entry.reset - now) / 1000))
      }
    });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/register', '/api/update', '/api/guestbook']
};
```

**注意：** 如果项目不用 Next.js，改用 Vercel Edge Runtime 的原生方式，或用 `@vercel/edge` package。查看当前 `package.json` 决定方案。

---

### 任务 4：服务端输入净化

**文件：** `api/register.js`、`api/update.js`

在文件顶部加净化工具函数：

```js
function sanitizeText(val, maxLen = 200) {
  if (!val) return null;
  return String(val).replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
}

function sanitizeUrl(val) {
  if (!val) return null;
  try {
    const u = new URL(val);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    return u.toString().slice(0, 500);
  } catch (_) { return null; }
}
```

写入数据库前，对以下字段应用净化：

| 字段 | 净化方式 |
|------|----------|
| `display_name` | `sanitizeText(display_name, 48)` |
| `bio` | `sanitizeText(bio, 200)` |
| `ask_note` | `sanitizeText(ask_note, 240)` |
| `links.x` / `.instagram` / `.telegram` / `.website` | 每个都过 `sanitizeUrl()` |
| `satflow_url` | `sanitizeUrl()` |

---

### 任务 5：guestbook parent_id 后端验证

**文件：** `api/guestbook.js`（POST 处理段）

在插入留言前，如果 `parent_id` 不为空，验证它属于同一个 `inscription_num`：

```js
if (parent_id) {
  const { data: parentMsg } = await supabase
    .from('guestbook')
    .select('id, inscription_num')
    .eq('id', parent_id)
    .maybeSingle();
  if (!parentMsg || parentMsg.inscription_num !== inscription_num) {
    return res.status(400).json({ error: 'Invalid reply target.' });
  }
}
```

---

## Sprint 3 — 产品增强（优先级 P2/P3）

### 任务 6："My Numbers" 仪表盘

**新建页面：** `public/dashboard.html`

功能：用户连接 Unisat 钱包后，页面列出该钱包下所有已注册的 OpenNum。

页面逻辑：
1. 页面加载时调用 `window.unisat.getAccounts()` 获取当前钱包地址
2. 请求 GET `/api/wallet-numbers?wallet=<addr>`
3. 展示号码列表，每条显示：inscription 缩略图 + 大号码数字 + 状态（active/dormant）+ 按钮（View / Edit / Satflow）

**新建 API：** `api/wallet-numbers.js`（GET `/api/wallet-numbers?wallet=xxx`）

```js
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', 'https://opennum.org');
  res.setHeader('Cache-Control', 'no-store');

  const { wallet } = req.query;
  if (!wallet) return res.status(400).json({ error: 'Missing wallet parameter' });

  const { data, error } = await supabase
    .from('registrations')
    .select('inscription_num, inscription_id, inscription_txid, status, display_name, registered_at')
    .eq('wallet_address', wallet)
    .order('inscription_num', { ascending: true });

  if (error) return res.status(500).json({ error: 'Database error' });
  return res.status(200).json({ wallet, numbers: data || [] });
};
```

**在 vercel.json 加路由：**
```json
{ "src": "/dashboard", "dest": "/public/dashboard.html" },
{ "src": "/api/wallet-numbers", "dest": "/api/wallet-numbers.js" }
```

---

### 任务 7：动态 OG 图片生成

**目标：** 分享任意 `/n/xxx` 到 Twitter/Discord 时，展示该号码的 inscription 图片，而非通用 OpenNum logo。

**新建 API：** `api/og.js`（GET `/api/og?num=xxx`）

使用 `@vercel/og` 生成 1200×630 PNG：

```js
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const num = parseInt(searchParams.get('num') || '0', 10);

  // Fetch profile data
  let displayName = `#${num}`;
  let imageUrl = null;
  try {
    const r = await fetch(`https://opennum.org/api/profile?num=${num}`, {
      signal: AbortSignal.timeout(4000)
    });
    if (r.ok) {
      const d = await r.json();
      if (d.display_name) displayName = `${d.display_name} (#${num})`;
      if (d.metadata?.content_type?.startsWith('image/') && d.metadata?.content_url) {
        imageUrl = d.metadata.content_url;
      }
    }
  } catch (_) {}

  return new ImageResponse(
    <div style={{ display: 'flex', width: '100%', height: '100%', background: '#102033', alignItems: 'center', padding: '60px' }}>
      {imageUrl && (
        <img src={imageUrl} style={{ width: 480, height: 480, objectFit: 'cover', borderRadius: 24, marginRight: 60 }} />
      )}
      <div style={{ display: 'flex', flexDirection: 'column', color: 'white' }}>
        <div style={{ fontSize: 96, fontWeight: 900, letterSpacing: '-4px', color: '#f7931a', lineHeight: 1 }}>
          #{num}
        </div>
        <div style={{ fontSize: 36, marginTop: 16, color: 'white', fontWeight: 700 }}>
          {displayName}
        </div>
        <div style={{ fontSize: 24, marginTop: 12, color: '#8ab4c0' }}>
          opennum.org
        </div>
      </div>
    </div>,
    { width: 1200, height: 630 }
  );
}
```

**安装依赖：** `npm install @vercel/og`

**在 vercel.json 加路由：**
```json
{ "src": "/api/og", "dest": "/api/og.js" }
```

**profile.html 对应改动**（由 Claude 完成，Codex 不需要改）：
profile.html 的 `renderProfile()` 已经动态更新 og:image。Codex 只需确保 `/api/og?num=xxx` 端点正常工作即可。

---

## 验证清单

### Sprint 1 完成后

```bash
# S1: 安全头
curl -I https://opennum.org | grep -E "X-Frame|X-Content|Referrer"

# S3: CORS
curl -X POST https://opennum.org/api/register \
  -H "Origin: https://evil.com" \
  -H "Content-Type: application/json" \
  -d '{}' -v 2>&1 | grep "Access-Control"
# 生产环境应看不到 Access-Control-Allow-Origin: https://evil.com

# S4: 速率限制（连续 POST 11 次）
for i in $(seq 1 11); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST https://opennum.org/api/register \
    -H "Content-Type: application/json" \
    -d '{"test":true}'
done
# 第 11 次应返回 429

# S5: XSS 净化
# 在 register 流程里把 display_name 填 <script>alert(1)</script>
# 注册成功后访问 profile 页，title 应显示纯文本，不执行脚本
```

### Sprint 3 完成后

- [ ] 访问 `/dashboard` → 连接 Unisat → 显示该钱包所有已注册号码
- [ ] 访问 `https://cards.twitter.com/validator` 输入 `https://opennum.org/n/<你的号码>` → 展示号码专属图片（inscription 内容图或 OpenNum 品牌图），而非通用 logo

---

## 已完成（Codex 不需要再做）

| 内容 | Commit |
|------|--------|
| Sprint 2 前端：OnlyFans 移除、nav 统一、首页极简、profile 动态 OG meta、favicon、API 超时 | `688d94a` |
| Logo SVG 集成、CSS hamburger 断点修复 | `2dd4d86` |
| Linktree 重设计：social links、Edit Profile、api/update.js | `0e8be7a` |
