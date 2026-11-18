const { afterEach, describe, expect, it } = await import("@/testkit");
const {
  createSessionToken,
  verifyEnvCredentials,
  verifySessionToken,
} = await import("./auth");

const env = process.env as Record<string, string | undefined>;
const snapshot = {
  SINGLE_USER_EMAIL: env.SINGLE_USER_EMAIL,
  SINGLE_USER_PASSWORD: env.SINGLE_USER_PASSWORD,
};

afterEach(() => {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
});

describe("environment credentials", () => {
  it("accepts the configured email and password", () => {
    env.SINGLE_USER_EMAIL = "Admin@Example.com";
    env.SINGLE_USER_PASSWORD = "correct-horse-battery";
    expect(verifyEnvCredentials("admin@example.com", "correct-horse-battery")).toBe(true);
  });

  it("rejects a wrong password", () => {
    env.SINGLE_USER_EMAIL = "admin@example.com";
    env.SINGLE_USER_PASSWORD = "correct-horse-battery";
    expect(verifyEnvCredentials("admin@example.com", "wrong")).toBe(false);
  });

  it("rejects a wrong email", () => {
    env.SINGLE_USER_EMAIL = "admin@example.com";
    env.SINGLE_USER_PASSWORD = "correct-horse-battery";
    expect(verifyEnvCredentials("other@example.com", "correct-horse-battery")).toBe(false);
  });

  it("rejects when credentials are not configured", () => {
    delete env.SINGLE_USER_EMAIL;
    delete env.SINGLE_USER_PASSWORD;
    expect(verifyEnvCredentials("admin@example.com", "anything")).toBe(false);
  });
});

describe("session tokens", () => {
  it("round-trips a user id", () => {
    const token = createSessionToken("single-user");
    expect(verifySessionToken(token)?.userId).toBe("single-user");
  });

  it("rejects tampered tokens", () => {
    const token = createSessionToken("single-user");
    expect(verifySessionToken(`${token.slice(0, -2)}xx`)).toBeNull();
  });

  it("rejects garbage", () => {
    expect(verifySessionToken(undefined)).toBeNull();
    expect(verifySessionToken("nonsense")).toBeNull();
  });
});

export {};
