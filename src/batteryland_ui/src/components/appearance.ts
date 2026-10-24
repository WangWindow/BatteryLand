export const APPEARANCE_STORAGE_KEY = "batteryland.appearance"
export const APPEARANCE_QUERY = "(prefers-color-scheme: dark)"

export type AppearancePreference = "light" | "dark" | "system"

export function readAppearancePreference(): AppearancePreference {
  const saved = localStorage.getItem(APPEARANCE_STORAGE_KEY)
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system"
}

export function applyAppearancePreference(preference: AppearancePreference): void {
  const useDarkTheme =
    preference === "dark" ||
    (preference === "system" && window.matchMedia(APPEARANCE_QUERY).matches)
  document.documentElement.classList.toggle("dark", useDarkTheme)
}
