import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export function PaginationControls({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
}) {
  const { t } = useTranslation()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>{t("common.pagination.summary", { total, page, pages })}</span>
      <div className="flex items-center gap-2">
        {onPageSizeChange ? (
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger className="w-28" aria-label={t("common.pagination.pageSizeLabel")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[25, 50, 100, 200].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {t("common.pagination.pageSize", { size })}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          {t("common.pagination.previous")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          {t("common.pagination.next")}
        </Button>
      </div>
    </div>
  )
}
