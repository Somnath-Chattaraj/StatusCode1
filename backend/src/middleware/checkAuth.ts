import prisma from "../lib/prisma";
import redis from "../lib/redis";
import { verify } from "../lib/jwt";
// @ts-ignore
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies.Authorization;
    // @ts-ignore
    const decoded = await verify(token, process.env.SECRET);
    // @ts-ignore
    if (Date.now() >= decoded.exp) {
      res.sendStatus(410);
      return;
    }
    const userId = decoded.sub;
    if (!userId) {
      res.sendStatus(401);
      return;
    }
    const cachedUser = await redis.get(userId);
    if (cachedUser) {
      req.user = JSON.parse(cachedUser);
      next();
      return;
    }
    const user = await prisma.user.findUnique({
      where: {
        user_id: decoded.sub,
      },
    });
    if (!user) {
      res.sendStatus(401);
      return;
    }
    req.user = user;
    await redis.set(`user:${userId}`, JSON.stringify(user), "EX", 3600);
    next();
  } catch (err) {
    res.sendStatus(401);
    return;
  }
}

export default requireAuth;
