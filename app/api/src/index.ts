import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import { createServer } from "http";
import { Server } from "socket.io";
import { PrismaClient, RelationshipIntent } from "@prisma/client";
import * as argon2 from "argon2";
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "crypto";
import { z } from "zod";

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);

const PORT = Number(process.env.PORT || 3000);
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";
const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "dev-access-secret-change-me";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-me";
const IS_PROD = process.env.NODE_ENV === "production";

const io = new Server(httpServer, {
  cors: { origin: WEB_ORIGIN === "*" ? true : WEB_ORIGIN, credentials: true },
  path: "/socket.io",
});

app.set("trust proxy", 1);
app.use(
  cors({
    origin: WEB_ORIGIN === "*" ? true : WEB_ORIGIN,
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());
app.use(
  rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

type JwtPayload = { sub: string };

function signAccess(userId: string) {
  return jwt.sign({ sub: userId }, JWT_ACCESS_SECRET, { expiresIn: "15m" });
}

function hashToken(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

async function issueTokens(userId: string) {
  const accessToken = signAccess(userId);
  const rawRefresh = randomBytes(48).toString("base64url");
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: hashToken(rawRefresh),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  return { accessToken, refreshToken: rawRefresh };
}

function setAuthCookies(res: express.Response, accessToken: string, refreshToken: string) {
  res.cookie("access_token", accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    maxAge: 15 * 60 * 1000,
    path: "/",
  });
  res.cookie("refresh_token", refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: IS_PROD ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: "/",
  });
}

function clearAuthCookies(res: express.Response) {
  res.clearCookie("access_token", { path: "/" });
  res.clearCookie("refresh_token", { path: "/" });
}

async function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const token = req.cookies?.access_token as string | undefined;
    if (!token) return res.status(401).json({ message: "Unauthorized" });
    const payload = jwt.verify(token, JWT_ACCESS_SECRET) as JwtPayload;
    const user = await prisma.user.findFirst({
      where: { id: payload.sub, status: "ACTIVE" },
      include: { profile: { include: { photos: { orderBy: { position: "asc" } } } } },
    });
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    (req as any).user = user;
    next();
  } catch {
    return res.status(401).json({ message: "Unauthorized" });
  }
}

function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function publicProfile(user: any) {
  const p = user.profile;
  if (!p) return null;
  const photos = (p.photos || []).map((ph: any) => ph.photoUrl);
  if (!photos.length && p.avatarUrl) photos.push(p.avatarUrl);
  return {
    id: user.id,
    name: p.displayName,
    age: p.age,
    occupation: p.occupation,
    intent: p.relationshipIntent,
    verified: user.verified,
    city: p.city,
    country: p.country,
    latitude: p.latitude,
    longitude: p.longitude,
    promptTag: p.promptTag,
    promptQuestion: p.promptQuestion,
    promptAnswer: p.promptAnswer,
    interests: p.interests,
    basics: p.basics,
    avatar: photos[0] || p.avatarUrl,
    photos,
    createdAt: p.createdAt,
  };
}

app.get("/health", (_req, res) => res.json({ ok: true }));

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(100),
  name: z.string().min(1).max(40),
  age: z.number().int().min(18).max(99),
  occupation: z.string().min(1).max(60),
  intent: z.enum(["marriage", "long-term", "verified"]),
  verified: z.boolean().optional(),
  avatar: z.string().url().optional().or(z.literal("")),
  photos: z.array(z.string()).max(8).optional(),
  promptTag: z.string().min(1),
  promptQuestion: z.string().min(1).max(120),
  promptAnswer: z.string().min(1).max(280),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  city: z.string().optional(),
  country: z.string().optional(),
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() } });
    if (existing) return res.status(409).json({ message: "Email already registered" });

    const passwordHash = await argon2.hash(body.password, { type: argon2.argon2id });
    const intentMap: Record<string, RelationshipIntent> = {
      marriage: "marriage",
      "long-term": "long_term",
      verified: "verified",
    };

    const photos = (body.photos || []).filter(Boolean).slice(0, 8);
    if (body.avatar) photos.unshift(body.avatar);

    const user = await prisma.user.create({
      data: {
        email: body.email.toLowerCase(),
        passwordHash,
        verified: body.verified ?? true,
        profile: {
          create: {
            displayName: body.name,
            age: body.age,
            occupation: body.occupation,
            relationshipIntent: intentMap[body.intent],
            promptTag: body.promptTag,
            promptQuestion: body.promptQuestion,
            promptAnswer: body.promptAnswer,
            latitude: body.latitude ?? null,
            longitude: body.longitude ?? null,
            city: body.city || "",
            country: body.country || "",
            avatarUrl: photos[0] || null,
            photos: {
              create: photos.map((url, i) => ({
                photoUrl: url,
                position: i + 1,
                isPrimary: i === 0,
              })),
            },
          },
        },
      },
      include: { profile: { include: { photos: true } } },
    });

    const tokens = await issueTokens(user.id);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.status(201).json({ user: publicProfile(user) });
  } catch (e: any) {
    if (e?.name === "ZodError") return res.status(400).json({ message: "Invalid input", issues: e.issues });
    console.error(e);
    res.status(500).json({ message: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = String(req.body.email || "").toLowerCase();
    const password = String(req.body.password || "");
    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: { include: { photos: { orderBy: { position: "asc" } } } } },
    });
    if (!user || user.status !== "ACTIVE") return res.status(401).json({ message: "Invalid credentials" });
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });
    await prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
    const tokens = await issueTokens(user.id);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({ user: publicProfile(user) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Login failed" });
  }
});

app.post("/api/auth/refresh", async (req, res) => {
  try {
    const raw = req.cookies?.refresh_token as string | undefined;
    if (!raw) return res.status(401).json({ message: "No refresh token" });
    const tokenHash = hashToken(raw);
    const existing = await prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!existing) return res.status(401).json({ message: "Invalid refresh token" });
    await prisma.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
    const tokens = await issueTokens(existing.userId);
    setAuthCookies(res, tokens.accessToken, tokens.refreshToken);
    res.json({ ok: true });
  } catch {
    res.status(401).json({ message: "Refresh failed" });
  }
});

app.post("/api/auth/logout", authMiddleware, async (req, res) => {
  const raw = req.cookies?.refresh_token as string | undefined;
  if (raw) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(raw), userId: (req as any).user.id },
      data: { revokedAt: new Date() },
    });
  }
  clearAuthCookies(res);
  res.json({ ok: true });
});

app.get("/api/users/me", authMiddleware, async (req, res) => {
  res.json({ user: publicProfile((req as any).user) });
});

app.patch("/api/users/me", authMiddleware, async (req, res) => {
  const user = (req as any).user;
  const p = user.profile;
  if (!p) return res.status(400).json({ message: "No profile" });

  const data: any = {};
  if (req.body.name) data.displayName = String(req.body.name).slice(0, 40);
  if (req.body.age) data.age = Number(req.body.age);
  if (req.body.occupation) data.occupation = String(req.body.occupation).slice(0, 60);
  if (req.body.intent) {
    const map: Record<string, RelationshipIntent> = {
      marriage: "marriage",
      "long-term": "long_term",
      verified: "verified",
    };
    data.relationshipIntent = map[req.body.intent] || p.relationshipIntent;
  }
  if (req.body.promptTag) data.promptTag = String(req.body.promptTag);
  if (req.body.promptQuestion) data.promptQuestion = String(req.body.promptQuestion).slice(0, 120);
  if (req.body.promptAnswer) data.promptAnswer = String(req.body.promptAnswer).slice(0, 280);
  if (req.body.avatar) data.avatarUrl = String(req.body.avatar);
  if (req.body.latitude != null) data.latitude = Number(req.body.latitude);
  if (req.body.longitude != null) data.longitude = Number(req.body.longitude);
  if (req.body.city != null) data.city = String(req.body.city);
  if (req.body.country != null) data.country = String(req.body.country);

  await prisma.profile.update({ where: { id: p.id }, data });
  if (typeof req.body.verified === "boolean") {
    await prisma.user.update({ where: { id: user.id }, data: { verified: req.body.verified } });
  }
  const fresh = await prisma.user.findUnique({
    where: { id: user.id },
    include: { profile: { include: { photos: { orderBy: { position: "asc" } } } } },
  });
  res.json({ user: publicProfile(fresh) });
});

app.delete("/api/users/me", authMiddleware, async (req, res) => {
  const userId = (req as any).user.id;
  await prisma.user.update({ where: { id: userId }, data: { status: "DELETED", email: `deleted_${userId}@invalid.local` } });
  clearAuthCookies(res);
  res.json({ ok: true });
});

app.get("/api/discovery/feed", authMiddleware, async (req, res) => {
  const me = (req as any).user;
  const lat = Number(req.query.lat ?? me.profile?.latitude);
  const lon = Number(req.query.lon ?? me.profile?.longitude);
  const maxMiles = Math.min(Number(req.query.maxMiles || 50), 500);
  const ageMin = Math.max(18, Number(req.query.ageMin || 18));
  const ageMax = Math.min(99, Number(req.query.ageMax || 99));
  const intent = String(req.query.intent || "");
  const verifiedOnly = String(req.query.verified || "") === "true";
  const q = String(req.query.q || "").toLowerCase().trim();

  const users = await prisma.user.findMany({
    where: {
      status: "ACTIVE",
      id: { not: me.id },
      ...(verifiedOnly ? { verified: true } : {}),
      profile: {
        is: {
          age: { gte: ageMin, lte: ageMax },
          ...(intent === "marriage" || intent === "long-term"
            ? { relationshipIntent: { in: ["marriage", "long_term"] } }
            : {}),
        },
      },
    },
    include: { profile: { include: { photos: { orderBy: { position: "asc" } } } } },
    take: 100,
  });

  let items = users
    .map((u) => {
      const profile = publicProfile(u);
      if (!profile) return null;
      let distanceMiles: number | null = null;
      if (lat && lon && profile.latitude != null && profile.longitude != null) {
        distanceMiles = haversineMiles(lat, lon, profile.latitude, profile.longitude);
      }
      return { ...profile, distanceMiles };
    })
    .filter(Boolean) as any[];

  if (!Number.isNaN(lat) && !Number.isNaN(lon)) {
    items = items.filter((i) => i.distanceMiles == null || i.distanceMiles <= maxMiles);
  }
  if (q) {
    items = items.filter((i) =>
      [i.name, i.occupation, i.promptTag, i.promptQuestion, i.promptAnswer, i.city]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }
  items.sort((a, b) => (a.distanceMiles ?? 9999) - (b.distanceMiles ?? 9999));
  res.json({ items: items.slice(0, 40) });
});

app.post("/api/likes", authMiddleware, async (req, res) => {
  const me = (req as any).user;
  const receiverId = String(req.body.receiverId || "");
  if (!receiverId || receiverId === me.id) return res.status(400).json({ message: "Invalid target" });

  const target = await prisma.user.findFirst({
    where: { id: receiverId, status: "ACTIVE" },
    include: { profile: true },
  });
  if (!target) return res.status(404).json({ message: "User not found" });

  await prisma.like.upsert({
    where: { senderId_receiverId: { senderId: me.id, receiverId } },
    create: { senderId: me.id, receiverId, isPromptOnly: !!req.body.isPromptOnly },
    update: {},
  });

  const reciprocal = await prisma.like.findUnique({
    where: { senderId_receiverId: { senderId: receiverId, receiverId: me.id } },
  });

  let match = null;
  if (reciprocal) {
    const [userAId, userBId] = me.id < receiverId ? [me.id, receiverId] : [receiverId, me.id];
    match = await prisma.match.upsert({
      where: { userAId_userBId: { userAId, userBId } },
      create: { userAId, userBId },
      update: { status: "ACTIVE" },
    });
    io.to(`user:${receiverId}`).emit("new_match", { matchId: match.id, userId: me.id });
    io.to(`user:${me.id}`).emit("new_match", { matchId: match.id, userId: receiverId });
  }

  io.to(`user:${receiverId}`).emit("new_like", { fromUserId: me.id });
  res.json({ ok: true, mutual: !!reciprocal, matchId: match?.id || null });
});

app.get("/api/likes/received", authMiddleware, async (req, res) => {
  const me = (req as any).user;
  const likes = await prisma.like.findMany({
    where: { receiverId: me.id },
    orderBy: { createdAt: "desc" },
    include: {
      sender: { include: { profile: { include: { photos: { orderBy: { position: "asc" } } } } } },
    },
    take: 50,
  });
  res.json({
    items: likes.map((l) => ({
      id: l.id,
      createdAt: l.createdAt,
      from: publicProfile(l.sender),
    })),
  });
});

app.get("/api/matches", authMiddleware, async (req, res) => {
  const me = (req as any).user;
  const matches = await prisma.match.findMany({
    where: { status: "ACTIVE", OR: [{ userAId: me.id }, { userBId: me.id }] },
    orderBy: { createdAt: "desc" },
  });

  const otherIds = matches.map((m) => (m.userAId === me.id ? m.userBId : m.userAId));
  const others = await prisma.user.findMany({
    where: { id: { in: otherIds } },
    include: { profile: { include: { photos: { orderBy: { position: "asc" } } } } },
  });
  const byId = new Map(others.map((u) => [u.id, u]));

  res.json({
    items: matches.map((m) => {
      const otherId = m.userAId === me.id ? m.userBId : m.userAId;
      return {
        id: m.id,
        createdAt: m.createdAt,
        other: publicProfile(byId.get(otherId)),
      };
    }),
  });
});

app.get("/api/matches/:matchId/messages", authMiddleware, async (req, res) => {
  const me = (req as any).user;
  const match = await prisma.match.findFirst({
    where: {
      id: req.params.matchId,
      status: "ACTIVE",
      OR: [{ userAId: me.id }, { userBId: me.id }],
    },
  });
  if (!match) return res.status(404).json({ message: "Match not found" });

  const messages = await prisma.message.findMany({
    where: { matchId: match.id },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  res.json({
    items: messages.map((m) => ({
      id: m.id,
      matchId: m.matchId,
      senderId: m.senderId,
      content: m.content,
      createdAt: m.createdAt,
      readAt: m.readAt,
    })),
  });
});

// ---- Socket.io ----
const presence = new Map<string, number>();

io.use(async (socket, next) => {
  try {
    const cookieHeader = socket.handshake.headers.cookie || "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").filter(Boolean).map((p) => {
        const [k, ...v] = p.trim().split("=");
        return [k, decodeURIComponent(v.join("="))];
      })
    );
    const token = (socket.handshake.auth?.token as string) || cookies.access_token;
    if (!token) return next(new Error("Unauthorized"));
    const payload = jwt.verify(token, JWT_ACCESS_SECRET) as JwtPayload;
    socket.data.userId = payload.sub;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", async (socket) => {
  const userId = socket.data.userId as string;
  await socket.join(`user:${userId}`);
  presence.set(userId, Date.now());

  const matches = await prisma.match.findMany({
    where: { status: "ACTIVE", OR: [{ userAId: userId }, { userBId: userId }] },
  });
  for (const m of matches) {
    await socket.join(`match:${m.id}`);
    socket.to(`match:${m.id}`).emit("presence_update", { userId, online: true });
  }

  socket.on("presence_heartbeat", () => {
    presence.set(userId, Date.now());
  });

  socket.on("send_message", async (body: { matchId: string; content: string }) => {
    try {
      const content = String(body?.content || "").trim().slice(0, 2000);
      if (!content || !body?.matchId) return;
      const match = await prisma.match.findFirst({
        where: {
          id: body.matchId,
          status: "ACTIVE",
          OR: [{ userAId: userId }, { userBId: userId }],
        },
      });
      if (!match || match.userAId === match.userBId) return;

      const msg = await prisma.message.create({
        data: { matchId: match.id, senderId: userId, content },
      });
      const payload = {
        id: msg.id,
        matchId: msg.matchId,
        senderId: msg.senderId,
        content: msg.content,
        createdAt: msg.createdAt.toISOString(),
        readAt: null as string | null,
      };
      io.to(`match:${match.id}`).emit("message_received", payload);
      const otherId = match.userAId === userId ? match.userBId : match.userAId;
      io.to(`user:${otherId}`).emit("unread_update", { matchId: match.id });
    } catch (e) {
      console.error("send_message", e);
    }
  });

  socket.on("typing_start", (body: { matchId: string }) => {
    if (!body?.matchId) return;
    socket.to(`match:${body.matchId}`).emit("typing_status", {
      matchId: body.matchId,
      userId,
      isTyping: true,
    });
  });

  socket.on("typing_stop", (body: { matchId: string }) => {
    if (!body?.matchId) return;
    socket.to(`match:${body.matchId}`).emit("typing_status", {
      matchId: body.matchId,
      userId,
      isTyping: false,
    });
  });

  socket.on("mark_read", async (body: { matchId: string }) => {
    if (!body?.matchId) return;
    const result = await prisma.message.updateMany({
      where: { matchId: body.matchId, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });
    if (result.count > 0) {
      io.to(`match:${body.matchId}`).emit("messages_read", {
        matchId: body.matchId,
        readerId: userId,
        readAt: new Date().toISOString(),
      });
    }
  });

  socket.on("disconnect", () => {
    // presence expires client-side after ~90s without heartbeat
  });
});

httpServer.listen(PORT, () => {
  console.log(`Quincy API listening on :${PORT}`);
});