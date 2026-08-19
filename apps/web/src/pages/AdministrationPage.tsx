import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

type Organization = {
  id: string;
  code: string;
  name: string;
};

type Role = {
  id: string;
  code: string;
  name: string;
  permissions: string[];
  userCount: number;
};

type User = {
  id: string;
  email: string;
  name: string;
  status: string;
  organizationId?: string | null;
  organization?: Organization | null;
  roles?: {
    role: {
      id: string;
      code: string;
      name: string;
    };
  }[];
  createdAt: string;
  updatedAt: string;
};

type AdministrationPageProps = {
  token: string;
};

const API = "";

function apiError(result: any, fallback: string) {
  return (
    result?.errors?.[0]?.message ??
    fallback
  );
}

export function AdministrationPage({
  token,
}: AdministrationPageProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState<"users" | "roles">("users");

  const [showUserForm, setShowUserForm] = useState(false);
  const [userEmail, setUserEmail] = useState("");
  const [userName, setUserName] = useState("");
  const [userPassword, setUserPassword] = useState("");
  const [userRoleId, setUserRoleId] = useState("");

  const [showRoleForm, setShowRoleForm] = useState(false);
  const [roleCode, setRoleCode] = useState("");
  const [roleName, setRoleName] = useState("");

  const [editingUserId, setEditingUserId] = useState("");
  const [editingUserName, setEditingUserName] = useState("");

  const [editingRoleId, setEditingRoleId] = useState("");
  const [editingRoleName, setEditingRoleName] = useState("");

  const [permissionRoleId, setPermissionRoleId] = useState("");
  const [permissionRoleName, setPermissionRoleName] = useState("");
  const [permissions, setPermissions] = useState<
    { id: string; code: string; description?: string | null }[]
  >([]);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<
    string[]
  >([]);

  const loadAdministration = useCallback(async () => {
    if (!token) return;

    setLoading(true);
    setError("");

    try {
      const headers = {
        Authorization: `Bearer ${token}`,
      };

      const [usersResponse, rolesResponse] = await Promise.all([
        fetch(`${API}/api/users`, { headers }),
        fetch(`${API}/api/roles`, { headers }),
      ]);

      const [usersResult, rolesResult] = await Promise.all([
        usersResponse.json(),
        rolesResponse.json(),
      ]);

      if (!usersResponse.ok) {
        throw new Error(
          apiError(usersResult, "Unable to load users"),
        );
      }

      if (!rolesResponse.ok) {
        throw new Error(
          apiError(rolesResult, "Unable to load roles"),
        );
      }

      setUsers(usersResult.data ?? []);
      setRoles(rolesResult.data ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load Administration",
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAdministration();
  }, [loadAdministration]);

  const activeUsers = useMemo(
    () => users.filter((user) => user.status === "ACTIVE").length,
    [users],
  );

  const activeRoles = roles.length;

  function resetUserForm() {
    setUserEmail("");
    setUserName("");
    setUserPassword("");
    setUserRoleId("");
    setShowUserForm(false);
  }

  function resetRoleForm() {
    setRoleCode("");
    setRoleName("");
    setShowRoleForm(false);
  }

  async function createUser(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (!userEmail.trim() || !userName.trim() || !userPassword) {
      setError("Email, name and password are required.");
      return;
    }

    if (userPassword.length < 12) {
      setError("Password must contain at least 12 characters.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API}/api/users`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: userEmail.trim(),
          name: userName.trim(),
          password: userPassword,
          roleId: userRoleId || undefined,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to create user"),
        );
      }

      resetUserForm();
      await loadAdministration();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create user",
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateUser(userId: string) {
    if (!editingUserName.trim()) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${API}/api/users/${userId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editingUserName.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to update user"),
        );
      }

      setEditingUserId("");
      setEditingUserName("");
      await loadAdministration();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update user",
      );
    } finally {
      setSaving(false);
    }
  }

  async function disableUser(user: User) {
    if (
      !window.confirm(
        `Disable user ${user.email}?`,
      )
    ) {
      return;
    }

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        `${API}/api/users/${user.id}/disable`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to disable user"),
        );
      }

      await loadAdministration();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to disable user",
      );
    } finally {
      setSaving(false);
    }
  }

  async function createRole(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (!roleCode.trim() || !roleName.trim()) {
      setError("Role code and name are required.");
      return;
    }

    setSaving(true);

    try {
      const response = await fetch(`${API}/api/roles`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code: roleCode.trim(),
          name: roleName.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to create role"),
        );
      }

      resetRoleForm();
      await loadAdministration();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to create role",
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateRole(roleId: string) {
    if (!editingRoleName.trim()) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${API}/api/roles/${roleId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: editingRoleName.trim(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to update role"),
        );
      }

      setEditingRoleId("");
      setEditingRoleName("");
      await loadAdministration();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to update role",
      );
    } finally {
      setSaving(false);
    }
  }

  async function openPermissions(role: Role) {
    setError("");
    setPermissionRoleId("");
    setPermissions([]);
    setSelectedPermissionIds([]);

    try {
      const response = await fetch(
        `${API}/api/roles/${role.id}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to load role permissions"),
        );
      }

      const roleData = result.data;

      const rolePermissions =
        (roleData?.permissions ?? []) as {
          id: string;
          code: string;
          description?: string | null;
        }[];

      setPermissionRoleName(
        roleData?.name ?? role.name,
      );
      setPermissions(rolePermissions);
      setSelectedPermissionIds(
        rolePermissions.map((permission) => permission.id),
      );
      setPermissionRoleId(role.id);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to load role permissions",
      );
    }
  }

  function togglePermission(permissionId: string) {
    setSelectedPermissionIds((current) =>
      current.includes(permissionId)
        ? current.filter((id) => id !== permissionId)
        : [...current, permissionId],
    );
  }

  async function savePermissions() {
    if (!permissionRoleId) return;

    setSaving(true);
    setError("");

    try {
      const response = await fetch(
        `${API}/api/roles/${permissionRoleId}/permissions`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            permissionIds: selectedPermissionIds,
          }),
        },
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          apiError(result, "Unable to save permissions"),
        );
      }

      setPermissionRoleId("");
      setPermissionRoleName("");
      setPermissions([]);
      setSelectedPermissionIds([]);
      await loadAdministration();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to save permissions",
      );
    } finally {
      setSaving(false);
    }
  }



  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <div>
            <div className="eyebrow">ADMINISTRATION</div>
            <h2>Administration</h2>
            <p>Manage users, roles and access control.</p>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadAdministration()}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="cards">
          <div className="card">
            <span>Total Users</span>
            <strong>{users.length}</strong>
          </div>

          <div className="card">
            <span>Active Users</span>
            <strong>{activeUsers}</strong>
          </div>

          <div className="card">
            <span>Roles</span>
            <strong>{activeRoles}</strong>
          </div>
        </div>

        {error && <div className="error">{error}</div>}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="tabs">
            <button
              type="button"
              className={
                activeTab === "users"
                  ? "tab active"
                  : "tab"
              }
              onClick={() => setActiveTab("users")}
            >
              Users
            </button>

            <button
              type="button"
              className={
                activeTab === "roles"
                  ? "tab active"
                  : "tab"
              }
              onClick={() => setActiveTab("roles")}
            >
              Roles
            </button>
          </div>

          {activeTab === "users" ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setShowUserForm((value) => !value);
                setError("");
              }}
            >
              {showUserForm ? "Close" : "+ New User"}
            </button>
          ) : (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setShowRoleForm((value) => !value);
                setError("");
              }}
            >
              {showRoleForm ? "Close" : "+ New Role"}
            </button>
          )}
        </div>

        {activeTab === "users" && showUserForm && (
          <form className="form-grid" onSubmit={createUser}>
            <label>
              Email
              <input
                type="email"
                value={userEmail}
                onChange={(event) =>
                  setUserEmail(event.target.value)
                }
                required
              />
            </label>

            <label>
              Name
              <input
                value={userName}
                onChange={(event) =>
                  setUserName(event.target.value)
                }
                required
              />
            </label>

            <label>
              Password
              <input
                type="password"
                value={userPassword}
                onChange={(event) =>
                  setUserPassword(event.target.value)
                }
                minLength={12}
                required
              />
            </label>

            <label>
              Role
              <select
                value={userRoleId}
                onChange={(event) =>
                  setUserRoleId(event.target.value)
                }
              >
                <option value="">No role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.code} — {role.name}
                  </option>
                ))}
              </select>
            </label>

            <div style={{ display: "flex", alignItems: "end" }}>
              <button
                type="submit"
                className="primary-button"
                disabled={saving}
              >
                {saving ? "Creating..." : "Create User"}
              </button>
            </div>
          </form>
        )}

        {activeTab === "roles" && showRoleForm && (
          <form className="form-grid" onSubmit={createRole}>
            <label>
              Code
              <input
                value={roleCode}
                onChange={(event) =>
                  setRoleCode(event.target.value)
                }
                placeholder="ACCOUNTANT"
                required
              />
            </label>

            <label>
              Name
              <input
                value={roleName}
                onChange={(event) =>
                  setRoleName(event.target.value)
                }
                placeholder="Accountant"
                required
              />
            </label>

            <div style={{ display: "flex", alignItems: "end" }}>
              <button
                type="submit"
                className="primary-button"
                disabled={saving}
              >
                {saving ? "Creating..." : "Create Role"}
              </button>
            </div>
          </form>
        )}

        {activeTab === "users" ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Organization</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      {editingUserId === user.id ? (
                        <input
                          value={editingUserName}
                          onChange={(event) =>
                            setEditingUserName(event.target.value)
                          }
                        />
                      ) : (
                        <>
                          <strong>{user.name}</strong>
                          <div>{user.email}</div>
                        </>
                      )}
                    </td>

                    <td>
                      {user.organization?.name ??
                        user.organization?.code ??
                        "—"}
                    </td>

                    <td>
                      {(user.roles ?? [])
                        .map((item) => item.role.name)
                        .join(", ") || "—"}
                    </td>

                    <td>
                      <span
                        className={`status ${user.status.toLowerCase()}`}
                      >
                        {user.status}
                      </span>
                    </td>

                    <td>
                      {editingUserId === user.id ? (
                        <div className="button-row">
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() =>
                              void updateUser(user.id)
                            }
                            disabled={saving}
                          >
                            Save
                          </button>

                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              setEditingUserId("");
                              setEditingUserName("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="button-row">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              setEditingUserId(user.id);
                              setEditingUserName(user.name);
                            }}
                          >
                            Edit
                          </button>

                          {user.status === "ACTIVE" && (
                            <button
                              type="button"
                              className="secondary-button"
                              onClick={() =>
                                void disableUser(user)
                              }
                              disabled={saving}
                            >
                              Disable
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}

                {users.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty">
                        No users found.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Role</th>
                  <th>Users</th>
                  <th>Permissions</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td>
                      <strong>{role.code}</strong>
                    </td>

                    <td>
                      {editingRoleId === role.id ? (
                        <input
                          value={editingRoleName}
                          onChange={(event) =>
                            setEditingRoleName(event.target.value)
                          }
                        />
                      ) : (
                        role.name
                      )}
                    </td>

                    <td>{role.userCount}</td>

                    <td>
                      {role.permissions.length}
                    </td>

                    <td>
                      {editingRoleId === role.id ? (
                        <div className="button-row">
                          <button
                            type="button"
                            className="primary-button"
                            onClick={() =>
                              void updateRole(role.id)
                            }
                            disabled={saving}
                          >
                            Save
                          </button>

                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              setEditingRoleId("");
                              setEditingRoleName("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="button-row">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => {
                              setEditingRoleId(role.id);
                              setEditingRoleName(role.name);
                            }}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() =>
                              void openPermissions(role)
                            }
                          >
                            Permissions
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}

                {roles.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="empty">
                        No roles found.
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {permissionRoleId && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">ACCESS CONTROL</div>
              <h2>Role Permissions</h2>
              <p>
                Configure permissions for {permissionRoleName}.
              </p>
            </div>

            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setPermissionRoleId("");
                  setPermissionRoleName("");
                  setPermissions([]);
                  setSelectedPermissionIds([]);
                }}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="button"
                className="primary-button"
                onClick={() => void savePermissions()}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Permissions"}
              </button>
            </div>
          </div>

          {permissions.length === 0 ? (
            <div className="empty">
              No permissions are currently assigned to this role.
            </div>
          ) : (
            <div className="permission-grid">
              {permissions.map((permission) => (
                <label
                  key={permission.id}
                  className="permission-option"
                >
                  <input
                    type="checkbox"
                    checked={selectedPermissionIds.includes(
                      permission.id,
                    )}
                    onChange={() =>
                      togglePermission(permission.id)
                    }
                  />

                  <span>
                    <strong>{permission.code}</strong>
                    {permission.description && (
                      <small>{permission.description}</small>
                    )}
                  </span>
                </label>
              ))}
            </div>
          )}

          <div className="permission-summary">
            {selectedPermissionIds.length} permission
            {selectedPermissionIds.length === 1 ? "" : "s"} selected
          </div>
        </section>
      )}
    </>
  );
}
