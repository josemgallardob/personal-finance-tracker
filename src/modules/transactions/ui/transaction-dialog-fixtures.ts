import { REQUEST_ID_HEADER } from "../../../shared/contracts/http";
import { API_ERROR_MESSAGE } from "../../../shared/contracts/api";
import type { FetchLike } from "../../../shared/client/api-client";
import { vi } from "vitest";
import type { TransactionDto } from "../contracts/transaction";

export const REQUEST_ID = "req-maintain";
export const today = "2026-09-08";

export const preferences = {
  locale: "es-ES",
  currency: "EUR",
  timeZone: "Europe/Madrid",
  mode: "personal",
  today,
};

export const categories = [
  {
    id: "cat-food",
    name: "Alimentación",
    type: "expense" as const,
    isArchived: false,
  },
  {
    id: "cat-old",
    name: "Antigua",
    type: "expense" as const,
    isArchived: true,
  },
  {
    id: "cat-archived-other",
    name: "Otra archivada",
    type: "expense" as const,
    isArchived: true,
  },
  {
    id: "cat-salary",
    name: "Nómina",
    type: "income" as const,
    isArchived: false,
  },
];

export const tags = [
  { id: "tag-trips", name: "Viajes", isArchived: false },
  { id: "tag-old", name: "Vieja", isArchived: true },
  { id: "tag-archived-other", name: "Otra etiqueta", isArchived: true },
];

export const movement: TransactionDto = {
  id: "tx-1",
  type: "expense",
  amountMinor: 1250,
  date: "2026-08-01",
  categoryId: "cat-food",
  concept: "Supermercado",
  note: "Semanal",
  tagIds: ["tag-trips"],
};

export const archivedMovement: TransactionDto = {
  ...movement,
  id: "tx-archived",
  categoryId: "cat-old",
  tagIds: ["tag-old"],
  concept: null,
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  });
}

export function noContentResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: { [REQUEST_ID_HEADER]: REQUEST_ID },
  });
}

export function envelope<T>(data: T) {
  return { data, requestId: REQUEST_ID };
}

export function notFoundResponse(): Response {
  return jsonResponse(404, {
    error: {
      code: "notFound",
      message: API_ERROR_MESSAGE.notFound,
      requestId: REQUEST_ID,
    },
  });
}

export function maintenanceFetch(options?: {
  movement?: TransactionDto;
  onMutate?: (
    method: string,
    path: string,
    body: unknown,
  ) => Promise<Response> | Response;
}): ReturnType<typeof vi.fn<FetchLike>> {
  const current = options?.movement ?? movement;
  return vi.fn<FetchLike>(async (path, init) => {
    const method = init.method ?? "GET";
    if (path.startsWith("/api/preferences")) {
      return jsonResponse(200, envelope(preferences));
    }
    if (path.startsWith("/api/categories")) {
      return jsonResponse(200, envelope(categories));
    }
    if (path.startsWith("/api/tags")) {
      return jsonResponse(200, envelope(tags));
    }
    if (path === `/api/transactions/${current.id}` && method === "GET") {
      return jsonResponse(200, envelope(current));
    }
    if (options?.onMutate && method !== "GET") {
      const payload = init.body ? JSON.parse(String(init.body)) : null;
      return options.onMutate(method, path, payload);
    }
    if (path === `/api/transactions/${current.id}` && method === "PUT") {
      const payload = init.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse(
        200,
        envelope({ ...current, ...payload, tagIds: [] }),
      );
    }
    if (path === "/api/transactions" && method === "POST") {
      const payload = init.body ? JSON.parse(String(init.body)) : {};
      return jsonResponse(
        201,
        envelope({
          id: "tx-copy",
          type: payload.type ?? "expense",
          amountMinor: payload.amountMinor ?? 0,
          date: payload.date ?? today,
          categoryId: payload.categoryId ?? "cat-food",
          concept: payload.concept ?? null,
          note: payload.note ?? null,
          tagIds: [],
        }),
      );
    }
    if (path === `/api/transactions/${current.id}` && method === "DELETE") {
      return noContentResponse();
    }
    return notFoundResponse();
  });
}
