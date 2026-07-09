/* OpenNum language toggle (EN default / 中文).
   One dictionary for the whole site: exact text-node matches plus a few
   regexes for dynamic strings. Rendered content is covered by a
   MutationObserver, so pages don't need per-string markup. */
(function () {
  var LANG_KEY = 'on_lang';
  var lang = 'en';
  try { lang = localStorage.getItem(LANG_KEY) || 'en'; } catch (_) {}

  var MAP = {
    // ── nav / footer ──
    'Search': '搜索',
    'Register': '注册',
    'My OpenNum': '我的 OpenNum',
    'Market': '市场',
    'Whitepaper': '白皮书',
    'FAQ': '常见问题',
    'Terms': '条款',
    'Privacy': '隐私',
    'OpenNum is non-custodial. Ownership follows the inscription on Bitcoin.': 'OpenNum 非托管。所有权跟随比特币链上的铭文。',
    'OpenNum identity pages are public, non-custodial, and tied to inscription ownership.': 'OpenNum 身份页公开、非托管,与铭文所有权绑定。',
    'Buying an OpenNum means buying or receiving the underlying Ordinals inscription. Want a number that isn’t listed here? Find its current holder on ordinals.com and make the offer on Satflow or Magic Eden.': '购买 OpenNum 即购买或接收底层 Ordinals 铭文。想要没挂牌的号码?去 ordinals.com 找到当前持有人,在 Satflow 或 Magic Eden 出价。',
    'Membership is on-chain: hold an inscription from this collection and register it as your OpenNum.': '成员资格在链上:持有该 collection 的铭文并注册为你的 OpenNum 即可加入。',

    // ── home ──
    'Your inscription': '你的铭文编号',
    'number is your': '就是你的',
    'Bitcoin identity.': '比特币身份。',
    'Find a number, see who owns it, leave a signed message, or claim it as yours.': '查一个号码,看它属于谁,给持有人发签名私信,或者把它认领为你的身份。',
    'Enter inscription number': '输入铭文编号',
    'Buy / offer': '买 / 出价',
    'Sell': '出售',
    'Early inscriptions · 0–100': '早期铭文 · 0–100',
    'Early inscription': '早期铭文',
    'Ready': '就绪',
    'Looking up': '查询中',
    'Checking registry...': '查询注册表…',
    'Resolving OpenNum status.': '正在解析 OpenNum 状态。',
    'Unregistered': '未注册',
    'If you own the inscription, register or claim it.': '如果你持有这枚铭文,可以注册或认领它。',
    'Recently claimed numbers': '最近认领的号码',
    'Register a Number': '注册一个号码',
    'Open profile': '打开主页',
    'Claim': '认领',
    'Claim a number': '认领一个号码',
    'Make offer': '出价',
    'is the active owner': '是当前持有人',

    // ── profile ──
    'Loading OpenNum identity...': '正在加载 OpenNum 身份…',
    'This OpenNum has not been registered yet.': '这个 OpenNum 还没有被注册。',
    'This inscription exists on Bitcoin, but it has not been claimed as an OpenNum ID yet.': '这枚铭文存在于比特币链上,但还没有被认领为 OpenNum 身份。',
    'Register / Claim': '注册 / 认领',
    'View inscription': '查看铭文',
    'Active': '活跃',
    'Dormant': '休眠',
    'For sale': '出售中',
    'followers': '粉丝',
    'following': '关注中',
    'Follow': '关注',
    'Following': '已关注',
    'Watch': '盯住',
    'Watching': '盯住中',
    'Edit profile': '编辑资料',
    'Send BTC': '发送 BTC',
    'Message': '私信',
    'Make a private offer': '发私密报价',
    'Claim this OpenNum': '认领这个 OpenNum',
    'Showcase': '展示柜',
    'Numbers picked by the holder.': '持有人挑选展示的号码。',
    'No other members here yet.': '这里还没有其他成员。',
    'Message the holder': '给持有人发私信',
    'Private — only the holder of this number can read it.': '私密——只有这个号码的持有人能读到。',
    'Write to this OpenNum…': '写给这个 OpenNum…',
    '280 characters · signed by your number · private': '280 字以内 · 以你的编号签名 · 私密',
    'Sign & Send': '签名发送',
    'Ownership & inscription details': '所有权与铭文详情',
    'Number': '编号',
    'Active wallet': '活跃钱包',
    'Chain owner': '链上持有人',
    'Inscription ID': '铭文 ID',
    'Registered': '注册时间',
    'Status': '状态',
    'Open to offers': '接受报价',
    'This owner has marked the number open to offers.': '持有人已将此号码标记为接受报价。',
    'Buy on Satflow ↗': '在 Satflow 购买 ↗',
    'Recipient': '收款方',
    'sats amount': 'sats 数量',
    'Send with Unisat': '用 Unisat 发送',
    'Copy address': '复制地址',
    'Copy recipient address': '复制收款地址',
    'Open in wallet app': '在钱包 App 中打开',
    'On mobile, copy the address and paste it into your wallet app.': '手机端请复制地址,粘贴到你的钱包 App。',
    'OpenNum resolves this number to the current holder wallet. OpenNum never holds custody.': 'OpenNum 将此号码解析到当前持有人的钱包。OpenNum 从不托管资金。',
    'This inscription has moved on-chain. The previous OpenNum profile is historical until the current holder signs and claims it again.': '这枚铭文已在链上转手。在当前持有人签名认领之前,旧的 OpenNum 资料仅作历史记录。',
    'Messages are paused while this number is awaiting claim.': '此号码等待认领期间,私信暂停。',
    'Messages are paused because this number is dormant after an on-chain transfer.': '此号码因链上转手进入休眠,私信已暂停。',

    // ── profile edit panel ──
    'Edit OpenNum profile': '编辑 OpenNum 资料',
    'Display name': '显示名',
    'Bio': '简介',
    'Short bio...': '一句话简介…',
    'X / Twitter': 'X / 推特',
    '@yourhandle': '@你的用户名',
    'Showcase numbers': '展示柜号码',
    '(up to 5 inscriptions held in this wallet)': '(最多 5 个,必须是本钱包持有的铭文)',
    'e.g. 989, 1999, 7777': '例如 989, 1999, 7777',
    'Selling': '出售设置',
    'open to offers · note · Satflow link': '接受报价 · 说明 · Satflow 链接',
    'This number is open to offers': '此号码接受报价',
    'Listing headline': '挂牌标题',
    'e.g. Born in 1999? This is your number': '例如:1999 年出生?这就是你的号码',
    'Asking price': '要价',
    'e.g. 0.05 BTC — leave empty for open offers': '例如 0.05 BTC——留空表示接受任意报价',
    'The story': '号码的故事',
    'Why this number matters — its meaning, its history, who it’s perfect for.': '为什么这个号码有意义——它的寓意、来历、适合谁。',
    'Satflow URL': 'Satflow 链接',
    'Save profile': '保存资料',
    'Cancel': '取消',

    // ── offer panel ──
    'Send a private offer': '发送私密报价',
    'Only the current holder sees this, in their OpenNum inbox. OpenNum never holds funds — settle the trade on Satflow.': '只有当前持有人会在收件箱里看到。OpenNum 不托管资金——交易在 Satflow 完成。',
    'Your offer, e.g. 0.05 BTC': '你的报价,例如 0.05 BTC',
    'Message to the holder (optional)': '给持有人的留言(可选)',
    'Your Satflow listing/offer URL (optional)': '你的 Satflow 挂单/报价链接(可选)',
    'Sign & send offer': '签名发送报价',

    // ── market ──
    'Every number has a story.': '每个号码都有自己的故事。',
    'Holders list their numbers here — a birthday, a palindrome, a piece of early Bitcoin history — with the meaning in their own words. Make a private offer; the trade settles non-custodially on Satflow or Magic Eden.': '持有人在这里挂牌自己的号码——生日、回文、一段早期比特币历史——用自己的话写出寓意。你可以发私密报价;交易在 Satflow 或 Magic Eden 非托管完成。',
    'List yours': '挂牌你的号码',
    'Search 99, 7777, wallet, or display name...': '搜索 99、7777、钱包地址或显示名…',
    'All active': '全部活跃',
    'All patterns': '全部规律',
    'Birthday year': '生日年份',
    'Repeating digits': '豹子号',
    'Sequence': '顺子号',
    'Palindrome': '回文号',
    'Sub 10K': 'Sub 10K',
    'No match': '没有匹配',
    'No listings match this filter yet. Own a number that fits? List it from your profile.': '还没有符合该筛选的挂牌。你持有匹配的号码?去你的主页挂牌。',
    'Offers': '接受报价',
    'Profile': '主页',

    // ── collection page ──
    'Register yours': '注册你的号码',
    'Loading…': '加载中…',
    'Loading members': '加载成员中',
    'No members yet': '还没有成员',
    'No one from this collection has registered an OpenNum yet. Hold one? Be the first.': '这个 collection 还没有人注册 OpenNum。你持有一枚?来做第一个。',
    'Registered members will appear here.': '注册成员会显示在这里。',

    // ── /my dashboard ──
    'Watching': '盯住的号码',
    'Messages': '私信',
    'Offers received': '收到的报价',
    'Offers you sent': '发出的报价',
    'Activity': '动态',
    'View my profile →': '查看我的主页 →',
    'Edit profile & social links': '编辑资料',
    'Trade on Satflow ↗': '在 Satflow 交易 ↗',
    'View my watchlist': '查看盯住列表',
    'View messages': '查看私信',
    'View offers': '查看报价',
    'View sent offers': '查看发出的报价',
    'View activity': '查看动态',
    'No OpenNum yet': '还没有 OpenNum',
    'This wallet has no active OpenNum. Own an Ordinals inscription? Register it as your identity.': '这个钱包还没有活跃的 OpenNum。持有 Ordinals 铭文?把它注册为你的身份。',
    'New to Ordinals? Search for a number above and see if it’s available.': '刚接触 Ordinals?先搜一个号码看看它的状态。',
    'Selling your inscription will automatically release this OpenNum to the new holder.': '卖出铭文后,这个 OpenNum 会自动释放给新持有人。',
    'No messages yet. People can write to you from your profile page.': '还没有私信。别人可以在你的主页给你写私信。',
    'Not watching any numbers yet. Open any profile and tap “Watch”.': '还没盯住任何号码。打开任意主页点"盯住"。',
    'You haven’t sent any offers yet.': '你还没有发出过报价。',
    'Reply on their page': '去对方主页回复',
    'Hide': '隐藏',
    'Remove': '移除',
    'Retry': '重试',
    'Open': '进行中',
    'Declined': '已拒绝',
    'Archived': '已归档',
    'Reject': '拒绝',
    'Archive': '归档',

    // ── register ──
    'Bitcoin Identity': '比特币身份',
    'Connect Your Bitcoin Wallet': '连接你的比特币钱包',
    'Connect Unisat Wallet': '连接 Unisat 钱包',
    'Select Your Inscription': '选择你的铭文',
    'Sign & Register': '签名注册',
    'Sign with Unisat →': '用 Unisat 签名 →',
    '← Back': '← 返回',
    'Technical details': '技术细节',
    'Your Wallet': '你的钱包',
    'Cost': '费用',
    'Free — no on-chain transaction': '免费——无链上交易',
    'becomes your OpenNum identity': '将成为你的 OpenNum 身份',
    'is now your OpenNum identity': '现在是你的 OpenNum 身份了',
    'View My Profile →': '查看我的主页 →',
    'My OpenNum Dashboard': '我的 OpenNum 后台',
    'Disconnect': '断开连接',
    'Load more inscriptions…': '加载更多铭文…',
    '✓ Registered': '✓ 已注册',
    '↻ Claim — you hold it now': '↻ 可认领——它现在在你手里'
  };

  var REGEX = [
    [/^(\d[\d,]*) has no OpenNum ID yet$/, '$1 还没有 OpenNum 身份'],
    [/^Write to (\d+)…$/, '写给 $1…'],
    [/^(.+) on OpenNum$/, '$1 · OpenNum 圈子'],
    [/^(\d+) registered (identity|identities) in this circle\. Every membership is on-chain — hold one, register it, and you're in\.$/, '本圈子已有 $1 个注册身份。成员资格在链上——持有并注册,即刻加入。'],
    [/^(\d+) listed for sale · (\d+) active identities$/, '$1 个在售 · $2 个活跃身份'],
    [/^View (\d+)$/, '查看 $1'],
    [/^My OpenNum #(\d+)$/, '我的 OpenNum #$1'],
    [/^Selected: $/, '已选择: ']
  ];

  function zh(text) {
    var t = text.trim();
    if (!t) return null;
    if (MAP[t]) return MAP[t];
    for (var i = 0; i < REGEX.length; i++) {
      if (REGEX[i][0].test(t)) return t.replace(REGEX[i][0], REGEX[i][1]);
    }
    return null;
  }

  function translateNode(root) {
    if (lang !== 'zh' || !root) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode && n.parentNode.nodeName;
        return (p === 'SCRIPT' || p === 'STYLE') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    var node;
    while ((node = walker.nextNode())) {
      var out = zh(node.nodeValue);
      if (out !== null) {
        var lead = node.nodeValue.match(/^\s*/)[0];
        var tail = node.nodeValue.match(/\s*$/)[0];
        node.nodeValue = lead + out + tail;
      }
    }
    var inputs = (root.querySelectorAll ? root.querySelectorAll('input[placeholder], textarea[placeholder]') : []);
    for (var j = 0; j < inputs.length; j++) {
      var ph = zh(inputs[j].getAttribute('placeholder'));
      if (ph !== null) inputs[j].setAttribute('placeholder', ph);
    }
  }

  function addToggle() {
    var nav = document.getElementById('navLinks');
    if (!nav || document.getElementById('langToggle')) return;
    var a = document.createElement('a');
    a.id = 'langToggle';
    a.href = '#';
    a.textContent = lang === 'zh' ? 'EN' : '中文';
    a.addEventListener('click', function (e) {
      e.preventDefault();
      try { localStorage.setItem(LANG_KEY, lang === 'zh' ? 'en' : 'zh'); } catch (_) {}
      location.reload();
    });
    nav.appendChild(a);
  }

  function localizeLinks() {
    if (lang !== 'zh') return;
    var links = document.querySelectorAll('a[href="/whitepaper-en"]');
    for (var i = 0; i < links.length; i++) links[i].setAttribute('href', '/whitepaper-cn');
  }

  function boot() {
    addToggle();
    if (lang !== 'zh') return;
    document.documentElement.setAttribute('lang', 'zh');
    translateNode(document.body);
    localizeLinks();
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData') {
          var out = zh(m.target.nodeValue || '');
          if (out !== null) m.target.nodeValue = out;
        }
        for (var j = 0; j < (m.addedNodes || []).length; j++) {
          var n = m.addedNodes[j];
          if (n.nodeType === 1) translateNode(n);
          else if (n.nodeType === 3) {
            var o = zh(n.nodeValue || '');
            if (o !== null) n.nodeValue = o;
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
