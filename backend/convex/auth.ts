/**
 * Authentication: Convex Auth with email + password. Sessions are JWTs signed
 * with JWT_PRIVATE_KEY (see scripts/setup-keys.mjs). Failed sign-ins are rate
 * limited by Convex Auth; a profile row is created on first sign-up.
 */
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = String(params.email ?? "")
          .trim()
          .toLowerCase();
        if (!EMAIL.test(email)) throw new ConvexError("Enter a valid email address.");
        const name = typeof params.name === "string" ? params.name.trim().slice(0, 80) : "";
        const profile: { email: string; [key: string]: string } = { email };
        if (name) profile.name = name;
        return profile;
      },
      validatePasswordRequirements(password: string) {
        if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
          throw new ConvexError("Use at least 10 characters, including letters and numbers.");
        }
      },
    }),
  ],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, args) {
      if (args.existingUserId) return;
      const db = (ctx as unknown as MutationCtx).db;
      const userId = args.userId as Id<"users">;
      const existing = await db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (existing) return;
      const email = String(args.profile.email ?? "").toLowerCase();
      const name = typeof args.profile.name === "string" && args.profile.name ? args.profile.name : email.split("@")[0];
      await db.insert("profiles", { userId, email, displayName: name, role: "user", createdAt: Date.now() });
    },
  },
});
