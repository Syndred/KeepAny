# 07 ShipAny商业项目拆分

## 结论：独立同级文件夹、独立Git仓库

```text
/Users/syndred/Desktop/projects/
  KeepAny/        # 开源核心、基础同步、自部署、用户资产UI
  KeepAny-Cloud/  # 私有：ShipAny官网、付费会员、运营后台
```

当前仅KeepAny已建立文档；KeepAny-Cloud尚未创建、未下载模板。实施时使用已购且允许该协作方式的ShipAny版本；检查模板远端后再开发。文件夹拆开有助于代码发布边界，但不能自动解决许可证兼容问题。

## 各自负责什么

| 功能 | KeepAny | KeepAny-Cloud |
|---|---|---|
| 资产应用、分类、关系、待办、导出 | 开源 | 不复制 |
| 基础同步协议与服务、BYOK/MCP | 开源可自部署 | 可托管并运营 |
| 官网、SEO内容、定价、营销邮件 | 不负责 | ShipAny已有实现优先 |
| 付款、订单、发票、额度、客服权限 | 消费权益API | ShipAny模板扩展 |
| 用户个人资产管理后台 | 就是开源应用 | 运营后台不得直接浏览个人内容 |

“后台”指运营后台，不是把用户资产详情搬进ShipAny。私有商业服务不因此取得解密密钥。

## 模板技术保持原生

以实际购买版本为准。当前ShipAny TanStack文档列出TanStack Start/React、shadcn/Tailwind、Better Auth、Drizzle、Paraglide与支付/RBAC能力。该仓库沿用模板已有实现，不强行换成核心i18next或React Hook Form。两个项目都只提供zh-CN/en，产品术语对齐。

## 身份和API边界

- 核心本地无注册。自部署身份由自己的同步服务器Better Auth管理。
- 官方云账号身份与商业会员建立显式绑定，不通过邮箱相同自动合并，不跨域共享数据库cookie。
- 商业服务签发短期、限定audience/scope的权益凭证；同步服务验证签名/有效期/撤销。方案实施时使用成熟协议库并测伪造和重放。
- API例：读取套餐与配额、申请同步服务、读取使用量；付款webhook先验签、幂等，再更新权益。浏览器付款成功页不是支付凭证。
- 数据库分开、密钥分开、迁移分开；运营人员只读必要使用量/订单，不接触资产明文。
- 官网、app、sync可用独立子域；尚未选定或注册域名，文档不编造上线地址。

## 许可检查

ShipAny允许许可范围内商业建设，但限制源码公开分发、模板转售和版权声明移除；协作人数需匹配购买许可。禁止把模板加入KeepAny公开仓库，也不随开源自部署包分发。开源部分的AGPL义务独立履行；HTTP分离本身不是绕开许可义务的结论。

[ShipAny许可](https://shipany.ai/license) · [TanStack模板文档](https://docs.shipany.ai/shipany-tanstack)
