const { beforeEach, describe, expect, it, vi } = await import("@/testkit");

await vi.mock("next/headers", () => ({ cookies: vi.fn() }));
await vi.mock(new URL("./prisma", import.meta.url).href, () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

const { cookies } = await import("next/headers");
const { prisma } = await import("./prisma");
const {
  createSessionToken,
  ensureSingleUser,
  getCurrentUser,
  revokeAllSessions,
} = await import("./auth");

const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  env.SESSION_SECRET = "test-session-secret-at-least-32-characters-long";
  env.SINGLE_USER_EMAIL = "admin@example.com";
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: "single-user",
    email: "admin@example.com",
    sessionVersion: 1,
  } as never);
  vi.mocked(prisma.user.update).mockResolvedValue({} as never);
  vi.mocked(prisma.user.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.user.deleteMany).mockResolvedValue({ count: 0 });
});

function setCookie(token: string) {
  vi.mocked(cookies).mockResolvedValue({
    get: () => ({ value: token }),
  } as never);
}

describe("session revocation", () => {
  it("accepts a token with the current session version", async () => {
    setCookie(createSessionToken("single-user", 1));
    expect(await getCurrentUser()).not.toBeNull();
  });

  it("rejects a token with an old session version", async () => {
    setCookie(createSessionToken("single-user", 0));
    expect(await getCurrentUser()).toBeNull();
  });

  it("increments the version to revoke sessions", async () => {
    await revokeAllSessions();
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "single-user" },
      data: { sessionVersion: { increment: 1 } },
    });
  });
});

describe("single-user bootstrap", () => {
  it("does not delete other users", async () => {
    await ensureSingleUser();
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    expect(prisma.user.upsert).toHaveBeenCalled();
  });
});

export {};
