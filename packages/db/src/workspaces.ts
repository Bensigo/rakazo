import type { PrismaClient } from "./client.js";

type WorkspaceClient = Pick<
  PrismaClient,
  "workspace" | "workspaceMember" | "memoryDocument" | "notificationPreference"
>;

export interface CreateWorkspaceInput {
  workspaceId: string;
  workspaceMembershipId: string;
  organizationId: string;
  userId: string;
  name: string;
  createdAt: Date;
}

export async function createWorkspace(
  prisma: WorkspaceClient,
  input: CreateWorkspaceInput,
): Promise<void> {
  await prisma.workspace.create({
    data: {
      id: input.workspaceId,
      organizationId: input.organizationId,
      name: input.name,
      createdAt: input.createdAt,
    },
  });
  await prisma.workspaceMember.create({
    data: {
      id: input.workspaceMembershipId,
      workspaceId: input.workspaceId,
      organizationId: input.organizationId,
      userId: input.userId,
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
