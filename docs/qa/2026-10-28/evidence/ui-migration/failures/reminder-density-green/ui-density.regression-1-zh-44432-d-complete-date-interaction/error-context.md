# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: ui-density.regression-1.spec.ts >> zh-CN 1280px dense records and complete date interaction
- Location: tests\e2e\ui-density.regression-1.spec.ts:19:3

# Error details

```
Error: expect(received).toBeGreaterThanOrEqual(expected)

Expected: >= 6
Received:    4
```

# Page snapshot

```yaml
- generic [ref=f3e3]:
  - complementary [ref=f3e4]:
    - generic [ref=f3e5]:
      - generic [aria-hidden] [ref=f3e6]: K
      - generic [ref=f3e7]:
        - strong [ref=f3e8]: KeepAny
        - generic [ref=f3e9]: 个人资产工作台
    - button [ref=f3e10] [cursor=pointer]:
      - strong [ref=f3e15]: 个人工作区
    - generic [ref=f3e18]: 工作空间
    - navigation "导航" [ref=f3e19]:
      - generic [ref=f3e20]:
        - button "概览 按住拖动排序" [ref=f3e21]
        - link "概览" [ref=f3e29] [cursor=pointer]:
          - /url: /
      - generic [ref=f3e36]:
        - button "待办 按住拖动排序" [ref=f3e37]
        - link "待办 5" [ref=f3e45] [cursor=pointer]:
          - /url: /tasks
          - generic [ref=f3e49]: 待办
          - generic [ref=f3e50]: "5"
      - generic [ref=f3e51]:
        - button "资产 按住拖动排序" [ref=f3e52]
        - link "资产" [ref=f3e60] [cursor=pointer]:
          - /url: /assets
      - generic [ref=f3e66]:
        - button "账号 按住拖动排序" [ref=f3e67]
        - link "账号" [ref=f3e75] [cursor=pointer]:
          - /url: /accounts
      - status [ref=f3e80]
    - link "回收站" [ref=f3e81] [cursor=pointer]:
      - /url: /trash
    - generic [ref=f3e85]:
      - generic [ref=f3e86]: 我的分类
      - link "工作分类 1" [ref=f3e87] [cursor=pointer]:
        - /url: /collections/3f5ccad7-dc08-4201-86fa-ad3844145865
      - link "工作分类 2" [ref=f3e89] [cursor=pointer]:
        - /url: /collections/eaf70c4d-f51c-4a34-89fc-f73d405835ed
      - link "工作分类 3" [ref=f3e91] [cursor=pointer]:
        - /url: /collections/a5bcdd3e-bdf0-4685-a7c5-db4bdb913a58
      - link "工作分类 4" [ref=f3e93] [cursor=pointer]:
        - /url: /collections/734badb2-c69c-491d-9126-3aa3045b12a2
      - link "工作分类 5" [ref=f3e95] [cursor=pointer]:
        - /url: /collections/d0b8dd00-e8c0-4481-8fc1-6228e719187b
      - link "工作分类 6" [ref=f3e97] [cursor=pointer]:
        - /url: /collections/6fa754a9-55cd-4628-88bf-ae75f97ebd7b
      - link "工作分类 7" [ref=f3e99] [cursor=pointer]:
        - /url: /collections/f21865c3-b007-489e-9ad7-4b3d51b4e715
      - link "工作分类 8" [ref=f3e101] [cursor=pointer]:
        - /url: /collections/ad86b981-150a-40b8-80c6-2b0238286135
      - link "自定义侧边栏" [ref=f3e103] [cursor=pointer]:
        - /url: /collections
    - button "我 我的工作区 仅自己可见" [ref=f3e106] [cursor=pointer]:
      - generic [ref=f3e107]: 我
      - generic [ref=f3e108]:
        - strong [ref=f3e109]: 我的工作区
        - generic [ref=f3e110]: 仅自己可见
  - generic [ref=f3e113]:
    - banner [ref=f3e114]:
      - link "返回概览" [ref=f3e115] [cursor=pointer]:
        - /url: /
      - button "搜索全部资料" [ref=f3e118] [cursor=pointer]:
        - generic [ref=f3e123]: ⌘ K
      - generic [ref=f3e124]:
        - link "待办提醒" [ref=f3e125] [cursor=pointer]:
          - /url: /tasks
        - button "AI 助手与授权" [ref=f3e130] [cursor=pointer]
        - link "收录与备份" [ref=f3e134] [cursor=pointer]:
          - /url: /intake
    - complementary "需要留意的提醒" [ref=f3e136]:
      - strong [ref=f3e137]: 1 项提醒
      - link "核对交付资料 1" [ref=f3e139] [cursor=pointer]:
        - /url: /tasks#task-1de4c968-6c49-41c4-bad2-ca33e275ea10
    - generic [ref=f3e140]:
      - navigation "资产" [ref=f3e141]:
        - link "全部" [ref=f3e142] [cursor=pointer]:
          - /url: /assets
        - link "项目" [ref=f3e143] [cursor=pointer]:
          - /url: /assets/project
        - link "实物" [ref=f3e144] [cursor=pointer]:
          - /url: /assets/item
        - link "域名" [ref=f3e145] [cursor=pointer]:
          - /url: /assets/domains
        - link "订阅" [ref=f3e146] [cursor=pointer]:
          - /url: /assets/subscription
        - link "费用账本" [ref=f3e147] [cursor=pointer]:
          - /url: /finance
      - main [ref=f3e148]:
        - generic [ref=f3e149]:
          - generic [ref=f3e150]:
            - heading "资产" [level=1] [ref=f3e151]
            - paragraph [ref=f3e152]: 查看实物、项目、域名与订阅的进度、期限和费用。
          - button "新增资产" [ref=f3e154] [cursor=pointer]
        - generic [ref=f3e156]:
          - generic [ref=f3e157]:
            - generic [ref=f3e158]: 实物购入额
            - strong [ref=f3e159]:
              - generic [ref=f3e160]: ¥8,998.00
          - generic [ref=f3e161]:
            - generic [ref=f3e162]: 已记录支出
            - strong [ref=f3e163]:
              - generic [ref=f3e164]: ¥607.00
          - generic [ref=f3e165]:
            - generic [ref=f3e166]: 订阅月均预计
            - strong [ref=f3e167]:
              - generic [ref=f3e168]: ¥88.00
          - generic [ref=f3e169]:
            - generic [ref=f3e170]: 30 天内到期／续费
            - strong [ref=f3e171]: "1"
        - generic [ref=f3e172]:
          - searchbox "搜索资产" [ref=f3e177]
          - group "资产视图" [ref=f3e178]:
            - button "紧凑列表" [ref=f3e179] [cursor=pointer]
            - button "卡片" [active] [pressed] [ref=f3e181] [cursor=pointer]
          - generic [ref=f3e187]: 25 项资产
        - region "资产" [ref=f3e188]:
          - link "松果创作工作室 品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。 待办完成 0 / 3 0 关联年费预计 ¥1,176.00 已记录支出 ¥607.00 studio.example.test 外链 0 条 · 0 条待核验 使用中" [ref=f3e189] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000001
            - generic [ref=f3e190]:
              - generic [ref=f3e191]:
                - strong [ref=f3e198]: 松果创作工作室
                - paragraph [ref=f3e199]: 品牌、网站与内容的项目档案，包含域名、订阅费用和交付待办。
              - generic [ref=f3e200]:
                - generic [ref=f3e201]:
                  - strong [ref=f3e202]: 待办完成 0 / 3
                  - progressbar "待办" [ref=f3e203]
                  - generic [ref=f3e204]:
                    - generic [ref=f3e205]: 关联年费预计
                    - generic [ref=f3e206]: ¥1,176.00
                  - generic [ref=f3e207]:
                    - generic [ref=f3e208]: 已记录支出
                    - generic [ref=f3e209]: ¥607.00
                - generic [ref=f3e210]:
                  - generic "studio.example.test" [ref=f3e211]
                  - generic [ref=f3e212]: 外链 0 条 · 0 条待核验
              - generic [ref=f3e213]: 使用中
          - link "旅行清单 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f3e217] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000002
            - generic [ref=f3e218]:
              - strong [ref=f3e226]: 旅行清单
              - generic [ref=f3e227]:
                - strong [ref=f3e229]: 尚未设置待办
                - generic [ref=f3e230]:
                  - generic [ref=f3e231]: 仓库
                  - generic [ref=f3e232]: 外链 0 条 · 0 条待核验
              - generic [ref=f3e233]: 使用中
          - 'link "工作室笔记本 · Pro 16 移动剪辑与设计工作站，附购买记录、设备照片和保修期限。 数码设备 工作室 · 书桌左侧 保修到期: 2027年8月16日 已购买 73 天 购入价 ¥8,699.00 使用中" [ref=f3e237] [cursor=pointer]':
            - /url: /assets/item/10000000-0000-4000-8000-000000000003
            - generic [ref=f3e238]:
              - generic [ref=f3e239]:
                - strong [ref=f3e242]: 工作室笔记本 · Pro 16
                - generic [ref=f3e243]: 移动剪辑与设计工作站，附购买记录、设备照片和保修期限。
              - generic [ref=f3e244]:
                - generic [ref=f3e245]:
                  - generic [ref=f3e246]: 数码设备
                  - generic [ref=f3e247]: 工作室 · 书桌左侧
                  - generic [ref=f3e248]: "保修到期: 2027年8月16日"
                - generic [ref=f3e249]:
                  - strong [ref=f3e250]: 已购买 73 天
                  - generic [ref=f3e251]:
                    - generic [ref=f3e252]: 购入价
                    - generic [ref=f3e253]: ¥8,699.00
              - generic [ref=f3e254]: 使用中
          - link "随身背包 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f3e258] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000004
            - generic [ref=f3e259]:
              - strong [ref=f3e267]: 随身背包
              - generic [ref=f3e268]:
                - generic [ref=f3e269]: 其他
                - generic [ref=f3e271]:
                  - strong [ref=f3e272]: 未记录购买日期
                  - generic [ref=f3e273]:
                    - generic [ref=f3e274]: 购入价
                    - generic [ref=f3e275]: 未记录金额
              - generic [ref=f3e276]: 使用中
          - link "多机位外拍套装与备用收音设备的长期借用登记 Portable field equipment · LongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpaces 数码设备 A-03 / 2F 已购买 210 天 购入价 ¥299.00 使用中" [ref=f3e280] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000005
            - generic [ref=f3e281]:
              - generic [ref=f3e282]:
                - strong [ref=f3e289]: 多机位外拍套装与备用收音设备的长期借用登记
                - generic [ref=f3e290]: Portable field equipment · LongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpacesLongDescriptionWithoutSpaces
              - generic [ref=f3e291]:
                - generic [ref=f3e292]:
                  - generic [ref=f3e293]: 数码设备
                  - generic [ref=f3e294]: A-03 / 2F
                - generic [ref=f3e295]:
                  - strong [ref=f3e296]: 已购买 210 天
                  - generic [ref=f3e297]:
                    - generic [ref=f3e298]: 购入价
                    - generic [ref=f3e299]: ¥299.00
              - generic [ref=f3e300]: 使用中
          - 'link "CloudNest 云主机 工作室网站与备份空间 ¥88.00 1 月 下次日期: 2026年11月3日 剩余 6 天 已记录支出 ¥88.00 使用中" [ref=f3e304] [cursor=pointer]':
            - /url: /assets/subscription/10000000-0000-4000-8000-000000000006
            - generic [ref=f3e305]:
              - generic [ref=f3e306]:
                - strong [ref=f3e311]: CloudNest 云主机
                - generic [ref=f3e312]: 工作室网站与备份空间
              - generic [ref=f3e313]:
                - generic [ref=f3e314]:
                  - generic [ref=f3e315]: ¥88.00
                  - generic [ref=f3e316]: 1 月
                  - generic [ref=f3e317]: "下次日期: 2026年11月3日"
                - generic [ref=f3e318]:
                  - strong [ref=f3e319]: 剩余 6 天
                  - generic [ref=f3e320]:
                    - generic [ref=f3e321]: 已记录支出
                    - generic [ref=f3e322]: ¥88.00
              - generic [ref=f3e323]: 使用中
          - link "音乐会员 ¥0.00 1 月 未记录到期日期 使用中" [ref=f3e327] [cursor=pointer]:
            - /url: /assets/subscription/10000000-0000-4000-8000-000000000007
            - generic [ref=f3e328]:
              - strong [ref=f3e334]: 音乐会员
              - generic [ref=f3e335]:
                - generic [ref=f3e336]:
                  - generic [ref=f3e337]: ¥0.00
                  - generic [ref=f3e338]: 1 月
                - strong [ref=f3e340]: 未记录到期日期
              - generic [ref=f3e341]: 使用中
          - link "资料 01 资料齐全时，补充说明与期限可直接扫读。 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f3e345] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000009
            - generic [ref=f3e346]:
              - generic [ref=f3e347]:
                - strong [ref=f3e354]: 资料 01
                - generic [ref=f3e355]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f3e356]:
                - generic [ref=f3e357]: 其他
                - generic [ref=f3e359]:
                  - strong [ref=f3e360]: 未记录购买日期
                  - generic [ref=f3e361]:
                    - generic [ref=f3e362]: 购入价
                    - generic [ref=f3e363]: 未记录金额
              - generic [ref=f3e364]: 使用中
          - link "资料 02 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f3e368] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000010
            - generic [ref=f3e369]:
              - strong [ref=f3e377]: 资料 02
              - generic [ref=f3e378]:
                - strong [ref=f3e380]: 尚未设置待办
                - generic [ref=f3e381]:
                  - generic [ref=f3e382]: 仓库
                  - generic [ref=f3e383]: 外链 0 条 · 0 条待核验
              - generic [ref=f3e384]: 使用中
          - link "资料 03 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f3e388] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000011
            - generic [ref=f3e389]:
              - strong [ref=f3e397]: 资料 03
              - generic [ref=f3e398]:
                - generic [ref=f3e399]: 其他
                - generic [ref=f3e401]:
                  - strong [ref=f3e402]: 未记录购买日期
                  - generic [ref=f3e403]:
                    - generic [ref=f3e404]: 购入价
                    - generic [ref=f3e405]: 未记录金额
              - generic [ref=f3e406]: 使用中
          - link "资料 04 资料齐全时，补充说明与期限可直接扫读。 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f3e410] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000012
            - generic [ref=f3e411]:
              - generic [ref=f3e412]:
                - strong [ref=f3e419]: 资料 04
                - paragraph [ref=f3e420]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f3e421]:
                - strong [ref=f3e423]: 尚未设置待办
                - generic [ref=f3e424]:
                  - generic [ref=f3e425]: 仓库
                  - generic [ref=f3e426]: 外链 0 条 · 0 条待核验
              - generic [ref=f3e427]: 使用中
          - link "资料 05 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f3e431] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000013
            - generic [ref=f3e432]:
              - strong [ref=f3e440]: 资料 05
              - generic [ref=f3e441]:
                - generic [ref=f3e442]: 其他
                - generic [ref=f3e444]:
                  - strong [ref=f3e445]: 未记录购买日期
                  - generic [ref=f3e446]:
                    - generic [ref=f3e447]: 购入价
                    - generic [ref=f3e448]: 未记录金额
              - generic [ref=f3e449]: 使用中
          - link "资料 06 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f3e453] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000014
            - generic [ref=f3e454]:
              - strong [ref=f3e462]: 资料 06
              - generic [ref=f3e463]:
                - strong [ref=f3e465]: 尚未设置待办
                - generic [ref=f3e466]:
                  - generic [ref=f3e467]: 仓库
                  - generic [ref=f3e468]: 外链 0 条 · 0 条待核验
              - generic [ref=f3e469]: 使用中
          - link "资料 07 资料齐全时，补充说明与期限可直接扫读。 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f3e473] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000015
            - generic [ref=f3e474]:
              - generic [ref=f3e475]:
                - strong [ref=f3e482]: 资料 07
                - generic [ref=f3e483]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f3e484]:
                - generic [ref=f3e485]: 其他
                - generic [ref=f3e487]:
                  - strong [ref=f3e488]: 未记录购买日期
                  - generic [ref=f3e489]:
                    - generic [ref=f3e490]: 购入价
                    - generic [ref=f3e491]: 未记录金额
              - generic [ref=f3e492]: 使用中
          - link "资料 08 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f3e496] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000016
            - generic [ref=f3e497]:
              - strong [ref=f3e505]: 资料 08
              - generic [ref=f3e506]:
                - strong [ref=f3e508]: 尚未设置待办
                - generic [ref=f3e509]:
                  - generic [ref=f3e510]: 仓库
                  - generic [ref=f3e511]: 外链 0 条 · 0 条待核验
              - generic [ref=f3e512]: 使用中
          - link "资料 09 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f3e516] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000017
            - generic [ref=f3e517]:
              - strong [ref=f3e525]: 资料 09
              - generic [ref=f3e526]:
                - generic [ref=f3e527]: 其他
                - generic [ref=f3e529]:
                  - strong [ref=f3e530]: 未记录购买日期
                  - generic [ref=f3e531]:
                    - generic [ref=f3e532]: 购入价
                    - generic [ref=f3e533]: 未记录金额
              - generic [ref=f3e534]: 使用中
          - link "资料 10 资料齐全时，补充说明与期限可直接扫读。 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f3e538] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000018
            - generic [ref=f3e539]:
              - generic [ref=f3e540]:
                - strong [ref=f3e547]: 资料 10
                - paragraph [ref=f3e548]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f3e549]:
                - strong [ref=f3e551]: 尚未设置待办
                - generic [ref=f3e552]:
                  - generic [ref=f3e553]: 仓库
                  - generic [ref=f3e554]: 外链 0 条 · 0 条待核验
              - generic [ref=f3e555]: 使用中
          - link "资料 11 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f3e559] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000019
            - generic [ref=f3e560]:
              - strong [ref=f3e568]: 资料 11
              - generic [ref=f3e569]:
                - generic [ref=f3e570]: 其他
                - generic [ref=f3e572]:
                  - strong [ref=f3e573]: 未记录购买日期
                  - generic [ref=f3e574]:
                    - generic [ref=f3e575]: 购入价
                    - generic [ref=f3e576]: 未记录金额
              - generic [ref=f3e577]: 使用中
          - link "资料 12 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f3e581] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000020
            - generic [ref=f3e582]:
              - strong [ref=f3e590]: 资料 12
              - generic [ref=f3e591]:
                - strong [ref=f3e593]: 尚未设置待办
                - generic [ref=f3e594]:
                  - generic [ref=f3e595]: 仓库
                  - generic [ref=f3e596]: 外链 0 条 · 0 条待核验
              - generic [ref=f3e597]: 使用中
          - link "资料 13 资料齐全时，补充说明与期限可直接扫读。 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f3e601] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000021
            - generic [ref=f3e602]:
              - generic [ref=f3e603]:
                - strong [ref=f3e610]: 资料 13
                - generic [ref=f3e611]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f3e612]:
                - generic [ref=f3e613]: 其他
                - generic [ref=f3e615]:
                  - strong [ref=f3e616]: 未记录购买日期
                  - generic [ref=f3e617]:
                    - generic [ref=f3e618]: 购入价
                    - generic [ref=f3e619]: 未记录金额
              - generic [ref=f3e620]: 使用中
          - link "资料 14 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f3e624] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000022
            - generic [ref=f3e625]:
              - strong [ref=f3e633]: 资料 14
              - generic [ref=f3e634]:
                - strong [ref=f3e636]: 尚未设置待办
                - generic [ref=f3e637]:
                  - generic [ref=f3e638]: 仓库
                  - generic [ref=f3e639]: 外链 0 条 · 0 条待核验
              - generic [ref=f3e640]: 使用中
          - link "资料 15 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f3e644] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000023
            - generic [ref=f3e645]:
              - strong [ref=f3e653]: 资料 15
              - generic [ref=f3e654]:
                - generic [ref=f3e655]: 其他
                - generic [ref=f3e657]:
                  - strong [ref=f3e658]: 未记录购买日期
                  - generic [ref=f3e659]:
                    - generic [ref=f3e660]: 购入价
                    - generic [ref=f3e661]: 未记录金额
              - generic [ref=f3e662]: 使用中
          - link "资料 16 资料齐全时，补充说明与期限可直接扫读。 尚未设置待办 仓库 外链 0 条 · 0 条待核验 使用中" [ref=f3e666] [cursor=pointer]:
            - /url: /assets/project/10000000-0000-4000-8000-000000000024
            - generic [ref=f3e667]:
              - generic [ref=f3e668]:
                - strong [ref=f3e675]: 资料 16
                - paragraph [ref=f3e676]: 资料齐全时，补充说明与期限可直接扫读。
              - generic [ref=f3e677]:
                - strong [ref=f3e679]: 尚未设置待办
                - generic [ref=f3e680]:
                  - generic [ref=f3e681]: 仓库
                  - generic [ref=f3e682]: 外链 0 条 · 0 条待核验
              - generic [ref=f3e683]: 使用中
          - link "资料 17 其他 未记录购买日期 购入价 未记录金额 使用中" [ref=f3e687] [cursor=pointer]:
            - /url: /assets/item/10000000-0000-4000-8000-000000000025
            - generic [ref=f3e688]:
              - strong [ref=f3e696]: 资料 17
              - generic [ref=f3e697]:
                - generic [ref=f3e698]: 其他
                - generic [ref=f3e700]:
                  - strong [ref=f3e701]: 未记录购买日期
                  - generic [ref=f3e702]:
                    - generic [ref=f3e703]: 购入价
                    - generic [ref=f3e704]: 未记录金额
              - generic [ref=f3e705]: 使用中
          - 'link "studio.example.test 域名 · 松果创作工作室 剩余 48 天 到期日: 2026年12月15日 年费 ¥120.00 Synthetic registrar 管理域名 ↗" [ref=f3e709] [cursor=pointer]':
            - /url: /assets/project/10000000-0000-4000-8000-000000000001#project-domain-bd07b8da-4dea-46a4-972e-9751aed24fb0
            - strong [ref=f3e714]: studio.example.test
            - generic [ref=f3e715]: 域名 · 松果创作工作室
            - strong [ref=f3e716]: 剩余 48 天
            - generic [ref=f3e717]: "到期日: 2026年12月15日"
            - generic [ref=f3e718]:
              - generic [ref=f3e719]: 年费
              - strong [ref=f3e720]: ¥120.00
            - generic [ref=f3e721]: Synthetic registrar
            - generic [ref=f3e722]: 管理域名 ↗
```

# Test source

```ts
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
  38  | 			await page.goto("/");
  39  | 			await expect(page.locator(".reminder-runtime-banner")).toBeVisible();
  40  | 			if (width >= 1280) expect((await page.locator(".reminder-runtime-banner").boundingBox())!.height).toBeLessThanOrEqual(64);
  41  | 			await expect(page.locator(".overview-project-card")).toHaveCount(6);
  42  | 			await expect(page.locator(".overview-project-top h3")).toHaveCount(6);
  43  | 			expect(await page.locator(".overview-project-card").evaluateAll((cards) => cards.every((card) => card.getBoundingClientRect().width <= 361))).toBe(true);
  44  | 			if (width >= 1280) expect((await page.locator(".overview-hero").boundingBox())!.height).toBeLessThan(130);
  45  | 			await page.screenshot({path: join(evidence, `dense-overview-${language}-${width}.png`),fullPage: true});
  46  | 			await page.goto("/assets");
  47  | 			const cards = page.locator(".workspace-asset-grid > a");
  48  | 			await expect(cards).toHaveCount(25); // 24 assets in the catalog plus the recorded domain.
  49  | 			await expect(page.locator(".workspace-asset-grid")).toHaveClass(
  50  | 				/asset-dense-list/,
  51  | 			);
  52  | 			if (width >= 1280) {
  53  | 				await expect(
  54  | 					page.locator(".asset-project-foot .chip").first(),
  55  | 				).toBeVisible();
  56  | 				const statusX = await page.evaluate(() =>
  57  | 					[".asset-project-foot .chip", ".asset-library-foot .chip"].map(
  58  | 						(selector) =>
  59  | 							document.querySelector(selector)!.getBoundingClientRect().x,
  60  | 					),
  61  | 				);
  62  | 				expect(Math.abs(statusX[0] - statusX[1])).toBeLessThanOrEqual(1);
  63  | 			}
  64  | 			expect(
  65  | 				await cards.evaluateAll((cards) =>
  66  | 					cards.every((card) => card.getBoundingClientRect().height < 195),
  67  | 				),
  68  | 			).toBe(true);
  69  | 			await page.screenshot({
  70  | 				path: join(evidence, `dense-list-${language}-${width}.png`),
  71  | 				fullPage: true,
  72  | 			});
  73  | 			await page
  74  | 				.getByRole("button", { name: t("assetCardView"), exact: true })
  75  | 				.click();
  76  | 			const rectangles = await cards.evaluateAll((cards) =>
  77  | 				cards.map((card) => ({
  78  | 					width: card.getBoundingClientRect().width,
  79  | 					height: card.getBoundingClientRect().height,
  80  | 					top: card.getBoundingClientRect().top,
  81  | 					bottom: card.getBoundingClientRect().bottom,
  82  | 				})),
  83  | 			);
  84  | 			expect(
  85  | 				rectangles.every((rect) => rect.width <= 361 && rect.height < 440),
  86  | 			).toBe(true);
  87  | 			for (const rect of rectangles) {
  88  | 				const sameRow = rectangles.filter((other) => Math.abs(other.top - rect.top) < 1);
  89  | 				expect(Math.max(...sameRow.map((other) => other.bottom)) - Math.min(...sameRow.map((other) => other.bottom))).toBeLessThanOrEqual(1);
  90  | 			}
  91  | 			await expect(page.locator(".asset-kind-icon img")).toHaveJSProperty(
  92  | 				"naturalWidth",
  93  | 				640,
  94  | 			);
  95  | 			await expect(page.locator(".asset-project-cover")).toHaveCount(0);
  96  | 			if (width >= 1280)
  97  | 				expect(
  98  | 					await cards.evaluateAll(
  99  | 						(cards) =>
  100 | 							cards.filter(
  101 | 								(card) => card.getBoundingClientRect().bottom <= innerHeight,
  102 | 							).length,
  103 | 					),
> 104 | 				).toBeGreaterThanOrEqual(6);
      |       ^ Error: expect(received).toBeGreaterThanOrEqual(expected)
  105 | 			await page.screenshot({
  106 | 				path: join(evidence, `dense-assets-${language}-${width}.png`),
  107 | 				fullPage: true,
  108 | 			});
  109 | 			await page
  110 | 				.getByRole("button", { name: t("assetListView"), exact: true })
  111 | 				.click();
  112 | 			for (const path of [
  113 | 				"/assets",
  114 | 				"/assets/project",
  115 | 				"/assets/item",
  116 | 				"/assets/domains",
  117 | 				"/assets/subscription",
  118 | 				"/finance",
  119 | 				"/accounts",
  120 | 				"/assets/vault#vault-references",
  121 | 			]) {
  122 | 				await page.goto(path);
  123 | 				await expect(
  124 | 					page.locator(".workspace-navigation > a[aria-current='page']"),
  125 | 				).toHaveCount(1);
  126 | 				expect(
  127 | 					await page.evaluate(
  128 | 						() => document.documentElement.scrollWidth <= innerWidth + 1,
  129 | 					),
  130 | 				).toBe(true);
  131 | 			}
  132 | 			await page.goto("/collections");
  133 | 			await expect(page.locator(".collections-tile")).toHaveCount(8);
  134 | 			if (width <= 680) {
  135 | 				const target = await page.locator(".collections-tile button[aria-haspopup=menu]").first().boundingBox();
  136 | 				expect(target!.width).toBeGreaterThanOrEqual(44);
  137 | 				expect(target!.height).toBeGreaterThanOrEqual(44);
  138 | 			}
  139 | 			const geometry = await page.evaluate(() => ({
  140 | 				navBottom: document
  141 | 					.querySelector(".collections-organize-nav")!
  142 | 					.getBoundingClientRect().bottom,
  143 | 				rowTop: document
  144 | 					.querySelector(".collections-existing")!
  145 | 					.getBoundingClientRect().top,
  146 | 			}));
  147 | 			expect(geometry.rowTop - geometry.navBottom).toBeLessThanOrEqual(16);
  148 | 			const first = page.locator(".collections-tile").first();
  149 | 			const sameLine = await first.evaluate((row) => {
  150 | 				const icon = row.querySelector("svg")!.getBoundingClientRect();
  151 | 				const title = row.querySelector("a")!.getBoundingClientRect();
  152 | 				return (
  153 | 					Math.abs(icon.y + icon.height / 2 - title.y - title.height / 2) < 2
  154 | 				);
  155 | 			});
  156 | 			expect(sameLine).toBe(true);
  157 | 			await page.screenshot({
  158 | 				path: join(evidence, `dense-collections-${language}-${width}.png`),
  159 | 				fullPage: true,
  160 | 			});
  161 | 			await page.goto("/finance");
  162 | 			await expect(page.locator(".finance-entry-actions .button")).toHaveCount(
  163 | 				8,
  164 | 			);
  165 | 			const financeGeometry = await page
  166 | 				.locator(".finance-entry-actions .button")
  167 | 				.evaluateAll((buttons) =>
  168 | 					buttons.map((button) => {
  169 | 						const rect = button.getBoundingClientRect();
  170 | 						return {
  171 | 							width: rect.width,
  172 | 							height: rect.height,
  173 | 							radius: parseFloat(getComputedStyle(button).borderRadius),
  174 | 						};
  175 | 					}),
  176 | 				);
  177 | 			expect(financeGeometry.length).toBe(8);
  178 | 			expect(
  179 | 				financeGeometry.every(
  180 | 					(rect) => rect.width > rect.height * 1.25 && rect.radius > 100,
  181 | 				),
  182 | 			).toBe(true);
  183 | 			await page.screenshot({
  184 | 				path: join(evidence, `dense-finance-${language}-${width}.png`),
  185 | 				fullPage: true,
  186 | 			});
  187 | 			await page.goto("/tasks");
  188 | 			await expect(page.locator(".tasks-plan-card")).toHaveCount(0);
  189 | 			await expect(page.locator(".tasks-columns")).toHaveClass(/is-single/);
  190 | 			await expect(page.locator(".task-filters button").first()).toContainText(
  191 | 				t("all"),
  192 | 			);
  193 | 			const from = page.locator("#task-date-from");
  194 | 			await from.fill("2026-02-30");
  195 | 			expect(
  196 | 				await from.evaluate((input: HTMLInputElement) => input.checkValidity()),
  197 | 			).toBe(false);
  198 | 			await from.fill("");
  199 | 			expect(
  200 | 				await from.evaluate((input: HTMLInputElement) => input.checkValidity()),
  201 | 			).toBe(true);
  202 | 			await from.click({ position: { x: 12, y: 15 } });
  203 | 			await expect(page.locator(".date-popover")).toBeVisible();
  204 | 			const bounds = await page.locator(".date-popover").boundingBox();
```