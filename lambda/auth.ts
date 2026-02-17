import * as jose from "jose";

const AUTH_MODE = process.env.AUTH_MODE ?? "setup";
const SETUP_USERNAME = process.env.SETUP_USERNAME;
const SETUP_PASSWORD = process.env.SETUP_PASSWORD;
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;

let jwks: ReturnType<typeof jose.createRemoteJWKSet> | undefined;

function getJwks() {
  if (!jwks && AUTH0_DOMAIN) {
    jwks = jose.createRemoteJWKSet(
      new URL(`https://${AUTH0_DOMAIN}/.well-known/jwks.json`),
    );
  }
  return jwks!;
}

function checkBasicAuth(header: string): boolean {
  if (!header.startsWith("Basic ")) return false;
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const [user, pass] = decoded.split(":");
  return user === SETUP_USERNAME && pass === SETUP_PASSWORD;
}

async function checkJwtAuth(header: string): Promise<boolean> {
  if (!header.startsWith("Bearer ")) return false;
  try {
    await jose.jwtVerify(header.slice(7), getJwks(), {
      issuer: `https://${AUTH0_DOMAIN}/`,
      audience: AUTH0_AUDIENCE,
    });
    return true;
  } catch {
    return false;
  }
}

export async function authenticate(
  authHeader: string | undefined,
): Promise<boolean> {
  if (!authHeader) return false;

  if (AUTH_MODE === "setup") {
    return checkBasicAuth(authHeader);
  }
  if (AUTH_MODE === "auth0") {
    return checkJwtAuth(authHeader);
  }
  // "both" — try JWT first, fall back to basic
  if (await checkJwtAuth(authHeader)) return true;
  return checkBasicAuth(authHeader);
}
