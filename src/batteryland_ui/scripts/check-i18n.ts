/**
 * Enforce the repository's i18n contract.
 *
 * 1. Chinese and English catalogs must have exactly the same key tree and
 *    interpolation placeholders.
 * 2. Every statically referenced t("key") must exist in both catalogs.
 * 3. Source files may not contain hardcoded Chinese UI text.
 * 4. JSX text and user-facing attributes may not contain literals.
 *
 * Run with: bun scripts/check-i18n.ts
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { parse } from "@babel/parser"
import type {
  CallExpression,
  Comment,
  JSXAttribute,
  JSXText,
  Node,
  StringLiteral,
} from "@babel/types"

import { messagesEn, messagesZh } from "../src/i18n/messages"

const ROOT = new URL("..", import.meta.url).pathname
const SRC = join(ROOT, "src")
const I18N_DIR = join(SRC, "i18n")
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/
const ALLOWED_JSX_TEXT = new Set(["BL", "v", "·", "—", "/"])
const USER_FACING_ATTRIBUTES = new Set([
  "placeholder",
  "title",
  "aria-label",
  "aria-description",
  "alt",
])
const USER_FACING_SETTERS =
  /^(?:toast\.(?:success|error|info|warning|message)|set\w*Error|set\w*Message)$/
const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g

type Tree = { [key: string]: string | Tree }
type Positioned = Node & { loc?: { start: { line: number } } | null }

function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const result = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === "string") {
      result.set(path, value)
    } else {
      for (const [nested, text] of flatten(value, path)) {
        result.set(nested, text)
      }
    }
  }
  return result
}

function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1]).sort()
}

const zh = flatten(messagesZh as Tree)
const en = flatten(messagesEn as Tree)
const errors: string[] = []
const warnings: string[] = []

for (const key of zh.keys()) {
  if (!en.has(key)) {
    errors.push(`Missing English translation for key: ${key}`)
  }
}
for (const key of en.keys()) {
  if (!zh.has(key)) {
    errors.push(`Missing Chinese translation for key: ${key}`)
  }
}
for (const [key, value] of zh) {
  if (!value.trim()) {
    errors.push(`Empty Chinese translation: ${key}`)
  }
  const english = en.get(key)
  if (english === undefined) {
    continue
  }
  if (!english.trim()) {
    errors.push(`Empty English translation: ${key}`)
  }
  const chinesePlaceholders = placeholders(value)
  const englishPlaceholders = placeholders(english)
  if (chinesePlaceholders.join(",") !== englishPlaceholders.join(",")) {
    errors.push(
      `Interpolation mismatch for ${key}: zh=[${chinesePlaceholders.join(", ")}] en=[${englishPlaceholders.join(", ")}]`,
    )
  }
}

function hasKey(key: string): boolean {
  return zh.has(key) && en.has(key)
}

function hasPrefix(prefix: string): boolean {
  return [...zh.keys()].some((key) => key.startsWith(prefix))
}

function sourceFiles(directory: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (path === I18N_DIR) {
        continue
      }
      result.push(...sourceFiles(path))
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      result.push(path)
    }
  }
  return result
}

function lineOf(node: Positioned): number {
  return node.loc?.start.line ?? 0
}

function report(path: string, node: Positioned, message: string): void {
  errors.push(`${relative(ROOT, path)}:${lineOf(node)} ${message}`)
}

function isNode(value: unknown): value is Node {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type?: unknown }).type === "string"
  )
}

function calleeText(node: CallExpression): string {
  const callee = node.callee
  if (callee.type === "Identifier") {
    return callee.name
  }
  if (callee.type === "MemberExpression" && !callee.computed) {
    const object = callee.object.type === "Identifier" ? callee.object.name : ""
    const property = callee.property.type === "Identifier" ? callee.property.name : ""
    return object && property ? `${object}.${property}` : ""
  }
  return ""
}

function isTechnicalLiteral(text: string): boolean {
  if (text.length <= 1 || !/[A-Za-z]/.test(text)) {
    return true
  }
  return text === "BatteryLand" || /^[\d\s.:/\\%+\-_×()]+$/.test(text)
}

function inspectCall(path: string, node: CallExpression): void {
  const name = calleeText(node)
  const [argument] = node.arguments
  if (name === "t" && argument) {
    if (argument.type === "StringLiteral") {
      if (!hasKey(argument.value)) {
        report(path, argument, `Unknown translation key: ${argument.value}`)
      }
    } else if (argument.type === "TemplateLiteral") {
      const [head] = argument.quasis
      if (!head) {
        return
      }
      if (argument.expressions.length === 0) {
        if (!hasKey(head.value.cooked ?? "")) {
          report(path, argument, `Unknown translation key: ${head.value.cooked ?? ""}`)
        }
      } else if (head.value.cooked && !hasPrefix(head.value.cooked)) {
        report(path, argument, `Dynamic translation key has no matches: ${head.value.cooked}*`)
      }
    }
    return
  }
  if (
    USER_FACING_SETTERS.test(name) &&
    argument &&
    (argument.type === "StringLiteral" || argument.type === "TemplateLiteral")
  ) {
    report(path, argument, `${name} must use t(...) instead of a literal`)
  }
}

function inspectAttribute(path: string, node: JSXAttribute): void {
  const name = node.name.type === "JSXIdentifier" ? node.name.name : ""
  if (!USER_FACING_ATTRIBUTES.has(name) || !node.value) {
    return
  }
  if (node.value.type === "StringLiteral" && node.value.value.trim()) {
    report(path, node.value, `Attribute ${name} must use t(...) instead of a literal`)
  }
}

function inspectJsxText(path: string, node: JSXText): void {
  const text = node.value.replace(/\s+/g, " ").trim()
  if (!text || ALLOWED_JSX_TEXT.has(text) || isTechnicalLiteral(text)) {
    return
  }
  report(path, node, `Hardcoded JSX text: "${text}"`)
}

function inspectComment(path: string, node: Comment): void {
  if (CJK.test(node.value)) {
    report(path, node as Positioned, "Chinese comments must move into the translation catalog")
  }
}

function inspectString(path: string, node: StringLiteral): void {
  if (CJK.test(node.value)) {
    report(path, node, "Hardcoded Chinese text must move into src/i18n messages")
  }
}

function inspectFile(path: string): void {
  const content = readFileSync(path, "utf8")
  let ast: ReturnType<typeof parse>
  try {
    ast = parse(content, {
      sourceType: "module",
      plugins: ["typescript", "jsx"],
      errorRecovery: false,
    })
  } catch (error) {
    errors.push(`${relative(ROOT, path)}: parse failed: ${String(error)}`)
    return
  }

  for (const comment of ast.comments ?? []) {
    inspectComment(path, comment)
  }

  const visit = (node: Node): void => {
    if (node.type === "StringLiteral") {
      inspectString(path, node)
    }
    if (node.type === "CallExpression") {
      inspectCall(path, node)
    }
    if (node.type === "JSXAttribute") {
      inspectAttribute(path, node)
    }
    if (node.type === "JSXText") {
      inspectJsxText(path, node)
    }
    if (node.type === "TemplateLiteral") {
      for (const quasi of node.quasis) {
        if (quasi.value.cooked && CJK.test(quasi.value.cooked)) {
          report(
            path,
            quasi as Positioned,
            "Hardcoded Chinese text must move into src/i18n messages",
          )
        }
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "errors", "comments", "tokens"].includes(key)) {
        continue
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (isNode(item)) {
            visit(item)
          }
        }
      } else if (isNode(value)) {
        visit(value)
      }
    }
  }
  visit(ast.program)
}

const files = sourceFiles(SRC)
for (const path of files) {
  inspectFile(path)
}

const referenced = new Set<string>()
const dynamicPrefixes: string[] = []
const referenceFiles = [...files, join(I18N_DIR, "languages.ts")]
for (const path of referenceFiles) {
  const content = readFileSync(path, "utf8")
  // Any catalog key used as a constant (navigation, chart types, languages) is
  // still a real reference even when t() receives the variable later.
  for (const match of content.matchAll(/["']([a-zA-Z][\w.-]+)["']/g)) {
    if (hasKey(match[1])) {
      referenced.add(match[1])
    }
  }
  for (const match of content.matchAll(/\bt\(\s*`([^`$]+)\$\{/g)) {
    dynamicPrefixes.push(match[1])
  }
}
for (const key of zh.keys()) {
  if (referenced.has(key)) {
    continue
  }
  if (dynamicPrefixes.some((prefix) => key.startsWith(prefix))) {
    continue
  }
  warnings.push(`Translation key is not statically referenced: ${key}`)
}

if (warnings.length > 0) {
  console.warn(`i18n warnings (${warnings.length}):`)
  for (const warning of warnings) {
    console.warn(`  - ${warning}`)
  }
}

if (errors.length > 0) {
  console.error(`i18n check failed (${errors.length}):`)
  for (const error of errors) {
    console.error(`  - ${error}`)
  }
  process.exit(1)
}

console.log(`i18n check passed: ${zh.size} keys in zh-CN and en, no hardcoded UI text.`)
