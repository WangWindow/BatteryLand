import { afterEach, describe, expect, it, vi } from "vitest"

import {
  ApiError,
  api,
  downloadToFile,
  errorMessage,
  fieldErrors,
  isCursorInvalid,
  queryString,
} from "@/api/client"

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("api client", () => {
  it("unwraps the versioned envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ code: 0, message: "ok", data: { total: 2 } })),
    )
    await expect(api.get<{ total: number }>("/batteries?page=1")).resolves.toEqual({ total: 2 })
  })

  it("maps business errors with field and detail information", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            code: 1001,
            message: "Request validation failed",
            data: {
              error: "invalid_input",
              fields: [{ path: "body.name", message: "Field required" }],
              details: { experiment_id: "abc" },
            },
          },
          422,
        ),
      ),
    )
    const failure = await api.post("/experiments", {}).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect(failure).toMatchObject({
      status: 422,
      code: 1001,
      symbol: "invalid_input",
      message: "Request validation failed",
    })
    expect(fieldErrors(failure)).toEqual({ "body.name": "Field required" })
    expect((failure as ApiError).details).toEqual({ experiment_id: "abc" })
    expect(errorMessage(failure)).toBe("Request validation failed")
  })

  it("recognizes cursor reset independent of message text", () => {
    const failure = new ApiError("expired", { symbol: "cursor_invalid", code: 1009 })
    expect(isCursorInvalid(failure)).toBe(true)
    expect(isCursorInvalid(new Error("expired"))).toBe(false)
  })

  it("uses a stable query encoding and skips empty filters", () => {
    expect(queryString({ page: 2, q: "CALCE 1", empty: "", missing: undefined, zero: 0 })).toBe(
      "?page=2&q=CALCE+1&zero=0",
    )
  })

  it("preserves the server filename for downloads", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new TextEncoder().encode("weights"), {
            status: 200,
            headers: { "Content-Disposition": 'attachment; filename="model.pt"' },
          }),
      ),
    )
    const { filename, blob: content } = await api.download("/artifacts/a/download")
    expect(filename).toBe("model.pt")
    expect(content.size).toBe(7)

    const createObjectURL = vi.fn().mockReturnValue("blob:model")
    const revokeObjectURL = vi.fn()
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    await downloadToFile("/artifacts/a/download")
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:model")
  })
})
