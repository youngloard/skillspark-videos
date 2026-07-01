import { prisma } from "@/lib/db";

/**
 * Default student-email template. Kept as a plain server util (NOT a "use
 * server" action) so Server Components can read it during render without the
 * server-action-in-render restriction. The DB read is defensive: any failure
 * (missing row, table not migrated yet) degrades to the built-in copy instead
 * of crashing the page.
 */

export const DEFAULT_TEMPLATE_KEY = "default";

export const FALLBACK_EMAIL_SUBJECT = "Access your SkillSpark courses";

export const FALLBACK_EMAIL_BODY = `Hi {{name}},

Your SkillSpark learning account is ready.

How to access your content:
1. Go to {{platformUrl}}
2. Click "Sign in with Google" and use THIS email address ({{email}}).
3. Your assigned courses appear on your dashboard.

If you can't sign in, reply to this email and we'll help.

— SkillSpark Academic Coordinator`;

export async function getDefaultEmailTemplate(): Promise<{ subject: string; body: string }> {
  try {
    const row = await prisma.emailTemplate.findUnique({ where: { key: DEFAULT_TEMPLATE_KEY } });
    return {
      subject: row?.subject ?? FALLBACK_EMAIL_SUBJECT,
      body: row?.body ?? FALLBACK_EMAIL_BODY,
    };
  } catch {
    return { subject: FALLBACK_EMAIL_SUBJECT, body: FALLBACK_EMAIL_BODY };
  }
}
