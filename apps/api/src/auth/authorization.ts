import { FastifyReply, FastifyRequest } from "fastify";

export type AuthClaims = {
  sub: string;
  tenantId: string;
  organizationId: string | null;
  roles: string[];
  permissions: string[];
};

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({
      errors: [
        {
          code: "AUTHENTICATION_ERROR",
          message: "Authentication required",
        },
      ],
    });
  }
}

export async function requirePermission(
  request: FastifyRequest,
  reply: FastifyReply,
  permission: string,
) {
  const claims = request.user as AuthClaims;

  if (!claims.permissions?.includes(permission)) {
    return reply.code(403).send({
      errors: [
        {
          code: "AUTHORIZATION_ERROR",
          message: `Missing permission: ${permission}`,
        },
      ],
    });
  }
}
