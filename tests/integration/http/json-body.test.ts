/**
 * Bounded JSON reading policy.
 *
 * Every branch of the reader is a security decision, so each one is pinned to
 * an explicit status: a wrong media type and a malformed document are client
 * mistakes, an oversized document is refused before it is buffered, and a body
 * that never announces its length is still bounded while it streams.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_REQUEST_BODY_BYTES,
  readJsonBody,
} from "../../../src/shared/server/http/json-body";
import { APP_ORIGIN, buildRequest } from "./helpers";

function jsonRequest(body: string, contentType = "application/json"): Request {
  return buildRequest({ method: "POST", contentType, body });
}

/** Streams `text` in small chunks, so no `Content-Length` is announced. */
function chunkedRequest(text: string): Request {
  const encoded = new TextEncoder().encode(text);
  const chunkSize = 1024;
  let offset = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= encoded.byteLength) {
        controller.close();
        return;
      }

      controller.enqueue(encoded.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });

  return new Request(`${APP_ORIGIN}/api/test`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("readJsonBody", () => {
  it("parses a well-formed JSON object", async () => {
    const result = await readJsonBody(jsonRequest('{"amountMinor":1250}'));

    expect(result).toEqual({ ok: true, value: { amountMinor: 1250 } });
  });

  it("accepts a media type that carries a charset parameter", async () => {
    const result = await readJsonBody(
      jsonRequest('{"a":1}', "application/json; charset=utf-8"),
    );

    expect(result.ok).toBe(true);
  });

  it("accepts an upper-case media type", async () => {
    const result = await readJsonBody(
      jsonRequest('{"a":1}', "APPLICATION/JSON"),
    );

    expect(result.ok).toBe(true);
  });

  it.each([
    ["text/plain", "text/plain"],
    ["form encoding", "application/x-www-form-urlencoded"],
    ["a JSON suffix type", "application/merge-patch+json"],
  ])("refuses %s with 400", async (_reason, contentType) => {
    const result = await readJsonBody(jsonRequest('{"a":1}', contentType));

    expect(result).toEqual({
      ok: false,
      failure: { code: "badRequest", status: 400 },
    });
  });

  it("refuses a request without a content type with 400", async () => {
    const request = buildRequest({
      method: "POST",
      contentType: null,
      body: '{"a":1}',
    });
    const result = await readJsonBody(request);

    expect(result).toEqual({
      ok: false,
      failure: { code: "badRequest", status: 400 },
    });
  });

  it.each([
    ["a truncated object", "{"],
    ["a trailing comma", '{"a":1,}'],
    ["plain text", "not json at all"],
  ])("refuses %s with 400", async (_reason, body) => {
    const result = await readJsonBody(jsonRequest(body));

    expect(result).toEqual({
      ok: false,
      failure: { code: "badRequest", status: 400 },
    });
  });

  it("refuses an empty body with 400", async () => {
    const result = await readJsonBody(jsonRequest(""));

    expect(result).toEqual({
      ok: false,
      failure: { code: "badRequest", status: 400 },
    });
  });

  it("refuses a request that carries no body at all with 400", async () => {
    const request = new Request(`${APP_ORIGIN}/api/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    expect(request.body).toBeNull();
    await expect(readJsonBody(request)).resolves.toEqual({
      ok: false,
      failure: { code: "badRequest", status: 400 },
    });
  });

  it("refuses a body sent without any content type with 400", async () => {
    const request = new Request(`${APP_ORIGIN}/api/test`, {
      method: "POST",
      body: new Uint8Array([0x7b, 0x7d]),
    });

    expect(request.headers.get("content-type")).toBeNull();
    await expect(readJsonBody(request)).resolves.toEqual({
      ok: false,
      failure: { code: "badRequest", status: 400 },
    });
  });

  it("refuses a body that is not valid UTF-8 with 400", async () => {
    const request = new Request(`${APP_ORIGIN}/api/test`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]),
    });
    const result = await readJsonBody(request);

    expect(result).toEqual({
      ok: false,
      failure: { code: "badRequest", status: 400 },
    });
  });

  it("refuses a non-numeric content length with 400", async () => {
    const request = buildRequest({
      method: "POST",
      body: '{"a":1}',
      headers: { "content-length": "many" },
    });
    const result = await readJsonBody(request);

    expect(result).toEqual({
      ok: false,
      failure: { code: "badRequest", status: 400 },
    });
  });

  it("accepts a body of exactly the accepted size", async () => {
    const padding = "a".repeat(MAX_REQUEST_BODY_BYTES - 11);
    const body = `{"note":"${padding}"}`;

    expect(new TextEncoder().encode(body).byteLength).toBe(
      MAX_REQUEST_BODY_BYTES,
    );
    await expect(readJsonBody(jsonRequest(body))).resolves.toEqual({
      ok: true,
      value: { note: padding },
    });
  });

  it("refuses an announced length over the budget with 413", async () => {
    const request = buildRequest({
      method: "POST",
      body: '{"a":1}',
      headers: { "content-length": String(MAX_REQUEST_BODY_BYTES + 1) },
    });
    const result = await readJsonBody(request);

    expect(result).toEqual({
      ok: false,
      failure: { code: "payloadTooLarge", status: 413 },
    });
  });

  it("refuses a body one byte over the budget with 413", async () => {
    const body = `{"note":"${"a".repeat(MAX_REQUEST_BODY_BYTES - 10)}"}`;

    expect(new TextEncoder().encode(body).byteLength).toBe(
      MAX_REQUEST_BODY_BYTES + 1,
    );
    await expect(readJsonBody(jsonRequest(body))).resolves.toEqual({
      ok: false,
      failure: { code: "payloadTooLarge", status: 413 },
    });
  });

  it("bounds a streamed body that never announces its length", async () => {
    const body = `{"note":"${"a".repeat(MAX_REQUEST_BODY_BYTES * 2)}"}`;
    const request = chunkedRequest(body);

    expect(request.headers.get("content-length")).toBeNull();
    await expect(readJsonBody(request)).resolves.toEqual({
      ok: false,
      failure: { code: "payloadTooLarge", status: 413 },
    });
  });

  it("parses a streamed body that stays inside the budget", async () => {
    const note = "a".repeat(4096);
    const result = await readJsonBody(chunkedRequest(`{"note":"${note}"}`));

    expect(result).toEqual({ ok: true, value: { note } });
  });

  it("returns the parsed value without shaping it", async () => {
    await expect(readJsonBody(jsonRequest("[1,2]"))).resolves.toEqual({
      ok: true,
      value: [1, 2],
    });
    await expect(readJsonBody(jsonRequest("null"))).resolves.toEqual({
      ok: true,
      value: null,
    });
  });
});
