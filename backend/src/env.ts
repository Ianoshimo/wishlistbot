import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BOT_TOKEN: z.string().min(1),
  MINI_APP_URL: z.string().url(),
  PORT: z.coerce.number().default(3000),
  YOOKASSA_SHOP_ID: z.string().optional(),
  YOOKASSA_SECRET_KEY: z.string().optional(),
});

export const env = schema.parse(process.env);
