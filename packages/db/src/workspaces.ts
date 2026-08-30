import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "./client.js";
import { IsolationError } from "./scope.js";
import { withTransactionRetry } from "./transaction-retry.js";

/** Per member, per organization: one person cannot fan out unbounded boundaries. */
const MAX_SPACES_PER_MEMBER = 32;

export class SpaceLimitError extends Error {
  constructor() {
    super("Space limit reached");
    this.name = "SpaceLimitError";
  }
}

export class InvalidSpaceNameError extends Error {
  constructor() {
    super("Space name must be between 1 and 60 characters");
    this.name = "InvalidSpaceNameError";
  }
}

type WorkspaceClient = Pick<
  PrismaClient,
  "workspace" | "workspaceMember" | "memoryDocument" | "notificationPreference"
>;

interface CreateWorkspaceInput {
  workspaceId: string;
  workspaceMembershipId: string;
  organizationId: string;
  userId: string;
  name: string;
  createdAt: Date;
}

async function createWorkspace(
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

async function createWorkspaceDefaults(
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

/** Create a sibling privacy boundary for a member of the active organization. */
export async function createSpaceForMember(
  prisma: PrismaClient,
  input: {
    currentWorkspaceId: string;
    userId: string;
    name: string;
  },
): Promise<{ id: string; name: string }> {
  const name = input.name.trim();
  if (!name || name.length > 60) throw new InvalidSpaceNameError();
  const workspaceId = randomUUID();
  const workspaceMembershipId = randomUUID();
  const createdAt = new Date();

  await withTransactionRetry(() =>
    prisma.$transaction(
      async (tx) => {
        const currentMembership = await tx.workspaceMember.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: input.currentWorkspaceId,
              userId: input.userId,
            },
          },
          select: { organizationId: true },
        });
        if (!currentMembership) throw new IsolationError();
        const count = await tx.workspaceMember.count({
          where: {
            userId: input.userId,
            organizationId: currentMembership.organizationId,
          },
        });
        if (count >= MAX_SPACES_PER_MEMBER) throw new SpaceLimitError();
        await createWorkspace(tx, {
          workspaceId,
          workspaceMembershipId,
          organizationId: currentMembership.organizationId,
          userId: input.userId,
          name,
          createdAt,
        });
        await createWorkspaceDefaults(tx, {
          workspaceId,
          userId: input.userId,
          memoryContent: "# Space memory\n\n",
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ),
  );

  return { id: workspaceId, name };
}
