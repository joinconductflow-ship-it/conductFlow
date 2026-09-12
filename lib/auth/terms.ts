/** Carries explicit acceptance across the same-browser Supabase PKCE round trip. */
export const TERMS_COOKIE = "cf-terms-accepted";
export const TERMS_REQUIRED = "You must accept the Privacy Policy and Terms to continue.";
export const TERMS_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/auth",
  maxAge: 60 * 60,
};
