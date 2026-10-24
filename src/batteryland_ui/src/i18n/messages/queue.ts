import { defineMessages } from "@/i18n/messages/types"

export const queueMessages = defineMessages({
  zh: {
    queue: {
      title: "调度队列",

      pauseTitle: "派发已暂停",
      pauseDefaultReason: "存在待核对的执行身份。",
      pauseDescription: "需要先通过后端 reconcile 流程核对原始进程，网页不会自动重建启动意图。",
      waitingTitle: "等待执行（{{count}}）",

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

      emptyActive: "没有活动执行",
      emptyActiveDescription: "任务入队后自动执行。",
      labels: {
        device: "设备：",
        started: "开始：",
        stopRequested: "停止请求：",
        stage: "阶段：",
      },
      requestStop: "请求停止",
      stopping: "停止请求已受理，等待引擎确认退出。",
      messages: {
        stopAccepted: "停止请求已受理：{{state}}",
      },
    },
  },
  en: {
    queue: {
      title: "Scheduling queue",

      pauseTitle: "Dispatch paused",
      pauseDefaultReason: "An execution identity requires reconciliation.",
      pauseDescription:
        "Verify the original process through the backend reconcile flow first; the browser never reconstructs a launch intent.",
      waitingTitle: "Waiting ({{count}})",

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
      messages: {
        stopAccepted: "Stop request accepted: {{state}}",
      },
    },
  },
})
