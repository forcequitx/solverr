/** Error code Better Auth adds to the callback URL when an email sign-in link is expired, unknown or already used. */
const SIGN_IN_LINK_ERROR = "INVALID_TOKEN";

export function isSignInLinkError(code: unknown): code is typeof SIGN_IN_LINK_ERROR {
  return code === SIGN_IN_LINK_ERROR;
}
