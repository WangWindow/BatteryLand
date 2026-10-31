export type Prediction = {
  id: string
  prediction: number
  target: number | null
  lower: number | null
  upper: number | null
}

export function relativeError(row: Prediction): number | null {
  return row.target !== null &&
    Number.isFinite(row.target) &&
    row.target > 0 &&
    Number.isFinite(row.prediction)
    ? Math.abs(row.prediction - row.target) / row.target
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

// Synthetic UI fixtures only. Bounds are illustrative, not inferred from the true values.
const complete: Prediction[] = [
  { id: "cell_01", target: 980, prediction: 1000, lower: 900, upper: 1100 },
  { id: "cell_02", target: 1200, prediction: 1150, lower: 1030, upper: 1270 },
  { id: "cell_03", target: 800, prediction: 820, lower: 740, upper: 900 },
  { id: "cell_04", target: 1250, prediction: 1300, lower: 1150, upper: 1450 },
  { id: "cell_05", target: 650, prediction: 700, lower: 580, upper: 820 },
  { id: "cell_06", target: 1400, prediction: 1000, lower: 900, upper: 1100 },
]

export const demoExperiments = [
  {
    id: "demo-a",
    name: "示例实验 A",
    model: "CPTransformer",
    stages: {
      test: complete,
      validation: complete.slice(0, 4).map((row) => ({ ...row, prediction: row.prediction + 30 })),
    },
  },
  {
    id: "demo-b",
    name: "示例实验 B · 缺失数据",
    model: "CPMLP",
    stages: {
      test: complete.map((row, index) => ({
        ...row,
        target: index === 0 ? null : row.target,
        lower: index === 1 ? null : row.lower,
        upper: index === 1 ? null : row.upper,
      })),
      validation: [] as Prediction[],
    },
  },
]
