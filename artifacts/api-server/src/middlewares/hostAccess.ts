import { timingSafeEqual } from "crypto";
import cookieParser from "cookie-parser";
import type { NextFunction, Request, Response } from "express";

export const HOST_ACCESS_COOKIE = "host_access";

function getCookieSecret(): string {
  return process.env.SESSION_SECRET!.trim();
}

function getAllowedHostCodes(): string[] {
  const combined = [
    process.env.HOST_ACCESS_CODES,
    process.env.HOST_ACCESS_CODE,
    // NOTE: SESSION_SECRET must NOT be listed here — it is only for signing cookies.
  ]
    .filter(Boolean)
    .join(",");

  return combined
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function verifyHostAccessCode(accessKey: string): boolean {
  const normalized = accessKey.trim();
  if (!normalized) return false;

  return getAllowedHostCodes().some(code => {
    try {
      return timingSafeEqual(Buffer.from(normalized), Buffer.from(code));
    } catch {
      return false; // buffers of different lengths throw — treat as not equal
    }
  });
}

function getHostAccessCodeFromHeaders(headers?: Request["headers"]): string | null {
  const headerValue = headers?.["x-host-access-code"];

  if (Array.isArray(headerValue)) {
    return headerValue[0]?.trim() || null;
  }

  return typeof headerValue === "string" && headerValue.trim() ? headerValue.trim() : null;
}

export function hasHostAccess(req: Pick<Request, "signedCookies" | "headers">): boolean {
  if (req.signedCookies?.[HOST_ACCESS_COOKIE] === "allowed") {
    return true;
  }

  const headerCode = getHostAccessCodeFromHeaders(req.headers);
  return headerCode ? verifyHostAccessCode(headerCode) : false;
}

export function hasHostAccessFromCookieHeader(cookieHeader?: string): boolean {
  if (!cookieHeader) return false;

  const rawCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${HOST_ACCESS_COOKIE}=`));

  if (!rawCookie) return false;

  const cookieValue = decodeURIComponent(rawCookie.slice(HOST_ACCESS_COOKIE.length + 1));
  return cookieParser.signedCookie(cookieValue, getCookieSecret()) === "allowed";
}

export function setHostAccessCookie(res: Response): void {
  const isSecure = process.env.NODE_ENV === "production";

  res.cookie(HOST_ACCESS_COOKIE, "allowed", {
    httpOnly: true,
    signed: true,
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
    path: "/",
    maxAge: 1000 * 60 * 60 * 12,
  });
}

export function clearHostAccessCookie(res: Response): void {
  const isSecure = process.env.NODE_ENV === "production";

  res.clearCookie(HOST_ACCESS_COOKIE, {
    httpOnly: true,
    signed: true,
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
    path: "/",
  });
}

export function requireHostAccess(req: Request, res: Response, next: NextFunction): void {
  if (hasHostAccess(req)) {
    next();
    return;
  }

  res.status(401).json({ error: "Host access required" });
}
