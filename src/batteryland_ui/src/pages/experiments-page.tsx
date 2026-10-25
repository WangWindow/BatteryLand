import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FlaskConicalIcon, PlusIcon, SearchIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"
import { toast } from "sonner"

import { errorMessage } from "@/api/client"
import { endpoints as apiEndpoints } from "@/api/endpoints"
import { queryKeys } from "@/api/query-client"
import { EmptyState, ErrorState, LoadingState } from "@/components/data-state"
import { PageHeader } from "@/components/page-header"
import { PaginationControls } from "@/components/pagination-controls"
import { StatusBadge } from "@/components/status-badge"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { enumLabel, formatDate, shortId } from "@/lib/format"

const STATES = [
  "draft",
  "queued",
  "starting",
  "running",
  "stopping",
  "succeeded",
  "failed",
  "cancelled",
  "stopped",
  "needs_reconciliation",
]

export function ExperimentsPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [draftQuery, setDraftQuery] = useState("")
  const [query, setQuery] = useState("")
  const [state, setState] = useState("")
  const experimentsQuery = useQuery({
    queryKey: queryKeys.experiments({ page, pageSize, query, state }),
    queryFn: ({ signal }) =>
      apiEndpoints.experiments.list(
        { page, pageSize, q: query, state: state || undefined },
        signal,
      ),
  })

  const submitMutation = useMutation({
    mutationFn: (id: string) => apiEndpoints.experiments.submit(id),
    onSuccess: async (experiment) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["experiments"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.queue }),
      ])
      toast.success(t("workflow.list.submitted", { name: experiment.name }))
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const results = experimentsQuery.data?.items ?? []

  return (
    <>
      <PageHeader
        title={t("workflow.list.title")}
        description={t("workflow.list.description")}
        actions={
          <Button asChild>
            <Link to="/experiments/new">
              <PlusIcon data-icon="inline-start" />
              {t("workflow.list.new")}
            </Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <form
            className="flex min-w-56 flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setQuery(draftQuery)
              setPage(1)
            }}
          >
            <Input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              aria-label={t("workflow.list.search")}
              placeholder={t("workflow.list.search")}
            />
            <Button type="submit" variant="outline">
              <SearchIcon data-icon="inline-start" />
              {t("workflow.dataset.applyFilters")}
            </Button>
          </form>
          <Field className="w-full sm:w-52">
            <FieldLabel htmlFor="experiment-state-filter">{t("workflow.list.state")}</FieldLabel>
            <Select
              value={state || "all"}
              onValueChange={(value) => {
                setState(value === "all" ? "" : value)
                setPage(1)
              }}
            >
              <SelectTrigger id="experiment-state-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">{t("workflow.list.state")}</SelectItem>
                  {STATES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {enumLabel(value, "state")}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      {experimentsQuery.isLoading && !experimentsQuery.data ? <LoadingState rows={5} /> : null}
      {experimentsQuery.error ? (
        <ErrorState
          error={experimentsQuery.error}
          onRetry={() => void experimentsQuery.refetch()}
        />
      ) : null}
      {experimentsQuery.data && results.length === 0 ? (
        <EmptyState
          title={t("workflow.list.empty")}
          description={t("workflow.list.emptyHint")}
          action={
            <Button asChild>
              <Link to="/experiments/new">
                <FlaskConicalIcon data-icon="inline-start" />
                {t("workflow.list.new")}
              </Link>
            </Button>
          }
        />
      ) : null}
      {experimentsQuery.data && results.length > 0 ? (
        <>
          <div className="overflow-x-auto rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("workflow.list.name")}</TableHead>
                  <TableHead>{t("workflow.list.state")}</TableHead>
                  <TableHead>{t("workflow.list.device")}</TableHead>
                  <TableHead>{t("workflow.list.created")}</TableHead>
                  <TableHead className="text-right">{t("workflow.list.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((experiment) => (
                  <TableRow key={experiment.id}>
                    <TableCell>
                      <Link
                        to={`/experiments/${experiment.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {experiment.name}
                      </Link>
                      <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                        {shortId(experiment.id)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge state={experiment.state} />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono">
                        {experiment.actual_device ??
                          experiment.effective_device ??
                          experiment.requested_device ??
                          "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(experiment.created_at)}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex flex-wrap justify-end gap-2">
                        {experiment.state === "draft" ? (
                          <>
                            <Button size="sm" variant="outline" asChild>
                              <Link to={`/experiments/${experiment.id}/edit`}>
                                {t("workflow.list.edit")}
                              </Link>
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => submitMutation.mutate(experiment.id)}
                              disabled={submitMutation.isPending}
                            >
                              <FlaskConicalIcon data-icon="inline-start" />
                              {t("workflow.list.submit")}
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" variant="outline" asChild>
                            <Link to={`/experiments/${experiment.id}`}>
                              {t("workflow.list.open")}
                            </Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <PaginationControls
            page={page}
            pageSize={pageSize}
            total={experimentsQuery.data.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </>
      ) : null}
    </>
  )
}
