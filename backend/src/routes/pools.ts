import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { telegramIdSchema } from "../auth/telegramAuth.js";

// Спека итерации 1, п.4-5: сбор без привязки к товару, полный автовозврат
// при истечении срока, продление срока организатором.
//
// Приём реальных денег через ЮKassa НЕ подключён - открытый вопрос про
// юрлицо и тип чека "добровольный взнос" под 54-ФЗ не закрыт (см. спеку).
// /contribute ниже создаёт запись со статусом pending и явно не двигает
// деньги - подключить YookassaService, когда вопрос закрыт.

export async function poolRoutes(app: FastifyInstance) {
  app.post("/api/pools", async (req, reply) => {
    const body = z
      .object({
        telegramId: z.string().regex(telegramIdSchema),
        title: z.string().min(1),
        occasionDate: z.string().datetime().optional(),
        targetAmount: z.number().int().positive().optional(), // копейки
        durationDays: z.union([z.literal(7), z.literal(14), z.literal(30)]),
      })
      .parse(req.body);

    const organizer = await db.user.upsert({
      where: { telegramId: BigInt(body.telegramId) },
      update: {},
      create: { telegramId: BigInt(body.telegramId), firstName: "" },
    });

    const deadline = new Date();
    deadline.setDate(deadline.getDate() + body.durationDays);

    const pool = await db.pool.create({
      data: {
        organizerId: organizer.id,
        title: body.title,
        occasionDate: body.occasionDate ? new Date(body.occasionDate) : null,
        targetAmount: body.targetAmount,
        deadline,
      },
    });

    return reply.code(201).send({ id: pool.id });
  });

  app.get("/api/pools/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { telegramId } = z
      .object({ telegramId: z.string().regex(telegramIdSchema).optional() })
      .parse(req.query);

    const pool = await db.pool.findUnique({
      where: { id },
      include: { contributions: { where: { status: "success" } }, organizer: true },
    });
    if (!pool) return reply.code(404).send({ error: "pool_not_found" });

    const collected = pool.contributions.reduce((sum, c) => sum + c.amount, 0);
    const viewerIsOrganizer = Boolean(
      telegramId && pool.organizer.telegramId === BigInt(telegramId),
    );

    return {
      id: pool.id,
      title: pool.title,
      targetAmount: pool.targetAmount,
      collected,
      deadline: pool.deadline,
      status: pool.status,
      viewerIsOrganizer,
      // Взносы отдаём без contributorId - в макете список анонимный
      // (см. Продукт/задачи-итерация-1.md, Ф4).
      contributions: pool.contributions.map((c) => ({
        amount: c.amount,
        createdAt: c.createdAt,
      })),
    };
  });

  app.post("/api/pools/:id/extend", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ days: z.literal(7) }).parse(req.body);

    const pool = await db.pool.findUniqueOrThrow({ where: { id } });
    const newDeadline = new Date(pool.deadline);
    newDeadline.setDate(newDeadline.getDate() + body.days);

    await db.pool.update({ where: { id }, data: { deadline: newDeadline } });
    return { deadline: newDeadline };
  });

  app.post("/api/pools/:id/contribute", async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z
      .object({ telegramId: z.string().regex(telegramIdSchema), amount: z.number().int().positive() })
      .parse(req.body);

    const contributor = await db.user.upsert({
      where: { telegramId: BigInt(body.telegramId) },
      update: {},
      create: { telegramId: BigInt(body.telegramId), firstName: "" },
    });

    // TODO: интеграция с ЮKassa - см. комментарий в шапке файла.
    // Пока просто фиксируем намерение внести взнос со статусом pending,
    // без реального списания денег.
    const contribution = await db.contribution.create({
      data: {
        poolId: id,
        contributorId: contributor.id,
        amount: body.amount,
        status: "pending",
      },
    });

    return reply.code(202).send({
      id: contribution.id,
      status: "pending",
      note: "Оплата через ЮKassa ещё не подключена - см. открытые вопросы спеки",
    });
  });
}
