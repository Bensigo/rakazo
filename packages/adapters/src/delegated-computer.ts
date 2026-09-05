import type { Prisma } from "@rakazo/db";

export async function revalidateDelegatedComputer(
  tx: Pick<Prisma.TransactionClient, "computer" | "employeeHost">,
  source: { computerId: string | null; spaceId: string; userId: string },
): Promise<string | null> {
  if (!source.computerId) return null;
  const computer = await tx.computer.findFirst({
    where: { id: source.computerId, spaceId: source.spaceId, userId: source.userId },
    select: { id: true, kind: true, providerRef: true },
  });
  if (!computer) throw new Error("The selected computer for this delegation is unavailable");
  if (computer.kind !== "employee-host") return computer.id;
  if (!computer.providerRef) throw new Error("The selected employee computer is unavailable");
  const host = await tx.employeeHost.findFirst({
    where: {
      computerId: computer.id,
      hostId: computer.providerRef,
      spaceId: source.spaceId,
      ownerUserId: source.userId,
      expiresAt: { gt: new Date() },
    },
    select: { computerId: true },
  });
  if (!host) throw new Error("The selected employee computer is unavailable");
  return host.computerId;
}
