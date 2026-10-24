export type MessageTree = {
  [key: string]: string | MessageTree
}

export type SameMessageShape<T extends MessageTree> = {
  [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends MessageTree
      ? SameMessageShape<T[K]>
      : never
}

/**
 * Declare one canonical Chinese tree and its complete English counterpart.
 *
 * The English tree is type-checked against the Chinese key shape, so adding a
 * key without a translation is a compile error before runtime.
 */
export function defineMessages<T extends MessageTree>(value: {
  zh: T
  en: SameMessageShape<T>
}): { zh: T; en: SameMessageShape<T> } {
  return value
}
