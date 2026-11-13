import { redirect } from "next/navigation";
import { isSignInLinkError } from "@/components/auth/sign-in-link-error";
import { getSessionUser, homePath } from "@/lib/auth/session";

/** Sign-in is the first step of setup; a signed-in user goes to the dashboard or back to the setup step they reached. */
export default async function SignInPage({ searchParams }: PageProps<"/signin">) {
  const user = await getSessionUser();
  if (user) redirect(await homePath(user.id));
  const { error } = await searchParams;
  redirect(isSignInLinkError(error) ? `/onboarding?error=${error}` : "/onboarding");
}
