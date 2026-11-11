import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("sends same-origin credentials and returns json", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.get<{ ok: boolean }>("/state")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/state",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("throws ApiError with server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Nicht angemeldet" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(api.get("/state")).rejects.toEqual(
      expect.objectContaining({ status: 401, message: "Nicht angemeldet" }),
    );
    await expect(api.get("/state")).rejects.toBeInstanceOf(ApiError);
  });
});
