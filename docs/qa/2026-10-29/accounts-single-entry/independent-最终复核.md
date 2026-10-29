# 单一新增入口：最终联合独立复核

2026-10-29。两位非产品实现者 `independent_single_entry`、`independent_aux_visual` 实际复核，主控只汇总原始结果；主控本人UI体验另列。产品为 `fa357da7c1c6bcd2618693d6e813c48500dacec9`，clean ZIP SHA256 `e0e38d7aba3dcd7d1229094a5e48bbae7f72983117d3e04830f65839ba0867f2`。仅验冻结合同 SE01–SE16 和选定相邻回归。

**本轮明确范围通过。** 原20项和相邻8项均由第一位独立复核者在同一包执行，全部首轮通过、单worker、零重试；中英真实分类补验也通过。第一位只读审查最后输入错误ref/事件边界：预写入Zod/URL错误可随输入清理，partial/锁定等操作提示保留，改动限于合并表单。源码与最终包的执行证据分列。

主72图全部实际打开且明确通过，见 [主图索引](independent-visual-reviewed-fa357d.json)。第一位实际打开54张并最终明确“54张均通过，未发现新缺陷”；第二位实际确认30张主图，含12张额外交叉确认。两份观察并集72，逐文件标明观察者，不冒称同一人看完。第一位大上下文收尾缓慢时保留已读清单并交接剩余图；第二位先补判定，第一位明确结论随后返回，原件均保留。

第二位另逐张检查具名相邻34、分类4、主控12及3份JSON，补查同轮稳定busy帧4。原始索引 [独立辅助图审](independent-aux-visual-fa357d.json) 共84文件：83通过、1张原过渡帧证据不足但已有同轮正向帧闭环。主控照片只是独立审证，操作者仍为主控。主控图02当前滚动不显示日期控件，不以该单图证明日期拒绝；日期判定结合真实UI操作、原生validity、零新增及纠正后的保存回读。

## 原过渡帧保留与补证

具名 `zh-CN-1280-workspace-samples-busy.png` 对应同轮 `finally-frames/004.png`，比DOM禁用事件晚约14.8ms，像素仍接近启用，保留 `evidence-insufficient/transitional`。没有将其改写为灰禁用通过。

实际补看既有005–008均清楚灰禁用；005晚于禁用事件约33.8ms，新增/示例及工具一起灰化，布局不跳变。005 SHA256 `234fd9f40d70e2b76c9ce848cf68f36f9fcd070ab2c7e45c40433f6dedddd2f4`。索引保留原帧、时序、替代路径及 `unresolved=false`；没有重跑产品或放宽断言。

## 身份、归档与边界

- [运行结果](independent-results-fa357d.json) 绑定原20+8、包/入口/spec摘要；[首位明确判定](independent-first-54-verdict-fa357d.json) 保留其最终答复及54已读清单来源；相邻索引和两位原始记录分别保存。
- 主72图、两份几何JSON及复核索引单份归档：`test-results/accounts-single-entry/independent-final-fa357d/visual-evidence-72.zip`，SHA256 `5bcd6d1fb3ac1c1b502c6ebff25060a77fc94ea71ed889e55827d02a72c7fcb1`。docs保留9张关键图，完整原件和旧失败仍在各原目录，不许用新结果覆盖。
- 第二位独立核对 [4180 HTTP回执](independent-final-fa357d/local-4180-http.json)：index、当前入口JS、当前合并表单JS及旧哈希样本均HTTP200且逐字节摘要相符，没有读取真实profile/资料。
- 494遮挡、7a触控、cc删除错误、398c旧网址提示的有效失败保留；测试准备错误及不稳帧单列，不改写为产品数据失败。普通资产回收站的旧过渡辅助图不作为本轮稳定视觉通过证据，本需求密码回收站另有稳定状态与真实操作。

本结论不代表全项目、原生/真机、其他系统、真实云服务、云端CI或正式发布。主控完成本人任务路径的责任没有转移给独立复核。
