import { ArrowRight, BookOpenCheck, GraduationCap, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { signIn, signOut } from "@/lib/auth";
import { getCurrentSessionUser } from "@/lib/authorization";

function GoogleG() {
  return (
    <span className="sx-google-g" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 48 48">
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
    </span>
  );
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  const user = await getCurrentSessionUser();

  return (
    <main id="main-content" className="sx-auth">
      <div className="sx-auth-card">
        <section className="sx-auth-story" aria-label="About SkillSpark">
          <div className="sx-auth-story-top">
            <span className="sx-eyebrow">
              <GraduationCap size={15} aria-hidden="true" />
              SkillSpark
            </span>
            <h1>
              Learn at your own pace, <em>without the noise.</em>
            </h1>
            <p>
              Recorded video courses, organized notes, and progress that picks up
              exactly where you stopped.
            </p>
          </div>
          <ul className="sx-auth-points">
            <li>
              <BookOpenCheck size={17} aria-hidden="true" />
              Your courses and packages, all in one library
            </li>
            <li>
              <ArrowRight size={17} aria-hidden="true" />
              Auto-resume on every lesson, on any device
            </li>
            <li>
              <ShieldCheck size={17} aria-hidden="true" />
              Private access, registered by your administrator
            </li>
          </ul>
        </section>

        <section className="sx-auth-form" aria-label="Authentication">
          <div className="sx-auth-form-head">
            <span className="sx-eyebrow">Secure access</span>
            <h2>{user ? "Welcome back" : "Sign in"}</h2>
            <p>
              {user
                ? "You are already signed in."
                : "Use the Google account registered by your administrator."}
            </p>
          </div>

          {params.error && (
            <p className="sx-alert" role="alert">
              <span>
                <strong>Access denied.</strong> Your Google account is not
                registered, has expired, or is blocked. Contact your
                administrator if this seems wrong.
              </span>
            </p>
          )}

          {user ? (
            <div className="sx-auth-user">
              <div className="sx-auth-user-card">
                <UserRound size={18} aria-hidden="true" />
                <div>
                  <strong>{user.email}</strong>
                  <small>{user.role}</small>
                </div>
              </div>
              <a className="sx-btn" href={user.role === "admin" ? "/admin" : "/dashboard"}>
                Go to {user.role === "admin" ? "admin" : "your"} dashboard
                <ArrowRight size={17} aria-hidden="true" />
              </a>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/login" });
                }}
              >
                <button className="sx-btn sx-btn--ghost" type="submit">
                  <LogOut size={16} aria-hidden="true" />
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <form
              action={async () => {
                "use server";
                await signIn("google", { redirectTo: "/" });
              }}
            >
              <button className="sx-btn" type="submit">
                <GoogleG />
                Continue with Google
              </button>
            </form>
          )}

          <p className="sx-auth-foot">
            Only registered accounts can sign in. No passwords, no sign-up forms.
          </p>
        </section>
      </div>
    </main>
  );
}
