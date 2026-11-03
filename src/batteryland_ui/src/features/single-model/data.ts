export type Prediction = {
  id: string
  fileName: string
  prediction: number | null
  target: number | null
  lower: number | null
  upper: number | null
  granularity: string
}

export type PredictionSummary = {
  predicted: number
  labelled: number
  mae: number | null
  mse: number | null
  rmse: number | null
  mape: number | null
  accuracy15: ReturnType<typeof accuracy>
}

export type ImportedPredictionSet = {
  rows: Prediction[]
  metadata: {
    modelName: string
    datasetName: string
    predictionTarget: string
    bestEpoch: number | null
  }
  sourceName: string
  sample: boolean
}

const requiredColumns = new Set(["prediction"])
const knownColumns = new Set([
  "battery_id",
  "file_name",
  "prediction",
  "target",
  "lower",
  "upper",
  "granularity",
])

function optionalNumber(value: unknown, field: string, rowNumber: number): number | null {
  if (value === undefined || value === null || value === "") return null
  const numeric = typeof value === "number" ? value : Number(String(value).trim())
  if (!Number.isFinite(numeric)) throw new Error(`第 ${rowNumber} 行的 ${field} 不是有效数字`)
  return numeric
}

function predictionRow(value: unknown, rowNumber: number): Prediction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`第 ${rowNumber} 行不是有效的预测记录`)
  }
  const item = value as Record<string, unknown>
  const fileName = typeof item.file_name === "string" ? item.file_name.trim() : ""
  const batteryId = typeof item.battery_id === "string" ? item.battery_id.trim() : ""
  if (!batteryId && !fileName) throw new Error(`第 ${rowNumber} 行缺少 battery_id 或 file_name`)
  const prediction = optionalNumber(item.prediction, "prediction", rowNumber)
  if (prediction === null) throw new Error(`第 ${rowNumber} 行缺少 prediction`)
  const lower = optionalNumber(item.lower, "lower", rowNumber)
  const upper = optionalNumber(item.upper, "upper", rowNumber)
  if ((lower === null) !== (upper === null)) {
    throw new Error(`第 ${rowNumber} 行的 lower 和 upper 必须同时提供`)
  }
  if (lower !== null && upper !== null && lower > upper) {
    throw new Error(`第 ${rowNumber} 行的 lower 不能大于 upper`)
  }
  return {
    id: batteryId || fileName,
    fileName: fileName || batteryId,
    prediction,
    target: optionalNumber(item.target, "target", rowNumber),
    lower,
    upper,
    granularity:
      typeof item.granularity === "string" && item.granularity.trim()
        ? item.granularity.trim()
        : "mean_by_battery",
  }
}

function csvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (character === '"') quoted = false
      else field += character
    } else if (character === '"') quoted = true
    else if (character === ",") {
      row.push(field)
      field = ""
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""))
      if (row.some((value) => value.trim())) rows.push(row)
      row = []
      field = ""
    } else field += character
  }
  if (quoted) throw new Error("CSV 中存在未闭合的引号")
  row.push(field.replace(/\r$/, ""))
  if (row.some((value) => value.trim())) rows.push(row)
  return rows
}

export function parsePredictionCsv(text: string, sourceName = "导入的 CSV"): ImportedPredictionSet {
  const table = csvRows(text.replace(/^\uFEFF/, ""))
  if (table.length < 2) throw new Error("CSV 至少需要表头和一行预测记录")
  const headers = table[0].map((value) => value.trim().toLowerCase())
  for (const column of requiredColumns) {
    if (!headers.includes(column)) throw new Error(`CSV 缺少必填列：${column}`)
  }
  if (!headers.includes("battery_id") && !headers.includes("file_name")) {
    throw new Error("CSV 至少需要 battery_id 或 file_name 列")
  }
  const rows = table.slice(1).map((values, index) => {
    const item: Record<string, string> = {}
    headers.forEach((header, columnIndex) => {
      if (knownColumns.has(header)) item[header] = values[columnIndex]?.trim() ?? ""
    })
    return predictionRow(item, index + 2)
  })
  return {
    rows,
    metadata: { modelName: "", datasetName: "", predictionTarget: "电池寿命（EOL）", bestEpoch: null },
    sourceName,
    sample: false,
  }
}

export function parsePredictionJson(text: string, sourceName = "导入的 JSON"): ImportedPredictionSet {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error("JSON 文件格式无效")
  }
  const object =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const values = Array.isArray(raw)
    ? raw
    : Array.isArray(object?.predictions)
      ? object.predictions
      : Array.isArray(object?.test_predictions)
        ? object.test_predictions
        : null
  if (!values?.length) throw new Error("JSON 中没有 predictions 或 test_predictions 记录")
  const metadata =
    object?.metadata && typeof object.metadata === "object"
      ? (object.metadata as Record<string, unknown>)
      : {}
  const textValue = (key: string, fallback = "") =>
    typeof metadata[key] === "string"
      ? String(metadata[key]).trim()
      : typeof object?.[key] === "string"
        ? String(object[key]).trim()
        : fallback
  return {
    rows: values.map((value, index) => predictionRow(value, index + 1)),
    metadata: {
      modelName: textValue("model_name"),
      datasetName: textValue("dataset_name"),
      predictionTarget: textValue("prediction_target", "电池寿命（EOL）"),
      bestEpoch: optionalNumber(object?.epoch, "epoch", 1),
    },
    sourceName,
    sample: false,
  }
}

export function parsePredictionText(text: string, fileName: string): ImportedPredictionSet {
  const suffix = fileName.split(".").at(-1)?.toLowerCase()
  if (suffix === "csv") return parsePredictionCsv(text, fileName)
  if (suffix === "json") return parsePredictionJson(text, fileName)
  throw new Error("仅支持 .csv 和 .json 文件")
}

export const samplePredictionSet: ImportedPredictionSet = {
  sourceName: "内置示例数据",
  sample: true,
  metadata: {
    modelName: "CPMLP（示例）",
    datasetName: "MATR（示例）",
    predictionTarget: "电池寿命（EOL）",
    bestEpoch: 12,
  },
  rows: [
    {
      id: "cell_01",
      fileName: "cell_01.pkl",
      prediction: 980,
      target: 1000,
      lower: 900,
      upper: 1060,
      granularity: "mean_by_battery",
    },
    {
      id: "cell_02",
      fileName: "cell_02.pkl",
      prediction: 1170,
      target: 1200,
      lower: 1050,
      upper: 1280,
      granularity: "mean_by_battery",
    },
    {
      id: "cell_03",
      fileName: "cell_03.pkl",
      prediction: 820,
      target: 800,
      lower: 750,
      upper: 900,
      granularity: "mean_by_battery",
    },
    {
      id: "cell_04",
      fileName: "cell_04.pkl",
      prediction: 980,
      target: 1350,
      lower: 880,
      upper: 1100,
      granularity: "mean_by_battery",
    },
    {
      id: "cell_05",
      fileName: "cell_05.pkl",
      prediction: 690,
      target: 650,
      lower: 610,
      upper: 770,
      granularity: "mean_by_battery",
    },
  ],
}

export function relativeError(row: Prediction): number | null {
  return row.target !== null &&
    Number.isFinite(row.target) &&
    row.target > 0 &&
    row.prediction !== null &&
    Number.isFinite(row.prediction)
    ? Math.abs(row.prediction - row.target) / row.target
    : null
}

export function absoluteError(row: Prediction): number | null {
  return row.target !== null &&
    Number.isFinite(row.target) &&
    row.prediction !== null &&
    Number.isFinite(row.prediction)
    ? Math.abs(row.prediction - row.target)
    : null
}

export function validInterval(row: Prediction): boolean {
  return (
    row.lower !== null &&
    row.upper !== null &&
    Number.isFinite(row.lower) &&
    Number.isFinite(row.upper) &&
    row.lower <= row.upper
  )
}

export function accuracy(rows: Prediction[]) {
  const errors = rows.map(relativeError).filter((error): error is number => error !== null)
  const passed = errors.filter((error) => error <= 0.15 + 1e-12).length
  return { passed, total: errors.length, value: errors.length ? passed / errors.length : null }
}

export function summarize(rows: Prediction[]): PredictionSummary {
  const pairs = rows.filter(
    (row): row is Prediction & { prediction: number; target: number } =>
      row.prediction !== null &&
      Number.isFinite(row.prediction) &&
      row.target !== null &&
      Number.isFinite(row.target),
  )
  const errors = pairs.map((row) => row.prediction - row.target)
  const labelled = pairs.length
  const residual = errors.reduce((sum, error) => sum + error * error, 0)
  const percentageErrors = pairs
    .filter((row) => row.target > 0)
    .map((row) => Math.abs(row.prediction - row.target) / row.target)
  return {
    predicted: rows.filter((row) => row.prediction !== null && Number.isFinite(row.prediction)).length,
    labelled,
    mae: labelled ? errors.reduce((sum, error) => sum + Math.abs(error), 0) / labelled : null,
    mse: labelled ? residual / labelled : null,
    rmse: labelled ? Math.sqrt(residual / labelled) : null,
    mape: percentageErrors.length
      ? percentageErrors.reduce((sum, error) => sum + error, 0) / percentageErrors.length
      : null,
    accuracy15: accuracy(rows),
  }
}

export function predictionCsv(rows: Prediction[]): string {
  const csvEscape = (value: string | number | null) => {
    const valueText = value === null ? "" : String(value)
    return /[",\r\n]/.test(valueText) ? `"${valueText.replaceAll('"', '""')}"` : valueText
  }
  const header = [
    "电池编号",
    "文件名",
    "预测粒度",
    "真实值",
    "预测值",
    "区间下限",
    "区间上限",
    "绝对误差",
    "相对误差",
    "是否覆盖",
  ]
  const body = rows.map((row) => {
    const absolute = absoluteError(row)
    const relative = relativeError(row)
    const covered =
      validInterval(row) && row.target !== null
        ? row.target >= (row.lower as number) && row.target <= (row.upper as number)
          ? "是"
          : "否"
        : ""
    return [
      row.id,
      row.fileName,
      row.granularity,
      row.target,
      row.prediction,
      row.lower,
      row.upper,
      absolute,
      relative,
      covered,
    ]
      .map(csvEscape)
      .join(",")
  })
  return `\uFEFF${[header.join(","), ...body].join("\r\n")}`
}
