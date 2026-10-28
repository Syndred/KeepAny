# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-density.regression-1.spec.ts >> zh-CN 1280px dense records and complete date interaction
- Location: tests\e2e\ui-density.regression-1.spec.ts:19:3

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 1
Received:    106
```

# Page snapshot

```yaml
- generic [ref=f1e3]:
  - complementary [ref=f1e4]:
    - generic [ref=f1e5]:
      - generic [aria-hidden] [ref=f1e6]: K
      - generic [ref=f1e7]:
        - strong [ref=f1e8]: KeepAny
        - generic [ref=f1e9]: 个人资产工作台
    - button [ref=f1e10] [cursor=pointer]:
      - strong [ref=f1e15]: 个人工作区
    - generic [ref=f1e18]: 工作空间
    - navigation "导航" [ref=f1e19]:
      - generic [ref=f1e20]:
        - button "概览 按住拖动排序" [ref=f1e21]
        - link "概览" [ref=f1e29] [cursor=pointer]:
          - /url: /
      - generic [ref=f1e36]:
        - button "待办 按住拖动排序" [ref=f1e37]
        - link "待办 5" [ref=f1e45] [cursor=pointer]:
          - /url: /tasks
          - generic [ref=f1e49]: 待办
          - generic [ref=f1e50]: "5"
      - generic [ref=f1e51]:
        - button "资产 按住拖动排序" [ref=f1e52]
        - link "资产" [ref=f1e60] [cursor=pointer]:
          - /url: /assets
      - generic [ref=f1e66]:
        - button "账号 按住拖动排序" [ref=f1e67]
        - link "账号" [ref=f1e75] [cursor=pointer]:
          - /url: /accounts
      - status [ref=f1e80]
    - link "回收站" [ref=f1e81] [cursor=pointer]:
      - /url: /trash
    - generic [ref=f1e85]:
      - generic [ref=f1e86]: 我的分类
      - link "工作分类 1" [ref=f1e87] [cursor=pointer]:
        - /url: /collections/412a2ce4-1d14-41a4-835d-eb86398b5405
      - link "工作分类 2" [ref=f1e89] [cursor=pointer]:
        - /url: /collections/a6e42819-ac10-4e22-a7de-aa9884db5e13
      - link "工作分类 3" [ref=f1e91] [cursor=pointer]:
        - /url: /collections/874b6dc9-636a-4d45-8026-c304895a5202
      - link "工作分类 4" [ref=f1e93] [cursor=pointer]:
        - /url: /collections/85f08528-2e28-47a8-bc21-2d835ce0cc11
      - link "工作分类 5" [ref=f1e95] [cursor=pointer]:
        - /url: /collections/e3e37357-7801-48cd-9a6e-02e9e473aaed
      - link "工作分类 6" [ref=f1e97] [cursor=pointer]:
        - /url: /collections/de1c50dc-3881-4856-9fe2-85513db7c6fb
      - link "工作分类 7" [ref=f1e99] [cursor=pointer]:
        - /url: /collections/19b9ec9f-8021-4b89-a024-2694a24d88ff
      - link "工作分类 8" [ref=f1e101] [cursor=pointer]:
        - /url: /collections/8dd53529-841d-41b4-b55e-b9e6b6e5728a
      - link "自定义侧边栏" [ref=f1e103] [cursor=pointer]:
        - /url: /collections
    - button "我 我的工作区 仅自己可见" [ref=f1e106] [cursor=pointer]:
      - generic [ref=f1e107]: 我
      - generic [ref=f1e108]:
        - strong [ref=f1e109]: 我的工作区
        - generic [ref=f1e110]: 仅自己可见
  - generic [ref=f1e113]:
    - banner [ref=f1e114]:
      - link "返回概览" [ref=f1e115] [cursor=pointer]:
        - /url: /
      - button "搜索全部资料" [ref=f1e118] [cursor=pointer]:
        - generic [ref=f1e123]: ⌘ K
      - generic [ref=f1e124]:
        - link "待办提醒" [ref=f1e125] [cursor=pointer]:
          - /url: /tasks
        - button "AI 助手与授权" [ref=f1e130] [cursor=pointer]
        - link "收录与备份" [ref=f1e134] [cursor=pointer]:
          - /url: /intake
    - generic [ref=f1e136]:
      - navigation "资产" [ref=f1e137]:
        - link "全部" [ref=f1e138] [cursor=pointer]:
          - /url: /assets
        - link "项目" [ref=f1e139] [cursor=pointer]:
          - /url: /assets/project
        - link "实物" [ref=f1e140] [cursor=pointer]:
          - /url: /assets/item
        - link "域名" [ref=f1e141] [cursor=pointer]:
          - /url: /assets/domains
        - link "订阅" [ref=f1e142] [cursor=pointer]:
          - /url: /assets/subscription
        - link "费用账本" [ref=f1e143] [cursor=pointer]:
          - /url: /finance
      - main [ref=f1e144]:
        - generic [ref=f1e145]:
          - generic [ref=f1e146]:
            - heading "资产" [level=1] [ref=f1e147]
            - paragraph [ref=f1e148]: 查看实物、项目、域名与订阅的进度、期限和费用。
          - button "新增资产" [ref=f1e150] [cursor=pointer]
        - generic [ref=f1e152]:
          - generic [ref=f1e153]:
            - generic [ref=f1e154]: 实物购入额
            - strong [ref=f1e155]:
              - generic [ref=f1e156]: ¥8,998.00
          - generic [ref=f1e157]:
            - generic [ref=f1e158]: 已记录支出
            - strong [ref=f1e159]:
              - generic [ref=f1e160]: ¥607.00
          - generic [ref=f1e161]:
            - generic [ref=f1e162]: 订阅月均预计
            - strong [ref=f1e163]:
              - generic [ref=f1e164]: ¥88.00
          - generic [ref=f1e165]:
            - generic [ref=f1e166]: 30 天内到期／续费
            - strong [ref=f1e167]: "1"
        - generic [ref=f1e168]:
          - searchbox "搜索资产" [ref=f1e173]
          - group "资产视图" [ref=f1e174]:
            - button "紧凑列表" [ref=f1e175] [cursor=pointer]
            - button "卡片" [active] [pressed] [ref=f1e177] [cursor=pointer]
          - generic [ref=f1e183]: 25 项资产
        - region "资产" [ref=f1e184]:
          - link "松果创作工作室 品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。 待办完成 0 / 3 0 关联年费预计 ¥1,176.00 已记录支出 ¥607.00 studio.example.test 外链 0 条 · 0 条待核验 使用中" [ref=f1e185] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000001
            - generic [ref=f1e186]:
              - generic [ref=f1e187]:
                - strong [ref=f1e194]: 松果创作工作室
                - paragraph [ref=f1e195]: 品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。
              - generic [ref=f1e196]:
                - generic [ref=f1e197]:
                  - strong [ref=f1e198]: 待办完成 0 / 3
                  - progressbar "待办" [ref=f1e199]
                  - generic [ref=f1e200]:
                    - generic [ref=f1e201]: 关联年费预计
                    - generic [ref=f1e202]: ¥1,176.00
                  - generic [ref=f1e203]:
                    - generic [ref=f1e204]: 已记录支出
                    - generic [ref=f1e205]: ¥607.00
                - generic [ref=f1e206]:
                  - generic "studio.example.test" [ref=f1e207]
                  - generic [ref=f1e208]: 外链 0 条 · 0 条待核验
              - generic [ref=f1e209]: 使用中
          - link "旅行清单 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f1e213] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000002
            - generic [ref=f1e214]:
              - strong [ref=f1e222]: 旅行清单
              - generic [ref=f1e223]:
                - strong [ref=f1e225]: 尚未设置待办
                - generic [ref=f1e226]:
                  - generic [ref=f1e227]: 仓库
                  - generic [ref=f1e228]: 外链 0 条 · 0 条待核验
              - generic [ref=f1e229]: 使用中
          - 'link "工作室笔记本 · Pro 16 移动剪辑与设计工作站，附购买记录、设备照片和保修期限。 数码设备 工作室 · 书桌左侧 保修到期: 2027年8月16日 已购买 73 天 购入价 ¥8,699.00 使用中" [ref=f1e233] [cursor=pointer]':
            - /url: /assets/item/10000000-0000-4000-8000-000000000003
            - generic [ref=f1e234]:
              - generic [ref=f1e235]:
                - strong [ref=f1e238]: 工作室笔记本 · Pro 16
                - generic [ref=f1e239]: 移动剪辑与设计工作站，附购买记录、设备照片和保修期限。
              - generic [ref=f1e240]:
                - generic [ref=f1e241]:
                  - generic [ref=f1e242]: 数码设备
                  - generic [ref=f1e243]: 工作室 · 书桌左侧
                  - generic [ref=f1e244]: "保修到期: 2027年8月16日"
                - generic [ref=f1e245]:
                  - strong [ref=f1e246]: 已购买 73 天
                  - generic [ref=f1e247]:
                    - generic [ref=f1e248]: 购入价
                    - generic [ref=f1e249]: ¥8,699.00
              - generic [ref=f1e250]: 使用中
          - link "随身背包 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f1e254] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000004
            - generic [ref=f1e255]:
              - strong [ref=f1e263]: 随身背包
              - generic [ref=f1e264]:
                - generic [ref=f1e265]: 其他
                - generic [ref=f1e267]:
                  - strong [ref=f1e268]: 未记录购买日期
                  - generic [ref=f1e269]:
                    - generic [ref=f1e270]: 购入价
                    - generic [ref=f1e271]: 未记录金额
              - generic [ref=f1e272]: 使用中
          - link "多机位外拍套装与备用收音设备的长期借用登记 Portable field equipment · LongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpaces 数码设备 A-03 / 2F 已购买 210 天 购入价 ¥299.00 使用中" [ref=f1e276] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000005
            - generic [ref=f1e277]:
              - generic [ref=f1e278]:
                - strong [ref=f1e285]: 多机位外拍套装与备用收音设备的长期借用登记
                - generic [ref=f1e286]: Portable field equipment · LongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpaces
              - generic [ref=f1e287]:
                - generic [ref=f1e288]:
                  - generic [ref=f1e289]: 数码设备
                  - generic [ref=f1e290]: A-03 / 2F
                - generic [ref=f1e291]:
                  - strong [ref=f1e292]: 已购买 210 天
                  - generic [ref=f1e293]:
                    - generic [ref=f1e294]: 购入价
                    - generic [ref=f1e295]: ¥299.00
              - generic [ref=f1e296]: 使用中
          - 'link "CloudNest 云主机 工作室网站与备份空间 ¥88.00 1 月 下次日期: 2026年11月3日 剩余 6 天 已记录支出 ¥88.00 使用中" [ref=f1e300] [cursor=pointer]':
            - /url: /assets/subscription/10000000-0000-4000-8000-000000000006
            - generic [ref=f1e301]:
              - generic [ref=f1e302]:
                - strong [ref=f1e307]: CloudNest 云主机
                - generic [ref=f1e308]: 工作室网站与备份空间
              - generic [ref=f1e309]:
                - generic [ref=f1e310]:
                  - generic [ref=f1e311]: ¥88.00
                  - generic [ref=f1e312]: 1 月
                  - generic [ref=f1e313]: "下次日期: 2026年11月3日"
                - generic [ref=f1e314]:
                  - strong [ref=f1e315]: 剩余 6 天
                  - generic [ref=f1e316]:
                    - generic [ref=f1e317]: 已记录支出
                    - generic [ref=f1e318]: ¥88.00
              - generic [ref=f1e319]: 使用中
          - link "音乐会员 ¥0.00 1 月 未记录到期日期 使用中" [ref=f1e323] [cursor=pointer]:
            - /url: /assets/subscription/10000000-0000-4000-8000-000000000007
            - generic [ref=f1e324]:
              - strong [ref=f1e330]: 音乐会员
              - generic [ref=f1e331]:
                - generic [ref=f1e332]:
                  - generic [ref=f1e333]: ¥0.00
                  - generic [ref=f1e334]: 1 月
                - strong [ref=f1e336]: 未记录到期日期
              - generic [ref=f1e337]: 使用中
          - link "资料 01 资料齐全时，补充说明与期限可直接扫读。 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f1e341] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000009
            - generic [ref=f1e342]:
              - generic [ref=f1e343]:
                - strong [ref=f1e350]: 资料 01
                - generic [ref=f1e351]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f1e352]:
                - generic [ref=f1e353]: 其他
                - generic [ref=f1e355]:
                  - strong [ref=f1e356]: 未记录购买日期
                  - generic [ref=f1e357]:
                    - generic [ref=f1e358]: 购入价
                    - generic [ref=f1e359]: 未记录金额
              - generic [ref=f1e360]: 使用中
          - link "资料 02 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f1e364] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000010
            - generic [ref=f1e365]:
              - strong [ref=f1e373]: 资料 02
              - generic [ref=f1e374]:
                - strong [ref=f1e376]: 尚未设置待办
                - generic [ref=f1e377]:
                  - generic [ref=f1e378]: 仓库
                  - generic [ref=f1e379]: 外链 0 条 · 0 条待核验
              - generic [ref=f1e380]: 使用中
          - link "资料 03 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f1e384] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000011
            - generic [ref=f1e385]:
              - strong [ref=f1e393]: 资料 03
              - generic [ref=f1e394]:
                - generic [ref=f1e395]: 其他
                - generic [ref=f1e397]:
                  - strong [ref=f1e398]: 未记录购买日期
                  - generic [ref=f1e399]:
                    - generic [ref=f1e400]: 购入价
                    - generic [ref=f1e401]: 未记录金额
              - generic [ref=f1e402]: 使用中
          - link "资料 04 资料齐全时，补充说明与期限可直接扫读。 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f1e406] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000012
            - generic [ref=f1e407]:
              - generic [ref=f1e408]:
                - strong [ref=f1e415]: 资料 04
                - paragraph [ref=f1e416]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f1e417]:
                - strong [ref=f1e419]: 尚未设置待办
                - generic [ref=f1e420]:
                  - generic [ref=f1e421]: 仓库
                  - generic [ref=f1e422]: 外链 0 条 · 0 条待核验
              - generic [ref=f1e423]: 使用中
          - link "资料 05 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f1e427] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000013
            - generic [ref=f1e428]:
              - strong [ref=f1e436]: 资料 05
              - generic [ref=f1e437]:
                - generic [ref=f1e438]: 其他
                - generic [ref=f1e440]:
                  - strong [ref=f1e441]: 未记录购买日期
                  - generic [ref=f1e442]:
                    - generic [ref=f1e443]: 购入价
                    - generic [ref=f1e444]: 未记录金额
              - generic [ref=f1e445]: 使用中
          - link "资料 06 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f1e449] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000014
            - generic [ref=f1e450]:
              - strong [ref=f1e458]: 资料 06
              - generic [ref=f1e459]:
                - strong [ref=f1e461]: 尚未设置待办
                - generic [ref=f1e462]:
                  - generic [ref=f1e463]: 仓库
                  - generic [ref=f1e464]: 外链 0 条 · 0 条待核验
              - generic [ref=f1e465]: 使用中
          - link "资料 07 资料齐全时，补充说明与期限可直接扫读。 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f1e469] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000015
            - generic [ref=f1e470]:
              - generic [ref=f1e471]:
                - strong [ref=f1e478]: 资料 07
                - generic [ref=f1e479]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f1e480]:
                - generic [ref=f1e481]: 其他
                - generic [ref=f1e483]:
                  - strong [ref=f1e484]: 未记录购买日期
                  - generic [ref=f1e485]:
                    - generic [ref=f1e486]: 购入价
                    - generic [ref=f1e487]: 未记录金额
              - generic [ref=f1e488]: 使用中
          - link "资料 08 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f1e492] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000016
            - generic [ref=f1e493]:
              - strong [ref=f1e501]: 资料 08
              - generic [ref=f1e502]:
                - strong [ref=f1e504]: 尚未设置待办
                - generic [ref=f1e505]:
                  - generic [ref=f1e506]: 仓库
                  - generic [ref=f1e507]: 外链 0 条 · 0 条待核验
              - generic [ref=f1e508]: 使用中
          - link "资料 09 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f1e512] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000017
            - generic [ref=f1e513]:
              - strong [ref=f1e521]: 资料 09
              - generic [ref=f1e522]:
                - generic [ref=f1e523]: 其他
                - generic [ref=f1e525]:
                  - strong [ref=f1e526]: 未记录购买日期
                  - generic [ref=f1e527]:
                    - generic [ref=f1e528]: 购入价
                    - generic [ref=f1e529]: 未记录金额
              - generic [ref=f1e530]: 使用中
          - link "资料 10 资料齐全时，补充说明与期限可直接扫读。 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f1e534] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000018
            - generic [ref=f1e535]:
              - generic [ref=f1e536]:
                - strong [ref=f1e543]: 资料 10
                - paragraph [ref=f1e544]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f1e545]:
                - strong [ref=f1e547]: 尚未设置待办
                - generic [ref=f1e548]:
                  - generic [ref=f1e549]: 仓库
                  - generic [ref=f1e550]: 外链 0 条 · 0 条待核验
              - generic [ref=f1e551]: 使用中
          - link "资料 11 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f1e555] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000019
            - generic [ref=f1e556]:
              - strong [ref=f1e564]: 资料 11
              - generic [ref=f1e565]:
                - generic [ref=f1e566]: 其他
                - generic [ref=f1e568]:
                  - strong [ref=f1e569]: 未记录购买日期
                  - generic [ref=f1e570]:
                    - generic [ref=f1e571]: 购入价
                    - generic [ref=f1e572]: 未记录金额
              - generic [ref=f1e573]: 使用中
          - link "资料 12 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f1e577] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000020
            - generic [ref=f1e578]:
              - strong [ref=f1e586]: 资料 12
              - generic [ref=f1e587]:
                - strong [ref=f1e589]: 尚未设置待办
                - generic [ref=f1e590]:
                  - generic [ref=f1e591]: 仓库
                  - generic [ref=f1e592]: 外链 0 条 · 0 条待核验
              - generic [ref=f1e593]: 使用中
          - link "资料 13 资料齐全时，补充说明与期限可直接扫读。 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f1e597] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000021
            - generic [ref=f1e598]:
              - generic [ref=f1e599]:
                - strong [ref=f1e606]: 资料 13
                - generic [ref=f1e607]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f1e608]:
                - generic [ref=f1e609]: 其他
                - generic [ref=f1e611]:
                  - strong [ref=f1e612]: 未记录购买日期
                  - generic [ref=f1e613]:
                    - generic [ref=f1e614]: 购入价
                    - generic [ref=f1e615]: 未记录金额
              - generic [ref=f1e616]: 使用中
          - link "资料 14 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f1e620] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000022
            - generic [ref=f1e621]:
              - strong [ref=f1e629]: 资料 14
              - generic [ref=f1e630]:
                - strong [ref=f1e632]: 尚未设置待办
                - generic [ref=f1e633]:
                  - generic [ref=f1e634]: 仓库
                  - generic [ref=f1e635]: 外链 0 条 · 0 条待核验
              - generic [ref=f1e636]: 使用中
          - link "资料 15 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f1e640] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000023
            - generic [ref=f1e641]:
              - strong [ref=f1e649]: 资料 15
              - generic [ref=f1e650]:
                - generic [ref=f1e651]: 其他
                - generic [ref=f1e653]:
                  - strong [ref=f1e654]: 未记录购买日期
                  - generic [ref=f1e655]:
                    - generic [ref=f1e656]: 购入价
                    - generic [ref=f1e657]: 未记录金额
              - generic [ref=f1e658]: 使用中
          - link "资料 16 资料齐全时，补充说明与期限可直接扫读。 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f1e662] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000024
            - generic [ref=f1e663]:
              - generic [ref=f1e664]:
                - strong [ref=f1e671]: 资料 16
                - paragraph [ref=f1e672]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f1e673]:
                - strong [ref=f1e675]: 尚未设置待办
                - generic [ref=f1e676]:
                  - generic [ref=f1e677]: 仓库
                  - generic [ref=f1e678]: 外链 0 条 · 0 条待核验
              - generic [ref=f1e679]: 使用中
          - link "资料 17 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f1e683] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000025
            - generic [ref=f1e684]:
              - strong [ref=f1e692]: 资料 17
              - generic [ref=f1e693]:
                - generic [ref=f1e694]: 其他
                - generic [ref=f1e696]:
                  - strong [ref=f1e697]: 未记录购买日期
                  - generic [ref=f1e698]:
                    - generic [ref=f1e699]: 购入价
                    - generic [ref=f1e700]: 未记录金额
              - generic [ref=f1e701]: 使用中
          - 'link "studio.example.test 域名 · 松果创作工作室 剩余 48 天 到期日: 2026年12月15日 年费 ¥120.00 Synthetic registrar 管理域名 ↗" [ref=f1e705] [cursor=pointer]':
            - /url: /assets/project/10000000-0000-4000-8000-000000000001#project-domain-e7958902-bffc-4d39-b5b7-7ee571c7499d
            - strong [ref=f1e710]: studio.example.test
            - generic [ref=f1e711]: 域名 · 松果创作工作室
            - strong [ref=f1e712]: 剩余 48 天
            - generic [ref=f1e713]: "到期日: 2026年12月15日"
            - generic [ref=f1e714]:
              - generic [ref=f1e715]: 年费
              - strong [ref=f1e716]: ¥120.00
            - generic [ref=f1e717]: Synthetic registrar
            - generic [ref=f1e718]: 管理域名 ↗
```

# Test source

```ts
  1   | import { mkdirSync } from "node:fs";
  2   | import { join } from "node:path";
  3   | import { expect, test } from "@playwright/test";
  4   | import { resources } from "../../apps/web/src/i18n";
  5   | import { sourceModuleUrl } from "./helpers/source-module-url";
  6   | import { seedDensityBrowser } from "./helpers/ui-density-fixture";
  7   | 
  8   | // Regression: UI-20261028 — whole-field dates, dense mixed records, single active tabs,
  9   | // adjacent collection rows and working workspace menu. User-reported /qa regression.
  10  | // Value: protects=real rendered interaction and data reread; seam=none;
  11  | // no_claim=synthetic local records, no remote service or native notification acceptance.
  12  | const evidence =
  13  | 	process.env.KEEPANY_EVIDENCE_DIR ?? "test-results/ui-migration/density";
  14  | mkdirSync(evidence, { recursive: true });
  15  | test.setTimeout(90_000);
  16  | 
  17  | for (const language of ["zh-CN", "en"] as const)
  18  | 	for (const width of [390, 768, 1280, 1920]) {
  19  | 		test(`${language} ${width}px dense records and complete date interaction`, async ({
  20  | 			page,
  21  | 		}) => {
  22  | 			const errors: string[] = [];
  23  | 			page.on("pageerror", (error) => errors.push(error.message));
  24  | 			await page.setViewportSize({ width, height: 960 });
  25  | 			await page.addInitScript(
  26  | 				(language) => localStorage.setItem("keepany-language", language),
  27  | 				language,
  28  | 			);
  29  | 			await page.clock.setFixedTime(new Date("2026-10-28T04:00:00Z"));
  30  | 			await page.goto("/assets");
  31  | 			const ids = await page.evaluate(seedDensityBrowser, {
  32  | 				repositoryPath: sourceModuleUrl("packages/local-db/src/index.ts"),
  33  | 				domainPath: sourceModuleUrl("packages/domain/src/index.ts"),
  34  | 				language,
  35  | 			});
  36  | 			await page.reload();
  37  | 			const t = (key: string) => resources[language].translation[key];
  38  | 			const cards = page.locator(".workspace-asset-grid > a");
  39  | 			await expect(cards).toHaveCount(25); // 24 assets in the catalog plus the recorded domain.
  40  | 			await expect(page.locator(".workspace-asset-grid")).toHaveClass(
  41  | 				/asset-dense-list/,
  42  | 			);
  43  | 			if (width >= 1280) {
  44  | 				await expect(
  45  | 					page.locator(".asset-project-foot .chip").first(),
  46  | 				).toBeVisible();
  47  | 				const statusX = await page.evaluate(() =>
  48  | 					[".asset-project-foot .chip", ".asset-library-foot .chip"].map(
  49  | 						(selector) =>
  50  | 							document.querySelector(selector)!.getBoundingClientRect().x,
  51  | 					),
  52  | 				);
  53  | 				expect(Math.abs(statusX[0] - statusX[1])).toBeLessThanOrEqual(1);
  54  | 			}
  55  | 			expect(
  56  | 				await cards.evaluateAll((cards) =>
  57  | 					cards.every((card) => card.getBoundingClientRect().height < 195),
  58  | 				),
  59  | 			).toBe(true);
  60  | 			await page.screenshot({
  61  | 				path: join(evidence, `dense-list-${language}-${width}.png`),
  62  | 				fullPage: true,
  63  | 			});
  64  | 			await page
  65  | 				.getByRole("button", { name: t("assetCardView"), exact: true })
  66  | 				.click();
  67  | 			const rectangles = await cards.evaluateAll((cards) =>
  68  | 				cards.map((card) => ({
  69  | 					width: card.getBoundingClientRect().width,
  70  | 					height: card.getBoundingClientRect().height,
  71  | 					top: card.getBoundingClientRect().top,
  72  | 					bottom: card.getBoundingClientRect().bottom,
  73  | 				})),
  74  | 			);
  75  | 			expect(
  76  | 				rectangles.every((rect) => rect.width <= 361 && rect.height < 440),
  77  | 			).toBe(true);
  78  | 			for (const rect of rectangles) {
  79  | 				const sameRow = rectangles.filter((other) => Math.abs(other.top - rect.top) < 1);
> 80  | 				expect(Math.max(...sameRow.map((other) => other.bottom)) - Math.min(...sameRow.map((other) => other.bottom))).toBeLessThanOrEqual(1);
      |                                                                                                                   ^ Error: expect(received).toBeLessThanOrEqual(expected)
  81  | 			}
  82  | 			await expect(page.locator(".asset-kind-icon img")).toHaveJSProperty(
  83  | 				"naturalWidth",
  84  | 				640,
  85  | 			);
  86  | 			await expect(page.locator(".asset-project-cover")).toHaveCount(0);
  87  | 			if (width >= 1280)
  88  | 				expect(
  89  | 					await cards.evaluateAll(
  90  | 						(cards) =>
  91  | 							cards.filter(
  92  | 								(card) => card.getBoundingClientRect().bottom <= innerHeight,
  93  | 							).length,
  94  | 					),
  95  | 				).toBeGreaterThanOrEqual(6);
  96  | 			await page.screenshot({
  97  | 				path: join(evidence, `dense-assets-${language}-${width}.png`),
  98  | 				fullPage: true,
  99  | 			});
  100 | 			await page
  101 | 				.getByRole("button", { name: t("assetListView"), exact: true })
  102 | 				.click();
  103 | 			for (const path of [
  104 | 				"/assets",
  105 | 				"/assets/project",
  106 | 				"/assets/item",
  107 | 				"/assets/domains",
  108 | 				"/assets/subscription",
  109 | 				"/finance",
  110 | 				"/accounts",
  111 | 				"/assets/vault#vault-references",
  112 | 			]) {
  113 | 				await page.goto(path);
  114 | 				await expect(
  115 | 					page.locator(".workspace-navigation > a[aria-current='page']"),
  116 | 				).toHaveCount(1);
  117 | 				expect(
  118 | 					await page.evaluate(
  119 | 						() => document.documentElement.scrollWidth <= innerWidth + 1,
  120 | 					),
  121 | 				).toBe(true);
  122 | 			}
  123 | 			await page.goto("/collections");
  124 | 			await expect(page.locator(".collections-tile")).toHaveCount(8);
  125 | 			const geometry = await page.evaluate(() => ({
  126 | 				navBottom: document
  127 | 					.querySelector(".collections-organize-nav")!
  128 | 					.getBoundingClientRect().bottom,
  129 | 				rowTop: document
  130 | 					.querySelector(".collections-existing")!
  131 | 					.getBoundingClientRect().top,
  132 | 			}));
  133 | 			expect(geometry.rowTop - geometry.navBottom).toBeLessThanOrEqual(16);
  134 | 			const first = page.locator(".collections-tile").first();
  135 | 			const sameLine = await first.evaluate((row) => {
  136 | 				const icon = row.querySelector("svg")!.getBoundingClientRect();
  137 | 				const title = row.querySelector("a")!.getBoundingClientRect();
  138 | 				return (
  139 | 					Math.abs(icon.y + icon.height / 2 - title.y - title.height / 2) < 2
  140 | 				);
  141 | 			});
  142 | 			expect(sameLine).toBe(true);
  143 | 			await page.screenshot({
  144 | 				path: join(evidence, `dense-collections-${language}-${width}.png`),
  145 | 				fullPage: true,
  146 | 			});
  147 | 			await page.goto("/finance");
  148 | 			await expect(page.locator(".finance-entry-actions .button")).toHaveCount(
  149 | 				8,
  150 | 			);
  151 | 			const financeGeometry = await page
  152 | 				.locator(".finance-entry-actions .button")
  153 | 				.evaluateAll((buttons) =>
  154 | 					buttons.map((button) => {
  155 | 						const rect = button.getBoundingClientRect();
  156 | 						return {
  157 | 							width: rect.width,
  158 | 							height: rect.height,
  159 | 							radius: parseFloat(getComputedStyle(button).borderRadius),
  160 | 						};
  161 | 					}),
  162 | 				);
  163 | 			expect(financeGeometry.length).toBe(8);
  164 | 			expect(
  165 | 				financeGeometry.every(
  166 | 					(rect) => rect.width > rect.height * 1.25 && rect.radius > 100,
  167 | 				),
  168 | 			).toBe(true);
  169 | 			await page.screenshot({
  170 | 				path: join(evidence, `dense-finance-${language}-${width}.png`),
  171 | 				fullPage: true,
  172 | 			});
  173 | 			await page.goto("/tasks");
  174 | 			await expect(page.locator(".tasks-plan-card")).toHaveCount(0);
  175 | 			await expect(page.locator(".tasks-columns")).toHaveClass(/is-single/);
  176 | 			await expect(page.locator(".task-filters button").first()).toContainText(
  177 | 				t("all"),
  178 | 			);
  179 | 			const from = page.locator("#task-date-from");
  180 | 			await from.fill("2026-02-30");
```