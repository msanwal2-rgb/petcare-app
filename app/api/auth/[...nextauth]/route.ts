// Auth.js catch-all route: /api/auth/* (sign-in, callback, session, csrf, …).
// Runs on the Node runtime so the Credentials provider can use Prisma + bcrypt.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
