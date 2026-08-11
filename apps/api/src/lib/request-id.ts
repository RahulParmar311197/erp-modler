import { randomUUID } from "node:crypto";
import { FastifyInstance } from "fastify";

export function registerRequestId(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    const incomingId =
      request.headers["x-request-id"];

    const requestId =
      typeof incomingId === "string" &&
      incomingId.trim().length > 0
        ? incomingId
        : randomUUID();

    request.headers["x-request-id"] = requestId;

    reply.header(
      "x-request-id",
      requestId,
    );
  });
}
