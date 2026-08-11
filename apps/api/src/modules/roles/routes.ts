import { FastifyInstance } from "fastify";
import { PrismaClient } from "../../../../../packages/database/generated/prisma/client";
import {
  AuthClaims,
  authenticate,
  requirePermission,
} from "../../auth/authorization";
import { writeAuditEvent } from "../../audit/audit";

export async function roleRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
) {
  /*
   * GET /api/roles
   */
  app.get("/api/roles", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "role.view",
    );

    if (permissionResult) {
      return permissionResult;
    }

    const claims = request.user as AuthClaims;

    const roles = await prisma.role.findMany({
      where: {
        tenantId: claims.tenantId,
      },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        _count: {
          select: {
            users: true,
          },
        },
      },
      orderBy: {
        code: "asc",
      },
    });

    return {
      data: roles.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        permissions: role.permissions.map(
          (item) => item.permission.code,
        ),
        userCount: role._count.users,
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      })),
    };
  });

  /*
   * GET /api/roles/:id
   */
  app.get("/api/roles/:id", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "role.view",
    );

    if (permissionResult) {
      return permissionResult;
    }

    const claims = request.user as AuthClaims;

    const params = request.params as {
      id: string;
    };

    const role = await prisma.role.findFirst({
      where: {
        id: params.id,
        tenantId: claims.tenantId,
      },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        users: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!role) {
      return reply.code(404).send({
        errors: [
          {
            code: "NOT_FOUND",
            message: "Role not found",
          },
        ],
      });
    }

    return {
      data: {
        id: role.id,
        code: role.code,
        name: role.name,
        permissions: role.permissions.map(
          (item) => ({
            id: item.permission.id,
            code: item.permission.code,
            description: item.permission.description,
          }),
        ),
        users: role.users.map(
          (item) => item.user,
        ),
        createdAt: role.createdAt,
        updatedAt: role.updatedAt,
      },
    };
  });

  /*
   * POST /api/roles
   */
  app.post("/api/roles", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "role.create",
    );

    if (permissionResult) {
      return permissionResult;
    }

    const claims = request.user as AuthClaims;

    const body = request.body as {
      code?: string;
      name?: string;
    };

    if (!body.code || !body.name) {
      return reply.code(400).send({
        errors: [
          {
            code: "VALIDATION_ERROR",
            message: "code and name are required",
          },
        ],
      });
    }

    const code = body.code.trim().toUpperCase();
    const name = body.name.trim();

    const existing = await prisma.role.findFirst({
      where: {
        tenantId: claims.tenantId,
        code,
      },
    });

    if (existing) {
      return reply.code(409).send({
        errors: [
          {
            code: "DUPLICATE_CODE",
            message: "Role code already exists",
          },
        ],
      });
    }

    const role = await prisma.role.create({
      data: {
        tenantId: claims.tenantId,
        code,
        name,
      },
    });

    await writeAuditEvent(prisma, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      action: "CREATE",
      entityType: "Role",
      entityId: role.id,
      newState: role,
    });

    return reply.code(201).send({
      data: role,
    });
  });

  /*
   * PATCH /api/roles/:id
   */
  app.patch("/api/roles/:id", async (request, reply) => {
    const authResult = await authenticate(request, reply);

    if (authResult) {
      return authResult;
    }

    const permissionResult = await requirePermission(
      request,
      reply,
      "role.update",
    );

    if (permissionResult) {
      return permissionResult;
    }

    const claims = request.user as AuthClaims;

    const params = request.params as {
      id: string;
    };

    const body = request.body as {
      name?: string;
    };

    const existing = await prisma.role.findFirst({
      where: {
        id: params.id,
        tenantId: claims.tenantId,
      },
    });

    if (!existing) {
      return reply.code(404).send({
        errors: [
          {
            code: "NOT_FOUND",
            message: "Role not found",
          },
        ],
      });
    }

    const role = await prisma.role.update({
      where: {
        id: existing.id,
      },
      data: {
        ...(body.name !== undefined
          ? { name: body.name.trim() }
          : {}),
      },
    });

    await writeAuditEvent(prisma, {
      tenantId: claims.tenantId,
      actorUserId: claims.sub,
      action: "UPDATE",
      entityType: "Role",
      entityId: role.id,
      previousState: existing,
      newState: role,
    });

    return {
      data: role,
    };
  });

  /*
   * PUT /api/roles/:id/permissions
   *
   * Replaces the complete permission set.
   */
  app.put(
    "/api/roles/:id/permissions",
    async (request, reply) => {
      const authResult = await authenticate(request, reply);

      if (authResult) {
        return authResult;
      }

      const permissionResult = await requirePermission(
        request,
        reply,
        "role.manage",
      );

      if (permissionResult) {
        return permissionResult;
      }

      const claims = request.user as AuthClaims;

      const params = request.params as {
        id: string;
      };

      const body = request.body as {
        permissionIds?: string[];
      };

      if (!Array.isArray(body.permissionIds)) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message:
                "permissionIds must be an array",
            },
          ],
        });
      }

      const role = await prisma.role.findFirst({
        where: {
          id: params.id,
          tenantId: claims.tenantId,
        },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      if (!role) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Role not found",
            },
          ],
        });
      }

      const permissions =
        body.permissionIds.length > 0
          ? await prisma.permission.findMany({
              where: {
                id: {
                  in: body.permissionIds,
                },
              },
            })
          : [];

      if (
        permissions.length !==
        new Set(body.permissionIds).size
      ) {
        return reply.code(400).send({
          errors: [
            {
              code: "INVALID_PERMISSION",
              message:
                "One or more permissions are invalid",
            },
          ],
        });
      }

      const previousPermissions =
        role.permissions.map(
          (item) => item.permission.code,
        );

      await prisma.$transaction(async (tx) => {
        await tx.rolePermission.deleteMany({
          where: {
            roleId: role.id,
          },
        });

        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((permission) => ({
              roleId: role.id,
              permissionId: permission.id,
            })),
          });
        }
      });

      const updatedRole =
        await prisma.role.findUnique({
          where: {
            id: role.id,
          },
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "UPDATE_PERMISSIONS",
        entityType: "Role",
        entityId: role.id,
        previousState: {
          permissions: previousPermissions,
        },
        newState: {
          permissions:
            updatedRole?.permissions.map(
              (item) =>
                item.permission.code,
            ) ?? [],
        },
      });

      return {
        data: {
          id: updatedRole!.id,
          code: updatedRole!.code,
          name: updatedRole!.name,
          permissions:
            updatedRole!.permissions.map(
              (item) => item.permission.code,
            ),
        },
      };
    },
  );

  /*
   * POST /api/users/:id/roles
   */
  app.post(
    "/api/users/:id/roles",
    async (request, reply) => {
      const authResult = await authenticate(
        request,
        reply,
      );

      if (authResult) {
        return authResult;
      }

      const permissionResult =
        await requirePermission(
          request,
          reply,
          "role.manage",
        );

      if (permissionResult) {
        return permissionResult;
      }

      const claims =
        request.user as AuthClaims;

      const params = request.params as {
        id: string;
      };

      const body = request.body as {
        roleId?: string;
      };

      if (!body.roleId) {
        return reply.code(400).send({
          errors: [
            {
              code: "VALIDATION_ERROR",
              message: "roleId is required",
            },
          ],
        });
      }

      const user =
        await prisma.user.findFirst({
          where: {
            id: params.id,
            tenantId: claims.tenantId,
          },
        });

      if (!user) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "User not found",
            },
          ],
        });
      }

      const role =
        await prisma.role.findFirst({
          where: {
            id: body.roleId,
            tenantId: claims.tenantId,
          },
        });

      if (!role) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "Role not found",
            },
          ],
        });
      }

      const existing =
        await prisma.userRole.findFirst({
          where: {
            userId: user.id,
            roleId: role.id,
          },
        });

      if (existing) {
        return reply.code(409).send({
          errors: [
            {
              code: "DUPLICATE_ASSIGNMENT",
              message:
                "Role is already assigned to this user",
            },
          ],
        });
      }

      const assignment =
        await prisma.userRole.create({
          data: {
            userId: user.id,
            roleId: role.id,
          },
        });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "ASSIGN_ROLE",
        entityType: "User",
        entityId: user.id,
        newState: {
          roleId: role.id,
          roleCode: role.code,
        },
      });

      return reply.code(201).send({
        data: assignment,
      });
    },
  );

  /*
   * DELETE /api/users/:id/roles/:roleId
   */
  app.delete(
    "/api/users/:id/roles/:roleId",
    async (request, reply) => {
      const authResult = await authenticate(
        request,
        reply,
      );

      if (authResult) {
        return authResult;
      }

      const permissionResult =
        await requirePermission(
          request,
          reply,
          "role.manage",
        );

      if (permissionResult) {
        return permissionResult;
      }

      const claims =
        request.user as AuthClaims;

      const params = request.params as {
        id: string;
        roleId: string;
      };

      const user =
        await prisma.user.findFirst({
          where: {
            id: params.id,
            tenantId: claims.tenantId,
          },
        });

      if (!user) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message: "User not found",
            },
          ],
        });
      }

      const assignment =
        await prisma.userRole.findFirst({
          where: {
            userId: user.id,
            roleId: params.roleId,
          },
          include: {
            role: true,
          },
        });

      if (!assignment) {
        return reply.code(404).send({
          errors: [
            {
              code: "NOT_FOUND",
              message:
                "Role assignment not found",
            },
          ],
        });
      }

      await prisma.userRole.delete({
        where: {
          userId_roleId: {
            userId: assignment.userId,
            roleId: assignment.roleId,
          },
        },
      });

      await writeAuditEvent(prisma, {
        tenantId: claims.tenantId,
        actorUserId: claims.sub,
        action: "REMOVE_ROLE",
        entityType: "User",
        entityId: user.id,
        previousState: {
          roleId: assignment.roleId,
          roleCode: assignment.role.code,
        },
      });

      return {
        data: {
          success: true,
        },
      };
    },
  );
}
