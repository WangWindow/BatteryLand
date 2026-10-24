import { AlertTriangleIcon } from "lucide-react"
import { Component, type ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

type BoundaryProps = {
  title: string
  description: string
  retryLabel: string
  children: ReactNode
}

class LoadBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>{this.props.title}</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{this.props.description}</span>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              {this.props.retryLabel}
            </Button>
          </AlertDescription>
        </Alert>
      )
    }
    return this.props.children
  }
}

export function LazyBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <LoadBoundary
      title={t("common.lazyLoadFailedTitle")}
      description={t("common.lazyLoadFailedDescription")}
      retryLabel={t("common.retryLoad")}
    >
      {children}
    </LoadBoundary>
  )
}
