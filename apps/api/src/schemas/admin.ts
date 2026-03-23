import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type LoginBody = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(4, 'Password must be at least 4 characters'),
});
