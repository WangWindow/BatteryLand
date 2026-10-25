import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useState,
} from "react"
import type { Selection } from "../lib/selection"

const Context = createContext<{ value: Selection; setValue: Dispatch<SetStateAction<Selection>> } | null>(
  null,
)
export function SelectionProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<Selection>(() => {
    try {
      const saved = sessionStorage.getItem("batteryland.selection.v1")
      return saved ? (JSON.parse(saved) as Selection) : {}
    } catch {
      return {}
    }
  })
  useEffect(() => {
    sessionStorage.setItem("batteryland.selection.v1", JSON.stringify(value))
  }, [value])
  return <Context.Provider value={{ value, setValue }}>{children}</Context.Provider>
}
export function useSelection() {
  const state = useContext(Context)
  if (!state) throw new Error("SelectionProvider is missing")
  return state
}
