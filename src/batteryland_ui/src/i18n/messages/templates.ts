import { defineMessages } from "@/i18n/messages/types"

export const templatesMessages = defineMessages({
  zh: {
    templates: {
      title: "实验模板",

      importTemplate: "导入模板",
      importTitle: "导入模板",
      importDescription: "选择 YAML 或 JSON 配置文件并指定模板名称。",
      importName: "名称",
      importFile: "配置文件",
      importLimit: "最大 1 MiB。",
      newTemplate: "新建模板",
      catalogTitle: "模板目录",

      nameFilter: "名称",
      search: "检索",
      emptyTitle: "尚无模板",
      emptyDescription: "新建模板或从现有 YAML 配置导入。",
      columns: {
        name: "名称",
        version: "版本",
        revision: "修订",
        createdAt: "创建时间",
        actions: "操作",
      },
      edit: "编辑",
      export: "导出",
      delete: "删除",
      deleteTitle: "删除模板？",
      deleteDescription:
        "已创建实验保存的是独立快照，不会被删除；引用了该模板的草稿可能需要在保存前重新绑定。",
      editTitle: "编辑模板",
      createTitle: "新建模板",
      editDescription: "修订 {{revision}}；保存后旧模板版本仍保留。",
      createDescription: "填写名称和原生配置对象。配置结构和组件参数由后端校验。",
      name: "名称",
      nativeConfig: "原生配置",

      saveNewVersion: "保存新版本",
      createTemplate: "创建模板",
      messages: {
        nameRequired: "请填写模板名称",
        configRequired: "配置必须是 JSON 对象",
        saved: "模板已保存为新版本",
        created: "模板已创建",
        importRequired: "请填写名称并选择 YAML/JSON 文件",
        imported: "模板已导入",
        deleted: "模板已删除",
      },
    },
  },
  en: {
    templates: {
      title: "Experiment templates",

      importTemplate: "Import template",
      importTitle: "Import template",
      importDescription: "Choose a YAML or JSON configuration file and provide a template name.",
      importName: "Name",
      importFile: "Configuration file",
      importLimit: "Maximum 1 MiB.",
      newTemplate: "New template",
      catalogTitle: "Template catalog",

      nameFilter: "Name",
      search: "Search",
      emptyTitle: "No templates yet",
      emptyDescription: "Create a template or import an existing YAML configuration.",
      columns: {
        name: "Name",
        version: "Version",
        revision: "Revision",
        createdAt: "Created",
        actions: "Actions",
      },
      edit: "Edit",
      export: "Export",
      delete: "Delete",
      deleteTitle: "Delete template?",
      deleteDescription:
        "Experiments keep independent snapshots and are not deleted; drafts referencing this template may need to be rebound before saving.",
      editTitle: "Edit template",
      createTitle: "New template",
      editDescription:
        "Revision {{revision}}; older template versions remain available after saving.",
      createDescription: "Set up reusable run settings.",
      name: "Name",
      nativeConfig: "Native configuration",

      saveNewVersion: "Save new version",
      createTemplate: "Create template",
      messages: {
        nameRequired: "Enter a template name",
        configRequired: "The configuration must be a JSON object",
        saved: "Template saved as a new version",
        created: "Template created",
        importRequired: "Enter a name and choose a YAML/JSON file",
        imported: "Template imported",
        deleted: "Template deleted",
      },
    },
  },
})
