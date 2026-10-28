# SW跨平台字节独立诊断

独立复核者只读检查9a35候选、实际安装的VitePWA源码和GitHub Verify local release run `40674309398` / job `122768703051` 原日志。该job构建完成后只报 `Current bundle differs: sw.js`，没有index.html差异；上传步骤因test-results不存在而没有产物，不能声称取得Linux实际sw.js。以下为本机只读复现及其明确边界，未修改产品、重建候选或干扰4235大矩阵。

## 根因与穷举

`apps/web/vite.config.ts` 的 `includeAssets` 包含 `icons/*.svg`。实际 `vite-plugin-pwa/dist/index.js` 的 `buildManifestEntry` 直接流式读取public文件原字节并计算MD5，再加入additionalManifestEntries；不会规范文本换行。现有规则只将Vite入口index.html固定LF，没有将这两个SVG固定LF。

独立提取9a35 Git blob内sw.js的全部106项预缓存清单，其中94项使用内容哈希文件名且revision=null，12项有revision。将12项逐条对比同提交release/web文件原字节MD5，恰有以下两项不符，其余10项一致：

|输入|Windows当前工作树|9a35 Git blob / LF|9a35提交SW中的revision|
|---|---|---|---|
|icons/keepany.svg|403字节，MD5 `49907fc0aa39f284034857fa8d097e93`|397字节，MD5 `505c6971e702d10a5c8e6c544290c13f`|`49907fc0aa39f284034857fa8d097e93`|
|icons/stackperch.svg|577字节，MD5 `1a9635d5b7e79cef44f25abc300577bb`|571字节，MD5 `3041cea5406dc3b8c256fcfebcbaaa37`|`1a9635d5b7e79cef44f25abc300577bb`|

两份工作树文件均为CRLF，Git blob为LF。独立将工作树仅在内存中CRLF→LF后，MD5准确等于Git blob。另提取实际安装插件的原始buildManifestEntry函数到VM，仅用Readable.from替代文件输入流：输入真实CRLF与真实Git LF字节，原函数分别输出上表四个revision。没有伪造hash算法，没有写临时SVG或重建候选。

因此，9a35提交SW记录的是Windows CRLF输入的revision；Linux检出的SVG及release/web SVG是LF，文件本体可逐字节相等，但Linux重新生成SW会带LF输入revision。这个差异足以解释仅sw.js失败，本地工作树构建与本地交付目录同为CRLF时可以通过。没有证据要求放宽门禁、忽略sw.js或改预缓存规则。未取得Linux构建文件，不宣称已对其整份SW做SHA或顺序比较。

## 只读复现命令

在仓库根PowerShell执行，全部输入来自git show/read，零文件写入：

```powershell
@'
const cp=require('node:child_process'),crypto=require('node:crypto');
const git=p=>cp.execFileSync('git',['show','9a35e4c5:release/web/'+p],{maxBuffer:10000000});
const sw=git('sw.js').toString();
const entries=[...sw.matchAll(/\{url:"([^"]+)",revision:(?:"([a-f0-9]+)"|(null))\}/g)]
  .map(x=>({url:x[1],revision:x[2]??null}));
const checked=entries.filter(e=>e.revision).map(e=>({...e,
  gitMD5:crypto.createHash('md5').update(git(e.url)).digest('hex')}));
console.log(JSON.stringify({entryCount:entries.length,revisioned:checked.length,
  differences:checked.filter(e=>e.gitMD5!==e.revision)},null,2));
'@ | node -
```

## 窄修复与验证建议

将源输入 `apps/web/public/icons/*.svg` 固定 `text eol=lf`，并实际将工作树两个SVG规范为LF；仅新增属性但不重写已有CRLF工作树还不足以改变本轮构建输入。随后由主控正常构建、同步当前交付文件并保持历史保留资源原Git blob，不手改SW字符串。保持verify-local-release逐字节门禁原样。

验证分层：先检查Git/index/worktree SVG均LF、12个revision与实际交付文件MD5一致；再从同一提交在Windows和Linux各正常构建，运行原严格门禁，比较sw.js以及完整当前117文件字节。本机或隔离函数通过只证明输入归一复现；云Linux正式job成功及新候选实际消费记录仍待主控回读，不预先宣称门禁闭环。
