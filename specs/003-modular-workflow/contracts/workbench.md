# Workbench Contract

一个前端应用使用统一fetch客户端和生成的OpenAPI DTO，成功解包code/message/data，错误显示message与字段/详情，上传使用FormData。
页面覆盖sources/batteries、splits、templates、components/checkpoints、experiments、queue、comparison。
详情支持编辑、保存、校验、入队、停止、复制、删除及下载；按钮按真实state启停，服务端仍做权威校验。
配置和清单可编辑JSON或上传原生文件；YAML导入由后端安全解析。

visualizer只依赖公共ChartBundle输入、可复用主题控件与纯转换函数，不导入页面。页面通过API获取六种图表描述并按bar/line/scatter渲染。
同一序列颜色稳定；单位、来源、警告和缺失数据可辨识。无图表或无真值时给出真实空状态。
路由懒加载；比较页再动态加载visualizer；日志增量轮询清理AbortController和定时器，支持cursor_invalid重置。
生成OpenAPI类型与后端当前快照一致；新增派发后保留历史001快照，当前快照存本feature/contracts/openapi.json。

## Internationalization

界面默认简体中文，可切换英文，选择保存在`localStorage`并同步`<html lang>`。
所有用户可见文案、占位控件、无障碍标签、错误、空状态和图表说明来自统一词典；
技术标识、状态枚举、命令、UUID、单位和JSON字段名可原样保留。
同一次变更必须同步维护`zh`与`en`的键树及`{{placeholder}}`，缺失键或占位符不一致即失败。
`bun run check`执行`scripts/check-i18n.ts`，扫描词典键引用、硬编码中文、JSX文本和
用户可见属性，禁止以只改一种语言或后续补翻译的方式合并。
