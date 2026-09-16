import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createPublicContext(): TrpcContext {
  return {
    user: null,
    req: {
      protocol: "https",
      headers: {},
      get: () => "localhost:3000",
    } as any,
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as any,
  };
}

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-admin",
    email: "marcelo@primetax.com.br",
    name: "Marcelo",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
      get: () => "localhost:3000",
    } as any,
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as any,
  };
}

function createUserContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "test-user",
    email: "user@primetax.com.br",
    name: "User Test",
    loginMethod: "local",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {},
      get: () => "localhost:3000",
    } as any,
    res: {
      clearCookie: () => {},
      cookie: () => {},
    } as any,
  };
}

describe("localUsers.list", () => {
  it("requires admin role", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.localUsers.list()).rejects.toThrow();
  });

  it("rejects non-admin users", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.localUsers.list()).rejects.toThrow();
  });
});

describe("localUsers.create", () => {
  it("requires admin role", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localUsers.create({
        nome: "Test User",
        email: "test@example.com",
        senha: "123456",
        role: "user",
      })
    ).rejects.toThrow();
  });

  it("rejects non-admin users", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localUsers.create({
        nome: "Test User",
        email: "test@example.com",
        senha: "123456",
        role: "user",
      })
    ).rejects.toThrow();
  });

  it("validates email format", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localUsers.create({
        nome: "Test User",
        email: "not-an-email",
        senha: "123456",
        role: "user",
      })
    ).rejects.toThrow();
  });

  it("validates minimum password length", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localUsers.create({
        nome: "Test User",
        email: "test@example.com",
        senha: "12345",
        role: "user",
      })
    ).rejects.toThrow();
  });

  it("validates minimum name length", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localUsers.create({
        nome: "A",
        email: "test@example.com",
        senha: "123456",
        role: "user",
      })
    ).rejects.toThrow();
  });
});

describe("localUsers.delete", () => {
  it("requires admin role", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.localUsers.delete({ id: 1 })).rejects.toThrow();
  });

  it("rejects non-admin users", async () => {
    const ctx = createUserContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.localUsers.delete({ id: 1 })).rejects.toThrow();
  });
});

describe("localUsers.toggleActive", () => {
  it("requires admin role", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localUsers.toggleActive({ id: 1, active: false })
    ).rejects.toThrow();
  });
});

describe("localUsers.resetPassword", () => {
  it("requires admin role", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localUsers.resetPassword({ id: 1, newPassword: "newpass123" })
    ).rejects.toThrow();
  });

  it("validates minimum password length", async () => {
    const ctx = createAdminContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localUsers.resetPassword({ id: 1, newPassword: "12345" })
    ).rejects.toThrow();
  });
});

describe("localAuth.login", () => {
  it("validates email format", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localAuth.login({ email: "not-email", senha: "123456" })
    ).rejects.toThrow();
  });

  it("rejects non-existent user", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localAuth.login({ email: "nonexistent@example.com", senha: "123456" })
    ).rejects.toThrow(/Email ou senha inválidos/);
  });
});

describe("localAuth.changePassword", () => {
  it("validates email format", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localAuth.changePassword({
        email: "not-email",
        currentPassword: "123456",
        newPassword: "654321",
      })
    ).rejects.toThrow();
  });

  it("validates minimum new password length", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localAuth.changePassword({
        email: "test@example.com",
        currentPassword: "123456",
        newPassword: "12345",
      })
    ).rejects.toThrow();
  });

  it("rejects non-existent user", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.localAuth.changePassword({
        email: "nonexistent@example.com",
        currentPassword: "123456",
        newPassword: "654321",
      })
    ).rejects.toThrow(/Usuário não encontrado/);
  });
});
