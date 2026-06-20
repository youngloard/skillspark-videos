import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/db";
import { createAuditLog } from "@/lib/audit-log";

export type AppRole = "admin" | "student";

export type AppSessionUser = {
  id: string;
  role: AppRole;
  email: string;
  name: string | null;
  studentId?: string;
  adminId?: string;
};

declare module "next-auth" {
  interface Session {
    user: DefaultSession["user"] & {
      role?: AppRole;
      studentId?: string;
      adminId?: string;
    };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    async signIn({ user }) {
      const email = user.email?.toLowerCase().trim();
      if (!email) return false;

      const admin = await prisma.admin.findUnique({ where: { email } });
      if (admin) {
        if (admin.status !== "active") {
          await createAuditLog({
            actorEmail: email,
            actorType: "system",
            action: "LOGIN_DENIED_BLOCKED_ADMIN",
            entityType: "Admin",
            entityId: admin.id,
          });
          return false;
        }
        await createAuditLog({
          actorId: admin.id,
          actorEmail: email,
          actorType: "admin",
          action: "ADMIN_LOGIN",
        });
        return true;
      }

      const student = await prisma.student.findUnique({ where: { email } });
      if (!student) {
        await createAuditLog({
          actorEmail: email,
          actorType: "system",
          action: "LOGIN_DENIED_UNREGISTERED_EMAIL",
        });
        return false;
      }
      if (student.status === "blocked") {
        await createAuditLog({
          actorId: student.id,
          actorEmail: email,
          actorType: "system",
          action: "LOGIN_DENIED_BLOCKED_STUDENT",
          entityType: "Student",
          entityId: student.id,
        });
        return false;
      }
      const now = new Date();
      if (student.accessEndDate < now || student.accessStartDate > now) {
        await createAuditLog({
          actorId: student.id,
          actorEmail: email,
          actorType: "system",
          action: "LOGIN_DENIED_EXPIRED_STUDENT",
          entityType: "Student",
          entityId: student.id,
        });
        return false;
      }
      await createAuditLog({
        actorId: student.id,
        actorEmail: email,
        actorType: "student",
        action: "STUDENT_LOGIN",
      });
      return true;
    },

    async jwt({ token, user }) {
      const email = (user?.email ?? token.email)?.toLowerCase().trim();
      if (!email) return token;
      // Resolve role on every refresh so blocking takes effect quickly.
      const admin = await prisma.admin.findUnique({ where: { email } });
      if (admin && admin.status === "active") {
        token.role = "admin";
        token.adminId = admin.id;
        token.studentId = undefined;
        return token;
      }
      const student = await prisma.student.findUnique({ where: { email } });
      if (student && student.status === "active") {
        token.role = "student";
        token.studentId = student.id;
        token.adminId = undefined;
      }
      return token;
    },

    async session({ session, token }) {
      if (token.role) session.user.role = token.role as AppRole;
      if (token.adminId) session.user.adminId = token.adminId as string;
      if (token.studentId) session.user.studentId = token.studentId as string;
      return session;
    },
  },
});
