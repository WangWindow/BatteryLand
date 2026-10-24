import { defineMessages } from "@/i18n/messages/types"

export const queueMessages = defineMessages({
  zh: {
    queue: {
      title: "调度队列",
      description:
        "引擎只负责保存执行状态和进程；独立 scheduler 通过公开 HTTP 接口读取队列并派发。scheduler 离线时排队任务保持等待，已有执行仍可观察和停止。",
      pauseTitle: "派发已暂停",
      pauseDefaultReason: "存在待核对的执行身份。",
      pauseDescription: "需要先通过后端 reconcile 流程核对原始进程，网页不会自动重建启动意图。",
      waitingTitle: "等待执行（{{count}}）",
      waitingDescription: "按提交顺序排列；由外部 scheduler 选择并请求派发。",
      emptyWaiting: "队列为空",
      emptyWaitingDescription: "在实验页提交草稿后会出现在这里。",
      columns: {
        order: "顺序",
        experiment: "实验",
        device: "设备",
        queuedAt: "入队时间",
        actions: "操作",
      },
      cancelQueued: "取消排队",
      activeTitle: "当前执行（{{count}}）",
      activeDescription: "首期容量为 1；停止请求受理不等于进程已经退出。",
      emptyActive: "没有活动执行",
      emptyActiveDescription: "队列就绪时会由 scheduler 派发。",
      labels: {
        device: "设备：",
        started: "开始：",
        stopRequested: "停止请求：",
        stage: "阶段：",
      },
      requestStop: "请求停止",
      stopping: "停止请求已受理，等待引擎确认退出。",
      schedulerTitle: "独立调度器",
      schedulerDescription: "调度策略不在引擎内运行，也不需要访问数据库或训练进程。",
      schedulerStart: "在仓库根目录启动默认 FIFO 调度器：",
      schedulerCommand: "uv run python -m simple_impl.scheduler --base-url http://127.0.0.1:8000",
      schedulerReplace:
        "替换策略只需实现独立的 choose(queue) 客户端接口；引擎的容量、状态与进程所有权保持不变。",
      messages: {
        stopAccepted: "停止请求已受理：{{state}}",
      },
    },
  },
  en: {
    queue: {
      title: "Scheduling queue",
      description:
        "The engine only owns execution state and processes; the external scheduler reads the queue and dispatches through public HTTP APIs. When the scheduler is offline, queued tasks wait while existing executions remain observable and stoppable.",
      pauseTitle: "Dispatch paused",
      pauseDefaultReason: "An execution identity requires reconciliation.",
      pauseDescription:
        "Verify the original process through the backend reconcile flow first; the browser never reconstructs a launch intent.",
      waitingTitle: "Waiting ({{count}})",
      waitingDescription:
        "Ordered by submission; the external scheduler selects and requests dispatch.",
      emptyWaiting: "The queue is empty",
      emptyWaitingDescription: "Drafts submitted on the experiments page appear here.",
      columns: {
        order: "Order",
        experiment: "Experiment",
        device: "Device",
        queuedAt: "Queued at",
        actions: "Actions",
      },
      cancelQueued: "Cancel queued task",
      activeTitle: "Active executions ({{count}})",
      activeDescription:
        "Initial capacity is one; accepting a stop request does not mean the process has exited.",
      emptyActive: "No active executions",
      emptyActiveDescription: "The scheduler dispatches when a queue entry is ready.",
      labels: {
        device: "Device: ",
        started: "Started: ",
        stopRequested: "Stop requested: ",
        stage: "Stage: ",
      },
      requestStop: "Request stop",
      stopping: "Stop request accepted; waiting for the engine to confirm exit.",
      schedulerTitle: "External scheduler",
      schedulerDescription:
        "Scheduling policy does not run inside the engine and never accesses the database or training processes.",
      schedulerStart: "Start the default FIFO scheduler from the repository root:",
      schedulerCommand: "uv run python -m simple_impl.scheduler --base-url http://127.0.0.1:8000",
      schedulerReplace:
        "Replace a policy by implementing the independent choose(queue) client interface; engine capacity, state, and process ownership remain unchanged.",
      messages: {
        stopAccepted: "Stop request accepted: {{state}}",
      },
    },
  },
})
