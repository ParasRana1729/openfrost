import { z } from 'zod';

export const conversationSchema = z.strictObject({
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  /** Project the conversation is scoped to, when the owner chose one. */
  projectId: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof messageRoleSchema>;

export const messageSchema = z.strictObject({
  id: z.string().min(1),
  conversationId: z.string().min(1),
  role: messageRoleSchema,
  content: z.string().min(1),
  createdAt: z.string().min(1),
});
export type Message = z.infer<typeof messageSchema>;
