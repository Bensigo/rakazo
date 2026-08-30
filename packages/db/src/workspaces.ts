import type { PrismaClient } from "./client.js";

type WorkspaceClient = Pick<
  PrismaClient,
  "organization" | "member" | "memoryDocument" | "notificationPreference"
>;

export interface OwnedWorkspaceInput {
  workspaceId: string;
  membershipId: string;
  userId: string;
  name: string;
  slug: string;
  createdAt: Date;
}

export async function createOwnedWorkspace(
  prisma: WorkspaceClient,
  input: OwnedWorkspaceInput,
): Promise<void> {
  await prisma.organization.create({
    data: {
      id: input.workspaceId,
      name: input.name,
      slug: input.slug,
      createdAt: input.createdAt,
    },
  });
  await prisma.member.create({
    data: {
      id: input.membershipId,
      organizationId: input.workspaceId,
      userId: input.userId,
      role: "owner",
      createdAt: input.createdAt,
    },
  });
}

export async function createWorkspaceDefaults(
  prisma: WorkspaceClient,
  input: { workspaceId: string; userId: string; memoryContent: string },
): Promise<void> {
  await prisma.memoryDocument.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      scope: "user",
      path: "MEMORY.md",
      content: input.memoryContent,
    },
  });
  await prisma.notificationPreference.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
    },
  });
}
